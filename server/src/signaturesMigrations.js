// Signatures des migrations : pour chaque fichier, une requête en LECTURE SEULE qui renvoie `ok`
// vrai si l'effet caractéristique de la migration est présent dans le schéma.
//
// Usage unique : établir la référence d'une base déjà peuplée dont la table schema_migrations
// est vide (schéma appliqué hors du lanceur). Une migration dont la signature est présente est
// enregistrée sans être rejouée ; une migration absente est appliquée normalement ensuite.
// Toute nouvelle migration DOIT ajouter sa signature ici (le lanceur refuse sinon d'établir
// une référence, plutôt que de rejouer un fichier sur une base existante).

const table = (nom) => `SELECT to_regclass('public.${nom}') IS NOT NULL AS ok`;
const colonne = (t, c) =>
  `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${t}' AND column_name = '${c}') AS ok`;
const vueContient = (vue, texte) =>
  `SELECT EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = '${vue}' AND definition LIKE '%${texte}%') AS ok`;

export const SIGNATURES = {
  "001_schema_initial.sql": table("referentiel_versions"),
  "002_preuves_import_drive.sql": table("imports_drive"),
  "003_indicateurs_non_applicables.sql": table("indicateurs_non_applicables"),
  "004_preuves_multi_fichiers.sql": table("preuve_fichiers"),
  "005_sessions_et_modeles.sql": table("modeles_documents"),
  // 006 crée la colonne calculée alerte_statut dans la vue preuves_enrichies.
  "006_alertes_peremption.sql": vueContient("preuves_enrichies", "alerte_statut"),
  // 007 supprime les deux CHECK sans nom de 001 (preuves_check, preuves_check1).
  "007_alertes_contraintes_souples.sql": `SELECT NOT EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'preuves' AND c.conname IN ('preuves_check', 'preuves_check1')) AS ok`,
  "008_civilite_stagiaire.sql": colonne("stagiaires", "civilite"),
  "009_audits_rapport_drive.sql": colonne("audits_history", "rapport_drive_url"),
  "010_horaire_session.sql": colonne("sessions", "horaire"),
  "011_prescripteurs_configurables.sql": table("prescripteurs"),
  "012_veille_actions.sql": colonne("veille", "date_consultation"),
  "013_evaluations_qcm.sql": colonne("resultats_qcm", "resultat"),
  "014_archivage_sessions.sql": colonne("sessions", "archivee_le"),
  "015_qualite_actions_signalements.sql": table("signalements_qualite"),
  "016_liens_preuves_qualite.sql": table("liens_preuves_qualite"),
  "017_recueils_besoin.sql": table("recueils_besoin"),
  "018_adaptations_parcours.sql": table("adaptations_parcours"),
  "019_suivi_inscriptions.sql": table("suivis_inscription"),
  // 020 redéfinit la vue avec le fuseau métier America/Cayenne.
  "020_dates_metier_preuves.sql": vueContient("preuves_enrichies", "America/Cayenne"),
  // 021 étend les types de satisfaction (prescripteur, partenaire).
  "021_satisfaction_publics.sql": `SELECT EXISTS (
      SELECT 1 FROM pg_constraint c WHERE c.conname = 'satisfactions_type_check'
      AND pg_get_constraintdef(c.oid) LIKE '%partenaire%') AS ok`,
  "022_actions_satisfaction.sql": colonne("actions_qualite", "satisfaction_id"),
  "023_intervenants.sql": table("intervenants"),
  "024_justificatifs_intervenants.sql": table("preuves_confidentielles"),
  "025_seances_suivi_pedagogique.sql": table("seances"),
  "032_referentiel_statut_guide.sql": colonne("referentiel_versions", "guide_de_lecture_disponible"),
  "033_questionnaires_formation.sql": table("questionnaires"),
  "036_modeles_bibliotheque.sql": colonne("modeles_documents", "type_document"),
  "037_modeles_typologie_unicite.sql": "SELECT to_regclass('public.modeles_un_actif_par_fichier_portee') IS NOT NULL AS ok",
  "038_generations_automatiques.sql": table("generations_planifiees"),
  "039_bascules_referentiel.sql": table("bascules_referentiel"),
  "040_questionnaires_ordre_differe.sql": `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'questionnaire_questions_ordre_unique') AS ok`,
};
