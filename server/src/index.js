import { checkConfig, config } from "./config.js";
import { migrate } from "./migrate.js";
import { seedIfEmpty, seedVersionsEmbarquees } from "./seed.js";
import { createApp } from "./app.js";
import { closePool } from "./db.js";
import { installerArretPropre } from "./arret.js";
import { demarrerGenerationsAutomatiques } from "./services/generationsAutomatiques.js";

try {
  checkConfig();
  const appliquees = await migrate();
  if (!appliquees.length) console.log("Migrations : base déjà à jour.");
  await seedIfEmpty();
  // Un échec de mise à disposition du V10 ne doit jamais empêcher le démarrage.
  await seedVersionsEmbarquees().catch((e) => console.error("Référentiel V10 non importé : " + e.message));
} catch (e) {
  console.error("Démarrage impossible : " + e.message);
  process.exit(1);
}

const server = createApp().listen(config.port, () => console.log(`Vigie Qualiopi en ligne sur le port ${config.port} (Node ${process.version})`));
installerArretPropre(server, { closePool });
// File des générations automatiques : traitée au démarrage, puis périodiquement et à chaque événement.
demarrerGenerationsAutomatiques();
