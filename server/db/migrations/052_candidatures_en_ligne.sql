-- ─────────────────────────────────────────────────────────────
--  052 — Candidatures en ligne (CDC §39) : formulaire public par formation (ouverture contrôlée),
--  pièces attendues, étude, décision et affectation à une session. Les besoins d'aménagement sont une
--  donnée de santé potentielle : réservés à l'administrateur. Additive.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE formations
  ADD COLUMN candidature_ouverte boolean NOT NULL DEFAULT false,
  ADD COLUMN pieces_attendues    text[] NOT NULL DEFAULT '{}';

CREATE TABLE candidatures (
  id                   serial PRIMARY KEY,
  formation_id         integer NOT NULL REFERENCES formations(id) ON DELETE CASCADE,
  session_souhaitee_id integer REFERENCES sessions(id) ON DELETE SET NULL,
  civilite             text CHECK (civilite IN ('M.', 'Mme')),
  nom                  text NOT NULL CHECK (char_length(nom) BETWEEN 1 AND 100),
  prenom               text NOT NULL CHECK (char_length(prenom) BETWEEN 1 AND 100),
  email                text CHECK (char_length(email) <= 200),
  telephone            text CHECK (char_length(telephone) <= 30),
  date_naissance       date,
  adresse              text CHECK (char_length(adresse) <= 300),
  code_postal          text CHECK (char_length(code_postal) <= 10),
  ville                text CHECK (char_length(ville) <= 100),
  situation            text CHECK (char_length(situation) <= 100),
  prescripteur         text CHECK (char_length(prescripteur) <= 200),
  motivation           text CHECK (char_length(motivation) <= 4000),
  besoins_amenagement  text CHECK (char_length(besoins_amenagement) <= 2000),
  consentement_le      timestamptz NOT NULL,
  statut               text NOT NULL DEFAULT 'nouvelle' CHECK (statut IN ('nouvelle', 'en_etude', 'acceptee', 'refusee', 'sans_suite')),
  pieces_recues        text[] NOT NULL DEFAULT '{}',
  notes                text CHECK (char_length(notes) <= 4000),
  motif_decision       text CHECK (char_length(motif_decision) <= 1000),
  decision_le          timestamptz,
  decision_par         integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  stagiaire_id         integer REFERENCES stagiaires(id) ON DELETE SET NULL,
  inscription_id       integer REFERENCES inscriptions(id) ON DELETE SET NULL,
  cree_le              timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX candidatures_statut ON candidatures (statut, cree_le DESC);
