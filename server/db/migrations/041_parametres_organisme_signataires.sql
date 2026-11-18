-- Paramètres de l'organisme et signataires configurables.
--
-- Les coordonnées de l'organisme et les signataires ne sont plus écrits en dur dans les modèles
-- de documents : ils se règlent dans Vigie (écran administrateur) et alimentent les variables
-- {{organisme_*}} et {{signataire_nom}} / {{signataire_fonction}}.
--
-- Additive : aucune donnée existante modifiée. Les modèles existants gardent le mode « aucun »
-- (aucun signataire) tant qu'un administrateur n'en choisit pas un. Les valeurs réelles
-- (coordonnées, noms) se saisissent dans l'application, jamais dans une migration.

-- Une seule ligne (id = 1), créée vide : « non renseigné » est un état normal.
CREATE TABLE parametres_organisme (
  id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nom             text,
  adresse_ligne1  text,
  adresse_ligne2  text,
  code_postal     text,
  ville           text,
  telephone       text,
  mobile          text,
  email           text,
  mis_a_jour_le   timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_par  integer REFERENCES utilisateurs(id) ON DELETE SET NULL
);
INSERT INTO parametres_organisme (id) VALUES (1);

-- Signataires : jamais supprimés (les documents déjà générés les ont cités), seulement désactivés.
CREATE TABLE signataires (
  id          serial PRIMARY KEY,
  nom         text NOT NULL CHECK (char_length(btrim(nom)) BETWEEN 1 AND 120),
  fonction    text NOT NULL CHECK (char_length(btrim(fonction)) BETWEEN 1 AND 120),
  actif       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX signataires_nom_fonction_actifs ON signataires (lower(btrim(nom)), lower(btrim(fonction))) WHERE actif;

-- Choix du signataire par modèle :
--   aucun     : le modèle n'utilise pas {{signataire_*}} (comportement actuel de tous les modèles) ;
--   fixe      : un signataire de la table (ex. la présidente) ;
--   formateur : le formateur concerné (intervenant rattaché au groupe, à défaut à la session).
ALTER TABLE modeles_documents
  ADD COLUMN signataire_mode text NOT NULL DEFAULT 'aucun'
    CHECK (signataire_mode IN ('aucun', 'fixe', 'formateur')),
  ADD COLUMN signataire_id integer REFERENCES signataires(id) ON DELETE RESTRICT,
  ADD CONSTRAINT modeles_signataire_coherent CHECK (
    (signataire_mode = 'fixe' AND signataire_id IS NOT NULL)
    OR (signataire_mode <> 'fixe' AND signataire_id IS NULL)
  );
