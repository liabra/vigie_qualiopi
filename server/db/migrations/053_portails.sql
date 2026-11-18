-- ─────────────────────────────────────────────────────────────
--  053 — Portails stagiaire et formateur (CDC §40) : accès personnel par lien à jeton, sans compte Google.
--  Seule l'empreinte SHA-256 du jeton est conservée ; l'accès expire et peut être révoqué à tout moment.
--  Additive.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE acces_portail (
  id                   serial PRIMARY KEY,
  type                 text NOT NULL CHECK (type IN ('stagiaire', 'formateur')),
  stagiaire_id         integer REFERENCES stagiaires(id) ON DELETE CASCADE,
  intervenant_id       integer REFERENCES intervenants(id) ON DELETE CASCADE,
  jeton_hash           text NOT NULL UNIQUE CHECK (char_length(jeton_hash) = 64),
  expire_le            date NOT NULL,
  cree_par             integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le              timestamptz NOT NULL DEFAULT now(),
  derniere_utilisation timestamptz,
  revoque_le           timestamptz,
  CHECK ((type = 'stagiaire' AND stagiaire_id IS NOT NULL AND intervenant_id IS NULL)
      OR (type = 'formateur' AND intervenant_id IS NOT NULL AND stagiaire_id IS NULL))
);
CREATE INDEX acces_portail_stagiaire ON acces_portail (stagiaire_id);
CREATE INDEX acces_portail_intervenant ON acces_portail (intervenant_id);
