// Usage : npm run db:parametres-initiaux -- chemin/vers/parametres.json
// Fichier : { "organisme": { "nom": "…", "telephone": "…", … }, "signataires": [ { "nom": "…", "fonction": "…" } ] }
// Non destructif : ne remplace aucune valeur déjà saisie. À lancer UNE fois, par un administrateur.
import fs from "node:fs/promises";
import path from "node:path";
import { checkConfig } from "../config.js";
import { migrate } from "../migrate.js";
import { closePool } from "../db.js";
import { initialiserParametres } from "../services/parametresInitiaux.js";

try {
  if (!process.argv[2]) throw new Error("Indiquez le fichier JSON des paramètres initiaux.");
  checkConfig();
  await migrate();
  const donnees = JSON.parse(await fs.readFile(path.resolve(process.argv[2]), "utf8"));
  const b = await initialiserParametres(donnees);
  console.log(`Champs renseignés : ${b.champs_renseignes.join(", ") || "aucun"}.`);
  if (b.champs_deja_presents.length) console.log(`Déjà saisis (conservés) : ${b.champs_deja_presents.join(", ")}.`);
  console.log(`Signataires créés : ${b.signataires_crees.length} ; déjà présents : ${b.signataires_existants.length}.`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
