// ─────────────────────────────────────────────────────────────
//  DOC-9E — Construction du TEXTE de la fiche d'entretien FSE-IA, à partir
//  des données structurées d'un entretien VALIDÉ (entretien_reponses,
//  entretien_choix, entretien_experiences, entretien_plan_action,
//  entretien_positionnement_*). Module PUR : aucune base, aucun Google.
//
//  Le modèle Drive officiel reste inaccessible dans cet environnement
//  (DOC-9D2/DOC-9E) : ce module ne RÉPLIQUE pas sa mise en page exacte,
//  il restitue fidèlement les RUBRIQUES, l'ORDRE et les DONNÉES, en texte
//  structuré (titres + paragraphes), pas en tableaux Google natifs — une
//  simplification délibérée, documentée comme limite dans
//  `VIGIE_AGENT_LOG.md`, jamais présentée comme le rendu officiel.
//
//  Règle absolue : une donnée ABSENTE reste ABSENTE (omise ou « — »),
//  JAMAIS remplacée par une supposition. La rubrique 2 (handicap) n'est
//  jamais rendue : ni ses données (qui n'existent dans aucune table ici),
//  ni une fausse mention comme « Aucun handicap déclaré ».
// ─────────────────────────────────────────────────────────────

import { CLES_ENTRETIEN, SELECTS_ENTRETIEN, DATES_ENTRETIEN, ECHELLES_ENTRETIEN } from "./entretiens.js";
import { REFERENTIELS_CHOIX } from "./entretienChoix.js";
import { PHASES_POSITIONNEMENT } from "./positionnementEntretien.js";

// Libellés d'AFFICHAGE uniquement (miroir du client, `entretienFormat.js`) —
// la validation des clés/valeurs reste exclusivement dans les modules
// qu'elle importe ci-dessus. Une clé sans libellé ici utilise son nom brut
// (jamais bloquant, jamais une raison de ne pas restituer une réponse).
const LIBELLES_CHAMPS = {
  referent_accompagnateur: "Référent / accompagnateur", date_naissance: "Date de naissance",
  tranche_age: "Tranche d'âge", date_entree_accompagnement: "Date d'entrée dans l'accompagnement",
  session_envisagee: "Session envisagée", origine_contact: "Origine du contact",
  precision_origine_contact: "Précision (origine)", financeur_origine: "Financeur ou dispositif à l'origine de l'orientation",
  precision_financeur_origine: "Précision (financeur)",
  motif_venue: "Pourquoi viens-tu nous rencontrer aujourd'hui ?", resume_demande: "Résumé de la demande",
  attentes: "Attentes", precision_objectifs_autre: "Précision (objectif « Autre »)",
  dernier_etablissement: "Dernier établissement fréquenté", derniere_classe: "Dernière classe / niveau atteint",
  diplomes_obtenus: "Diplômes / certifications obtenus", decrochage: "Période de décrochage / interruption",
  decrochage_explication: "Explication du jeune (décrochage)",
  parcours_scolaire: "Parcours scolaire, de formation et expériences", competences_ressources: "Compétences, qualités et ressources",
  qualites_principales: "Mes principales qualités", ce_que_les_autres_disent: "Ce que les autres disent que je sais bien faire",
  chose_a_apprendre: "Une chose que j'aimerais apprendre",
  centres_interet: "Centres d'intérêt", motivation: "Ce qui me motive", ce_qui_demotive: "Ce qui me démotive",
  confiance_en_soi: "Confiance en soi (0-10)", reaction_echec: "Réaction face à l'échec", posture: "Posture observée",
  logement: "Logement", precision_logement_autre: "Précision (logement)",
  environnement: "Environnement", mobilite: "Mobilité", freins_insertion: "Freins à l'insertion",
  precision_freins_autre: "Précision (frein « Autre »)", precision_ressources_autre: "Précision (ressource « Autre »)",
  sais_quoi_faire: "Aujourd'hui, sais-tu ce que tu veux faire ?", metiers_envisages: "Métiers envisagés",
  raison_interet_metiers: "Raisons de l'intérêt", metier_a_eviter: "Ce que je ne veux surtout pas faire",
  precision_valeurs_autre: "Précision (valeur « Autre »)",
  projection_3_mois: "Dans 3 mois, j'aimerais…", projection_1_an: "Dans 1 an, j'aimerais…",
  projection_fin_parcours: "À l'issue du parcours FSE-IA, je voudrais…", projet_professionnel: "Projet professionnel",
  plan_action: "Plan d'action individualisé (synthèse libre)", synthese: "Synthèse du premier entretien (synthèse libre)",
  synthese_situation: "Situation actuelle du jeune", synthese_demandes: "Principales demandes",
  synthese_besoins: "Besoins identifiés", synthese_points_forts: "Points forts / ressources",
  synthese_freins: "Freins à prendre en compte", synthese_orientations: "Orientations / partenaires à envisager",
  synthese_proposition_parcours: "Proposition de parcours et session retenue",
  parole_jeune: "Si tu devais retenir une seule chose de cet entretien, laquelle serait-ce ?",
  parole_fierte: "De quoi es-tu fier aujourd'hui ?", parole_reussite: "Qu'aimerais-tu avoir réussi à la fin de ton parcours FSE-IA ?",
};

