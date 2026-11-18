-- ─────────────────────────────────────────────────────────────
--  044 — Données demandées par les documents A2C (fiche d'inscription, fiche des besoins,
--  compte rendu prescripteur) : coordonnées complémentaires du stagiaire, entreprise,
--  domaines de handicap (donnée de santé, réservée à l'administrateur), contact du prescripteur,
--  niveau issu du positionnement. Additive : aucune donnée existante modifiée.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE stagiaires
  ADD COLUMN date_naissance       date,
  ADD COLUMN adresse              text CHECK (char_length(adresse) <= 300),
  ADD COLUMN code_postal          text CHECK (char_length(code_postal) <= 10),
  ADD COLUMN ville                text CHECK (char_length(ville) <= 100),
  ADD COLUMN profession           text CHECK (char_length(profession) <= 150),
  ADD COLUMN entreprise_adresse   text CHECK (char_length(entreprise_adresse) <= 300),
  ADD COLUMN entreprise_siret     text CHECK (char_length(entreprise_siret) <= 20),
  ADD COLUMN entreprise_ape       text CHECK (char_length(entreprise_ape) <= 10),
  ADD COLUMN entreprise_effectifs text CHECK (char_length(entreprise_effectifs) <= 30),
  ADD COLUMN entreprise_responsable text CHECK (char_length(entreprise_responsable) <= 150),
  ADD COLUMN entreprise_opca      text CHECK (char_length(entreprise_opca) <= 150),
  ADD COLUMN domaines_handicap    text[] NOT NULL DEFAULT '{}'
    CHECK (domaines_handicap <@ ARRAY['moteur','visuel','auditif','psychique','deficience_intellectuelle','maladie_invalidante']::text[]);

ALTER TABLE recueils_besoin
  ADD COLUMN niveau_positionnement text CHECK (niveau_positionnement IN ('debutant', 'intermediaire', 'autonome'));

ALTER TABLE prescripteurs
  ADD COLUMN adresse          text CHECK (char_length(adresse) <= 300),
  ADD COLUMN contact_nom      text CHECK (char_length(contact_nom) <= 150),
  ADD COLUMN contact_fonction text CHECK (char_length(contact_fonction) <= 150),
  ADD COLUMN contact_email    text CHECK (char_length(contact_email) <= 200),
  ADD COLUMN contact_telephone text CHECK (char_length(contact_telephone) <= 30);
