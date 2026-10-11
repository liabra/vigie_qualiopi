// ─────────────────────────────────────────────────────────────
//  CATALOGUE CANONIQUE DES VARIABLES DOCUMENTAIRES — contrat technique.
//
//  Transcription du « Dictionnaire officiel des variables Vigie v1.0 »
//  (A2C, 09/10/2026), avec les écarts validés listés dans EVOLUTIONS.
//  Les noms canoniques ne se renomment pas : toute nouvelle variable
//  reçoit un ID, une définition, une source et une version (règle I).
//
//  Ce catalogue décrit le SENS des variables, pas les règles d'un modèle :
//  l'obligation (« required ») sera portée par le mapping de chaque modèle.
//
//  Syntaxe officielle des modèles :
//    variable simple   {{stagiaire_prenom}}
//    bloc répétable    {{#phases}} … {{phase_numero}} … {{/phases}}
//
//  Module PUR, figé (Object.freeze) : aucun appel réseau ni base.
//  Le moteur de génération actuel (marqueurs.js / documents.js) n'en
//  dépend pas encore.
// ─────────────────────────────────────────────────────────────

export const DICTIONNAIRE_VERSION = "1.3";

// Écarts par rapport au PDF v1.0, tous validés.
export const EVOLUTIONS = Object.freeze([
  { version: "1.1", changement: "Ajout de SES-12 {{session_reference}} (référence interne de la session)." },
  { version: "1.1", changement: "Valeurs métier alignées sur le schéma Vigie : session_statut (planifiee | en_cours | terminee | annulee), stagiaire_statut_parcours (inscrit | en_cours | termine | abandon), civilités (M. | Mme), formation_modalite (presentiel | distanciel | mixte). Les libellés affichés sont distincts des valeurs." },
  { version: "1.1", changement: "Caractère obligatoire retiré du catalogue : il sera porté par le mapping de chaque modèle." },
  { version: "1.1", changement: "Chaque bloc répétable déclare son schéma de champs ; les champs locaux ne sont valides que dans leur bloc." },
  { version: "1.1", changement: "Syntaxe officielle des blocs : {{#bloc}} … {{/bloc}}." },
  { version: "1.1", changement: "EVA-03 renommée evaluation_type → evaluation_methode (méthode : QCM, exercice pratique, mise en situation, entretien…), pour lever l'ambiguïté avec le MOMENT de l'évaluation. Renommage non silencieux : voir variableCanonique(\"evaluation_methode\").renomme_depuis." },
  { version: "1.1", changement: "Ajout de EVA-11 {{evaluation_moment}} (positionnement | intermediaire | finale | autre) et EVA-12 {{evaluation_resultat_validation}} (valide | non_valide), pour distinguer explicitement moment, méthode, résultat de validation binaire et niveau pédagogique atteint (evaluation_niveau / phase_resultat_niveau, inchangées). Aucune de ces deux notions n'est aujourd'hui stockée par Vigie : aucun resolver n'est ajouté." },
  { version: "1.1", changement: "Ajout du marqueur legacy date_convocation : absent des 23 marqueurs actuels du moteur (marqueurs.js), mais utilisé dans un modèle Drive réel de convocation. Classé historique, cible document_date_convocation (DOC-06), distincte de document_date (DOC-01, date de génération technique)." },
  { version: "1.2", changement: "Renommage non silencieux SES-09 : session_statut → session_statut_code (valeur métier brute planifiee | en_cours | terminee | annulee), pour lever la collision avec le marqueur historique session_statut (libellé humain). Le nom session_statut reste reconnu comme marqueur historique compatible, jamais un alias de session_statut_code." },
  { version: "1.3", changement: "Ajout de DOC-10 {{document_duree_attestation}} : durée totale affichée sur l'attestation (durée de session, à défaut durée de formation, au format historique de duree). Le marqueur historique duree relit désormais cette valeur." },
]);

export const TYPES = Object.freeze(["texte", "date", "nombre", "booleen", "liste", "bloc"]);
export const SENSIBILITES = Object.freeze(["aucune", "personnelle", "restreinte"]);
export const FORMATS = Object.freeze({
  date: "JJ/MM/AAAA (stockée AAAA-MM-JJ)",
  heure: "HH:MM",
  duree_heures: "Nombre d'heures, décimal possible",
  pourcentage: "Pourcentage calculé par Vigie, jamais saisi",
  texte_long: "Texte de plusieurs lignes",
  email: "Adresse e-mail",
  telephone: "Numéro de téléphone",
  url: "Adresse web",
  identifiant: "Identifiant interne Vigie, pas forcément affiché",
  enum: "Valeur contrôlée (voir « valeurs »)",
});
export const DOMAINES = Object.freeze({
  organisme: "Organisme", formation: "Formation", session: "Session", groupe: "Groupe",
  stagiaire: "Stagiaire / bénéficiaire", representant_legal: "Représentant légal et autorisations",
  phase: "Phase pédagogique", seance: "Séance", suivi: "Suivi (présences, absences, abandons, relances)",
  evaluation: "Évaluation", bilan: "Bilan", satisfaction: "Satisfaction", indicateur: "Indicateur de session",
  intervenant: "Intervenant", partenaire: "Partenaire (prescripteur, financeur)", immersion: "Immersion",
  document: "Document",
});

const CIVILITES = { valeurs: ["M.", "Mme"], source_valeurs: "schéma Vigie (stagiaires.civilite, intervenants.civilite)" };
const NIVEAUX = { valeurs: ["acquis", "en_cours", "non_acquis", "non_evalue"], source_valeurs: "dictionnaire v1.0 (pas encore de colonne Vigie)" };
const AUTORISATION = { valeurs: ["accorde", "refuse", "non_requis", "en_attente"], source_valeurs: "dictionnaire v1.0 (pas encore de colonne Vigie)" };
const MOMENTS_EVALUATION = { valeurs: ["positionnement", "intermediaire", "finale", "autre"], source_valeurs: "dictionnaire v1.1 (moment générique dans le parcours ; non mappé à resultats_qcm.type, dont la sémantique diffère — pas encore de colonne Vigie)" };
const RESULTAT_VALIDATION = { valeurs: ["valide", "non_valide"], source_valeurs: "dictionnaire v1.1 (validation binaire, distincte du niveau pédagogique atteint ; pas encore de colonne Vigie)" };

