-- ─────────────────────────────────────────────────────────────
--  Le rapport d'audit est un fichier du Drive. La table ne gardait
--  que son identifiant : sans lien ni nom, l'écran ne pouvait pas
--  proposer de l'ouvrir ni rappeler de quel fichier il s'agit.
--  Mêmes colonnes que preuve_fichiers, pour ne pas inventer une
--  seconde façon de référencer un fichier.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE audits_history
  ADD COLUMN rapport_drive_url text,
  ADD COLUMN rapport_drive_nom text;
