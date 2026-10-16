-- ─────────────────────────────────────────────────────────────
--  DOC-9D2 lot B — Questionnaire de positionnement (rubrique 8, 6 phases).
--
--  Additif uniquement : aucune table existante modifiée, les entretiens et
--  réponses déjà enregistrés (rubriques 3-7, 9-11, 13) restent inchangés.
--
--  34 compétences ne tiennent pas dans les 14 clés génériques de
--  `entretien_reponses` (chaque compétence a SON code fermé, SON niveau à
--  trois valeurs, distinct d'une priorité ou d'une observation par phase) :
--  deux tables dédiées, plutôt que de forcer cette structure dans l'ancien
--  socle.
--
--  1. `entretien_positionnement_evaluations` : une ligne par compétence
--     évaluée (34 au plus par entretien). `competence_code` est validé
--     applicativement contre le référentiel fermé
--     (positionnementEntretien.js) — jamais une compétence inventée.
--  2. `entretien_positionnement_phases` : priorité et observations, UNE
--     ligne au plus par phase (1 à 6) et par entretien.
--
--  Aucun score, moyenne, seuil ni résultat global : ces colonnes n'existent
--  pas, conformément au modèle réel (aucune formule à inventer).
-- ─────────────────────────────────────────────────────────────

CREATE TABLE entretien_positionnement_evaluations (
  id               serial PRIMARY KEY,
  entretien_id     integer NOT NULL REFERENCES entretiens(id) ON DELETE CASCADE,
  phase            smallint NOT NULL CHECK (phase BETWEEN 1 AND 6),
  competence_code  text NOT NULL CHECK (char_length(btrim(competence_code)) BETWEEN 1 AND 20),
  niveau           text NOT NULL CHECK (niveau IN ('autonome', 'avec_aide', 'a_developper')),
  UNIQUE (entretien_id, competence_code)
);
CREATE INDEX entretien_positionnement_evaluations_entretien ON entretien_positionnement_evaluations (entretien_id);

CREATE TABLE entretien_positionnement_phases (
  id             serial PRIMARY KEY,
  entretien_id   integer NOT NULL REFERENCES entretiens(id) ON DELETE CASCADE,
  phase          smallint NOT NULL CHECK (phase BETWEEN 1 AND 6),
  priorite       text CHECK (priorite IN ('forte', 'moyenne', 'faible')),
  observations   text CHECK (char_length(observations) <= 4000),
  UNIQUE (entretien_id, phase)
);
CREATE INDEX entretien_positionnement_phases_entretien ON entretien_positionnement_phases (entretien_id);
