// DOC-9D2/DOC-9D3 — Miroir CÔTÉ CLIENT de `server/src/services/entretiens.js`
// (CLES_ENTRETIEN, SELECTS_ENTRETIEN, ECHELLES_ENTRETIEN, DATES_ENTRETIEN) :
// uniquement pour l'affichage (libellé, écran, type de contrôle, source). La
// validation réelle et la liste fermée des clés/options restent
// UNIQUEMENT côté serveur — ce module ne doit jamais être utilisé pour
// décider si une valeur est acceptée, seulement pour organiser l'écran.
//
// La rubrique 2 (handicap) et la rubrique 8 (questionnaire des six phases,
// cf. positionnementFormat.js) sont VOLONTAIREMENT absentes : la première
// reste hors saisie ordinaire (validation métier préalable requise), la
// seconde est traitée à part (écran dédié).

export const ECRANS_ENTRETIEN = [
  { id: 1, titre: "Accueil et identification" },
  { id: 2, titre: "Attentes, parcours et compétences" },
  { id: 3, titre: "Motivation et environnement" },
  { id: 4, titre: "Positionnement pédagogique" },
  { id: 5, titre: "Projet et conclusion" },
];

// Tous les champs qui s'enregistrent via `/entretiens/:id/reponses`
// (cle → valeur, un seul mécanisme de stockage côté serveur), avec leur
// TYPE de contrôle d'affichage. `type: "texte"` = textarea libre,
// "select" = liste fermée, "echelle" = nombre borné, "date" = date ISO.
export const CHAMPS_SIMPLES = {
  // Écran 1 — identification et accueil (rubrique 1)
  referent_accompagnateur: { ecran: 1, libelle: "Référent / accompagnateur", source: "accompagnateur", type: "texte" },
  date_naissance: { ecran: 1, libelle: "Date de naissance", source: "jeune", type: "date" },
  tranche_age: { ecran: 1, libelle: "Tranche d'âge (si la date de naissance n'est pas communiquée)", source: "jeune", type: "select", options: [{ valeur: "14_15", libelle: "14–15 ans" }, { valeur: "16_17", libelle: "16–17 ans" }, { valeur: "18_20", libelle: "18–20 ans" }] },
  date_entree_accompagnement: { ecran: 1, libelle: "Date d'entrée dans l'accompagnement", source: "accompagnateur", type: "date" },
  session_envisagee: { ecran: 1, libelle: "Session envisagée", source: "accompagnateur", type: "select", options: [{ valeur: "session_1", libelle: "Session 1" }, { valeur: "session_2", libelle: "Session 2" }] },
  origine_contact: { ecran: 1, libelle: "Origine du contact", source: "jeune", type: "select", options: [
    { valeur: "spontanee", libelle: "Venue spontanée" }, { valeur: "etablissement_scolaire", libelle: "Établissement scolaire" },
    { valeur: "mission_locale", libelle: "Mission Locale" }, { valeur: "france_travail", libelle: "France Travail" },
    { valeur: "famille_proche", libelle: "Famille / proche" }, { valeur: "travailleur_social", libelle: "Travailleur social" },
    { valeur: "association_partenaire", libelle: "Association / partenaire" }, { valeur: "autre", libelle: "Autre" },
  ] },
  precision_origine_contact: { ecran: 1, libelle: "Précision (si « Autre »)", source: "jeune", type: "texte" },
  financeur_origine: { ecran: 1, libelle: "Financeur ou dispositif à l'origine de l'orientation", source: "jeune", type: "select", options: [{ valeur: "fse_ia", libelle: "FSE-IA" }, { valeur: "autre", libelle: "Autre" }] },
  precision_financeur_origine: { ecran: 1, libelle: "Précision (si « Autre »)", source: "jeune", type: "texte" },

  // Écran 2 — rubriques 3, 4, 5
  motif_venue: { ecran: 2, libelle: "Pourquoi viens-tu nous rencontrer aujourd'hui ?", source: "jeune", type: "texte" },
  resume_demande: { ecran: 2, libelle: "Si tu devais résumer ta demande en quelques mots", source: "jeune", type: "texte" },
  attentes: { ecran: 2, libelle: "Attentes", source: "jeune", type: "texte" },
  precision_objectifs_autre: { ecran: 2, libelle: "Objectif « Autre » : précision", source: "jeune", type: "texte" },
  dernier_etablissement: { ecran: 2, libelle: "Dernier établissement fréquenté", source: "jeune", type: "texte" },
  derniere_classe: { ecran: 2, libelle: "Dernière classe / niveau atteint", source: "jeune", type: "texte" },
  diplomes_obtenus: { ecran: 2, libelle: "Diplômes / certifications obtenus", source: "jeune", type: "texte" },
  decrochage: { ecran: 2, libelle: "Période de décrochage / interruption", source: "jeune", type: "select", options: [{ valeur: "oui", libelle: "Oui" }, { valeur: "non", libelle: "Non" }] },
  decrochage_explication: { ecran: 2, libelle: "Explication du jeune (si décrochage)", source: "jeune", type: "texte" },
  parcours_scolaire: { ecran: 2, libelle: "Parcours scolaire, de formation et expériences (synthèse libre)", source: "jeune", type: "texte" },
  competences_ressources: { ecran: 2, libelle: "Compétences, qualités et ressources personnelles (synthèse libre)", source: "jeune", type: "texte" },
  qualites_principales: { ecran: 2, libelle: "Mes principales qualités", source: "jeune", type: "texte" },
  ce_que_les_autres_disent: { ecran: 2, libelle: "Ce que les autres disent que je sais bien faire", source: "jeune", type: "texte" },
  chose_a_apprendre: { ecran: 2, libelle: "Une chose que j'aimerais apprendre", source: "jeune", type: "texte" },

  // Écran 3 — rubriques 6, 7
  centres_interet: { ecran: 3, libelle: "Centres d'intérêt (synthèse libre)", source: "jeune", type: "texte" },
  motivation: { ecran: 3, libelle: "Ce qui me motive", source: "jeune", type: "texte" },
  ce_qui_demotive: { ecran: 3, libelle: "Ce qui me démotive", source: "jeune", type: "texte" },
  confiance_en_soi: { ecran: 3, libelle: "Confiance en soi (0 = pas confiant, 10 = très confiant)", source: "jeune", type: "echelle", min: 0, max: 10 },
  reaction_echec: { ecran: 3, libelle: "Comment réagis-tu lorsque tu échoues ?", source: "jeune", type: "texte" },
  posture: { ecran: 3, libelle: "Posture observée", source: "accompagnateur", type: "texte" },
  logement: { ecran: 3, libelle: "Logement", source: "jeune", type: "select", options: [{ valeur: "parents", libelle: "Chez ses parents" }, { valeur: "seul", libelle: "Seul(e)" }, { valeur: "proche", libelle: "Hébergé(e) par un proche" }, { valeur: "autre", libelle: "Autre" }] },
  precision_logement_autre: { ecran: 3, libelle: "Logement « Autre » : précision", source: "jeune", type: "texte" },
  environnement: { ecran: 3, libelle: "Environnement (synthèse libre)", source: "jeune", type: "texte" },
  mobilite: { ecran: 3, libelle: "Mobilité (synthèse libre)", source: "jeune", type: "texte" },
  freins_insertion: { ecran: 3, libelle: "Freins à l'insertion (synthèse libre)", source: "jeune", type: "texte" },
  precision_freins_autre: { ecran: 3, libelle: "Frein « Autre » : précision", source: "jeune", type: "texte" },
  precision_ressources_autre: { ecran: 3, libelle: "Ressource « Autre » : précision", source: "jeune", type: "texte" },

  // Écran 5 — rubriques 9, 10, 11, 13
  sais_quoi_faire: { ecran: 5, libelle: "Aujourd'hui, sais-tu ce que tu veux faire ?", source: "jeune", type: "select", options: [
    { valeur: "precisement", libelle: "Oui, précisément" }, { valeur: "une_idee", libelle: "J'ai une idée" },
    { valeur: "plusieurs_idees", libelle: "J'ai plusieurs idées" }, { valeur: "ne_sait_pas", libelle: "Je ne sais pas encore" },
  ] },
  metiers_envisages: { ecran: 5, libelle: "Métiers envisagés", source: "jeune", type: "texte" },
  raison_interet_metiers: { ecran: 5, libelle: "Raisons de l'intérêt", source: "jeune", type: "texte" },
  metier_a_eviter: { ecran: 5, libelle: "Ce que je ne veux surtout pas faire", source: "jeune", type: "texte" },
  precision_valeurs_autre: { ecran: 5, libelle: "Valeur « Autre » : précision", source: "jeune", type: "texte" },
  projection_3_mois: { ecran: 5, libelle: "Dans 3 mois, j'aimerais…", source: "jeune", type: "texte" },
  projection_1_an: { ecran: 5, libelle: "Dans 1 an, j'aimerais…", source: "jeune", type: "texte" },
  projection_fin_parcours: { ecran: 5, libelle: "À l'issue du parcours FSE-IA, je voudrais…", source: "jeune", type: "texte" },
  projet_professionnel: { ecran: 5, libelle: "Projet professionnel et projection dans l'avenir (synthèse libre)", source: "jeune", type: "texte" },
  plan_action: { ecran: 5, libelle: "Plan d'action individualisé (synthèse libre)", source: "accompagnateur", type: "texte" },
  synthese: { ecran: 5, libelle: "Synthèse du premier entretien (synthèse libre)", source: "accompagnateur", type: "texte" },
  synthese_situation: { ecran: 5, libelle: "Situation actuelle du jeune", source: "accompagnateur", type: "texte" },
  synthese_demandes: { ecran: 5, libelle: "Principales demandes", source: "accompagnateur", type: "texte" },
  synthese_besoins: { ecran: 5, libelle: "Besoins identifiés", source: "accompagnateur", type: "texte" },
  synthese_points_forts: { ecran: 5, libelle: "Points forts / ressources", source: "accompagnateur", type: "texte" },
  synthese_freins: { ecran: 5, libelle: "Freins à prendre en compte", source: "accompagnateur", type: "texte" },
  synthese_orientations: { ecran: 5, libelle: "Orientations / partenaires à envisager", source: "accompagnateur", type: "texte" },
  synthese_proposition_parcours: { ecran: 5, libelle: "Proposition de parcours et session retenue", source: "accompagnateur", type: "texte" },
  parole_jeune: { ecran: 5, libelle: "Si tu devais retenir une seule chose de cet entretien, laquelle serait-ce ?", source: "jeune", type: "texte" },
  parole_fierte: { ecran: 5, libelle: "De quoi es-tu fier aujourd'hui ?", source: "jeune", type: "texte" },
  parole_reussite: { ecran: 5, libelle: "Qu'aimerais-tu avoir réussi à la fin de ton parcours FSE-IA ?", source: "jeune", type: "texte" },
};

