-- ─────────────────────────────────────────────────────────────
--  054 — Séquence pédagogique : modules (C1…) et compétences/ateliers (AT01…) d'une VERSION de formation.
--  Source unique du programme, de la séquence pédagogique, du suivi des résultats et des bilans intermédiaires.
--  La compétence d'un stagiaire (competences_stagiaires.competence) reste le libellé « code + intitulé » :
--  aucune donnée existante n'est modifiée. Additive.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE formation_modules (
  id                      serial PRIMARY KEY,
  formation_version_id    integer NOT NULL REFERENCES formation_versions(id) ON DELETE CASCADE,
  ordre                   integer NOT NULL CHECK (ordre BETWEEN 1 AND 50),
  code                    text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 20),
  intitule                text NOT NULL CHECK (char_length(intitule) BETWEEN 1 AND 300),
  duree_minutes           integer CHECK (duree_minutes BETWEEN 0 AND 100000),
  evaluation_minutes      integer CHECK (evaluation_minutes BETWEEN 0 AND 100000),
  evaluation_objectif     text CHECK (char_length(evaluation_objectif) <= 2000),
  UNIQUE (formation_version_id, ordre),
  UNIQUE (formation_version_id, code)
);

CREATE TABLE formation_competences (
  id               serial PRIMARY KEY,
  module_id        integer NOT NULL REFERENCES formation_modules(id) ON DELETE CASCADE,
  ordre            integer NOT NULL CHECK (ordre BETWEEN 1 AND 200),
  code             text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 20),
  libelle          text NOT NULL CHECK (char_length(libelle) BETWEEN 1 AND 280),
  titre            text CHECK (char_length(titre) <= 280),
  duree_minutes    integer CHECK (duree_minutes BETWEEN 0 AND 100000),
  objectif         text CHECK (char_length(objectif) <= 2000),
  support          text CHECK (char_length(support) <= 1000),
  modalite         text CHECK (char_length(modalite) <= 500),
  activites        text CHECK (char_length(activites) <= 4000),
  ressources       text CHECK (char_length(ressources) <= 2000),
  indicateur       text CHECK (char_length(indicateur) <= 2000),
  UNIQUE (module_id, ordre),
  UNIQUE (module_id, code)
);
CREATE INDEX formation_competences_module ON formation_competences (module_id);
