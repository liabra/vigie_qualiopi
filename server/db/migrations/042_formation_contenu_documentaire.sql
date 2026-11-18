-- Contenu documentaire d'une version de formation : objectifs opérationnels (liste), méthodes
-- pédagogiques et modalités d'évaluation. Ils alimentent les variables {{formation_objectifs_operationnels}},
-- {{formation_methodes_pedagogiques}}, {{formation_modalites_evaluation}} et le bloc {{#objectifs_formation}}
-- (convention, programme, bilan…).
--
-- Additive : les versions existantes reçoivent une liste vide et deux champs vides ; rien n'est modifié.
ALTER TABLE formation_versions
  ADD COLUMN objectifs_operationnels text[] NOT NULL DEFAULT '{}',
  ADD COLUMN methodes_pedagogiques   text CHECK (char_length(methodes_pedagogiques) <= 4000),
  ADD COLUMN modalites_evaluation    text CHECK (char_length(modalites_evaluation) <= 4000),
  ADD CONSTRAINT formation_versions_objectifs_bornes CHECK (cardinality(objectifs_operationnels) <= 30);
