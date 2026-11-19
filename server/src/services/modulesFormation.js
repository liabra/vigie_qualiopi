// ─────────────────────────────────────────────────────────────
//  Séquence pédagogique : modules (C1…) et compétences/ateliers (AT01…) d'une version de formation (migration 054).
//  Règle de suivi des résultats A2C (grille « Indicateur de suivi et de résultat ») :
//   - un module est ACQUIS si au moins 50 % de ses compétences ÉVALUÉES sont « acquis » ; sinon « en cours » s'il
//     y a au moins une compétence en cours, sinon « pas acquis » ; aucune compétence évaluée = non évalué ;
//   - niveau du stagiaire selon la part de modules validés : au moins 80 % (4 à 5 sur 5) objectifs atteints,
//     au moins 40 % (2 à 3 sur 5) partiellement atteints, sinon non atteints.
//  Fonctions pures (lire / évaluer) + accès SQL paramétré.
// ─────────────────────────────────────────────────────────────
import { query } from "../db.js";

export const SEUIL_MODULE = 0.5;
export const MAX_MODULES = 50;
export const MAX_COMPETENCES_PAR_MODULE = 200;

const TEXTE = { titre: 280, objectif: 2000, support: 1000, modalite: 500, activites: 4000, ressources: 2000, indicateur: 2000 };

// Libellé stocké pour le stagiaire : « AT01 découvrir… » (code puis intitulé) — conserve la compatibilité avec la grille existante.
export const libelleCompetence = (c) => `${c.code} ${c.libelle}`.trim();

const texte = (v, max, nom, obligatoire = false) => {
  if (v === undefined || v === null || v === "") { if (obligatoire) throw new Error(`${nom} : valeur obligatoire.`); return null; }
  if (typeof v !== "string") throw new Error(`${nom} : texte attendu.`);
  const t = v.trim();
  if (!t) { if (obligatoire) throw new Error(`${nom} : valeur obligatoire.`); return null; }
  if (t.length > max) throw new Error(`${nom} : ${max} caractères au plus.`);
  return t;
};
const minutes = (v, nom) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100000) throw new Error(`${nom} : nombre entier de minutes attendu.`);
  return n;
};

// Valide et normalise la séquence saisie. Renvoie { modules } ou { erreur }.
export function lireModules(corps) {
  try {
    const liste = corps?.modules;
    if (!Array.isArray(liste)) throw new Error("Liste de modules attendue.");
    if (liste.length > MAX_MODULES) throw new Error("Trop de modules.");
    const codes = new Set(); const libelles = new Set();
    const modules = liste.map((m, i) => {
      if (!m || typeof m !== "object") throw new Error("Module invalide.");
      const code = texte(m.code, 20, "Code du module", true);
      if (codes.has(code)) throw new Error(`Code de module en double : ${code}.`);
      codes.add(code);
      if (!Array.isArray(m.competences ?? [])) throw new Error("Liste de compétences attendue.");
      const comps = m.competences ?? [];
      if (comps.length > MAX_COMPETENCES_PAR_MODULE) throw new Error("Trop de compétences dans un module.");
      const codesC = new Set();
      return {
        ordre: i + 1, code,
        intitule: texte(m.intitule, 300, "Intitulé du module", true),
        duree_minutes: minutes(m.duree_minutes, "Durée du module"),
        evaluation_minutes: minutes(m.evaluation_minutes, "Durée d'évaluation"),
        evaluation_objectif: texte(m.evaluation_objectif, 2000, "Objectif de l'évaluation"),
        competences: comps.map((c, j) => {
          if (!c || typeof c !== "object") throw new Error("Compétence invalide.");
          const cc = texte(c.code, 20, "Code de la compétence", true);
          if (codesC.has(cc)) throw new Error(`Code de compétence en double : ${cc}.`);
          codesC.add(cc);
          const libelle = texte(c.libelle, 280, "Intitulé de la compétence", true);
          const nom = `${cc} ${libelle}`;
          if (libelles.has(nom)) throw new Error(`Compétence en double : ${nom}.`);
          libelles.add(nom);
          return { ordre: j + 1, code: cc, libelle, duree_minutes: minutes(c.duree_minutes, "Durée de la compétence"),
            ...Object.fromEntries(Object.entries(TEXTE).map(([k, max]) => [k, texte(c[k], max, k)])) };
        }),
      };
    });
    return { modules };
  } catch (e) { return { erreur: e.message }; }
}

