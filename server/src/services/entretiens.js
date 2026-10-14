// ─────────────────────────────────────────────────────────────
//  DOC-9C — Clés et validation des réponses d'entretien FSE-IA.
//  Module PUR : aucune base, aucun réseau.
//
//  La liste des clés est FERMÉE : toute clé inconnue est refusée (jamais
//  inventée). La source (jeune / accompagnateur) est DÉRIVÉE de la clé,
//  jamais choisie par l'appelant. Le questionnaire des six phases (rubrique 8)
//  n'est PAS modélisé ici : ses questions réelles seront introduites dans une
//  étape ultérieure, sans jamais être inventées.
//  Aucune donnée médicale, diagnostic, RQTH ni handicap.
// ─────────────────────────────────────────────────────────────

// Clé → source imposée. La rubrique 2 (handicap), la rubrique 8 (six phases),
// la rubrique 12 (suivi) et la rubrique 14 (signatures) sont VOLONTAIREMENT
// absentes de ce socle.
export const CLES_ENTRETIEN = Object.freeze({
  // Rubrique 3 — motif de la venue et attentes du jeune
  motif_venue: "jeune",
  attentes: "jeune",
  // Rubrique 4 — parcours scolaire, de formation et expériences
  parcours_scolaire: "jeune",
  // Rubrique 5 — compétences, qualités et ressources personnelles
  competences_ressources: "jeune",
  // Rubrique 6 — centres d'intérêt, motivation et posture
  centres_interet: "jeune",
  motivation: "jeune",
  posture: "accompagnateur",
  // Rubrique 7 — environnement, mobilité et freins à l'insertion
  environnement: "jeune",
  mobilite: "jeune",
  freins_insertion: "jeune",
  // Rubrique 9 — projet professionnel et projection dans l'avenir
  projet_professionnel: "jeune",
  // Rubrique 10 — plan d'action individualisé (accompagnateur)
  plan_action: "accompagnateur",
  // Rubrique 11 — synthèse du premier entretien (réservée accompagnateur)
  synthese: "accompagnateur",
  // Rubrique 13 — la parole du jeune (verbatim, jamais reformulée)
  parole_jeune: "jeune",
});

export const MAX_REPONSE = 4000;

// Valide UNE réponse `{ cle, valeur }`. Renvoie `{ cle, valeur, source }`
// normalisée, ou `{ erreur }`. La source est imposée par la clé.
export function validerReponse(r) {
  const cle = typeof r?.cle === "string" ? r.cle.trim() : "";
  if (!cle) return { erreur: "Clé manquante." };
  const source = CLES_ENTRETIEN[cle];
  if (!source) return { erreur: `Clé inconnue : ${cle}.` };
  const valeur = typeof r?.valeur === "string" ? r.valeur.trim() : "";
  if (!valeur) return { erreur: `Réponse vide pour « ${cle} ».` };
  if (valeur.length > MAX_REPONSE) return { erreur: `Réponse trop longue pour « ${cle} ».` };
  return { cle, valeur, source };
}

// Valide une LISTE de réponses. Renvoie `{ reponses }` ou `{ erreur }`
// (première erreur). Refuse les clés en double (une seule valeur par clé).
export function validerReponses(liste) {
  if (!Array.isArray(liste)) return { erreur: "Réponses invalides : liste attendue." };
  const vues = new Set();
  const reponses = [];
  for (const r of liste) {
    const v = validerReponse(r);
    if (v.erreur) return { erreur: v.erreur };
    if (vues.has(v.cle)) return { erreur: `Clé en double : ${v.cle}.` };
    vues.add(v.cle);
    reponses.push(v);
  }
  return { reponses };
}
