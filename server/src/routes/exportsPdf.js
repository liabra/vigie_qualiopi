// ─────────────────────────────────────────────────────────────
//  Exports PDF des éléments de preuve (dépôt sur la plateforme de l'organisme certificateur).
//  Chaque export est généré à la demande à partir des données à jour, horodaté, paginé, au nom de
//  l'organisme. Minimisation : pas de donnée de santé ; identité des réclamants jamais exportée.
//  Lecture : administrateur (les registres de pilotage aussi pour les contributeurs).
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { query } from "../db.js";
import { requireAdmin, requireRedacteur } from "../session.js";
import { parseIdPositif } from "../services/ids.js";
import { REGISTRES } from "../services/registres.js";
import { DocumentPdf, dateFr, envoyerPdf } from "../services/pdf.js";
import { chargerIndicateursSession } from "../services/indicateursSession.js";
import { calculerAssiduite } from "../services/assiduite.js";
import { syntheseQuestion, TYPES_ENQUETE } from "../services/enquetes.js";
import { signaux, APPRECIATIONS, TYPES_AUDIT } from "./audits.js";
import { journaliser } from "../services/journal.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const organisme = async () => {
  const { rows: [o] } = await query("SELECT nom, nda, siret FROM parametres_organisme WHERE id = 1");
  return [o?.nom, o?.nda ? `NDA ${o.nda}` : null].filter(Boolean).join(" — ");
};
const nouveau = async (titre, sousTitre = "") => new DocumentPdf({ titre, organisme: await organisme(), sousTitre });
const pourcent = (v) => (v === null || v === undefined ? "—" : `${v} %`);

// Liste des exports disponibles (page « Preuves PDF »).
export const CATALOGUE_PDF = [
  { id: "indicateurs", titre: "Tableau des preuves par indicateur", description: "Pour chaque indicateur du référentiel actif : preuves rattachées, état, échéance.", chemin: "/api/pdf/indicateurs", admin: true },
  { id: "actions", titre: "Plan d'amélioration (actions qualité)", description: "Actions correctives et préventives, responsables, échéances, contrôle d'efficacité.", chemin: "/api/pdf/actions-qualite", admin: true },
  { id: "signalements", titre: "Registre des réclamations et incidents", description: "Sans identité des réclamants : objet, dates, délai, réponse, clôture.", chemin: "/api/pdf/signalements", admin: true },
  { id: "veille", titre: "Registre de veille", description: "Veille légale, métiers, pédagogique et handicap : analyse d'impact et actions.", chemin: "/api/pdf/veille", admin: true },
  { id: "developpement", titre: "Plan de développement des compétences des intervenants", description: "Indicateurs 21 et 22 : entretiens, besoins, actions réalisées et prévues.", chemin: "/api/pdf/developpement", admin: true },
  { id: "satisfaction", titre: "Synthèse des enquêtes en ligne", description: "Toutes les enquêtes : réponses, satisfaction globale, analyse tracée.", chemin: "/api/pdf/enquetes", admin: true },
  ...Object.entries(REGISTRES).map(([nom, d]) => ({ id: `registre-${nom}`, titre: d.titre, description: d.description, chemin: `/api/pdf/registres/${nom}`, admin: false })),
];

router.get("/pdf/catalogue", requireRedacteur, (req, res) => {
  res.json({ exports: CATALOGUE_PDF.filter((e) => req.user.role === "admin" || !e.admin) });
});

