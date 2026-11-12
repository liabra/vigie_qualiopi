// ─────────────────────────────────────────────────────────────
//  Blocage, décisions administrateur, bail renouvelé et redémarrage de la corbeille (étape 3C.3).
//  Routes réelles, PostgreSQL réel, Drive SIMULÉ (appels et états enregistrés). Données fictives.
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
import { setDriveFactory } from "../src/services/google.js";
import { demarrerRepriseCorbeille } from "../src/services/repriseCorbeille.js";
import { reglages } from "../src/services/corbeille.js";
import { driveConforme } from "./helpers/driveConforme.js";

const PORT = 55470;
const DATA = path.join(os.tmpdir(), "vq-corbeille-bloc-" + process.pid);
const REGLAGES_INITIAUX = { ...reglages };

let cluster, pool, serveur, origine, adminId, indicateur, session;
let driveActif = null;
const etat = { updates: [], gets: [], corbeille: new Set(), echecUpdate: false, echecGet: false, echecGet404: new Set(), portes: {} };

const cookie = (uid) => "vq_session=" + encode({ uid, exp: Date.now() + 60_000 });
const A = () => ({ cookie: cookie(adminId) });
const sommeil = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(methode, chemin, corps, enTetes = {}) {
  const r = await fetch(origine + chemin, {
    method: methode,
    headers: { "Content-Type": "application/json", ...enTetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}

function porte(nom) {
  let arrivee, ouvrir;
  const atteinte = new Promise((r) => { arrivee = r; });
  const libre = new Promise((r) => { ouvrir = r; });
  etat.portes[nom] = { arrivee, libre };
  return { atteinte, ouvrir };
}

async function franchir(nom) {
  const p = etat.portes[nom];
  if (!p) return;
  delete etat.portes[nom];
  p.arrivee();
  await p.libre;
}

function driveSimule() {
  const d = driveConforme(() => ({ name: "Fiche.pdf", mimeType: "application/pdf" }));
  const lecture = d.files.get;
  d.files.get = async (args) => {
    const { fileId, fields } = args;
    if (fields !== "id,trashed") return lecture(args); // contrôles D-R / D-P : Drive conforme
    etat.gets.push(fileId);
    await franchir("get");
    if (etat.echecGet404.has(fileId)) throw Object.assign(new Error("404 introuvable"), { status: 404 });
    if (etat.echecGet) throw Object.assign(new Error("Drive indisponible"), { status: 500 });
    return { data: { id: fileId, trashed: etat.corbeille.has(fileId) } };
  };
  d.files.update = async ({ fileId, requestBody }) => {
    await franchir("update");
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

async function documentAvecAncienne(ancienne, nouvelle) {
  driveActif = driveSimule();
  const p = await preuve("Preuve " + ancienne);
  const r1 = await api("POST", `/api/preuves/${p}/documents`, { drive_file_id: ancienne }, A());
  assert.equal(r1.statut, 200, JSON.stringify(r1.corps));
  const d = (await pool.query("SELECT id FROM documents WHERE drive_file_id = $1", [ancienne])).rows[0].id;
  const r2 = await api("POST", `/api/documents/${d}/remplacer`, { drive_file_id: nouvelle, version_attendue: 1 }, A());
  assert.equal(r2.statut, 200, JSON.stringify(r2.corps));
  return d;
}

// Mise à la corbeille échouant côté Drive : l'opération reste « en_attente », la version réservée.
async function echecInitial(id) {
  etat.echecUpdate = true;
  const r = await api("POST", `/api/documents/${id}/versions/1/corbeille`, { confirmer: true }, A());
  etat.echecUpdate = false;
  assert.equal(r.statut, 503, JSON.stringify(r.corps));
}

async function operation(fichier) {
  return (await pool.query(
    "SELECT statut, motif, tentatives, derniere_erreur, bail_jusqu_au IS NOT NULL AS bail, decision_motif FROM corbeille_operations WHERE drive_file_id = $1 ORDER BY id DESC LIMIT 1",
    [fichier]
  )).rows[0];
}

async function reprise() {
  const r = await api("POST", "/api/corbeille/reprise", undefined, A());
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  return r.corps.reprises;
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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@bl.local', 'Mme Stark', 'admin') RETURNING id"));
  indicateur = (await pool.query("SELECT i.id FROM indicateurs i ORDER BY i.id LIMIT 1")).rows[0].id;
  const { rows: [{ id: formation }] } = await pool.query("INSERT INTO formations (intitule) VALUES ('Formation BL') RETURNING id");
  ({ rows: [{ id: session }] } = await pool.query("INSERT INTO sessions (formation_id, reference, date_debut, date_fin) VALUES ($1, 'SESS-BL', '2026-01-05', '2026-03-05') RETURNING id", [formation]));
  setDriveFactory(() => driveActif);
  serveur = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});

after(async () => {
  Object.assign(reglages, REGLAGES_INITIAUX);
  setDriveFactory(null);
  setPoolFactory(null);
  setQueryExecutor(null);
  if (serveur) await new Promise((r) => serveur.close(r));
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
});

test("fichier introuvable : opération bloquée, motif conservé, jamais retentée automatiquement", async () => {
  const d = await documentAvecAncienne("BL_ANC_1", "BL_NOU_1");
  await echecInitial(d);
  etat.echecGet404.add("BL_ANC_1");
  const premiere = await reprise();
  assert.equal(premiere.find((x) => x.statut === "bloquee").motif, "fichier_introuvable");
  assert.equal((await operation("BL_ANC_1")).statut, "bloquee");

  const appelsAvant = etat.gets.length;
  await reprise();
  await reprise();
  assert.equal(etat.gets.length, appelsAvant, "aucun appel Drive ajouté pour une opération bloquée");
  assert.deepEqual(etat.updates.filter((f) => f === "BL_ANC_1"), []);

  // Réservation maintenue pendant le blocage : aucun nouvel usage du fichier.
  const autre = await preuve("Preuve blocage");
  const usage = await api("POST", `/api/preuves/${autre}/documents`, { drive_file_id: "BL_ANC_1" }, A());
  assert.equal(usage.corps.code, "version_reservee_corbeille");

  // Une nouvelle demande sur la même version est refusée tant que le blocage n'est pas décidé.
  const nouvelle = await api("POST", `/api/documents/${d}/versions/1/corbeille`, { confirmer: true }, A());
  assert.equal(nouvelle.statut, 409);
  assert.equal(nouvelle.corps.code, "corbeille_bloquee");
});

test("fichier devenu utilisé : bloqué, et une nouvelle demande sur la même version est refusée (corbeille_bloquee)", async () => {
  const d = await documentAvecAncienne("BL_ANC_2", "BL_NOU_2");
  await echecInitial(d);
  // Contournement simulé d'un écrivain : un fichier référencé sans passer par le service.
  const p = await preuve("Preuve contournement");
  await pool.query("INSERT INTO preuve_fichiers (preuve_id, drive_file_id, drive_nom) VALUES ($1, 'BL_ANC_2', 'x')", [p]);
  const rep = await reprise();
  assert.equal(rep.find((x) => x.statut === "bloquee").motif, "fichier_encore_utilise");
  assert.deepEqual(etat.updates.filter((f) => f === "BL_ANC_2"), [], "aucune suppression");

  // Les protections de fond passent avant le blocage : la nouvelle demande est refusée pour usage.
  const nouvelle = await api("POST", `/api/documents/${d}/versions/1/corbeille`, { confirmer: true }, A());
  assert.equal(nouvelle.statut, 409);
  assert.equal(nouvelle.corps.code, "fichier_encore_utilise");
});

test("échecs répétés : reprise bornée, opération bloquée au seuil, aucun appel Drive ensuite", async () => {
  const d = await documentAvecAncienne("BL_ANC_3", "BL_NOU_3");
  await echecInitial(d);
  etat.echecGet = true;
  for (let i = 0; i < reglages.tentativesMax; i++) await reprise();
  etat.echecGet = false;
  const op = await operation("BL_ANC_3");
  assert.equal(op.statut, "bloquee");
  assert.equal(op.motif, "echec_repete");
  assert.equal(op.tentatives, reglages.tentativesMax);

  const appels = etat.gets.filter((f) => f === "BL_ANC_3").length;
  await reprise();
  assert.equal(etat.gets.filter((f) => f === "BL_ANC_3").length, appels, "boucle de reprise interrompue");
});

test("décisions administrateur : abandon exige un motif, refuse une opération en cours, libère la réservation", async () => {
  const d = await documentAvecAncienne("BL_ANC_4", "BL_NOU_4");
  await echecInitial(d);
  const id = (await pool.query("SELECT id FROM corbeille_operations WHERE drive_file_id = 'BL_ANC_4'")).rows[0].id;

  const enCours = await api("POST", `/api/corbeille/operations/${id}/abandonner`, { motif: "trop tôt" }, A());
  assert.equal(enCours.statut, 409, "opération en attente : abandon refusé");
  assert.equal((await api("POST", `/api/corbeille/operations/${id}/relancer`, undefined, A())).statut, 409);

  etat.echecGet404.add("BL_ANC_4");
  await reprise();
  assert.equal((await operation("BL_ANC_4")).statut, "bloquee");

  assert.equal((await api("POST", `/api/corbeille/operations/${id}/abandonner`, { motif: "   " }, A())).statut, 400, "motif vide refusé");
  const abandon = await api("POST", `/api/corbeille/operations/${id}/abandonner`, { motif: "Fichier retrouvé hors Drive" }, A());
  assert.equal(abandon.statut, 200, JSON.stringify(abandon.corps));
  const apres = await operation("BL_ANC_4");
  assert.equal(apres.statut, "abandonnee");
  assert.equal(apres.decision_motif, "Fichier retrouvé hors Drive", "motif conservé");

  const liste = await api("GET", "/api/corbeille/en-attente", undefined, A());
  assert.equal(liste.corps.operations.some((o) => o.drive_file_id === "BL_ANC_4"), false, "terminée : hors liste");
  assert.deepEqual(etat.updates.filter((f) => f === "BL_ANC_4"), [], "aucune action Drive");
});

test("relance administrateur : une opération bloquée repart et aboutit si le fichier est de nouveau disponible", async () => {
  const d = await documentAvecAncienne("BL_ANC_5", "BL_NOU_5");
  await echecInitial(d);
  const id = (await pool.query("SELECT id FROM corbeille_operations WHERE drive_file_id = 'BL_ANC_5'")).rows[0].id;
  etat.echecGet404.add("BL_ANC_5");
  await reprise();
  assert.equal((await operation("BL_ANC_5")).statut, "bloquee");

  etat.echecGet404.delete("BL_ANC_5");
  const relance = await api("POST", `/api/corbeille/operations/${id}/relancer`, undefined, A());
  assert.equal(relance.statut, 200, JSON.stringify(relance.corps));
  const repris = await operation("BL_ANC_5");
  assert.equal(repris.statut, "en_attente");
  assert.equal(repris.tentatives, 0);
  assert.equal(repris.motif, null);

  const rep = await reprise();
  assert.equal(rep.find((x) => x.operationId === id).statut, "confirmee");
  assert.deepEqual(etat.updates.filter((f) => f === "BL_ANC_5"), ["BL_ANC_5"], "une seule suppression");
});

test("abandon puis nouvelle demande : la version peut de nouveau faire l'objet d'une mise à la corbeille", async () => {
  const d = await documentAvecAncienne("BL_ANC_6", "BL_NOU_6");
  await echecInitial(d);
  const id = (await pool.query("SELECT id FROM corbeille_operations WHERE drive_file_id = 'BL_ANC_6'")).rows[0].id;
  etat.echecGet404.add("BL_ANC_6");
  await reprise();
  etat.echecGet404.delete("BL_ANC_6");
  await api("POST", `/api/corbeille/operations/${id}/abandonner`, { motif: "Décision de conservation" }, A());

  const nouvelle = await api("POST", `/api/documents/${d}/versions/1/corbeille`, { confirmer: true }, A());
  assert.equal(nouvelle.statut, 200, JSON.stringify(nouvelle.corps));
  assert.equal((await operation("BL_ANC_6")).statut, "confirmee");
});

test("bail renouvelé pendant un appel Drive long : une autre reprise ne le reprend pas, même au-delà de la durée initiale", async () => {
  Object.assign(reglages, { bailSecondes: 1, renouvellementMs: 150 });
  try {
    const d = await documentAvecAncienne("BL_ANC_7", "BL_NOU_7");
    await echecInitial(d);
    const attente = porte("get");
    const enVol = api("POST", "/api/corbeille/reprise", undefined, A());
    await attente.atteinte;
    try {
      await sommeil(1400); // au-delà du bail initial de 1 s : seul le renouvellement le maintient
      const { rows: [{ valide }] } = await pool.query("SELECT bail_jusqu_au > now() AS valide FROM corbeille_operations WHERE drive_file_id = 'BL_ANC_7'");
      assert.equal(valide, true, "bail toujours valide pendant l'appel Drive");
      const autre = await api("POST", "/api/corbeille/reprise", undefined, A());
      assert.deepEqual(autre.corps.reprises, [], "aucune reprise concurrente");
    } finally {
      attente.ouvrir();
    }
    const fin = await enVol;
    assert.deepEqual(fin.corps.reprises.map((r) => r.statut), ["confirmee"]);
    assert.deepEqual(etat.updates.filter((f) => f === "BL_ANC_7"), ["BL_ANC_7"]);
  } finally {
    Object.assign(reglages, REGLAGES_INITIAUX);
  }
});

test("deux reprises simultanées : une seule lecture et une seule suppression Drive", async () => {
  const d = await documentAvecAncienne("BL_ANC_8", "BL_NOU_8");
  await echecInitial(d);
  const attente = porte("get");
  const a = api("POST", "/api/corbeille/reprise", undefined, A());
  const b = api("POST", "/api/corbeille/reprise", undefined, A());
  await attente.atteinte;
  await sommeil(100);
  attente.ouvrir();
  const [ra, rb] = await Promise.all([a, b]);
  const confirmees = [...ra.corps.reprises, ...rb.corps.reprises].filter((r) => r.statut === "confirmee");
  assert.equal(confirmees.length, 1, "une seule reprise traite l'opération");
  assert.equal(etat.updates.filter((f) => f === "BL_ANC_8").length, 1);
  assert.equal(etat.gets.filter((f) => f === "BL_ANC_8").length, 1, "une seule lecture Drive");
});

test("redémarrage : une opération laissée par un processus arrêté est reprise au démarrage", async () => {
  const d = await documentAvecAncienne("BL_ANC_9", "BL_NOU_9");
  await echecInitial(d);
  // Le processus précédent a été arrêté pendant l'appel : bail expiré, jeton orphelin.
  await pool.query("UPDATE corbeille_operations SET bail_jusqu_au = now() - interval '1 minute', bail_jeton = 'mort' WHERE drive_file_id = 'BL_ANC_9'");
  const journal = { log() {}, error() {} };
  const rep = demarrerRepriseCorbeille({ intervalleMs: 60_000, obtenirDrive: async () => driveActif, journal });
  try {
    for (let i = 0; i < 40 && (await operation("BL_ANC_9")).statut !== "confirmee"; i++) await sommeil(50);
  } finally {
    await rep.arreter();
  }
  assert.equal((await operation("BL_ANC_9")).statut, "confirmee");
  assert.deepEqual(etat.updates.filter((f) => f === "BL_ANC_9"), ["BL_ANC_9"]);
});
