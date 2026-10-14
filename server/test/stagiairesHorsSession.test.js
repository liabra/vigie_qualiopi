// ─────────────────────────────────────────────────────────────
//  DOC-9B — Étape A : créer et retrouver un stagiaire HORS session
//  (préparation de l'entretien initial FSE-IA). Base PostgreSQL RÉELLE.
//
//  Couvert : création sans inscription, normalisation, validation,
//  recherche bornée, correspondances (email / nom+prénom) remontées sans
//  fusion ni refus, isolation des inscriptions, droits, non-régression
//  de POST /sessions/:id/stagiaires.
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

const PORT = 55462;
const DATA = path.join(os.tmpdir(), "vq-stag-hors-session-" + process.pid);

let cluster, pool, serveur, origine, adminId, contribId;

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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@h.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@h.local', 'Tukui', 'contributeur') RETURNING id"));
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

// ── Création hors session ────────────────────────────────────

test("création hors session : 201, identité normalisée, aucune inscription", async () => {
  const r = await api("POST", "/api/stagiaires", { civilite: "Mme", nom: "  DURAND ", prenom: "Élodie", email: "Elodie.DURAND@Exemple.FR", telephone: " 06 00 00 00 00 " }, C());
  assert.equal(r.statut, 201);
  const s = r.corps.stagiaire;
  assert.equal(s.nom, "DURAND", "nom rogné");
  assert.equal(s.prenom, "Élodie");
  assert.equal(s.email, "elodie.durand@exemple.fr", "email normalisé en minuscules");
  assert.equal(s.telephone, "06 00 00 00 00");
  // Aucun champ réservé ne doit apparaître pour un contributeur.
  assert.ok(!("situation_handicap" in s) && !("besoins_adaptation" in s));
  // Aucune inscription créée.
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM inscriptions");
  assert.equal(n, 0, "aucune inscription implicite");
});

test("création : nom et prénom obligatoires ; civilité et email validés", async () => {
  assert.equal((await api("POST", "/api/stagiaires", { prenom: "SansNom" }, A())).statut, 400);
  assert.equal((await api("POST", "/api/stagiaires", { nom: "SansPrenom" }, A())).statut, 400);
  assert.equal((await api("POST", "/api/stagiaires", { nom: "X", prenom: "Y", civilite: "Dr" }, A())).statut, 400);
  assert.equal((await api("POST", "/api/stagiaires", { nom: "X", prenom: "Y", email: "pas-un-email" }, A())).statut, 400);
});

// ── Recherche ────────────────────────────────────────────────

test("recherche : nom, prénom, email ; bornée ; paramètres validés", async () => {
  await api("POST", "/api/stagiaires", { nom: "Martin", prenom: "Alice", email: "alice.martin@exemple.fr" }, A());
  await api("POST", "/api/stagiaires", { nom: "Bernard", prenom: "Paul" }, A());

  const parNom = ok(await api("GET", "/api/stagiaires?q=Martin", undefined, A()));
  assert.equal(parNom.total, 1);
  assert.equal(parNom.stagiaires[0].prenom, "Alice");

  const parEmail = ok(await api("GET", "/api/stagiaires?q=alice.martin", undefined, A()));
  assert.equal(parEmail.total, 1);

  const vide = ok(await api("GET", "/api/stagiaires?q=zzz-inexistant", undefined, A()));
  assert.equal(vide.total, 0);

  assert.equal((await api("GET", "/api/stagiaires", undefined, A())).statut, 400, "q requis");
  assert.equal((await api("GET", "/api/stagiaires?q=a", undefined, A())).statut, 400, "trop court");

  // Projection minimale : ni téléphone, ni entreprise, ni handicap.
  const proj = parNom.stagiaires[0];
  assert.deepEqual(Object.keys(proj).sort(), ["civilite", "email", "id", "nom", "prenom"]);
});

// ── Correspondances (doublons potentiels) ────────────────────

