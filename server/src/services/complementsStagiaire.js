// Compléments de la fiche stagiaire demandés par les documents A2C (migration 044) : coordonnées, entreprise.
// Validation stricte : types et longueurs bornés (jamais renvoyer le contenu saisi dans un message d'erreur).
import { estDateValide } from "./dates.js";

export const DOMAINES_HANDICAP = ["moteur", "visuel", "auditif", "psychique", "deficience_intellectuelle", "maladie_invalidante"];

const LIMITES = {
  adresse: 300, code_postal: 10, ville: 100, profession: 150, entreprise_adresse: 300, entreprise_siret: 20,
  entreprise_ape: 10, entreprise_effectifs: 30, entreprise_responsable: 150, entreprise_opca: 150,
};

// Renvoie { champs } (seulement les clés présentes dans le corps ; "" = effacement) ou { erreur }.
export function lireComplementsStagiaire(corps = {}) {
  const champs = {};
  for (const [col, max] of Object.entries(LIMITES)) {
    if (corps[col] === undefined) continue;
    if (corps[col] !== null && typeof corps[col] !== "string") return { erreur: "Valeur invalide pour un champ de la fiche." };
    const v = (corps[col] || "").trim();
    if (v.length > max) return { erreur: "Valeur trop longue pour un champ de la fiche." };
    champs[col] = v || null;
  }
  if (champs.entreprise_siret && !/^[0-9 ]{9,20}$/.test(champs.entreprise_siret)) return { erreur: "SIRET invalide : chiffres uniquement." };
  if (corps.date_naissance !== undefined) {
    const d = corps.date_naissance === null ? "" : String(corps.date_naissance).trim();
    if (d && (!estDateValide(d) || d > new Date().toISOString().slice(0, 10) || d < "1900-01-01")) return { erreur: "Date de naissance invalide : format attendu AAAA-MM-JJ." };
    champs.date_naissance = d || null;
  }
  return { champs };
}

// Contact du prescripteur (structure) : repris par les variables prescripteur_* dans les documents d'un stagiaire adressé par lui.
const LIMITES_PRESCRIPTEUR = { adresse: 300, contact_nom: 150, contact_fonction: 150, contact_email: 200, contact_telephone: 30 };
export function lireContactPrescripteur(corps = {}) {
  const champs = {};
  for (const [col, max] of Object.entries(LIMITES_PRESCRIPTEUR)) {
    if (corps[col] === undefined) continue;
    if (corps[col] !== null && typeof corps[col] !== "string") return { erreur: "Valeur invalide pour un champ du prescripteur." };
    const v = (corps[col] || "").trim();
    if (v.length > max) return { erreur: "Valeur trop longue pour un champ du prescripteur." };
    champs[col] = v || null;
  }
  if (champs.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(champs.contact_email)) return { erreur: "E-mail du contact invalide." };
  return { champs };
}
