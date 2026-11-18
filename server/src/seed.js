// Import du référentiel depuis un fichier JSON (par défaut le guide de
// lecture V9 officiel, server/seed/referentiel_qualiopi_v9_indicateurs.json).
// Idempotent : relancer ne crée pas de doublon.
//
// Vérification : un fichier est réputé avoir des libellés confrontés à une
// source officielle pertinente (décret ou guide de lecture), sauf s'il
// porte "provisoire": true (ou texte_source_verifie: false par indicateur).
// Un import provisoire ne réécrit JAMAIS une ligne déjà vérifiée ; un
// import vérifié, lui, met toujours à jour.
//
// `guide_de_lecture_disponible` (par version, distinct de la vérification
// du texte) : vrai par défaut — absent du fichier, une version est réputée
// disposer d'un guide complet, comme V9. À mettre à `false` explicitement
// pour une version dont seul le texte réglementaire est disponible (ex. un
// décret publié avant la parution de son guide de lecture).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db.js";

export const DEFAULT_SEED = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../seed/referentiel_qualiopi_v9_indicateurs.json"
);
// Référentiel V10 (décret n° 2026-728, en vigueur le 01/11/2026) : texte réglementaire seul.
export const SEED_V10 = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../seed/referentiel_qualiopi_v10.json"
);

const CATEGORIES = ["OF", "CFA", "CBC", "VAE"];
const GRADATIONS = ["mineure_ou_majeure", "majeure_uniquement"];

// Format du fichier → lignes prêtes pour la base.
export function normalizeReferentiel(data) {
  const verifie = data.provisoire !== true;
  return {
    version: {
      code: data.version,
      libelle: `${data.referentiel || "Référentiel national qualité"} — ${data.version}`,
      date_publication: data.date_version || null,
      date_application: data.date_entree_vigueur || data.date_application || null,
      source: data.source || null,
      note: data.note_v10 || data.note || null,
      guide_de_lecture_disponible: data.guide_de_lecture_disponible !== false,
      nb_indicateurs_attendu: data.nb_indicateurs ?? null,
    },
    nbAttendu: data.nb_indicateurs,
    criteres: (data.criteres || []).map((c) => ({ numero: c.numero, libelle: c.libelle })),
    indicateurs: (data.indicateurs || []).map((i) => ({
      numero: i.numero,
      critere: i.critere,
      libelle: (i.libelle || "").trim(),
      type: i.type || "commun",
      categories: i.categories || [],
      niveau_attendu: i.niveau_attendu ?? null,
      exemples_preuves: i.exemples_preuves || [],
      obligations_specifiques: i.obligations_specifiques || {},
      sous_traitance: i.sous_traitance ?? null,
      gradation: i.gradation ?? null,
      nouveaux_entrants_modalites_adaptees: i.nouveaux_entrants_modalites_adaptees ?? null,
      audit_initial_amenage: i.audit_initial_amenage ?? null,
      texte_source_verifie: typeof i.texte_source_verifie === "boolean" ? i.texte_source_verifie : verifie,
    })),
  };
}

export function validateReferentiel(ref) {
  const errors = [];
  if (!ref.version.code) errors.push("version manquante");
  const critNums = new Set(ref.criteres.map((c) => c.numero));
  if (critNums.size !== ref.criteres.length) errors.push("numéros de critères en double");
  const nums = ref.indicateurs.map((i) => i.numero);
  const attendu = ref.nbAttendu ?? nums.length;
  if (new Set(nums).size !== nums.length) errors.push("numéros d'indicateurs en double");
  if (nums.length !== attendu) errors.push(`${attendu} indicateurs annoncés, ${nums.length} trouvés`);
  for (let n = 1; n <= attendu; n++) if (!nums.includes(n)) errors.push(`indicateur ${n} absent`);
  for (const i of ref.indicateurs) {
    const where = `indicateur ${i.numero}`;
    if (!critNums.has(i.critere)) errors.push(`${where} : critère ${i.critere} inconnu`);
    if (!i.libelle) errors.push(`${where} : libellé vide`);
    if (!["commun", "specifique"].includes(i.type)) errors.push(`${where} : type « ${i.type} » inconnu`);
    for (const c of i.categories) if (!CATEGORIES.includes(c)) errors.push(`${where} : catégorie « ${c} » inconnue`);
    if (i.gradation !== null && !GRADATIONS.includes(i.gradation)) errors.push(`${where} : gradation « ${i.gradation} » inconnue`);
  }
  return errors;
}

