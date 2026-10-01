// Q2-1 — Parcours bénéficiaire : libellés et règles PURES (aucun React,
// aucun réseau). Listes fermées identiques à celles du serveur.

export const STATUTS_RECUEIL = {
  a_faire: { libelle: "À faire", ton: "warning" },
  realise: { libelle: "Réalisé", ton: "success" },
  non_applicable: { libelle: "Non applicable", ton: "neutral" },
};
// Aucun recueil enregistré : état distinct, jamais une fausse date.
export const RECUEIL_NON_COMMENCE = { libelle: "Non commencé", ton: "warning" };

export const PREREQUIS = { oui: "Oui", partiel: "Partiellement", non: "Non" };
export const CONCLUSIONS = {
  parcours_standard: "Parcours standard",
  parcours_adapte: "Parcours adapté",
  reorientation: "Réorientation",
  a_preciser: "À préciser",
};
export const STATUTS_INSCRIPTION = {
  inscrit: { libelle: "Inscrit", ton: "info" },
  en_cours: { libelle: "En cours", ton: "info" },
  termine: { libelle: "Terminé", ton: "success" },
  abandon: { libelle: "Abandon", ton: "neutral" },
};
export const MAX_TEXTE = 2000;
export const AIDE_CONFIDENTIALITE = "Décrivez les attentes et besoins pédagogiques. Ne saisissez pas de diagnostic ni d'information médicale.";

export const etatRecueil = (ligne) => (ligne.recueil_statut ? STATUTS_RECUEIL[ligne.recueil_statut] : RECUEIL_NON_COMMENCE);
// « Recueil à faire » = aucun recueil OU statut « à faire ».
export const recueilAFaire = (ligne) => !ligne.recueil_statut || ligne.recueil_statut === "a_faire";
export const filtrerParcours = (lignes, { aFaire = false } = {}) => (lignes || []).filter((l) => !aFaire || recueilAFaire(l));

export const RECUEIL_VIDE = {
  statut: "a_faire", date_recueil: "", attentes: "", objectifs_personnels: "",
  prerequis_verifies: "", conclusion: "", positionnement_id: "",
};
export function valeursRecueil(r) {
  if (!r) return { ...RECUEIL_VIDE };
  return {
    statut: r.statut, date_recueil: (r.date_recueil || "").slice(0, 10), attentes: r.attentes || "",
    objectifs_personnels: r.objectifs_personnels || "", prerequis_verifies: r.prerequis_verifies || "",
    conclusion: r.conclusion || "", positionnement_id: r.positionnement_id ? String(r.positionnement_id) : "",
  };
}
// Erreurs bloquantes avant envoi (le serveur reste juge).
export function erreursRecueil(v) {
  const e = {};
  if (v.statut === "realise" && !v.date_recueil) e.date_recueil = "Indiquez la date du recueil réalisé.";
  for (const f of ["attentes", "objectifs_personnels"]) if (String(v[f] || "").length > MAX_TEXTE) e[f] = `${MAX_TEXTE} caractères au plus.`;
  return e;
}
// Corps du PUT : état complet voulu (vide ⇒ null).
export function corpsRecueil(v) {
  const n = (x) => (String(x ?? "").trim() === "" ? null : String(x).trim());
  return {
    statut: v.statut, date_recueil: n(v.date_recueil), attentes: n(v.attentes), objectifs_personnels: n(v.objectifs_personnels),
    prerequis_verifies: n(v.prerequis_verifies), conclusion: n(v.conclusion),
    positionnement_id: v.positionnement_id ? Number(v.positionnement_id) : null,
  };
}
export function libellePositionnement(p) {
  const d = String(p.date_passage || "").slice(0, 10).split("-").reverse().join("/");
  const score = p.score !== null && p.score !== undefined && p.score_max ? ` — ${Number(p.score)}/${Number(p.score_max)}` : "";
  return `${p.intitule || "Positionnement"}${d ? ` (${d})` : ""}${score}`;
}

