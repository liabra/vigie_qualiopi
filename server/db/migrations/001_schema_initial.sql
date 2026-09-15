-- ─────────────────────────────────────────────────────────────
--  Vigie Qualiopi — schéma initial (Phase 0)
--  Appliqué une seule fois par le runner de migrations (schema_migrations).
--  Toute évolution passe par un NOUVEAU fichier 00X_*.sql, jamais par
--  la modification de celui-ci une fois déployé.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Référentiel ──────────────────────────────────────────────

CREATE TABLE referentiel_versions (
  id               serial PRIMARY KEY,
  code             text NOT NULL UNIQUE,            -- 'V9'
  libelle          text NOT NULL,
  date_publication date,
  date_application date,
  source           text,                             -- URL / référence du guide de lecture
  est_active       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- Une seule version active à la fois.
CREATE UNIQUE INDEX referentiel_versions_une_active
  ON referentiel_versions (est_active) WHERE est_active;

CREATE TABLE criteres (
  id          serial PRIMARY KEY,
  version_id  integer NOT NULL REFERENCES referentiel_versions(id) ON DELETE CASCADE,
  numero      smallint NOT NULL CHECK (numero BETWEEN 1 AND 7),
  libelle     text NOT NULL,
  UNIQUE (version_id, numero)
);

CREATE TABLE indicateurs (
  id                        serial PRIMARY KEY,
  version_id                integer NOT NULL REFERENCES referentiel_versions(id) ON DELETE CASCADE,
  critere_id                integer NOT NULL REFERENCES criteres(id) ON DELETE CASCADE,
  numero                    smallint NOT NULL CHECK (numero BETWEEN 1 AND 32),
  libelle                   text NOT NULL,
  -- Champs du guide de lecture, remplis à l'import du texte officiel.
  niveau_attendu            text,
  elements_preuve           text,
  obligations_specifiques   text,
  precisions_guide          text,
  -- Portée : vide = toutes catégories d'actions ; sinon parmi
  -- 'certification', 'apprentissage', 'alternance', 'bilan', 'vae'…
  champ_application         text[] NOT NULL DEFAULT '{}',
  applicable_nouvel_entrant boolean,
  nc_mineure_possible       boolean,
  -- false tant que le libellé n'a pas été confronté au guide de lecture
  -- officiel. Le seed ne réécrit JAMAIS une ligne passée à true.
  texte_source_verifie      boolean NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, numero)
);
CREATE INDEX indicateurs_critere ON indicateurs (critere_id);

-- ── Utilisateurs & accès Google ──────────────────────────────

