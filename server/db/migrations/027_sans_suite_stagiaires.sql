-- ─────────────────────────────────────────────────────────────
--  DOC-9C bis — Gestion des jeunes non inscrits.
--
--  Additif uniquement : aucune table existante modifiée.
--
--  État « Sans suite » pour une personne qui n'est inscrite à AUCUNE
--  session. Réversible : `sans_suite_le` NULL = actif, non NULL = sans
--  suite. Les statuts d'inscription (`inscriptions.statut`) restent
--  inchangés.
--
--  Aucune purge automatique : la suppression définitive est une action
--  administrateur explicite (route), jamais déclenchée par le temps.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE stagiaires
  ADD COLUMN sans_suite_le   timestamptz,
  ADD COLUMN sans_suite_par  integer REFERENCES utilisateurs(id) ON DELETE SET NULL;