// [id, nom, libellé, domaine, type, source de vérité, portée, description, options]
// options : format, valeurs, libelles, valeurs_recommandees, sensibilite,
//           calcule, remarque, depuis.
const LIGNES = [
  // ── Organisme ─────────────────────────────────────────────
  ["ORG-01", "organisme_nom", "Nom officiel de l'organisme", "organisme", "texte", "Paramètres organisme", "Organisme", "Nom de l'organisme, paramétré une fois et repris dans les documents institutionnels."],
  ["ORG-02", "organisme_adresse_ligne1", "Adresse - ligne 1", "organisme", "texte", "Paramètres organisme", "Organisme", "Première ligne de l'adresse de l'organisme."],
  ["ORG-03", "organisme_adresse_ligne2", "Adresse - ligne 2", "organisme", "texte", "Paramètres organisme", "Organisme", "Seconde ligne de l'adresse de l'organisme."],
  ["ORG-04", "organisme_code_postal", "Code postal", "organisme", "texte", "Paramètres organisme", "Organisme", "Code postal de l'organisme."],
  ["ORG-05", "organisme_ville", "Ville", "organisme", "texte", "Paramètres organisme", "Organisme", "Ville de l'organisme."],
  ["ORG-06", "organisme_telephone", "Téléphone fixe", "organisme", "texte", "Paramètres organisme", "Organisme", "Téléphone fixe de l'organisme.", { format: "telephone" }],
  ["ORG-07", "organisme_mobile", "Téléphone mobile", "organisme", "texte", "Paramètres organisme", "Organisme", "Téléphone mobile de l'organisme.", { format: "telephone" }],
  ["ORG-08", "organisme_email", "E-mail générique", "organisme", "texte", "Paramètres organisme", "Organisme", "Adresse e-mail générique de l'organisme.", { format: "email" }],
  ["ORG-09", "organisme_site_web", "Site web", "organisme", "texte", "Paramètres organisme", "Organisme", "Site web de l'organisme.", { format: "url" }],
  ["ORG-10", "organisme_siret", "SIRET", "organisme", "texte", "Paramètres organisme", "Organisme", "Numéro SIRET de l'organisme.", { remarque: "À renseigner si utilisé dans le modèle." }],
  ["ORG-11", "organisme_nda", "N° déclaration d'activité", "organisme", "texte", "Paramètres organisme", "Organisme", "Numéro de déclaration d'activité de l'organisme.", { remarque: "À renseigner si utilisé." }],
  ["ORG-12", "referent_handicap_nom", "Nom du référent handicap", "organisme", "texte", "Paramètres organisme", "Organisme", "Nom du référent handicap de l'organisme."],
  ["ORG-13", "referent_handicap_email", "E-mail référent handicap", "organisme", "texte", "Paramètres organisme", "Organisme", "Adresse e-mail du référent handicap.", { format: "email" }],
  ["ORG-14", "referent_handicap_telephone", "Téléphone référent handicap", "organisme", "texte", "Paramètres organisme", "Organisme", "Téléphone du référent handicap.", { format: "telephone" }],
  // ── Formation ─────────────────────────────────────────────
  ["FOR-01", "formation_id", "Identifiant interne formation", "formation", "texte", "Base Vigie", "Formation", "Identifiant interne de la formation.", { format: "identifiant" }],
  ["FOR-02", "formation_intitule", "Intitulé officiel de la formation", "formation", "texte", "Fiche formation", "Formation", "Nom unique du parcours global à 6 phases."],
  ["FOR-03", "formation_code", "Code court de la formation", "formation", "texte", "Fiche formation", "Formation", "Code interne court de la formation.", { remarque: "Code interne à définir." }],
  ["FOR-04", "formation_version_programme", "Version du programme", "formation", "texte", "Fiche formation", "Formation", "Version du programme de formation."],
  ["FOR-05", "formation_duree_heures", "Durée officielle du parcours en heures", "formation", "nombre", "Fiche formation", "Formation", "Durée officielle du parcours, en heures.", { format: "duree_heures", remarque: "Valeur 270 h / 276 h non arbitrée : ne pas la figer." }],
  ["FOR-06", "formation_public_vise", "Public visé", "formation", "texte", "Fiche formation", "Formation", "Public visé par la formation.", { format: "texte_long" }],
  ["FOR-07", "formation_prerequis", "Prérequis", "formation", "texte", "Fiche formation", "Formation", "Prérequis d'entrée ; peut être « aucun ».", { format: "texte_long" }],
  ["FOR-08", "formation_objectif_general", "Objectif général", "formation", "texte", "Fiche formation", "Formation", "Objectif général de la formation.", { format: "texte_long" }],
  ["FOR-09", "formation_objectifs_operationnels", "Objectifs opérationnels", "formation", "liste", "Fiche formation", "Formation", "Objectifs opérationnels de la formation ; détail ligne à ligne dans le bloc objectifs_formation."],
  ["FOR-10", "formation_modalite", "Modalité de formation", "formation", "texte", "Fiche formation", "Formation", "Modalité de formation.", { format: "enum", valeurs: ["presentiel", "distanciel", "mixte"], libelles: { presentiel: "Présentiel", distanciel: "Distanciel", mixte: "Mixte" }, source_valeurs: "schéma Vigie (formations.modalite, sessions.modalite)" }],
  ["FOR-11", "formation_methodes_pedagogiques", "Méthodes pédagogiques", "formation", "texte", "Fiche formation", "Formation", "Méthodes pédagogiques de la formation.", { format: "texte_long" }],
  ["FOR-12", "formation_modalites_evaluation", "Modalités d'évaluation", "formation", "texte", "Fiche formation", "Formation", "Modalités d'évaluation de la formation.", { format: "texte_long" }],
  ["FOR-13", "formation_accessibilite", "Modalités d'accessibilité", "formation", "texte", "Fiche formation", "Formation", "Modalités d'accessibilité de la formation.", { format: "texte_long" }],
  ["FOR-14", "formation_nombre_phases", "Nombre de phases pédagogiques", "formation", "nombre", "Configuration formation", "Formation", "Nombre de phases du parcours (6 pour ce projet)."],
  // ── Session ───────────────────────────────────────────────
  ["SES-01", "session_id", "Identifiant interne session", "session", "texte", "Base Vigie", "Session", "Identifiant interne de la session.", { format: "identifiant" }],
  ["SES-02", "session_libelle", "Libellé de session", "session", "texte", "Session", "Session", "Libellé de la session ; ne pas confondre avec le groupe."],
  ["SES-03", "session_date_debut", "Date de début de session", "session", "date", "Session", "Session", "Date de début de la session.", { format: "date" }],
  ["SES-04", "session_date_fin", "Date de fin de session", "session", "date", "Session", "Session", "Date de fin de la session.", { format: "date" }],
  ["SES-05", "session_horaires", "Horaires / rythme synthétique", "session", "texte", "Session / planning", "Session", "Horaires synthétiques de la session ; le détail des créneaux reste dans les séances."],
  ["SES-06", "session_lieu", "Lieu principal de session", "session", "texte", "Session", "Session", "Lieu principal de la session."],
  ["SES-07", "session_adresse", "Adresse du lieu de session", "session", "texte", "Session", "Session", "Adresse du lieu de session, si différente de celle de l'organisme."],
  ["SES-08", "session_duree_heures", "Durée planifiée de la session", "session", "nombre", "Session", "Session", "Durée planifiée de la session ; habituellement égale à la durée de la formation.", { format: "duree_heures" }],
  ["SES-09", "session_statut_code", "Statut de session", "session", "texte", "Session", "Session", "Statut de la session, valeur métier brute. Renommé depuis session_statut (v1.2) : le nom session_statut reste un marqueur historique (libellé humain), jamais un alias de cette variable.", { format: "enum", valeurs: ["planifiee", "en_cours", "terminee", "annulee"], libelles: { planifiee: "Planifiée", en_cours: "En cours", terminee: "Terminée", annulee: "Annulée" }, source_valeurs: "schéma Vigie (sessions.statut)", renomme_depuis: "session_statut", depuis: "1.2" }],
  ["SES-10", "session_nombre_inscrits", "Nombre de bénéficiaires inscrits", "session", "nombre", "Inscriptions", "Session", "Nombre de bénéficiaires inscrits à la session.", { calcule: true }],
  ["SES-11", "session_nombre_termines", "Nombre ayant terminé", "session", "nombre", "Inscriptions", "Session", "Nombre de bénéficiaires ayant terminé la session.", { calcule: true }],
  ["SES-12", "session_reference", "Référence de session", "session", "texte", "Session", "Session", "Référence interne unique de la session (ex. « ADVF-2026-01 »).", { depuis: "1.1" }],
  // ── Groupe ────────────────────────────────────────────────
  ["GRP-01", "groupe_id", "Identifiant interne du groupe", "groupe", "texte", "Base Vigie", "Groupe", "Identifiant interne du groupe.", { format: "identifiant" }],
  ["GRP-02", "groupe_nom", "Nom du groupe", "groupe", "texte", "Groupe", "Groupe", "Nom du groupe.", { valeurs_recommandees: ["Armstrong", "Voie Lactée", "Uranus"], remarque: "Valeurs du projet actuel uniquement." }],
  ["GRP-03", "groupe_code", "Code stable du groupe", "groupe", "texte", "Groupe", "Groupe", "Code technique stable du groupe.", { format: "enum", valeurs_recommandees: ["ARMSTRONG", "VOIE_LACTEE", "URANUS"] }],
  ["GRP-04", "groupe_age_min", "Âge minimum", "groupe", "nombre", "Groupe", "Groupe", "Âge minimum du groupe (14 / 17 / 19 selon le groupe)."],
  ["GRP-05", "groupe_age_max", "Âge maximum", "groupe", "nombre", "Groupe", "Groupe", "Âge maximum du groupe (16 / 18 / 20 selon le groupe)."],
  ["GRP-06", "groupe_tranche_age", "Libellé de tranche d'âge", "groupe", "texte", "Groupe", "Groupe", "Tranche d'âge du groupe, par exemple « 14-16 ans ».", { calcule: true }],
  ["GRP-07", "groupe_adaptation_pedagogique", "Règles d'adaptation du groupe", "groupe", "texte", "Plan adaptation", "Groupe", "Règles d'adaptation pédagogique propres au groupe.", { format: "texte_long" }],
  // ── Stagiaire / bénéficiaire ──────────────────────────────
  ["STA-01", "stagiaire_id", "Identifiant interne bénéficiaire", "stagiaire", "texte", "Base Vigie", "Bénéficiaire", "Identifiant interne du bénéficiaire.", { format: "identifiant" }],
  ["STA-02", "stagiaire_civilite", "Civilité", "stagiaire", "texte", "Dossier stagiaire", "Bénéficiaire", "Civilité du bénéficiaire.", { format: "enum", ...CIVILITES, sensibilite: "personnelle" }],
  ["STA-03", "stagiaire_nom", "Nom", "stagiaire", "texte", "Dossier stagiaire", "Bénéficiaire", "Nom du bénéficiaire ; mise en majuscules à l'affichage seulement.", { sensibilite: "personnelle" }],
  ["STA-04", "stagiaire_prenom", "Prénom", "stagiaire", "texte", "Dossier stagiaire", "Bénéficiaire", "Prénom du bénéficiaire.", { sensibilite: "personnelle" }],
  ["STA-05", "stagiaire_nom_complet", "Nom complet", "stagiaire", "texte", "Dossier stagiaire", "Bénéficiaire", "Prénom + NOM selon la règle d'affichage.", { calcule: true, sensibilite: "personnelle" }],
  ["STA-06", "stagiaire_date_naissance", "Date de naissance", "stagiaire", "date", "Dossier stagiaire", "Bénéficiaire", "Date de naissance du bénéficiaire.", { format: "date", sensibilite: "personnelle" }],
  ["STA-07", "stagiaire_age", "Âge au début de session", "stagiaire", "nombre", "Date naissance + date début", "Bénéficiaire", "Âge du bénéficiaire au début de la session ; jamais stocké.", { calcule: true, sensibilite: "personnelle" }],
  ["STA-08", "stagiaire_adresse", "Adresse", "stagiaire", "texte", "Dossier stagiaire", "Bénéficiaire", "Adresse postale du bénéficiaire.", { sensibilite: "personnelle" }],
  ["STA-09", "stagiaire_code_postal", "Code postal", "stagiaire", "texte", "Dossier stagiaire", "Bénéficiaire", "Code postal du bénéficiaire.", { sensibilite: "personnelle" }],
  ["STA-10", "stagiaire_ville", "Ville", "stagiaire", "texte", "Dossier stagiaire", "Bénéficiaire", "Ville du bénéficiaire.", { sensibilite: "personnelle" }],
  ["STA-11", "stagiaire_telephone", "Téléphone", "stagiaire", "texte", "Dossier stagiaire", "Bénéficiaire", "Téléphone du bénéficiaire.", { format: "telephone", sensibilite: "personnelle" }],
  ["STA-12", "stagiaire_email", "E-mail", "stagiaire", "texte", "Dossier stagiaire", "Bénéficiaire", "Adresse e-mail du bénéficiaire.", { format: "email", sensibilite: "personnelle" }],
  ["STA-13", "stagiaire_date_inscription", "Date d'inscription", "stagiaire", "date", "Inscription", "Bénéficiaire", "Date d'inscription du bénéficiaire.", { format: "date" }],
  ["STA-14", "stagiaire_statut_parcours", "Statut du parcours", "stagiaire", "texte", "Inscription", "Bénéficiaire", "Statut du parcours du bénéficiaire. La valeur métier est distincte de son libellé affiché.", { format: "enum", valeurs: ["inscrit", "en_cours", "termine", "abandon"], libelles: { inscrit: "Inscrit", en_cours: "En cours", termine: "Terminé", abandon: "Abandon" }, source_valeurs: "schéma Vigie (inscriptions.statut)" }],
  ["STA-15", "stagiaire_groupe_nom", "Groupe affecté", "stagiaire", "texte", "Affectation groupe", "Bénéficiaire", "Nom du groupe auquel le bénéficiaire est affecté (reprend groupe_nom).", { calcule: true }],
  ["STA-16", "stagiaire_besoins_specifiques", "Besoins spécifiques", "stagiaire", "texte", "Analyse besoins", "Bénéficiaire", "Besoins spécifiques du bénéficiaire. Donnée sensible : accès restreint.", { format: "texte_long", sensibilite: "restreinte" }],
  ["STA-17", "stagiaire_amenagements", "Aménagements retenus", "stagiaire", "texte", "Suivi adaptation", "Bénéficiaire", "Aménagements retenus pour le bénéficiaire. Donnée sensible : accès restreint.", { format: "texte_long", sensibilite: "restreinte" }],
  // ── Représentant légal et autorisations ───────────────────
  ["LEG-01", "representant_legal_nom", "Nom du représentant légal", "representant_legal", "texte", "Dossier mineur", "Bénéficiaire", "Nom du représentant légal d'un bénéficiaire mineur.", { sensibilite: "personnelle" }],
  ["LEG-02", "representant_legal_prenom", "Prénom du représentant légal", "representant_legal", "texte", "Dossier mineur", "Bénéficiaire", "Prénom du représentant légal.", { sensibilite: "personnelle" }],
  ["LEG-03", "representant_legal_lien", "Lien avec le bénéficiaire", "representant_legal", "texte", "Dossier mineur", "Bénéficiaire", "Lien du représentant légal avec le bénéficiaire.", { sensibilite: "personnelle" }],
  ["LEG-04", "representant_legal_email", "E-mail représentant légal", "representant_legal", "texte", "Dossier mineur", "Bénéficiaire", "Adresse e-mail du représentant légal.", { format: "email", sensibilite: "personnelle" }],
  ["LEG-05", "representant_legal_telephone", "Téléphone représentant légal", "representant_legal", "texte", "Dossier mineur", "Bénéficiaire", "Téléphone du représentant légal.", { format: "telephone", sensibilite: "personnelle" }],
  ["LEG-06", "autorisation_ia_statut", "Consentement usage IA", "representant_legal", "texte", "Autorisation", "Bénéficiaire", "Consentement à l'usage de l'IA, selon la phase et l'âge.", { format: "enum", ...AUTORISATION, sensibilite: "personnelle" }],
  ["LEG-07", "autorisation_image_statut", "Consentement image/vidéo", "representant_legal", "texte", "Autorisation", "Bénéficiaire", "Consentement photo / vidéo / enregistrement.", { format: "enum", ...AUTORISATION, sensibilite: "personnelle" }],
  // ── Phase ─────────────────────────────────────────────────
  ["PHA-01", "phase_id", "Identifiant interne phase", "phase", "texte", "Base Vigie", "Phase", "Identifiant interne de la phase.", { format: "identifiant" }],
  ["PHA-02", "phase_numero", "Numéro de phase", "phase", "nombre", "Référentiel formation", "Phase", "Numéro de la phase (1 à 6)."],
  ["PHA-03", "phase_intitule", "Intitulé de phase", "phase", "texte", "Référentiel formation", "Phase", "Intitulé de la phase."],
  ["PHA-04", "phase_duree_heures", "Durée de la phase", "phase", "nombre", "Référentiel formation", "Phase", "Durée de la phase en heures.", { format: "duree_heures" }],
  ["PHA-05", "phase_objectif_general", "Objectif général de la phase", "phase", "texte", "Référentiel formation", "Phase", "Objectif général de la phase.", { format: "texte_long" }],
  ["PHA-06", "phase_objectifs_operationnels", "Objectifs opérationnels de phase", "phase", "liste", "Référentiel formation", "Phase", "Objectifs opérationnels de la phase ; détail ligne à ligne dans le bloc objectifs_phase."],
  ["PHA-07", "phase_contenus", "Contenus pédagogiques", "phase", "liste", "Référentiel formation", "Phase", "Contenus pédagogiques de la phase."],
  ["PHA-08", "phase_methodes", "Méthodes pédagogiques de phase", "phase", "liste", "Référentiel formation", "Phase", "Méthodes pédagogiques de la phase."],
  ["PHA-09", "phase_modalites_evaluation", "Modalités d'évaluation de phase", "phase", "liste", "Plan évaluation", "Phase", "Modalités d'évaluation de la phase."],
  ["PHA-10", "phase_date_debut", "Date de début effective de phase", "phase", "date", "Planning / séances", "Phase + groupe", "Date de début de la phase ; peut différer selon le groupe.", { format: "date", calcule: true }],
  ["PHA-11", "phase_date_fin", "Date de fin effective de phase", "phase", "date", "Planning / séances", "Phase + groupe", "Date de fin de la phase ; peut différer selon le groupe.", { format: "date", calcule: true }],
  ["PHA-12", "phase_resultat_niveau", "Niveau atteint sur la phase", "phase", "texte", "Évaluations", "Bénéficiaire + phase", "Niveau pédagogique atteint par le bénéficiaire sur l'ENSEMBLE de la phase (peut différer du niveau d'une évaluation isolée, evaluation_niveau).", { format: "enum", ...NIVEAUX, sensibilite: "personnelle" }],
  ["PHA-13", "phase_resultat_score", "Score de phase", "phase", "nombre", "Évaluations", "Bénéficiaire + phase", "Score du bénéficiaire sur la phase (nombre ou pourcentage).", { sensibilite: "personnelle" }],
  ["PHA-14", "phase_observations_formateur", "Observations du formateur", "phase", "texte", "Suivi pédagogique", "Bénéficiaire + phase", "Observations du formateur sur la phase.", { format: "texte_long", sensibilite: "personnelle" }],
  ["PHA-15", "phase_progression_commentaire", "Commentaire de progression", "phase", "texte", "Bilan intermédiaire", "Bénéficiaire + phase", "Commentaire de progression sur la phase.", { format: "texte_long", sensibilite: "personnelle" }],
  ["PHA-16", "phase_prochaine_etape", "Prochaine étape", "phase", "texte", "Bilan intermédiaire", "Bénéficiaire + phase", "Prochaine étape fixée au bilan intermédiaire.", { sensibilite: "personnelle" }],
  // ── Séance ────────────────────────────────────────────────
  ["SEA-01", "seance_id", "Identifiant interne séance", "seance", "texte", "Base Vigie", "Séance", "Identifiant interne de la séance.", { format: "identifiant" }],
  ["SEA-02", "seance_numero", "Numéro / ordre de séance", "seance", "nombre", "Planning", "Séance", "Numéro d'ordre de la séance."],
  ["SEA-03", "seance_date", "Date de séance", "seance", "date", "Planning", "Séance", "Date de la séance (créneaux Insertion Pro uniquement dans ce projet).", { format: "date" }],
  ["SEA-04", "seance_heure_debut", "Heure de début", "seance", "texte", "Planning", "Séance", "Heure de début de la séance.", { format: "heure" }],
  ["SEA-05", "seance_heure_fin", "Heure de fin", "seance", "texte", "Planning", "Séance", "Heure de fin de la séance.", { format: "heure" }],
  ["SEA-06", "seance_duree_heures", "Durée de séance", "seance", "nombre", "Planning", "Séance", "Durée de la séance en heures.", { format: "duree_heures", calcule: true }],
  ["SEA-07", "seance_theme", "Thème / objet de séance", "seance", "texte", "Séquence / planning", "Séance", "Thème ou objet de la séance."],
  ["SEA-08", "seance_lieu", "Lieu / salle", "seance", "texte", "Planning", "Séance", "Lieu ou salle de la séance."],
  ["SEA-09", "seance_phase_numero", "Phase associée", "seance", "nombre", "Planning", "Séance", "Numéro de la phase à laquelle la séance est rattachée."],
  ["SEA-10", "seance_groupe_nom", "Groupe concerné", "seance", "texte", "Planning", "Séance", "Nom du groupe concerné par la séance."],
  // ── Suivi ─────────────────────────────────────────────────
  ["SUI-01", "presence_heures_prevues", "Heures prévues", "suivi", "nombre", "Planning", "Bénéficiaire/session", "Heures prévues pour le bénéficiaire.", { format: "duree_heures", calcule: true }],
  ["SUI-02", "presence_heures_realisees", "Heures réalisées", "suivi", "nombre", "Émargements - absences", "Bénéficiaire/session", "Heures réellement suivies (émargements moins absences).", { format: "duree_heures", calcule: true }],
  ["SUI-03", "absence_heures_total", "Total heures d'absence", "suivi", "nombre", "Absences", "Bénéficiaire/session", "Somme des heures d'absence du bénéficiaire sur la session.", { format: "duree_heures", calcule: true }],
  ["SUI-04", "presence_taux", "Taux de présence", "suivi", "nombre", "Heures prévues/réalisées", "Bénéficiaire/session", "Taux de présence du bénéficiaire.", { format: "pourcentage", calcule: true }],
  ["SUI-05", "absence_taux", "Taux d'absentéisme", "suivi", "nombre", "Absences / heures prévues", "Bénéficiaire/session", "Taux d'absentéisme du bénéficiaire.", { format: "pourcentage", calcule: true }],
  ["SUI-06", "abandon_statut", "Statut abandon", "suivi", "booleen", "Inscription", "Bénéficiaire/session", "Le bénéficiaire a-t-il abandonné ?", { calcule: true }],
  ["SUI-07", "abandon_date", "Date d'abandon", "suivi", "date", "Inscription", "Bénéficiaire/session", "Date de l'abandon.", { format: "date" }],
  ["SUI-08", "abandon_motif", "Motif d'abandon", "suivi", "texte", "Inscription", "Bénéficiaire/session", "Motif de l'abandon.", { sensibilite: "personnelle" }],
  ["SUI-09", "relance_derniere_date", "Date dernière relance", "suivi", "date", "Journal suivi", "Bénéficiaire", "Date de la dernière relance.", { format: "date" }],
  ["SUI-10", "relance_derniere_action", "Dernière action de relance", "suivi", "texte", "Journal suivi", "Bénéficiaire", "Dernière action de relance menée.", { sensibilite: "personnelle" }],
  // ── Évaluation ────────────────────────────────────────────
  ["EVA-01", "evaluation_id", "Identifiant évaluation", "evaluation", "texte", "Base Vigie", "Évaluation", "Identifiant interne de l'évaluation.", { format: "identifiant" }],
  ["EVA-02", "evaluation_intitule", "Intitulé de l'évaluation", "evaluation", "texte", "Plan évaluation", "Évaluation", "Intitulé de l'évaluation."],
  ["EVA-03", "evaluation_methode", "Méthode d'évaluation", "evaluation", "texte", "Plan évaluation", "Évaluation", "Méthode utilisée pour évaluer (QCM, exercice pratique, mise en situation, entretien…). Distincte du MOMENT de l'évaluation dans le parcours (evaluation_moment).", { format: "enum", valeurs: ["qcm", "quiz", "mise_en_situation", "entretien", "autoevaluation", "autre"], source_valeurs: "dictionnaire v1.0 (méthode)", renomme_depuis: "evaluation_type" }],
  ["EVA-04", "evaluation_date", "Date d'évaluation", "evaluation", "date", "Évaluation", "Évaluation", "Date de l'évaluation.", { format: "date" }],
  ["EVA-05", "evaluation_score_obtenu", "Score obtenu", "evaluation", "nombre", "Résultat évaluation", "Bénéficiaire + évaluation", "Score obtenu par le bénéficiaire.", { sensibilite: "personnelle" }],
  ["EVA-06", "evaluation_score_max", "Score maximum", "evaluation", "nombre", "Paramétrage évaluation", "Évaluation", "Score maximum de l'évaluation."],
  ["EVA-07", "evaluation_pourcentage", "Pourcentage obtenu", "evaluation", "nombre", "Score obtenu/max", "Bénéficiaire + évaluation", "Pourcentage obtenu (score obtenu / score maximum).", { format: "pourcentage", calcule: true, sensibilite: "personnelle" }],
  ["EVA-08", "evaluation_niveau", "Niveau atteint", "evaluation", "texte", "Règles évaluation", "Bénéficiaire + évaluation", "Niveau pédagogique atteint sur CETTE évaluation, selon le barème validé. Distinct du résultat de validation, binaire (evaluation_resultat_validation).", { format: "enum", ...NIVEAUX, sensibilite: "personnelle" }],
  ["EVA-09", "evaluation_commentaire", "Commentaire formateur", "evaluation", "texte", "Résultat évaluation", "Bénéficiaire + évaluation", "Commentaire du formateur sur l'évaluation.", { format: "texte_long", sensibilite: "personnelle" }],
  ["EVA-10", "evaluation_objectif_associe", "Objectif évalué", "evaluation", "texte", "Correspondance objectif-évaluation", "Évaluation", "Objectif évalué par l'évaluation."],
  ["EVA-11", "evaluation_moment", "Moment de l'évaluation", "evaluation", "texte", "Plan évaluation", "Évaluation", "Moment de l'évaluation dans le parcours (positionnement, intermédiaire, finale…). Distinct de sa méthode (evaluation_methode) et du résultat obtenu. Aucun resolver Vigie actuel : donnée non encore stockée.", { format: "enum", ...MOMENTS_EVALUATION, depuis: "1.1" }],
  ["EVA-12", "evaluation_resultat_validation", "Résultat de validation", "evaluation", "texte", "Résultat évaluation", "Bénéficiaire + évaluation", "Résultat de validation binaire (validé / non validé), lorsque l'évaluation comporte un seuil de réussite. Distinct du niveau pédagogique atteint (evaluation_niveau). Aucun resolver Vigie actuel : donnée non encore stockée.", { format: "enum", ...RESULTAT_VALIDATION, sensibilite: "personnelle", depuis: "1.1" }],
  // ── Bilan ─────────────────────────────────────────────────
  ["BIL-01", "bilan_date", "Date du bilan", "bilan", "date", "Bilan", "Bénéficiaire/session", "Date du bilan.", { format: "date" }],
  ["BIL-02", "bilan_synthese", "Synthèse du bilan", "bilan", "texte", "Bilan", "Bénéficiaire/session", "Synthèse du bilan final ou intermédiaire.", { format: "texte_long", sensibilite: "personnelle" }],
  ["BIL-03", "bilan_competences_acquises", "Compétences acquises", "bilan", "liste", "Bilan final", "Bénéficiaire", "Compétences acquises en fin de parcours.", { sensibilite: "personnelle" }],
  ["BIL-04", "bilan_axes_progres", "Axes de progrès", "bilan", "liste", "Bilan final", "Bénéficiaire", "Axes de progrès identifiés au bilan final.", { sensibilite: "personnelle" }],
  ["BIL-05", "bilan_suite_parcours", "Suite envisagée", "bilan", "texte", "Bilan final", "Bénéficiaire", "Suite de parcours envisagée.", { sensibilite: "personnelle" }],
  // ── Satisfaction ──────────────────────────────────────────
  ["SAT-01", "satisfaction_score_global", "Score satisfaction global", "satisfaction", "nombre", "Questionnaire satisfaction", "Bénéficiaire/session", "Score global de satisfaction (sur 5 ou en %) ; conserver le score brut et le calcul agrégé."],
  ["SAT-02", "satisfaction_commentaire", "Commentaire libre satisfaction", "satisfaction", "texte", "Questionnaire satisfaction", "Bénéficiaire/session", "Commentaire libre d'un répondant ; réservé à l'administration.", { sensibilite: "restreinte" }],
  // ── Indicateurs de session ────────────────────────────────
  ["IND-01", "indicateur_taux_satisfaction", "Taux de satisfaction session", "indicateur", "nombre", "Questionnaires", "Session", "Taux de satisfaction de la session.", { format: "pourcentage", calcule: true }],
  ["IND-02", "indicateur_taux_assiduite", "Taux d'assiduité session", "indicateur", "nombre", "Présences", "Session", "Taux d'assiduité de la session.", { format: "pourcentage", calcule: true }],
  ["IND-03", "indicateur_taux_abandon", "Taux d'abandon session", "indicateur", "nombre", "Inscriptions", "Session", "Taux d'abandon de la session.", { format: "pourcentage", calcule: true }],
  ["IND-04", "indicateur_taux_atteinte_objectifs", "Taux d'atteinte des objectifs", "indicateur", "nombre", "Évaluations", "Session", "Taux d'atteinte des objectifs ; méthode de calcul à conserver dans un document de référence.", { format: "pourcentage", calcule: true }],
  // ── Intervenant ───────────────────────────────────────────
  ["INT-01", "intervenant_id", "Identifiant intervenant", "intervenant", "texte", "Base Vigie", "Intervenant", "Identifiant interne de l'intervenant.", { format: "identifiant" }],
  ["INT-02", "intervenant_civilite", "Civilité intervenant", "intervenant", "texte", "Fiche intervenant", "Intervenant", "Civilité de l'intervenant.", { format: "enum", ...CIVILITES }],
  ["INT-03", "intervenant_nom", "Nom intervenant", "intervenant", "texte", "Fiche intervenant", "Intervenant", "Nom de l'intervenant."],
  ["INT-04", "intervenant_prenom", "Prénom intervenant", "intervenant", "texte", "Fiche intervenant", "Intervenant", "Prénom de l'intervenant."],
  ["INT-05", "intervenant_nom_complet", "Nom complet intervenant", "intervenant", "texte", "Fiche intervenant", "Intervenant", "Prénom + NOM de l'intervenant.", { calcule: true }],
  ["INT-06", "intervenant_fonction", "Fonction / rôle", "intervenant", "texte", "Fiche intervenant", "Intervenant", "Fonction ou rôle de l'intervenant."],
  ["INT-07", "intervenant_email", "E-mail", "intervenant", "texte", "Fiche intervenant", "Intervenant", "Adresse e-mail de l'intervenant.", { format: "email", sensibilite: "personnelle" }],
  ["INT-08", "intervenant_telephone", "Téléphone", "intervenant", "texte", "Fiche intervenant", "Intervenant", "Téléphone de l'intervenant.", { format: "telephone", sensibilite: "personnelle" }],
  // ── Partenaires ───────────────────────────────────────────
  ["PAR-01", "prescripteur_nom", "Nom de la structure prescriptrice", "partenaire", "texte", "Partenaire", "Partenaire", "Nom de la structure prescriptrice."],
  ["PAR-02", "prescripteur_contact_nom", "Nom du contact prescripteur", "partenaire", "texte", "Partenaire", "Partenaire", "Nom du contact chez le prescripteur.", { sensibilite: "personnelle" }],
  ["PAR-03", "prescripteur_contact_fonction", "Fonction du contact", "partenaire", "texte", "Partenaire", "Partenaire", "Fonction du contact prescripteur."],
  ["PAR-04", "prescripteur_email", "E-mail du contact", "partenaire", "texte", "Partenaire", "Partenaire", "Adresse e-mail du contact prescripteur.", { format: "email", sensibilite: "personnelle" }],
  ["PAR-05", "prescripteur_telephone", "Téléphone du contact", "partenaire", "texte", "Partenaire", "Partenaire", "Téléphone du contact prescripteur.", { format: "telephone", sensibilite: "personnelle" }],
  ["PAR-06", "financeur_nom", "Nom du financeur", "partenaire", "texte", "Convention / financement", "Formation/session", "Nom du financeur de la formation ou de la session."],
  ["PAR-07", "convention_reference", "Référence convention/notification", "partenaire", "texte", "Convention / financement", "Formation/session", "Référence de la convention ou de la notification de financement."],
  // ── Immersion ─────────────────────────────────────────────
  ["IMM-01", "immersion_structure_nom", "Structure d'accueil", "immersion", "texte", "Immersion", "Bénéficiaire + immersion", "Structure d'accueil de l'immersion (phase 4 si utilisée)."],
  ["IMM-02", "immersion_tuteur_nom", "Nom du tuteur", "immersion", "texte", "Immersion", "Bénéficiaire + immersion", "Nom du tuteur d'immersion.", { sensibilite: "personnelle" }],
  ["IMM-03", "immersion_tuteur_contact", "Contact du tuteur", "immersion", "texte", "Immersion", "Bénéficiaire + immersion", "Coordonnées du tuteur d'immersion.", { sensibilite: "personnelle" }],
  ["IMM-04", "immersion_date_debut", "Début immersion", "immersion", "date", "Immersion", "Bénéficiaire + immersion", "Date de début de l'immersion.", { format: "date" }],
  ["IMM-05", "immersion_date_fin", "Fin immersion", "immersion", "date", "Immersion", "Bénéficiaire + immersion", "Date de fin de l'immersion.", { format: "date" }],
  ["IMM-06", "immersion_objectifs", "Objectifs immersion", "immersion", "liste", "Immersion", "Bénéficiaire + immersion", "Objectifs de l'immersion."],
  ["IMM-07", "immersion_bilan", "Bilan immersion", "immersion", "texte", "Immersion", "Bénéficiaire + immersion", "Bilan de l'immersion.", { format: "texte_long", sensibilite: "personnelle" }],
  // ── Document ──────────────────────────────────────────────
  ["DOC-01", "document_date", "Date de génération/édition", "document", "date", "Système", "Document", "Date calculée au moment de la génération.", { format: "date", calcule: true }],
  ["DOC-02", "document_reference", "Référence documentaire", "document", "texte", "Système / modèle", "Document", "Référence documentaire qualité."],
  ["DOC-03", "document_version", "Version du modèle", "document", "texte", "Registre modèles", "Document", "Version du modèle documentaire."],
  ["DOC-04", "document_redacteur", "Rédacteur affiché", "document", "texte", "Registre modèle / utilisateur", "Document", "Rédacteur affiché sur le document."],
  ["DOC-05", "document_approbateur", "Approbateur affiché", "document", "texte", "Registre modèle / paramètre", "Document", "Approbateur affiché sur le document."],
  ["DOC-06", "document_date_convocation", "Date de convocation", "document", "date", "Système / envoi", "Document", "Date de convocation ; champ distinct de document_date pour la traçabilité.", { format: "date" }],
  ["DOC-07", "document_date_attestation", "Date d'attestation", "document", "date", "Clôture session", "Document", "Date portée sur l'attestation, fixée à la clôture.", { format: "date" }],
  ["DOC-08", "signataire_nom", "Nom du signataire", "document", "texte", "Paramètres / utilisateur", "Document", "Nom du signataire du document."],
  ["DOC-09", "signataire_fonction", "Fonction du signataire", "document", "texte", "Paramètres / utilisateur", "Document", "Fonction du signataire du document."],
  ["DOC-10", "document_duree_attestation", "Durée totale de l'attestation", "document", "texte", "Session / formation", "Document", "Durée totale affichée sur l'attestation de formation. Utilise la durée de la session lorsqu'elle est renseignée ; à défaut, la durée de la formation. Le rendu conserve exactement le format historique de duree (« N h »).", { calcule: true, depuis: "1.3" }],
];

