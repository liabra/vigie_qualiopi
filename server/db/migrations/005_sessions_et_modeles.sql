-- ─────────────────────────────────────────────────────────────
--  Phase 2 — sessions réelles et génération de documents
--
--  1. Les formations deviennent VERSIONNÉES : `formations` porte
--     l'identité stable, `formation_versions` le contenu qui évolue.
--     Une session pointe sur la version en vigueur au moment de sa
--     création, donc réviser une formation ne réécrit jamais l'histoire
--     des sessions déjà lancées.
--  2. `modeles_documents` : les Google Docs/Sheets qui servent de
--     gabarits, et les indicateurs dont ils font la preuve.
--  3. `documents_generes` : ce que l'application a produit, pour ne
--     jamais regénérer en double.
-- ─────────────────────────────────────────────────────────────

-- ── Formations versionnées ───────────────────────────────────
-- Les colonnes descriptives quittent `formations` : elles vivent
-- désormais dans les versions. Les tables sont vides à ce stade, rien
-- n'est perdu.
ALTER TABLE formations
  DROP COLUMN objectifs,
  DROP COLUMN prerequis,
  DROP COLUMN public_vise,
  DROP COLUMN duree_heures,
  DROP COLUMN modalite,
  DROP COLUMN certifiante,
  DROP COLUMN code_rncp_rs,
  DROP COLUMN tarif_ht,
  DROP COLUMN accessibilite_handicap;

CREATE TABLE formation_versions (
  id                    serial PRIMARY KEY,
  formation_id          integer NOT NULL REFERENCES formations(id) ON DELETE CASCADE,
  numero                integer NOT NULL,
  -- Contenu pédagogique, figé une fois la version créée.
  objectifs             text,
  prerequis             text,
  public_vise           text,
  programme             text,
  scenario_pedagogique  text,
  competences           text[] NOT NULL DEFAULT '{}',
  duree_heures_defaut   numeric(7,2) CHECK (duree_heures_defaut >= 0),
  modalite              text CHECK (modalite IN ('presentiel', 'distanciel', 'mixte')),
  certifiante           boolean NOT NULL DEFAULT false,
  code_rncp_rs          text,
  tarif_ht              numeric(10,2) CHECK (tarif_ht >= 0),
  accessibilite_handicap text,
  cree_par              integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (formation_id, numero)
);
CREATE INDEX formation_versions_formation ON formation_versions (formation_id);

-- La session retient SA version. NULL seulement pour d'éventuelles
-- sessions créées avant cette migration : il n'y en a aucune.
ALTER TABLE sessions
  ADD COLUMN formation_version_id integer REFERENCES formation_versions(id) ON DELETE RESTRICT,
  ADD COLUMN duree_heures_reelle numeric(7,2) CHECK (duree_heures_reelle >= 0);

-- Un groupe porte son lieu et son formateur : deux groupes d'une même
-- session peuvent se tenir sur deux sites, avec deux intervenants.
ALTER TABLE groupes
  ADD COLUMN lieu text,
  ADD COLUMN formateur text,
  ADD COLUMN drive_folder_id text;

-- Renseignements portés par l'inscription, pas par la personne : le
-- prescripteur et l'état du dossier peuvent différer d'une session à
-- l'autre pour un même stagiaire.
ALTER TABLE inscriptions
  ADD COLUMN prescripteur text CHECK (prescripteur IN ('pole_emploi', 'mission_locale', 'of', 'autre')),
  ADD COLUMN dossier_complet boolean NOT NULL DEFAULT false;

-- ── Modèles de documents ─────────────────────────────────────
CREATE TABLE modeles_documents (
  id            serial PRIMARY KEY,
  nom           text NOT NULL,
  -- Google Doc ou Google Sheet EXISTANT sur le Drive, saisi à la main.
  drive_file_id text NOT NULL,
  drive_url     text,
  drive_mime    text,
  -- Ce qu'une génération produit : un document pour la formation, la
  -- session, le groupe… ou un par stagiaire.
  portee        text NOT NULL CHECK (portee IN ('formation', 'session', 'groupe', 'stagiaire')),
  description   text,
  actif         boolean NOT NULL DEFAULT true,
  cree_par      integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (drive_file_id, portee)
);

