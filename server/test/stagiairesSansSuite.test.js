// ─────────────────────────────────────────────────────────────
//  DOC-9C bis — Jeunes non inscrits : état « Sans suite », réouverture
//  et suppression sécurisée. Base PostgreSQL RÉELLE + Express réelle.
//
//  Couvert : classement sans suite (et refus si inscrit), réouverture,
//  suppression autorisée (cascade cohérente entretiens/réponses) et
//  refusée (inscription, preuve), droits, accès anonyme.
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

const PORT = 55466;
const DATA = path.join(os.tmpdir(), "vq-sans-suite-" + process.pid);

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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@ss.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@ss.local', 'Tukui', 'contributeur') RETURNING id"));
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

async function creerStagiaire(nom = "Durand", prenom = "Élodie") {
  return ok(await api("POST", "/api/stagiaires", { nom, prenom, email: `${nom.toLowerCase()}.${prenom.toLowerCase()}@exemple.fr` }, A())).stagiaire;
}

// ── Migration ────────────────────────────────────────────────

test("migration 027 : colonnes sans_suite_le / sans_suite_par présentes", async () => {
  const { rows } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'stagiaires' AND column_name IN ('sans_suite_le', 'sans_suite_par')");
  assert.equal(rows.length, 2);
});

// ── Sans suite / réouverture ─────────────────────────────────

test("classer sans suite puis rouvrir : réversible, sans toucher aux inscriptions", async () => {
  const st = await creerStagiaire("Lefebvre", "Noah");

  const ss = await api("POST", `/api/stagiaires/${st.id}/sans-suite`, undefined, C());
  assert.equal(ss.statut, 200);
  assert.ok(ss.corps.stagiaire.sans_suite_le, "date de classement posée");

  const rou = await api("POST", `/api/stagiaires/${st.id}/rouvrir`, undefined, C());
  assert.equal(rou.statut, 200);
  assert.equal(rou.corps.stagiaire.sans_suite_le, null, "rouvert = sans_suite_le NULL");
});