// Gel profond : le catalogue est un contrat, aucune entrée ne se modifie à chaud.
const figer = (o) => { for (const v of Object.values(o)) if (v && typeof v === "object" && !Object.isFrozen(v)) figer(v); return Object.freeze(o); };
export const VARIABLES = Object.freeze(LIGNES.map(([id, nom, libelle, domaine, type, source, portee, description, o = {}]) => figer({
  id, nom, balise: `{{${nom}}}`, libelle, description, domaine, type,
  format: o.format ?? null,
  ...(o.valeurs ? { valeurs: Object.freeze([...o.valeurs]) } : {}),
  ...(o.libelles ? { libelles: figer({ ...o.libelles }) } : {}),
  ...(o.valeurs_recommandees ? { valeurs_recommandees: Object.freeze([...o.valeurs_recommandees]) } : {}),
  ...(o.source_valeurs ? { source_valeurs: o.source_valeurs } : {}),
  sensibilite: o.sensibilite ?? "aucune",
  calcule: o.calcule === true,
  source, portee,
  ...(o.remarque ? { remarque: o.remarque } : {}),
  ...(o.renomme_depuis ? { renomme_depuis: o.renomme_depuis } : {}), // règle I : aucun renommage silencieux
  depuis: o.depuis ?? "1.0",
})));

