-- ─────────────────────────────────────────────────────────────
--  Documents partagés : un fichier Drive, une identité, plusieurs
--  preuves (indicateurs) et formations. Migration additive.
--  Le backfill est exécuté une seule fois ; la réconciliation rejouable
--  est dans db/reconciliation/034_reconciliation.sql.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE documents (
  id               serial PRIMARY KEY,
  drive_file_id    text NOT NULL CHECK (char_length(btrim(drive_file_id)) > 0),
  drive_url        text,
  drive_nom        text,
  drive_mime       text,
  source           text NOT NULL CHECK (source IN ('manuel', 'import_drive', 'generation')),
  confidentiel     boolean NOT NULL DEFAULT false,
  version_courante smallint NOT NULL DEFAULT 1 CHECK (version_courante >= 1),
  archive_le       timestamptz,
  cree_par         integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX documents_drive_file_unique ON documents (drive_file_id);
CREATE TRIGGER documents_updated_at BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE document_versions (
  id              serial PRIMARY KEY,
  document_id     integer NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  numero          smallint NOT NULL CHECK (numero >= 1),
  drive_file_id   text NOT NULL,
  drive_url       text,
  drive_nom       text,
  drive_mime      text,
  introduite_le   timestamptz NOT NULL DEFAULT now(),
  introduite_par  integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  remplacee_le    timestamptz,
  remplacee_par   integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  motif           text CHECK (motif IS NULL OR char_length(motif) <= 500),
  corbeille_le    timestamptz,
  UNIQUE (document_id, numero),
  CHECK (corbeille_le IS NULL OR remplacee_le IS NOT NULL)
);
CREATE UNIQUE INDEX document_versions_drive_file_unique ON document_versions (drive_file_id);
CREATE UNIQUE INDEX document_versions_courante ON document_versions (document_id) WHERE remplacee_le IS NULL;

CREATE TABLE document_formations (
  document_id  integer NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  formation_id integer NOT NULL REFERENCES formations(id) ON DELETE CASCADE,
  origine      text NOT NULL DEFAULT 'manuel'
                 CHECK (origine IN ('manuel', 'derive_session', 'derive_inscription')),
  ajoute_par   integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  ajoute_le    timestamptz NOT NULL DEFAULT now(),
  valide_par   integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  valide_le    timestamptz,
  PRIMARY KEY (document_id, formation_id)
);

CREATE TABLE preuve_documents (
  preuve_id       integer NOT NULL REFERENCES preuves(id) ON DELETE CASCADE,
  document_id     integer NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  origine         text NOT NULL CHECK (origine IN ('manuel', 'import', 'generation')),
  stagiaire_id    integer REFERENCES stagiaires(id) ON DELETE SET NULL,
  version_validee smallint NOT NULL CHECK (version_validee >= 1),
  revalide_le     timestamptz,
  revalide_par    integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  ajoute_par      integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  ajoute_le       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (preuve_id, document_id)
);
CREATE INDEX preuve_documents_document ON preuve_documents (document_id);

ALTER TABLE preuves
  ADD COLUMN statut_avant_remplacement text CHECK (statut_avant_remplacement = 'maitrise');

ALTER TABLE documents_generes
  ADD COLUMN document_id integer REFERENCES documents(id) ON DELETE SET NULL;
CREATE INDEX documents_generes_document ON documents_generes (document_id);

CREATE TABLE migration_034_controle (
  cle    text PRIMARY KEY,
  valeur timestamptz NOT NULL DEFAULT now()
);
INSERT INTO migration_034_controle (cle) VALUES ('cutover'), ('backfill_formations');

-- ── Backfill (exécuté une seule fois) ────────────────────────

-- B1 : documents depuis les fichiers preuve
INSERT INTO documents (drive_file_id, drive_url, drive_nom, drive_mime, source, created_at)
SELECT DISTINCT ON (pf.drive_file_id)
  pf.drive_file_id, pf.drive_url, pf.drive_nom, pf.drive_mime,
  CASE pf.source WHEN 'import_drive' THEN 'import_drive'
                 WHEN 'generation'   THEN 'generation'
                 ELSE 'manuel' END,
  pf.ajoute_le
FROM preuve_fichiers pf
ORDER BY pf.drive_file_id, pf.ajoute_le, pf.id
ON CONFLICT (drive_file_id) DO NOTHING;

-- B2 : documents générés non couverts
INSERT INTO documents (drive_file_id, drive_url, drive_nom, source, created_at)
SELECT DISTINCT ON (dg.drive_file_id) dg.drive_file_id, dg.drive_url, dg.nom, 'generation', dg.genere_le
FROM documents_generes dg
ORDER BY dg.drive_file_id, dg.genere_le
ON CONFLICT (drive_file_id) DO NOTHING;

UPDATE documents_generes dg SET document_id = d.id
FROM documents d
WHERE d.drive_file_id = dg.drive_file_id AND dg.document_id IS NULL;

-- B3 : version 1 pour chaque document
INSERT INTO document_versions (document_id, numero, drive_file_id, drive_url, drive_nom, drive_mime, introduite_le)
SELECT d.id, 1, d.drive_file_id, d.drive_url, d.drive_nom, d.drive_mime, d.created_at
FROM documents d
WHERE NOT EXISTS (SELECT 1 FROM document_versions v WHERE v.document_id = d.id);

-- B4 : liens preuve ↔ document (version 1 réputée revue)
INSERT INTO preuve_documents (preuve_id, document_id, origine, stagiaire_id, version_validee, ajoute_par, ajoute_le)
SELECT pf.preuve_id, d.id,
       CASE pf.source WHEN 'import_drive' THEN 'import' WHEN 'generation' THEN 'generation' ELSE 'manuel' END,
       pf.stagiaire_id, 1, pf.ajoute_par, pf.ajoute_le
FROM preuve_fichiers pf
JOIN documents d ON d.drive_file_id = pf.drive_file_id
ON CONFLICT DO NOTHING;

-- B5 : rattachements formation dérivés des sessions (à valider)
INSERT INTO document_formations (document_id, formation_id, origine)
SELECT DISTINCT pd.document_id, s.formation_id, 'derive_session'
FROM preuve_documents pd
JOIN preuves p ON p.id = pd.preuve_id
JOIN sessions s ON s.id = p.session_id
ON CONFLICT DO NOTHING;

INSERT INTO document_formations (document_id, formation_id, origine)
SELECT DISTINCT pd.document_id, s.formation_id, 'derive_session'
FROM preuve_documents pd
JOIN preuves p ON p.id = pd.preuve_id
JOIN groupes g ON g.id = p.groupe_id
JOIN sessions s ON s.id = g.session_id
WHERE p.session_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO document_formations (document_id, formation_id, origine)
SELECT DISTINCT dg.document_id, s.formation_id, 'derive_session'
FROM documents_generes dg
JOIN sessions s ON s.id = dg.session_id
WHERE dg.document_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- B6 : documents de portée stagiaire sans session, stagiaire inscrit à UNE seule formation
INSERT INTO document_formations (document_id, formation_id, origine)
SELECT dg.document_id, MIN(s.formation_id), 'derive_inscription'
FROM documents_generes dg
JOIN inscriptions i ON i.stagiaire_id = dg.stagiaire_id
JOIN sessions s ON s.id = i.session_id
WHERE dg.session_id IS NULL AND dg.groupe_id IS NULL AND dg.stagiaire_id IS NOT NULL
  AND dg.document_id IS NOT NULL
GROUP BY dg.document_id, dg.stagiaire_id
HAVING COUNT(DISTINCT s.formation_id) = 1
ON CONFLICT DO NOTHING;

UPDATE migration_034_controle SET valeur = now() WHERE cle = 'backfill_formations';

-- ── Cas à valider humainement (lecture seule, aucun lien créé) ──
CREATE VIEW migration_034_cas_a_valider AS
  SELECT 'P1'::text AS cas, pd.preuve_id::text AS cible,
         'preuve sans session ni groupe : formation indéterminée' AS motif
  FROM preuve_documents pd
  JOIN preuves p ON p.id = pd.preuve_id
  WHERE p.session_id IS NULL AND p.groupe_id IS NULL
  UNION ALL
  SELECT 'P2', dg.id::text, 'document généré sans session ni groupe, sans formation dérivable'
  FROM documents_generes dg
  WHERE dg.session_id IS NULL AND dg.groupe_id IS NULL AND dg.document_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM document_formations df WHERE df.document_id = dg.document_id)
  UNION ALL
  SELECT 'P3', dg.document_id::text, 'stagiaire inscrit à plusieurs formations, sans session de contexte'
  FROM documents_generes dg
  JOIN inscriptions i ON i.stagiaire_id = dg.stagiaire_id
  JOIN sessions s ON s.id = i.session_id
  WHERE dg.session_id IS NULL AND dg.groupe_id IS NULL AND dg.stagiaire_id IS NOT NULL
    AND dg.document_id IS NOT NULL
  GROUP BY dg.document_id, dg.stagiaire_id
  HAVING COUNT(DISTINCT s.formation_id) > 1
  UNION ALL
  SELECT 'P4', df.document_id::text, 'document rattaché dérivé à plusieurs formations'
  FROM document_formations df
  WHERE df.origine = 'derive_session' AND df.valide_le IS NULL
  GROUP BY df.document_id
  HAVING COUNT(*) > 1;

