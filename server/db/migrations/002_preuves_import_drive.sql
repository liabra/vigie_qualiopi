-- ─────────────────────────────────────────────────────────────
--  Phase 1 — indexation du classeur de suivi Drive
--  · statuts de conformité sur les preuves (Maîtrisé / À consolider /
--    À risque / Non applicable) à la place des statuts documentaires
--  · type_alerte devient facultatif : la Phase 1 n'alimente pas encore
--    les échéances, c'est une phase à part
--  · traçabilité de l'import : d'où vient la ligne, et si le fichier
--    Drive a bien été retrouvé
-- ─────────────────────────────────────────────────────────────

CREATE TABLE imports_drive (
  id                serial PRIMARY KEY,
  fichier_id        text NOT NULL,
  fichier_nom       text NOT NULL,
  fichier_url       text,
  onglet            text,
  entetes           jsonb NOT NULL DEFAULT '[]'::jsonb,   -- en-têtes réellement lus
  colonnes          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- correspondance retenue
  lignes_lues       integer NOT NULL DEFAULT 0,
  preuves_creees    integer NOT NULL DEFAULT 0,
  preuves_majes     integer NOT NULL DEFAULT 0,
  lignes_ignorees   jsonb NOT NULL DEFAULT '[]'::jsonb,
  statut            text NOT NULL DEFAULT 'en_cours'
                      CHECK (statut IN ('en_cours', 'termine', 'echec')),
  erreur            text,
  lance_par         integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  demarre_le        timestamptz NOT NULL DEFAULT now(),
  termine_le        timestamptz
);

-- type_alerte : facultatif tant que les échéances ne sont pas traitées.
ALTER TABLE preuves ALTER COLUMN type_alerte DROP NOT NULL;

-- Statuts de conformité. La table est vide à ce stade (aucun import
-- n'a encore tourné), la conversion ci-dessous n'est qu'une sécurité.
ALTER TABLE preuves DROP CONSTRAINT preuves_statut_check;
UPDATE preuves SET statut = CASE statut
  WHEN 'valide'    THEN 'maitrise'
  WHEN 'a_reviser' THEN 'a_consolider'
  ELSE 'a_risque' END;
ALTER TABLE preuves ALTER COLUMN statut SET DEFAULT 'a_risque';
ALTER TABLE preuves ADD CONSTRAINT preuves_statut_check
  CHECK (statut IN ('maitrise', 'a_consolider', 'a_risque', 'non_applicable'));

ALTER TABLE preuves
  ADD COLUMN source        text NOT NULL DEFAULT 'manuel'
                             CHECK (source IN ('manuel', 'import_drive')),
  -- true = document nommé dans le classeur mais pas retrouvé sur le Drive,
  -- ou retrouvé avec un doute : l'admin doit confirmer le rattachement.
  ADD COLUMN a_confirmer   boolean NOT NULL DEFAULT false,
  ADD COLUMN motif_confirmation text,
  -- Candidats Drive proposés à l'admin, pour corriger en un clic.
  ADD COLUMN candidats     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN drive_nom     text,
  ADD COLUMN drive_mime    text,
  ADD COLUMN modele_nom    text,
  ADD COLUMN tache         text,
  ADD COLUMN etat_source   text,
  ADD COLUMN occurrences   smallint NOT NULL DEFAULT 1,
  ADD COLUMN lignes_source integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN import_id     integer REFERENCES imports_drive(id) ON DELETE SET NULL,
  ADD COLUMN validee_le    timestamptz,
  ADD COLUMN validee_par   integer REFERENCES utilisateurs(id) ON DELETE SET NULL;

-- Rejouer l'import ne duplique pas : un même document, sur un même
-- indicateur, reste une seule preuve importée.
CREATE UNIQUE INDEX preuves_import_unique
  ON preuves (indicateur_id, md5(lower(titre)))
  WHERE source = 'import_drive';
CREATE INDEX preuves_a_confirmer ON preuves (a_confirmer) WHERE a_confirmer;
