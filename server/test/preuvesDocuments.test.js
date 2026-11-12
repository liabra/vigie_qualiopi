// ─────────────────────────────────────────────────────────────
//  Écran Preuves : documents liés dans les payloads (liste et détail), visibilité par rôle,
//  indicateur de revalidation ; recherche Drive avec requête littérale.
//  PostgreSQL réel, routes réelles, Drive SIMULÉ (lecture seule). Données fictives.
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
import { driveConforme } from "./helpers/driveConforme.js";

const PORT = 55471;
const DATA = path.join(os.tmpdir(), "vq-preuves-docs-" + process.pid);

let cluster, pool, serveur, origine, adminId, contribId, indicateur, session;
let driveActif = null;
let requetesDrive = [];

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

function driveSimule() {
  const d = driveConforme(() => ({ name: "Fiche.pdf", mimeType: "application/pdf" }));
  const resolutionRacine = d.files.list;
  d.files.list = async (args) => {
    if (!args.q.startsWith("name contains")) return resolutionRacine(args); // contrôles D-R : Drive conforme
    requetesDrive.push(args.q);
    return { data: { files: [{ id: "T1", name: "Trouvé.pdf", webViewLink: "https://drive.google.com/file/d/T1/view", mimeType: "application/pdf" }] } };
  };
  d.files.update = async () => { throw new Error("aucune écriture Drive attendue"); };
  return { drive: d, row: { scopes: "", email: "vigie@compte.test" } };
}

async function preuve(titre, { confidentielle = false } = {}) {
  const { rows: [p] } = await pool.query(
    "INSERT INTO preuves (indicateur_id, titre, statut, session_id, mode_fichiers) VALUES ($1, $2, 'maitrise', $3, 'multiple') RETURNING id",
    [indicateur, titre, session]
  );
  if (confidentielle) await pool.query("INSERT INTO preuves_confidentielles (preuve_id) VALUES ($1)", [p.id]);
  return p.id;
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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@pd.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@pd.local', 'Tukui', 'contributeur') RETURNING id"));
  indicateur = (await pool.query("SELECT i.id FROM indicateurs i ORDER BY i.id LIMIT 1")).rows[0].id;
  const { rows: [{ id: formation }] } = await pool.query("INSERT INTO formations (intitule) VALUES ('Formation PD') RETURNING id");
  ({ rows: [{ id: session }] } = await pool.query("INSERT INTO sessions (formation_id, reference, date_debut, date_fin) VALUES ($1, 'SESS-PD', '2026-01-05', '2026-03-05') RETURNING id", [formation]));
  setDriveFactory(() => driveActif);
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

test("liste et détail : chaque preuve porte ses documents, filtrés par rôle", async () => {
  driveActif = driveSimule();
  const publique = await preuve("Preuve publique");
  const confidentielle = await preuve("Preuve confidentielle", { confidentielle: true });

  const lienPublic = await api("POST", `/api/preuves/${publique}/documents`, { drive_file_id: "PD_PUB" }, A());
  assert.equal(lienPublic.statut, 200, JSON.stringify(lienPublic.corps));
  const lienConf = await api("POST", `/api/preuves/${confidentielle}/documents`, { drive_file_id: "PD_CONF" }, A());
  assert.equal(lienConf.statut, 200, JSON.stringify(lienConf.corps));

  const docPublic = (await pool.query("SELECT id FROM documents WHERE drive_file_id = 'PD_PUB'")).rows[0].id;
  const docConf = (await pool.query("SELECT id FROM documents WHERE drive_file_id = 'PD_CONF'")).rows[0].id;

  // Le contributeur voit la preuve publique avec son document, jamais la preuve confidentielle.
  const detailContrib = await api("GET", `/api/preuves/${publique}`, undefined, C());
  assert.equal(detailContrib.statut, 200);
  assert.deepEqual(detailContrib.corps.preuve.documents.map((d) => d.id), [docPublic]);
  assert.equal((await api("GET", `/api/preuves/${confidentielle}`, undefined, C())).statut, 404);

  const listeContrib = await api("GET", "/api/preuves", undefined, C());
  const ligneContrib = listeContrib.corps.preuves.find((p) => p.id === publique);
  assert.deepEqual(ligneContrib.documents.map((d) => d.id), [docPublic]);
  assert.equal(listeContrib.corps.preuves.some((p) => p.id === confidentielle), false);

  // L'administrateur voit tous les documents de chaque preuve.
  const listeAdmin = await api("GET", "/api/preuves", undefined, A());
  assert.deepEqual(listeAdmin.corps.preuves.find((p) => p.id === confidentielle).documents.map((d) => d.id), [docConf]);
});

test("revalidation : un remplacement rend le lien à revalider, jusqu'à sa revalidation", async () => {
  driveActif = driveSimule();
  const p = await preuve("Preuve à revalider");
  await api("POST", `/api/preuves/${p}/documents`, { drive_file_id: "PD_REV_1" }, A());
  const d = (await pool.query("SELECT id FROM documents WHERE drive_file_id = 'PD_REV_1'")).rows[0].id;
  const avant = await api("GET", `/api/preuves/${p}`, undefined, A());
  assert.equal(avant.corps.preuve.documents[0].a_revalider, false);

  const rempl = await api("POST", `/api/documents/${d}/remplacer`, { drive_file_id: "PD_REV_2", version_attendue: 1 }, A());
  assert.equal(rempl.statut, 200, JSON.stringify(rempl.corps));
  const apres = await api("GET", `/api/preuves/${p}`, undefined, A());
  assert.equal(apres.corps.preuve.documents[0].a_revalider, true, "lien à revalider après remplacement");
  assert.equal(apres.corps.preuve.documents[0].version_courante, 2);

  const revalidation = await api("POST", `/api/preuves/${p}/documents/${d}/revalider`, undefined, A());
  assert.equal(revalidation.statut, 200, JSON.stringify(revalidation.corps));
  const revalide = await api("GET", `/api/preuves/${p}`, undefined, A());
  assert.equal(revalide.corps.preuve.documents[0].a_revalider, false);
});

test("recherche Drive : la saisie reste un littéral, aucune modification de la requête", async () => {
  requetesDrive = [];
  driveActif = driveSimule();
  const r = await api("GET", "/api/drive/recherche?q=" + encodeURIComponent("a' or name contains 'b"), undefined, A());
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(requetesDrive.length, 1);
  assert.equal(requetesDrive[0], "name contains 'a\\' or name contains \\'b' and trashed = false");
  assert.deepEqual(r.corps.fichiers, [{ id: "T1", nom: "Trouvé.pdf", url: "https://drive.google.com/file/d/T1/view", mime: "application/pdf" }]);
});