export async function loadReferentielFile(file = DEFAULT_SEED) {
  const ref = normalizeReferentiel(JSON.parse(await fs.readFile(file, "utf8")));
  const errors = validateReferentiel(ref);
  if (errors.length) throw new Error("Référentiel invalide :\n - " + errors.join("\n - "));
  return ref;
}

export async function seedReferentiel(file = DEFAULT_SEED, { activate = true } = {}) {
  const ref = await loadReferentielFile(file);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const v = ref.version;
    const { rows: [version] } = await client.query(
      `INSERT INTO referentiel_versions (code, libelle, date_publication, source, note,
         guide_de_lecture_disponible, nb_indicateurs_attendu, date_application)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (code) DO UPDATE SET libelle = EXCLUDED.libelle,
         date_publication = EXCLUDED.date_publication, source = EXCLUDED.source, note = EXCLUDED.note,
         date_application = COALESCE(EXCLUDED.date_application, referentiel_versions.date_application),
         guide_de_lecture_disponible = EXCLUDED.guide_de_lecture_disponible,
         nb_indicateurs_attendu = EXCLUDED.nb_indicateurs_attendu
       RETURNING id`,
      [v.code, v.libelle, v.date_publication, v.source, v.note,
       v.guide_de_lecture_disponible, v.nb_indicateurs_attendu, v.date_application]
    );
    const critIds = {};
    for (const c of ref.criteres) {
      const { rows: [row] } = await client.query(
        `INSERT INTO criteres (version_id, numero, libelle) VALUES ($1, $2, $3)
         ON CONFLICT (version_id, numero) DO UPDATE SET libelle = EXCLUDED.libelle
         RETURNING id`,
        [version.id, c.numero, c.libelle]
      );
      critIds[c.numero] = row.id;
    }
    let written = 0;
    for (const i of ref.indicateurs) {
      const r = await client.query(
        `INSERT INTO indicateurs (version_id, critere_id, numero, libelle, type, categories, niveau_attendu,
           exemples_preuves, obligations_specifiques, sous_traitance, gradation,
           nouveaux_entrants_modalites_adaptees, audit_initial_amenage, texte_source_verifie)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (version_id, numero) DO UPDATE SET
           critere_id = EXCLUDED.critere_id, libelle = EXCLUDED.libelle, type = EXCLUDED.type,
           categories = EXCLUDED.categories, niveau_attendu = EXCLUDED.niveau_attendu,
           exemples_preuves = EXCLUDED.exemples_preuves,
           obligations_specifiques = EXCLUDED.obligations_specifiques,
           sous_traitance = EXCLUDED.sous_traitance, gradation = EXCLUDED.gradation,
           nouveaux_entrants_modalites_adaptees = EXCLUDED.nouveaux_entrants_modalites_adaptees,
           audit_initial_amenage = EXCLUDED.audit_initial_amenage,
           texte_source_verifie = EXCLUDED.texte_source_verifie
         WHERE EXCLUDED.texte_source_verifie OR NOT indicateurs.texte_source_verifie`,
        [version.id, critIds[i.critere], i.numero, i.libelle, i.type, i.categories, i.niveau_attendu,
         i.exemples_preuves, JSON.stringify(i.obligations_specifiques),
         i.sous_traitance === null ? null : JSON.stringify(i.sous_traitance), i.gradation,
         i.nouveaux_entrants_modalites_adaptees, i.audit_initial_amenage, i.texte_source_verifie]
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

// Au démarrage : met à disposition le référentiel V10, SANS l'activer. L'activation (et le
// report des preuves) reste une décision de l'administrateur, depuis Paramètres → Versions.
export async function seedVersionsEmbarquees(log = console.log) {
  const { rows } = await getPool().query("SELECT 1 FROM referentiel_versions WHERE code = 'V10'");
  if (rows.length) return null;
  const r = await seedReferentiel(SEED_V10, { activate: false });
  log(`Référentiel ${r.version} disponible (${r.indicateursEcrits} indicateurs), non activé.`);
  return r;
}
