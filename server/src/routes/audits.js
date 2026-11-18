// ─────────────────────────────────────────────────────────────
//  Préparation et simulation d'audit (CDC §33) + portail auditeur en lecture seule.
//  - Une campagne fige le référentiel actif ; chaque indicateur reçoit une appréciation interne et une
//    observation ; Vigie calcule les signaux factuels (preuves, preuves périmées ou à confirmer, actions ouvertes).
//  - Échantillon de sessions tracé (choix manuel ou tirage aléatoire daté).
//  - Export ZIP : index HTML lisible + CSV, SANS donnée nominative de stagiaire (minimisation), preuves
//    confidentielles exclues. Chaque export est journalisé.
//  - Portail auditeur : seulement les campagnes partagées, sans appréciation interne ni donnée personnelle.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import crypto from "node:crypto";
import { getPool, query } from "../db.js";
import { requireAdmin, requireAuth } from "../session.js";
import { parseIdPositif } from "../services/ids.js";
import { estDateValide } from "../services/dates.js";
import { journaliser } from "../services/journal.js";
import { creerZip, csv, echapperHtml } from "../services/zip.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const TYPES_AUDIT = { initial: "Audit initial", surveillance: "Audit de surveillance", renouvellement: "Audit de renouvellement", audit_blanc: "Audit blanc", interne: "Audit interne" };
export const STATUTS_CAMPAGNE = { preparation: "En préparation", prete: "Prête", realisee: "Réalisée", archivee: "Archivée" };
export const APPRECIATIONS = { non_evalue: "Non évalué", conforme: "Conforme", a_ameliorer: "À améliorer", non_conforme: "Non conforme", non_applicable: "Non applicable" };

function lireCampagne(corps, { complet }) {
  const c = corps && typeof corps === "object" ? corps : {};
  const v = {};
  const texte = (cle, libelle, max, requis = false) => {
    if (c[cle] === undefined) { if (complet && requis) return `${libelle} : champ obligatoire.`; return null; }
    if (c[cle] !== null && typeof c[cle] !== "string") return `${libelle} : texte attendu.`;
    const t = (c[cle] || "").trim();
    if (requis && !t) return `${libelle} : champ obligatoire.`;
    if (t.length > max) return `${libelle} : ${max} caractères au plus.`;
    v[cle] = t || null; return null;
  };
  const erreur = texte("titre", "Intitulé", 200, true) || texte("organisme_certificateur", "Organisme certificateur", 200)
    || texte("perimetre", "Périmètre", 2000) || texte("synthese", "Synthèse", 8000);
  if (erreur) return { erreur };
  if (c.type !== undefined) { if (!Object.hasOwn(TYPES_AUDIT, c.type)) return { erreur: "Type d'audit inconnu." }; v.type = c.type; }
  if (c.statut !== undefined) { if (complet || !Object.hasOwn(STATUTS_CAMPAGNE, c.statut)) return { erreur: "Statut inconnu." }; v.statut = c.statut; }
  if (c.date_audit !== undefined) {
    const d = c.date_audit === null ? "" : String(c.date_audit);
    if (d && !estDateValide(d)) return { erreur: "Date d'audit invalide : format attendu AAAA-MM-JJ." };
    v.date_audit = d || null;
  }
  if (c.partage_auditeur !== undefined) { if (complet) return { erreur: "Le partage se décide après la création." }; v.partage_auditeur = c.partage_auditeur === true; }
  return { valeur: v };
}

