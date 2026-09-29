-- ─────────────────────────────────────────────────────────────
--  Après VF — archivage / cycle de vie des sessions.
--
--  L'archivage est la voie normale : une session archivée reste
--  CONSULTABLE et en lecture seule, sans perte de donnée. La
--  suppression définitive est réservée aux sessions réellement
--  vides (voir DELETE /api/sessions/:id), jamais en cascade.
--
--  Colonnes purement additives, sans réécriture de données :
--  · archivee_le : date d'archivage (NULL = session active) ;
--  · archivee_par : admin ayant archivé, cohérent avec les colonnes
--    `cree_par` / `connecte_par` / `lancee_par` déjà en place.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE sessions
  ADD COLUMN archivee_le timestamptz,
  ADD COLUMN archivee_par integer REFERENCES utilisateurs(id) ON DELETE SET NULL;

-- Aucun index dédié : la table `sessions` reste de très petite taille
-- (une poignée de lignes) ; le filtre `archivee_le IS NULL / IS NOT NULL`
-- de la liste n'en a pas besoin. À réévaluer si le volume changeait.
