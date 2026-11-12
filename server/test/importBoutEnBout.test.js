// ─────────────────────────────────────────────────────────────
//  Import du classeur, de bout en bout (étape 3B.1).
//  Route réelle POST /api/import/classeur, PostgreSQL réel, classeur réel (fixture),
//  Drive et Sheets SIMULÉS. Données entièrement fictives.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { setPoolFactory, setQueryExecutor } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { seedReferentiel } from "../src/seed.js";
import { createApp } from "../src/app.js";
import { encode } from "../src/session.js";
import { setDriveFactory, SHEETS_READONLY, DRIVE_FILE } from "../src/services/google.js";
import { extrairePreuves } from "../src/services/classeur.js";
import { driveConforme, RACINE_TEST } from "./helpers/driveConforme.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 55463;
const DATA = path.join(os.tmpdir(), "vq-import-" + process.pid);
const CLASSEUR = "CLASSEUR_TEST";

let cluster, pool, serveur, origine, adminId, contribId;
let fichiersDrive = []; // enfants du dossier racine, tels que l'index Drive les voit
const appelsEcriture = [];

const cookie = (uid) => "vq_session=" + encode({ uid, exp: Date.now() + 60_000 });
const A = () => ({ cookie: cookie(adminId) });
const C = () => ({ cookie: cookie(contribId) });

