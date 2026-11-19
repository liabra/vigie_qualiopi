// ─────────────────────────────────────────────────────────────
//  Séquence pédagogique (modules / compétences) et règle de suivi des résultats à deux niveaux.
//  Parties pures + API et chargeur sur une base PostgreSQL RÉELLE. Données fictives.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { setPoolFactory } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { seedReferentiel } from "../src/seed.js";
import { createApp } from "../src/app.js";
import { encode } from "../src/session.js";
import { evaluerModules, lireModules, libelleCompetence } from "../src/services/modulesFormation.js";
import { calculerIndicateurs, chargerIndicateursSession } from "../src/services/indicateursSession.js";
import { competencesDeSession } from "../src/services/competencesStagiaire.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SEQUENCE = JSON.parse(await fs.readFile(path.join(ICI, "fixtures", "sequence_ateliers_numeriques.json"), "utf8"));

// ── Pur ──
test("séquence réelle (Ateliers numériques) : 5 modules, 23 compétences, durées cohérentes avec le programme", () => {
  const { modules, erreur } = lireModules(SEQUENCE);
  assert.equal(erreur, undefined);
  assert.deepEqual(modules.map((m) => m.competences.length), [6, 4, 5, 4, 4]);
  assert.equal(modules.reduce((n, m) => n + m.duree_minutes, 0), 1080, "18 h");
  for (const m of modules) assert.equal(m.competences.reduce((n, c) => n + c.duree_minutes, 0) + m.evaluation_minutes, m.duree_minutes, m.code);
  assert.equal(libelleCompetence(modules[0].competences[0]), "AT01 découvrir les différents outils numériques du quotidien (ordinateur, tablette, smartphone)");
});

test("lireModules : refuse doublons, types invalides, textes trop longs", () => {
  const m = (o = {}) => ({ modules: [{ code: "C1", intitule: "M", competences: [{ code: "AT01", libelle: "a" }], ...o }] });
  assert.ok(lireModules(m()).modules);
  assert.match(lireModules({}).erreur, /Liste de modules/);
  assert.match(lireModules({ modules: [m().modules[0], m().modules[0]] }).erreur, /double/);
  assert.match(lireModules(m({ competences: [{ code: "A", libelle: "x" }, { code: "A", libelle: "y" }] })).erreur, /double/);
  assert.match(lireModules(m({ duree_minutes: -1 })).erreur, /minutes/);
  assert.match(lireModules(m({ intitule: "x".repeat(301) })).erreur, /300/);
  assert.match(lireModules(m({ competences: [{ code: "A", libelle: "x", activites: 5 }] })).erreur, /texte/);
  assert.match(lireModules({ modules: [null] }).erreur, /invalide/);
});

const MODS = lireModules(SEQUENCE).modules.map((m) => ({ code: m.code, competences: m.competences.map(libelleCompetence) }));
const tous = (statut, codes) => new Map(MODS.filter((m) => codes.includes(m.code)).flatMap((m) => m.competences.map((c) => [c, statut])));

test("module : acquis dès 50 % des compétences évaluées acquises, sinon en cours ou pas acquis ; non évalué exclu", () => {
  const c1 = MODS[0].competences;
  const s = new Map([[c1[0], "acquis"], [c1[1], "acquis"], [c1[2], "acquis"], [c1[3], "non_acquis"], [c1[4], "non_acquis"], [c1[5], "non_acquis"]]); // 3/6 = 50 %
  assert.equal(evaluerModules(MODS, s).modules[0].statut, "acquis");
  s.set(c1[2], "en_cours");
  assert.equal(evaluerModules(MODS, s).modules[0].statut, "en_cours"); // 2/6, un AT en cours
  s.set(c1[2], "non_acquis");
  assert.equal(evaluerModules(MODS, s).modules[0].statut, "non_acquis");
  assert.equal(evaluerModules(MODS, new Map([[c1[0], "acquis"], [c1[1], "non_acquis"]])).modules[0].statut, "acquis", "1/2 évalués = 50 %");
  assert.equal(evaluerModules(MODS, new Map()).modules[0].statut, null);
});

test("niveau : 4 à 5 modules = atteints, 2 à 3 = partiels, 0 à 1 = non atteints (grille A2C)", () => {
  const niveau = (n) => evaluerModules(MODS, tous("acquis", MODS.slice(0, n).map((m) => m.code)).size ? new Map([...tous("acquis", MODS.slice(0, n).map((m) => m.code)), ...tous("non_acquis", MODS.slice(n).map((m) => m.code))]) : tous("non_acquis", MODS.map((m) => m.code))).niveau;
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(niveau), ["non_atteints", "non_atteints", "partiels", "partiels", "atteints", "atteints"]);
  assert.equal(evaluerModules(MODS, new Map()).niveau, null, "rien d'évalué : pas de niveau");
  assert.equal(evaluerModules([], new Map()).niveau, null);
});

test("indicateurs : règle à deux niveaux (3 modules sur 5 ≠ objectifs atteints) ; sans modules, repli sur 50 % global", () => {
  const ins = [{ id: 1, statut: "termine" }, { id: 2, statut: "termine" }];
  const lignes = (id, acquisModules, autres) => [
    ...MODS.filter((m) => acquisModules.includes(m.code)).flatMap((m) => m.competences.map((c) => ({ inscription_id: id, competence: c, statut: "acquis" }))),
    ...MODS.filter((m) => autres.includes(m.code)).flatMap((m) => m.competences.map((c) => ({ inscription_id: id, competence: c, statut: "non_acquis" }))),
  ];
  const competences = [...lignes(1, ["C1", "C2", "C3", "C4"], ["C5"]), ...lignes(2, ["C1", "C2", "C3"], ["C4", "C5"])];
  const r = calculerIndicateurs({ inscriptions: ins, competences, modules: MODS });
  assert.equal(r.reussites, 1); assert.equal(r.echecs, 1); assert.equal(r.partiels, 1); assert.equal(r.taux_atteinte, 50);
  // même données sans modules : 60 % des compétences pour le stagiaire 2 → atteint (ancienne règle), d'où l'importance des modules
  const sans = calculerIndicateurs({ inscriptions: ins, competences });
  assert.equal(sans.reussites, 2); assert.equal(sans.partiels, 0);
});

