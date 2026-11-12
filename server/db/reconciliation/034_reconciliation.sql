-- ─────────────────────────────────────────────────────────────
--  Réconciliation REJOUABLE des documents partagés (après 034).
--  Ne traite que les lignes legacy créées APRÈS la bascule, par un code
--  qui n'écrit que le legacy. N'écrit jamais dans document_formations,
--  ne modifie jamais preuves.statut, ne réintroduit jamais un lien
--  détaché (le détachement supprime aussi la ligne legacy).
--  Exécution : psql -v ON_ERROR_STOP=1 -f 034_reconciliation.sql (une transaction).
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- R-a : documents pour les fichiers legacy post-bascule sans identité
INSERT INTO documents (drive_file_id, drive_url, drive_nom, drive_mime, source, created_at)
SELECT DISTINCT ON (pf.drive_file_id)
  pf.drive_file_id, pf.drive_url, pf.drive_nom, pf.drive_mime, 'manuel', pf.ajoute_le
FROM preuve_fichiers pf
JOIN migration_034_controle c ON c.cle = 'cutover'
WHERE pf.ajoute_le > c.valeur
  AND NOT EXISTS (SELECT 1 FROM document_versions v WHERE v.drive_file_id = pf.drive_file_id)
ORDER BY pf.drive_file_id, pf.ajoute_le
ON CONFLICT (drive_file_id) DO NOTHING;

-- R-b : version 1 de ces documents
INSERT INTO document_versions (document_id, numero, drive_file_id, drive_url, drive_nom, drive_mime, introduite_le)
SELECT d.id, 1, d.drive_file_id, d.drive_url, d.drive_nom, d.drive_mime, d.created_at
FROM documents d
WHERE NOT EXISTS (SELECT 1 FROM document_versions v WHERE v.document_id = d.id);

-- R-c : liens manquants pour les lignes legacy post-bascule.
-- version_validee = version courante : un rattachement fait par l'ancien code
-- n'est pas un remplacement, il n'est donc pas en attente.
INSERT INTO preuve_documents (preuve_id, document_id, origine, stagiaire_id, version_validee, ajoute_par, ajoute_le)
SELECT pf.preuve_id, d.id,
       CASE pf.source WHEN 'import_drive' THEN 'import' WHEN 'generation' THEN 'generation' ELSE 'manuel' END,
       pf.stagiaire_id, d.version_courante, pf.ajoute_par, pf.ajoute_le
FROM preuve_fichiers pf
JOIN documents d ON d.drive_file_id = pf.drive_file_id
JOIN migration_034_controle c ON c.cle = 'cutover'
WHERE pf.ajoute_le > c.valeur
ON CONFLICT DO NOTHING;

-- Rapport de conflits (aucune action automatique) : fichier legacy post-bascule
-- déjà identifié comme version d'un autre document.
SELECT pf.preuve_id, pf.drive_file_id, v.document_id AS document_identifie
FROM preuve_fichiers pf
JOIN migration_034_controle c ON c.cle = 'cutover'
JOIN document_versions v ON v.drive_file_id = pf.drive_file_id
WHERE pf.ajoute_le > c.valeur
  AND NOT EXISTS (
    SELECT 1 FROM preuve_documents pd
    WHERE pd.preuve_id = pf.preuve_id AND pd.document_id = v.document_id);

COMMIT;
