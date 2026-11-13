// ─────────────────────────────────────────────────────────────
//  Lanceur de migrations sur une base de production déjà peuplée mais sans historique
//  (schema_migrations vide) : référence établie par signature, aucun rejeu de 001,
//  seules les migrations absentes sont appliquées. PostgreSQL réel.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { setPoolFactory } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { SIGNATURES } from "../src/signaturesMigrations.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(HERE, "../db/migrations");
const PORT = 55488;
const DATA = path.join(os.tmpdir(), "vq-migrations-reference-" + process.pid);
const silence = { log: () => {} };

let cluster, racine;

async function nouvelleBase(nom) {
  await racine.query(`CREATE DATABASE ${nom}`);
  return new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/${nom}`, ssl: false, max: 2 });
}

// Schéma de production : 001 à 025 appliquées à la main, hors lanceur (sauf exclusions).
async function schemaProduction(pool, { sauf = [] } = {}) {
  const fichiers = (await fs.readdir(MIGRATIONS)).filter((f) => /^0(0[1-9]|1[0-9]|2[0-5])_.+\.sql$/.test(f)).sort();
  for (const f of fichiers) {
    if (sauf.includes(f)) continue;
    await pool.query(await fs.readFile(path.join(MIGRATIONS, f), "utf8"));
  }
  // Table de suivi présente mais vide, comme constaté en production.
  await pool.query("CREATE TABLE schema_migrations (nom text PRIMARY KEY, applique_le timestamptz NOT NULL DEFAULT now())");
  await pool.query(`INSERT INTO modeles_documents (nom, drive_file_id, portee) VALUES ('Attestation réelle', 'PROD_ATTESTATION_1', 'stagiaire')`);
}

before(async () => {
  cluster = new EmbeddedPostgres({ databaseDir: DATA, port: PORT, user: "postgres", password: "postgres", persistent: false, onLog: () => {}, onError: () => {} });
  await cluster.initialise();
  await cluster.start();
  racine = cluster.getPgClient("postgres");
  await racine.connect();
});

after(async () => {
  setPoolFactory(null);
  if (racine) await racine.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
});

test("chaque fichier de migration a une signature (aucune référence impossible)", async () => {
  const fichiers = (await fs.readdir(MIGRATIONS)).filter((f) => /^\d+_.+\.sql$/.test(f));
  assert.deepEqual(fichiers.filter((f) => !SIGNATURES[f]), []);
});

test("base de production sans historique : référence établie, 001 jamais rejouée, seules 036 et 037 appliquées", async () => {
  const pool = await nouvelleBase("prod_complete");
  try {
    await schemaProduction(pool);
    setPoolFactory(() => pool);
    const appliquees = await migrate(silence);
    assert.deepEqual(appliquees, ["036_modeles_bibliotheque.sql", "037_modeles_typologie_unicite.sql"]);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM schema_migrations");
    assert.equal(rows[0].n, 27);
    const { rows: [m] } = await pool.query("SELECT nom, type_document, mode_generation FROM modeles_documents");
    assert.deepEqual(m, { nom: "Attestation réelle", type_document: "autre", mode_generation: "manuel" }, "donnée existante préservée");
    assert.deepEqual(await migrate(silence), [], "second démarrage : rien à faire");
  } finally {
    setPoolFactory(null);
    await pool.end();
  }
});

test("migration 007 absente en production : non enregistrée, puis appliquée normalement", async () => {
  const pool = await nouvelleBase("prod_sans_007");
  try {
    await schemaProduction(pool, { sauf: ["007_alertes_contraintes_souples.sql"] });
    setPoolFactory(() => pool);
    const appliquees = await migrate(silence);
    assert.deepEqual(appliquees, ["007_alertes_contraintes_souples.sql", "036_modeles_bibliotheque.sql", "037_modeles_typologie_unicite.sql"]);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conname IN ('preuves_check', 'preuves_check1')");
    assert.equal(rows[0].n, 0, "contraintes supprimées par l'application normale de 007");
  } finally {
    setPoolFactory(null);
    await pool.end();
  }
});

test("historique déjà renseigné : aucune référence par signature, comportement inchangé", async () => {
  const pool = await nouvelleBase("historique_present");
  try {
    setPoolFactory(() => pool);
    const toutes = await migrate(silence);
    assert.equal(toutes.length, 27, "base neuve : tout est appliqué normalement");
    assert.deepEqual(await migrate(silence), []);
  } finally {
    setPoolFactory(null);
    await pool.end();
  }
});

test("signature manquante : refus explicite, aucune migration rejouée ni enregistrée", async () => {
  const pool = await nouvelleBase("signature_absente");
  try {
    await schemaProduction(pool);
    setPoolFactory(() => pool);
    const incompletes = { ...SIGNATURES };
    delete incompletes["036_modeles_bibliotheque.sql"];
    await assert.rejects(migrate({ ...silence, signatures: incompletes }), /signature inconnue pour 036_modeles_bibliotheque\.sql/);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM schema_migrations");
    assert.equal(rows[0].n, 0, "rien enregistré");
  } finally {
    setPoolFactory(null);
    await pool.end();
  }
});
