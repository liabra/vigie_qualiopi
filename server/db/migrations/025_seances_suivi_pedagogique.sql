-- ─────────────────────────────────────────────────────────────
--  DOC-7B — Séances et suivi pédagogique individuel (Livret).
--
--  Additif uniquement : aucune table existante modifiée (ni absences,
--  ni inscriptions, ni stagiaires).
--
--  1. `seances` : moment pédagogique réel d'une session (ou d'un groupe).
--     La phase reste une CONFIGURATION STATIQUE (aucune table `phases`) :
--     `phase_numero` est un entier positif facultatif, SANS borne à 6.
--     Une séance peut être commune à la session (groupe_id NULL) ou propre
--     à un groupe.
--  2. `suivi_seance` : suivi INDIVIDUEL facultatif d'un stagiaire sur une
--     séance. Une séance sans ligne ici reste affichable au Livret
--     (équivalent d'un LEFT JOIN) : les champs sont alors vides.
--
--  Les données handicap / besoins spécifiques restent EXCLUSIVEMENT dans
--  `stagiaires.situation_handicap` / `besoins_adaptation` et
--  `adaptations_parcours` : jamais fusionnées avec les difficultés
--  pédagogiques ordinaires portées ici.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE seances (
  id           serial PRIMARY KEY,
  session_id   integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  groupe_id    integer REFERENCES groupes(id) ON DELETE CASCADE,
  phase_numero integer CHECK (phase_numero IS NULL OR phase_numero > 0),
  date_seance  date NOT NULL,
  heure_debut  time,
  heure_fin    time,
  theme        text CHECK (char_length(btrim(theme)) <= 500),
  competences  text[] NOT NULL DEFAULT '{}',
  activites    text CHECK (char_length(btrim(activites)) <= 2000),
  lieu         text CHECK (char_length(btrim(lieu)) <= 200),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Heure de fin strictement postérieure à l'heure de début, quand les deux
  -- sont renseignées (jamais un créneau nul ou inversé).
  CHECK (heure_debut IS NULL OR heure_fin IS NULL OR heure_fin > heure_debut)
);
-- Lectures par session et par groupe, dans l'ordre de rendu demandé :
-- date_seance, puis heure_debut, puis id.
CREATE INDEX seances_session_date ON seances (session_id, date_seance, heure_debut, id);
CREATE INDEX seances_groupe_date ON seances (groupe_id, date_seance, heure_debut, id);
CREATE TRIGGER seances_updated_at BEFORE UPDATE ON seances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE suivi_seance (
  id             serial PRIMARY KEY,
  seance_id      integer NOT NULL REFERENCES seances(id) ON DELETE CASCADE,
  inscription_id integer NOT NULL REFERENCES inscriptions(id) ON DELETE CASCADE,
  accompagnement text CHECK (char_length(btrim(accompagnement)) <= 2000),
  difficultes    text CHECK (char_length(btrim(difficultes)) <= 2000),
  impressions    text CHECK (char_length(btrim(impressions)) <= 2000),
  observations   text CHECK (char_length(btrim(observations)) <= 2000),
  cree_par       integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  mis_a_jour_par integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seance_id, inscription_id)
);
-- Lecture du suivi d'un stagiaire (toutes ses séances) : l'unicité
-- (seance_id, inscription_id) couvre déjà la lecture par séance.
CREATE INDEX suivi_seance_inscription ON suivi_seance (inscription_id);
CREATE TRIGGER suivi_seance_updated_at BEFORE UPDATE ON suivi_seance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
