import { checkConfig, config } from "./config.js";
import { migrate } from "./migrate.js";
import { seedIfEmpty } from "./seed.js";
import { createApp } from "./app.js";
import { closePool } from "./db.js";
import { installerArretPropre } from "./arret.js";

try {
  checkConfig();
  const appliquees = await migrate();
  if (!appliquees.length) console.log("Migrations : base déjà à jour.");
  await seedIfEmpty();
} catch (e) {
  console.error("Démarrage impossible : " + e.message);
  process.exit(1);
}

const server = createApp().listen(config.port, () => console.log(`Vigie Qualiopi en ligne sur le port ${config.port} (Node ${process.version})`));
installerArretPropre(server, { closePool });