const LIBELLES_OPTIONS = {
  "14_15": "14-15 ans", "16_17": "16-17 ans", "18_20": "18-20 ans",
  session_1: "Session 1", session_2: "Session 2",
  spontanee: "Venue spontanée", etablissement_scolaire: "Établissement scolaire", mission_locale: "Mission Locale",
  france_travail: "France Travail", famille_proche: "Famille / proche", travailleur_social: "Travailleur social",
  association_partenaire: "Association / partenaire", autre: "Autre",
  fse_ia: "FSE-IA", oui: "Oui", non: "Non",
  parents: "Chez ses parents", seul: "Seul(e)", proche: "Hébergé(e) par un proche",
  precisement: "Oui, précisément", une_idee: "J'ai une idée", plusieurs_idees: "J'ai plusieurs idées", ne_sait_pas: "Je ne sais pas encore",
};

const LIBELLES_GROUPES = {
  objectifs_souhaites: "Objectifs souhaités", savoir_faire: "Ce que je sais faire", loisirs: "Loisirs",
  mobilite_choix: "Mobilité", freins_insertion_choix: "Freins identifiés", ressources_appui: "Ressources / points d'appui",
  valeurs_travail: "Valeurs au travail", phases_prioritaires: "Phases du parcours FSE-IA à prioriser",
};

