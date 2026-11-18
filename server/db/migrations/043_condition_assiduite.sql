-- Nouvelle condition de génération conditionnelle : « assiduite_atteinte » (assiduité d'au moins 80 %,
-- abandons exclus). Sert à délivrer automatiquement l'attestation en fin de session aux seuls stagiaires
-- concernés. Additive : élargit la liste des valeurs admises, ne modifie aucune ligne.
ALTER TABLE modeles_documents DROP CONSTRAINT IF EXISTS modeles_documents_condition_code_check;
ALTER TABLE modeles_documents ADD CONSTRAINT modeles_documents_condition_code_check
  CHECK (condition_code IN ('situation_handicap', 'besoin_adaptation', 'prescripteur_renseigne', 'assiduite_atteinte'));
