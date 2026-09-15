// Import du référentiel depuis un fichier JSON (par défaut la V9 fournie).
// Idempotent : relancer ne crée pas de doublon. Une ligne marquée
// texte_source_verifie = true n'est JAMAIS réécrite par le seed.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";

export const DEFAULT_SEED = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../db/seeds/referentiel_v9.json"
);

export function validateReferentiel(data) {
  const errors = [];
  if (!data?.version?.code) errors.push("version.code manquant");
  const crit = data?.criteres || [];
  const ind = data?.indicateurs || [];
  const critNums = new Set(crit.map((c) => c.numero));
  if (crit.length !== 7 || critNums.size !== 7) errors.push(`7 critères attendus, ${critNums.size} trouvés`);
  const nums = ind.map((i) => i.numero);
  if (ind.length !== 32 || new Set(nums).size !== 32) errors.push(`32 indicateurs distincts attendus, ${new Set(nums).size} trouvés`);
  for (let n = 1; n <= 32; n++) if (!nums.includes(n)) errors.push(`indicateur ${n} absent`);
  for (const i of ind) {
    if (!critNums.has(i.critere)) errors.push(`indicateur ${i.numero} : critère ${i.critere} inconnu`);
    if (!i.libelle?.trim()) errors.push(`indicateur ${i.numero} : libellé vide`);
  }
  return errors;
}

export async function seedReferentiel(file = DEFAULT_SEED, { activate = true } = {}) {
  const data = JSON.parse(await fs.readFile(file, "utf8"));
  const errors = validateReferentiel(data);
  if (errors.length) throw new Error("Référentiel invalide :\n - " + errors.join("\n - "));

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const v = data.version;
    const { rows: [version] } = await client.query(
      `INSERT INTO referentiel_versions (code, libelle, date_publication, date_application, source)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO UPDATE SET libelle = EXCLUDED.libelle,
         date_publication = COALESCE(EXCLUDED.date_publication, referentiel_versions.date_publication),
         date_application = COALESCE(EXCLUDED.date_application, referentiel_versions.date_application),
         source = COALESCE(EXCLUDED.source, referentiel_versions.source)
       RETURNING id`,
      [v.code, v.libelle, v.date_publication || null, v.date_application || null, v.source || null]
    );
    const critIds = {};
    for (const c of data.criteres) {
      const { rows: [row] } = await client.query(
        `INSERT INTO criteres (version_id, numero, libelle) VALUES ($1, $2, $3)
         ON CONFLICT (version_id, numero) DO UPDATE SET libelle = EXCLUDED.libelle
         RETURNING id`,
        [version.id, c.numero, c.libelle]
      );
      critIds[c.numero] = row.id;
    }
    let written = 0;
    for (const i of data.indicateurs) {
      const r = await client.query(
        `INSERT INTO indicateurs (version_id, critere_id, numero, libelle, niveau_attendu, elements_preuve,
           obligations_specifiques, precisions_guide, champ_application, applicable_nouvel_entrant,
           nc_mineure_possible, texte_source_verifie)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (version_id, numero) DO UPDATE SET
           critere_id = EXCLUDED.critere_id, libelle = EXCLUDED.libelle,
           niveau_attendu = EXCLUDED.niveau_attendu, elements_preuve = EXCLUDED.elements_preuve,
           obligations_specifiques = EXCLUDED.obligations_specifiques,
           precisions_guide = EXCLUDED.precisions_guide, champ_application = EXCLUDED.champ_application,
           applicable_nouvel_entrant = EXCLUDED.applicable_nouvel_entrant,
           nc_mineure_possible = EXCLUDED.nc_mineure_possible,
           texte_source_verifie = EXCLUDED.texte_source_verifie
         WHERE indicateurs.texte_source_verifie = false`,
        [version.id, critIds[i.critere], i.numero, i.libelle, i.niveau_attendu ?? null,
         i.elements_preuve ?? null, i.obligations_specifiques ?? null, i.precisions_guide ?? null,
         i.champ_application ?? [], i.applicable_nouvel_entrant ?? null,
         i.nc_mineure_possible ?? null, i.texte_source_verifie === true]
      );
      written += r.rowCount;
    }
    if (activate) {
      await client.query("UPDATE referentiel_versions SET est_active = false WHERE est_active AND id <> $1", [version.id]);
      await client.query("UPDATE referentiel_versions SET est_active = true WHERE id = $1", [version.id]);
    }
    await client.query("COMMIT");
    return { version: v.code, indicateursEcrits: written };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// Au démarrage : n'importe la V9 que si aucune version n'existe encore.
export async function seedIfEmpty(log = console.log) {
  const { rows } = await getPool().query("SELECT count(*)::int AS n FROM referentiel_versions");
  if (rows[0].n > 0) return null;
  const r = await seedReferentiel();
  log(`Référentiel ${r.version} importé (${r.indicateursEcrits} indicateurs).`);
  return r;
}
