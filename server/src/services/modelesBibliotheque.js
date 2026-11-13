// Bibliothèque de modèles : valeurs admises et règles métier, sans accès base (testable seul).
// Le serveur reste juge : ces règles sont appliquées à la création et à la modification.

export const PORTEES = ["formation", "session", "groupe", "stagiaire"];
export const TYPES_DOCUMENT = [
  "attestation", "convocation", "emargement", "fiche_recapitulative", "convention", "compte_rendu",
  "evaluation", "bilan", "programme", "scenario_pedagogique", "questionnaire", "autre",
];
export const MODES_GENERATION = ["manuel", "automatique", "conditionnel"];

// Déclencheurs métier d'une génération automatique ou conditionnelle.
export const DECLENCHEURS = {
  creation_session: "À la création de la session",
  inscription: "À l'inscription d'un stagiaire",
  debut_session: "Au début de la session",
  fin_session: "À la fin de la session",
};
// Conditions évaluables sur les données des stagiaires (mode conditionnel).
export const CONDITIONS = {
  situation_handicap: "Stagiaire en situation de handicap",
  besoin_adaptation: "Stagiaire ayant un besoin d'adaptation (handicap ou besoin renseigné)",
  prescripteur_renseigne: "Stagiaire orienté par un prescripteur",
};

const LONGUEUR_NOM = 200;
const LONGUEUR_DESCRIPTION = 1000;
const LONGUEUR_CONDITION = 300;

// Champs qu'une modification (PATCH) peut transmettre. Les autres sont refusés.
export const CHAMPS_MODIFIABLES = ["nom", "lien", "portee", "description", "type_document", "mode_generation", "condition_generation", "declencheur", "condition_code", "indicateurs"];

const estPresent = (v) => v !== undefined && v !== null;

// Valide les champs transmis. `complet` : création (champs obligatoires exigés).
// Renvoie { valeur } (champs normalisés, seulement ceux transmis) ou { erreur }.
export function validerChamps(corps, { complet }) {
  const valeur = {};
  const src = corps || {};

  if (complet || estPresent(src.nom)) {
    const nom = typeof src.nom === "string" ? src.nom.trim() : "";
    if (!nom) return { erreur: "Nom obligatoire." };
    if (nom.length > LONGUEUR_NOM) return { erreur: `Nom trop long : ${LONGUEUR_NOM} caractères maximum.` };
    valeur.nom = nom;
  }
  if (complet || estPresent(src.lien)) {
    if (typeof src.lien !== "string" || !src.lien.trim()) return { erreur: "Lien ou identifiant Drive obligatoire." };
    valeur.lien = src.lien;
  }
  if (complet || estPresent(src.portee)) {
    if (!PORTEES.includes(src.portee)) return { erreur: "Portée inconnue." };
    valeur.portee = src.portee;
  }
  if (complet || estPresent(src.type_document)) {
    if (!TYPES_DOCUMENT.includes(src.type_document)) return { erreur: "Type de document obligatoire : valeur inconnue." };
    valeur.type_document = src.type_document;
  }
  if (complet || estPresent(src.mode_generation)) {
    if (!MODES_GENERATION.includes(src.mode_generation)) return { erreur: "Mode de génération obligatoire : manuel, automatique ou conditionnel." };
    valeur.mode_generation = src.mode_generation;
  }
  if (estPresent(src.description)) {
    const description = typeof src.description === "string" ? src.description.trim() : null;
    if (description && description.length > LONGUEUR_DESCRIPTION) return { erreur: `Description trop longue : ${LONGUEUR_DESCRIPTION} caractères maximum.` };
    valeur.description = description || null;
  }
  if (estPresent(src.condition_generation)) {
    const condition = typeof src.condition_generation === "string" ? src.condition_generation.trim() : "";
    if (condition.length > LONGUEUR_CONDITION) return { erreur: `Condition trop longue : ${LONGUEUR_CONDITION} caractères maximum.` };
    valeur.condition_generation = condition || null;
  }
  if (estPresent(src.declencheur)) {
    if (!Object.hasOwn(DECLENCHEURS, src.declencheur)) return { erreur: "Déclencheur inconnu." };
    valeur.declencheur = src.declencheur;
  }
  if (estPresent(src.condition_code)) {
    if (!Object.hasOwn(CONDITIONS, src.condition_code)) return { erreur: "Condition inconnue." };
    valeur.condition_code = src.condition_code;
  }
  if (estPresent(src.indicateurs) || complet) {
    const bruts = Array.isArray(src.indicateurs) ? src.indicateurs : [];
    const entiers = bruts.map((v) => (typeof v === "number" ? v : Number(v)));
    if (entiers.some((n) => !Number.isSafeInteger(n) || n < 1)) return { erreur: "Indicateur(s) invalide(s) : numéro entier positif attendu." };
    if (!entiers.length) return { erreur: "Indiquez au moins un indicateur." };
    valeur.indicateurs = [...new Set(entiers)].sort((a, b) => a - b);
  }
  return { valeur };
}

// Champs dépendants du mode : ceux qui n'ont pas été transmis explicitement sont remis en
// cohérence (passer en manuel retire déclencheur et condition ; en conditionnel, la description
// reprend le libellé de la condition si elle est absente).
export function completerMode(modele, transmis = new Set()) {
  const m = { ...modele };
  if (m.mode_generation === "manuel") {
    if (!transmis.has("declencheur")) m.declencheur = null;
    if (!transmis.has("condition_code")) m.condition_code = null;
    if (!transmis.has("condition_generation")) m.condition_generation = null;
  }
  if (m.mode_generation === "automatique") {
    if (!transmis.has("condition_code")) m.condition_code = null;
    if (!transmis.has("condition_generation")) m.condition_generation = null;
  }
  if (m.mode_generation === "conditionnel" && !m.condition_generation && m.condition_code) {
    m.condition_generation = CONDITIONS[m.condition_code];
  }
  return m;
}

// Cohérence de l'état final d'un modèle (après fusion avec l'existant en cas de modification).
// exigerDeclencheur = false : modification d'un modèle classé avant les déclencheurs, sans toucher
// au mode ; il reste sans effet automatique tant que le déclencheur n'est pas choisi.
export function verifierCoherence(modele, { exigerDeclencheur = true } = {}) {
  if (modele.mode_generation === "manuel" && (modele.declencheur || modele.condition_code)) {
    return { erreur: "Un modèle à génération manuelle n'a ni déclencheur ni condition." };
  }
  if (exigerDeclencheur && modele.mode_generation !== "manuel" && !modele.declencheur) {
    return { erreur: "Génération automatique ou conditionnelle : choisissez un déclencheur." };
  }
  if (modele.mode_generation === "automatique" && modele.condition_code) {
    return { erreur: "La condition n'est admise qu'en mode conditionnel." };
  }
  if (exigerDeclencheur && modele.mode_generation === "conditionnel" && !modele.condition_code) {
    return { erreur: "Mode conditionnel : choisissez une condition." };
  }
  if (modele.condition_code && !modele.declencheur) {
    return { erreur: "Une condition suppose un déclencheur." };
  }
  if (modele.mode_generation === "conditionnel" && !(modele.condition_generation || "").trim()) {
    return { erreur: "Mode conditionnel : décrivez la condition de génération." };
  }
  if (modele.mode_generation !== "conditionnel" && modele.condition_generation) {
    return { erreur: "La condition de génération n'est admise qu'en mode conditionnel." };
  }
  return { ok: true };
}
