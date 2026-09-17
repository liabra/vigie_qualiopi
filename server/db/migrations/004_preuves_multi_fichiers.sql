-- ─────────────────────────────────────────────────────────────
--  Une preuve peut porter PLUSIEURS fichiers Drive.
--
--  mode_fichiers décide de ce qu'on attend :
--    'unique'        — un seul fichier, comportement d'origine, inchangé
--                      (planning, bilan… les preuves classiques)
--    'multiple'      — plusieurs fichiers, sans nombre attendu
--    'par_stagiaire' — un fichier par stagiaire inscrit : le nombre
--                      attendu est CALCULÉ depuis les inscriptions de la
--                      session (ou du groupe) rattachée, jamais saisi
-- ─────────────────────────────────────────────────────────────

CREATE TABLE preuve_fichiers (
  id            serial PRIMARY KEY,
  preuve_id     integer NOT NULL REFERENCES preuves(id) ON DELETE CASCADE,
  drive_file_id text NOT NULL,
  drive_url     text,
  drive_nom     text,
  drive_mime    text,
  -- 'import_drive' = posé par le rapprochement automatique, 'manuel' =
  -- choisi par l'admin. Un réimport ne retouche que les premiers.
  source        text NOT NULL DEFAULT 'manuel' CHECK (source IN ('manuel', 'import_drive')),
  -- Facultatif : à qui ce fichier se rapporte, en mode par stagiaire.
  stagiaire_id  integer REFERENCES stagiaires(id) ON DELETE SET NULL,
  ajoute_par    integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  ajoute_le     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (preuve_id, drive_file_id)
);
CREATE INDEX preuve_fichiers_preuve ON preuve_fichiers (preuve_id);

-- Reprise de l'existant : le fichier unique de chaque preuve devient sa
-- première pièce jointe. Rien n'est perdu.
INSERT INTO preuve_fichiers (preuve_id, drive_file_id, drive_url, drive_nom, drive_mime, source, ajoute_le)
SELECT id, drive_file_id, drive_url, drive_nom, drive_mime,
       CASE WHEN source = 'import_drive' THEN 'import_drive' ELSE 'manuel' END,
       created_at
FROM preuves
WHERE drive_file_id IS NOT NULL;

ALTER TABLE preuves
  DROP COLUMN drive_file_id,
  DROP COLUMN drive_url,
  DROP COLUMN drive_nom,
  DROP COLUMN drive_mime,
  ADD COLUMN mode_fichiers text NOT NULL DEFAULT 'unique'
    CHECK (mode_fichiers IN ('unique', 'multiple', 'par_stagiaire')),
  -- Le décompte par stagiaire peut viser un groupe précis (un lieu, une
  -- cohorte) plutôt que la session entière.
  ADD COLUMN groupe_id integer REFERENCES groupes(id) ON DELETE SET NULL;

-- ── Vues de calcul ───────────────────────────────────────────
-- Le nombre rattaché, le nombre attendu et l'écart sont calculés ICI, une
-- seule fois, pour que le tableau de bord et l'écran Preuves ne puissent
-- pas diverger.

CREATE VIEW preuves_comptees AS
SELECT
  p.*,
  (SELECT count(*)::int FROM preuve_fichiers f WHERE f.preuve_id = p.id) AS nb_fichiers,
  -- NULL quand le nombre attendu ne veut rien dire : mode non concerné,
  -- ou aucune session/groupe rattaché pour le calculer.
  CASE
    WHEN p.mode_fichiers = 'par_stagiaire' AND (p.groupe_id IS NOT NULL OR p.session_id IS NOT NULL)
    THEN (
      SELECT count(*)::int FROM inscriptions i
      WHERE i.statut <> 'abandon'
        AND ((p.groupe_id IS NOT NULL AND i.groupe_id = p.groupe_id)
          OR (p.groupe_id IS NULL AND i.session_id = p.session_id))
    )
  END AS fichiers_attendus
FROM preuves p;

CREATE VIEW preuves_enrichies AS
SELECT
  e.*,
  -- Un statut « maîtrisé » ne doit pas masquer un compte incomplet : il
  -- redescend à « à consolider » pour le tableau de bord.
  CASE WHEN e.incomplet AND e.statut = 'maitrise' THEN 'a_consolider' ELSE e.statut END AS statut_effectif
FROM (
  SELECT
    c.*,
    (
      c.mode_fichiers <> 'unique'
      AND c.statut <> 'non_applicable'
      AND (
        (c.fichiers_attendus IS NOT NULL AND c.nb_fichiers < c.fichiers_attendus)
        -- par_stagiaire sans session rattachée : on ne PEUT pas prouver
        -- que le compte est atteint, donc il ne l'est pas.
        OR (c.fichiers_attendus IS NULL AND (c.mode_fichiers = 'par_stagiaire' OR c.nb_fichiers = 0))
      )
    ) AS incomplet
  FROM preuves_comptees c
) e;
