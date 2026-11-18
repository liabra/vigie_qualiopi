// ─────────────────────────────────────────────────────────────
//  API des registres de pilotage (tâches, risques, partenaires, ressources) + échéancier + création de tâches
//  depuis les manques de preuves. Droits : lecture administrateur et contributeur ; écriture selon le registre
//  (tâches : contributeur aussi ; autres : administrateur). Toute modification est historisée.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { getPool, query } from "../db.js";
import { requireAdmin, requireRedacteur } from "../session.js";
import { parseIdPositif } from "../services/ids.js";
import { REGISTRES, prochaineEcheance, schemaPublic, validerFiche } from "../services/registres.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function definition(req, res) {
  const d = REGISTRES[req.params.nom];
  if (!d) { res.status(404).json({ error: "Registre inconnu." }); return null; }
  return d;
}
const peutEcrire = (d, user) => user.role === "admin" || (d.ecriture === "redacteur" && user.role === "contributeur");

// Colonnes SQL lues : celles de la définition (liste blanche) + méta.
function selectFiches(d, where = "", ordre = d.tri) {
  const cols = d.champs.filter((c) => c.type !== "indicateurs").map((c) => `t.${c.nom}`).join(", ");
  const avecResp = d.champs.some((c) => c.nom === "responsable_id") ? "t.responsable_id" : d.champs.some((c) => c.nom === "referent_id") ? "t.referent_id" : "NULL";
  return `SELECT t.id, ${cols}, t.indicateur_ids, t.cree_le, t.mis_a_jour_le, u.nom AS responsable_nom,
            COALESCE((SELECT array_agg(i.numero ORDER BY i.numero) FROM indicateurs i WHERE i.id = ANY(t.indicateur_ids)), '{}') AS indicateurs
          FROM ${d.table} t LEFT JOIN utilisateurs u ON u.id = ${avecResp} ${where} ORDER BY ${ordre}`;
}

// Numéros d'indicateurs → identifiants dans le référentiel ACTIF. Numéro inconnu = erreur explicite.
async function idsIndicateurs(numeros) {
  if (!numeros?.length) return [];
  const { rows } = await query(
    `SELECT i.id, i.numero FROM indicateurs i JOIN referentiel_versions v ON v.id = i.version_id AND v.est_active WHERE i.numero = ANY($1::int[])`, [numeros]);
  if (rows.length !== numeros.length) return null;
  return rows.map((r) => r.id);
}

// Références vérifiées avant écriture (jamais une erreur SQL de clé étrangère renvoyée telle quelle).
const TABLES_REF = { utilisateur: "utilisateurs", formation: "formations", action: "actions_qualite", preuve: "preuves" };
async function controlerReferences(d, valeur) {
  for (const c of d.champs) {
    const table = TABLES_REF[c.type];
    if (!table || valeur[c.nom] == null) continue;
    const { rowCount } = await query(`SELECT 1 FROM ${table} WHERE id = $1`, [valeur[c.nom]]);
    if (!rowCount) return `${c.libelle} : introuvable.`;
  }
  return null;
}

