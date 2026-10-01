-- ─────────────────────────────────────────────────────────────
--  Q1-B4 — Liaison métier PREUVE ↔ SIGNALEMENT / ACTION QUALITÉ.
--
--  Additif uniquement : aucune colonne existante modifiée (en particulier
--  `preuves.indicateur_id` reste NOT NULL), aucune donnée réécrite.
--  Les fichiers restent sur Google Drive : seule la RELATION est stockée.
--  Retirer un lien ne supprime jamais la preuve ni un fichier Drive.
--
--  Une seule table, de VRAIES clés étrangères (jamais entite_type +
--  entite_id non vérifiable) : exactement UNE cible par lien.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE liens_preuves_qualite (
  id                      serial PRIMARY KEY,
  -- Supprimer une preuve (DELETE /api/preuves/:id) nettoie ses liens.
  preuve_id               integer NOT NULL REFERENCES preuves(id) ON DELETE CASCADE,
  action_qualite_id       integer REFERENCES actions_qualite(id) ON DELETE CASCADE,
  signalement_qualite_id  integer REFERENCES signalements_qualite(id) ON DELETE CASCADE,
  cree_par                integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le                 timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(action_qualite_id, signalement_qualite_id) = 1)
);

-- Aucun doublon : une preuve n'est liée qu'une fois à une même cible.
CREATE UNIQUE INDEX liens_preuves_action_unique
  ON liens_preuves_qualite (preuve_id, action_qualite_id) WHERE action_qualite_id IS NOT NULL;
CREATE UNIQUE INDEX liens_preuves_signalement_unique
  ON liens_preuves_qualite (preuve_id, signalement_qualite_id) WHERE signalement_qualite_id IS NOT NULL;
CREATE INDEX liens_preuves_action ON liens_preuves_qualite (action_qualite_id);
CREATE INDEX liens_preuves_signalement ON liens_preuves_qualite (signalement_qualite_id);
