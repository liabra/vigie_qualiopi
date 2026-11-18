-- Typologie documentaire à 12 catégories, et unicité limitée aux modèles actifs.
-- « fiche_session » devient « fiche_recapitulative » (aucun modèle n'avait encore cette valeur :
-- la migration 036 attribuait « autre » à tous les existants).
UPDATE modeles_documents SET type_document = 'fiche_recapitulative' WHERE type_document = 'fiche_session';

ALTER TABLE modeles_documents DROP CONSTRAINT modeles_documents_type_document_check;
ALTER TABLE modeles_documents ADD CONSTRAINT modeles_documents_type_document_check CHECK (
  type_document IN ('attestation', 'convocation', 'emargement', 'fiche_recapitulative', 'convention',
                    'compte_rendu', 'evaluation', 'bilan', 'programme', 'scenario_pedagogique',
                    'questionnaire', 'autre')
);

-- Plusieurs modèles désactivés (historique) peuvent partager un couple fichier × portée,
-- mais un seul modèle actif par couple.
ALTER TABLE modeles_documents DROP CONSTRAINT modeles_documents_drive_file_id_portee_key;
CREATE UNIQUE INDEX modeles_un_actif_par_fichier_portee ON modeles_documents (drive_file_id, portee) WHERE actif;
