-- ─────────────────────────────────────────────────────────────
--  Veille : suivi SÉPARÉ de l'action, sans toucher au cycle de la
--  veille. `veille.statut` reste inchangé (a_analyser, analysee,
--  integree, sans_impact) : aucune contrainte existante n'est levée.
--
--  Cycle de la veille  : a_analyser → analysee → integree / sans_impact
--  Cycle de l'action   : aucune → a_realiser → realisee
--
--  Additif et sans perte : colonnes NULL ou avec valeur par défaut,
--  aucune ligne existante n'est réécrite, aucune colonne retirée.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE veille
  ADD COLUMN date_consultation date,
  ADD COLUMN action text,
  ADD COLUMN statut_action text NOT NULL DEFAULT 'aucune'
    CHECK (statut_action IN ('aucune', 'a_realiser', 'realisee')),
  ADD COLUMN action_realisee_le date;