// ── Blocs répétables ─────────────────────────────────────────
// `champs` : schéma des champs autorisés dans le bloc.
//   { variable: "phase_numero" }  ⇒ variable canonique répétée par élément ;
//   { nom, type, description, … } ⇒ champ LOCAL, valide UNIQUEMENT dans ce bloc.
const ref = (variable) => ({ variable });
const local = (nom, type, description, o = {}) => ({ nom, type, description, format: o.format ?? null, sensibilite: o.sensibilite ?? "aucune", ...(o.valeurs ? { valeurs: o.valeurs } : {}) });

const DEF_BLOCS = [
  { id: "BLK-01", nom: "phases", libelle: "Phases de la formation", source: "formation -> phases", documents: "Séquence globale, livret pédagogique, programme",
    champs: ["phase_numero", "phase_intitule", "phase_duree_heures", "phase_objectif_general", "phase_objectifs_operationnels", "phase_contenus", "phase_methodes",
      "phase_modalites_evaluation", "phase_date_debut", "phase_date_fin", "phase_resultat_niveau", "phase_resultat_score", "phase_observations_formateur",
      "phase_progression_commentaire", "phase_prochaine_etape"].map(ref) },
  { id: "BLK-02", nom: "objectifs_formation", libelle: "Objectifs opérationnels de la formation", source: "formation -> objectifs", documents: "Programme, tableau de correspondance",
    champs: [local("objectif_code", "texte", "Code de l'objectif."), local("objectif_libelle", "texte", "Libellé de l'objectif.")] },
  { id: "BLK-03", nom: "objectifs_phase", libelle: "Objectifs d'une phase", source: "phase -> objectifs", documents: "Séquence pédagogique, bilan",
    champs: [local("objectif_code", "texte", "Code de l'objectif."), local("objectif_libelle", "texte", "Libellé de l'objectif."),
      local("critere_reussite", "texte", "Critère de réussite de l'objectif.")] },
  { id: "BLK-04", nom: "seances", libelle: "Séances Insertion Pro", source: "groupe/session -> séances", documents: "Planning, feuilles d'émargement",
    champs: [...["seance_numero", "seance_date", "seance_heure_debut", "seance_heure_fin", "seance_duree_heures", "seance_theme", "seance_lieu",
      "seance_phase_numero", "seance_groupe_nom"].map(ref),
      local("seance_intervenants", "texte", "Nom(s) du ou des intervenants de la séance.")] },
  { id: "BLK-05", nom: "evaluations", libelle: "Évaluations et résultats", source: "stagiaire/phase -> évaluations", documents: "Livret, bilan intermédiaire, bilan final",
    champs: ["evaluation_intitule", "evaluation_moment", "evaluation_methode", "evaluation_date", "evaluation_score_obtenu", "evaluation_score_max", "evaluation_pourcentage",
      "evaluation_resultat_validation", "evaluation_niveau", "evaluation_commentaire", "evaluation_objectif_associe"].map(ref) },
  { id: "BLK-06", nom: "absences", libelle: "Absences", source: "stagiaire/session -> absences", documents: "Suivi assiduité, bilan",
    champs: [local("absence_date", "date", "Date de l'absence.", { format: "date" }),
      local("absence_duree_heures", "nombre", "Durée de l'absence en heures.", { format: "duree_heures" }),
      local("absence_justification", "booleen", "Absence justifiée ou non."),
      local("absence_motif", "texte", "Motif de l'absence.", { sensibilite: "personnelle" }),
      local("absence_action", "texte", "Action ou relance menée suite à l'absence.", { sensibilite: "personnelle" })] },
  { id: "BLK-07", nom: "adaptations", libelle: "Adaptations et aménagements", source: "stagiaire -> adaptations", documents: "Livret, suivi handicap", sensibilite: "restreinte",
    champs: [local("adaptation_categorie", "texte", "Catégorie de la mesure.", { format: "enum", sensibilite: "restreinte",
        valeurs: ["rythme", "supports", "accessibilite_locaux", "materiel", "modalites_evaluation", "accompagnement", "autre"] }),
      local("adaptation_mesure", "texte", "Mesure d'adaptation retenue.", { sensibilite: "restreinte" }),
      local("adaptation_statut", "texte", "Statut de la mesure.", { format: "enum", sensibilite: "restreinte", valeurs: ["prevue", "mise_en_oeuvre", "abandonnee"] }),
      local("adaptation_date_decision", "date", "Date de décision de la mesure.", { format: "date", sensibilite: "restreinte" }),
      local("adaptation_date_mise_en_oeuvre", "date", "Date de mise en œuvre de la mesure.", { format: "date", sensibilite: "restreinte" }),
      local("adaptation_bilan", "texte", "Bilan de la mesure.", { sensibilite: "restreinte" })] },
  { id: "BLK-08", nom: "immersions", libelle: "Immersions", source: "stagiaire -> immersions", documents: "Phase 4, bilan final",
    champs: ["immersion_structure_nom", "immersion_tuteur_nom", "immersion_tuteur_contact", "immersion_date_debut", "immersion_date_fin",
      "immersion_objectifs", "immersion_bilan"].map(ref) },
  { id: "BLK-09", nom: "intervenants", libelle: "Intervenants", source: "phase/groupe -> intervenants", documents: "Scénario, planning",
    champs: [...["intervenant_civilite", "intervenant_nom", "intervenant_prenom", "intervenant_nom_complet", "intervenant_fonction",
      "intervenant_email", "intervenant_telephone"].map(ref),
      local("intervenant_phase_numero", "nombre", "Phase où intervient l'intervenant."),
      local("intervenant_groupe_nom", "texte", "Groupe auprès duquel intervient l'intervenant.")] },
];

