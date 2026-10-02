-- ─────────────────────────────────────────────────────────────
--  Q4-2 — Justificatifs professionnels des intervenants.
--
--  Additif. Aucun nouveau stockage de fichiers : un justificatif est une
--  PREUVE existante (fichiers Google Drive, dates de validité et alertes
--  déjà gérées par preuves_enrichies), RATTACHÉE à un intervenant.
--  preuves.indicateur_id reste NOT NULL (inchangé).
--
--  Confidentialité : toute preuve rattachée à un intervenant est inscrite
--  dans preuves_confidentielles — DÉFINITIVEMENT (retirer le rattachement
--  ne la rend pas de nouveau visible). Le serveur exclut ces preuves de
--  toutes les réponses destinées au contributeur.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE preuves_confidentielles (
  preuve_id  integer PRIMARY KEY REFERENCES preuves(id) ON DELETE CASCADE,
  par        integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  depuis     timestamptz NOT NULL DEFAULT now()
);

-- Pièces ATTENDUES (choisies par l'admin) : une pièce n'est « manquante »
-- que si elle figure ici. Tout est facultatif par défaut.
CREATE TABLE intervenants_justificatifs_attendus (
  intervenant_id integer NOT NULL REFERENCES intervenants(id) ON DELETE CASCADE,
  categorie      text NOT NULL CHECK (categorie IN ('cv', 'diplome', 'attestation', 'certification', 'contrat', 'autre')),
  cree_par       integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (intervenant_id, categorie)
);

-- Rattachement intervenant ↔ preuve. Retirer un rattachement ne supprime
-- ni la preuve ni ses fichiers Drive. Supprimer la preuve (action admin
-- existante) retire le rattachement.
CREATE TABLE intervenants_justificatifs (
  id             serial PRIMARY KEY,
  intervenant_id integer NOT NULL REFERENCES intervenants(id) ON DELETE RESTRICT,
  preuve_id      integer NOT NULL REFERENCES preuves(id) ON DELETE CASCADE,
  categorie      text NOT NULL CHECK (categorie IN ('cv', 'diplome', 'attestation', 'certification', 'contrat', 'autre')),
  -- Date du document (ex. date du contrat), facultative. L'échéance et le
  -- renouvellement restent ceux de la preuve (type_alerte / date_echeance).
  date_document  date,
  cree_par       integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intervenant_id, preuve_id)
);
CREATE INDEX intervenants_justificatifs_preuve ON intervenants_justificatifs (preuve_id);
