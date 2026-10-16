-- ─────────────────────────────────────────────────────────────
--  DOC-9D3 lot B — Compléter la saisie de l'entretien initial FSE-IA avec
--  ce que l'audit (`modeles-local/entree/
--  FSE-IA_Audit_questions_hors_positionnement.md`) a identifié comme
--  absent ou partiellement couvert par les 14 clés génériques existantes :
--  cases à cocher fermées et tableaux répétables.
--
--  Additif uniquement : `entretiens`/`entretien_reponses` ne changent pas
--  (les réponses déjà enregistrées restent valides), les nouvelles clés de
--  texte/sélection/échelle réutilisent `entretien_reponses` SANS migration
--  (validation applicative étendue dans `entretiens.js`).
--
--  1. `entretien_choix` : une ligne par OPTION COCHÉE d'un groupe de cases
--     fermé (ex. « objectifs_souhaites », « loisirs »...). `groupe` et
--     `code` sont validés contre un référentiel fermé
--     (entretienChoix.js) — jamais une option inventée.
--  2. `entretien_experiences` et `entretien_plan_action` : tableaux
--     répétables (rubriques 4 et 10), une ligne par entrée, ordre explicite
--     pour un affichage stable.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE entretien_choix (
  id            serial PRIMARY KEY,
  entretien_id  integer NOT NULL REFERENCES entretiens(id) ON DELETE CASCADE,
  groupe        text NOT NULL CHECK (char_length(btrim(groupe)) BETWEEN 1 AND 40),
  code          text NOT NULL CHECK (char_length(btrim(code)) BETWEEN 1 AND 40),
  UNIQUE (entretien_id, groupe, code)
);
CREATE INDEX entretien_choix_entretien ON entretien_choix (entretien_id);

CREATE TABLE entretien_experiences (
  id            serial PRIMARY KEY,
  entretien_id  integer NOT NULL REFERENCES entretiens(id) ON DELETE CASCADE,
  ordre         smallint NOT NULL CHECK (ordre BETWEEN 1 AND 20),
  structure     text CHECK (char_length(structure) <= 500),
  duree         text CHECK (char_length(duree) <= 100),
  missions      text CHECK (char_length(missions) <= 2000),
  retenue       text CHECK (char_length(retenue) <= 2000),
  UNIQUE (entretien_id, ordre)
);
CREATE INDEX entretien_experiences_entretien ON entretien_experiences (entretien_id);

CREATE TABLE entretien_plan_action (
  id            serial PRIMARY KEY,
  entretien_id  integer NOT NULL REFERENCES entretiens(id) ON DELETE CASCADE,
  ordre         smallint NOT NULL CHECK (ordre BETWEEN 1 AND 20),
  objectif      text CHECK (char_length(objectif) <= 500),
  phase         smallint CHECK (phase BETWEEN 1 AND 6),
  action        text CHECK (char_length(action) <= 1000),
  echeance      text CHECK (char_length(echeance) <= 100),
  etat          text CHECK (etat IN ('a_faire', 'en_cours', 'realise')),
  UNIQUE (entretien_id, ordre)
);
CREATE INDEX entretien_plan_action_entretien ON entretien_plan_action (entretien_id);