async function api(methode, chemin, corps, enTetes = {}) {
  const r = await fetch(origine + chemin, {
    method: methode,
    headers: { "Content-Type": "application/json", ...enTetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}

async function lire(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

const extrait = JSON.parse(await fs.readFile(path.join(HERE, "fixtures/classeur-audit-2026.json"), "utf8"));
const preuvesDuClasseur = extrairePreuves(extrait.grille, { fusions: extrait.fusions }).preuves;

// Index Drive : un fichier par titre de preuve, rangé à la racine.
function fichierPour(titre, i) {
  return { id: "F_IMP_" + i, name: titre, mimeType: "application/pdf", webViewLink: "https://drive.google.com/file/d/F_IMP_" + i + "/view", parents: [RACINE_TEST] };
}

function driveImport() {
  const d = driveConforme((id) => (id === CLASSEUR ? { name: "Classeur", parents: [RACINE_TEST] } : {}));
  const base = d.files.list;
  d.files.list = async (args) => {
    const parent = /'([^']+)' in parents/.exec(args.q || "")?.[1];
    if (parent === RACINE_TEST) return { data: { files: fichiersDrive.map((f) => ({ ...f })) } };
    return base(args);
  };
  for (const methode of ["update", "delete", "copy", "create"]) {
    d.files[methode] = async () => { appelsEcriture.push(methode); throw new Error("écriture Drive interdite : " + methode); };
  }
  const lignes = extrait.grille;
  const colonnes = Math.max(...lignes.map((r) => r.length));
  const sheets = { spreadsheets: {
    get: async () => ({ data: {
      properties: { title: "Classeur" },
      sheets: [{ properties: { sheetId: 0, title: "Suivi", index: 0, gridProperties: { rowCount: lignes.length + 5, columnCount: colonnes } },
        merges: extrait.fusions.map((m) => ({ startRowIndex: m.debutLigne, endRowIndex: m.finLigne, startColumnIndex: m.debutColonne, endColumnIndex: m.finColonne })) }],
    } }),
    values: { get: async () => ({ data: { values: lignes } }) },
  } };
  return { drive: d, sheets, row: { scopes: [DRIVE_FILE, SHEETS_READONLY].join(" "), email: "vigie@compte.test", expiry: Date.now() + 60_000, access_token: "x" } };
}

async function importer() {
  return api("POST", "/api/import/classeur", { fichierId: CLASSEUR }, A());
}

before(async () => {
  cluster = new EmbeddedPostgres({ databaseDir: DATA, port: PORT, user: "postgres", password: "postgres", persistent: false, onLog: () => {}, onError: () => {} });
  await cluster.initialise();
  await cluster.start();
  const racine = cluster.getPgClient("postgres");
  await racine.connect();
  await racine.query("CREATE DATABASE vq");
  await racine.end();
  pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/vq`, ssl: false, max: 8 });
  setPoolFactory(() => pool);
  setQueryExecutor((text, params) => pool.query(text, params));
  await migrate({ log: () => {} });
  await seedReferentiel();
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@i.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@i.local', 'Tukui', 'contributeur') RETURNING id"));
  fichiersDrive = preuvesDuClasseur.map((p, i) => fichierPour(p.titre, i));
  setDriveFactory(() => driveImport());
  serveur = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});

after(async () => {
  setDriveFactory(null);
  setPoolFactory(null);
  setQueryExecutor(null);
  if (serveur) await new Promise((r) => serveur.close(r));
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
});

test("premier import : la route crée les preuves, rattache les fichiers reconnus, aucune écriture Drive", async () => {
  const r = await importer();
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.ok(r.corps.creees > 0, "des preuves créées");
  const liens = (await lire("SELECT count(*)::int n FROM preuve_documents WHERE origine = 'import'"))[0].n;
  assert.ok(liens > 0, "des documents rattachés par l'import");
  const orphelins = (await lire("SELECT count(*)::int n FROM preuve_documents pd WHERE pd.origine = 'import' AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = pd.document_id)"))[0].n;
  assert.equal(orphelins, 0, "tout lien import pointe vers un document existant");
  assert.equal(appelsEcriture.length, 0);
});

test("second import : un lien absent du nouveau classeur est détaché, le document est conservé, rien n'est supprimé", async () => {
  const avantDocs = (await lire("SELECT count(*)::int n FROM documents"))[0].n;
  const liens = await lire("SELECT pd.preuve_id, pd.document_id, d.drive_file_id FROM preuve_documents pd JOIN documents d ON d.id = pd.document_id WHERE pd.origine = 'import' ORDER BY pd.preuve_id");
  const retire = liens[0];
  const fichierRetire = fichiersDrive.find((f) => f.id === retire.drive_file_id);
  fichiersDrive = fichiersDrive.filter((f) => f.id !== retire.drive_file_id);

  const r = await importer();
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal((await lire("SELECT count(*)::int n FROM preuve_documents WHERE preuve_id = $1 AND document_id = $2", [retire.preuve_id, retire.document_id]))[0].n, 0, "lien détaché");
  assert.equal((await lire("SELECT count(*)::int n FROM documents WHERE id = $1", [retire.document_id]))[0].n, 1, "document conservé");
  assert.equal((await lire("SELECT count(*)::int n FROM document_versions WHERE document_id = $1", [retire.document_id]))[0].n, 1, "versions conservées");
  assert.equal((await lire("SELECT count(*)::int n FROM documents"))[0].n, avantDocs, "aucun document supprimé ni ajouté");
  assert.equal(appelsEcriture.length, 0, "aucune écriture Drive");
  // Le fichier revient dans le classeur pour les étapes suivantes.
  fichiersDrive.push(fichierRetire);
});

test("revalidation en attente : le réimport ne change pas le statut, et un conflit d'identité ne réaffecte rien", async () => {
  const cible = (await lire("SELECT pd.preuve_id, pd.document_id, d.drive_file_id FROM preuve_documents pd JOIN documents d ON d.id = pd.document_id WHERE pd.origine = 'import' ORDER BY pd.preuve_id DESC LIMIT 1"))[0];
  assert.ok(cible, "une preuve importée existe");
  await pool.query("UPDATE preuves SET statut = 'maitrise', statut_avant_remplacement = NULL WHERE id = $1", [cible.preuve_id]);

  // Remplacement manuel du document : l'ancien fichier devient une version (identité figée).
  const remp = await api("POST", `/api/documents/${cible.document_id}/remplacer`, { drive_file_id: "F_IMP_NOUVEAU", version_attendue: 1, motif: "Nouvelle version" }, A());
  assert.equal(remp.statut, 200, JSON.stringify(remp.corps));
  const apres = await lire("SELECT statut, statut_avant_remplacement FROM preuves WHERE id = $1", [cible.preuve_id]);
  assert.deepEqual(apres[0], { statut: "a_consolider", statut_avant_remplacement: "maitrise" });

  // Le classeur pointe encore l'ancien fichier, désormais version d'un document : conflit.
  const docsAvant = (await lire("SELECT count(*)::int n FROM documents"))[0].n;
  const r = await importer();
  assert.equal(r.statut, 200, JSON.stringify(r.corps));

  assert.deepEqual((await lire("SELECT statut, statut_avant_remplacement FROM preuves WHERE id = $1", [cible.preuve_id]))[0],
    { statut: "a_consolider", statut_avant_remplacement: "maitrise" }, "statut en attente conservé");
  assert.equal((await lire("SELECT count(*)::int n FROM preuve_documents WHERE preuve_id = $1 AND document_id = $2", [cible.preuve_id, cible.document_id]))[0].n, 1, "lien conservé (pas de détachement qui restaurerait la maîtrise)");
  assert.equal((await lire("SELECT count(*)::int n FROM documents"))[0].n, docsAvant, "aucun document créé pour l'ancien fichier");
  assert.equal((await lire("SELECT count(*)::int n FROM documents WHERE drive_file_id = $1", [cible.drive_file_id]))[0].n, 0, "l'ancien fichier n'est pas réaffecté comme document");
  assert.equal(appelsEcriture.length, 0);
});