CREATE TABLE utilisateurs (
  id                 serial PRIMARY KEY,
  email              text NOT NULL,
  nom                text,
  role               text NOT NULL DEFAULT 'contributeur'
                       CHECK (role IN ('admin', 'contributeur')),
  actif              boolean NOT NULL DEFAULT true,
  google_sub         text UNIQUE,
  derniere_connexion timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX utilisateurs_email ON utilisateurs (lower(email));

-- Jetons Drive du compte de l'organisme. Une ligne par compte Google
-- connecté (en pratique : un seul, DRIVE_ACCOUNT_EMAIL).
CREATE TABLE drive_connexions (
  email          text PRIMARY KEY,
  refresh_token  text NOT NULL,
  access_token   text,
  expiry         timestamptz,
  scopes         text NOT NULL DEFAULT '',
  connecte_par   integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ── Offre de formation ───────────────────────────────────────

CREATE TABLE formations (
  id                      serial PRIMARY KEY,
  intitule                text NOT NULL,
  code_interne            text UNIQUE,
  objectifs               text,
  prerequis               text,
  public_vise             text,
  duree_heures            numeric(7,2) CHECK (duree_heures >= 0),
  modalite                text CHECK (modalite IN ('presentiel', 'distanciel', 'mixte')),
  certifiante             boolean NOT NULL DEFAULT false,
  code_rncp_rs            text,
  tarif_ht                numeric(10,2) CHECK (tarif_ht >= 0),
  accessibilite_handicap  text,
  drive_folder_id         text,
  actif                   boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id            serial PRIMARY KEY,
  formation_id  integer NOT NULL REFERENCES formations(id) ON DELETE RESTRICT,
  reference     text UNIQUE,
  date_debut    date NOT NULL,
  date_fin      date NOT NULL,
  lieu          text,
  modalite      text CHECK (modalite IN ('presentiel', 'distanciel', 'mixte')),
  formateur     text,
  statut        text NOT NULL DEFAULT 'planifiee'
                  CHECK (statut IN ('planifiee', 'en_cours', 'terminee', 'annulee')),
  drive_folder_id text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (date_fin >= date_debut)
);
CREATE INDEX sessions_formation ON sessions (formation_id);

CREATE TABLE groupes (
  id          serial PRIMARY KEY,
  session_id  integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  nom         text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, nom)
);

CREATE TABLE stagiaires (
  id                  serial PRIMARY KEY,
  nom                 text NOT NULL,
  prenom              text NOT NULL,
  email               text,
  telephone           text,
  entreprise          text,
  financeur           text,
  situation_handicap  boolean NOT NULL DEFAULT false,
  besoins_adaptation  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Lien stagiaire ↔ session (un stagiaire peut suivre plusieurs sessions).
-- C'est l'inscription, pas le stagiaire, qui porte absences, QCM et
-- abandon : indispensable pour les indicateurs 11 et 12.
CREATE TABLE inscriptions (
  id                serial PRIMARY KEY,
  stagiaire_id      integer NOT NULL REFERENCES stagiaires(id) ON DELETE CASCADE,
  session_id        integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  groupe_id         integer REFERENCES groupes(id) ON DELETE SET NULL,
  statut            text NOT NULL DEFAULT 'inscrit'
                      CHECK (statut IN ('inscrit', 'en_cours', 'termine', 'abandon')),
  date_inscription  date NOT NULL DEFAULT current_date,
  date_abandon      date,
  motif_abandon     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stagiaire_id, session_id)
);
CREATE INDEX inscriptions_session ON inscriptions (session_id);

CREATE TABLE absences (
  id              serial PRIMARY KEY,
  inscription_id  integer NOT NULL REFERENCES inscriptions(id) ON DELETE CASCADE,
  date_absence    date NOT NULL,
  demi_journee    text CHECK (demi_journee IN ('matin', 'apres_midi', 'journee')),
  duree_heures    numeric(5,2) CHECK (duree_heures >= 0),
  justifiee       boolean NOT NULL DEFAULT false,
  motif           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX absences_inscription ON absences (inscription_id);

CREATE TABLE resultats_qcm (
  id              serial PRIMARY KEY,
  inscription_id  integer NOT NULL REFERENCES inscriptions(id) ON DELETE CASCADE,
  type            text NOT NULL
                    CHECK (type IN ('positionnement', 'intermediaire', 'evaluation_finale')),
  intitule        text,
  date_passage    date NOT NULL,
  score           numeric(6,2) NOT NULL CHECK (score >= 0),
  score_max       numeric(6,2) NOT NULL CHECK (score_max > 0),
  seuil_reussite  numeric(6,2),
  drive_file_id   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (score <= score_max)
);
CREATE INDEX resultats_qcm_inscription ON resultats_qcm (inscription_id);

CREATE TABLE satisfactions (
  id              serial PRIMARY KEY,
  session_id      integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  inscription_id  integer REFERENCES inscriptions(id) ON DELETE SET NULL,
  type            text NOT NULL
                    CHECK (type IN ('a_chaud', 'a_froid', 'financeur', 'entreprise', 'formateur')),
  date_recueil    date NOT NULL,
  note_globale    numeric(4,2) CHECK (note_globale >= 0),
  note_max        numeric(4,2) NOT NULL DEFAULT 5 CHECK (note_max > 0),
  commentaires    text,
  reponses        jsonb NOT NULL DEFAULT '{}'::jsonb,
  drive_file_id   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX satisfactions_session ON satisfactions (session_id);

-- ── Veille ───────────────────────────────────────────────────

CREATE TABLE veille (
  id                     serial PRIMARY KEY,
  type                   text NOT NULL
                           CHECK (type IN ('legale_reglementaire', 'metiers_competences',
                                           'innovations_pedagogiques', 'handicap', 'autre')),
  titre                  text NOT NULL,
  source                 text,
  url                    text,
  date_publication       date,
  date_effet             date,
  resume                 text,
  analyse_impact         text,
  rupture_reglementaire  boolean NOT NULL DEFAULT false,
  statut                 text NOT NULL DEFAULT 'a_analyser'
                           CHECK (statut IN ('a_analyser', 'analysee', 'integree', 'sans_impact')),
  created_by             integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE veille_indicateurs (
  veille_id      integer NOT NULL REFERENCES veille(id) ON DELETE CASCADE,
  indicateur_id  integer NOT NULL REFERENCES indicateurs(id) ON DELETE CASCADE,
  PRIMARY KEY (veille_id, indicateur_id)
);

-- ── Preuves ──────────────────────────────────────────────────
-- type_alerte décide de ce qui rend une preuve caduque :
--   revision_periodique   → à revoir tous les periodicite_mois
--   echeance_fixe         → expire à date_echeance
--   rupture_reglementaire → invalidée par une entrée de veille (veille_id)

CREATE TABLE preuves (
  id                      serial PRIMARY KEY,
  indicateur_id           integer NOT NULL REFERENCES indicateurs(id) ON DELETE RESTRICT,
  formation_id            integer REFERENCES formations(id) ON DELETE SET NULL,
  session_id              integer REFERENCES sessions(id) ON DELETE SET NULL,
  titre                   text NOT NULL,
  description             text,
  drive_file_id           text,
  drive_url               text,
  type_alerte             text NOT NULL
                            CHECK (type_alerte IN ('revision_periodique', 'echeance_fixe', 'rupture_reglementaire')),
  periodicite_mois        smallint CHECK (periodicite_mois > 0),
  date_echeance           date,
  date_derniere_revision  date,
  veille_id               integer REFERENCES veille(id) ON DELETE SET NULL,
  statut                  text NOT NULL DEFAULT 'valide'
                            CHECK (statut IN ('valide', 'a_reviser', 'expiree', 'obsolete')),
  created_by              integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (type_alerte <> 'revision_periodique' OR periodicite_mois IS NOT NULL),
  CHECK (type_alerte <> 'echeance_fixe' OR date_echeance IS NOT NULL)
);
CREATE INDEX preuves_indicateur ON preuves (indicateur_id);

-- ── Historique des audits ────────────────────────────────────

CREATE TABLE audits_history (
  id                      serial PRIMARY KEY,
  type                    text NOT NULL
                            CHECK (type IN ('initial', 'surveillance', 'renouvellement', 'blanc', 'interne')),
  date_audit              date NOT NULL,
  organisme_certificateur text,
  auditeur                text,
  referentiel_version_id  integer REFERENCES referentiel_versions(id) ON DELETE SET NULL,
  resultat                text CHECK (resultat IN ('en_attente', 'certifie', 'maintenu', 'non_certifie', 'suspendu')),
  nb_nc_mineures          smallint NOT NULL DEFAULT 0 CHECK (nb_nc_mineures >= 0),
  nb_nc_majeures          smallint NOT NULL DEFAULT 0 CHECK (nb_nc_majeures >= 0),
  non_conformites         jsonb NOT NULL DEFAULT '[]'::jsonb,
  rapport_drive_file_id   text,
  commentaires            text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ── updated_at automatique ───────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'referentiel_versions', 'indicateurs', 'utilisateurs', 'drive_connexions',
    'formations', 'sessions', 'groupes', 'stagiaires', 'inscriptions', 'absences',
    'resultats_qcm', 'satisfactions', 'veille', 'preuves', 'audits_history'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_updated_at', t
    );
  END LOOP;
END $$;