-- Un modèle peut servir de preuve à plusieurs indicateurs.
CREATE TABLE modele_indicateurs (
  modele_id     integer NOT NULL REFERENCES modeles_documents(id) ON DELETE CASCADE,
  indicateur_id integer NOT NULL REFERENCES indicateurs(id) ON DELETE CASCADE,
  PRIMARY KEY (modele_id, indicateur_id)
);

-- ── Documents produits ───────────────────────────────────────
CREATE TABLE generations (
  id          serial PRIMARY KEY,
  modele_id   integer NOT NULL REFERENCES modeles_documents(id) ON DELETE CASCADE,
  session_id  integer REFERENCES sessions(id) ON DELETE CASCADE,
  groupe_id   integer REFERENCES groupes(id) ON DELETE CASCADE,
  nb_documents integer NOT NULL DEFAULT 0,
  nb_remplaces integer NOT NULL DEFAULT 0,
  lancee_par  integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  lancee_le   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents_generes (
  id             serial PRIMARY KEY,
  modele_id      integer NOT NULL REFERENCES modeles_documents(id) ON DELETE CASCADE,
  session_id     integer REFERENCES sessions(id) ON DELETE CASCADE,
  groupe_id      integer REFERENCES groupes(id) ON DELETE CASCADE,
  stagiaire_id   integer REFERENCES stagiaires(id) ON DELETE CASCADE,
  generation_id  integer REFERENCES generations(id) ON DELETE SET NULL,
  drive_file_id  text NOT NULL,
  drive_url      text,
  nom            text,
  -- La preuve créée pour ce document, qui réutilise le comptage existant.
  preuve_id      integer REFERENCES preuves(id) ON DELETE SET NULL,
  genere_le      timestamptz NOT NULL DEFAULT now(),
  remplace_le    timestamptz
);
-- Un seul document vivant par couple modèle / groupe / stagiaire :
-- regénérer remplace, n'empile pas. COALESCE parce qu'en SQL deux NULL
-- ne sont pas égaux, et groupe_id/stagiaire_id sont vides selon la portée.
CREATE UNIQUE INDEX documents_generes_unicite
  ON documents_generes (modele_id, COALESCE(session_id, 0), COALESCE(groupe_id, 0), COALESCE(stagiaire_id, 0));
CREATE INDEX documents_generes_session ON documents_generes (session_id);

CREATE TRIGGER modeles_documents_updated_at BEFORE UPDATE ON modeles_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Lien preuve ↔ modèle ─────────────────────────────────────
-- Une preuve issue d'une génération est identifiée par son modèle, son
-- indicateur et la session/groupe visés : regénérer la retrouve au lieu
-- d'en créer une seconde.
ALTER TABLE preuves
  ADD COLUMN modele_id integer REFERENCES modeles_documents(id) ON DELETE SET NULL,
  DROP CONSTRAINT preuves_source_check,
  ADD CONSTRAINT preuves_source_check CHECK (source IN ('manuel', 'import_drive', 'generation'));

CREATE UNIQUE INDEX preuves_modele_unicite
  ON preuves (modele_id, indicateur_id, COALESCE(session_id, 0), COALESCE(groupe_id, 0))
  WHERE modele_id IS NOT NULL;

-- Une pièce jointe peut désormais venir d'une génération : ni saisie à la
-- main, ni rapprochée depuis le classeur.
ALTER TABLE preuve_fichiers
  DROP CONSTRAINT preuve_fichiers_source_check,
  ADD CONSTRAINT preuve_fichiers_source_check CHECK (source IN ('manuel', 'import_drive', 'generation'));