async function historiser(cx, d, id, evenement, par, changements = []) {
  if (!changements.length) {
    await cx.query("INSERT INTO historique_qualite (entite_type, entite_id, evenement, par) VALUES ($1,$2,$3,$4)", [d.entite, id, evenement, par]);
    return;
  }
  for (const [champ, avant, apres] of changements) {
    await cx.query("INSERT INTO historique_qualite (entite_type, entite_id, evenement, champ, ancienne_valeur, nouvelle_valeur, par) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [d.entite, id, evenement, champ, avant == null ? null : String(avant).slice(0, 500), apres == null ? null : String(apres).slice(0, 500), par]);
  }
}

router.get("/registres/:nom/schema", requireRedacteur, (req, res) => {
  const s = schemaPublic(req.params.nom);
  if (!s) return res.status(404).json({ error: "Registre inconnu." });
  res.json({ schema: s });
});

router.get("/registres/:nom", requireRedacteur, wrap(async (req, res) => {
  const d = definition(req, res); if (!d) return;
  const conditions = []; const params = [];
  const filtre = d.champs.find((c) => c.nom === "statut");
  if (req.query.statut === "ouverts") { params.push(d.statutsOuverts); conditions.push(`t.statut = ANY($${params.length}::text[])`); }
  else if (req.query.statut && filtre?.valeurs.includes(req.query.statut)) { params.push(req.query.statut); conditions.push(`t.statut = $${params.length}`); }
  if (req.query.responsable === "moi" && d.champs.some((c) => c.nom === "responsable_id")) { params.push(req.user.id); conditions.push(`t.responsable_id = $${params.length}`); }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const { rows } = await query(selectFiches(d, where), params);
  res.json({ fiches: rows, total: rows.length, ecriture: peutEcrire(d, req.user) });
}));

router.get("/registres/:nom/:id", requireRedacteur, wrap(async (req, res) => {
  const d = definition(req, res); if (!d) return;
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const { rows: [f] } = await query(selectFiches(d, "WHERE t.id = $1", "t.id"), [id]);
  if (!f) return res.status(404).json({ error: "Fiche introuvable." });
  const { rows: historique } = await query(
    `SELECT h.evenement, h.champ, h.ancienne_valeur, h.nouvelle_valeur, h.cree_le, u.nom AS par_nom
     FROM historique_qualite h LEFT JOIN utilisateurs u ON u.id = h.par WHERE h.entite_type = $1 AND h.entite_id = $2 ORDER BY h.cree_le DESC, h.id DESC LIMIT 100`, [d.entite, id]);
  res.json({ fiche: f, historique, ecriture: peutEcrire(d, req.user) });
}));

router.post("/registres/:nom", requireRedacteur, wrap(async (req, res) => {
  const d = definition(req, res); if (!d) return;
  if (!peutEcrire(d, req.user)) return res.status(403).json({ error: "Réservé aux administrateurs." });
  const v = validerFiche(req.params.nom, req.body, { complet: true });
  if (v.erreur) return res.status(400).json({ error: v.erreur });
  const refus = await controlerReferences(d, v.valeur);
  if (refus) return res.status(400).json({ error: refus });
  const ids = await idsIndicateurs(v.indicateurs);
  if (ids === null) return res.status(400).json({ error: "Indicateur inconnu dans le référentiel actif." });
  if (d.table === "taches_qualite" && v.valeur.statut === "faite") v.valeur.faite_le = new Date().toISOString().slice(0, 10);
  const cols = Object.keys(v.valeur);
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [f] } = await cx.query(
      `INSERT INTO ${d.table} (${[...cols, "indicateur_ids", "cree_par"].join(", ")}) VALUES (${[...cols, "x", "y"].map((_, i) => "$" + (i + 1)).join(", ")}) RETURNING id`,
      [...cols.map((c) => v.valeur[c]), ids, req.user.id]);
    await historiser(cx, d, f.id, "creation", req.user.id);
    await cx.query("COMMIT");
    const { rows: [fiche] } = await query(selectFiches(d, "WHERE t.id = $1", "t.id"), [f.id]);
    res.status(201).json({ fiche });
  } catch (err) { await cx.query("ROLLBACK").catch(() => {}); throw err; } finally { cx.release(); }
}));

router.patch("/registres/:nom/:id", requireRedacteur, wrap(async (req, res) => {
  const d = definition(req, res); if (!d) return;
  if (!peutEcrire(d, req.user)) return res.status(403).json({ error: "Réservé aux administrateurs." });
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const v = validerFiche(req.params.nom, req.body, { complet: false });
  if (v.erreur) return res.status(400).json({ error: v.erreur });
  if (!Object.keys(v.valeur).length && v.indicateurs === undefined) return res.status(400).json({ error: "Rien à modifier." });
  const refus = await controlerReferences(d, v.valeur);
  if (refus) return res.status(400).json({ error: refus });
  const ids = v.indicateurs === undefined ? undefined : await idsIndicateurs(v.indicateurs);
  if (ids === null) return res.status(400).json({ error: "Indicateur inconnu dans le référentiel actif." });
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [avant] } = await cx.query(`SELECT * FROM ${d.table} WHERE id = $1 FOR UPDATE`, [id]);
    if (!avant) { await cx.query("ROLLBACK"); return res.status(404).json({ error: "Fiche introuvable." }); }
    const valeur = { ...v.valeur };
    let suivante = null;
    // Tâche terminée : date de réalisation ; récurrente avec échéance → la suivante est préparée (une seule fois).
    if (d.table === "taches_qualite" && valeur.statut && valeur.statut !== avant.statut) {
      valeur.faite_le = valeur.statut === "faite" ? new Date().toISOString().slice(0, 10) : null;
      if (valeur.statut === "faite") {
        const recurrence = valeur.recurrence ?? avant.recurrence;
        const echeance = valeur.echeance !== undefined ? valeur.echeance : avant.echeance;
        const prochaine = prochaineEcheance(echeance instanceof Date ? echeance.toISOString().slice(0, 10) : echeance, recurrence);
        const { rowCount: deja } = await cx.query("SELECT 1 FROM taches_qualite WHERE precedente_id = $1", [id]);
        if (prochaine && !deja) suivante = prochaine;
      }
    }
    const changements = [];
    const sets = []; const params = [id];
    for (const [col, val] of Object.entries(valeur)) {
      const ancien = avant[col] instanceof Date ? avant[col].toISOString().slice(0, 10) : avant[col];
      if (String(ancien ?? "") !== String(val ?? "")) changements.push([col, ancien, val]);
      params.push(val); sets.push(`${col} = $${params.length}`);
    }
    if (ids !== undefined) { params.push(ids); sets.push(`indicateur_ids = $${params.length}`); changements.push(["indicateurs", null, v.indicateurs.join(", ")]); }
    await cx.query(`UPDATE ${d.table} SET ${sets.join(", ")}, mis_a_jour_le = now() WHERE id = $1`, params);
    if (changements.length) await historiser(cx, d, id, "modification", req.user.id, changements);
    let suivanteId = null;
    if (suivante) {
      const { rows: [n] } = await cx.query(
        `INSERT INTO taches_qualite (titre, description, responsable_id, echeance, priorite, recurrence, origine, indicateur_ids, preuve_id, precedente_id, cree_par)
         SELECT titre, description, responsable_id, $2, priorite, recurrence, origine, indicateur_ids, preuve_id, id, $3 FROM taches_qualite WHERE id = $1 RETURNING id`,
        [id, suivante, req.user.id]);
      suivanteId = n.id;
      await historiser(cx, d, n.id, "creation_recurrence", req.user.id);
    }
    await cx.query("COMMIT");
    const { rows: [fiche] } = await query(selectFiches(d, "WHERE t.id = $1", "t.id"), [id]);
    res.json({ fiche, suivante_id: suivanteId });
  } catch (err) { await cx.query("ROLLBACK").catch(() => {}); throw err; } finally { cx.release(); }
}));