// ── Registres de pilotage (tâches, risques, partenaires, ressources) ──
router.get("/pdf/registres/:nom", requireRedacteur, wrap(async (req, res) => {
  const d = Object.hasOwn(REGISTRES, req.params.nom) ? REGISTRES[req.params.nom] : null;
  if (!d) return res.status(404).json({ error: "Registre inconnu." });
  const champs = d.champs.filter((c) => c.type !== "indicateurs");
  const resp = d.champs.some((c) => c.nom === "responsable_id") ? "t.responsable_id" : d.champs.some((c) => c.nom === "referent_id") ? "t.referent_id" : "NULL";
  const { rows } = await query(
    `SELECT t.*, u.nom AS responsable_nom, COALESCE((SELECT array_agg(i.numero ORDER BY i.numero) FROM indicateurs i WHERE i.id = ANY(t.indicateur_ids)), '{}') AS indicateurs
     FROM ${d.table} t LEFT JOIN utilisateurs u ON u.id = ${resp} ORDER BY ${d.tri}`);
  const valeur = (c, f) => {
    const v = f[c.nom];
    if (v === null || v === undefined || v === "") return "";
    if (c.type === "utilisateur") return f.responsable_nom || "";
    if (c.type === "enum") return c.libelles[v] || v;
    if (c.type === "date") return dateFr(v);
    return String(v);
  };
  const colonnes = champs.filter((c) => c.colonne);
  const longs = champs.filter((c) => !c.colonne && ["texte_long", "texte"].includes(c.type));
  const doc = await nouveau(d.titre, d.description);
  doc.tableau([...colonnes.map((c) => c.libelle.replace(/ \(.*\)$/, "")), "Indicateurs"], rows.map((f) => [...colonnes.map((c) => valeur(c, f)), (f.indicateurs || []).join(", ")]),
    [...colonnes.map((c, i) => (i === 0 ? 3 : 1.3)), 1]);
  const details = rows.filter((f) => longs.some((c) => f[c.nom]));
  if (details.length) {
    doc.titre("Détail");
    for (const f of details) {
      doc.paragraphe(f.titre || f.nom, { gras: true });
      for (const c of longs) doc.champ(c.libelle, f[c.nom]);
      doc.espace(4);
    }
  }
  envoyerPdf(res, doc, `registre-${req.params.nom}.pdf`);
}));

// ── Tableau des preuves par indicateur ───────────────────────
router.get("/pdf/indicateurs", requireAdmin, wrap(async (_req, res) => {
  const { rows } = await query(
    `SELECT i.numero, i.libelle, c.numero AS critere, (na.indicateur_id IS NOT NULL) AS non_applicable, na.motif,
            COALESCE((SELECT json_agg(json_build_object('titre', p.titre, 'statut', p.statut, 'echeance', p.date_echeance, 'revision', p.date_derniere_revision) ORDER BY p.titre)
                      FROM preuves p WHERE p.indicateur_id = i.id AND NOT EXISTS (SELECT 1 FROM preuves_confidentielles pc WHERE pc.preuve_id = p.id)), '[]') AS preuves
     FROM indicateurs i JOIN referentiel_versions v ON v.id = i.version_id AND v.est_active LEFT JOIN criteres c ON c.id = i.critere_id
     LEFT JOIN indicateurs_non_applicables na ON na.indicateur_id = i.id ORDER BY i.numero`);
  const { rows: [v] } = await query("SELECT code, libelle FROM referentiel_versions WHERE est_active");
  const doc = await nouveau("Tableau des preuves par indicateur", `Référentiel ${v?.code || ""} ${v?.libelle || ""}`.trim());
  const STATUTS = { valide: "Valide", a_reviser: "À réviser", expiree: "Expirée", obsolete: "Obsolète" };
  doc.tableau(["Ind.", "Critère", "Indicateur", "Preuves (état, dernière révision)"],
    rows.map((r) => [r.numero, r.critere, r.libelle, r.non_applicable ? `Non applicable${r.motif ? ` : ${r.motif}` : ""}`
      : r.preuves.length ? r.preuves.map((p) => `• ${p.titre} (${STATUTS[p.statut] || p.statut}${p.revision ? `, révisée le ${dateFr(p.revision)}` : ""})`).join("\n") : "Aucune preuve rattachée"]),
    [0.5, 0.6, 3.2, 4]);
  envoyerPdf(res, doc, "preuves-par-indicateur.pdf");
}));