const LIBELLES_CODES_CHOIX = {
  formation: "Formation", emploi: "Emploi", projet_professionnel: "Projet professionnel", reprise_scolarite: "Reprise de scolarité",
  projet_personnel: "Projet personnel", competences_numeriques: "Compétences numériques", demarches_administratives: "Démarches administratives",
  confiance_en_soi: "Confiance en soi", cv_lettre_entretien: "CV / lettre / entretien", decouverte_metiers: "Découverte des métiers",
  mobilite: "Mobilité", autre: "Autre",
  travailler_equipe: "Travailler en équipe", travailler_seul: "Travailler seul", communiquer: "Communiquer", ecouter: "Écouter",
  prendre_initiatives: "Prendre des initiatives", respecter_consignes: "Respecter des consignes", organiser: "M'organiser",
  resoudre_problemes: "Résoudre des problèmes", utiliser_numerique: "Utiliser le numérique", creer_imaginer: "Créer / imaginer",
  prendre_parole: "Prendre la parole", aider_autres: "Aider les autres", adapter: "M'adapter", apprendre: "Apprendre", perseverant: "Être persévérant",
  sport: "Sport", musique: "Musique", jeux_video: "Jeux vidéo", informatique_numerique: "Informatique / numérique",
  creation_artistique: "Création artistique", reseaux_sociaux: "Réseaux sociaux", lecture: "Lecture", cuisine: "Cuisine",
  mecanique: "Mécanique", bricolage: "Bricolage", nature_environnement: "Nature / environnement", animaux: "Animaux", mode_esthetique: "Mode / esthétique",
  permis_b: "Permis B", permis_en_cours: "Permis en cours", aucun_permis: "Aucun permis", vehicule: "Véhicule",
  transports_commun: "Transports en commun", difficultes_mobilite: "Difficultés de mobilité",
  qualification: "Qualification", experience: "Expérience", difficultes_scolaires: "Difficultés scolaires", numerique: "Numérique",
  situation_administrative: "Situation administrative", finances: "Finances", information: "Information", motivation: "Motivation",
  difficulte_projeter: "Difficulté à se projeter",
  famille: "Famille", amis_entourage: "Amis / entourage", association: "Association", partenaire_professionnel: "Partenaire / professionnel",
  competences: "Compétences", experiences: "Expériences", reseau_professionnel: "Réseau professionnel",
  salaire: "Salaire", securite: "Sécurité", ambiance: "Ambiance", autonomie: "Autonomie", equipe: "Équipe", contact_public: "Contact public",
  creativite: "Créativité", horaires: "Horaires", evolution: "Évolution", utilite_sociale: "Utilité sociale",
  phase_1: "Phase 1", phase_2: "Phase 2", phase_3: "Phase 3", phase_4: "Phase 4", phase_5: "Phase 5", phase_6: "Phase 6",
};

const LIBELLES_NIVEAUX = { autonome: "Autonome", avec_aide: "Avec aide", a_developper: "À développer" };
const LIBELLES_PRIORITES = { forte: "Forte", moyenne: "Moyenne", faible: "Faible" };
const LIBELLES_ETATS_PLAN = { a_faire: "À faire", en_cours: "En cours", realise: "Réalisé" };

const libelleOption = (valeur) => LIBELLES_OPTIONS[valeur] || valeur;
const libelleChamp = (cle) => LIBELLES_CHAMPS[cle] || cle;

// Rubriques REELLEMENT rendues, dans l'ordre officiel (2, 12, 14 exclues :
// hors périmètre, cf. DOC-9A/DOC-9D2/DOC-9D3).
const ECRANS_RUBRIQUES = [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13];

function ligne(libelle, valeur) {
  if (valeur == null || valeur === "") return null;
  return `${libelle} : ${valeur}`;
}

function sectionChampsSimples(rubrique, reponsesParCle) {
  const cles = Object.keys(CLES_ENTRETIEN).filter((c) => CLES_RUBRIQUE[c] === rubrique);
  const clesSelect = Object.keys(SELECTS_ENTRETIEN).filter((c) => CLES_RUBRIQUE[c] === rubrique);
  const clesEchelle = Object.keys(ECHELLES_ENTRETIEN).filter((c) => CLES_RUBRIQUE[c] === rubrique);
  const clesDate = Object.keys(DATES_ENTRETIEN).filter((c) => CLES_RUBRIQUE[c] === rubrique);
  const lignes = [];
  for (const c of [...cles, ...clesSelect, ...clesEchelle, ...clesDate]) {
    const brut = reponsesParCle[c];
    if (brut == null) continue;
    const affiche = clesSelect.includes(c) ? libelleOption(brut) : brut;
    const l = ligne(libelleChamp(c), affiche);
    if (l) lignes.push(l);
  }
  return lignes;
}

