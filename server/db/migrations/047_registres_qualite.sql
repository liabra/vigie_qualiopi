-- ─────────────────────────────────────────────────────────────
--  047 — Vigie 2.0 : registres de pilotage qualité (CDC §31, §32, §36, §37).
--   - taches_qualite    : tâches et échéancier, récurrence (une tâche récurrente terminée crée la suivante) ;
--   - risques_qualite   : registre des risques, criticité = probabilité × impact ;
--   - partenaires       : partenaires et environnement (conventions, actions menées) ;
--   - ressources        : ressources pédagogiques et moyens techniques (version, état, contrôles).
--  Chaque fiche peut citer des indicateurs (identifiants du référentiel actif). L'historique des changements
--  rejoint historique_qualite. Additive : aucune donnée existante modifiée.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE taches_qualite (
  id              serial PRIMARY KEY,
  titre           text NOT NULL CHECK (char_length(titre) BETWEEN 1 AND 200),
  description     text CHECK (char_length(description) <= 4000),
  responsable_id  integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  echeance        date,
  priorite        text NOT NULL DEFAULT 'normale' CHECK (priorite IN ('basse', 'normale', 'haute')),
  statut          text NOT NULL DEFAULT 'a_faire' CHECK (statut IN ('a_faire', 'en_cours', 'faite', 'annulee')),
  recurrence      text NOT NULL DEFAULT 'aucune' CHECK (recurrence IN ('aucune', 'mensuelle', 'trimestrielle', 'semestrielle', 'annuelle')),
  origine         text NOT NULL DEFAULT 'manuelle' CHECK (origine IN ('manuelle', 'preuve_manquante', 'preuve_a_actualiser', 'audit', 'risque', 'enquete')),
  indicateur_ids  integer[] NOT NULL DEFAULT '{}',
  preuve_id       integer REFERENCES preuves(id) ON DELETE SET NULL,
  precedente_id   integer REFERENCES taches_qualite(id) ON DELETE SET NULL,
  faite_le        date,
  cree_par        integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le         timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX taches_qualite_echeance ON taches_qualite (statut, echeance);

CREATE TABLE risques_qualite (
  id                 serial PRIMARY KEY,
  titre              text NOT NULL CHECK (char_length(titre) BETWEEN 1 AND 200),
  description        text CHECK (char_length(description) <= 4000),
  domaine            text NOT NULL DEFAULT 'organisation' CHECK (domaine IN ('pedagogie', 'organisation', 'materiel', 'accessibilite', 'partenaires', 'donnees', 'reglementaire', 'humain', 'autre')),
  origine            text CHECK (char_length(origine) <= 300),
  probabilite        smallint NOT NULL DEFAULT 2 CHECK (probabilite BETWEEN 1 AND 4),
  impact             smallint NOT NULL DEFAULT 2 CHECK (impact BETWEEN 1 AND 4),
  criticite          smallint GENERATED ALWAYS AS (probabilite * impact) STORED,
  mesures            text CHECK (char_length(mesures) <= 4000),
  responsable_id     integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  date_reevaluation  date,
  statut             text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'maitrise', 'clos')),
  indicateur_ids     integer[] NOT NULL DEFAULT '{}',
  action_id          integer REFERENCES actions_qualite(id) ON DELETE SET NULL,
  cree_par           integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le            timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE partenaires (
  id                serial PRIMARY KEY,
  nom               text NOT NULL CHECK (char_length(nom) BETWEEN 1 AND 200),
  type              text NOT NULL DEFAULT 'autre' CHECK (type IN ('prescripteur', 'financeur', 'entreprise', 'institution', 'association', 'organisme_formation', 'reseau', 'autre')),
  domaine           text CHECK (char_length(domaine) <= 200),
  contact_nom       text CHECK (char_length(contact_nom) <= 150),
  email             text CHECK (char_length(email) <= 200),
  telephone         text CHECK (char_length(telephone) <= 30),
  adresse           text CHECK (char_length(adresse) <= 300),
  convention_debut  date,
  convention_fin    date,
  referent_id       integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  statut            text NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'inactif')),
  actions_menees    text CHECK (char_length(actions_menees) <= 8000),
  indicateur_ids    integer[] NOT NULL DEFAULT '{}',
  cree_par          integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le           timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ressources (
  id                  serial PRIMARY KEY,
  titre               text NOT NULL CHECK (char_length(titre) BETWEEN 1 AND 200),
  categorie           text NOT NULL DEFAULT 'support' CHECK (categorie IN ('support', 'programme', 'deroule', 'exercice', 'evaluation', 'numerique', 'salle', 'equipement', 'materiel', 'logiciel')),
  version             text CHECK (char_length(version) <= 30),
  date_actualisation  date,
  responsable_id      integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  lien                text CHECK (char_length(lien) <= 500),
  localisation        text CHECK (char_length(localisation) <= 200),
  etat                text NOT NULL DEFAULT 'non_concerne' CHECK (etat IN ('bon', 'a_surveiller', 'hors_service', 'non_concerne')),
  date_controle       date,
  statut              text NOT NULL DEFAULT 'en_service' CHECK (statut IN ('en_service', 'a_actualiser', 'retire')),
  notes               text CHECK (char_length(notes) <= 4000),
  formation_id        integer REFERENCES formations(id) ON DELETE SET NULL,
  indicateur_ids      integer[] NOT NULL DEFAULT '{}',
  cree_par            integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le             timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE historique_qualite DROP CONSTRAINT IF EXISTS historique_qualite_entite_type_check;
ALTER TABLE historique_qualite ADD CONSTRAINT historique_qualite_entite_type_check
  CHECK (entite_type IN ('signalement', 'action', 'tache', 'risque', 'partenaire', 'ressource', 'campagne_audit'));
