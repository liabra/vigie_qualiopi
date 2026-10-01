// ─────────────────────────────────────────────────────────────
//  Q2-1 — Recueil du besoin : validation PURE (sans base ni réseau).
//  Listes fermées, textes bornés, aucune date inventée.
// ─────────────────────────────────────────────────────────────
import { parseIdPositif } from "./ids.js";
import { estDateValide } from "./dates.js";

export const STATUTS_RECUEIL = ["a_faire", "realise", "non_applicable"];
export const PREREQUIS = ["oui", "non", "partiel"];
export const CONCLUSIONS = ["parcours_standard", "parcours_adapte", "reorientation", "a_preciser"];
export const MAX_TEXTE = 2000;

const texte = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());

// Corps complet attendu (PUT = état voulu du recueil). Retourne
// { champs } ou { erreur } — jamais le contenu des textes dans l'erreur.
export function lireRecueil(corps = {}) {
  if (!STATUTS_RECUEIL.includes(corps.statut)) return { erreur: "Statut du recueil inconnu." };
  const champs = { statut: corps.statut };

  const date = corps.date_recueil === undefined || corps.date_recueil === null || corps.date_recueil === "" ? null : String(corps.date_recueil).trim();
  if (date !== null && !estDateValide(date)) return { erreur: "Date du recueil invalide : format attendu AAAA-MM-JJ." };
  // Un recueil « réalisé » est daté par l'utilisateur : rien n'est inventé.
  if (champs.statut === "realise" && date === null) return { erreur: "Indiquez la date du recueil réalisé." };
  champs.date_recueil = date;

  for (const f of ["attentes", "objectifs_personnels"]) {
    const t = texte(corps[f]);
    if (t !== null && t.length > MAX_TEXTE) return { erreur: `Texte trop long (${MAX_TEXTE} caractères au plus).` };
    champs[f] = t;
  }
  const pre = texte(corps.prerequis_verifies);
  if (pre !== null && !PREREQUIS.includes(pre)) return { erreur: "Vérification des prérequis inconnue." };
  champs.prerequis_verifies = pre;
  const conc = texte(corps.conclusion);
  if (conc !== null && !CONCLUSIONS.includes(conc)) return { erreur: "Conclusion inconnue." };
  champs.conclusion = conc;

  if (corps.positionnement_id === undefined || corps.positionnement_id === null || corps.positionnement_id === "") {
    champs.positionnement_id = null;
  } else {
    const p = parseIdPositif(corps.positionnement_id);
    if (!p) return { erreur: "Identifiant de positionnement invalide." };
    champs.positionnement_id = p;
  }
  return { champs };
}

// ── Q2-2 : adaptations pédagogiques (mesures opérationnelles) ──────
export const CATEGORIES_ADAPTATION = ["rythme", "supports", "accessibilite_locaux", "materiel", "modalites_evaluation", "accompagnement", "autre"];
export const STATUTS_ADAPTATION = ["prevue", "mise_en_oeuvre", "abandonnee"];
export const MAX_MESURE = 500;

const dateOuNull = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());

// Valide l'ÉTAT FINAL d'une adaptation (création, ou fusion « avant + corps »
// pour une modification). Retourne { champs } ou { erreur } — jamais le
// contenu des textes dans l'erreur.
export function lireAdaptation(corps = {}, avant = null) {
  const present = (k) => Object.prototype.hasOwnProperty.call(corps, k);
  const pris = (k) => (present(k) ? corps[k] : avant ? avant[k] : undefined);
  const categorie = pris("categorie");
  if (!CATEGORIES_ADAPTATION.includes(categorie)) return { erreur: "Catégorie d'adaptation inconnue." };
  const mesure = texte(pris("mesure"));
  if (!mesure) return { erreur: "Décrivez la mesure mise en place." };
  if (mesure.length > MAX_MESURE) return { erreur: `Mesure trop longue (${MAX_MESURE} caractères au plus).` };
  const statut = pris("statut") ?? "prevue";
  if (!STATUTS_ADAPTATION.includes(statut)) return { erreur: "Statut de la mesure inconnu." };
  const decision = dateOuNull(pris("date_decision"));
  if (!decision) return { erreur: "Indiquez la date de décision." };
  if (!estDateValide(decision)) return { erreur: "Date de décision invalide : format attendu AAAA-MM-JJ." };
  const miseEnOeuvre = dateOuNull(pris("date_mise_en_oeuvre"));
  if (miseEnOeuvre !== null && !estDateValide(miseEnOeuvre)) return { erreur: "Date de mise en œuvre invalide : format attendu AAAA-MM-JJ." };
  if (statut === "mise_en_oeuvre" && !miseEnOeuvre) return { erreur: "Indiquez la date de mise en œuvre." };
  const bilan = texte(pris("bilan"));
  if (bilan !== null && bilan.length > MAX_MESURE) return { erreur: `Bilan trop long (${MAX_MESURE} caractères au plus).` };
  return { champs: { categorie, mesure, statut, date_decision: decision, date_mise_en_oeuvre: miseEnOeuvre, bilan } };
}

