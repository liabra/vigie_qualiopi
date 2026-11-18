-- ─────────────────────────────────────────────────────────────
--  048 — Vigie 2.0 : préparation et simulation d'audit (CDC §33).
--  Une campagne fige le référentiel actif à sa création ; chaque indicateur reçoit une appréciation interne et
--  une observation ; un échantillon de sessions est tracé ; la campagne peut être partagée en lecture seule avec
--  un auditeur (compte « auditeur » à durée limitée). Additive : aucune donnée existante modifiée.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE campagnes_audit (
  id                       serial PRIMARY KEY,
  titre                    text NOT NULL CHECK (char_length(titre) BETWEEN 1 AND 200),
  type                     text NOT NULL DEFAULT 'audit_blanc' CHECK (type IN ('initial', 'surveillance', 'renouvellement', 'audit_blanc', 'interne')),
  date_audit               date,
  organisme_certificateur  text CHECK (char_length(organisme_certificateur) <= 200),
  perimetre                text CHECK (char_length(perimetre) <= 2000),
  referentiel_version_id   integer REFERENCES referentiel_versions(id) ON DELETE SET NULL,
  statut                   text NOT NULL DEFAULT 'preparation' CHECK (statut IN ('preparation', 'prete', 'realisee', 'archivee')),
  synthese                 text CHECK (char_length(synthese) <= 8000),
  partage_auditeur         boolean NOT NULL DEFAULT false,
  cree_par                 integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le                  timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campagne_indicateurs (
  campagne_id   integer NOT NULL REFERENCES campagnes_audit(id) ON DELETE CASCADE,
  indicateur_id integer NOT NULL REFERENCES indicateurs(id) ON DELETE CASCADE,
  appreciation  text NOT NULL DEFAULT 'non_evalue' CHECK (appreciation IN ('non_evalue', 'conforme', 'a_ameliorer', 'non_conforme', 'non_applicable')),
  observation   text CHECK (char_length(observation) <= 4000),
  evalue_par    integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  evalue_le     timestamptz,
  PRIMARY KEY (campagne_id, indicateur_id)
);

CREATE TABLE campagne_echantillon (
  campagne_id integer NOT NULL REFERENCES campagnes_audit(id) ON DELETE CASCADE,
  session_id  integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  motif       text CHECK (char_length(motif) <= 500),
  ajoute_par  integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  ajoute_le   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campagne_id, session_id)
);