export const BLOCS = Object.freeze(DEF_BLOCS.map((b) => figer({
  id: b.id, nom: b.nom, ouverture: `{{#${b.nom}}}`, fermeture: `{{/${b.nom}}}`, libelle: b.libelle, type: "bloc",
  source: b.source, documents: b.documents, sensibilite: b.sensibilite ?? "aucune", depuis: "1.0",
  champs: Object.freeze(b.champs.map((c) => figer(c.variable ? { variable: c.variable } : { ...c, local: true }))),
})));

// ── Compatibilité avec les 23 marqueurs actuels (marqueurs.js) ─
// ALIAS : uniquement lorsque le resolver actuel (valeursMarqueurs) produit
// exactement la donnée du champ canonique. Un alias n'est jamais canonique.
export const ALIAS = Object.freeze({
  civilite: "stagiaire_civilite",          // stagiaire.civilite
  nom_stagiaire: "stagiaire_nom",           // stagiaire.nom
  prenom_stagiaire: "stagiaire_prenom",     // stagiaire.prenom
  date_debut: "session_date_debut",         // session.date_debut, JJ/MM/AAAA
  date_fin: "session_date_fin",             // session.date_fin, JJ/MM/AAAA
  horaire: "session_horaires",              // session.horaire
  intitule_formation: "formation_intitule", // formation.intitule
  nom_organisme: "organisme_nom",           // config ORGANISME_NOM
  email: "stagiaire_email",                 // stagiaire.email
  telephone: "stagiaire_telephone",         // stagiaire.telephone
  heures_absence: "absence_heures_total",   // somme absences.duree_heures de l'inscription
});

