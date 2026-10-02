// ─────────────────────────────────────────────────────────────
//  Q4-1 — Annuaire des intervenants et rattachements aux sessions /
//  groupes. ADMIN : tout ; CONTRIBUTEUR : lecture limitée (nom, fonction,
//  domaines), projection appliquée ICI, côté serveur.
//  Aucune suppression de fiche : désactivation seulement (historique
//  conservé). Les textes historiques sessions.formateur / groupes.formateur
//  ne sont jamais modifiés par ces routes.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { getPool, query } from "../db.js";
import { requireAdmin, requireAuth } from "../session.js";
import { parseIdPositif } from "../services/ids.js";
import { MSG_ARCHIVEE } from "../services/archive.js";
import { estAdmin } from "../services/confidentialite.js";
import { FONCTIONS, NATURES, champsIntervenant, lireFormations, projeterIntervenant } from "../services/intervenants.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const MSG_EMAIL_PRIS = "Cette adresse e-mail professionnelle est déjà utilisée par une autre fiche.";

const LIGNE = `SELECT i.*,
    COALESCE((SELECT json_agg(json_build_object('id', f.id, 'intitule', f.intitule) ORDER BY f.intitule)
              FROM intervenants_formations x JOIN formations f ON f.id = x.formation_id WHERE x.intervenant_id = i.id), '[]'::json) AS formations,
    (SELECT count(*)::int FROM intervenants_sessions s WHERE s.intervenant_id = i.id) AS nb_sessions
  FROM intervenants i`;

async function verifierFormations(client, ids) {
  if (!ids?.length) return null;
  const { rows } = await client.query("SELECT id FROM formations WHERE id = ANY($1::int[])", [ids]);
  return rows.length === ids.length ? null : "Formation introuvable.";
}
async function remplacerFormations(client, id, ids) {
  if (ids === undefined) return;
  await client.query("DELETE FROM intervenants_formations WHERE intervenant_id = $1", [id]);
  if (ids.length) await client.query("INSERT INTO intervenants_formations (intervenant_id, formation_id) SELECT $1, unnest($2::int[])", [id, ids]);
}

// Liste + recherche (un seul appel). Contributeur : recherche sur le nom
// seulement, champs restreints.
router.get("/intervenants", requireAuth, wrap(async (req, res) => {
  const admin = estAdmin(req.user);
  const clauses = [], params = [];
  const ajoute = (v, cond) => { params.push(v); clauses.push(cond.replaceAll("?", `$${params.length}`)); };
  const q = String(req.query.q || "").trim();
  if (q) ajoute(`%${q}%`, admin ? "(i.nom ILIKE ? OR i.prenom ILIKE ? OR (i.prenom || ' ' || i.nom) ILIKE ? OR i.email ILIKE ?)" : "(i.nom ILIKE ? OR i.prenom ILIKE ? OR (i.prenom || ' ' || i.nom) ILIKE ?)");
  if (req.query.fonction) {
    if (!FONCTIONS.includes(req.query.fonction)) return res.status(400).json({ error: "Fonction inconnue." });
    ajoute(req.query.fonction, "i.fonction = ?");
  }
  if (req.query.nature && admin) {
    if (!NATURES.includes(req.query.nature)) return res.status(400).json({ error: "Nature inconnue." });
    ajoute(req.query.nature, "i.nature = ?");
  }
  if (req.query.actif === "true" || req.query.actif === "false") ajoute(req.query.actif === "true", "i.actif = ?");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await query(`${LIGNE} ${where} ORDER BY i.nom, i.prenom, i.id LIMIT 500`, params);
  res.json({ intervenants: rows.map((i) => projeterIntervenant(i, admin)), total: rows.length });
}));

router.get("/intervenants/:id", requireAuth, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'intervenant invalide." });
  const { rows: [i] } = await query(`${LIGNE} WHERE i.id = $1`, [id]);
  if (!i) return res.status(404).json({ error: "Intervenant introuvable." });
  if (!estAdmin(req.user)) return res.json({ intervenant: projeterIntervenant(i, false) });
  // Historique des interventions (sessions et groupes), conservé même inactif.
  const { rows: sessions } = await query(
    `SELECT s.id, s.reference, s.date_debut, s.date_fin, f.intitule AS formation,
            COALESCE((SELECT json_agg(g.nom ORDER BY g.nom) FROM intervenants_groupes ig JOIN groupes g ON g.id = ig.groupe_id
                      WHERE ig.intervenant_id = $1 AND g.session_id = s.id), '[]'::json) AS groupes
     FROM sessions s JOIN formations f ON f.id = s.formation_id
     WHERE s.id IN (SELECT session_id FROM intervenants_sessions WHERE intervenant_id = $1
                    UNION SELECT g.session_id FROM intervenants_groupes ig JOIN groupes g ON g.id = ig.groupe_id WHERE ig.intervenant_id = $1)
     ORDER BY s.date_debut DESC, s.id DESC`, [id]);
  res.json({ intervenant: i, sessions });
}));

