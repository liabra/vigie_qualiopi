-- ─────────────────────────────────────────────────────────────
--  049 — Vigie 2.0 : enquêtes en ligne (CDC §34, indicateurs 30 à 32).
--  Une enquête est rattachée à une session ; elle se remplit sans compte via un lien à jeton aléatoire.
--  Chaque réponse devient une ligne de `satisfactions` (même table que la saisie manuelle) : la synthèse des
--  satisfactions et les indicateurs de session l'exploitent sans changement. Anonyme par défaut.
--  Additive : aucune donnée existante modifiée.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE enquetes (
  id            serial PRIMARY KEY,
  titre         text NOT NULL CHECK (char_length(titre) BETWEEN 1 AND 200),
  type          text NOT NULL CHECK (type IN ('a_chaud', 'a_froid', 'financeur', 'entreprise', 'formateur', 'prescripteur', 'partenaire')),
  session_id    integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  introduction  text CHECK (char_length(introduction) <= 2000),
  jeton         text NOT NULL UNIQUE CHECK (char_length(jeton) >= 24),
  ouverte       boolean NOT NULL DEFAULT true,
  date_fin      date,
  analyse_resultats text CHECK (char_length(analyse_resultats) <= 8000),
  analysee_le   timestamptz,
  analysee_par  integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_par      integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le       timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enquete_questions (
  id           serial PRIMARY KEY,
  enquete_id   integer NOT NULL REFERENCES enquetes(id) ON DELETE CASCADE,
  ordre        integer NOT NULL,
  libelle      text NOT NULL CHECK (char_length(libelle) BETWEEN 1 AND 500),
  type         text NOT NULL CHECK (type IN ('echelle', 'choix_unique', 'choix_multiple', 'oui_non', 'texte', 'nombre', 'date')),
  options      text[] NOT NULL DEFAULT '{}',
  obligatoire  boolean NOT NULL DEFAULT false,
  globale      boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX enquete_questions_une_globale ON enquete_questions (enquete_id) WHERE globale;

ALTER TABLE satisfactions ADD COLUMN enquete_id integer REFERENCES enquetes(id) ON DELETE SET NULL;
CREATE INDEX satisfactions_enquete ON satisfactions (enquete_id);
