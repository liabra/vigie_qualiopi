// Runner de migrations minimal : chaque fichier db/migrations/NNN_*.sql
// est appliqué une fois, dans l'ordre, dans sa propre transaction.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";
import { SIGNATURES } from "./signaturesMigrations.js";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../db/migrations");
// Verrou consultatif : deux instances qui démarrent ensemble ne migrent pas en double.
const LOCK_ID = 7_202_609;

// Base déjà peuplée (schéma appliqué hors du lanceur) mais sans historique : on établit la
// référence par signature au lieu de rejouer 001 sur des tables existantes. Une migration dont
// l'effet est présent est enregistrée ; une migration absente reste à appliquer normalement.
async function etablirReference(client, files, signatures, log) {
  const presentes = [];
  const absentes = [];
  for (const file of files) {
    const signature = signatures[file];
    if (!signature) {
      throw new Error(`Base existante sans historique de migrations : signature inconnue pour ${file}. Réconciliation manuelle requise, aucune migration rejouée.`);
    }
    const { rows: [r] } = await client.query(signature);
    (r?.ok ? presentes : absentes).push(file);
  }
  await client.query("BEGIN");
  try {
    for (const file of presentes) await client.query("INSERT INTO schema_migrations (nom) VALUES ($1)", [file]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw new Error(`Référence des migrations impossible : ${e.message}`);
  }
  log(`Référence des migrations établie sur base existante : ${presentes.length} enregistrée(s) sans rejeu` +
    (absentes.length ? `, à appliquer : ${absentes.join(", ")}` : "") + ".");
  return presentes;
}

export async function migrate({ log = console.log, signatures = SIGNATURES } = {}) {
  const client = await getPool().connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      nom text PRIMARY KEY,
      applique_le timestamptz NOT NULL DEFAULT now()
    )`);
    let done = new Set((await client.query("SELECT nom FROM schema_migrations")).rows.map((r) => r.nom));
    const files = (await fs.readdir(DIR)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    if (done.size === 0) {
      const { rows: [base] } = await client.query("SELECT to_regclass('public.referentiel_versions') IS NOT NULL AS peuplee");
      if (base.peuplee) done = new Set(await etablirReference(client, files, signatures, log));
    }
    const applied = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await fs.readFile(path.join(DIR, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (nom) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} échouée : ${e.message}`);
      }
      applied.push(file);
      log(`Migration appliquée : ${file}`);
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    client.release();
  }
}
