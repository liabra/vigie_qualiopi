import { checkConfig } from "../config.js";
import { migrate } from "../migrate.js";
import { closePool } from "../db.js";

try {
  checkConfig();
  const applied = await migrate();
  console.log(applied.length ? `${applied.length} migration(s) appliquée(s).` : "Base déjà à jour.");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