// Indicateurs d'une campagne avec les signaux factuels calculés (une requête).
async function indicateursCampagne(id) {
  const { rows } = await query(
    `SELECT ci.indicateur_id, i.numero, i.libelle, c.numero AS critere, ci.appreciation, ci.observation, ci.evalue_le, u.nom AS evalue_par_nom,
            (SELECT count(*)::int FROM preuves p WHERE p.indicateur_id = i.id) AS nb_preuves,
            (SELECT count(*)::int FROM preuves p WHERE p.indicateur_id = i.id AND p.statut = 'valide' AND NOT p.a_confirmer) AS nb_preuves_valides,
            (SELECT count(*)::int FROM preuves p WHERE p.indicateur_id = i.id AND (p.statut IN ('expiree','obsolete','a_reviser') OR p.date_echeance < CURRENT_DATE)) AS nb_preuves_a_actualiser,
            (SELECT count(*)::int FROM preuves p WHERE p.indicateur_id = i.id AND p.a_confirmer) AS nb_preuves_a_confirmer,
            (SELECT count(*)::int FROM actions_qualite_indicateurs ai JOIN actions_qualite a ON a.id = ai.action_id
              WHERE ai.indicateur_id = i.id AND a.statut NOT IN ('cloturee','annulee')) AS nb_actions_ouvertes
     FROM campagne_indicateurs ci JOIN indicateurs i ON i.id = ci.indicateur_id LEFT JOIN criteres c ON c.id = i.critere_id
     LEFT JOIN utilisateurs u ON u.id = ci.evalue_par WHERE ci.campagne_id = $1 ORDER BY i.numero`, [id]);
  return rows.map((r) => ({ ...r, signaux: signaux(r) }));
}

// Signaux explicables (CDC §28 : une preuve simplement rattachée ne suffit pas à déclarer un indicateur conforme).
export function signaux(r) {
  if (r.appreciation === "non_applicable") return [];
  const s = [];
  if (r.nb_preuves === 0) s.push("Aucune preuve rattachée");
  else if (r.nb_preuves_valides === 0) s.push("Aucune preuve validée");
  if (r.nb_preuves_a_actualiser > 0) s.push(`${r.nb_preuves_a_actualiser} preuve(s) à actualiser`);
  if (r.nb_preuves_a_confirmer > 0) s.push(`${r.nb_preuves_a_confirmer} preuve(s) à confirmer`);
  if (r.nb_actions_ouvertes > 0) s.push(`${r.nb_actions_ouvertes} action(s) d'amélioration ouverte(s)`);
  return s;
}

async function echantillon(id) {
  const { rows } = await query(
    `SELECT e.session_id, e.motif, e.ajoute_le, s.reference, s.date_debut, s.date_fin, s.statut, f.intitule,
            (SELECT count(*)::int FROM inscriptions i WHERE i.session_id = s.id AND i.statut <> 'abandon') AS inscrits
     FROM campagne_echantillon e JOIN sessions s ON s.id = e.session_id LEFT JOIN formations f ON f.id = s.formation_id
     WHERE e.campagne_id = $1 ORDER BY s.date_debut DESC`, [id]);
  return rows;
}

const campagneParId = async (id) => (await query(
  `SELECT c.*, v.code AS referentiel_code, v.libelle AS referentiel_libelle FROM campagnes_audit c
   LEFT JOIN referentiel_versions v ON v.id = c.referentiel_version_id WHERE c.id = $1`, [id])).rows[0] || null;