test("classer sans suite refusé pour une personne inscrite (409)", async () => {
  const st = await creerStagiaire("Martin", "Alice");
  const f = ok(await api("POST", "/api/formations", { intitule: "Formation SS", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation;
  const s = ok(await api("POST", "/api/sessions", { formation_id: f.id, date_debut: "2026-01-05", date_fin: "2026-03-05" }, A())).session;
  await api("POST", `/api/sessions/${s.id}/stagiaires`, { stagiaire_id: st.id }, A());

  const ss = await api("POST", `/api/stagiaires/${st.id}/sans-suite`, undefined, A());
  assert.equal(ss.statut, 409);
  assert.match(ss.corps.error, /inscriptions/);
});

// ── Suppression définitive ───────────────────────────────────

test("suppression autorisée : cascade cohérente des entretiens et réponses, sans orphelin", async () => {
  const st = await creerStagiaire("Unique", "SansSuite");
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;
  ok(await api("PUT", `/api/entretiens/${e.id}/reponses`, { version: 1, reponses: [{ cle: "motif_venue", valeur: "Test" }] }, A()));

  const d = await api("DELETE", `/api/stagiaires/${st.id}`, undefined, A());
  assert.equal(d.statut, 200);

  assert.equal((await pool.query("SELECT 1 FROM stagiaires WHERE id = $1", [st.id])).rowCount, 0);
  assert.equal((await pool.query("SELECT 1 FROM entretiens WHERE stagiaire_id = $1", [st.id])).rowCount, 0);
  assert.equal((await pool.query("SELECT 1 FROM entretien_reponses WHERE entretien_id = $1", [e.id])).rowCount, 0);
});

test("suppression refusée avec une inscription (409)", async () => {
  const st = await creerStagiaire("Inscrit", "Bloc");
  const f = ok(await api("POST", "/api/formations", { intitule: "Formation bloc", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation;
  const s = ok(await api("POST", "/api/sessions", { formation_id: f.id, date_debut: "2026-01-05", date_fin: "2026-03-05" }, A())).session;
  await api("POST", `/api/sessions/${s.id}/stagiaires`, { stagiaire_id: st.id }, A());

  const d = await api("DELETE", `/api/stagiaires/${st.id}`, undefined, A());
  assert.equal(d.statut, 409);
  assert.equal((await pool.query("SELECT 1 FROM stagiaires WHERE id = $1", [st.id])).rowCount, 1);
});

test("suppression refusée avec une preuve rattachée (409)", async () => {
  const st = await creerStagiaire("Preuve", "Bloc");
  const { rows: [{ id: indicateurId }] } = await pool.query("SELECT id FROM indicateurs LIMIT 1");
  const { rows: [preuve] } = await pool.query(
    "INSERT INTO preuves (indicateur_id, titre, type_alerte) VALUES ($1, 'Preuve', 'revision_periodique') RETURNING id",
    [indicateurId]);
  await pool.query(
    "INSERT INTO preuve_fichiers (preuve_id, drive_file_id, stagiaire_id) VALUES ($1, 'fichier-test', $2)",
    [preuve.id, st.id]);

  const d = await api("DELETE", `/api/stagiaires/${st.id}`, undefined, A());
  assert.equal(d.statut, 409);
  assert.match(d.corps.error, /preuve/);
  assert.equal((await pool.query("SELECT 1 FROM stagiaires WHERE id = $1", [st.id])).rowCount, 1, "stagiaire conservé");
  assert.equal((await pool.query("SELECT 1 FROM preuve_fichiers WHERE stagiaire_id = $1", [st.id])).rowCount, 1, "fichier de preuve intact");
});

test("suppression d'un stagiaire inexistant : 404", async () => {
  assert.equal((await api("DELETE", "/api/stagiaires/999999", undefined, A())).statut, 404);
});

// ── Droits ───────────────────────────────────────────────────

test("droits : contributeur classe/rouvre mais ne supprime pas ; anonyme refusé", async () => {
  const st = await creerStagiaire("Droits", "SS");

  assert.equal((await api("POST", `/api/stagiaires/${st.id}/sans-suite`, undefined)).statut, 401);
  assert.equal((await api("DELETE", `/api/stagiaires/${st.id}`, undefined)).statut, 401);

  // Contributeur : sans suite + réouverture autorisés, suppression refusée.
  assert.equal((await api("POST", `/api/stagiaires/${st.id}/sans-suite`, undefined, C())).statut, 200);
  assert.equal((await api("DELETE", `/api/stagiaires/${st.id}`, undefined, C())).statut, 403, "suppression réservée admin");
  assert.equal((await api("POST", `/api/stagiaires/${st.id}/rouvrir`, undefined, C())).statut, 200);
});

// ── Concurrence ──────────────────────────────────────────────

// Le cas critique : une inscription est créée PENDANT la suppression. Sans le
// verrou (SELECT ... FOR UPDATE), le DELETE cascade détruirait cette
// inscription (inscriptions.stagiaire_id = ON DELETE CASCADE). Avec le verrou,
// l'insertion concurrente est bloquée par la clé étrangère, puis échoue une
// fois la suppression committée : aucune donnée protégée n'est détruite.
test("concurrence : une inscription créée pendant la suppression est bloquée puis échoue (pas de cascade)", async () => {
  const st = await creerStagiaire("Race", "Cascade");
  const f = ok(await api("POST", "/api/formations", { intitule: "Formation cascade", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation;
  const s = ok(await api("POST", "/api/sessions", { formation_id: f.id, date_debut: "2026-01-05", date_fin: "2026-03-05" }, A())).session;

  // Connexion dédiée simulant la transaction de la route DELETE :
  // SELECT ... FOR UPDATE, vérification (0 inscription), DELETE, COMMIT.
  const cx = await pool.connect();
  await cx.query("BEGIN");
  await cx.query("SELECT id FROM stagiaires WHERE id = $1 FOR UPDATE", [st.id]);
  const { rows: [{ n }] } = await cx.query("SELECT count(*)::int AS n FROM inscriptions WHERE stagiaire_id = $1", [st.id]);
  assert.equal(n, 0, "aucune inscription au moment du contrôle");

  // L'insertion concurrente est lancée PENDANT que le verrou est tenu : elle
  // attend la clé étrangère.
  const insertion = pool.query(
    "INSERT INTO inscriptions (stagiaire_id, session_id) VALUES ($1, $2)",
    [st.id, s.id]
  );

  // La suppression se poursuit et committe pendant que l'insertion attend.
  await cx.query("DELETE FROM stagiaires WHERE id = $1", [st.id]);
  await cx.query("COMMIT");
  cx.release();

  // Après libération, l'insertion échoue par violation de clé étrangère :
  // l'inscription n'est PAS créée (et n'a donc pas été détruite en cascade).
  await assert.rejects(insertion, /foreign key|violates|23503/i);

  const { rows: [{ reste }] } = await pool.query("SELECT count(*)::int AS reste FROM inscriptions WHERE stagiaire_id = $1", [st.id]);
  assert.equal(reste, 0, "aucune inscription résiduelle");
  assert.equal((await pool.query("SELECT 1 FROM stagiaires WHERE id = $1", [st.id])).rowCount, 0, "stagiaire supprimé");
});