// ── Actions qualité ──────────────────────────────────────────
router.get("/pdf/actions-qualite", requireAdmin, wrap(async (_req, res) => {
  const { rows } = await query(
    `SELECT a.*, u.nom AS responsable, COALESCE((SELECT array_agg(i.numero ORDER BY i.numero) FROM actions_qualite_indicateurs ai JOIN indicateurs i ON i.id = ai.indicateur_id WHERE ai.action_id = a.id), '{}') AS indicateurs
     FROM actions_qualite a LEFT JOIN utilisateurs u ON u.id = a.responsable_id WHERE a.statut <> 'annulee' ORDER BY a.created_at`);
  const STATUTS = { a_faire: "À faire", en_cours: "En cours", realisee: "Réalisée", efficacite_a_verifier: "Efficacité à vérifier", cloturee: "Clôturée" };
  const doc = await nouveau("Plan d'amélioration continue", "Actions qualité : constat, action, responsable, échéance, résultat et contrôle d'efficacité (indicateur 32).");
  doc.tableau(["Réf.", "Action", "Responsable", "Échéance", "Statut", "Indicateurs"],
    rows.map((a) => [a.reference, a.titre, a.responsable || "", dateFr(a.echeance), STATUTS[a.statut] || a.statut, a.indicateurs.join(", ")]), [0.9, 3, 1.3, 1, 1.2, 1]);
  doc.titre("Détail des actions");
  for (const a of rows) {
    doc.paragraphe(`${a.reference} — ${a.titre}`, { gras: true });
    doc.champ("Constat", a.constat).champ("Action prévue", a.action_prevue).champ("Mise en œuvre le", dateFr(a.date_mise_en_oeuvre))
      .champ("Résultat", a.resultat).champ("Contrôle d'efficacité", a.controle_efficacite).champ("Contrôlée le", dateFr(a.date_controle_efficacite)).champ("Clôturée le", dateFr(a.date_cloture));
    doc.espace(4);
  }
  envoyerPdf(res, doc, "plan-amelioration.pdf");
}));

// ── Réclamations et incidents (sans identité des réclamants) ──
router.get("/pdf/signalements", requireAdmin, wrap(async (_req, res) => {
  const { rows } = await query(
    `SELECT s.reference, s.type, s.date_constat, s.canal, s.objet, s.statut, s.date_echeance_cible, s.synthese_reponse, s.date_reponse, s.date_resolution, s.date_cloture,
            COALESCE((SELECT array_agg(c.cause) FROM signalements_qualite_causes c WHERE c.signalement_id = s.id), '{}') AS causes
     FROM signalements_qualite s WHERE s.statut <> 'annulee' ORDER BY s.date_constat, s.id`);
  const TYPES = { reclamation: "Réclamation", incident: "Incident", non_conformite: "Non-conformité" };
  const STATUTS = { ouverte: "Ouverte", qualifiee: "Qualifiée", en_traitement: "En traitement", resolue: "Résolue", cloturee: "Clôturée" };
  const doc = await nouveau("Registre des réclamations, incidents et non-conformités", "Indicateur 31 — traitement des difficultés et réclamations. Les identités des réclamants ne figurent pas dans ce document.");
  doc.tableau(["Réf.", "Type", "Reçu / constaté", "Objet", "Échéance", "Réponse", "Clôture", "Statut"],
    rows.map((s) => [s.reference, TYPES[s.type], dateFr(s.date_constat), s.objet, dateFr(s.date_echeance_cible), dateFr(s.date_reponse), dateFr(s.date_cloture), STATUTS[s.statut] || s.statut]),
    [0.9, 1, 0.9, 2.8, 0.9, 0.9, 0.9, 1]);
  const avecReponse = rows.filter((s) => s.synthese_reponse);
  if (avecReponse.length) {
    doc.titre("Réponses apportées");
    for (const s of avecReponse) doc.paragraphe(`${s.reference} — ${s.objet}`, { gras: true }).paragraphe(s.synthese_reponse);
  }
  envoyerPdf(res, doc, "registre-reclamations.pdf");
}));

