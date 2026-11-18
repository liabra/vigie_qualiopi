// ─────────────────────────────────────────────────────────────
//  Q2-4 — Questionnaires personnalisables par formation : validation PURE
//  (sans base ni réseau) et mise en forme de la réponse affichée.
//
//  Le questionnaire eSenior existant n'est pas concerné par ce module :
//  aucune des fonctions ci-dessous n'est appelée pour lui.
// ─────────────────────────────────────────────────────────────

export const TYPES_QUESTION = ["texte_libre", "choix_unique", "choix_multiple", "oui_non"];
export const MAX_LIBELLE = 500;
export const MAX_OPTIONS = 20;
export const MAX_OPTION = 200;
export const MAX_VALEUR_TEXTE = 2000;
export const MAX_QUESTIONS = 100;

const texte = (v) => (v === null || v === undefined ? "" : String(v).trim());

// Valide une question à créer/modifier. `options` n'est exigé — et
// contrôlé — que pour les deux types à choix.
export function lireQuestion(corps = {}) {
  const libelle = texte(corps.libelle);
  if (!libelle) return { erreur: "Indiquez le libellé de la question." };
  if (libelle.length > MAX_LIBELLE) return { erreur: `Libellé trop long (${MAX_LIBELLE} caractères au plus).` };
  const type = corps.type;
  if (!TYPES_QUESTION.includes(type)) return { erreur: "Type de question inconnu." };
  let options = [];
  if (type === "choix_unique" || type === "choix_multiple") {
    const brutes = Array.isArray(corps.options) ? corps.options : [];
    options = brutes.map(texte).filter((o) => o !== "");
    if (options.length < 2) return { erreur: "Indiquez au moins deux options de réponse." };
    if (options.length > MAX_OPTIONS) return { erreur: `${MAX_OPTIONS} options au plus.` };
    if (options.some((o) => o.length > MAX_OPTION)) return { erreur: `Option trop longue (${MAX_OPTION} caractères au plus).` };
    if (new Set(options).size !== options.length) return { erreur: "Les options doivent être distinctes." };
  }
  const obligatoire = corps.obligatoire === true;
  return { champs: { libelle, type, options, obligatoire } };
}

// Valide UNE réponse soumise, au regard de la question (déjà en base,
// donc déjà valide elle-même) à laquelle elle répond. `valeur` : forme
// brute envoyée par le client ({ valeur_texte } ou { valeurs_choisies }).
export function lireReponse(question, valeur = {}) {
  if (question.type === "texte_libre") {
    const t = texte(valeur.valeur_texte);
    if (!t) {
      if (question.obligatoire) return { erreur: `« ${question.libelle} » est obligatoire.` };
      return { champs: { valeur_texte: null, valeurs_choisies: [] } };
    }
    if (t.length > MAX_VALEUR_TEXTE) return { erreur: `Réponse trop longue (${MAX_VALEUR_TEXTE} caractères au plus).` };
    return { champs: { valeur_texte: t, valeurs_choisies: [] } };
  }
  if (question.type === "oui_non") {
    const t = texte(valeur.valeur_texte);
    if (!t) {
      if (question.obligatoire) return { erreur: `« ${question.libelle} » est obligatoire.` };
      return { champs: { valeur_texte: null, valeurs_choisies: [] } };
    }
    if (!["Oui", "Non"].includes(t)) return { erreur: `« ${question.libelle} » : réponse attendue Oui ou Non.` };
    return { champs: { valeur_texte: t, valeurs_choisies: [] } };
  }
  // choix_unique / choix_multiple : les valeurs doivent appartenir aux
  // options ACTUELLES de la question (jamais une option inventée côté client).
  const brutes = Array.isArray(valeur.valeurs_choisies) ? valeur.valeurs_choisies.map(texte).filter((v) => v !== "") : [];
  if (!brutes.length) {
    if (question.obligatoire) return { erreur: `« ${question.libelle} » est obligatoire.` };
    return { champs: { valeur_texte: null, valeurs_choisies: [] } };
  }
  if (question.type === "choix_unique" && brutes.length > 1) return { erreur: `« ${question.libelle} » n'accepte qu'une seule réponse.` };
  const inconnue = brutes.find((v) => !question.options.includes(v));
  if (inconnue) return { erreur: `« ${inconnue} » n'est pas une option de « ${question.libelle} ».` };
  return { champs: { valeur_texte: null, valeurs_choisies: [...new Set(brutes)] } };
}

// Texte affiché pour une réponse déjà enregistrée (dossier stagiaire,
// document généré) : relit l'INSTANTANÉ porté par la réponse, jamais la
// question en vigueur. "" si la question n'a jamais été renseignée.
export function reponseAffichage(reponse) {
  if (!reponse) return "";
  if (reponse.valeur_texte) return reponse.valeur_texte;
  if (reponse.valeurs_choisies?.length) return reponse.valeurs_choisies.join(", ");
  return "";
}