export function champsSimplesDeLecran(ecranId) {
  return Object.entries(CHAMPS_SIMPLES).filter(([, c]) => c.ecran === ecranId).map(([cle, c]) => ({ cle, ...c }));
}

const LIBELLES_CHOIX = {
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
};

// Groupes de cases à cocher fermés — enregistrés via `/entretiens/:id/choix`.
export const GROUPES_CHOIX = {
  objectifs_souhaites: { ecran: 2, libelle: "Objectifs souhaités", source: "jeune", options: [
    "formation", "emploi", "projet_professionnel", "reprise_scolarite", "projet_personnel",
    "competences_numeriques", "demarches_administratives", "confiance_en_soi",
    "cv_lettre_entretien", "decouverte_metiers", "mobilite", "autre",
  ].map((c) => ({ code: c, libelle: LIBELLES_CHOIX[c] || c })) },
  savoir_faire: { ecran: 2, libelle: "Ce que je sais faire", source: "jeune", options: [
    "travailler_equipe", "travailler_seul", "communiquer", "ecouter", "prendre_initiatives",
    "respecter_consignes", "organiser", "resoudre_problemes", "utiliser_numerique",
    "creer_imaginer", "prendre_parole", "aider_autres", "adapter", "apprendre", "perseverant",
  ].map((c) => ({ code: c, libelle: LIBELLES_CHOIX[c] || c })) },
  loisirs: { ecran: 3, libelle: "Loisirs", source: "jeune", options: [
    "sport", "musique", "jeux_video", "informatique_numerique", "creation_artistique",
    "reseaux_sociaux", "lecture", "cuisine", "mecanique", "bricolage",
    "nature_environnement", "animaux", "mode_esthetique",
  ].map((c) => ({ code: c, libelle: LIBELLES_CHOIX[c] || c })) },
  mobilite_choix: { ecran: 3, libelle: "Mobilité", source: "jeune", options: ["permis_b", "permis_en_cours", "aucun_permis", "vehicule", "transports_commun", "difficultes_mobilite"].map((c) => ({ code: c, libelle: LIBELLES_CHOIX[c] || c })) },
  freins_insertion_choix: { ecran: 3, libelle: "Freins identifiés", source: "jeune", options: [
    "qualification", "experience", "confiance_en_soi", "difficultes_scolaires", "numerique",
    "mobilite", "situation_administrative", "finances", "information", "motivation",
    "difficulte_projeter", "autre",
  ].map((c) => ({ code: c, libelle: LIBELLES_CHOIX[c] || c })) },
  ressources_appui: { ecran: 3, libelle: "Ressources / points d'appui", source: "jeune", options: ["famille", "amis_entourage", "association", "partenaire_professionnel", "competences", "experiences", "motivation", "reseau_professionnel", "autre"].map((c) => ({ code: c, libelle: LIBELLES_CHOIX[c] || c })) },
  valeurs_travail: { ecran: 5, libelle: "Valeurs au travail", source: "jeune", options: [
    "salaire", "securite", "ambiance", "autonomie", "equipe", "contact_public",
    "creativite", "horaires", "evolution", "utilite_sociale", "mobilite", "autre",
  ].map((c) => ({ code: c, libelle: LIBELLES_CHOIX[c] || c })) },
  phases_prioritaires: { ecran: 5, libelle: "Phases du parcours FSE-IA à prioriser", source: "accompagnateur", options: [1, 2, 3, 4, 5, 6].map((n) => ({ code: `phase_${n}`, libelle: `Phase ${n}` })) },
};