// Évalue un stagiaire. modules : [{ code, competences: [libellé…] }] ; statuts : Map libellé → statut saisi.
export function evaluerModules(modules, statuts) {
  const detail = modules.map((m) => {
    let acquis = 0; let evalue = 0; let enCours = 0;
    for (const lib of m.competences) {
      const s = statuts.get(lib);
      if (s === "acquis" || s === "en_cours" || s === "non_acquis") { evalue++; if (s === "acquis") acquis++; if (s === "en_cours") enCours++; }
    }
    let statut = null;
    if (evalue > 0) statut = acquis / evalue >= SEUIL_MODULE ? "acquis" : enCours > 0 ? "en_cours" : "non_acquis";
    return { code: m.code, statut, acquis, evalue };
  });
  const total = modules.length;
  const valides = detail.filter((d) => d.statut === "acquis").length;
  const evalues = detail.filter((d) => d.evalue > 0).length;
  let niveau = null;
  if (total > 0 && evalues > 0) niveau = valides * 5 >= total * 4 ? "atteints" : valides * 5 >= total * 2 ? "partiels" : "non_atteints";
  return { modules: detail, valides, total, niveau };
}

// Séquence d'une version, avec ses compétences (ordre de saisie).
export async function lireModulesVersion(versionId) {
  const { rows: modules } = await query(
    `SELECT id, ordre, code, intitule, duree_minutes, evaluation_minutes, evaluation_objectif
     FROM formation_modules WHERE formation_version_id = $1 ORDER BY ordre`, [versionId]);
  if (!modules.length) return [];
  const { rows: comps } = await query(
    `SELECT module_id, ordre, code, libelle, titre, duree_minutes, objectif, support, modalite, activites, ressources, indicateur
     FROM formation_competences WHERE module_id = ANY($1::int[]) ORDER BY module_id, ordre`, [modules.map((m) => m.id)]);
  return modules.map(({ id, ...m }) => ({ ...m, competences: comps.filter((c) => c.module_id === id).map(({ module_id, ...c }) => ({ ...c, libelle_complet: libelleCompetence(c) })) }));
}

// Remplace la séquence d'une version (dans une transaction ouverte par l'appelant).
export async function ecrireModules(cx, versionId, modules) {
  await cx.query("DELETE FROM formation_modules WHERE formation_version_id = $1", [versionId]);
  for (const m of modules) {
    const { rows: [{ id }] } = await cx.query(
      `INSERT INTO formation_modules (formation_version_id, ordre, code, intitule, duree_minutes, evaluation_minutes, evaluation_objectif)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [versionId, m.ordre, m.code, m.intitule, m.duree_minutes, m.evaluation_minutes, m.evaluation_objectif]);
    for (const c of m.competences) {
      await cx.query(
        `INSERT INTO formation_competences (module_id, ordre, code, libelle, titre, duree_minutes, objectif, support, modalite, activites, ressources, indicateur)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, c.ordre, c.code, c.libelle, c.titre, c.duree_minutes, c.objectif, c.support, c.modalite, c.activites, c.ressources, c.indicateur]);
    }
  }
}

// Nouvelle version de formation : la séquence de la précédente est reprise telle quelle.
export async function copierModules(cx, deVersionId, versionId) {
  const { rows: modules } = await cx.query("SELECT id FROM formation_modules WHERE formation_version_id = $1 ORDER BY ordre", [deVersionId]);
  for (const { id } of modules) {
    const { rows: [{ id: nouveau }] } = await cx.query(
      `INSERT INTO formation_modules (formation_version_id, ordre, code, intitule, duree_minutes, evaluation_minutes, evaluation_objectif)
       SELECT $2, ordre, code, intitule, duree_minutes, evaluation_minutes, evaluation_objectif FROM formation_modules WHERE id = $1 RETURNING id`, [id, versionId]);
    await cx.query(
      `INSERT INTO formation_competences (module_id, ordre, code, libelle, titre, duree_minutes, objectif, support, modalite, activites, ressources, indicateur)
       SELECT $2, ordre, code, libelle, titre, duree_minutes, objectif, support, modalite, activites, ressources, indicateur FROM formation_competences WHERE module_id = $1`, [id, nouveau]);
  }
}

// Modules d'une session (version de formation de la session) au format du calcul : [{ code, competences: [libellé] }].
export async function modulesDeSession(sessionId) {
  const { rows } = await query(
    `SELECT m.ordre AS module_ordre, m.code AS module_code, c.code, c.libelle
     FROM sessions s JOIN formation_modules m ON m.formation_version_id = s.formation_version_id
     LEFT JOIN formation_competences c ON c.module_id = m.id
     WHERE s.id = $1 ORDER BY m.ordre, c.ordre`, [sessionId]);
  return regrouper(rows);
}
export function regrouper(rows) {
  const parModule = new Map();
  for (const r of rows) {
    if (!parModule.has(r.module_code)) parModule.set(r.module_code, { code: r.module_code, competences: [] });
    if (r.code) parModule.get(r.module_code).competences.push(libelleCompetence(r));
  }
  return [...parModule.values()];
}
