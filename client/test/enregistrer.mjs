// `node --import ./test/enregistrer.mjs` : active le chargeur JSX.
import { register } from "node:module";
register("./chargeur-jsx.mjs", import.meta.url);