export function groupesChoixDeLecran(ecranId) {
  return Object.entries(GROUPES_CHOIX).filter(([, g]) => g.ecran === ecranId).map(([groupe, g]) => ({ groupe, ...g }));
}

// Tableaux répétables — enregistrés via `/entretiens/:id/lignes`.
export const BLOCS_LIGNES = {
  experiences: {
    ecran: 2, libelle: "Expériences (lignes répétables)", source: "jeune",
    colonnes: [
      { cle: "structure", libelle: "Expérience / activité — Structure", type: "texte" },
      { cle: "duree", libelle: "Durée", type: "texte" },
      { cle: "missions", libelle: "Missions réalisées", type: "texte" },
      { cle: "retenue", libelle: "Ce que j'en retiens", type: "texte" },
    ],
  },
  plan_action: {
    ecran: 5, libelle: "Plan d'action individualisé (lignes répétables)", source: "accompagnateur",
    colonnes: [
      { cle: "objectif", libelle: "Objectif", type: "texte" },
      { cle: "phase", libelle: "Phase concernée", type: "select", options: [1, 2, 3, 4, 5, 6].map((n) => ({ valeur: String(n), libelle: `Phase ${n}` })) },
      { cle: "action", libelle: "Action à réaliser", type: "texte" },
      { cle: "echeance", libelle: "Échéance", type: "texte" },
      { cle: "etat", libelle: "État d'avancement", type: "select", options: [{ valeur: "a_faire", libelle: "À faire" }, { valeur: "en_cours", libelle: "En cours" }, { valeur: "realise", libelle: "Réalisé" }] },
    ],
  },
};

export function blocsLignesDeLecran(ecranId) {
  return Object.entries(BLOCS_LIGNES).filter(([, b]) => b.ecran === ecranId).map(([bloc, b]) => ({ bloc, ...b }));
}

export function libelleSource(source) {
  return source === "jeune" ? "Réponse du jeune" : "Observation de l'accompagnateur";
}