router.post("/intervenants", requireAdmin, wrap(async (req, res) => {
  const { champs, erreur } = champsIntervenant(req.body || {}, { creation: true });
  if (erreur) return res.status(400).json({ error: erreur });
  const lf = lireFormations(req.body || {});
  if (lf.erreur) return res.status(400).json({ error: lf.erreur });
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const ef = await verifierFormations(cx, lf.ids);
    if (ef) { await cx.query("ROLLBACK"); return res.status(400).json({ error: ef }); }
    const cols = [...Object.keys(champs), "cree_par"];
    const vals = [...Object.values(champs), req.user.id];
    const { rows: [i] } = await cx.query(
      `INSERT INTO intervenants (${cols.join(", ")}) VALUES (${cols.map((_, k) => `$${k + 1}`).join(", ")}) RETURNING id`, vals);
    await remplacerFormations(cx, i.id, lf.ids ?? []);
    await cx.query("COMMIT");
    const { rows: [cree] } = await query(`${LIGNE} WHERE i.id = $1`, [i.id]);
    res.status(201).json({ intervenant: cree });
  } catch (e) {
    await cx.query("ROLLBACK");
    if (e.code === "23505") return res.status(409).json({ error: MSG_EMAIL_PRIS });
    throw e;
  } finally { cx.release(); }
}));

router.patch("/intervenants/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'intervenant invalide." });
  const { champs, erreur } = champsIntervenant(req.body || {});
  if (erreur) return res.status(400).json({ error: erreur });
  const lf = lireFormations(req.body || {});
  if (lf.erreur) return res.status(400).json({ error: lf.erreur });
  if (!Object.keys(champs).length && lf.ids === undefined) return res.status(400).json({ error: "Rien à modifier." });
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [avant] } = await cx.query("SELECT id FROM intervenants WHERE id = $1 FOR UPDATE", [id]);
    if (!avant) { await cx.query("ROLLBACK"); return res.status(404).json({ error: "Intervenant introuvable." }); }
    const ef = await verifierFormations(cx, lf.ids);
    if (ef) { await cx.query("ROLLBACK"); return res.status(400).json({ error: ef }); }
    if (Object.keys(champs).length) {
      const params = [id];
      const sets = Object.keys(champs).map((c) => { params.push(champs[c]); return `${c} = $${params.length}`; });
      await cx.query(`UPDATE intervenants SET ${sets.join(", ")} WHERE id = $1`, params);
    }
    await remplacerFormations(cx, id, lf.ids);
    await cx.query("COMMIT");
    const { rows: [i] } = await query(`${LIGNE} WHERE i.id = $1`, [id]);
    res.json({ intervenant: i });
  } catch (e) {
    await cx.query("ROLLBACK");
    if (e.code === "23505") return res.status(409).json({ error: MSG_EMAIL_PRIS });
    throw e;
  } finally { cx.release(); }
}));

// ── Rattachements d'une session et de ses groupes ─────────────

const RATTACHES = (table, cle) => `SELECT l.${cle} AS cible, i.id, i.civilite, i.nom, i.prenom, i.fonction, i.domaines, i.actif, i.email, i.nature
  FROM ${table} l JOIN intervenants i ON i.id = l.intervenant_id
  WHERE l.${cle} = ANY($1::int[]) ORDER BY i.nom, i.prenom, i.id`;

// Intervenants d'une session et de ses groupes, avec les textes
// historiques (conservés, jamais réécrits), en deux requêtes.
export async function intervenantsDeSession(sessionId, admin) {
  const { rows: [session] } = await query("SELECT id, formateur, archivee_le FROM sessions WHERE id = $1", [sessionId]);
  if (!session) return null;
  const { rows: groupes } = await query("SELECT id, nom, formateur FROM groupes WHERE session_id = $1 ORDER BY nom", [sessionId]);
  const [{ rows: ls }, { rows: lg }] = await Promise.all([
    query(RATTACHES("intervenants_sessions", "session_id"), [[sessionId]]),
    query(RATTACHES("intervenants_groupes", "groupe_id"), [groupes.map((g) => g.id)]),
  ]);
  const proj = (r) => { const { cible, ...i } = r; return projeterIntervenant(i, admin); };
  return {
    archivee: !!session.archivee_le,
    historique: { session: session.formateur || null, groupes: groupes.map((g) => ({ id: g.id, nom: g.nom, formateur: g.formateur || null })) },
    session: ls.map(proj),
    groupes: Object.fromEntries(groupes.map((g) => [g.id, lg.filter((r) => r.cible === g.id).map(proj)])),
  };
}

