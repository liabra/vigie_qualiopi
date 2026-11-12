// ─────────────────────────────────────────────────────────────
//  Inventaire Drive : routes réelles (administrateur), PostgreSQL réel, Drive SIMULÉ.
//  Vérifie : accès réservé, déclarations existantes, diagnostic dans le périmètre, refus hors
//  périmètre, Drive absent, et AUCUNE écriture (ni Drive, ni base).
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import os from "node:os";
import path from "node:path";
import pg from "pg";

import { setPoolFactory, setQueryExecutor } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { seedReferentiel } from "../src/seed.js";
import { createApp } from "../src/app.js";
import { encode } from "../src/session.js";
import { setDriveFactory } from "../src/services/google.js";
import { config } from "../src/config.js";
import { driveConforme, RACINE_TEST } from "./helpers/driveConforme.js";

const PORT = 55486;
const DATA = path.join(os.tmpdir(), "vq-inventaire-routes-" + process.pid);
const DOC = "application/vnd.google-apps.document";
const SHEET = "application/vnd.google-apps.spreadsheet";
const DOSSIER = "application/vnd.google-apps.folder";

let cluster, pool, serveur, origine, adminId, contribId;
let ecritures = [];
let textes = {};

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

// Arborescence simulée : racine → dossier Modèles → fichiers ; un fichier hors périmètre.
const ENFANTS = {
  [RACINE_TEST]: [
    { id: "DOSSIER_MODELES_01", name: "Modèles", mimeType: DOSSIER },
  ],
  DOSSIER_MODELES_01: [
    { id: "FICHIER_CONVOC_01", name: "Convocation session.docx", mimeType: DOC, modifiedTime: "2026-10-05T09:00:00Z" },
    { id: "FICHIER_EMARG_01", name: "Émargement.xlsx", mimeType: SHEET },
  ],
};
const PARENTS = { FICHIER_HORS_01: ["AILLEURS_000001"], AILLEURS_000001: [] };

function clientSimule() {
  const base = driveConforme((fileId) => ({
    name: fileId === "FICHIER_EMARG_01" ? "Émargement.xlsx" : "Convocation session.docx",
    mimeType: fileId === "FICHIER_EMARG_01" ? SHEET : DOC,
  }));
  const lecture = base.files.get;
  const drive = {
    files: {
      get: async (args) => {
        if (PARENTS[args.fileId]) {
          return { data: { id: args.fileId, parents: PARENTS[args.fileId], trashed: false, owners: [{ emailAddress: config.driveAccountEmail }], mimeType: DOC, name: "Hors périmètre.docx" } };
        }
        return lecture(args);
      },
      list: async (args) => {
        if (args.q.includes("name =")) return base.files.list(args); // résolution de la racine : Drive conforme
        if (!args.q.includes("in parents")) return base.files.list(args);
        const id = /'([^']+)' in parents/.exec(args.q)[1];
        return { data: { files: ENFANTS[id] || [] } };
      },
      create: async () => { ecritures.push("files.create"); throw new Error("écriture interdite"); },
      update: async () => { ecritures.push("files.update"); throw new Error("écriture interdite"); },
      delete: async () => { ecritures.push("files.delete"); throw new Error("écriture interdite"); },
      copy: async () => { ecritures.push("files.copy"); throw new Error("écriture interdite"); },
    },
    permissions: base.permissions,
  };
  const docs = {
    documents: {
      get: async ({ documentId }) => {
        const texte = textes[documentId] ?? "";
        return { data: { body: { content: [{ paragraph: { elements: [{ textRun: { content: texte } }] } }] }, headers: {}, footers: {} } };
      },
      batchUpdate: async () => { ecritures.push("documents.batchUpdate"); throw new Error("écriture interdite"); },
    },
  };
  return { drive, docs, row: { scopes: "", email: config.driveAccountEmail, expiry: Date.now() + 60_000, access_token: "x" } };
}

