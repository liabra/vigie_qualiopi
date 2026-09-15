// Runner de migrations minimal : chaque fichier db/migrations/NNN_*.sql
// est appliqué une fois, dans l'ordre, dans sa propre transaction.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../db/migrations");
// Verrou consultatif : deux instances qui démarrent ensemble ne migrent pas en double.
const LOCK_ID = 7_202_609;

export async function migrate({ log = console.log } = {}) {
  const client = await getPool().connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      nom text PRIMARY KEY,
      applique_le timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set((await client.query("SELECT nom FROM schema_migrations")).rows.map((r) => r.nom));
    const files = (await fs.readdir(DIR)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
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