// ── Veille ───────────────────────────────────────────────────
router.get("/pdf/veille", requireAdmin, wrap(async (_req, res) => {
  const { rows } = await query("SELECT * FROM veille ORDER BY COALESCE(date_publication, created_at::date) DESC");
  const TYPES = { legale_reglementaire: "Légale et réglementaire", metiers_competences: "Métiers et compétences", innovations_pedagogiques: "Innovations pédagogiques", handicap: "Handicap", autre: "Autre" };
  const doc = await nouveau("Registre de veille", "Indicateurs 23 à 26 — veille légale, métiers, pédagogique et handicap ; analyse et exploitation.");
  doc.tableau(["Date", "Type", "Sujet", "Source", "Action décidée", "Réalisée le"],
    rows.map((v) => [dateFr(v.date_publication || v.created_at), TYPES[v.type] || v.type, v.titre, v.source || "", v.action || "", dateFr(v.action_realisee_le)]), [0.8, 1.2, 2.6, 1.2, 2.4, 0.8]);
  const analyses = rows.filter((v) => v.analyse_impact);
  if (analyses.length) {
    doc.titre("Analyses d'impact");
    for (const v of analyses) doc.paragraphe(v.titre, { gras: true }).paragraphe(v.analyse_impact);
  }
  envoyerPdf(res, doc, "registre-veille.pdf");
}));

// ── Enquêtes en ligne ────────────────────────────────────────
async function pdfEnquete(doc, e) {
  const { rows: questions } = await query("SELECT id, libelle, type, options, globale FROM enquete_questions WHERE enquete_id = $1 ORDER BY ordre, id", [e.id]);
  const { rows: lignes } = await query("SELECT reponses FROM satisfactions WHERE enquete_id = $1", [e.id]);
  doc.titre(`${e.titre} — ${e.formation || ""} (${e.reference || ""}, ${dateFr(e.date_debut)} → ${dateFr(e.date_fin)})`, 12);
  doc.paragraphe(`${TYPES_ENQUETE[e.type]} — ${lignes.length} réponse(s)${e.inscrits ? ` pour ${e.inscrits} inscrit(s)` : ""}.`);
  for (const q of questions) {
    const s = syntheseQuestion(q, lignes);
    if (q.type === "echelle") doc.paragraphe(`${q.libelle} : moyenne ${s.moyenne ?? "—"} / 5, ${pourcent(s.taux_satisfaits)} de satisfaits (répartition 1→5 : ${s.repartition.join(" / ")})`);
    else if (q.type === "oui_non") doc.paragraphe(`${q.libelle} : oui ${s.repartition.oui}, non ${s.repartition.non}`);
    else if (["choix_unique", "choix_multiple"].includes(q.type)) doc.paragraphe(`${q.libelle} : ${Object.entries(s.repartition).map(([k, n]) => `${k} ${n}`).join(", ")}`);
    else if (s.textes?.length) { doc.paragraphe(`${q.libelle} :`); doc.liste(s.textes.slice(0, 60)); }
  }
  doc.champ("Analyse et décisions", e.analyse || "Non encore analysée");
  doc.espace(6);
}
const SELECT_ENQUETE = `SELECT e.id, e.titre, e.type, e.analyse_resultats AS analyse, s.reference, s.date_debut, s.date_fin, f.intitule AS formation,
  (SELECT count(*)::int FROM inscriptions i WHERE i.session_id = e.session_id AND i.statut <> 'abandon') AS inscrits
  FROM enquetes e JOIN sessions s ON s.id = e.session_id LEFT JOIN formations f ON f.id = s.formation_id`;