async function compter() {
  const { rows } = await pool.query("SELECT (SELECT count(*)::int FROM modeles_documents) AS modeles, (SELECT count(*)::int FROM modele_indicateurs) AS liens");
  return rows[0];
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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@inv.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@inv.local', 'Tukui', 'contributeur') RETURNING id"));
  // Un modèle déjà déclaré pour la convocation.
  await pool.query("INSERT INTO modeles_documents (nom, drive_file_id, portee, type_document, mode_generation) VALUES ('Convocation', 'FICHIER_CONVOC_01', 'session', 'convocation', 'manuel')");
  textes.FICHIER_CONVOC_01 = "Bonjour {{stagiaire_nom}}, rendez-vous le {{session_date_debut}}. Ancien : {{nom_stagiaire}}";
  textes.FICHIER_HORS_01 = "Texte.";
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

test("accès réservé : contributeur refusé sur l'inventaire et sur le diagnostic", async () => {
  setDriveFactory(() => clientSimule());
  assert.equal((await api("GET", "/api/inventaire-drive", undefined, C())).statut, 403);
  assert.equal((await api("POST", "/api/inventaire-drive/diagnostic", { drive_file_id: "FICHIER_CONVOC_01" }, C())).statut, 403);
});

test("inventaire : fichiers Docs et Sheets, déclarations existantes, lecture seule", async () => {
  ecritures = [];
  const avant = await compter();
  setDriveFactory(() => clientSimule());
  const r = await api("GET", "/api/inventaire-drive", undefined, A());
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.lecture_seule, true);
  assert.equal(r.corps.racine, config.driveRacine);
  const convocation = r.corps.fichiers.find((f) => f.id === "FICHIER_CONVOC_01");
  assert.ok(convocation, "fichier du dossier Modèles présent");
  assert.equal(convocation.emplacement, `${config.driveRacine} / Modèles`);
  assert.deepEqual(convocation.declarations.map((d) => [d.nom, d.portee, d.actif]), [["Convocation", "session", true]]);
  const emargement = r.corps.fichiers.find((f) => f.id === "FICHIER_EMARG_01");
  assert.deepEqual(emargement.declarations, [], "non déclaré dans Vigie");
  assert.deepEqual(await compter(), avant, "aucune écriture en base");
  assert.deepEqual(ecritures, [], "aucune écriture Drive");
});

test("diagnostic dans le périmètre : marqueurs, classement et proposition, rien d'enregistré", async () => {
  ecritures = [];
  const avant = await compter();
  setDriveFactory(() => clientSimule());
  const r = await api("POST", "/api/inventaire-drive/diagnostic", { drive_file_id: "FICHIER_CONVOC_01" }, A());
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.enregistre, false);
  assert.equal(r.corps.fichier.nom, "Convocation session.docx");
  assert.ok(r.corps.marqueurs.reconnus.includes("stagiaire_nom"), "marqueur canonique reconnu");
  assert.ok(r.corps.marqueurs.historiques.includes("nom_stagiaire") || r.corps.marqueurs.inconnus.includes("nom_stagiaire"), "marqueur historique distingué des reconnus");
  assert.ok(Array.isArray(r.corps.marqueurs.inconnus) && Array.isArray(r.corps.marqueurs.historiques));
  assert.equal(r.corps.classement.statut, "correction", "un marqueur historique ou inconnu impose une correction");
  assert.equal(r.corps.proposition.type_document, "convocation");
  assert.equal(r.corps.proposition.statut, "proposition_non_enregistree");
  assert.deepEqual(await compter(), avant, "aucune modification de modèle");
  assert.deepEqual(ecritures, [], "aucune écriture Drive");
});

test("diagnostic hors périmètre : refusé par le contrôle D-R, sans analyse", async () => {
  ecritures = [];
  setDriveFactory(() => clientSimule());
  const r = await api("POST", "/api/inventaire-drive/diagnostic", { drive_file_id: "FICHIER_HORS_01" }, A());
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, "fichier_hors_racine");
  assert.deepEqual(ecritures, []);
});

test("identifiant invalide refusé avant tout appel Drive", async () => {
  setDriveFactory(() => clientSimule());
  assert.equal((await api("POST", "/api/inventaire-drive/diagnostic", { drive_file_id: "x'; --" }, A())).statut, 400);
  assert.equal((await api("POST", "/api/inventaire-drive/diagnostic", {}, A())).statut, 400);
});

test("Drive absent : inventaire et diagnostic renvoient 503 sans rien écrire", async () => {
  setDriveFactory(() => null);
  const liste = await api("GET", "/api/inventaire-drive", undefined, A());
  assert.equal(liste.statut, 503);
  assert.equal(liste.corps.code, "drive_indisponible");
  const diag = await api("POST", "/api/inventaire-drive/diagnostic", { drive_file_id: "FICHIER_CONVOC_01" }, A());
  assert.equal(diag.statut, 503);
});

test("erreur de lecture Drive pendant l'inventaire : 503 propre, rien d'exposé", async () => {
  const cassé = clientSimule();
  cassé.drive.files.list = async (args) => {
    if (args.q.includes("in parents") && !args.q.includes("name =")) throw Object.assign(new Error("secret interne jeton ya29"), { code: 500 });
    return driveConforme(() => ({})).files.list(args);
  };
  setDriveFactory(() => cassé);
  const r = await api("GET", "/api/inventaire-drive", undefined, A());
  assert.equal(r.statut, 503);
  assert.equal(JSON.stringify(r.corps).includes("ya29"), false, "aucun détail technique renvoyé");
});
