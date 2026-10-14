// ─────────────────────────────────────────────────────────────
//  FORM-1 — Archivage, réactivation et suppression sécurisée des
//  formations. Base PostgreSQL RÉELLE + Express réelle.
//
//  Couvert :
//   · archivage / réactivation (bascule du seul champ `actif`, SANS
//     nouvelle version pédagogique) ;
//   · création de session refusée sur une formation inactive ;
//   · sessions historiques intactes après archivage ;
//   · suppression autorisée sans dépendance, refusée dès qu'une session,
//     une preuve, un signalement ou une action qualité existe ;
//   · droits : réservé à l'admin.
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

const PORT = 55460;
const DATA = path.join(os.tmpdir(), "vq-formations-" + process.pid);

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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@form.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@form.local', 'Tukui', 'contributeur') RETURNING id"));
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

async function creerFormation(intitule) {
  return ok(await api("POST", "/api/formations", { intitule, duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation;
}
async function nbVersions(id) {
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM formation_versions WHERE formation_id = $1", [id]);
  return n;
}

// ── Archivage / réactivation ─────────────────────────────────

test("archivage : bascule actif=false sans créer de nouvelle version ; réactivation inverse", async () => {
  const f = await creerFormation("Archivage A");
  assert.equal(await nbVersions(f.id), 1);

  const a = await api("PATCH", `/api/formations/${f.id}/actif`, { actif: false }, A());
  assert.equal(a.statut, 200);
  assert.equal(a.corps.actif, false);
  assert.equal(await nbVersions(f.id), 1, "archiver ne crée aucune version");

  const { rows: [{ actif }] } = await pool.query("SELECT actif FROM formations WHERE id = $1", [f.id]);
  assert.equal(actif, false);

  const r = await api("PATCH", `/api/formations/${f.id}/actif`, { actif: true }, A());
  assert.equal(r.statut, 200);
  assert.equal(r.corps.actif, true);
  assert.equal(await nbVersions(f.id), 1, "réactiver ne crée aucune version");
});

test("archivage : champ actif invalide refusé (400) ; formation absente (404)", async () => {
  const f = await creerFormation("Archivage B");
  assert.equal((await api("PATCH", `/api/formations/${f.id}/actif`, { actif: "oui" }, A())).statut, 400);
  assert.equal((await api("PATCH", "/api/formations/999999/actif", { actif: false }, A())).statut, 404);
});

test("création de session refusée sur formation inactive ; autorisée une fois réactivée", async () => {
  const f = await creerFormation("Inactive Session");
  await api("PATCH", `/api/formations/${f.id}/actif`, { actif: false }, A());

  const refus = await api("POST", "/api/sessions", { formation_id: f.id, date_debut: "2026-01-05", date_fin: "2026-03-05" }, A());
  assert.equal(refus.statut, 400);
  assert.match(refus.corps.error, /archivée/);

  await api("PATCH", `/api/formations/${f.id}/actif`, { actif: true }, A());
  const s = await api("POST", "/api/sessions", { formation_id: f.id, date_debut: "2026-01-05", date_fin: "2026-03-05" }, A());
  assert.equal(s.statut, 201);
});

test("archivage : les sessions historiques restent intactes et lisibles", async () => {
  const f = await creerFormation("Sessions Historiques");
  const s = ok(await api("POST", "/api/sessions", { formation_id: f.id, reference: "S-HIST", date_debut: "2026-01-05", date_fin: "2026-03-05" }, A())).session;
  await api("PATCH", `/api/formations/${f.id}/actif`, { actif: false }, A());

  const relu = await api("GET", `/api/sessions/${s.id}`, undefined, A());
  assert.equal(relu.statut, 200, "session historique toujours lisible");
  assert.equal(relu.corps.session.reference, "S-HIST");
});

// ── Suppression définitive ───────────────────────────────────

test("suppression autorisée pour une formation sans dépendance", async () => {
  const f = await creerFormation("À supprimer");
  const d = await api("DELETE", `/api/formations/${f.id}`, undefined, A());
  assert.equal(d.statut, 200);
  const { rowCount } = await pool.query("SELECT 1 FROM formations WHERE id = $1", [f.id]);
  assert.equal(rowCount, 0, "formation supprimée");
  // Les versions pédagogiques partent en cascade, sans toucher au référentiel.
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM formation_versions WHERE formation_id = $1", [f.id]);
  assert.equal(n, 0);
});

test("suppression bloquée avec une session (409)", async () => {
  const f = await creerFormation("Utilisée Session");
  await api("POST", "/api/sessions", { formation_id: f.id, date_debut: "2026-01-05", date_fin: "2026-03-05" }, A());
  const d = await api("DELETE", `/api/formations/${f.id}`, undefined, A());
  assert.equal(d.statut, 409);
  assert.match(d.corps.error, /session/);
  assert.equal((await pool.query("SELECT 1 FROM formations WHERE id = $1", [f.id])).rowCount, 1);
});

test("suppression bloquée avec une preuve, un signalement ou une action qualité (409)", async () => {
  const { rows: [{ id: indicateurId }] } = await pool.query("SELECT id FROM indicateurs LIMIT 1");
  const cas = [
    ["preuve", (fid) => pool.query("INSERT INTO preuves (indicateur_id, formation_id, titre, type_alerte) VALUES ($1, $2, 'Preuve', 'revision_periodique')", [indicateurId, fid])],
    ["signalement", (fid) => pool.query("INSERT INTO signalements_qualite (reference, type, objet, formation_id) VALUES ($1, 'incident', 'Objet', $2)", [`SG-${fid}`, fid])],
    ["action", (fid) => pool.query("INSERT INTO actions_qualite (reference, titre, formation_id) VALUES ($1, 'Titre', $2)", [`AC-${fid}`, fid])],
  ];
  for (const [libelle, inserer] of cas) {
    const f = await creerFormation(`Utilisée ${libelle}`);
    await inserer(f.id);
    const d = await api("DELETE", `/api/formations/${f.id}`, undefined, A());
    assert.equal(d.statut, 409, `${libelle} bloque la suppression`);
    assert.equal((await pool.query("SELECT 1 FROM formations WHERE id = $1", [f.id])).rowCount, 1, `${libelle} : formation conservée`);
  }
});

test("suppression d'une formation inexistante : 404", async () => {
  assert.equal((await api("DELETE", "/api/formations/999999", undefined, A())).statut, 404);
});

// ── Droits ───────────────────────────────────────────────────

test("droits : archiver, réactiver et supprimer restent réservés à l'admin", async () => {
  const f = await creerFormation("Droits");
  assert.equal((await api("PATCH", `/api/formations/${f.id}/actif`, { actif: false }, C())).statut, 403);
  assert.equal((await api("DELETE", `/api/formations/${f.id}`, undefined, C())).statut, 403);
  // Le contributeur peut lire la liste, mais pas agir dessus.
  assert.equal((await api("GET", "/api/formations", undefined, C())).statut, 200);
});

// ── Isolation Qualiopi ───────────────────────────────────────

test("archivage et suppression ne touchent ni au référentiel ni aux modèles ni aux preuves d'autrui", async () => {
  const avant = await pool.query("SELECT count(*)::int AS n FROM indicateurs");
  const f = await creerFormation("Isolation");
  await api("PATCH", `/api/formations/${f.id}/actif`, { actif: false }, A());
  await api("DELETE", `/api/formations/${f.id}`, undefined, A());
  const apres = await pool.query("SELECT count(*)::int AS n FROM indicateurs");
  assert.equal(apres.rows[0].n, avant.rows[0].n, "indicateurs du référentiel intacts");
});