// HISTORIQUES : reconnus (le modèle reste valide) mais sans équivalent
// canonique certain ⇒ avertissement « à migrer ». La plupart sont parmi les
// 23 marqueurs actuels du moteur (marqueurs.js) ; date_convocation ne l'est
// PAS — c'est un marqueur trouvé dans un modèle Drive réel, mais que le
// moteur actuel ne résout pas du tout (absent de MARQUEURS).
export const HISTORIQUES = figer({
  date_attestation: { raison: "Vaut aujourd'hui la date de fin de session (même resolver que date_fin), et non une date fixée explicitement à la clôture comme le prévoit document_date_attestation (DOC-07).", cibles_possibles: ["document_date_attestation", "session_date_fin"] },
  date_convocation: { raison: "Non résolu par le moteur actuel : absent des 23 marqueurs de marqueurs.js, donc laissé tel quel (non remplacé) dans les documents produits aujourd'hui. Utilisé dans un modèle Drive réel de convocation. Correspond à document_date_convocation (DOC-06), distincte de la date de génération technique (document_date, DOC-01).", cibles_possibles: ["document_date_convocation"] },
  duree: { raison: "Durée déclarée de la session, à défaut celle de la version de formation, rendue « N h ». Équivalent exact de document_duree_attestation (v1.3).", cibles_possibles: ["document_duree_attestation"] },
  lieu: { raison: "Lieu du groupe en priorité, à défaut celui de la session.", cibles_possibles: ["session_lieu"] },
  formateur: { raison: "Formateurs rattachés au groupe ou à la session, à défaut texte historique ; aucune variable canonique équivalente.", cibles_possibles: ["bloc intervenants"] },
  entreprise: { raison: "Entreprise saisie sur le stagiaire ; aucune variable canonique équivalente.", cibles_possibles: [] },
  financeur: { raison: "Financeur saisi sur le stagiaire, alors que financeur_nom est porté par la formation ou la session.", cibles_possibles: ["financeur_nom"] },
  prescripteur: { raison: "Nom du prescripteur configuré, à défaut son code brut.", cibles_possibles: ["prescripteur_nom"] },
  groupe: { raison: "Groupe du stagiaire pour un document individuel, sinon groupe visé par la génération.", cibles_possibles: ["stagiaire_groupe_nom", "groupe_nom"] },
  heures_suivies: { raison: "Calculé depuis la durée déclarée moins les absences, et non depuis les émargements.", cibles_possibles: ["presence_heures_realisees"] },
  taux_assiduite: { raison: "Calculé sur la durée déclarée de la session, et non sur les heures planifiées.", cibles_possibles: ["presence_taux"] },
  session_statut: { raison: "Libellé humain du statut de session (ex. « Terminée »). La variable canonique correspondante est session_statut_code (valeur métier brute), dont le rendu n'est pas équivalent : ce n'est donc PAS un alias.", cibles_possibles: ["session_statut_code"] },
});