router.delete("/registres/:nom/:id", requireAdmin, wrap(async (req, res) => {
  const d = definition(req, res); if (!d) return;
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const { rowCount } = await query(`DELETE FROM ${d.table} WHERE id = $1`, [id]);
  if (!rowCount) return res.status(404).json({ error: "Fiche introuvable." });
  await query("INSERT INTO historique_qualite (entite_type, entite_id, evenement, par) VALUES ($1,$2,'suppression',$3)", [d.entite, id, req.user.id]);
  res.json({ ok: true });
}));

// Scénario d'acceptation « preuve manquante » (CDC §49) : une tâche par indicateur applicable sans preuve et par
// preuve dont l'échéance est dépassée, sans doublon (une tâche OUVERTE existe déjà → rien n'est créé).
router.post("/taches/depuis-manques", requireAdmin, wrap(async (req, res) => {
  const responsable = req.body?.responsable_id ? parseIdPositif(req.body.responsable_id) : null;
  if (req.body?.responsable_id && !responsable) return res.status(400).json({ error: "Responsable invalide." });
  if (responsable && !(await query("SELECT 1 FROM utilisateurs WHERE id = $1 AND actif", [responsable])).rowCount) return res.status(400).json({ error: "Responsable introuvable." });
  const echeance = (() => { const x = new Date(); x.setUTCDate(x.getUTCDate() + 30); return x.toISOString().slice(0, 10); })();
  const { rows: sansPreuve } = await query(
    `SELECT i.id, i.numero, i.libelle FROM indicateurs i JOIN referentiel_versions v ON v.id = i.version_id AND v.est_active
     WHERE NOT EXISTS (SELECT 1 FROM indicateurs_non_applicables na WHERE na.indicateur_id = i.id)
       AND NOT EXISTS (SELECT 1 FROM preuves p WHERE p.indicateur_id = i.id)
       AND NOT EXISTS (SELECT 1 FROM taches_qualite t WHERE t.statut IN ('a_faire','en_cours') AND t.origine = 'preuve_manquante' AND i.id = ANY(t.indicateur_ids))
     ORDER BY i.numero`);
  const { rows: perimees } = await query(
    `SELECT p.id, p.titre, p.indicateur_id FROM preuves p
     WHERE p.date_echeance IS NOT NULL AND p.date_echeance < CURRENT_DATE
       AND NOT EXISTS (SELECT 1 FROM taches_qualite t WHERE t.statut IN ('a_faire','en_cours') AND t.preuve_id = p.id)
     ORDER BY p.date_echeance`);
  const cx = await getPool().connect();
  let crees = 0;
  try {
    await cx.query("BEGIN");
    for (const i of sansPreuve) {
      const { rows: [t] } = await cx.query(
        `INSERT INTO taches_qualite (titre, description, responsable_id, echeance, priorite, origine, indicateur_ids, cree_par)
         VALUES ($1,$2,$3,$4,'haute','preuve_manquante',$5,$6) RETURNING id`,
        [`Apporter une preuve pour l'indicateur ${i.numero}`.slice(0, 200), `Aucune preuve n'est rattachée à l'indicateur ${i.numero} (${String(i.libelle || "").slice(0, 300)}).`, responsable, echeance, [i.id], req.user.id]);
      await historiser(cx, REGISTRES.taches, t.id, "creation", req.user.id); crees++;
    }
    for (const p of perimees) {
      const { rows: [t] } = await cx.query(
        `INSERT INTO taches_qualite (titre, responsable_id, echeance, priorite, origine, indicateur_ids, preuve_id, cree_par)
         VALUES ($1,$2,$3,'normale','preuve_a_actualiser',$4,$5,$6) RETURNING id`,
        [`Actualiser la preuve « ${String(p.titre || "").slice(0, 150)} »`, responsable, echeance, p.indicateur_id ? [p.indicateur_id] : [], p.id, req.user.id]);
      await historiser(cx, REGISTRES.taches, t.id, "creation", req.user.id); crees++;
    }
    await cx.query("COMMIT");
  } catch (err) { await cx.query("ROLLBACK").catch(() => {}); throw err; } finally { cx.release(); }
  res.json({ crees, indicateurs_sans_preuve: sansPreuve.length, preuves_a_actualiser: perimees.length });
}));

