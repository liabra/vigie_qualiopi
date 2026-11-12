// Réponses neutres pour les tables documentaires dans les bases SIMULÉES des tests de
// pipeline (génération, preuves). Ce n'est pas un modèle du SQL : la sémantique réelle
// (identités, versions, verrous, miroir, R11) est testée sur PostgreSQL réel dans
// documentsPreuves.test.js et documentsRoutes.test.js.
let prochainId = 9000;
let horsContexte = [];

// Test uniquement : document existant (identifiant imposé).
export function definirDocument(d) {
  documents.set(d.id, { archive_le: null, version_courante: 1, drive_url: null, drive_nom: null, drive_mime: null, ...d });
}

// Test uniquement : lignes renvoyées par la lecture R11 (partage hors contexte).
export function definirHorsContexte(lignes) {
  horsContexte = lignes;
}
const documents = new Map();

// Identifiant de document stable par fichier Drive (cohérent avec les liens legacy seedés).
export function documentIdPour(driveFileId, donnees = {}) {
  for (const d of documents.values()) if (d.drive_file_id === driveFileId) return d.id;
  const id = prochainId++;
  documents.set(id, { id, drive_file_id: driveFileId, drive_url: null, drive_nom: null, drive_mime: null, version_courante: 1, archive_le: null, ...donnees });
  return id;
}

export function repondreDocuments(sql, params = []) {
  if (sql.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [] };
  if (sql.startsWith("SELECT id FROM corbeille_operations WHERE drive_file_id")) return { rows: [] };
  if (sql.startsWith("INSERT INTO documents (")) {
    const id = prochainId++;
    documents.set(id, { id, drive_file_id: params[0], drive_url: params[1], drive_nom: params[2], drive_mime: params[3], version_courante: 1, archive_le: null });
    return { rows: [{ id }], rowCount: 1 };
  }
  if (sql.startsWith("INSERT INTO document_versions")) return { rows: [{ id: prochainId++ }], rowCount: 1 };
  if (sql.startsWith("INSERT INTO preuve_documents")) return { rows: [], rowCount: 1 };
  if (sql.startsWith("INSERT INTO preuve_fichiers")) return { rows: [], rowCount: 1 };
  if (sql.startsWith("UPDATE document_versions") || sql.startsWith("UPDATE documents SET")) return { rows: [], rowCount: 1 };
  if (sql.startsWith("UPDATE preuve_documents") || sql.startsWith("UPDATE preuves SET statut")) return { rows: [], rowCount: 1 };
  if (sql.startsWith("DELETE FROM preuve_documents") || sql.startsWith("DELETE FROM preuve_fichiers")) return { rows: [], rowCount: 1 };
  if (sql === "SELECT id FROM documents WHERE drive_file_id = $1") return { rows: [{ id: documentIdPour(params[0]) }] };
  if (sql === "SELECT email FROM utilisateurs WHERE role = 'admin' AND actif") return { rows: [{ email: "admin@test.local" }] };
  if (sql.startsWith("SELECT version_courante FROM documents")) return { rows: [{ version_courante: 1 }] };
  if (sql.startsWith("SELECT * FROM documents WHERE id")) {
    const d = documents.get(params[0]);
    return { rows: d ? [{ ...d }] : [] };
  }
  if (sql.startsWith("SELECT id, statut, statut_avant_remplacement FROM preuves")) {
    return { rows: [{ id: params[0], statut: "maitrise", statut_avant_remplacement: null }] };
  }
  if (sql.includes("p.id AS preuve_id") && sql.includes("FROM preuve_documents pd")) return { rows: horsContexte };
  if (/^SELECT .*FROM (document_versions|preuve_documents)\b/.test(sql)) return { rows: [] };
  if (/^SELECT .*FROM documents\b/.test(sql)) return { rows: [] };
  return null;
}
