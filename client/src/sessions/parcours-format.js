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
