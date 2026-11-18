// Inventaire des modèles : suggestions, classement et export CSV. Module PUR (aucun accès Drive ni base).
// Rien de ce module n'est enregistré : les propositions sont des brouillons à valider par un administrateur.

import { PORTEES, TYPES_DOCUMENT } from "./modelesBibliotheque.js";

// Brouillon d'indicateurs Qualiopi par type (numéros du référentiel). Proposition seulement :
// jamais attribuée automatiquement, toujours à valider.
export const INDICATEURS_SUGGERES = {
  attestation: [11],
  convocation: [9],
  emargement: [10],
  fiche_recapitulative: [2, 10, 11],
  convention: [1, 2],
  compte_rendu: [30],
  evaluation: [8, 11],
  bilan: [11, 32],
  programme: [1, 2, 19],
  scenario_pedagogique: [4, 19],
  questionnaire: [7, 30],
  autre: [],
};

const sansAccents = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Règles de nom, dans l'ordre : la première qui correspond l'emporte.
const REGLES_TYPE = [
  [/recapitulative|recapitulatif/, "fiche_recapitulative", "récapitulative"],
  [/convocation/, "convocation", "convocation"],
  [/attestation/, "attestation", "attestation"],
  [/emargement/, "emargement", "émargement"],
  [/convention/, "convention", "convention"],
  [/compte[ -]?rendu/, "compte_rendu", "compte rendu"],
  [/evaluation/, "evaluation", "évaluation"],
  [/bilan/, "bilan", "bilan"],
  [/programme/, "programme", "programme"],
  [/scenario/, "scenario_pedagogique", "scénario"],
  [/questionnaire/, "questionnaire", "questionnaire"],
];

const REGLES_PORTEE = [
  [/stagiaire/, "stagiaire"],
  [/groupe/, "groupe"],
  [/formation/, "formation"],
  [/session|fiche/, "session"],
];

// Suggestion de type et de portée à partir du nom, avec les motifs (pour que l'administrateur juge).
export function proposer({ nom }) {
  const n = sansAccents(nom);
  const motifs = [];
  const regle = REGLES_TYPE.find(([re]) => re.test(n));
  const type = regle ? regle[1] : "autre";
  motifs.push(regle ? `type déduit du mot « ${regle[2]} » dans le nom` : "aucun mot-clé de type dans le nom");
  const portee = (REGLES_PORTEE.find(([re]) => re.test(n)) || [null, null])[1];
  motifs.push(portee ? `portée déduite du nom : ${portee}` : "portée non déductible du nom : à déterminer");
  motifs.push("mode proposé : manuel (aucun déclenchement automatique n'est implémenté)");
  return {
    type_document: TYPES_DOCUMENT.includes(type) ? type : "autre",
    portee: portee && PORTEES.includes(portee) ? portee : null,
    mode_generation: "manuel",
    indicateurs: [...INDICATEURS_SUGGERES[type]],
    motifs,
    statut: "proposition_non_enregistree",
  };
}

// Classement d'un modèle candidat à partir de son diagnostic (lecture seule, déjà produit).
// « utilisable » seulement si rien à corriger : aucune erreur, aucune balise inconnue ou
// historique, aucun avertissement, et fichier non à la corbeille.
export function classer(diagnostic) {
  const motifs = [];
  if (diagnostic.trashed) motifs.push("fichier à la corbeille Drive");
  if (diagnostic.etat === "invalide") motifs.push(`erreur(s) : ${diagnostic.erreurs.length}`);
  if ((diagnostic.inconnues || []).length) motifs.push(`balise(s) inconnue(s) : ${diagnostic.inconnues.length}`);
  const aMigrer = aMigrerDe(diagnostic);
  if (aMigrer.length) motifs.push(`balise(s) à migrer vers le catalogue canonique : ${aMigrer.length}`);
  if (diagnostic.etat === "valide_avec_avertissements") motifs.push(`avertissement(s) : ${diagnostic.avertissements.length}`);
  return { statut: motifs.length ? "correction" : "utilisable", motifs };
}

// Balises à migrer : historiques, et alias ayant une cible canonique.
function aMigrerDe(diagnostic) {
  return [...(diagnostic.historiques || []), ...(diagnostic.alias || []).map((a) => a.alias)];
}

// Balises d'un diagnostic, réparties en trois familles pour l'affichage.
export function marqueursDe(diagnostic) {
  return {
    reconnus: [...(diagnostic.canoniques || [])],
    historiques: aMigrerDe(diagnostic),
    inconnus: [...(diagnostic.inconnues || [])],
  };
}

// Cellule CSV sûre : échappement des guillemets, et neutralisation des formules (=, +, -, @, tabulation).
export function cellule(valeur) {
  let texte = valeur === null || valeur === undefined ? "" : String(valeur);
  if (/^[=+\-@\t\r]/.test(texte)) texte = `'${texte}`;
  if (/[";\r\n]/.test(texte)) texte = `"${texte.replace(/"/g, '""')}"`;
  return texte;
}

// CSV (séparateur « ; », UTF-8 avec marque d'ordre des octets, fins de ligne CRLF).
export function versCsv(colonnes, lignes) {
  const entete = colonnes.map((c) => cellule(c.titre)).join(";");
  const corps = lignes.map((l) => colonnes.map((c) => cellule(c.valeur(l))).join(";"));
  return "﻿" + [entete, ...corps].join("\r\n") + "\r\n";
}