-- ── Contrôles post-migration : toute violation annule la migration ──
DO $$
DECLARE
  n_legacy bigint; n_liens bigint; n_fichiers bigint; n_docs bigint;
  n_gen_orphelins bigint; n_versions_ko bigint; n_attente_ko bigint;
BEGIN
  SELECT count(*) INTO n_legacy FROM preuve_fichiers;
  SELECT count(*) INTO n_liens FROM preuve_documents;
  IF n_legacy <> n_liens THEN
    RAISE EXCEPTION 'Contrôle 034 : preuve_fichiers (%) ≠ preuve_documents (%)', n_legacy, n_liens;
  END IF;

  SELECT count(*) INTO n_fichiers FROM (
    SELECT drive_file_id FROM preuve_fichiers UNION SELECT drive_file_id FROM documents_generes
  ) u;
  SELECT count(*) INTO n_docs FROM documents;
  IF n_fichiers <> n_docs THEN
    RAISE EXCEPTION 'Contrôle 034 : fichiers distincts (%) ≠ documents (%)', n_fichiers, n_docs;
  END IF;

  SELECT count(*) INTO n_gen_orphelins FROM documents_generes WHERE document_id IS NULL;
  IF n_gen_orphelins > 0 THEN
    RAISE EXCEPTION 'Contrôle 034 : % documents générés sans document_id', n_gen_orphelins;
  END IF;

  SELECT count(*) INTO n_versions_ko FROM documents d
  WHERE (SELECT count(*) FROM document_versions v WHERE v.document_id = d.id AND v.remplacee_le IS NULL) <> 1
     OR (SELECT v.numero FROM document_versions v WHERE v.document_id = d.id AND v.remplacee_le IS NULL) <> d.version_courante;
  IF n_versions_ko > 0 THEN
    RAISE EXCEPTION 'Contrôle 034 : % documents sans version courante cohérente', n_versions_ko;
  END IF;

  SELECT count(*) INTO n_attente_ko FROM preuve_documents pd
  JOIN documents d ON d.id = pd.document_id
  WHERE pd.version_validee > d.version_courante;
  IF n_attente_ko > 0 THEN
    RAISE EXCEPTION 'Contrôle 034 : % liens avec version_validee > version_courante', n_attente_ko;
  END IF;
END $$;
