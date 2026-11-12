-- ─────────────────────────────────────────────────────────────
--  Retour arrière de la migration 034 (documents partagés).
--  HORS de db/migrations/ : le runner exécute tout fichier NNN_*.sql.
--  Préconditions : code précédent redéployé ; sauvegarde SECU-01/02 prise.
--  Tout est dans une transaction : une erreur annule l'ensemble.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- Vue de contrôle dépendante des tables à supprimer
DROP VIEW IF EXISTS migration_034_cas_a_valider;
DROP TABLE IF EXISTS corbeille_operations;

-- R0 : aucune autre table ne dépend de documents
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
  WHERE confrelid = 'documents'::regclass
    AND conrelid::regclass::text NOT IN ('document_versions', 'document_formations', 'preuve_documents', 'documents_generes', 'corbeille_operations');
  IF n > 0 THEN
    RAISE EXCEPTION 'Rollback 034 refusé (R0) : % dépendance(s) inattendue(s) sur documents', n;
  END IF;
END $$;

-- R0b : archivage obligatoire avant toute suppression
CREATE TABLE archive_034_documents           AS SELECT * FROM documents;
CREATE TABLE archive_034_document_versions   AS SELECT * FROM document_versions;
CREATE TABLE archive_034_document_formations AS SELECT * FROM document_formations;
CREATE TABLE archive_034_preuve_documents    AS SELECT * FROM preuve_documents;

DO $$
DECLARE
  paires text[][] := ARRAY[
    ARRAY['archive_034_documents',           'documents'],
    ARRAY['archive_034_document_versions',   'document_versions'],
    ARRAY['archive_034_document_formations', 'document_formations'],
    ARRAY['archive_034_preuve_documents',    'preuve_documents']];
  i integer; n_archive bigint; n_source bigint;
BEGIN
  FOR i IN 1 .. array_length(paires, 1) LOOP
    EXECUTE format('SELECT count(*) FROM %I', paires[i][1]) INTO n_archive;
    EXECUTE format('SELECT count(*) FROM %I', paires[i][2]) INTO n_source;
    IF n_archive <> n_source THEN
      RAISE EXCEPTION 'Rollback 034 refusé (R0b) : archive % (%) ≠ source % (%)',
        paires[i][1], n_archive, paires[i][2], n_source;
    END IF;
  END LOOP;
END $$;

-- R2 : cohérence legacy (chaque lien a son miroir sur le fichier courant)
DO $$
DECLARE n_liens bigint; n_miroirs bigint;
BEGIN
  SELECT count(*) INTO n_liens FROM preuve_documents;
  SELECT count(*) INTO n_miroirs FROM preuve_documents pd
  JOIN documents d ON d.id = pd.document_id
  JOIN preuve_fichiers pf ON pf.preuve_id = pd.preuve_id AND pf.drive_file_id = d.drive_file_id;
  IF n_liens <> n_miroirs THEN
    RAISE EXCEPTION 'Rollback 034 refusé (R2) : % liens sans miroir legacy cohérent', n_liens - n_miroirs;
  END IF;
END $$;

-- R1 : restaurer les statuts AVANT suppression de la colonne
UPDATE preuves SET statut = 'maitrise', statut_avant_remplacement = NULL
WHERE statut_avant_remplacement IS NOT NULL AND statut = 'a_consolider';

-- R3..R9 : dans l'ordre des dépendances
ALTER TABLE documents_generes DROP COLUMN document_id;
ALTER TABLE preuves DROP COLUMN statut_avant_remplacement;
DROP TABLE preuve_documents;
DROP TABLE document_formations;
DROP TABLE document_versions;
DROP TABLE documents;
DROP TABLE migration_034_controle;

DELETE FROM schema_migrations WHERE nom = '034_documents_partages.sql';

COMMIT;
