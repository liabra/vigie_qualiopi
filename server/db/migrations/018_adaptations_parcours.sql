-- ─────────────────────────────────────────────────────────────
--  Q2-2 — Adaptations pédagogiques du parcours (mesures opérationnelles).
--
--  Additif uniquement. Plusieurs mesures par inscription. Seulement ce qui
--  est MIS EN PLACE pour faciliter la formation : jamais de diagnostic ni
--  de justification médicale (aucune colonne prévue pour cela).
--  Aucune reprise automatique de `stagiaires.besoins_adaptation` : ce texte
--  historique, potentiellement sensible, relève d'une reprise humaine.
--  Pas de suppression physique : une mesure abandonnée reste tracée.
--  « abandonnee » = mesure abandonnée, PAS abandon de la formation.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE adaptations_parcours (
  id                   serial PRIMARY KEY,
  inscription_id       integer NOT NULL REFERENCES inscriptions(id) ON DELETE CASCADE,
  categorie            text NOT NULL
                         CHECK (categorie IN ('rythme', 'supports', 'accessibilite_locaux', 'materiel',
                                              'modalites_evaluation', 'accompagnement', 'autre')),
  mesure               text NOT NULL CHECK (char_length(btrim(mesure)) BETWEEN 1 AND 500),
  statut               text NOT NULL DEFAULT 'prevue'
                         CHECK (statut IN ('prevue', 'mise_en_oeuvre', 'abandonnee')),
  date_decision        date NOT NULL,
  date_mise_en_oeuvre  date,
  bilan                text CHECK (char_length(bilan) <= 500),
  cree_par             integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  mis_a_jour_par       integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le              timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le        timestamptz NOT NULL DEFAULT now(),
  CHECK (statut <> 'mise_en_oeuvre' OR date_mise_en_oeuvre IS NOT NULL)
);
CREATE INDEX adaptations_parcours_inscription ON adaptations_parcours (inscription_id);
