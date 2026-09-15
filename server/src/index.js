import { checkConfig, config } from "./config.js";
import { migrate } from "./migrate.js";
import { seedIfEmpty } from "./seed.js";
import { createApp } from "./app.js";

try {
  checkConfig();
  await migrate();
  await seedIfEmpty();
} catch (e) {
  console.error("Démarrage impossible : " + e.message);
  process.exit(1);
}

createApp().listen(config.port, () => console.log(`Vigie Qualiopi en ligne sur le port ${config.port} (Node ${process.version})`));
