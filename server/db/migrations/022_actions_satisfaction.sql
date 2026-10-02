-- ─────────────────────────────────────────────────────────────
--  Q3-2 — Actions qualité issues d'un retour de satisfaction.
--
--  Additif. L'origine « satisfaction » rejoint « manuel » et « signalement ».
--  Provenance enregistrée SANS aucune donnée personnelle :
--    - depuis une réponse : satisfaction_id (lien fiable, mis à NULL si la
--      réponse disparaît) ; la session est celle de la réponse ;
--    - depuis une synthèse : période (satisfaction_du / satisfaction_au) et
--      public ; formation / session seulement si la synthèse les visait
--      (colonnes existantes formation_id / session_id), jamais inventées.
--  Aucune action n'est créée automatiquement : seul l'admin en crée une.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE actions_qualite
  ADD COLUMN satisfaction_id integer REFERENCES satisfactions(id) ON DELETE SET NULL,
  ADD COLUMN satisfaction_public text
    CHECK (satisfaction_public IS NULL OR satisfaction_public IN
      ('a_chaud', 'a_froid', 'financeur', 'entreprise', 'formateur', 'prescripteur', 'partenaire')),
  ADD COLUMN satisfaction_du date,
  ADD COLUMN satisfaction_au date,
  ADD CONSTRAINT actions_qualite_satisfaction_periode_check
    CHECK (satisfaction_du IS NULL OR satisfaction_au IS NULL OR satisfaction_du <= satisfaction_au);

ALTER TABLE actions_qualite DROP CONSTRAINT actions_qualite_origine_check;
ALTER TABLE actions_qualite ADD CONSTRAINT actions_qualite_origine_check
  CHECK (origine IN ('manuel', 'signalement', 'satisfaction'));

-- Cohérence origine / rattachements : une action issue de la satisfaction
-- n'a pas de signalement ; une provenance satisfaction impose l'origine.
ALTER TABLE actions_qualite DROP CONSTRAINT actions_qualite_check;
ALTER TABLE actions_qualite ADD CONSTRAINT actions_qualite_check CHECK (
  (origine = 'signalement' AND signalement_id IS NOT NULL)
  OR (origine = 'manuel' AND signalement_id IS NULL)
  OR (origine = 'satisfaction' AND signalement_id IS NULL)
);
ALTER TABLE actions_qualite ADD CONSTRAINT actions_qualite_satisfaction_origine_check CHECK (
  origine = 'satisfaction'
  OR (satisfaction_id IS NULL AND satisfaction_public IS NULL AND satisfaction_du IS NULL AND satisfaction_au IS NULL)
);
CREATE INDEX actions_satisfaction ON actions_qualite (satisfaction_id);
