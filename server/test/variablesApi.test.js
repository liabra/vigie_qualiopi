// ─────────────────────────────────────────────────────────────
//  GET /api/documents/variables : catalogue en lecture seule, réservé aux
//  utilisateurs connectés, aucune route d'écriture. Base PostgreSQL RÉELLE
//  et vierge. Données fictives.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";

import { setPoolFactory } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { createApp } from "../src/app.js";
import { encode } from "../src/session.js";
import { VARIABLES } from "../src/services/catalogueVariables.js";

const PORT = 55460; // distinct des autres fichiers (55445-55447, 55449-55459)
const DATA = path.join(os.tmpdir(), "vq-variables-" + process.pid);

let cluster, pool, serveur, origine, adminId, contribId;

before(async () => {
  cluster = new EmbeddedPostgres({ databaseDir: DATA, port: PORT, user: "postgres", password: "postgres", persistent: false, onLog: () => {}, onError: () => {} });
  await cluster.initialise();
  await cluster.start();
  const racine = cluster.getPgClient("postgres");
  await racine.connect();
  await racine.query("CREATE DATABASE vq");
  await racine.end();
  pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/vq`, ssl: false });
  setPoolFactory(() => pool);
  await migrate({ log: () => {} });
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@v.local', 'Admin', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@v.local', 'Contrib', 'contributeur') RETURNING id"));
  serveur = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});

after(async () => {
  setPoolFactory(null);
  if (serveur) await new Promise((r) => serveur.close(r));
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
  await fs.rm(DATA, { recursive: true, force: true }).catch(() => {});
});

const cookie = (uid) => ({ cookie: "vq_session=" + encode({ uid, exp: Date.now() + 60_000 }) });
const appel = async (methode, enTetes = {}, corps) => {
  const r = await fetch(origine + "/api/documents/variables", { method: methode, headers: { "content-type": "application/json", ...enTetes }, ...(corps ? { body: JSON.stringify(corps) } : {}) });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};

test("anonyme : 401, aucun catalogue renvoyé", async () => {
  const r = await appel("GET");
  assert.equal(r.statut, 401);
  assert.ok(!r.corps?.variables);
});

test("admin et contributeur : catalogue versionné complet en lecture", async () => {
  for (const uid of [adminId, contribId]) {
    const r = await appel("GET", cookie(uid));
    assert.equal(r.statut, 200);
    assert.equal(r.corps.version, "1.3");
    assert.equal(r.corps.variables.length, VARIABLES.length);
    assert.equal(r.corps.blocs.length, 9);
    assert.equal(r.corps.alias.prenom_stagiaire, "stagiaire_prenom");
    assert.ok(r.corps.historiques.lieu);
    assert.ok(r.corps.variables.every((v) => !Object.hasOwn(v, "obligatoire")));
  }
});

test("aucune écriture possible : les noms canoniques ne se renomment pas par l'API", async () => {
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
    const r = await appel(m, cookie(adminId), { nom: "stagiaire_prenom", renommer_en: "prenom" });
    assert.ok(r.statut === 404 || r.statut === 405, `${m} → ${r.statut}`);
  }
  const apres = await appel("GET", cookie(adminId));
  assert.ok(apres.corps.variables.some((v) => v.nom === "stagiaire_prenom"));
});