test("correspondances : même email ou même nom+prénom remontées, jamais fusionnées ni refusées", async () => {
  const a = ok(await api("POST", "/api/stagiaires", { nom: "Lefebvre", prenom: "Noah", email: "noah@exemple.fr" }, A())).stagiaire;

  // Même email, nom différent → correspondance remontée, création quand même.
  const b = await api("POST", "/api/stagiaires", { nom: "Lefebvre", prenom: "Noah", email: "noah@exemple.fr" }, A());
  assert.equal(b.statut, 201);
  assert.ok(b.corps.correspondances.some((c) => c.id === a.id), "email partagé remonté");

  // Même nom+prénom, sans email → correspondance remontée.
  const c = await api("POST", "/api/stagiaires", { nom: "Lefebvre", prenom: "Noah" }, A());
  assert.equal(c.statut, 201);
  assert.ok(c.corps.correspondances.some((x) => x.id === a.id), "nom+prénom identique remonté");

  // Aucun doublon → correspondances vides.
  const d = await api("POST", "/api/stagiaires", { nom: "Unique", prenom: "SansHomonyme" }, A());
  assert.equal(d.statut, 201);
  assert.deepEqual(d.corps.correspondances, []);

  // Tous les stagiaires ont bien été créés (aucune fusion ni refus).
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM stagiaires WHERE nom = 'Lefebvre'");
  assert.equal(n, 3, "trois dossiers Lefebvre distincts conservés");
});

// ── Isolation des inscriptions ───────────────────────────────

test("isolation : aucune session, aucun effectif, aucun indicateur, aucun document modifié", async () => {
  const avantIndic = (await pool.query("SELECT count(*)::int AS n FROM indicateurs")).rows[0].n;
  const avantInscr = (await pool.query("SELECT count(*)::int AS n FROM inscriptions")).rows[0].n;

  await api("POST", "/api/stagiaires", { nom: "Iso", prenom: "Le", email: "iso.le@exemple.fr" }, A());

  const apresIndic = (await pool.query("SELECT count(*)::int AS n FROM indicateurs")).rows[0].n;
  const apresInscr = (await pool.query("SELECT count(*)::int AS n FROM inscriptions")).rows[0].n;
  const documents = (await pool.query("SELECT count(*)::int AS n FROM documents_generes")).rows[0].n;
  const evaluations = (await pool.query("SELECT count(*)::int AS n FROM resultats_qcm")).rows[0].n;

  assert.equal(apresInscr, avantInscr, "aucune inscription créée");
  assert.equal(apresIndic, avantIndic, "aucun indicateur modifié");
  assert.equal(documents, 0);
  assert.equal(evaluations, 0);
});

// ── Droits ───────────────────────────────────────────────────

test("droits : anonyme refusé ; contributeur et admin autorisés à créer", async () => {
  assert.equal((await api("GET", "/api/stagiaires?q=x", undefined)).statut, 401);
  assert.equal((await api("POST", "/api/stagiaires", { nom: "X", prenom: "Y" })).statut, 401);
  assert.equal((await api("POST", "/api/stagiaires", { nom: "Cont", prenom: "Trib" }, C())).statut, 201, "contributeur autorisé");
  assert.equal((await api("POST", "/api/stagiaires", { nom: "Adm", prenom: "Inist" }, A())).statut, 201, "admin autorisé");
});

// ── Non-régression : inscription classique ───────────────────

test("non-régression : POST /sessions/:id/stagiaires crée toujours stagiaire + inscription", async () => {
  const f = ok(await api("POST", "/api/formations", { intitule: "Formation de non-régression", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation;
  const s = ok(await api("POST", "/api/sessions", { formation_id: f.id, date_debut: "2026-01-05", date_fin: "2026-03-05" }, A())).session;
  const r = await api("POST", `/api/sessions/${s.id}/stagiaires`, { nom: "Stark", prenom: "Blandine" }, A());
  assert.equal(r.statut, 201);
  assert.ok(r.corps.inscription.id, "inscription créée");
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM inscriptions WHERE session_id = $1", [s.id]);
  assert.equal(n, 1);
});
