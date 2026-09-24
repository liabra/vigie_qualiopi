// ─────────────────────────────────────────────────────────────
//  Historique des audits : validation et mise en forme des champs.
//  Module PUR, sans base ni réseau, pour que les règles soient
//  testables seules.
//
//  Les valeurs admises reprennent EXACTEMENT les contraintes CHECK
//  de la table (migration 001). Les valider ici permet de répondre
//  400 avec un message clair, au lieu de laisser Postgres renvoyer
//  une violation de contrainte en 500.
// ─────────────────────────────────────────────────────────────

import { estDateValide } from "./dates.js";

export const TYPES_AUDIT = ["initial", "surveillance", "renouvellement", "blanc", "interne"];
export const RESULTATS_AUDIT = ["en_attente", "certifie", "maintenu", "non_certifie", "suspendu"];

// Une non-conformité par ligne dans le formulaire.
export function normaliserNonConformites(valeur) {
  const lignes = Array.isArray(valeur)
    ? valeur
    : typeof valeur === "string" ? valeur.split("\n") : [];
  return lignes.map((l) => String(l).trim()).filter(Boolean);
}

const texte = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());

function entierPositif(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;   // null = refusé
}

// Colonnes acceptées → valeurs prêtes pour la base. SEULES les clés
// présentes dans le corps ressortent : c'est ce qui permet au PATCH de
// ne toucher que ce que l'appelant a envoyé.
export function champsAudit(corps = {}) {
  const champs = {};
  const present = (clef) => Object.prototype.hasOwnProperty.call(corps, clef);

  if (present("type")) {
    if (!TYPES_AUDIT.includes(corps.type)) return { erreur: "Type d'audit inconnu." };
    champs.type = corps.type;
  }
  if (present("date_audit")) {
    if (!corps.date_audit) return { erreur: "La date d'audit est obligatoire." };
    if (!estDateValide(corps.date_audit)) return { erreur: "Date d'audit invalide : format attendu AAAA-MM-JJ." }; // fix
    champs.date_audit = corps.date_audit;
  }
  if (present("resultat")) {
    const r = texte(corps.resultat);
    if (r !== null && !RESULTATS_AUDIT.includes(r)) return { erreur: "Résultat d'audit inconnu." };
    champs.resultat = r;
  }
  for (const clef of ["organisme_certificateur", "auditeur", "commentaires",
                      "rapport_drive_file_id", "rapport_drive_url", "rapport_drive_nom"]) {
    if (present(clef)) champs[clef] = texte(corps[clef]);
  }
  if (present("referentiel_version_id")) {
    const v = corps.referentiel_version_id;
    champs.referentiel_version_id = v ? Number(v) : null;
    if (champs.referentiel_version_id !== null && !Number.isInteger(champs.referentiel_version_id)) {
      return { erreur: "Version de référentiel invalide." };
    }
  }
  for (const clef of ["nb_nc_mineures", "nb_nc_majeures"]) {
    if (!present(clef)) continue;
    const n = entierPositif(corps[clef]);
    if (n === null) return { erreur: "Le nombre de non-conformités doit être un entier positif." };
    champs[clef] = n;
  }
  if (present("non_conformites")) champs.non_conformites = normaliserNonConformites(corps.non_conformites);
  return { champs };
}
