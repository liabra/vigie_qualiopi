// ─────────────────────────────────────────────────────────────
//  Questionnaires de formation : routes réelles, PostgreSQL réel.
//  Administration (questions, ordre, archivage), réponses par inscription (contributeur),
//  instantané des questions, cloisonnement entre formations, session archivée.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import os from "node:os";
import path from "node:path";
import pg from "pg";

import { setPoolFactory, setQueryExecutor } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { seedReferentiel } from "../src/seed.js";
import { createApp } from "../src/app.js";
import { encode } from "../src/session.js";

const PORT = 55493;
const DATA = path.join(os.tmpdir(), "vq-questionnaires-routes-" + process.pid);

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
function ok(r, statut = [200, 201]) {
  assert.ok([].concat(statut).includes(r.statut), `${r.statut} ${JSON.stringify(r.corps)}`);
  return r.corps;
}

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
  await migrate({ log: () => {} });
  await seedReferentiel();
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@q.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@q.local', 'Tukui', 'contributeur') RETURNING id"));
  serveur = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;

  F.formation = ok(await api("POST", "/api/formations", { intitule: "Aide à domicile", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation.id;
  F.autre = ok(await api("POST", "/api/formations", { intitule: "Agent de propreté", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation.id;
  F.session = ok(await api("POST", "/api/sessions", { formation_id: F.formation, date_debut: "2026-12-01", date_fin: "2026-12-05" }, A())).session.id;
  F.inscription = ok(await api("POST", `/api/sessions/${F.session}/stagiaires`, { nom: "Alpha", prenom: "Ana" }, C())).inscription.id;
});

after(async () => {
  setPoolFactory(null);
  setQueryExecutor(null);
  if (serveur) await new Promise((r) => serveur.close(r));
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
});

test("formation sans questionnaire : réponse explicite, aucune saisie possible", async () => {
  const r = ok(await api("GET", `/api/inscriptions/${F.inscription}/questionnaire`, undefined, C()));
  assert.deepEqual([r.questionnaire, r.questions], [null, []]);
  assert.equal((await api("PUT", `/api/inscriptions/${F.inscription}/questionnaire/reponses`, { reponses: [] }, C())).statut, 400);
});

test("administration réservée ; première question crée le questionnaire ; validation", async () => {
  assert.equal((await api("POST", `/api/formations/${F.formation}/questionnaire/questions`, { libelle: "Objectif ?", type: "texte_libre" }, C())).statut, 403);
  assert.equal((await api("POST", `/api/formations/${F.formation}/questionnaire/questions`, { libelle: "Niveau ?", type: "choix_unique", options: ["Un"] }, A())).statut, 400);
  F.q1 = ok(await api("POST", `/api/formations/${F.formation}/questionnaire/questions`, { libelle: "Quel est votre objectif ?", type: "texte_libre", obligatoire: true }, A())).question;
  F.q2 = ok(await api("POST", `/api/formations/${F.formation}/questionnaire/questions`, { libelle: "Votre niveau ?", type: "choix_unique", options: ["Débutant", "Confirmé"] }, A())).question;
  F.q3 = ok(await api("POST", `/api/formations/${F.formation}/questionnaire/questions`, { libelle: "Déjà travaillé à domicile ?", type: "oui_non" }, A())).question;
  const g = ok(await api("GET", `/api/formations/${F.formation}/questionnaire`, undefined, A()));
  assert.equal(g.questionnaire.nom, "Questionnaire — Aide à domicile");
  assert.deepEqual(g.questions.map((q) => q.ordre), [1, 2, 3]);
});

test("réordonner : échange de positions, y compris avec une question archivée", async () => {
  ok(await api("DELETE", `/api/questionnaire-questions/${F.q2.id}`, undefined, A()));
  ok(await api("PUT", `/api/formations/${F.formation}/questionnaire/questions/ordre`, { ordre: [F.q3.id, F.q1.id] }, A()));
  let g = ok(await api("GET", `/api/formations/${F.formation}/questionnaire`, undefined, A()));
  assert.deepEqual(g.questions.filter((q) => !q.archivee).map((q) => q.id), [F.q3.id, F.q1.id]);
  ok(await api("POST", `/api/questionnaire-questions/${F.q2.id}/reactiver`, {}, A()));
  ok(await api("PUT", `/api/formations/${F.formation}/questionnaire/questions/ordre`, { ordre: [F.q1.id, F.q2.id, F.q3.id] }, A()));
  g = ok(await api("GET", `/api/formations/${F.formation}/questionnaire`, undefined, A()));
  assert.deepEqual(g.questions.map((q) => [q.id, q.ordre]), [[F.q1.id, 1], [F.q2.id, 2], [F.q3.id, 3]]);
  assert.equal((await api("PUT", `/api/formations/${F.formation}/questionnaire/questions/ordre`, { ordre: [F.q1.id] }, A())).statut, 400, "liste incomplète refusée");
});

test("réponses du contributeur : obligatoire contrôlé, instantané conservé après modification", async () => {
  const chemin = `/api/inscriptions/${F.inscription}/questionnaire/reponses`;
  assert.equal((await api("PUT", chemin, { reponses: [{ question_id: F.q1.id }] }, C())).statut, 400, "réponse obligatoire vide");
  assert.equal((await api("PUT", chemin, { reponses: [{ question_id: F.q2.id, valeurs_choisies: ["Expert"] }] }, C())).statut, 400, "option inconnue");
  ok(await api("PUT", chemin, { reponses: [
    { question_id: F.q1.id, valeur_texte: "Travailler auprès des personnes âgées" },
    { question_id: F.q2.id, valeurs_choisies: ["Débutant"] },
  ] }, C()));
  ok(await api("PATCH", `/api/questionnaire-questions/${F.q1.id}`, { libelle: "Votre projet professionnel ?", type: "texte_libre", obligatoire: true }, A()));
  const r = ok(await api("GET", `/api/inscriptions/${F.inscription}/questionnaire`, undefined, C()));
  const q1 = r.questions.find((q) => q.id === F.q1.id);
  assert.equal(q1.libelle, "Votre projet professionnel ?");
  assert.equal(q1.reponse.question_libelle, "Quel est votre objectif ?", "la réponse garde la question telle que posée");
  assert.equal(q1.reponse.valeur_texte, "Travailler auprès des personnes âgées");
});

test("cloisonnement : question d'une autre formation refusée", async () => {
  const etrangere = ok(await api("POST", `/api/formations/${F.autre}/questionnaire/questions`, { libelle: "Permis ?", type: "oui_non" }, A())).question;
  const r = await api("PUT", `/api/inscriptions/${F.inscription}/questionnaire/reponses`, { reponses: [{ question_id: etrangere.id, valeurs_choisies: ["oui"] }] }, C());
  assert.equal(r.statut, 400);
});

test("session archivée : lecture seule", async () => {
  ok(await api("PATCH", `/api/sessions/${F.session}/archive`, {}, A()));
  const r = ok(await api("GET", `/api/inscriptions/${F.inscription}/questionnaire`, undefined, C()));
  assert.equal(r.archivee, true);
  assert.equal((await api("PUT", `/api/inscriptions/${F.inscription}/questionnaire/reponses`, { reponses: [] }, C())).statut, 409);
});
