-- Questionnaires : l'unicité de l'ordre des questions est vérifiée en fin de transaction, pour
-- permettre de réordonner (échanger deux positions) sans violation intermédiaire.
ALTER TABLE questionnaire_questions
  DROP CONSTRAINT questionnaire_questions_questionnaire_id_ordre_key,
  ADD CONSTRAINT questionnaire_questions_ordre_unique UNIQUE (questionnaire_id, ordre) DEFERRABLE INITIALLY DEFERRED;