// ── Q2-2 : adaptations pédagogiques (mesures opérationnelles) ──────
export const CATEGORIES_ADAPTATION = {
  rythme: "Rythme",
  supports: "Supports",
  accessibilite_locaux: "Accessibilité des locaux",
  materiel: "Matériel",
  modalites_evaluation: "Modalités d'évaluation",
  accompagnement: "Accompagnement",
  autre: "Autre",
};
// « Abandonnée » = mesure abandonnée, jamais l'abandon de la formation.
export const STATUTS_ADAPTATION = {
  prevue: { libelle: "Prévue", ton: "warning" },
  mise_en_oeuvre: { libelle: "Mise en œuvre", ton: "success" },
  abandonnee: { libelle: "Mesure abandonnée", ton: "neutral" },
};
export const MAX_MESURE = 500;
export const AIDE_ADAPTATION = "Décrivez uniquement ce qui est mis en place pour faciliter la formation. Ne saisissez aucun diagnostic ni aucune information médicale.";
export const EXEMPLES_ADAPTATION = [
  "Supports remis en gros caractères.",
  "Temps supplémentaire pour les exercices.",
  "Évaluation orale plutôt qu'écrite.",
  "Mise à disposition d'un équipement adapté.",
];

// « Adaptations à mettre en œuvre » = au moins une mesure encore prévue.
export const adaptationsAMettreEnOeuvre = (ligne) => (ligne.adaptations_prevues || 0) > 0;
export function filtrerParcoursPar(lignes, filtre = "tous") {
  if (filtre === "recueil") return (lignes || []).filter(recueilAFaire);
  if (filtre === "adaptations") return (lignes || []).filter(adaptationsAMettreEnOeuvre);
  return lignes || [];
}
export function resumeAdaptations(l) {
  const total = l.adaptations_total || 0;
  if (!total) return "Aucune mesure";
  const parties = [`${total} mesure${total > 1 ? "s" : ""}`];
  if (l.adaptations_prevues) parties.push(`${l.adaptations_prevues} prévue${l.adaptations_prevues > 1 ? "s" : ""}`);
  if (l.adaptations_mises_en_oeuvre) parties.push(`${l.adaptations_mises_en_oeuvre} mise${l.adaptations_mises_en_oeuvre > 1 ? "s" : ""} en œuvre`);
  if (l.adaptations_abandonnees) parties.push(`${l.adaptations_abandonnees} abandonnée${l.adaptations_abandonnees > 1 ? "s" : ""}`);
  return parties.join(" · ");
}

export const ADAPTATION_VIDE = { categorie: "", mesure: "", statut: "prevue", date_decision: "", date_mise_en_oeuvre: "", bilan: "" };
export function valeursAdaptation(a) {
  if (!a) return { ...ADAPTATION_VIDE };
  return {
    categorie: a.categorie, mesure: a.mesure || "", statut: a.statut,
    date_decision: String(a.date_decision || "").slice(0, 10), date_mise_en_oeuvre: String(a.date_mise_en_oeuvre || "").slice(0, 10), bilan: a.bilan || "",
  };
}
export function erreursAdaptation(v) {
  const e = {};
  if (!CATEGORIES_ADAPTATION[v.categorie]) e.categorie = "Choisissez une catégorie.";
  const m = String(v.mesure || "").trim();
  if (!m) e.mesure = "Décrivez la mesure mise en place.";
  else if (m.length > MAX_MESURE) e.mesure = `${MAX_MESURE} caractères au plus.`;
  if (!v.date_decision) e.date_decision = "Indiquez la date de décision.";
  if (v.statut === "mise_en_oeuvre" && !v.date_mise_en_oeuvre) e.date_mise_en_oeuvre = "Indiquez la date de mise en œuvre.";
  if (String(v.bilan || "").length > MAX_MESURE) e.bilan = `${MAX_MESURE} caractères au plus.`;
  return e;
}
// Corps complet de l'état voulu (vides ⇒ null), identique en POST et PATCH.
export function corpsAdaptation(v) {
  const n = (x) => (String(x ?? "").trim() === "" ? null : String(x).trim());
  return {
    categorie: v.categorie, mesure: String(v.mesure || "").trim(), statut: v.statut,
    date_decision: n(v.date_decision), date_mise_en_oeuvre: n(v.date_mise_en_oeuvre), bilan: n(v.bilan),
  };
}

// ── Q2-3 : abandon enrichi et suivi factuel du décrochage ──────────
export const CATEGORIES_ABANDON = {
  personnel: "Raison personnelle",
  professionnel: "Raison professionnelle",
  financement: "Financement",
  reorientation: "Réorientation",
  sans_nouvelles: "Sans nouvelles",
  autre: "Autre",
};
export const MAX_MOTIF_ABANDON = 300;
export const AIDE_ABANDON = "Précision courte et factuelle. Ne saisissez aucune information médicale ni aucune justification intime.";

