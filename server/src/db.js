import pg from "pg";
import { config } from "./config.js";

// Les colonnes DATE restent des chaînes « AAAA-MM-JJ » : node-postgres les
// convertirait sinon en Date à minuit LOCAL, et toISOString() donnerait la
// veille depuis Paris (même réglage que Vigie).
pg.types.setTypeParser(1082, (v) => v);

let pool = null;

export function getPool() {
  if (!pool) {
    const local = /localhost|127\.0\.0\.1|\.railway\.internal/.test(config.databaseUrl);
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: local ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export const query = (text, params) => getPool().query(text, params);

export async function closePool() {
  if (pool) await pool.end();
  pool = null;
}
