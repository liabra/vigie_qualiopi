import pg from "pg";
import { config } from "./config.js";

// Les colonnes DATE restent des chaînes « AAAA-MM-JJ » : node-postgres les
// convertirait sinon en Date à minuit LOCAL, et toISOString() donnerait la
// veille depuis Paris (même réglage que Vigie).
pg.types.setTypeParser(1082, (v) => v);

let pool = null;

// Le MESSAGE seulement : jamais l'objet, qui peut porter la configuration de connexion.
export const surErreurPool = (e) =>
  console.error("PostgreSQL — connexion inactive perdue : " + (e?.message || "erreur inconnue"));
// Point d'injection (tests uniquement) : fabrique de pool de remplacement.
// Elle couvre les TRANSACTIONS comme les requêtes simples, là où
// setQueryExecutor ne couvre que `query()`. `null` rétablit le pool réel.
// Voir test/preuves.test.js.
let fabriquePool = null;

export function getPool() {
  if (fabriquePool) return fabriquePool();
  if (!pool) {
    const local = /localhost|127\.0\.0\.1|\.railway\.internal/.test(config.databaseUrl);
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: local ? false : { rejectUnauthorized: false },
    });
    // fix : une connexion INACTIVE coupée (redémarrage/maintenance PostgreSQL)
    // émet « error » sur le pool ; sans écouteur, Node ferait planter le
    // processus. Le pool écarte ce client et en recrée un à la demande.
    pool.on("error", surErreurPool);
  }
  return pool;
}

export function setPoolFactory(fn) {
  fabriquePool = fn || null;
}

// Point d'injection, utilisé UNIQUEMENT par les tests : il permet d'éprouver
// une route sans PostgreSQL (voir test/horaire.test.js). La production ne
// l'appelle jamais ; passer null rétablit le comportement normal.
let executer = (text, params) => getPool().query(text, params);

export const query = (text, params) => executer(text, params);

export function setQueryExecutor(fn) {
  executer = fn || ((text, params) => getPool().query(text, params));
}

export async function closePool() {
  if (pool) await pool.end();
  pool = null;
}
