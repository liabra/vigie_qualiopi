-- ─────────────────────────────────────────────────────────────
--  045 — Acquisition des compétences par stagiaire (grille « Indicateur de suivi et de résultat » A2C).
--  Une ligne par couple inscription / compétence ; la compétence est le libellé de la liste de la formation
--  ou des séances. Additive : aucune donnée existante modifiée.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE competences_stagiaires (
  id             serial PRIMARY KEY,
  inscription_id integer NOT NULL REFERENCES inscriptions(id) ON DELETE CASCADE,
  competence     text NOT NULL CHECK (char_length(competence) BETWEEN 1 AND 300),
  statut         text NOT NULL CHECK (statut IN ('acquis', 'en_cours', 'non_acquis')),
  renseigne_par  integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  mis_a_jour_le  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inscription_id, competence)
);
CREATE INDEX competences_stagiaires_inscription ON competences_stagiaires (inscription_id);
