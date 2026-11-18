-- ─────────────────────────────────────────────────────────────
--  046 — Vigie 2.0, socle :
--   1. mentions légales de l'organisme (SIRET, numéro de déclaration d'activité, site web) et référent handicap,
--      repris par les variables {{organisme_siret}}, {{organisme_nda}}, {{organisme_site_web}}, {{referent_handicap_*}} ;
--   2. comptes gérés dans l'application : rôle « auditeur » (lecture seule du dossier d'audit, accès limité dans le
--      temps), date d'expiration, auteur de la création ;
--   3. journal des opérations sensibles (comptes, exports, anonymisations, données restreintes).
--  Additive : aucune donnée existante modifiée.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE parametres_organisme
  ADD COLUMN siret                       text CHECK (char_length(siret) <= 20),
  ADD COLUMN nda                         text CHECK (char_length(nda) <= 30),
  ADD COLUMN site_web                    text CHECK (char_length(site_web) <= 200),
  ADD COLUMN referent_handicap_nom       text CHECK (char_length(referent_handicap_nom) <= 150),
  ADD COLUMN referent_handicap_email     text CHECK (char_length(referent_handicap_email) <= 200),
  ADD COLUMN referent_handicap_telephone text CHECK (char_length(referent_handicap_telephone) <= 30),
  ADD COLUMN duree_conservation_annees   integer CHECK (duree_conservation_annees BETWEEN 1 AND 50);

ALTER TABLE utilisateurs DROP CONSTRAINT IF EXISTS utilisateurs_role_check;
ALTER TABLE utilisateurs
  ADD CONSTRAINT utilisateurs_role_check CHECK (role IN ('admin', 'contributeur', 'auditeur')),
  ADD COLUMN expire_le date,
  ADD COLUMN cree_par  integer REFERENCES utilisateurs(id) ON DELETE SET NULL;

CREATE TABLE journal_securite (
  id         bigserial PRIMARY KEY,
  evenement  text NOT NULL CHECK (char_length(evenement) <= 80),
  detail     text CHECK (char_length(detail) <= 500),
  cible_type text CHECK (char_length(cible_type) <= 40),
  cible_id   integer,
  par        integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journal_securite_date ON journal_securite (cree_le DESC);