// ── Q2-3 : abandon enrichi et suivi factuel du décrochage ──────────
export const CATEGORIES_ABANDON = ["personnel", "professionnel", "financement", "reorientation", "sans_nouvelles", "autre"];
export const MAX_MOTIF_ABANDON = 300;
export const TYPES_SUIVI = ["signal", "relance"];
export const CATEGORIES_SUIVI = {
  signal: ["absences_repetees", "retards_repetes", "difficulte_pedagogique", "sans_nouvelles", "autre"],
  relance: ["sans_reponse", "echange_realise", "entretien_realise", "autre"],
};
export const CANAUX_RELANCE = ["email", "telephone", "presentiel", "autre"];
export const MAX_NOTE_SUIVI = 300;

// Champs FACULTATIFS de l'abandon. `undefined` = inchangé, null / "" = effacé.
// Retourne { champs } (clés présentes seulement) ou { erreur } — jamais le texte.
export function lireAbandon(corps = {}) {
  const champs = {};
  if (corps.categorie_abandon !== undefined) {
    const c = texte(corps.categorie_abandon);
    if (c !== null && !CATEGORIES_ABANDON.includes(c)) return { erreur: "Catégorie d'abandon inconnue." };
    champs.categorie_abandon = c;
  }
  if (corps.motif_abandon !== undefined) {
    const m = texte(corps.motif_abandon);
    if (m !== null && m.length > MAX_MOTIF_ABANDON) return { erreur: `Précision trop longue (${MAX_MOTIF_ABANDON} caractères au plus).` };
    champs.motif_abandon = m;
  }
  return { champs };
}

// Valide l'ÉTAT FINAL d'un événement de suivi (création, ou « avant + corps »).
// Le type n'est jamais modifiable après création.
export function lireSuivi(corps = {}, avant = null) {
  const present = (k) => Object.prototype.hasOwnProperty.call(corps, k);
  const pris = (k) => (present(k) ? corps[k] : avant ? avant[k] : undefined);
  const type = avant ? avant.type : corps.type;
  if (avant && present("type") && corps.type !== avant.type) return { erreur: "Le type d'un événement de suivi ne se modifie pas." };
  if (!TYPES_SUIVI.includes(type)) return { erreur: "Type d'événement de suivi inconnu." };
  const date = dateOuNull(pris("date_evenement"));
  if (!date) return { erreur: "Indiquez la date de l'événement." };
  if (!estDateValide(date)) return { erreur: "Date de l'événement invalide : format attendu AAAA-MM-JJ." };
  const categorie = texte(pris("categorie"));
  if (!CATEGORIES_SUIVI[type].includes(categorie)) return { erreur: "Catégorie de suivi inconnue pour ce type d'événement." };
  let canal = texte(pris("canal"));
  if (type === "relance") {
    if (!CANAUX_RELANCE.includes(canal)) return { erreur: "Indiquez le canal de la relance." };
  } else if (canal !== null) return { erreur: "Un signal observé n'a pas de canal." };
  else canal = null;
  const note = texte(pris("note"));
  if (note !== null && note.length > MAX_NOTE_SUIVI) return { erreur: `Note trop longue (${MAX_NOTE_SUIVI} caractères au plus).` };
  return { champs: { type, date_evenement: date, categorie, canal, note } };
}
