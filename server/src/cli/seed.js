// Usage : npm run db:seed [-- chemin/vers/referentiel.json]
import path from "node:path";
import { checkConfig } from "../config.js";
import { migrate } from "../migrate.js";
import { seedReferentiel, DEFAULT_SEED } from "../seed.js";
import { closePool } from "../db.js";

try {
  checkConfig();
  await migrate();
  const file = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SEED;
  const r = await seedReferentiel(file);
  console.log(`Référentiel ${r.version} : ${r.indicateursEcrits} indicateur(s) écrit(s) depuis ${file}.`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