router.get("/pdf/enquetes", requireAdmin, wrap(async (_req, res) => {
  const { rows } = await query(`${SELECT_ENQUETE} ORDER BY s.date_debut DESC, e.id`);
  const doc = await nouveau("Synthèse des enquêtes de satisfaction", "Indicateurs 30 à 32 — recueil des appréciations, exploitation et décisions.");
  if (!rows.length) doc.paragraphe("Aucune enquête en ligne.");
  for (const e of rows) await pdfEnquete(doc, e);
  envoyerPdf(res, doc, "enquetes-satisfaction.pdf");
}));

router.get("/pdf/enquetes/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const { rows: [e] } = await query(`${SELECT_ENQUETE} WHERE e.id = $1`, [id]);
  if (!e) return res.status(404).json({ error: "Enquête introuvable." });
  const doc = await nouveau("Résultats d'enquête", "Recueil et exploitation des appréciations (indicateur 30).");
  await pdfEnquete(doc, e);
  envoyerPdf(res, doc, `enquete-${id}.pdf`);
}));

// ── Session : bilan (indicateurs) et assiduité ───────────────
async function sessionPourPdf(id) {
  const { rows: [s] } = await query(
    `SELECT s.*, f.intitule, fv.duree_heures_defaut FROM sessions s LEFT JOIN formations f ON f.id = s.formation_id LEFT JOIN formation_versions fv ON fv.id = s.formation_version_id WHERE s.id = $1`, [id]);
  return s || null;
}

router.get("/pdf/sessions/:id/bilan", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  const s = id ? await sessionPourPdf(id) : null;
  if (!s) return res.status(404).json({ error: "Session introuvable." });
  const ind = await chargerIndicateursSession(id, s.duree_heures_reelle ?? s.duree_heures_defaut ?? null);
  const { rows: [c] } = await query("SELECT count(*)::int AS total, count(*) FILTER (WHERE statut = 'termine')::int AS termines FROM inscriptions WHERE session_id = $1", [id]);
  const doc = await nouveau(`Bilan de session — ${s.intitule || ""}`, `Session ${s.reference || ""} du ${dateFr(s.date_debut)} au ${dateFr(s.date_fin)} — indicateurs de résultats (indicateur 2).`);
  doc.tableau(["Indicateur", "Résultat", "Détail"], [
    ["Inscrits", String(c.total), `${c.termines} parcours terminé(s), ${ind.abandons} abandon(s)`],
    ["Taux de satisfaction", pourcent(ind.taux_satisfaction), `${ind.repondants} répondant(s) ; satisfaits = notes 4 et 5 sur 5`],
    ["Taux de présence", pourcent(ind.taux_assiduite), "Heures suivies / heures prévues, abandons exclus"],
    ["Atteinte des objectifs", pourcent(ind.taux_atteinte), `${ind.reussites} réussite(s), ${ind.echecs} échec(s) au QCM final`],
    ["Taux d'abandon", pourcent(ind.taux_abandon), Object.entries(ind.motifs).filter(([, n]) => n).map(([k, n]) => `${k.replace("_", " ")} : ${n}`).join(", ") || "Aucun"],
  ], [1.6, 0.9, 3.5]);
  doc.paragraphe("Méthodes de calcul : satisfaction sur les réponses « à chaud » (note globale ramenée sur 5) ; présence selon les absences saisies ; objectifs atteints selon le dernier QCM de chaque stagiaire (validé, ou score au moins égal au seuil, à défaut 5/10).", { taille: 8.5, couleur: 0.35 });
  envoyerPdf(res, doc, `bilan-session-${id}.pdf`);
}));