// Associe chaque clé « simple » à sa rubrique d'affichage (même découpage
// que `client/src/jeunes/entretienFormat.js`, mais ici en RUBRIQUE réelle,
// pas en écran de saisie).
const CLES_RUBRIQUE = {
  referent_accompagnateur: 1, date_naissance: 1, tranche_age: 1, date_entree_accompagnement: 1,
  session_envisagee: 1, origine_contact: 1, precision_origine_contact: 1, financeur_origine: 1, precision_financeur_origine: 1,
  motif_venue: 3, resume_demande: 3, attentes: 3, precision_objectifs_autre: 3,
  dernier_etablissement: 4, derniere_classe: 4, diplomes_obtenus: 4, decrochage: 4, decrochage_explication: 4, parcours_scolaire: 4,
  competences_ressources: 5, qualites_principales: 5, ce_que_les_autres_disent: 5, chose_a_apprendre: 5,
  centres_interet: 6, motivation: 6, ce_qui_demotive: 6, confiance_en_soi: 6, reaction_echec: 6, posture: 6,
  logement: 7, precision_logement_autre: 7, environnement: 7, mobilite: 7, freins_insertion: 7, precision_freins_autre: 7, precision_ressources_autre: 7,
  sais_quoi_faire: 9, metiers_envisages: 9, raison_interet_metiers: 9, metier_a_eviter: 9, precision_valeurs_autre: 9,
  projection_3_mois: 9, projection_1_an: 9, projection_fin_parcours: 9, projet_professionnel: 9,
  plan_action: 10,
  synthese: 11, synthese_situation: 11, synthese_demandes: 11, synthese_besoins: 11, synthese_points_forts: 11,
  synthese_freins: 11, synthese_orientations: 11, synthese_proposition_parcours: 11,
  parole_jeune: 13, parole_fierte: 13, parole_reussite: 13,
};

const GROUPES_RUBRIQUE = {
  objectifs_souhaites: 3, savoir_faire: 5, loisirs: 6, mobilite_choix: 7, freins_insertion_choix: 7,
  ressources_appui: 7, valeurs_travail: 9, phases_prioritaires: 11,
};

function sectionGroupesChoix(rubrique, choixParGroupe) {
  const lignes = [];
  for (const [groupe, codes] of Object.entries(choixParGroupe)) {
    if (GROUPES_RUBRIQUE[groupe] !== rubrique || !codes.length) continue;
    const libelles = codes.map((c) => LIBELLES_CODES_CHOIX[c] || c);
    lignes.push(`${LIBELLES_GROUPES[groupe] || groupe} : ${libelles.join(", ")}`);
  }
  return lignes;
}

function sectionTableauExperiences(experiences) {
  if (!experiences.length) return [];
  const lignes = ["Expériences (lignes répétables) :"];
  experiences.forEach((e, i) => {
    const champs = [
      e.structure && `Structure : ${e.structure}`, e.duree && `Durée : ${e.duree}`,
      e.missions && `Missions : ${e.missions}`, e.retenue && `Ce que j'en retiens : ${e.retenue}`,
    ].filter(Boolean);
    lignes.push(`  ${i + 1}. ${champs.join(" — ") || "(ligne sans détail)"}`);
  });
  return lignes;
}

function sectionTableauPlanAction(planAction) {
  if (!planAction.length) return [];
  const lignes = ["Plan d'action individualisé (lignes répétables) :"];
  planAction.forEach((l, i) => {
    const champs = [
      l.objectif && `Objectif : ${l.objectif}`,
      l.phase && `Phase concernée : Phase ${l.phase}`,
      l.action && `Action à réaliser : ${l.action}`,
      l.echeance && `Échéance : ${l.echeance}`,
      l.etat && `État d'avancement : ${LIBELLES_ETATS_PLAN[l.etat] || l.etat}`,
    ].filter(Boolean);
    lignes.push(`  ${i + 1}. ${champs.join(" — ") || "(ligne sans détail)"}`);
  });
  return lignes;
}