export const TYPES_SUIVI = {
  signal: { libelle: "Signal observé", ton: "warning" },
  relance: { libelle: "Relance effectuée", ton: "info" },
};
export const CATEGORIES_SUIVI = {
  signal: {
    absences_repetees: "Absences répétées constatées",
    retards_repetes: "Retards répétés constatés",
    difficulte_pedagogique: "Difficulté pédagogique signalée",
    sans_nouvelles: "Sans nouvelles",
    autre: "Autre",
  },
  relance: {
    sans_reponse: "Contact tenté, sans réponse",
    echange_realise: "Échange réalisé",
    entretien_realise: "Entretien de suivi réalisé",
    autre: "Autre",
  },
};
export const CANAUX_RELANCE = { email: "E-mail", telephone: "Téléphone", presentiel: "Présentiel", autre: "Autre" };
export const MAX_NOTE_SUIVI = 300;
export const AIDE_SUIVI = "Notez uniquement des faits observés. Ne recopiez pas le contenu des échanges ; aucun jugement personnel ni information médicale.";

export const dateFr = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");
export const libelleCategorieSuivi = (type, cat) => CATEGORIES_SUIVI[type]?.[cat] || cat;

// Issue du parcours d'après les statuts d'inscription RÉELS.
export function issueInscription(l) {
  if (l.statut_inscription === "abandon") return { libelle: `Abandon${l.date_abandon ? ` le ${dateFr(l.date_abandon)}` : ""}`, ton: "neutral" };
  if (l.statut_inscription === "termine") return { libelle: "Terminée", ton: "success" };
  return { libelle: "En cours", ton: "info" };
}
// Résumé de la vue d'ensemble : structuré seulement (jamais de note).
export function resumeSuivi(l) {
  const r = l.relances_total || 0;
  const relances = `${r} relance${r > 1 ? "s" : ""}`;
  if (!l.dernier_suivi_type) return { dernier: null, relances };
  return { dernier: `${libelleCategorieSuivi(l.dernier_suivi_type, l.dernier_suivi_categorie)} (${dateFr(l.dernier_suivi_date)})`, relances };
}

export const SUIVI_VIDE = { type: "signal", date_evenement: "", categorie: "", canal: "", note: "" };
export function valeursSuivi(e) {
  if (!e) return { ...SUIVI_VIDE };
  return { type: e.type, date_evenement: String(e.date_evenement || "").slice(0, 10), categorie: e.categorie, canal: e.canal || "", note: e.note || "" };
}
export function erreursSuivi(v) {
  const e = {};
  if (!v.date_evenement) e.date_evenement = "Indiquez la date.";
  if (!CATEGORIES_SUIVI[v.type]?.[v.categorie]) e.categorie = "Choisissez une catégorie.";
  if (v.type === "relance" && !CANAUX_RELANCE[v.canal]) e.canal = "Choisissez le canal de la relance.";
  if (String(v.note || "").trim().length > MAX_NOTE_SUIVI) e.note = `${MAX_NOTE_SUIVI} caractères au plus.`;
  return e;
}
// Corps complet de l'état voulu ; le type n'est envoyé qu'à la création.
export function corpsSuivi(v, { creation = true } = {}) {
  const n = (x) => (String(x ?? "").trim() === "" ? null : String(x).trim());
  const corps = { date_evenement: n(v.date_evenement), categorie: v.categorie, canal: v.type === "relance" ? n(v.canal) : null, note: n(v.note) };
  return creation ? { type: v.type, ...corps } : corps;
}
// Corps de l'abandon : catégorie et précision FACULTATIVES (absentes si vides).
export function corpsAbandon({ categorie_abandon = "", motif_abandon = "" } = {}) {
  const corps = { statut: "abandon" };
  if (categorie_abandon) corps.categorie_abandon = categorie_abandon;
  if (String(motif_abandon).trim()) corps.motif_abandon = String(motif_abandon).trim();
  return corps;
}
// Complément d'un abandon EXISTANT : jamais de statut ni de date (pas de
// nouvelle transition) ; vide ⇒ null (correction possible).
export function corpsComplementAbandon({ categorie_abandon = "", motif_abandon = "" } = {}) {
  const motif = String(motif_abandon ?? "").trim();
  return { categorie_abandon: categorie_abandon || null, motif_abandon: motif || null };
}