router.get("/sessions/:id/intervenants", requireAuth, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de session invalide." });
  const r = await intervenantsDeSession(id, estAdmin(req.user));
  if (!r) return res.status(404).json({ error: "Session introuvable." });
  res.json(r);
}));

// Garde commune : session existante et active, groupe de CETTE session,
// intervenant existant (et actif pour un NOUVEAU rattachement).
async function cibleRattachement(req, res, { avecGroupe, nouvel }) {
  const sessionId = parseIdPositif(req.params.id);
  const groupeId = avecGroupe ? parseIdPositif(req.params.groupeId) : null;
  const intervenantId = parseIdPositif(nouvel ? req.body?.intervenant_id : req.params.intervenantId);
  if (!sessionId || (avecGroupe && !groupeId)) { res.status(400).json({ error: "Identifiant invalide." }); return null; }
  if (!intervenantId) { res.status(400).json({ error: "Choisissez un intervenant de l'annuaire." }); return null; }
  const { rows: [s] } = await query("SELECT id, archivee_le FROM sessions WHERE id = $1", [sessionId]);
  if (!s) { res.status(404).json({ error: "Session introuvable." }); return null; }
  if (s.archivee_le) { res.status(409).json({ error: MSG_ARCHIVEE }); return null; }
  if (avecGroupe) {
    const { rowCount } = await query("SELECT 1 FROM groupes WHERE id = $1 AND session_id = $2", [groupeId, sessionId]);
    if (!rowCount) { res.status(404).json({ error: "Ce groupe n'appartient pas à la session." }); return null; }
  }
  const { rows: [i] } = await query("SELECT id, actif FROM intervenants WHERE id = $1", [intervenantId]);
  if (!i) { res.status(404).json({ error: "Intervenant introuvable." }); return null; }
  if (nouvel && !i.actif) { res.status(400).json({ error: "Cet intervenant est inactif : réactivez sa fiche avant de le rattacher." }); return null; }
  return { sessionId, groupeId, intervenantId };
}

router.post("/sessions/:id/intervenants", requireAdmin, wrap(async (req, res) => {
  const c = await cibleRattachement(req, res, { avecGroupe: false, nouvel: true });
  if (!c) return;
  const r = await query("INSERT INTO intervenants_sessions (intervenant_id, session_id, cree_par) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [c.intervenantId, c.sessionId, req.user.id]);
  if (!r.rowCount) return res.status(409).json({ error: "Cet intervenant est déjà rattaché à la session." });
  res.status(201).json(await intervenantsDeSession(c.sessionId, true));
}));

router.delete("/sessions/:id/intervenants/:intervenantId", requireAdmin, wrap(async (req, res) => {
  const c = await cibleRattachement(req, res, { avecGroupe: false, nouvel: false });
  if (!c) return;
  const r = await query("DELETE FROM intervenants_sessions WHERE intervenant_id = $1 AND session_id = $2", [c.intervenantId, c.sessionId]);
  if (!r.rowCount) return res.status(404).json({ error: "Cet intervenant n'est pas rattaché à la session." });
  res.json(await intervenantsDeSession(c.sessionId, true));
}));

router.post("/sessions/:id/groupes/:groupeId/intervenants", requireAdmin, wrap(async (req, res) => {
  const c = await cibleRattachement(req, res, { avecGroupe: true, nouvel: true });
  if (!c) return;
  const r = await query("INSERT INTO intervenants_groupes (intervenant_id, groupe_id, cree_par) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [c.intervenantId, c.groupeId, req.user.id]);
  if (!r.rowCount) return res.status(409).json({ error: "Cet intervenant est déjà rattaché au groupe." });
  res.status(201).json(await intervenantsDeSession(c.sessionId, true));
}));

router.delete("/sessions/:id/groupes/:groupeId/intervenants/:intervenantId", requireAdmin, wrap(async (req, res) => {
  const c = await cibleRattachement(req, res, { avecGroupe: true, nouvel: false });
  if (!c) return;
  const r = await query("DELETE FROM intervenants_groupes WHERE intervenant_id = $1 AND groupe_id = $2", [c.intervenantId, c.groupeId]);
  if (!r.rowCount) return res.status(404).json({ error: "Cet intervenant n'est pas rattaché au groupe." });
  res.json(await intervenantsDeSession(c.sessionId, true));
}));

export default router;
