// ─────────────────────────────────────────────────────────────
//  Corbeille : journal, échecs avant et après l'écriture Drive, reprise après incident (3C.1).
//  Routes réelles, PostgreSQL réel, Drive SIMULÉ (états et écritures enregistrés).
//  Données entièrement fictives.
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
import { setDriveFactory } from "../src/services/google.js";
import { driveConforme } from "./helpers/driveConforme.js";

const PORT = 55467;
const DATA = path.join(os.tmpdir(), "vq-corbeille-" + process.pid);

let cluster, pool, serveur, origine, adminId, contribId, indicateur, session, modele;
let driveActif = null;
const etat = { updates: [], corbeille: new Set(), echecUpdate: false, echecGet404: new Set() };

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

async function lire(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

function driveSimule() {
  const d = driveConforme(() => ({ name: "Fiche.pdf", mimeType: "application/pdf" }));
  const lecture = d.files.get;
  d.files.get = async (args) => {
    if (etat.echecGet404.has(args.fileId)) throw Object.assign(new Error("404 introuvable"), { status: 404 });
    if (args.fields === "id,trashed") return { data: { id: args.fileId, trashed: etat.corbeille.has(args.fileId) } };
    return lecture(args);
  };
  d.files.update = async ({ fileId, requestBody }) => {
    if (etat.echecUpdate) throw Object.assign(new Error("Drive indisponible"), { status: 500 });
    if (requestBody?.trashed !== true) throw new Error("seule la mise à la corbeille est permise");
    etat.updates.push(fileId);
    etat.corbeille.add(fileId);
    return { data: {} };
  };
  for (const m of ["delete", "copy", "create"]) d.files[m] = async () => { throw new Error("interdit : " + m); };
  return { drive: d, row: { scopes: "", email: "vigie@compte.test" } };
}

async function preuve(titre) {
  const { rows: [p] } = await pool.query(
    "INSERT INTO preuves (indicateur_id, titre, statut, session_id, mode_fichiers) VALUES ($1, $2, 'maitrise', $3, 'multiple') RETURNING id",
    [indicateur, titre, session]
  );
  return p.id;
}

// Document à deux versions : F1 (ancienne, éligible à la corbeille) et F2 (courante).
async function documentDeuxVersions(nom) {
  const p = await preuve(nom);
  driveActif = driveSimule();
  const r1 = await api("POST", `/api/preuves/${p}/documents`, { drive_file_id: nom + "_V1" }, A());
  assert.equal(r1.statut, 200, JSON.stringify(r1.corps));
  const id = (await lire("SELECT id FROM documents WHERE drive_file_id = $1", [nom + "_V1"]))[0].id;
  const r2 = await api("POST", `/api/documents/${id}/remplacer`, { drive_file_id: nom + "_V2", version_attendue: 1 }, A());
  assert.equal(r2.statut, 200, JSON.stringify(r2.corps));
  etat.updates = [];
  etat.corbeille.clear();
  return { id, ancien: nom + "_V1" };
}

const versionMarquee = async (id) => (await lire("SELECT corbeille_le FROM document_versions WHERE document_id = $1 AND numero = 1", [id]))[0].corbeille_le;
const operations = async (id) => lire("SELECT statut, derniere_erreur FROM corbeille_operations WHERE document_id = $1 ORDER BY id", [id]);

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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@r.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@r.local', 'Tukui', 'contributeur') RETURNING id"));
  indicateur = (await pool.query("SELECT i.id FROM indicateurs i ORDER BY i.id LIMIT 1")).rows[0].id;
  const { rows: [f] } = await pool.query("INSERT INTO formations (intitule) VALUES ('Formation K') RETURNING id");
  ({ rows: [{ id: session }] } = await pool.query("INSERT INTO sessions (formation_id, reference, date_debut, date_fin) VALUES ($1, 'SESS-K', '2026-01-05', '2026-03-05') RETURNING id", [f.id]));
  ({ rows: [{ id: modele }] } = await pool.query("INSERT INTO modeles_documents (nom, drive_file_id, drive_mime, portee) VALUES ('M K', 'MOD-K', 'application/vnd.google-apps.document', 'session') RETURNING id"));
  setDriveFactory(() => driveActif);
  serveur = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});

after(async () => {
  setDriveFactory(null);
  setPoolFactory(null);
  setQueryExecutor(null);
  if (serveur) await new Promise((r) => serveur.close(r));
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
  await fs.rm(DATA, { recursive: true, force: true }).catch(() => {});
});

test("échec Drive AVANT écriture : 503, opération en attente, base inchangée ; reprise la termine", async () => {
  const { id, ancien } = await documentDeuxVersions("K_A");
  etat.echecUpdate = true;
  const r = await api("POST", `/api/documents/${id}/versions/1/corbeille`, { confirmer: true }, A());
  etat.echecUpdate = false;
  assert.equal(r.statut, 503);
  assert.equal(r.corps.code, "corbeille_echec");
  assert.equal(await versionMarquee(id), null);
  assert.deepEqual((await operations(id)).map((o) => o.statut), ["en_attente"]);
  assert.deepEqual(etat.updates, [], "aucune écriture Drive réussie");

  const rep = await api("POST", "/api/corbeille/reprise", undefined, A());
  assert.equal(rep.statut, 200, JSON.stringify(rep.corps));
  assert.deepEqual(rep.corps.reprises.find((x) => x.statut === "confirmee") !== undefined, true);
  assert.deepEqual(etat.updates, [ancien], "une seule mise à la corbeille, sur l'ancien fichier");
  assert.ok(await versionMarquee(id), "version marquée à la reprise");
  assert.deepEqual((await operations(id)).map((o) => o.statut), ["confirmee"]);
});

