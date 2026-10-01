// ─────────────────────────────────────────────────────────────
//  Q2-1 — Recueil du besoin et positionnement : migration 017, API,
//  droits, session archivée, appartenance du positionnement, listes
//  fermées, confidentialité, non-régression inscriptions / évaluations.
//  Base PostgreSQL RÉELLE et vierge + Express réelle.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";

import { setPoolFactory, setQueryExecutor } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { seedReferentiel } from "../src/seed.js";
import { createApp } from "../src/app.js";
import { encode } from "../src/session.js";
import { lireRecueil } from "../src/services/parcours.js";

const PORT = 55450; // distinct de transversal (55445 + 55446), qualite (55447), tableau de bord (55449)
const DATA = path.join(os.tmpdir(), "vq-parcours-" + process.pid);

let cluster, pool, serveur, origine, adminId, contribId;
let F = {};
const journal = [];

before(async () => {
  cluster = new EmbeddedPostgres({ databaseDir: DATA, port: PORT, user: "postgres", password: "postgres", persistent: false, onLog: () => {}, onError: () => {} });
  await cluster.initialise();
  await cluster.start();
  const racine = cluster.getPgClient("postgres");
  await racine.connect();
  await racine.query("CREATE DATABASE vq");
  await racine.end();
  pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/vq`, ssl: false });
  setPoolFactory(() => pool);
  setQueryExecutor((text, params) => pool.query(text, params));
  await migrate({ log: () => {} });
  await seedReferentiel();
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@p.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@p.local', 'Tukui', 'contributeur') RETURNING id"));
  // Les journaux serveur ne doivent jamais contenir les textes libres.
  for (const m of ["log", "info", "warn", "error"]) {
    const orig = console[m];
    console[m] = (...a) => { journal.push(a.map(String).join(" ")); orig.apply(console, a); };
  }
  serveur = createApp().listen(0);
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});

after(async () => {
  setPoolFactory(null);
  setQueryExecutor(null);
  if (serveur) await new Promise((r) => serveur.close(r));
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
  await fs.rm(DATA, { recursive: true, force: true }).catch(() => {});
});

const cookie = (uid) => "vq_session=" + encode({ uid, exp: Date.now() + 60_000 });
const A = () => ({ cookie: cookie(adminId) });
const C = () => ({ cookie: cookie(contribId) });
const api = async (methode, chemin, corps, enTetes = {}) => {
  const r = await fetch(origine + chemin, { method: methode, headers: { "content-type": "application/json", ...enTetes }, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};
const ok = (r) => { assert.ok(r.statut < 300, JSON.stringify(r.corps)); return r.corps; };
const SECRET_A = "Attentes-Confidentielles-XYZ";
const SECRET_O = "Objectifs-Confidentiels-XYZ";

test("préparation : formation, deux sessions, inscriptions, évaluations", async () => {
  const f = ok(await api("POST", "/api/formations", { intitule: "Aide à domicile", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation;
  F.session = ok(await api("POST", "/api/sessions", { formation_id: f.id, reference: "S-1", date_debut: "2026-09-01", date_fin: "2026-12-15" }, A())).session;
  F.archive = ok(await api("POST", "/api/sessions", { formation_id: f.id, reference: "S-ARCH", date_debut: "2025-01-01", date_fin: "2025-03-01" }, A())).session;
  for (const [n, p] of [["Martin", "Alice"], ["Bernard", "Paul"]]) ok(await api("POST", `/api/sessions/${F.session.id}/stagiaires`, { nom: n, prenom: p }, A()));
  ok(await api("POST", `/api/sessions/${F.archive.id}/stagiaires`, { nom: "Archive", prenom: "Zoé" }, A()));
  const det = ok(await api("GET", `/api/sessions/${F.session.id}`, undefined, A()));
  F.alice = det.stagiaires.find((s) => s.nom === "Martin").inscription_id;
  F.paul = det.stagiaires.find((s) => s.nom === "Bernard").inscription_id;
  F.zoe = ok(await api("GET", `/api/sessions/${F.archive.id}`, undefined, A())).stagiaires[0].inscription_id;
  const ev = async (inscription_id, type) => ok(await api("POST", `/api/sessions/${F.session.id}/evaluations`, { inscription_id, type, date_passage: "2026-09-02", intitule: `${type} test` }, A())).evaluation;
  F.posAlice = await ev(F.alice, "positionnement");
  F.posPaul = await ev(F.paul, "positionnement");
  F.qcmAlice = await ev(F.alice, "qcm");
});

test("migration 017 : table, unicité par inscription, listes fermées en base, textes bornés", async () => {
  const { rowCount } = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'recueils_besoin'");
  assert.equal(rowCount, 1);
  await pool.query("INSERT INTO recueils_besoin (inscription_id) VALUES ($1)", [F.paul]);
  await assert.rejects(pool.query("INSERT INTO recueils_besoin (inscription_id) VALUES ($1)", [F.paul]), "un seul recueil par inscription");
  await assert.rejects(pool.query("UPDATE recueils_besoin SET statut = 'bidon' WHERE inscription_id = $1", [F.paul]));
  await assert.rejects(pool.query("UPDATE recueils_besoin SET conclusion = 'bidon' WHERE inscription_id = $1", [F.paul]));
  await assert.rejects(pool.query("UPDATE recueils_besoin SET attentes = repeat('x', 2001) WHERE inscription_id = $1", [F.paul]));
  await pool.query("DELETE FROM recueils_besoin WHERE inscription_id = $1", [F.paul]);
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM recueils_besoin");
  assert.equal(n, 0, "aucun backfill : aucun recueil fabriqué");
});

test("service : listes fermées, date exigée si réalisé, textes bornés, rien d'inventé", () => {
  assert.match(lireRecueil({ statut: "bidon" }).erreur, /Statut/);
  assert.match(lireRecueil({ statut: "realise" }).erreur, /date/);
  assert.match(lireRecueil({ statut: "a_faire", prerequis_verifies: "peut-etre" }).erreur, /prérequis/);
  assert.match(lireRecueil({ statut: "a_faire", conclusion: "bidon" }).erreur, /Conclusion/);
  assert.match(lireRecueil({ statut: "a_faire", attentes: "x".repeat(2001) }).erreur, /trop long/);
  assert.ok(!lireRecueil({ statut: "a_faire", attentes: "x".repeat(2001) }).erreur.includes("xxx"), "jamais le texte dans l'erreur");
  assert.deepEqual(lireRecueil({ statut: "non_applicable" }).champs, { statut: "non_applicable", date_recueil: null, attentes: null, objectifs_personnels: null, prerequis_verifies: null, conclusion: null, positionnement_id: null });
});

test("parcours agrégé : une ligne par inscription, recueil absent identifiable, aucun texte libre", async () => {
  const r = ok(await api("GET", `/api/sessions/${F.session.id}/parcours`, undefined, C()));
  assert.equal(r.archivee, false);
  assert.deepEqual(r.inscriptions.map((i) => [i.nom, i.recueil_statut]), [["Bernard", null], ["Martin", null]], "recueil absent = null, pas de fausse date");
  assert.deepEqual(r.positionnements.map((p) => p.id).sort(), [F.posAlice.id, F.posPaul.id].sort(), "seuls les positionnements de la session");
  assert.ok(r.inscriptions.every((i) => !("attentes" in i) && !("objectifs_personnels" in i) && !("email" in i)));
});

test("création puis mise à jour (contributeur), positionnement de la même inscription, auteur", async () => {
  const corps = { statut: "realise", date_recueil: "2026-09-03", attentes: SECRET_A, objectifs_personnels: SECRET_O, prerequis_verifies: "partiel", conclusion: "parcours_adapte", positionnement_id: F.posAlice.id };
  const cree = ok(await api("PUT", `/api/inscriptions/${F.alice}/recueil`, corps, C()));
  assert.equal(cree.recueil.conclusion, "parcours_adapte");
  assert.equal(cree.recueil.positionnement_id, F.posAlice.id);
  const lu = ok(await api("GET", `/api/inscriptions/${F.alice}/recueil`, undefined, A()));
  assert.equal(lu.recueil.attentes, SECRET_A);
  assert.equal(lu.recueil.realise_par_nom, "Tukui");
  assert.deepEqual(lu.positionnements.map((p) => p.id), [F.posAlice.id], "positionnements sélectionnables : ceux de CETTE inscription");
  const maj = ok(await api("PUT", `/api/inscriptions/${F.alice}/recueil`, { ...corps, conclusion: "parcours_standard", prerequis_verifies: "oui" }, A()));
  assert.equal(maj.recueil.conclusion, "parcours_standard");
  const { rows } = await pool.query("SELECT count(*)::int AS n, max(realise_par) AS par FROM recueils_besoin WHERE inscription_id = $1", [F.alice]);
  assert.equal(rows[0].n, 1, "mise à jour, jamais de doublon");
  assert.equal(rows[0].par, contribId, "auteur initial du recueil conservé");
  const parc = ok(await api("GET", `/api/sessions/${F.session.id}/parcours`, undefined, A()));
  const l = parc.inscriptions.find((i) => i.inscription_id === F.alice);
  assert.deepEqual([l.recueil_statut, l.conclusion, l.positionnement_id], ["realise", "parcours_standard", F.posAlice.id]);
  assert.ok(!JSON.stringify(parc).includes(SECRET_A), "textes libres absents de la vue agrégée");
});

test("non applicable : sans date ni contenu", async () => {
  const r = ok(await api("PUT", `/api/inscriptions/${F.paul}/recueil`, { statut: "non_applicable" }, A()));
  assert.equal(r.recueil.statut, "non_applicable");
  assert.equal(r.recueil.date_recueil, null);
});

test("positionnement : autre inscription, mauvais type, inexistant ⇒ 400 sans écriture", async () => {
  const avant = (await pool.query("SELECT * FROM recueils_besoin WHERE inscription_id = $1", [F.paul])).rows[0];
  const base = { statut: "a_faire" };
  assert.equal((await api("PUT", `/api/inscriptions/${F.paul}/recueil`, { ...base, positionnement_id: F.posAlice.id }, A())).corps.error, "Ce positionnement concerne une autre inscription.");
  assert.equal((await api("PUT", `/api/inscriptions/${F.alice}/recueil`, { ...base, positionnement_id: F.qcmAlice.id }, A())).corps.error, "Ce résultat n'est pas un positionnement.");
  assert.equal((await api("PUT", `/api/inscriptions/${F.paul}/recueil`, { ...base, positionnement_id: 999999 }, A())).statut, 400);
  assert.equal((await api("PUT", `/api/inscriptions/${F.paul}/recueil`, { ...base, positionnement_id: "abc" }, A())).statut, 400);
  assert.deepEqual((await pool.query("SELECT * FROM recueils_besoin WHERE inscription_id = $1", [F.paul])).rows[0], avant, "aucune écriture");
});

test("droits : anonyme 401, lecture et écriture ouvertes au contributeur comme les inscriptions ; 404 / 400", async () => {
  assert.equal((await api("GET", `/api/sessions/${F.session.id}/parcours`)).statut, 401);
  assert.equal((await api("PUT", `/api/inscriptions/${F.paul}/recueil`, { statut: "a_faire" })).statut, 401);
  assert.equal((await api("GET", `/api/inscriptions/${F.paul}/recueil`, undefined, C())).statut, 200);
  assert.equal((await api("GET", "/api/inscriptions/999999/recueil", undefined, A())).statut, 404);
  assert.equal((await api("PUT", "/api/inscriptions/999999/recueil", { statut: "a_faire" }, A())).statut, 404);
  assert.equal((await api("GET", "/api/sessions/999999/parcours", undefined, A())).statut, 404);
  assert.equal((await api("PUT", "/api/inscriptions/abc/recueil", { statut: "a_faire" }, A())).statut, 400);
});

test("session archivée : lecture autorisée, écriture 409", async () => {
  await pool.query("UPDATE sessions SET archivee_le = now() WHERE id = $1", [F.archive.id]);
  const parc = ok(await api("GET", `/api/sessions/${F.archive.id}/parcours`, undefined, A()));
  assert.equal(parc.archivee, true);
  assert.equal(ok(await api("GET", `/api/inscriptions/${F.zoe}/recueil`, undefined, A())).archivee, true);
  assert.equal((await api("PUT", `/api/inscriptions/${F.zoe}/recueil`, { statut: "non_applicable" }, C())).statut, 409);
});

test("confidentialité : textes absents des journaux, de l'historique qualité et des marqueurs documentaires", async () => {
  assert.ok(!journal.join("\n").includes(SECRET_A) && !journal.join("\n").includes(SECRET_O), "journaux");
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM historique_qualite WHERE ancienne_valeur LIKE $1 OR nouvelle_valeur LIKE $1", [`%XYZ%`]);
  assert.equal(rows[0].n, 0);
  const { MARQUEURS } = await import("../src/services/marqueurs.js");
  assert.ok(!MARQUEURS.some((m) => /recueil|attente|objectif|positionnement|conclusion/.test(m)), "aucun marqueur documentaire ajouté");
});

test("non-régression : inscription, abandon et évaluations inchangés ; recueil non bloquant", async () => {
  const ab = ok(await api("PATCH", `/api/inscriptions/${F.paul}`, { statut: "abandon" }, C()));
  assert.equal(ab.inscription.statut, "abandon");
  assert.ok(ab.inscription.date_abandon, "date d'abandon posée comme avant");
  const evals = ok(await api("GET", `/api/sessions/${F.session.id}/evaluations`, undefined, A()));
  assert.equal(evals.agregation.total, 3, "évaluations intactes");
  ok(await api("POST", `/api/sessions/${F.session.id}/evaluations`, { inscription_id: F.paul, type: "evaluation_finale", date_passage: "2026-12-10" }, A()));
  const parc = ok(await api("GET", `/api/sessions/${F.session.id}/parcours`, undefined, A()));
  assert.equal(parc.inscriptions.find((i) => i.inscription_id === F.paul).statut_inscription, "abandon");
  const { rows: [{ is_nullable }] } = await pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_name='resultats_qcm' AND column_name='inscription_id'");
  assert.equal(is_nullable, "NO", "resultats_qcm inchangée");
});
