-- ─────────────────────────────────────────────────────────────
--  Q4-1 — Annuaire des formateurs et intervenants.
--
--  Additif. Une personne peut intervenir sur plusieurs formations,
--  sessions et groupes ; une session ou un groupe peut avoir plusieurs
--  intervenants. Données PROFESSIONNELLES seulement : jamais d'adresse
--  personnelle, de date de naissance, de numéro de sécurité sociale, de
--  coordonnées bancaires ni de donnée médicale (aucune colonne prévue).
--
--  Fonction (ce que la personne fait) ≠ nature (relation professionnelle).
--  Une personne inactive garde tout son historique : aucune suppression
--  n'est prévue, et une personne déjà rattachée à une session ou à un
--  groupe ne peut pas être supprimée (ON DELETE RESTRICT).
--  Les champs texte historiques sessions.formateur / groupes.formateur
--  sont CONSERVÉS tels quels (aucune reprise automatique).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE intervenants (
  id          serial PRIMARY KEY,
  civilite    text CHECK (civilite IS NULL OR civilite IN ('M.', 'Mme')),
  nom         text NOT NULL CHECK (char_length(btrim(nom)) BETWEEN 1 AND 120),
  prenom      text NOT NULL CHECK (char_length(btrim(prenom)) BETWEEN 1 AND 120),
  email       text CHECK (email IS NULL OR char_length(email) <= 254),
  fonction    text NOT NULL DEFAULT 'formateur'
                CHECK (fonction IN ('formateur', 'referent_handicap', 'appui', 'autre')),
  nature      text NOT NULL
                CHECK (nature IN ('salarie', 'exterieur', 'sous_traitant', 'porte')),
  domaines    text[] NOT NULL DEFAULT '{}',
  actif       boolean NOT NULL DEFAULT true,
  cree_par    integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Une adresse professionnelle n'appartient qu'à une personne (aucun doublon).
CREATE UNIQUE INDEX intervenants_email_unique ON intervenants (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX intervenants_nom ON intervenants (lower(nom), lower(prenom));
CREATE TRIGGER intervenants_updated_at BEFORE UPDATE ON intervenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Formations que la personne peut animer.
CREATE TABLE intervenants_formations (
  intervenant_id integer NOT NULL REFERENCES intervenants(id) ON DELETE CASCADE,
  formation_id   integer NOT NULL REFERENCES formations(id) ON DELETE CASCADE,
  PRIMARY KEY (intervenant_id, formation_id)
);
CREATE INDEX intervenants_formations_formation ON intervenants_formations (formation_id);

-- Intervenants d'une session (historique conservé : RESTRICT côté personne).
CREATE TABLE intervenants_sessions (
  intervenant_id integer NOT NULL REFERENCES intervenants(id) ON DELETE RESTRICT,
  session_id     integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  cree_par       integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (intervenant_id, session_id)
);
CREATE INDEX intervenants_sessions_session ON intervenants_sessions (session_id);

-- Intervenants d'un groupe. La session est portée par le groupe lui-même :
-- la cohérence groupe ↔ session est structurelle, puis vérifiée par l'API.
CREATE TABLE intervenants_groupes (
  intervenant_id integer NOT NULL REFERENCES intervenants(id) ON DELETE RESTRICT,
  groupe_id      integer NOT NULL REFERENCES groupes(id) ON DELETE CASCADE,
  cree_par       integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (intervenant_id, groupe_id)
);
CREATE INDEX intervenants_groupes_groupe ON intervenants_groupes (groupe_id);