test("échec de confirmation APRÈS écriture Drive : 202, reprise sans seconde suppression", async () => {
  const { id, ancien } = await documentDeuxVersions("K_B");
  await pool.query(`
    CREATE OR REPLACE FUNCTION vq_echec_confirm() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'échec injecté confirmation'; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER vq_echec_confirm_trg BEFORE UPDATE ON document_versions
      FOR EACH ROW WHEN (NEW.corbeille_le IS NOT NULL) EXECUTE FUNCTION vq_echec_confirm();`);
  let r;
  try {
    r = await api("POST", `/api/documents/${id}/versions/1/corbeille`, { confirmer: true }, A());
  } finally {
    await pool.query("DROP TRIGGER vq_echec_confirm_trg ON document_versions; DROP FUNCTION vq_echec_confirm();");
  }
  assert.equal(r.statut, 202, JSON.stringify(r.corps));
  assert.equal(r.corps.code, "corbeille_confirmation_en_attente");
  assert.deepEqual(etat.updates, [ancien], "le fichier est bien à la corbeille Drive");
  assert.equal(await versionMarquee(id), null, "la base ne l'a pas encore marqué");
  assert.deepEqual((await operations(id)).map((o) => o.statut), ["en_attente"]);

  const rep = await api("POST", "/api/corbeille/reprise", undefined, A());
  assert.equal(rep.statut, 200);
  assert.equal(etat.updates.length, 1, "reprise : aucune seconde suppression, Drive dit déjà « à la corbeille »");
  assert.ok(await versionMarquee(id), "base confirmée à la reprise");
  assert.deepEqual((await operations(id)).map((o) => o.statut), ["confirmee"]);
});

test("fichier devenu utilisé pendant l'attente : opération bloquée avec son motif, aucun appel Drive", async () => {
  const { id, ancien } = await documentDeuxVersions("K_C");
  etat.echecUpdate = true;
  await api("POST", `/api/documents/${id}/versions/1/corbeille`, { confirmer: true }, A());
  etat.echecUpdate = false;
  await pool.query(
    "INSERT INTO documents_generes (modele_id, session_id, stagiaire_id, drive_file_id, drive_url, nom) VALUES ($1, $2, NULL, $3, 'https://x', 'utilisé')",
    [modele, session, ancien]
  );
  const rep = await api("POST", "/api/corbeille/reprise", undefined, A());
  const mien = rep.corps.reprises.find((x) => x.statut === "bloquee");
  assert.ok(mien, "l'opération est bloquée");
  assert.equal(mien.motif, "fichier_encore_utilise");
  assert.deepEqual(etat.updates, [], "aucune suppression");
  assert.deepEqual((await operations(id)).map((o) => o.statut), ["bloquee"]);
  await pool.query("DELETE FROM documents_generes WHERE drive_file_id = $1", [ancien]);
});

test("fichier disparu côté Drive : opération bloquée, signalée avec son motif, sans action", async () => {
  const { id, ancien } = await documentDeuxVersions("K_D");
  etat.echecUpdate = true;
  await api("POST", `/api/documents/${id}/versions/1/corbeille`, { confirmer: true }, A());
  etat.echecUpdate = false;
  etat.echecGet404.add(ancien);
  const rep = await api("POST", "/api/corbeille/reprise", undefined, A());
  assert.equal(rep.statut, 200);
  assert.equal(rep.corps.reprises.find((x) => x.statut === "bloquee").motif, "fichier_introuvable");
  assert.deepEqual(etat.updates.filter((f) => f === ancien), [], "ce fichier n'est jamais supprimé");
  const liste = await api("GET", "/api/corbeille/en-attente", undefined, A());
  const signalee = liste.corps.operations.find((o) => o.drive_file_id === ancien);
  assert.equal(signalee?.statut, "bloquee", "signalée à l'administrateur");
  assert.equal(signalee.motif, "fichier_introuvable");
});

test("double demande pendant l'attente refusée ; reprise idempotente", async () => {
  const { id } = await documentDeuxVersions("K_E");
  etat.echecUpdate = true;
  await api("POST", `/api/documents/${id}/versions/1/corbeille`, { confirmer: true }, A());
  etat.echecUpdate = false;
  const double = await api("POST", `/api/documents/${id}/versions/1/corbeille`, { confirmer: true }, A());
  assert.equal(double.statut, 409);
  assert.equal(double.corps.code, "corbeille_en_attente");
  // Les autres en attente de la base partagée sont traitées par le même appel ; on vérifie
  // qu'une nouvelle reprise ne refait rien pour cette opération une fois terminée.
  await api("POST", "/api/corbeille/reprise", undefined, A());
  const seconde = await api("POST", "/api/corbeille/reprise", undefined, A());
  assert.equal(seconde.statut, 200);
  assert.equal(seconde.corps.reprises.filter((x) => x.statut === "confirmee").length, 0, "rien à reprendre");
});

test("droits : reprise et journal réservés à l'administrateur", async () => {
  assert.equal((await api("POST", "/api/corbeille/reprise", undefined, C())).statut, 403);
  assert.equal((await api("GET", "/api/corbeille/en-attente", undefined, C())).statut, 403);
});
