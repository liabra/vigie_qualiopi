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

// Clé → source imposée. La rubrique 2 (handicap), la rubrique 8 (six phases,
// cf. positionnementEntretien.js), la rubrique 12 (suivi) et la rubrique 14
// (signatures) sont VOLONTAIREMENT absentes de ce socle.
//
// DOC-9D3 lot B : complété depuis l'audit
// `modeles-local/entree/FSE-IA_Audit_questions_hors_positionnement.md` —
// chaque nouvelle clé correspond à UNE question distincte du modèle réel,
// jamais une fusion de plusieurs questions dans un seul champ.
export const CLES_ENTRETIEN = Object.freeze({
  // Rubrique 1 — identification et accueil (complément : référent, précisions)
  referent_accompagnateur: "accompagnateur",
  precision_origine_contact: "jeune",
  precision_financeur_origine: "jeune",
  // Rubrique 3 — motif de la venue et attentes du jeune
  motif_venue: "jeune",
  attentes: "jeune",
  resume_demande: "jeune",
  precision_objectifs_autre: "jeune",
  // Rubrique 4 — parcours scolaire, de formation et expériences
  parcours_scolaire: "jeune",
  dernier_etablissement: "jeune",
  derniere_classe: "jeune",
  diplomes_obtenus: "jeune",
  decrochage_explication: "jeune",
  // Rubrique 5 — compétences, qualités et ressources personnelles
  competences_ressources: "jeune",
  qualites_principales: "jeune",
  ce_que_les_autres_disent: "jeune",
  chose_a_apprendre: "jeune",
  // Rubrique 6 — centres d'intérêt, motivation et posture
  centres_interet: "jeune",
  motivation: "jeune",
  ce_qui_demotive: "jeune",
  reaction_echec: "jeune",
  posture: "accompagnateur",
  // Rubrique 7 — environnement, mobilité et freins à l'insertion
  environnement: "jeune",
  mobilite: "jeune",
  freins_insertion: "jeune",
  precision_logement_autre: "jeune",
  precision_freins_autre: "jeune",
  precision_ressources_autre: "jeune",
  // Rubrique 9 — projet professionnel et projection dans l'avenir
  projet_professionnel: "jeune",
  metiers_envisages: "jeune",
  raison_interet_metiers: "jeune",
  metier_a_eviter: "jeune",
  projection_3_mois: "jeune",
  projection_1_an: "jeune",
  projection_fin_parcours: "jeune",
  precision_valeurs_autre: "jeune",
  // Rubrique 10 — plan d'action individualisé (accompagnateur, cf. aussi
  // le tableau répétable entretienLignes.js)
  plan_action: "accompagnateur",
  // Rubrique 11 — synthèse du premier entretien (réservée accompagnateur)
  synthese: "accompagnateur",
  synthese_situation: "accompagnateur",
  synthese_demandes: "accompagnateur",
  synthese_besoins: "accompagnateur",
  synthese_points_forts: "accompagnateur",
  synthese_freins: "accompagnateur",
  synthese_orientations: "accompagnateur",
  synthese_proposition_parcours: "accompagnateur",
  // Rubrique 13 — la parole du jeune (verbatim, jamais reformulée)
  parole_jeune: "jeune",
  parole_fierte: "jeune",
  parole_reussite: "jeune",
});

// DOC-9D3 lot B — Sélections FERMÉES (une seule valeur parmi un ensemble
// fixe), réutilisant `entretien_reponses` : la clé est la même mécanique
// que CLES_ENTRETIEN, mais `valeur` doit être un des codes listés, jamais
// un texte libre.
export const SELECTS_ENTRETIEN = Object.freeze({
  tranche_age: { source: "jeune", options: ["14_15", "16_17", "18_20"] },
  session_envisagee: { source: "accompagnateur", options: ["session_1", "session_2"] },
  origine_contact: {
    source: "jeune",
    options: ["spontanee", "etablissement_scolaire", "mission_locale", "france_travail", "famille_proche", "travailleur_social", "association_partenaire", "autre"],
  },
  financeur_origine: { source: "jeune", options: ["fse_ia", "autre"] },
  decrochage: { source: "jeune", options: ["oui", "non"] },
  logement: { source: "jeune", options: ["parents", "seul", "proche", "autre"] },
  sais_quoi_faire: { source: "jeune", options: ["precisement", "une_idee", "plusieurs_idees", "ne_sait_pas"] },
});

// DOC-9D3 lot B — Échelles numériques fermées (bornes incluses), aucune
// valeur par défaut : une échelle non répondue est simplement absente.
export const ECHELLES_ENTRETIEN = Object.freeze({
  confiance_en_soi: { source: "jeune", min: 0, max: 10 },
});

// DOC-9D3 lot B — Dates au format ISO (YYYY-MM-DD), validées par forme
// uniquement (aucune date de naissance ni date future n'est « inventée »
// par une valeur par défaut).
export const DATES_ENTRETIEN = Object.freeze({
  date_naissance: { source: "jeune" },
  date_entree_accompagnement: { source: "accompagnateur" },
});

const REGEX_DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_REPONSE = 4000;

// Valide UNE réponse `{ cle, valeur }`. Renvoie `{ cle, valeur, source }`
// normalisée, ou `{ erreur }`. La source est imposée par la clé, jamais
// choisie par l'appelant. Dispatché selon le TYPE de la clé (texte libre /
// sélection fermée / échelle / date) — un seul mécanisme de stockage
// (`entretien_reponses`), plusieurs règles de validation.
export function validerReponse(r) {
  const cle = typeof r?.cle === "string" ? r.cle.trim() : "";
  if (!cle) return { erreur: "Clé manquante." };
  const valeurBrute = typeof r?.valeur === "string" ? r.valeur.trim() : "";
  if (!valeurBrute) return { erreur: `Réponse vide pour « ${cle} ».` };

  if (CLES_ENTRETIEN[cle]) {
    if (valeurBrute.length > MAX_REPONSE) return { erreur: `Réponse trop longue pour « ${cle} ».` };
    return { cle, valeur: valeurBrute, source: CLES_ENTRETIEN[cle] };
  }
  const select = SELECTS_ENTRETIEN[cle];
  if (select) {
    if (!select.options.includes(valeurBrute)) return { erreur: `Valeur invalide pour « ${cle} ».` };
    return { cle, valeur: valeurBrute, source: select.source };
  }
  const echelle = ECHELLES_ENTRETIEN[cle];
  if (echelle) {
    const n = Number(valeurBrute);
    if (!Number.isInteger(n) || n < echelle.min || n > echelle.max) return { erreur: `Valeur hors échelle pour « ${cle} ».` };
    return { cle, valeur: String(n), source: echelle.source };
  }
  const dateDef = DATES_ENTRETIEN[cle];
  if (dateDef) {
    if (!REGEX_DATE_ISO.test(valeurBrute) || Number.isNaN(new Date(valeurBrute).getTime())) {
      return { erreur: `Date invalide pour « ${cle} » (AAAA-MM-JJ attendu).` };
    }
    return { cle, valeur: valeurBrute, source: dateDef.source };
  }
  return { erreur: `Clé inconnue : ${cle}.` };
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