router.get("/pdf/sessions/:id/assiduite", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  const s = id ? await sessionPourPdf(id) : null;
  if (!s) return res.status(404).json({ error: "Session introuvable." });
  const prevues = s.duree_heures_reelle ?? s.duree_heures_defaut ?? null;
  const { rows } = await query(
    `SELECT st.nom, st.prenom, i.statut, i.date_inscription, i.date_abandon, COALESCE((SELECT sum(a.duree_heures) FROM absences a WHERE a.inscription_id = i.id), 0) AS heures_absence
     FROM inscriptions i JOIN stagiaires st ON st.id = i.stagiaire_id WHERE i.session_id = $1 ORDER BY st.nom, st.prenom`, [id]);
  const STATUTS = { inscrit: "Inscrit", en_cours: "En cours", termine: "Terminé", abandon: "Abandon" };
  await journaliser("export_pdf_assiduite", { cibleType: "session", cibleId: id, par: req.user.id });
  const doc = await nouveau(`Suivi de l'assiduité — ${s.intitule || ""}`, `Session ${s.reference || ""} du ${dateFr(s.date_debut)} au ${dateFr(s.date_fin)} — durée prévue : ${prevues ?? "non renseignée"} h. L'émargement détaillé est conservé dans EduSign.`);
  doc.tableau(["Stagiaire", "Inscription", "Statut", "Heures d'absence", "Taux de présence"],
    rows.map((r) => { const a = calculerAssiduite({ heuresPrevues: prevues, heuresAbsence: r.heures_absence, statut: r.statut });
      return [`${r.nom} ${r.prenom}`, dateFr(r.date_inscription), STATUTS[r.statut] + (r.date_abandon ? ` (${dateFr(r.date_abandon)})` : ""), `${Number(r.heures_absence)} h`, a.fiable ? `${a.taux} %` : "—"]; }),
    [2.4, 1, 1.4, 1, 1]);
  envoyerPdf(res, doc, `assiduite-session-${id}.pdf`);
}));

// ── Dossier d'audit (préparation) ────────────────────────────
router.get("/pdf/campagnes-audit/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const { rows: [c] } = await query("SELECT c.*, v.code AS referentiel FROM campagnes_audit c LEFT JOIN referentiel_versions v ON v.id = c.referentiel_version_id WHERE c.id = $1", [id]);
  if (!c) return res.status(404).json({ error: "Préparation introuvable." });
  const { rows: inds } = await query(
    `SELECT i.numero, i.libelle, ci.appreciation, ci.observation,
            (SELECT count(*)::int FROM preuves p WHERE p.indicateur_id = i.id) AS nb_preuves,
            (SELECT count(*)::int FROM preuves p WHERE p.indicateur_id = i.id AND p.statut = 'valide' AND NOT p.a_confirmer) AS nb_preuves_valides,
            (SELECT count(*)::int FROM preuves p WHERE p.indicateur_id = i.id AND (p.statut IN ('expiree','obsolete','a_reviser') OR p.date_echeance < CURRENT_DATE)) AS nb_preuves_a_actualiser,
            (SELECT count(*)::int FROM preuves p WHERE p.indicateur_id = i.id AND p.a_confirmer) AS nb_preuves_a_confirmer,
            (SELECT count(*)::int FROM actions_qualite_indicateurs ai JOIN actions_qualite a ON a.id = ai.action_id WHERE ai.indicateur_id = i.id AND a.statut NOT IN ('cloturee','annulee')) AS nb_actions_ouvertes
     FROM campagne_indicateurs ci JOIN indicateurs i ON i.id = ci.indicateur_id WHERE ci.campagne_id = $1 ORDER BY i.numero`, [id]);
  const doc = await nouveau(`Préparation d'audit — ${c.titre}`, `${TYPES_AUDIT[c.type]}${c.date_audit ? ` prévu le ${dateFr(c.date_audit)}` : ""} — référentiel ${c.referentiel || ""}. Document interne d'auto-évaluation.`);
  if (c.perimetre) doc.champ("Périmètre", c.perimetre);
  if (c.synthese) doc.champ("Synthèse", c.synthese);
  doc.tableau(["Ind.", "Indicateur", "Appréciation", "Observation", "Signaux"],
    inds.map((r) => [r.numero, r.libelle, APPRECIATIONS[r.appreciation], r.observation || "", signaux(r).join(" ; ")]), [0.5, 3, 1, 2.4, 2]);
  envoyerPdf(res, doc, `preparation-audit-${id}.pdf`);
}));

export default router;
