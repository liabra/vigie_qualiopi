// DOC-9D2 — Miroir CÔTÉ CLIENT de `server/src/services/entretiens.js`
// (CLES_ENTRETIEN) : uniquement pour l'affichage (libellé, écran, source).
// La validation réelle et la liste fermée des clés restent UNIQUEMENT côté
// serveur — ce module ne doit jamais être utilisé pour décider si une clé
// est acceptée, seulement pour l'organiser à l'écran.
//
// La rubrique 2 (handicap) et la rubrique 8 (questionnaire des six phases)
// sont VOLONTAIREMENT absentes : la première reste hors saisie ordinaire
// (validation métier préalable requise), la seconde attend la lecture du
// modèle réel (DOC-9D2, lot B) — aucune question n'est inventée ici.

export const ECRANS_ENTRETIEN = [
  { id: 1, titre: "Accueil et identification" },
  { id: 2, titre: "Attentes, parcours et compétences" },
  { id: 3, titre: "Motivation et environnement" },
  { id: 4, titre: "Positionnement pédagogique" },
  { id: 5, titre: "Projet et conclusion" },
];

// cle → { ecran, rubrique, libelle, source, aide }
export const CHAMPS_ENTRETIEN = {
  motif_venue: { ecran: 2, rubrique: 3, libelle: "Motif de la venue", source: "jeune" },
  attentes: { ecran: 2, rubrique: 3, libelle: "Attentes", source: "jeune" },
  parcours_scolaire: { ecran: 2, rubrique: 4, libelle: "Parcours scolaire, de formation et expériences", source: "jeune" },
  competences_ressources: { ecran: 2, rubrique: 5, libelle: "Compétences, qualités et ressources personnelles", source: "jeune" },

  centres_interet: { ecran: 3, rubrique: 6, libelle: "Centres d'intérêt", source: "jeune" },
  motivation: { ecran: 3, rubrique: 6, libelle: "Motivation", source: "jeune" },
  posture: { ecran: 3, rubrique: 6, libelle: "Posture observée", source: "accompagnateur" },
  environnement: { ecran: 3, rubrique: 7, libelle: "Environnement", source: "jeune" },
  mobilite: { ecran: 3, rubrique: 7, libelle: "Mobilité", source: "jeune" },
  freins_insertion: { ecran: 3, rubrique: 7, libelle: "Freins à l'insertion", source: "jeune" },

  projet_professionnel: { ecran: 5, rubrique: 9, libelle: "Projet professionnel et projection dans l'avenir", source: "jeune" },
  plan_action: { ecran: 5, rubrique: 10, libelle: "Plan d'action individualisé", source: "accompagnateur" },
  synthese: { ecran: 5, rubrique: 11, libelle: "Synthèse du premier entretien (réservée à l'accompagnateur)", source: "accompagnateur" },
  parole_jeune: { ecran: 5, rubrique: 13, libelle: "La parole du jeune (verbatim, non reformulé)", source: "jeune" },
};

export function champsDeLecran(ecranId) {
  return Object.entries(CHAMPS_ENTRETIEN)
    .filter(([, c]) => c.ecran === ecranId)
    .map(([cle, c]) => ({ cle, ...c }));
}

export function libelleSource(source) {
  return source === "jeune" ? "Réponse du jeune" : "Observation de l'accompagnateur";
}