// ── Index et recherches ─────────────────────────────────────
const PAR_NOM = new Map(VARIABLES.map((v) => [v.nom, v]));
const BLOC_PAR_NOM = new Map(BLOCS.map((b) => [b.nom, b]));
const aCle = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export const variableCanonique = (nom) => PAR_NOM.get(nom) ?? null;
export const blocCanonique = (nom) => BLOC_PAR_NOM.get(nom) ?? null;
export const resoudreAlias = (nom) => (aCle(ALIAS, nom) ? ALIAS[nom] : null);
export const marqueurHistorique = (nom) => (aCle(HISTORIQUES, nom) ? HISTORIQUES[nom] : null);
// Champ local d'un bloc (null si le nom n'est pas un champ local de ce bloc).
export function champLocal(nomBloc, nom) {
  const b = BLOC_PAR_NOM.get(nomBloc);
  return b?.champs.find((c) => c.local && c.nom === nom) ?? null;
}
// Blocs déclarant ce nom comme champ local.
export const blocsDuChampLocal = (nom) => BLOCS.filter((b) => b.champs.some((c) => c.local && c.nom === nom)).map((b) => b.nom);

// Vue publique, en lecture seule, pour l'API.
export function catalogue() {
  return {
    version: DICTIONNAIRE_VERSION, evolutions: EVOLUTIONS,
    syntaxe: { variable: "{{nom_variable}}", bloc: "{{#bloc}} … {{/bloc}}" },
    types: TYPES, formats: FORMATS, sensibilites: SENSIBILITES, domaines: DOMAINES,
    variables: VARIABLES, blocs: BLOCS, alias: ALIAS, historiques: HISTORIQUES,
  };
}