// ── Base réelle ──
const PORT = 55531;
const DATA = path.join(os.tmpdir(), "vq-modules-" + process.pid);
let cluster, pool, serveur, origine, adminId, redacteurId;

before(async () => {
  cluster = new EmbeddedPostgres({ databaseDir: DATA, port: PORT, user: "postgres", password: "postgres", persistent: false, onLog: () => {}, onError: () => {} });
  await cluster.initialise(); await cluster.start();
  const racine = cluster.getPgClient("postgres"); await racine.connect(); await racine.query("CREATE DATABASE vq"); await racine.end();
  pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/vq`, ssl: false });
  setPoolFactory(() => pool);
  await migrate({ log: () => {} }); await seedReferentiel();
  const u = async (email, role) => (await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ($1,'T',$2) RETURNING id", [email, role])).rows[0].id;
  adminId = await u("admin@m.local", "admin"); redacteurId = await u("red@m.local", "contributeur");
  serveur = createApp().listen(0, "127.0.0.1"); await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});
after(async () => {
  setPoolFactory(null);
  if (serveur) await new Promise((r) => serveur.close(r));
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
  await fs.rm(DATA, { recursive: true, force: true }).catch(() => {});
});
const cookie = (uid) => ({ cookie: "vq_session=" + encode({ uid, exp: Date.now() + 60_000 }), "content-type": "application/json" });
const appel = async (methode, url, uid, corps) => {
  const r = await fetch(origine + url, { method: methode, headers: cookie(uid), body: corps ? JSON.stringify(corps) : undefined });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};

test("API : enregistrer et relire la séquence ; réservé à l'administrateur ; entrée invalide refusée", async () => {
  const { rows: [f] } = await pool.query("INSERT INTO formations (intitule) VALUES ('Atelier fictif') RETURNING id");
  await pool.query("INSERT INTO formation_versions (formation_id, numero) VALUES ($1, 1)", [f.id]);
  assert.equal((await appel("PUT", `/api/formations/${f.id}/modules`, redacteurId, SEQUENCE)).statut, 403);
  assert.equal((await appel("PUT", `/api/formations/${f.id}/modules`, adminId, { modules: "x" })).statut, 400);
  const ok = await appel("PUT", `/api/formations/${f.id}/modules`, adminId, SEQUENCE);
  assert.equal(ok.statut, 200);
  assert.equal(ok.corps.modules.length, 5);
  const lu = await appel("GET", `/api/formations/${f.id}/modules`, redacteurId);
  assert.equal(lu.corps.modules[0].competences[0].titre, "Découverte des outils numériques");
  assert.equal((await appel("GET", "/api/formations/999999/modules", adminId)).statut, 404);
  global.__f = f.id;
});

test("session : compétences proposées = modules ; indicateurs sur base réelle à deux niveaux ; séquence verrouillée après saisie ; nouvelle version la reprend", async () => {
  const fid = global.__f;
  const { rows: [v] } = await pool.query("SELECT id FROM formation_versions WHERE formation_id = $1", [fid]);
  const { rows: [s] } = await pool.query("INSERT INTO sessions (formation_id, formation_version_id, reference, date_debut, date_fin, statut) VALUES ($1,$2,'S-MOD','2026-01-05','2026-02-05','terminee') RETURNING id", [fid, v.id]);
  const { rows: [st] } = await pool.query("INSERT INTO stagiaires (nom, prenom) VALUES ('Fictif','Un') RETURNING id");
  const { rows: [i] } = await pool.query("INSERT INTO inscriptions (stagiaire_id, session_id, statut) VALUES ($1,$2,'termine') RETURNING id", [st.id, s.id]);
  const liste = await competencesDeSession(s.id);
  assert.equal(liste.length, 23); assert.match(liste[0], /^AT01 /);
  // 3 modules acquis sur 5 → partiel, pas atteint
  for (const m of MODS) for (const c of m.competences) await pool.query("INSERT INTO competences_stagiaires (inscription_id, competence, statut) VALUES ($1,$2,$3)", [i.id, c, ["C1", "C2", "C3"].includes(m.code) ? "acquis" : "non_acquis"]);
  const r = await chargerIndicateursSession(s.id, 18);
  assert.equal(r.reussites, 0); assert.equal(r.echecs, 1); assert.equal(r.partiels, 1);
  // verrouillage
  assert.equal((await appel("PUT", `/api/formations/${fid}/modules`, adminId, SEQUENCE)).statut, 409);
  // nouvelle version : séquence reprise
  const nv = await appel("PUT", `/api/formations/${fid}`, adminId, { intitule: "Atelier fictif", duree_heures_defaut: 18 });
  assert.equal(nv.statut, 200);
  const lu = await appel("GET", `/api/formations/${fid}/modules`, adminId);
  assert.equal(lu.corps.version, 2); assert.equal(lu.corps.modules.length, 5); assert.equal(lu.corps.modules[4].competences.length, 4);
});
