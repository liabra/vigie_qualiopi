-- Bibliothèque de modèles : type de document, mode de génération, conditions.
-- Les modèles existants reçoivent les valeurs neutres : type « autre » (à classer) et
-- génération « manuelle » (seul mode réellement exécuté aujourd'hui, aucun déclenchement automatique).
-- L'API exige désormais ces champs à la création ; les DEFAULT ne servent qu'aux insertions directes.
ALTER TABLE modeles_documents
  ADD COLUMN type_document      text NOT NULL DEFAULT 'autre'
    CHECK (type_document IN ('attestation', 'convocation', 'emargement', 'fiche_session',
                             'convention', 'compte_rendu', 'evaluation', 'bilan', 'autre')),
  ADD COLUMN mode_generation    text NOT NULL DEFAULT 'manuel'
    CHECK (mode_generation IN ('manuel', 'automatique', 'conditionnel')),
  ADD COLUMN condition_generation text,
  ADD CONSTRAINT modeles_condition_coherente CHECK (
    (mode_generation = 'conditionnel' AND condition_generation IS NOT NULL AND btrim(condition_generation) <> '')
    OR (mode_generation <> 'conditionnel' AND condition_generation IS NULL)
  );
