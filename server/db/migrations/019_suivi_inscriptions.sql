-- ─────────────────────────────────────────────────────────────
--  Q2-3 — Abandon enrichi et suivi factuel du décrochage.
--
--  Additif uniquement.
--  1. `inscriptions.categorie_abandon` : catégorie FACULTATIVE (NULL pour
--     tous les abandons historiques, aucune reprise rétroactive). Le motif
--     libre reste `motif_abandon` (colonne existante).
--  2. `suivis_inscription` : événements FACTUELS (signal observé, relance
--     effectuée) avant un éventuel abandon. Jamais le contenu intégral d'un
--     échange, jamais de jugement personnel ou médical. Aucune prédiction,
--     aucune notification, aucun signalement Qualité automatique.
--     Pas de suppression physique.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE inscriptions
  ADD COLUMN categorie_abandon text
    CHECK (categorie_abandon IS NULL OR categorie_abandon IN
      ('personnel', 'professionnel', 'financement', 'reorientation', 'sans_nouvelles', 'autre'));

CREATE TABLE suivis_inscription (
  id               serial PRIMARY KEY,
  inscription_id   integer NOT NULL REFERENCES inscriptions(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type IN ('signal', 'relance')),
  date_evenement   date NOT NULL,
  categorie        text NOT NULL,
  canal            text CHECK (canal IS NULL OR canal IN ('email', 'telephone', 'presentiel', 'autre')),
  note             text CHECK (char_length(note) <= 300),
  cree_par         integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  mis_a_jour_par   integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le    timestamptz NOT NULL DEFAULT now(),
  -- Catégories fermées PAR TYPE ; canal obligatoire pour une relance seulement.
  CHECK (
    (type = 'signal' AND canal IS NULL AND categorie IN
      ('absences_repetees', 'retards_repetes', 'difficulte_pedagogique', 'sans_nouvelles', 'autre'))
    OR
    (type = 'relance' AND canal IS NOT NULL AND categorie IN
      ('sans_reponse', 'echange_realise', 'entretien_realise', 'autre'))
  )
);
CREATE INDEX suivis_inscription_inscription ON suivis_inscription (inscription_id, date_evenement DESC, id DESC);