router.get("/campagnes-audit", requireAdmin, wrap(async (_req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.titre, c.type, c.date_audit, c.statut, c.partage_auditeur, c.cree_le,
            count(ci.*)::int AS indicateurs, count(ci.*) FILTER (WHERE ci.appreciation = 'conforme')::int AS conformes,
            count(ci.*) FILTER (WHERE ci.appreciation IN ('a_ameliorer','non_conforme'))::int AS a_traiter,
            count(ci.*) FILTER (WHERE ci.appreciation = 'non_evalue')::int AS non_evalues
     FROM campagnes_audit c LEFT JOIN campagne_indicateurs ci ON ci.campagne_id = c.id
     GROUP BY c.id ORDER BY (c.statut = 'archivee'), c.date_audit DESC NULLS LAST, c.id DESC`);
  res.json({ campagnes: rows, types: TYPES_AUDIT, statuts: STATUTS_CAMPAGNE, appreciations: APPRECIATIONS });
}));

router.post("/campagnes-audit", requireAdmin, wrap(async (req, res) => {
  const l = lireCampagne(req.body, { complet: true });
  if (l.erreur) return res.status(400).json({ error: l.erreur });
  const { rows: [version] } = await query("SELECT id FROM referentiel_versions WHERE est_active");
  if (!version) return res.status(409).json({ error: "Aucun référentiel actif : activez une version avant de préparer un audit." });
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const v = { type: "audit_blanc", ...l.valeur };
    const cols = Object.keys(v);
    const { rows: [c] } = await cx.query(
      `INSERT INTO campagnes_audit (${[...cols, "referentiel_version_id", "cree_par"].join(", ")}) VALUES (${[...cols, 1, 2].map((_, i) => "$" + (i + 1)).join(", ")}) RETURNING id`,
      [...cols.map((k) => v[k]), version.id, req.user.id]);
    await cx.query(
      `INSERT INTO campagne_indicateurs (campagne_id, indicateur_id, appreciation)
       SELECT $1, i.id, CASE WHEN na.indicateur_id IS NULL THEN 'non_evalue' ELSE 'non_applicable' END
       FROM indicateurs i LEFT JOIN indicateurs_non_applicables na ON na.indicateur_id = i.id WHERE i.version_id = $2`, [c.id, version.id]);
    await cx.query("INSERT INTO historique_qualite (entite_type, entite_id, evenement, par) VALUES ('campagne_audit', $1, 'creation', $2)", [c.id, req.user.id]);
    await cx.query("COMMIT");
    res.status(201).json({ campagne: await campagneParId(c.id) });
  } catch (e) { await cx.query("ROLLBACK").catch(() => {}); throw e; } finally { cx.release(); }
}));

router.get("/campagnes-audit/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const campagne = await campagneParId(id);
  if (!campagne) return res.status(404).json({ error: "Campagne introuvable." });
  res.json({ campagne, indicateurs: await indicateursCampagne(id), echantillon: await echantillon(id), types: TYPES_AUDIT, statuts: STATUTS_CAMPAGNE, appreciations: APPRECIATIONS });
}));

router.patch("/campagnes-audit/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const l = lireCampagne(req.body, { complet: false });
  if (l.erreur) return res.status(400).json({ error: l.erreur });
  const cols = Object.keys(l.valeur);
  if (!cols.length) return res.status(400).json({ error: "Rien à modifier." });
  const { rowCount } = await query(`UPDATE campagnes_audit SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, mis_a_jour_le = now() WHERE id = $1`,
    [id, ...cols.map((c) => l.valeur[c])]);
  if (!rowCount) return res.status(404).json({ error: "Campagne introuvable." });
  await query("INSERT INTO historique_qualite (entite_type, entite_id, evenement, champ, nouvelle_valeur, par) VALUES ('campagne_audit', $1, 'modification', $2, $3, $4)",
    [id, cols.join(", ").slice(0, 200), l.valeur.statut ?? (l.valeur.partage_auditeur === undefined ? null : String(l.valeur.partage_auditeur)), req.user.id]);
  if (l.valeur.partage_auditeur !== undefined) await journaliser(l.valeur.partage_auditeur ? "campagne_partagee_auditeur" : "campagne_partage_retire", { cibleType: "campagne_audit", cibleId: id, par: req.user.id });
  res.json({ campagne: await campagneParId(id) });
}));

router.delete("/campagnes-audit/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const { rowCount } = await query("DELETE FROM campagnes_audit WHERE id = $1 AND statut = 'preparation'", [id]);
  if (!rowCount) return res.status(409).json({ error: "Seule une campagne en préparation peut être supprimée ; archivez les autres." });
  res.json({ ok: true });
}));

router.put("/campagnes-audit/:id/indicateurs/:indicateurId", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id); const ind = parseIdPositif(req.params.indicateurId);
  if (!id || !ind) return res.status(400).json({ error: "Identifiant invalide." });
  const { appreciation, observation } = req.body || {};
  if (!Object.hasOwn(APPRECIATIONS, appreciation)) return res.status(400).json({ error: "Appréciation inconnue." });
  if (observation != null && (typeof observation !== "string" || observation.length > 4000)) return res.status(400).json({ error: "Observation : 4000 caractères au plus." });
  const { rows: [c] } = await query("SELECT statut FROM campagnes_audit WHERE id = $1", [id]);
  if (!c) return res.status(404).json({ error: "Campagne introuvable." });
  if (c.statut === "archivee") return res.status(409).json({ error: "Campagne archivée : consultation seule." });
  const { rowCount } = await query(
    "UPDATE campagne_indicateurs SET appreciation = $3, observation = $4, evalue_par = $5, evalue_le = now() WHERE campagne_id = $1 AND indicateur_id = $2",
    [id, ind, appreciation, observation?.trim() || null, req.user.id]);
  if (!rowCount) return res.status(404).json({ error: "Indicateur hors de cette campagne." });
  res.json({ ok: true });
}));

router.post("/campagnes-audit/:id/echantillon", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  if (!(await campagneParId(id))) return res.status(404).json({ error: "Campagne introuvable." });
  const motif = typeof req.body?.motif === "string" ? req.body.motif.trim().slice(0, 500) : null;
  if (req.body?.aleatoire) {
    const nombre = Math.min(10, parseIdPositif(req.body.nombre) || 3);
    const { rows: candidates } = await query(
      `SELECT s.id FROM sessions s WHERE s.date_debut >= CURRENT_DATE - INTERVAL '18 months' AND s.statut <> 'annulee'
       AND NOT EXISTS (SELECT 1 FROM campagne_echantillon e WHERE e.campagne_id = $1 AND e.session_id = s.id)`, [id]);
    // Tirage aléatoire cryptographique, daté dans le motif : sélection traçable (CDC §33).
    const choix = [];
    const reste = candidates.map((r) => r.id);
    while (choix.length < nombre && reste.length) choix.push(reste.splice(crypto.randomInt(reste.length), 1)[0]);
    const libelle = `Tirage aléatoire du ${new Date().toISOString().slice(0, 10)} (${choix.length} parmi ${candidates.length} sessions des 18 derniers mois)`;
    for (const s of choix) await query("INSERT INTO campagne_echantillon (campagne_id, session_id, motif, ajoute_par) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [id, s, libelle, req.user.id]);
    return res.json({ ajoutees: choix.length, echantillon: await echantillon(id) });
  }
  const session = parseIdPositif(req.body?.session_id);
  if (!session) return res.status(400).json({ error: "Session invalide." });
  if (!(await query("SELECT 1 FROM sessions WHERE id = $1", [session])).rowCount) return res.status(400).json({ error: "Session introuvable." });
  await query("INSERT INTO campagne_echantillon (campagne_id, session_id, motif, ajoute_par) VALUES ($1,$2,$3,$4) ON CONFLICT (campagne_id, session_id) DO UPDATE SET motif = EXCLUDED.motif",
    [id, session, motif || "Choix manuel", req.user.id]);
  res.json({ echantillon: await echantillon(id) });
}));

router.delete("/campagnes-audit/:id/echantillon/:sessionId", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id); const s = parseIdPositif(req.params.sessionId);
  if (!id || !s) return res.status(400).json({ error: "Identifiant invalide." });
  await query("DELETE FROM campagne_echantillon WHERE campagne_id = $1 AND session_id = $2", [id, s]);
  res.json({ echantillon: await echantillon(id) });
}));

// Plan d'action : une tâche par indicateur « à améliorer » ou « non conforme », sans doublon.
router.post("/campagnes-audit/:id/taches", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const campagne = await campagneParId(id);
  if (!campagne) return res.status(404).json({ error: "Campagne introuvable." });
  const echeance = campagne.date_audit && campagne.date_audit > new Date().toISOString().slice(0, 10) ? campagne.date_audit : null;
  const { rows } = await query(
    `SELECT ci.indicateur_id, i.numero, ci.appreciation, ci.observation FROM campagne_indicateurs ci JOIN indicateurs i ON i.id = ci.indicateur_id
     WHERE ci.campagne_id = $1 AND ci.appreciation IN ('a_ameliorer','non_conforme')
       AND NOT EXISTS (SELECT 1 FROM taches_qualite t WHERE t.statut IN ('a_faire','en_cours') AND t.origine = 'audit' AND ci.indicateur_id = ANY(t.indicateur_ids))
     ORDER BY i.numero`, [id]);
  for (const r of rows) {
    const { rows: [t] } = await query(
      `INSERT INTO taches_qualite (titre, description, echeance, priorite, origine, indicateur_ids, cree_par) VALUES ($1,$2,$3,$4,'audit',$5,$6) RETURNING id`,
      [`Indicateur ${r.numero} : ${r.appreciation === "non_conforme" ? "corriger la non-conformité" : "améliorer"} (${campagne.titre})`.slice(0, 200),
        r.observation ? r.observation.slice(0, 4000) : null, echeance, r.appreciation === "non_conforme" ? "haute" : "normale", [r.indicateur_id], req.user.id]);
    await query("INSERT INTO historique_qualite (entite_type, entite_id, evenement, par) VALUES ('tache', $1, 'creation', $2)", [t.id, req.user.id]);
  }
  res.json({ crees: rows.length });
}));

// ── Export du dossier d'audit ────────────────────────────────
async function preuvesPartageables(versionId) {
  const { rows } = await query(
    `SELECT p.id, i.numero, p.titre, p.statut, p.date_echeance, p.date_derniere_revision, p.validee_le, p.updated_at,
            (SELECT pf.drive_url FROM preuve_fichiers pf WHERE pf.preuve_id = p.id ORDER BY pf.id LIMIT 1) AS drive_url
     FROM preuves p JOIN indicateurs i ON i.id = p.indicateur_id
     WHERE i.version_id = $1 AND NOT EXISTS (SELECT 1 FROM preuves_confidentielles pc WHERE pc.preuve_id = p.id)
     ORDER BY i.numero, p.titre`, [versionId]);
  return rows;
}
const lienSur = (u) => (typeof u === "string" && /^https:\/\/(docs|drive)\.google\.com\//.test(u) ? u : null);

function htmlDossier({ campagne, indicateurs, preuves, echant, actions, organisme, interne }) {
  const parInd = new Map();
  for (const p of preuves) { if (!parInd.has(p.numero)) parInd.set(p.numero, []); parInd.get(p.numero).push(p); }
  const ligne = (r) => {
    const ps = parInd.get(r.numero) || [];
    return `<section><h3>Indicateur ${r.numero}${r.critere ? ` <small>(critère ${r.critere})</small>` : ""}</h3><p>${echapperHtml(r.libelle)}</p>
      ${interne ? `<p><strong>Appréciation interne :</strong> ${APPRECIATIONS[r.appreciation]}${r.observation ? ` — ${echapperHtml(r.observation)}` : ""}</p>
      ${r.signaux?.length ? `<p class="alerte">${r.signaux.map(echapperHtml).join(" · ")}</p>` : ""}` : ""}
      ${ps.length ? `<ul>${ps.map((p) => `<li>${lienSur(p.drive_url) ? `<a href="${echapperHtml(lienSur(p.drive_url))}">${echapperHtml(p.titre)}</a>` : echapperHtml(p.titre)}${p.date_derniere_revision ? ` — révisée le ${echapperHtml(String(p.date_derniere_revision).slice(0, 10))}` : ""}</li>`).join("")}</ul>` : "<p><em>Aucune preuve rattachée.</em></p>"}</section>`;
  };
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${echapperHtml(campagne.titre)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#1b2b34}h1{color:#1f4e79}section{border-top:1px solid #ddd;padding:.5rem 0}small{color:#666}.alerte{color:#9a3412}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left;font-size:.9rem}</style></head><body>
<h1>${echapperHtml(campagne.titre)}</h1>
<p>${echapperHtml(organisme?.nom || "")}${organisme?.nda ? ` — NDA ${echapperHtml(organisme.nda)}` : ""}${organisme?.siret ? ` — SIRET ${echapperHtml(organisme.siret)}` : ""}</p>
<p>${echapperHtml(TYPES_AUDIT[campagne.type] || campagne.type)}${campagne.date_audit ? ` prévu le ${echapperHtml(String(campagne.date_audit).slice(0, 10))}` : ""}${campagne.organisme_certificateur ? ` — ${echapperHtml(campagne.organisme_certificateur)}` : ""} — référentiel ${echapperHtml(campagne.referentiel_code || "")}</p>
${campagne.perimetre ? `<p><strong>Périmètre :</strong> ${echapperHtml(campagne.perimetre)}</p>` : ""}
${interne && campagne.synthese ? `<p><strong>Synthèse :</strong> ${echapperHtml(campagne.synthese)}</p>` : ""}
<h2>Échantillon de sessions</h2>${echant.length ? `<table><tr><th>Session</th><th>Formation</th><th>Dates</th><th>Inscrits</th><th>Motif</th></tr>${echant.map((s) => `<tr><td>${echapperHtml(s.reference || "")}</td><td>${echapperHtml(s.intitule || "")}</td><td>${echapperHtml(String(s.date_debut).slice(0, 10))} → ${echapperHtml(String(s.date_fin).slice(0, 10))}</td><td>${s.inscrits}</td><td>${echapperHtml(s.motif || "")}</td></tr>`).join("")}</table>` : "<p><em>Aucune session sélectionnée.</em></p>"}
<h2>Actions d'amélioration</h2>${actions.length ? `<ul>${actions.map((a) => `<li>${echapperHtml(a.reference)} — ${echapperHtml(a.titre)} (${echapperHtml(a.statut)})</li>`).join("")}</ul>` : "<p><em>Aucune action.</em></p>"}
<h2>Indicateurs et preuves</h2>${indicateurs.filter((r) => r.appreciation !== "non_applicable").map(ligne).join("")}
<h2>Indicateurs non applicables</h2><p>${indicateurs.filter((r) => r.appreciation === "non_applicable").map((r) => r.numero).join(", ") || "Aucun."}</p>
<p><small>Dossier produit par Vigie Qualiopi le ${new Date().toISOString().slice(0, 10)}. Les preuves sont consultables via leurs liens Google Drive (droits d'accès Drive requis). Ce dossier ne contient aucune donnée nominative de stagiaire.</small></p>
</body></html>`;
}

async function actionsResume() {
  const { rows } = await query(`SELECT reference, titre, statut, echeance, date_cloture FROM actions_qualite WHERE statut <> 'annulee' ORDER BY created_at DESC LIMIT 200`);
  return rows;
}

router.get("/campagnes-audit/:id/export", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const campagne = await campagneParId(id);
  if (!campagne) return res.status(404).json({ error: "Campagne introuvable." });
  const [indicateurs, echant, preuves, actions, { rows: [organisme] }] = await Promise.all([
    indicateursCampagne(id), echantillon(id), preuvesPartageables(campagne.referentiel_version_id), actionsResume(),
    query("SELECT nom, nda, siret FROM parametres_organisme WHERE id = 1"),
  ]);
  const zip = creerZip([
    { nom: "index.html", contenu: htmlDossier({ campagne, indicateurs, preuves, echant, actions, organisme, interne: true }) },
    { nom: "indicateurs.csv", contenu: csv(["Indicateur", "Critère", "Libellé", "Appréciation", "Observation", "Preuves", "Preuves validées", "À actualiser", "À confirmer", "Actions ouvertes", "Signaux"],
      indicateurs.map((r) => [r.numero, r.critere, r.libelle, APPRECIATIONS[r.appreciation], r.observation, r.nb_preuves, r.nb_preuves_valides, r.nb_preuves_a_actualiser, r.nb_preuves_a_confirmer, r.nb_actions_ouvertes, r.signaux.join(" ; ")])) },
    { nom: "preuves.csv", contenu: csv(["Indicateur", "Preuve", "Statut", "Échéance", "Dernière révision", "Validée le", "Lien"],
      preuves.map((p) => [p.numero, p.titre, p.statut, p.date_echeance, p.date_derniere_revision, p.validee_le ? String(p.validee_le).slice(0, 10) : "", lienSur(p.drive_url) || ""])) },
    { nom: "echantillon.csv", contenu: csv(["Session", "Formation", "Début", "Fin", "Inscrits", "Motif"], echant.map((s) => [s.reference, s.intitule, s.date_debut, s.date_fin, s.inscrits, s.motif])) },
    { nom: "actions.csv", contenu: csv(["Référence", "Action", "Statut", "Échéance", "Clôture"], actions.map((a) => [a.reference, a.titre, a.statut, a.echeance, a.date_cloture])) },
  ]);
  await journaliser("export_dossier_audit", { detail: `campagne ${id}`, cibleType: "campagne_audit", cibleId: id, par: req.user.id });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="dossier-audit-${id}.zip"`);
  res.send(zip);
}));

// ── Portail auditeur (lecture seule, campagnes partagées) ────
const lecteurAudit = (req, res, next) => (["auditeur", "admin"].includes(req.user?.role) ? next() : res.status(403).json({ error: "Accès réservé." }));

router.get("/portail-audit/campagnes", requireAuth, lecteurAudit, wrap(async (_req, res) => {
  const { rows } = await query("SELECT id, titre, type, date_audit, organisme_certificateur FROM campagnes_audit WHERE partage_auditeur AND statut <> 'archivee' ORDER BY date_audit DESC NULLS LAST, id DESC");
  res.json({ campagnes: rows, types: TYPES_AUDIT });
}));

router.get("/portail-audit/campagnes/:id", requireAuth, lecteurAudit, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const campagne = await campagneParId(id);
  if (!campagne || !campagne.partage_auditeur || campagne.statut === "archivee") return res.status(404).json({ error: "Dossier introuvable." });
  const [indicateurs, echant, preuves, actions, { rows: [organisme] }] = await Promise.all([
    indicateursCampagne(id), echantillon(id), preuvesPartageables(campagne.referentiel_version_id), actionsResume(),
    query("SELECT nom, nda, siret FROM parametres_organisme WHERE id = 1"),
  ]);
  if (req.user.role === "auditeur") await journaliser("consultation_portail_audit", { cibleType: "campagne_audit", cibleId: id, par: req.user.id });
  // Ni appréciation interne, ni observation, ni signal : seulement le référentiel, les preuves et l'échantillon.
  res.json({
    campagne: { id: campagne.id, titre: campagne.titre, type: campagne.type, date_audit: campagne.date_audit, organisme_certificateur: campagne.organisme_certificateur, perimetre: campagne.perimetre, referentiel_code: campagne.referentiel_code },
    organisme: organisme || {},
    indicateurs: indicateurs.map((r) => ({ numero: r.numero, critere: r.critere, libelle: r.libelle, non_applicable: r.appreciation === "non_applicable",
      preuves: preuves.filter((p) => p.numero === r.numero).map((p) => ({ titre: p.titre, lien: lienSur(p.drive_url), date_derniere_revision: p.date_derniere_revision })) })),
    echantillon: echant.map((s) => ({ reference: s.reference, intitule: s.intitule, date_debut: s.date_debut, date_fin: s.date_fin, inscrits: s.inscrits })),
    actions: actions.map((a) => ({ reference: a.reference, titre: a.titre, statut: a.statut })),
    types: TYPES_AUDIT,
  });
}));

export default router;
