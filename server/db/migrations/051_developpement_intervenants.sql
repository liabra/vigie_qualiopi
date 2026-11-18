-- ─────────────────────────────────────────────────────────────
--  051 — Compétences et développement des intervenants (indicateurs 21 et 22, CDC §35) : spécialités,
--  diplômes et certifications (résumé), besoins de développement, date du dernier entretien ; actions de
--  développement (formation suivie ou prévue, tutorat, événement…) avec évaluation de leur efficacité.
--  Additive.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE intervenants
  ADD COLUMN specialites               text CHECK (char_length(specialites) <= 2000),
  ADD COLUMN diplomes_certifications   text CHECK (char_length(diplomes_certifications) <= 4000),
  ADD COLUMN besoins_developpement     text CHECK (char_length(besoins_developpement) <= 4000),
  ADD COLUMN date_dernier_entretien    date;

CREATE TABLE developpement_intervenants (
  id                    serial PRIMARY KEY,
  intervenant_id        integer NOT NULL REFERENCES intervenants(id) ON DELETE CASCADE,
  type                  text NOT NULL DEFAULT 'formation' CHECK (type IN ('formation', 'tutorat', 'evenement', 'autoformation', 'analyse_pratique', 'autre')),
  intitule              text NOT NULL CHECK (char_length(intitule) BETWEEN 1 AND 200),
  organisme             text CHECK (char_length(organisme) <= 200),
  competence_visee      text CHECK (char_length(competence_visee) <= 500),
  date_debut            date,
  date_fin              date,
  duree_heures          numeric(6,1) CHECK (duree_heures >= 0 AND duree_heures <= 2000),
  statut                text NOT NULL DEFAULT 'prevue' CHECK (statut IN ('prevue', 'realisee', 'annulee')),
  evaluation_efficacite text CHECK (char_length(evaluation_efficacite) <= 4000),
  lien_preuve           text CHECK (char_length(lien_preuve) <= 500),
  cree_par              integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le               timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le         timestamptz NOT NULL DEFAULT now(),
  CHECK (date_fin IS NULL OR date_debut IS NULL OR date_fin >= date_debut)
);
CREATE INDEX developpement_intervenants_intervenant ON developpement_intervenants (intervenant_id);