// Échéancier (CDC §32) : tout ce qui a une date dans la période, quel que soit le module. Lecture seule.
router.get("/echeancier", requireRedacteur, wrap(async (req, res) => {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const du = re.test(req.query.du || "") ? req.query.du : new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const au = re.test(req.query.au || "") ? req.query.au : new Date(Date.now() + 180 * 864e5).toISOString().slice(0, 10);
  const { rows } = await query(
    `SELECT * FROM (
       SELECT 'tache' AS type, t.id, t.titre AS libelle, t.echeance AS date, t.statut, u.nom AS responsable, '/taches' AS lien
         FROM taches_qualite t LEFT JOIN utilisateurs u ON u.id = t.responsable_id WHERE t.echeance IS NOT NULL AND t.statut IN ('a_faire','en_cours')
       UNION ALL
       SELECT 'action', a.id, a.reference || ' — ' || a.titre, a.echeance, a.statut, u.nom, '/actions-qualite/' || a.id
         FROM actions_qualite a LEFT JOIN utilisateurs u ON u.id = a.responsable_id WHERE a.echeance IS NOT NULL AND a.statut NOT IN ('cloturee','annulee')
       UNION ALL
       SELECT 'preuve', p.id, p.titre, p.date_echeance, p.statut, NULL, '/preuves' FROM preuves p WHERE p.date_echeance IS NOT NULL
       UNION ALL
       SELECT 'session', s.id, COALESCE(f.intitule, 'Session') || ' (début)', s.date_debut, s.statut, NULL, '/sessions/' || s.id
         FROM sessions s LEFT JOIN formations f ON f.id = s.formation_id WHERE s.archivee_le IS NULL
       UNION ALL
       SELECT 'session', s.id, COALESCE(f.intitule, 'Session') || ' (fin)', s.date_fin, s.statut, NULL, '/sessions/' || s.id
         FROM sessions s LEFT JOIN formations f ON f.id = s.formation_id WHERE s.archivee_le IS NULL
       UNION ALL
       SELECT 'risque', r.id, 'Réévaluer : ' || r.titre, r.date_reevaluation, r.statut, u.nom, '/risques'
         FROM risques_qualite r LEFT JOIN utilisateurs u ON u.id = r.responsable_id WHERE r.date_reevaluation IS NOT NULL AND r.statut <> 'clos'
       UNION ALL
       SELECT 'partenaire', p.id, 'Fin de convention : ' || p.nom, p.convention_fin, p.statut, NULL, '/partenaires' FROM partenaires p WHERE p.convention_fin IS NOT NULL AND p.statut = 'actif'
       UNION ALL
       SELECT 'campagne_audit', c.id, c.titre, c.date_audit, c.statut, NULL, '/preparation-audit/' || c.id FROM campagnes_audit c WHERE c.date_audit IS NOT NULL AND c.statut <> 'archivee'
     ) e WHERE e.date BETWEEN $1 AND $2 ORDER BY e.date, e.type, e.id`, [du, au]);
  const { rows: [{ retard }] } = await query(
    `SELECT (SELECT count(*) FROM taches_qualite WHERE statut IN ('a_faire','en_cours') AND echeance < CURRENT_DATE)
          + (SELECT count(*) FROM actions_qualite WHERE statut NOT IN ('cloturee','annulee','realisee','efficacite_a_verifier') AND echeance < CURRENT_DATE) AS retard`);
  res.json({ du, au, evenements: rows, en_retard: Number(retard) });
}));

export default router;
