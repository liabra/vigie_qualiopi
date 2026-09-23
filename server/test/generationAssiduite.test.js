// L5 — Preuve que les marqueurs d'assiduité arrivent RÉELLEMENT jusqu'au
// payload envoyé au service de génération (requêtes de remplacement Google
// Docs), sans dépendre d'une écriture Drive réelle (impossible hors
// production). `genererDocuments` accepte un client Google injecté, comme
// le lot L1 le prévoyait pour les tests.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { setPoolFactory } from "../src/db.js";
import { genererDocuments } from "../src/services/documents.js";
import { DRIVE_FILE } from "../src/services/google.js";
import { MARQUEURS } from "../src/services/marqueurs.js";

const DOC = "application/vnd.google-apps.document";
const sqlNormalise = (text) => String(text).replace(/\s+/g, " ").trim();

// Base simulée : répond aux requêtes du flux de génération (modèle,
// indicateur, contexte, cibles, existants, écritures transactionnelles).
function baseSimulee() {
  const session = {
    id: 1, reference: "SESS-1", date_debut: "2026-01-05", date_fin: "2026-03-05",
    lieu: "Cayenne", formateur: "Mme Carr", horaire: "8h30–12h00",
    duree_heures_reelle: 28, formation_id: 1, intitule: "Atelier numérique",
    duree_heures_defaut: 21, statut: "planifiee",
  };
  const executer = async (text, params) => {
    const sql = sqlNormalise(text);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.startsWith("SELECT * FROM modeles_documents WHERE id = $1 AND actif")) {
      return { rows: [{ id: 1, nom: "Attestation", drive_file_id: "MODELE", drive_mime: DOC, portee: "stagiaire" }] };
    }
    if (sql.startsWith("SELECT indicateur_id FROM modele_indicateurs")) {
      return { rows: [{ indicateur_id: 11 }] };
    }
    if (sql.startsWith("SELECT s.*, f.id AS formation_id")) {
      return { rows: [{ ...session }] };
    }
    if (sql.startsWith("SELECT s.id, s.civilite, s.nom, s.prenom, s.email")) {
      return {
        rows: [
          { id: 1, civilite: "Mme", nom: "Stark", prenom: "Blandine", email: null, telephone: null,
            entreprise: null, financeur: null, prescripteur: "pole_emploi", prescripteur_nom: "Pôle Emploi",
            groupe_nom: "Soula", statut: "inscrit", heures_absence: "3.50" },
          { id: 2, civilite: "M.", nom: "Tonate", prenom: "Noé", email: null, telephone: null,
            entreprise: null, financeur: null, prescripteur: "mission_locale", prescripteur_nom: "Mission Locale",
            groupe_nom: "Soula", statut: "inscrit", heures_absence: "0" },
        ],
      };
    }
    if (sql.startsWith("SELECT * FROM documents_generes")) return { rows: [] };
    if (sql.startsWith("INSERT INTO generations")) return { rows: [{ id: 99 }] };
    if (sql.startsWith("INSERT INTO preuves")) return { rows: [{ id: 10 }] };
    if (sql.startsWith("DELETE FROM preuve_fichiers")) return { rows: [] };
    if (sql.startsWith("INSERT INTO preuve_fichiers")) return { rows: [] };
    if (sql.startsWith("INSERT INTO documents_generes")) return { rows: [] };
    throw new Error("Requête inattendue pour la base simulée : " + sql);
  };
  const pool = { query: executer, connect: async () => ({ query: executer, release: () => {} }) };
  setPoolFactory(() => pool);
}

// Client Google simulé : capture les requêtes de remplacement des marqueurs
// envoyées à Google Docs (le payload exact, pas le résultat d'une écriture).
function clientGoogleSimule() {
  const requetes = [];
  let n = 0;
  return {
    requetes,
    client: {
      row: { scopes: DRIVE_FILE, expiry: Date.now() + 60_000, access_token: "x" },
      drive: {
        files: {
          list: async () => ({ data: { files: [] } }),
          create: async () => ({ data: { id: "dossier-" + ++n } }),
          copy: async ({ requestBody }) => ({ data: { id: "copie-" + ++n, name: requestBody.name, webViewLink: "https://d/c", mimeType: DOC } }),
        },
      },
      docs: {
        documents: {
          get: async () => ({ data: { body: { content: [] }, headers: {}, footers: {} } }),
          batchUpdate: async ({ requestBody }) => { requetes.push(...requestBody.requests); return { data: {} }; },
        },
      },
      sheets: { spreadsheets: { batchUpdate: async () => ({ data: {} }) } },
    },
  };
}

after(() => setPoolFactory(null));

test("les marqueurs d'assiduité arrivent remplis dans le payload de génération", async () => {
  baseSimulee();
  const { requetes, client } = clientGoogleSimule();
  const r = await genererDocuments({ modeleId: 1, sessionId: 1, utilisateurId: 1, client });
  assert.equal(r.documents, 2, "un document par stagiaire (hors abandons)");

  // Une requête de remplacement par marqueur, groupée par copie : chaque
  // stagiaire reçoit les MARQUEURS.length marqueurs.
  const copies = [];
  for (let i = 0; i < requetes.length; i += MARQUEURS.length) {
    const valeurs = new Map();
    for (const req of requetes.slice(i, i + MARQUEURS.length)) {
      valeurs.set(req.replaceAllText.containsText.text, req.replaceAllText.replaceText);
    }
    copies.push(valeurs);
  }
  assert.equal(copies.length, 2);

  // Stagiaire AVEC absence : 3,5 h d'absence sur 28 h prévues.
  const [avecAbsence, sansAbsence] = copies;
  assert.equal(avecAbsence.get("{{heures_absence}}"), "3.5 h");
  assert.equal(avecAbsence.get("{{heures_suivies}}"), "24.5 h");
  assert.equal(avecAbsence.get("{{taux_assiduite}}"), "88 %");
  assert.equal(avecAbsence.get("{{prescripteur}}"), "Pôle Emploi", "libellé du prescripteur, pas le code");
  assert.equal(avecAbsence.get("{{groupe}}"), "Soula");
  assert.equal(avecAbsence.get("{{session_reference}}"), "SESS-1");

  // Stagiaire SANS absence.
  assert.equal(sansAbsence.get("{{heures_absence}}"), "0 h");
  assert.equal(sansAbsence.get("{{heures_suivies}}"), "28 h");
  assert.equal(sansAbsence.get("{{taux_assiduite}}"), "100 %");
});