// Rubrique 8 — les 34 compétences, EXACTEMENT comme évaluées (aucune non
// évaluée n'est présentée comme un niveau choisi).
function sectionPositionnement(evaluations, phases) {
  const niveauParCode = Object.fromEntries(evaluations.map((e) => [e.competence_code, e.niveau]));
  const phaseParNumero = Object.fromEntries(phases.map((p) => [p.phase, p]));
  const lignes = [];
  for (const phase of PHASES_POSITIONNEMENT) {
    lignes.push(`Phase ${phase.phase} — ${phase.titre} (${phase.dureeHeures} h)`);
    for (const c of phase.competences) {
      const niveau = niveauParCode[c.code];
      lignes.push(`  ${c.libelle} : ${niveau ? LIBELLES_NIVEAUX[niveau] : "(non évalué)"}`);
    }
    const p = phaseParNumero[phase.phase];
    lignes.push(`  Priorité pour ce parcours : ${p?.priorite ? LIBELLES_PRIORITES[p.priorite] : "(non renseignée)"}`);
    if (p?.observations) lignes.push(`  Observations de l'accompagnateur : ${p.observations}`);
    lignes.push("");
  }
  return lignes;
}

const TITRES_RUBRIQUES = {
  1: "1. Identification et accueil du jeune",
  3: "3. Motif de la venue et attentes du jeune",
  4: "4. Parcours scolaire, de formation et expériences",
  5: "5. Compétences, qualités et ressources personnelles",
  6: "6. Centres d'intérêt, motivation et posture",
  7: "7. Environnement, mobilité et freins à l'insertion",
  8: "8. Questionnaire de positionnement — les six phases du parcours FSE-IA",
  9: "9. Projet professionnel et projection dans l'avenir",
  10: "10. Plan d'action individualisé",
  11: "11. Synthèse du premier entretien",
  13: "13. La parole du jeune",
};

// Construit le texte INTÉGRAL de la fiche à partir des données structurées
// d'un entretien. `donnees` : { stagiaire, entretien, reponses (cle→valeur),
// choix ([{groupe,code}]), lignes ({experiences,plan_action}),
// positionnement ({evaluations,phases}) }. Ne lève jamais : une donnée
// manquante produit simplement une section plus courte, jamais une erreur
// ni une valeur inventée.
export function construireTexteFiche({ stagiaire, entretien, reponses, choix, lignes, positionnement }) {
  const reponsesParCle = Object.fromEntries((reponses || []).map((r) => [r.cle, r.valeur]));
  const choixParGroupe = {};
  for (const c of choix || []) {
    if (!choixParGroupe[c.groupe]) choixParGroupe[c.groupe] = [];
    choixParGroupe[c.groupe].push(c.code);
  }

  const blocs = [];
  blocs.push("FICHE D'ENTRETIEN INITIAL FSE-IA");
  blocs.push(`Entretien n°${entretien.id} — statut : ${entretien.statut}${entretien.valide_le ? `, validé le ${new Date(entretien.valide_le).toLocaleDateString("fr-FR")}` : ""}`);
  blocs.push("");

  for (const rubrique of ECRANS_RUBRIQUES) {
    const corps = [];
    if (rubrique === 8) {
      corps.push(...sectionPositionnement(positionnement?.evaluations || [], positionnement?.phases || []));
    } else {
      corps.push(...sectionChampsSimples(rubrique, reponsesParCle));
      corps.push(...sectionGroupesChoix(rubrique, choixParGroupe));
      if (rubrique === 4) corps.push(...sectionTableauExperiences(lignes?.experiences || []));
      if (rubrique === 10) corps.push(...sectionTableauPlanAction(lignes?.plan_action || []));
    }
    blocs.push(TITRES_RUBRIQUES[rubrique]);
    blocs.push(corps.length ? corps.join("\n") : "(aucune réponse renseignée)");
    blocs.push("");
  }

  blocs.push("2. Prise en compte des besoins spécifiques et du handicap");
  blocs.push("Rubrique hors périmètre de cette génération automatique — validation de confidentialité préalable requise.");
  blocs.push("");
  blocs.push("12. Suivi de l'évolution du jeune sur le parcours");
  blocs.push("Évolutif : consultable dans le module Accompagnement, non dupliqué ici.");
  blocs.push("");
  blocs.push("14. Engagement et signatures");
  blocs.push("Lieu, date, signature du jeune et de l'accompagnateur : à compléter manuellement sur le document.");

  return blocs.join("\n");
}
