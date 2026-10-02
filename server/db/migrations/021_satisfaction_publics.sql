-- ─────────────────────────────────────────────────────────────
--  Q3-1 — Satisfaction : deux publics supplémentaires.
--
--  Additif : on élargit la liste fermée des types (prescripteur,
--  partenaire), sans toucher aux réponses existantes. Une enquête reste
--  toujours rattachée à une session (session_id NOT NULL inchangé).
--  La note « sur 5 » des nouvelles réponses est imposée par l'API, pas
--  par une contrainte SQL : les réponses historiques sur une autre échelle
--  restent valides et intactes.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE satisfactions DROP CONSTRAINT satisfactions_type_check;
ALTER TABLE satisfactions ADD CONSTRAINT satisfactions_type_check
  CHECK (type IN ('a_chaud', 'a_froid', 'financeur', 'entreprise', 'formateur', 'prescripteur', 'partenaire'));
