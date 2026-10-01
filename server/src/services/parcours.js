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
