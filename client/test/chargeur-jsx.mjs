// Chargeur Node (tests uniquement) : transforme les fichiers .jsx avec
// esbuild (déjà utilisé par Vite) et remplace les feuilles .css par un
// module vide. Aucune autre transformation : le code testé est celui livré.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

export async function load(url, context, suivant) {
  if (url.endsWith(".css")) return { format: "module", source: "export default {};", shortCircuit: true };
  if (url.endsWith(".jsx")) {
    const chemin = fileURLToPath(url);
    const { code } = await transform(await readFile(chemin, "utf8"), {
      loader: "jsx", jsx: "automatic", format: "esm", sourcefile: chemin, sourcemap: "inline",
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return suivant(url, context);
}
