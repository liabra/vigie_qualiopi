// ─────────────────────────────────────────────────────────────
//  Compétences et développement des intervenants (indicateurs 21 et 22) : fiche compétences, actions de
//  développement (prévues / réalisées, efficacité évaluée), plan global, exports PDF pour l'auditeur.
//  Administrateur seulement.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { query } from "../db.js";
import { requireAdmin } from "../session.js";
import { parseIdPositif } from "../services/ids.js";
import { estDateValide } from "../services/dates.js";
import { DocumentPdf, dateFr, envoyerPdf } from "../services/pdf.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const TYPES_DEVELOPPEMENT = { formation: "Formation", tutorat: "Tutorat", evenement: "Événement professionnel", autoformation: "Autoformation", analyse_pratique: "Analyse de pratique", autre: "Autre" };
export const STATUTS_DEVELOPPEMENT = { prevue: "Prévue", realisee: "Réalisée", annulee: "Annulée" };
const INTERDIT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

function texte(v, max, libelle) {
  if (v === undefined) return { absent: true };
  if (v !== null && typeof v !== "string") return { erreur: `${libelle} : texte attendu.` };
  const t = (v || "").trim();
  if (t.length > max || INTERDIT.test(t)) return { erreur: `${libelle} : ${max} caractères au plus.` };
  return { valeur: t || null };
}
function date(v, libelle) {
  if (v === undefined) return { absent: true };
  const d = v === null ? "" : String(v);
  if (d && !estDateValide(d)) return { erreur: `${libelle} : date au format AAAA-MM-JJ attendue.` };
  return { valeur: d || null };
}

