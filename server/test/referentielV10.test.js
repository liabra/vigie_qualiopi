// ─────────────────────────────────────────────────────────────
//  Référentiel V10 (décret n° 2026-728) : mise à disposition au démarrage sans activation,
//  puis bascule V9 → V10 avec report des rattachements par numéro d'indicateur, et retour.
//  PostgreSQL réel.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import os from "node:os";
import path from "node:path";
import pg from "pg";

import { setPoolFactory, setQueryExecutor } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { seedIfEmpty, seedVersionsEmbarquees } from "../src/seed.js";
import { createApp } from "../src/app.js";
import { encode } from "../src/session.js";

const PORT = 55492;
const DATA = path.join(os.tmpdir(), "vq-referentiel-v10-" + process.pid);
const silence = () => {};

let cluster, pool, serveur, origine, adminId, contribId;
const F = {};

const cookie = (uid) => "vq_session=" + encode({ uid, exp: Date.now() + 60_000 });
const A = () => ({ cookie: cookie(adminId) });
const C = () => ({ cookie: cookie(contribId) });

async function api(methode, chemin, corps, enTetes = {}) {
  const r = await fetch(origine + chemin, {
    method: methode,
    headers: { "Content-Type": "application/json", ...enTetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}

const version = async (code) => (await pool.query("SELECT * FROM referentiel_versions WHERE code = $1", [code])).rows[0];
const indicateur = async (code, numero) => (await pool.query(
  "SELECT i.* FROM indicateurs i JOIN referentiel_versions v ON v.id = i.version_id WHERE v.code = $1 AND i.numero = $2", [code, numero]
)).rows[0];
const numeroDe = async (indicateurId) => (await pool.query(
  "SELECT v.code, i.numero FROM indicateurs i JOIN referentiel_versions v ON v.id = i.version_id WHERE i.id = $1", [indicateurId]
)).rows[0];

before(async () => {
  cluster = new EmbeddedPostgres({ databaseDir: DATA, port: PORT, user: "postgres", password: "postgres", persistent: false, onLog: () => {}, onError: () => {} });
  await cluster.initialise();
  await cluster.start();
  const racine = cluster.getPgClient("postgres");
  await racine.connect();
  await racine.query("CREATE DATABASE vq");
  await racine.end();
  pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/vq`, ssl: false, max: 8 });
  setPoolFactory(() => pool);
  setQueryExecutor((text, params) => pool.query(text, params));
  await migrate({ log: silence });
  await seedIfEmpty(silence); // démarrage d'une base neuve : V9 importée et active
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@v10.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@v10.local', 'Tukui', 'contributeur') RETURNING id"));
  serveur = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});

after(async () => {
  setPoolFactory(null);
  setQueryExecutor(null);
  if (serveur) await new Promise((r) => serveur.close(r));
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
});

test("démarrage : V10 mise à disposition, non activée, idempotente", async () => {
  const r = await seedVersionsEmbarquees(silence);
  assert.equal(r.version, "V10");
  assert.equal(await seedVersionsEmbarquees(silence), null, "second démarrage : rien à faire");
  const v10 = await version("V10");
  assert.equal(v10.est_active, false, "jamais activée automatiquement");
  assert.equal(v10.guide_de_lecture_disponible, false);
  assert.equal(v10.nb_indicateurs_attendu, 33);
  assert.equal(String(v10.date_application).slice(0, 10), "2026-11-01");
  assert.equal((await version("V9")).est_active, true, "V9 reste active");
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM indicateurs WHERE version_id = $1", [v10.id]);
  assert.equal(n, 33);
  const i33 = await indicateur("V10", 33);
  assert.match(i33.libelle, /dispositif d'évaluation des contenus et des enseignements/);
  assert.deepEqual(i33.categories, ["CFA"]);
});

test("rattachements existants sur V9 : preuves, modèle, veille, qualité, non applicable", async () => {
  const i5 = await indicateur("V9", 5);
  const i7 = await indicateur("V9", 7);
  const i30 = await indicateur("V9", 30);
  ({ rows: [{ id: F.preuve5 }] } = await pool.query("INSERT INTO preuves (indicateur_id, titre, type_alerte, periodicite_mois) VALUES ($1, 'Objectifs des formations', 'revision_periodique', 12) RETURNING id", [i5.id]));
  ({ rows: [{ id: F.preuve7 }] } = await pool.query("INSERT INTO preuves (indicateur_id, titre, type_alerte, periodicite_mois) VALUES ($1, 'Tableau croisé certification', 'revision_periodique', 12) RETURNING id", [i7.id]));
  ({ rows: [{ id: F.preuve30 }] } = await pool.query("INSERT INTO preuves (indicateur_id, titre, type_alerte, periodicite_mois) VALUES ($1, 'Questionnaires à chaud', 'revision_periodique', 12) RETURNING id", [i30.id]));
  const modele = await api("POST", "/api/modeles", { nom: "Questionnaire", lien: "MODELE_V10_000001", portee: "session", type_document: "questionnaire", mode_generation: "manuel", indicateurs: [30] }, A());
  assert.equal(modele.statut, 201, JSON.stringify(modele.corps));
  F.modele = modele.corps.modele.id;
  const veille = await api("POST", "/api/veille", { type: "autre", titre: "Décret 2026-728", date_publication: "2026-08-04", indicateur_ids: [i7.id] }, A());
  assert.equal(veille.statut, 201, JSON.stringify(veille.corps));
  F.veille = veille.corps.veille.id;
  assert.equal((await api("PATCH", `/api/indicateurs/${i7.id}/non-applicable`, { non_applicable: true, motif: "Aucune formation certifiante" }, A())).statut, 200);
});

test("bascule réservée à l'administrateur", async () => {
  const v10 = await version("V10");
  assert.equal((await api("POST", `/api/referentiel/versions/${v10.id}/activer`, { reporter: true }, C())).statut, 403);
  assert.equal((await version("V10")).est_active, false);
});

test("activation de V10 avec report : rattachements portés au même numéro, libellés modifiés à confirmer", async () => {
  const v10 = await version("V10");
  const r = await api("POST", `/api/referentiel/versions/${v10.id}/activer`, { reporter: true }, A());
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.bilan.preuves, 3);
  assert.equal(r.corps.bilan.preuves_a_confirmer, 2, "indicateurs 7 et 30 modifiés par le décret ; le 5 est inchangé");
  assert.equal(r.corps.bilan.indicateurs_correspondants, 32);
  assert.equal(r.corps.bilan.non_applicables, 1);

  const { rows: preuves } = await pool.query("SELECT id, indicateur_id, a_confirmer FROM preuves ORDER BY id");
  for (const p of preuves) assert.equal((await numeroDe(p.indicateur_id)).code, "V10");
  assert.deepEqual(preuves.map((p) => [p.id, p.a_confirmer]), [[F.preuve5, false], [F.preuve7, true], [F.preuve30, true]]);

  const { rows: [m] } = await pool.query("SELECT indicateur_id FROM modele_indicateurs WHERE modele_id = $1", [F.modele]);
  assert.deepEqual(await numeroDe(m.indicateur_id), { code: "V10", numero: 30 });
  const { rows: [vi] } = await pool.query("SELECT indicateur_id FROM veille_indicateurs WHERE veille_id = $1", [F.veille]);
  assert.deepEqual(await numeroDe(vi.indicateur_id), { code: "V10", numero: 7 });

  const ref = await api("GET", "/api/referentiel", undefined, C());
  assert.equal(ref.corps.version.code, "V10");
  assert.equal(ref.corps.totalIndicateurs, 33);
  assert.equal(ref.corps.version.guide_de_lecture_disponible, false);
  const tous = ref.corps.criteres.flatMap((c) => c.indicateurs);
  const i7 = tous.find((i) => i.numero === 7);
  assert.deepEqual([i7.statut, i7.non_applicable_motif, i7.nb_preuves], ["non_applicable", "Aucune formation certifiante", 1]);
  assert.equal(tous.find((i) => i.numero === 30).nb_a_confirmer, 1);
  assert.equal(tous.find((i) => i.numero === 33).statut, "a_risque", "nouvel indicateur : aucune preuve");

  const { rows: journal } = await pool.query("SELECT report, par, bilan FROM bascules_referentiel");
  assert.equal(journal.length, 1);
  assert.deepEqual([journal[0].report, journal[0].par, journal[0].bilan.preuves], [true, adminId, 3]);
  assert.equal((await api("POST", `/api/referentiel/versions/${v10.id}/activer`, { reporter: true }, A())).statut, 409, "déjà active");
});

test("retour à V9 avec report : rattachements ramenés, un ajout V10 sans équivalent reste sur V10", async () => {
  const i33 = await indicateur("V10", 33);
  const { rows: [{ id: preuve33 }] } = await pool.query("INSERT INTO preuves (indicateur_id, titre, type_alerte, periodicite_mois) VALUES ($1, 'Évaluation des enseignements', 'revision_periodique', 12) RETURNING id", [i33.id]);
  const v9 = await version("V9");
  const r = await api("POST", `/api/referentiel/versions/${v9.id}/activer`, { reporter: true }, A());
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.bilan.preuves, 3);
  const { rows } = await pool.query("SELECT id, indicateur_id FROM preuves ORDER BY id");
  const codes = Object.fromEntries(await Promise.all(rows.map(async (p) => [p.id, (await numeroDe(p.indicateur_id)).code])));
  assert.deepEqual([codes[F.preuve5], codes[F.preuve7], codes[F.preuve30], codes[preuve33]], ["V9", "V9", "V9", "V10"]);
});

test("activation sans report : les rattachements restent sur l'ancienne version", async () => {
  const v10 = await version("V10");
  const r = await api("POST", `/api/referentiel/versions/${v10.id}/activer`, {}, A());
  assert.equal(r.statut, 200);
  assert.equal(r.corps.bilan, null);
  const { rows: [p] } = await pool.query("SELECT indicateur_id FROM preuves WHERE id = $1", [F.preuve5]);
  assert.equal((await numeroDe(p.indicateur_id)).code, "V9");
  const { rows: [j] } = await pool.query("SELECT report FROM bascules_referentiel ORDER BY id DESC LIMIT 1");
  assert.equal(j.report, false);
});
