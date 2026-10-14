-- ─────────────────────────────────────────────────────────────
--  DOC-9C — Socle des entretiens initiaux FSE-IA.
--
--  Additif uniquement : aucune table existante modifiée.
--
--  1. `entretiens` : un entretien par stagiaire, PLUSIEURS possibles par
--     personne. Jamais rattaché à une session (l'entretien précède
--     l'inscription). `version` = verrou optimiste contre les écrasements
--     concurrents. `statut` : brouillon → valide, la validation est
--     EXPLICITE (jamais automatique).
--  2. `entretien_reponses` : réponses structurées, clé bornée, source
--     dérivée (jeune / accompagnateur). Une seule valeur par clé et par
--     entretien.
--
--  Aucune donnée médicale, diagnostic, RQTH ni handicap dans ce socle :
--  les besoins spécifiques restent dans `stagiaires` (réservés admin) et
--  les mesures dans `adaptations_parcours`.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE entretiens (
  id            serial PRIMARY KEY,
  stagiaire_id  integer NOT NULL REFERENCES stagiaires(id) ON DELETE CASCADE,
  statut        text NOT NULL DEFAULT 'brouillon'
                  CHECK (statut IN ('brouillon', 'valide')),
  version       integer NOT NULL DEFAULT 1,
  cree_par      integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  valide_par    integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le       timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le timestamptz NOT NULL DEFAULT now(),
  valide_le     timestamptz
);
-- Lecture par stagiaire, dans l'ordre de création.
CREATE INDEX entretiens_stagiaire ON entretiens (stagiaire_id, id);

CREATE TABLE entretien_reponses (
  id           serial PRIMARY KEY,
  entretien_id integer NOT NULL REFERENCES entretiens(id) ON DELETE CASCADE,
  cle          text NOT NULL CHECK (char_length(btrim(cle)) BETWEEN 1 AND 80),
  valeur       text NOT NULL CHECK (char_length(valeur) <= 4000),
  source       text NOT NULL CHECK (source IN ('jeune', 'accompagnateur')),
  UNIQUE (entretien_id, cle)
);
CREATE INDEX entretien_reponses_entretien ON entretien_reponses (entretien_id);