export function lireAction(c = {}, { complet }) {
  const v = {};
  const champs = [["intitule", texte(c.intitule, 200, "Intitulé")], ["organisme", texte(c.organisme, 200, "Organisme")],
    ["competence_visee", texte(c.competence_visee, 500, "Compétence visée")], ["evaluation_efficacite", texte(c.evaluation_efficacite, 4000, "Évaluation de l'efficacité")],
    ["date_debut", date(c.date_debut, "Date de début")], ["date_fin", date(c.date_fin, "Date de fin")]];
  for (const [k, r] of champs) { if (r.erreur) return { erreur: r.erreur }; if (!r.absent) v[k] = r.valeur; }
  if (complet && !v.intitule) return { erreur: "Intitulé obligatoire." };
  if (v.intitule === null) return { erreur: "Intitulé obligatoire." };
  if (c.type !== undefined) { if (!Object.hasOwn(TYPES_DEVELOPPEMENT, c.type)) return { erreur: "Type inconnu." }; v.type = c.type; }
  if (c.statut !== undefined) { if (!Object.hasOwn(STATUTS_DEVELOPPEMENT, c.statut)) return { erreur: "Statut inconnu." }; v.statut = c.statut; }
  if (c.duree_heures !== undefined) {
    if (c.duree_heures === null || c.duree_heures === "") v.duree_heures = null;
    else { const n = Number(c.duree_heures); if (!Number.isFinite(n) || n < 0 || n > 2000) return { erreur: "Durée : nombre d'heures de 0 à 2000." }; v.duree_heures = Math.round(n * 10) / 10; }
  }
  if (c.lien_preuve !== undefined) {
    const l = c.lien_preuve === null ? "" : String(c.lien_preuve).trim();
    // fix : seuls les liens http(s) (jamais javascript: ou data:).
    if (l && (l.length > 500 || !/^https?:\/\/[^\s<>"]+$/i.test(l))) return { erreur: "Lien de la preuve : adresse http(s) attendue." };
    v.lien_preuve = l || null;
  }
  if (v.date_debut && v.date_fin && v.date_fin < v.date_debut) return { erreur: "La date de fin précède la date de début." };
  return { valeur: v };
}

const COLONNES_FICHE = "id, civilite, nom, prenom, fonction, nature, email, actif, specialites, diplomes_certifications, besoins_developpement, date_dernier_entretien";

async function dossierIntervenant(id) {
  const { rows: [i] } = await query(`SELECT ${COLONNES_FICHE} FROM intervenants WHERE id = $1`, [id]);
  if (!i) return null;
  const { rows: actions } = await query("SELECT * FROM developpement_intervenants WHERE intervenant_id = $1 ORDER BY COALESCE(date_debut, date_fin) DESC NULLS LAST, id DESC", [id]);
  return { intervenant: i, actions };
}

router.get("/intervenants/:id/developpement", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const d = await dossierIntervenant(id);
  if (!d) return res.status(404).json({ error: "Intervenant introuvable." });
  res.json({ ...d, types: TYPES_DEVELOPPEMENT, statuts: STATUTS_DEVELOPPEMENT });
}));

router.patch("/intervenants/:id/competences", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const c = req.body || {};
  const v = {};
  for (const [k, r] of [["specialites", texte(c.specialites, 2000, "Spécialités")], ["diplomes_certifications", texte(c.diplomes_certifications, 4000, "Diplômes et certifications")],
    ["besoins_developpement", texte(c.besoins_developpement, 4000, "Besoins de développement")], ["date_dernier_entretien", date(c.date_dernier_entretien, "Date du dernier entretien")]]) {
    if (r.erreur) return res.status(400).json({ error: r.erreur });
    if (!r.absent) v[k] = r.valeur;
  }
  const cols = Object.keys(v);
  if (!cols.length) return res.status(400).json({ error: "Rien à modifier." });
  const { rowCount } = await query(`UPDATE intervenants SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [id, ...cols.map((k) => v[k])]);
  if (!rowCount) return res.status(404).json({ error: "Intervenant introuvable." });
  res.json(await dossierIntervenant(id));
}));

router.post("/intervenants/:id/developpement", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const l = lireAction(req.body, { complet: true });
  if (l.erreur) return res.status(400).json({ error: l.erreur });
  if (!(await query("SELECT 1 FROM intervenants WHERE id = $1", [id])).rowCount) return res.status(404).json({ error: "Intervenant introuvable." });
  const cols = Object.keys(l.valeur);
  const { rows: [a] } = await query(
    `INSERT INTO developpement_intervenants (intervenant_id, cree_par, ${cols.join(", ")}) VALUES ($1, $2, ${cols.map((_, i) => "$" + (i + 3)).join(", ")}) RETURNING *`,
    [id, req.user.id, ...cols.map((k) => l.valeur[k])]);
  res.status(201).json({ action: a });
}));

router.patch("/developpement/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const l = lireAction(req.body, { complet: false });
  if (l.erreur) return res.status(400).json({ error: l.erreur });
  const cols = Object.keys(l.valeur);
  if (!cols.length) return res.status(400).json({ error: "Rien à modifier." });
  try {
    const { rows: [a] } = await query(`UPDATE developpement_intervenants SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}, mis_a_jour_le = now() WHERE id = $1 RETURNING *`,
      [id, ...cols.map((k) => l.valeur[k])]);
    if (!a) return res.status(404).json({ error: "Action introuvable." });
    res.json({ action: a });
  } catch (e) {
    if (e.code === "23514") return res.status(400).json({ error: "La date de fin précède la date de début." });
    throw e;
  }
}));

router.delete("/developpement/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const { rowCount } = await query("DELETE FROM developpement_intervenants WHERE id = $1", [id]);
  if (!rowCount) return res.status(404).json({ error: "Action introuvable." });
  res.json({ ok: true });
}));

// Plan global : toutes les actions + intervenants actifs sans entretien depuis plus d'un an ou sans action.
async function planGlobal() {
  const { rows: actions } = await query(
    `SELECT d.*, i.nom, i.prenom FROM developpement_intervenants d JOIN intervenants i ON i.id = d.intervenant_id
     ORDER BY COALESCE(d.date_debut, d.date_fin) DESC NULLS LAST, d.id DESC`);
  const { rows: intervenants } = await query(
    `SELECT i.id, i.nom, i.prenom, i.fonction, i.nature, i.date_dernier_entretien, i.besoins_developpement,
            (SELECT count(*)::int FROM developpement_intervenants d WHERE d.intervenant_id = i.id AND d.statut = 'realisee') AS realisees,
            (SELECT count(*)::int FROM developpement_intervenants d WHERE d.intervenant_id = i.id AND d.statut = 'prevue') AS prevues
     FROM intervenants i WHERE i.actif ORDER BY i.nom, i.prenom`);
  const ilYaUnAn = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  return { actions, intervenants: intervenants.map((i) => ({ ...i, entretien_a_faire: !i.date_dernier_entretien || String(i.date_dernier_entretien) < ilYaUnAn })) };
}

router.get("/developpement", requireAdmin, wrap(async (_req, res) => {
  res.json({ ...(await planGlobal()), types: TYPES_DEVELOPPEMENT, statuts: STATUTS_DEVELOPPEMENT });
}));

const organisme = async () => (await query("SELECT nom FROM parametres_organisme WHERE id = 1")).rows[0]?.nom || "";
const nomComplet = (i) => [i.prenom, i.nom].filter(Boolean).join(" ");
const FONCTIONS = { formateur: "Formateur", referent_handicap: "Référent handicap", appui: "Appui", autre: "Autre" };
const NATURES = { salarie: "Salarié", exterieur: "Intervenant extérieur", sous_traitant: "Sous-traitant", porte: "Portage salarial" };

router.get("/pdf/developpement", requireAdmin, wrap(async (_req, res) => {
  const { actions, intervenants } = await planGlobal();
  const doc = new DocumentPdf({ titre: "Plan de développement des compétences des intervenants", organisme: await organisme(), sousTitre: "Indicateurs 21 et 22 — maintien et développement des compétences" });
  doc.titre("Synthèse par intervenant");
  doc.tableau(["Intervenant", "Fonction", "Dernier entretien", "Actions réalisées", "Actions prévues", "Besoins identifiés"],
    intervenants.map((i) => [nomComplet(i), FONCTIONS[i.fonction] || i.fonction || "", dateFr(i.date_dernier_entretien) || "Non renseigné", i.realisees, i.prevues, i.besoins_developpement || ""]), [2.2, 1.6, 1.2, 1, 1, 3]);
  doc.titre("Actions de développement");
  doc.tableau(["Intervenant", "Action", "Type", "Période", "Durée", "Statut", "Efficacité"],
    actions.map((a) => [nomComplet(a), `${a.intitule}${a.organisme ? ` (${a.organisme})` : ""}`, TYPES_DEVELOPPEMENT[a.type], [dateFr(a.date_debut), dateFr(a.date_fin)].filter(Boolean).join(" → "), a.duree_heures ? `${Number(a.duree_heures)} h` : "", STATUTS_DEVELOPPEMENT[a.statut], a.evaluation_efficacite || ""]),
    [1.6, 2.6, 1.2, 1.5, 0.7, 0.9, 2.5]);
  envoyerPdf(res, doc, "plan-developpement-competences.pdf");
}));

router.get("/pdf/intervenants/:id/developpement", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const d = await dossierIntervenant(id);
  if (!d) return res.status(404).json({ error: "Intervenant introuvable." });
  const i = d.intervenant;
  const doc = new DocumentPdf({ titre: `Compétences et développement — ${nomComplet(i)}`, organisme: await organisme(), sousTitre: [FONCTIONS[i.fonction] || i.fonction, NATURES[i.nature] || i.nature].filter(Boolean).join(" — ") });
  doc.titre("Compétences");
  doc.champ("Spécialités", i.specialites).champ("Diplômes, certifications et habilitations", i.diplomes_certifications)
    .champ("Date du dernier entretien professionnel", dateFr(i.date_dernier_entretien) || "Non renseignée").champ("Besoins de développement identifiés", i.besoins_developpement);
  const { rows: justificatifs } = await query(
    `SELECT j.categorie, p.titre, p.date_echeance FROM intervenants_justificatifs j JOIN preuves p ON p.id = j.preuve_id WHERE j.intervenant_id = $1 ORDER BY j.categorie, p.titre`, [id]);
  if (justificatifs.length) {
    doc.titre("Justificatifs enregistrés");
    doc.tableau(["Catégorie", "Document", "Échéance"], justificatifs.map((j) => [j.categorie, j.titre, dateFr(j.date_echeance)]), [1, 3, 1]);
  }
  doc.titre("Actions de développement");
  doc.tableau(["Action", "Type", "Compétence visée", "Période", "Durée", "Statut", "Évaluation de l'efficacité"],
    d.actions.map((a) => [`${a.intitule}${a.organisme ? ` (${a.organisme})` : ""}`, TYPES_DEVELOPPEMENT[a.type], a.competence_visee || "", [dateFr(a.date_debut), dateFr(a.date_fin)].filter(Boolean).join(" → "), a.duree_heures ? `${Number(a.duree_heures)} h` : "", STATUTS_DEVELOPPEMENT[a.statut], a.evaluation_efficacite || ""]),
    [2.4, 1.1, 1.6, 1.4, 0.6, 0.8, 2.4]);
  envoyerPdf(res, doc, `developpement-intervenant-${id}.pdf`);
}));

export default router;
