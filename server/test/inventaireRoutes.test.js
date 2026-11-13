// ─────────────────────────────────────────────────────────────
//  Inventaire Drive : routes réelles (administrateur), PostgreSQL réel, Drive SIMULÉ.
//  Vérifie : accès réservé, déclarations existantes, diagnostic dans le périmètre, refus hors
//  périmètre, racine introuvable, Drive absent, et AUCUNE écriture (ni Drive, ni base).
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

const PORT = 55489;
const DATA = path.join(os.tmpdir(), "vq-inventaire-routes-" + process.pid);
const DOC = "application/vnd.google-apps.document";
const SHEET = "application/vnd.google-apps.spreadsheet";
const DOSSIER = "application/vnd.google-apps.folder";
const RACINE = "RACINE_VIGIE_0001";

let cluster, pool, serveur, origine, adminId, contribId;
let ecritures = [];

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

// Arborescence simulée : racine → dossier Modèles → fichiers ; un fichier hors du dossier Vigie.
const ENFANTS = {
  [RACINE]: [{ id: "DOSSIER_MODELES_01", name: "Modèles", mimeType: DOSSIER }],
  DOSSIER_MODELES_01: [
    { id: "FICHIER_CONVOC_01", name: "Convocation session.docx", mimeType: DOC, modifiedTime: "2026-10-05T09:00:00Z" },
    { id: "FICHIER_EMARG_01", name: "Émargement.xlsx", mimeType: SHEET },
  ],
};
const PARENTS = {
  FICHIER_CONVOC_01: ["DOSSIER_MODELES_01"], FICHIER_EMARG_01: ["DOSSIER_MODELES_01"],
  DOSSIER_MODELES_01: [RACINE], [RACINE]: ["root"],
  FICHIER_HORS_0001: ["AILLEURS_000001"], AILLEURS_000001: [],
};
const NOMS = { FICHIER_CONVOC_01: ["Convocation session.docx", DOC], FICHIER_EMARG_01: ["Émargement.xlsx", SHEET], FICHIER_HORS_0001: ["Hors.docx", DOC] };
const TEXTES = {
  FICHIER_CONVOC_01: "Bonjour {{stagiaire_nom}}, rendez-vous le {{session_date_debut}}. Ancien : {{nom_stagiaire}}",
};

function clientSimule({ racines = [{ id: RACINE }] } = {}) {
  const interdit = (nom) => async () => { ecritures.push(nom); throw new Error("écriture interdite : " + nom); };
  return {
    row: { scopes: "", email: config.driveAccountEmail, expiry: Date.now() + 60_000, access_token: "x" },
    drive: {
      files: {
        list: async ({ q }) => {
          if (q.includes("name =")) return { data: { files: racines } };
          const id = /'([^']+)' in parents/.exec(q)?.[1];
          return { data: { files: ENFANTS[id] || [] } };
        },
        get: async ({ fileId }) => {
          const [name, mimeType] = NOMS[fileId] || [fileId, DOSSIER];
          return { data: { id: fileId, name, mimeType, parents: PARENTS[fileId] || [], trashed: false, webViewLink: `https://docs.google.com/document/d/${fileId}/edit` } };
        },
        create: interdit("files.create"),
        update: interdit("files.update"),
        delete: interdit("files.delete"),
        copy: interdit("files.copy"),
      },
      permissions: { create: interdit("permissions.create"), delete: interdit("permissions.delete") },
    },
    docs: {
      documents: {
        get: async ({ documentId }) => ({ data: { body: { content: [{ paragraph: { elements: [{ textRun: { content: TEXTES[documentId] ?? "" } }] } }] }, headers: {}, footers: {} } }),
        batchUpdate: interdit("documents.batchUpdate"),
      },
    },
  };
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
  await pool.query("INSERT INTO modeles_documents (nom, drive_file_id, portee, type_document, mode_generation) VALUES ('Convocation', 'FICHIER_CONVOC_01', 'session', 'convocation', 'manuel')");
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
  const convocation = r.corps.fichiers.find((f) => f.id === "FICHIER_CONVOC_01");
  assert.equal(convocation.emplacement, `${config.driveRacine} / Modèles`);
  assert.deepEqual(convocation.declarations.map((d) => [d.nom, d.portee, d.actif, d.type_document]), [["Convocation", "session", true, "convocation"]]);
  assert.deepEqual(r.corps.fichiers.find((f) => f.id === "FICHIER_EMARG_01").declarations, []);
  assert.deepEqual(await compter(), avant, "aucune écriture en base");
  assert.deepEqual(ecritures, [], "aucune écriture Drive");
});

test("diagnostic dans le périmètre : marqueurs par famille, classement, proposition non enregistrée", async () => {
  ecritures = [];
  const avant = await compter();
  setDriveFactory(() => clientSimule());
  const r = await api("POST", "/api/inventaire-drive/diagnostic", { drive_file_id: "FICHIER_CONVOC_01" }, A());
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.enregistre, false);
  assert.ok(r.corps.marqueurs.reconnus.includes("stagiaire_nom"));
  assert.ok(r.corps.marqueurs.historiques.includes("nom_stagiaire"), "alias historique à migrer");
  assert.equal(r.corps.classement.statut, "correction");
  assert.equal(r.corps.proposition.type_document, "convocation");
  assert.deepEqual(await compter(), avant);
  assert.deepEqual(ecritures, []);
});

test("diagnostic hors du dossier Vigie : refusé, sans analyse", async () => {
  ecritures = [];
  setDriveFactory(() => clientSimule());
  const r = await api("POST", "/api/inventaire-drive/diagnostic", { drive_file_id: "FICHIER_HORS_0001" }, A());
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, "fichier_hors_racine");
  assert.deepEqual(ecritures, []);
});

test("racine introuvable ou ambiguë : 409 explicite, jamais de création de dossier", async () => {
  ecritures = [];
  setDriveFactory(() => clientSimule({ racines: [] }));
  const aucune = await api("GET", "/api/inventaire-drive", undefined, A());
  assert.equal(aucune.statut, 409);
  assert.equal(aucune.corps.code, "racine_introuvable");
  setDriveFactory(() => clientSimule({ racines: [{ id: RACINE }, { id: "AUTRE_RACINE_01" }] }));
  assert.equal((await api("GET", "/api/inventaire-drive", undefined, A())).corps.code, "racine_introuvable");
  assert.deepEqual(ecritures, [], "aucun dossier créé");
});

test("identifiant invalide refusé avant tout appel Drive ; Drive absent : 503", async () => {
  setDriveFactory(() => clientSimule());
  assert.equal((await api("POST", "/api/inventaire-drive/diagnostic", { drive_file_id: "x'; --" }, A())).statut, 400);
  setDriveFactory(() => null);
  const liste = await api("GET", "/api/inventaire-drive", undefined, A());
  assert.equal(liste.statut, 503);
  assert.equal(liste.corps.code, "drive_indisponible");
});

test("erreur de lecture Drive pendant l'inventaire : 503 propre, rien d'exposé", async () => {
  const casse = clientSimule();
  const listeOrigine = casse.drive.files.list;
  casse.drive.files.list = async (args) => {
    if (!args.q.includes("name =")) throw Object.assign(new Error("secret interne jeton ya29"), { code: 500 });
    return listeOrigine(args);
  };
  setDriveFactory(() => casse);
  const r = await api("GET", "/api/inventaire-drive", undefined, A());
  assert.equal(r.statut, 503);
  assert.equal(JSON.stringify(r.corps).includes("ya29"), false);
});
