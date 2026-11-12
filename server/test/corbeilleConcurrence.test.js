// ─────────────────────────────────────────────────────────────
//  Concurrence de la corbeille et de la reprise (étape 3C.2).
//  Les appels Drive sont suspendus à un point précis (porte) : la fenêtre entre la vérification
//  PostgreSQL et la suppression Drive est alors ouverte réellement, pas simulée par un délai.
//  Routes réelles, PostgreSQL réel, Drive SIMULÉ. Données entièrement fictives.
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
import { driveConforme } from "./helpers/driveConforme.js";

const PORT = 55469;
const DATA = path.join(os.tmpdir(), "vq-corbeille-conc-" + process.pid);

let cluster, pool, serveur, origine, adminId, indicateur, session;
let driveActif = null;
const etat = { updates: [], corbeille: new Set(), echecUpdate: false, portes: {} };

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

// Porte : la prochaine opération Drive nommée s'arrête à son arrivée jusqu'à `ouvrir()`.
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
    if (args.fields !== "id,trashed") return lecture(args);
    await franchir("get");
    return { data: { id: args.fileId, trashed: etat.corbeille.has(args.fileId) } };
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

// Document à deux versions : la version 1 (ancienne) est désormais candidate à la corbeille.
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

async function operations(fichier) {
  return (await pool.query("SELECT statut, bail_jusqu_au IS NOT NULL AS bail FROM corbeille_operations WHERE drive_file_id = $1", [fichier])).rows;
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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@cc.local', 'Mme Stark', 'admin') RETURNING id"));
  indicateur = (await pool.query("SELECT i.id FROM indicateurs i ORDER BY i.id LIMIT 1")).rows[0].id;
  const { rows: [{ id: formation }] } = await pool.query("INSERT INTO formations (intitule) VALUES ('Formation CC') RETURNING id");
  ({ rows: [{ id: session }] } = await pool.query("INSERT INTO sessions (formation_id, reference, date_debut, date_fin) VALUES ($1, 'SESS-CC', '2026-01-05', '2026-03-05') RETURNING id", [formation]));
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
});

test("fenêtre pendant la suppression Drive : la version est réservée, aucune écriture ne la référence", async () => {
  const d = await documentAvecAncienne("CC_ANC_1", "CC_NOU_1");
  const attente = porte("update");
  const enVol = api("POST", `/api/documents/${d}/versions/1/corbeille`, { confirmer: true }, A());
  await attente.atteinte; // transaction de préparation validée, appel Drive suspendu
  try {
    const autre = await preuve("Preuve concurrente");
    const rattachement = await api("POST", `/api/preuves/${autre}/documents`, { drive_file_id: "CC_ANC_1" }, A());
    assert.equal(rattachement.statut, 409, JSON.stringify(rattachement.corps));
    assert.equal(rattachement.corps.code, "version_reservee_corbeille");

    const remplacement = await api("POST", `/api/documents/${d}/remplacer`, { drive_file_id: "CC_ANC_1", version_attendue: 2 }, A());
    assert.equal(remplacement.statut, 409, JSON.stringify(remplacement.corps));
    assert.equal(remplacement.corps.code, "version_reservee_corbeille");

    const seconde = await api("POST", `/api/documents/${d}/versions/1/corbeille`, { confirmer: true }, A());
    assert.equal(seconde.corps.code, "corbeille_en_attente");

    const reprise = await api("POST", "/api/corbeille/reprise", undefined, A());
    assert.equal(reprise.statut, 200);
    assert.deepEqual(reprise.corps.reprises, [], "l'opération en cours n'est pas reprise en parallèle");
  } finally {
    attente.ouvrir();
  }
  const fin = await enVol;
  assert.equal(fin.statut, 200, JSON.stringify(fin.corps));
  assert.deepEqual(etat.updates.filter((f) => f === "CC_ANC_1"), ["CC_ANC_1"], "une seule suppression Drive");
  assert.deepEqual((await operations("CC_ANC_1")).map((o) => o.statut), ["confirmee"]);
});

test("fenêtre pendant la reprise : la version reste réservée et la reprise ne se double pas", async () => {
  const d = await documentAvecAncienne("CC_ANC_2", "CC_NOU_2");
  etat.echecUpdate = true;
  const echec = await api("POST", `/api/documents/${d}/versions/1/corbeille`, { confirmer: true }, A());
  etat.echecUpdate = false;
  assert.equal(echec.statut, 503);

  const attente = porte("get");
  const reprise = api("POST", "/api/corbeille/reprise", undefined, A());
  await attente.atteinte; // reprise réclamée, lecture Drive suspendue
  try {
    const autre = await preuve("Preuve reprise");
    const rattachement = await api("POST", `/api/preuves/${autre}/documents`, { drive_file_id: "CC_ANC_2" }, A());
    assert.equal(rattachement.corps.code, "version_reservee_corbeille");

    const doublon = await api("POST", "/api/corbeille/reprise", undefined, A());
    assert.deepEqual(doublon.corps.reprises, [], "une opération réclamée n'est pas traitée une seconde fois");
  } finally {
    attente.ouvrir();
  }
  const fin = await reprise;
  assert.deepEqual(fin.corps.reprises.map((r) => r.statut), ["confirmee"]);
  assert.equal(etat.updates.filter((f) => f === "CC_ANC_2").length, 1, "suppression Drive unique");
});

test("bail valide ignoré, bail expiré repris : un processus interrompu ne bloque pas l'opération", async () => {
  const d = await documentAvecAncienne("CC_ANC_3", "CC_NOU_3");
  etat.echecUpdate = true;
  await api("POST", `/api/documents/${d}/versions/1/corbeille`, { confirmer: true }, A());
  etat.echecUpdate = false;

  // Un processus a réclamé l'opération puis s'est interrompu : bail encore valide.
  await pool.query("UPDATE corbeille_operations SET bail_jusqu_au = now() + interval '1 minute' WHERE drive_file_id = 'CC_ANC_3'");
  const pendant = await api("POST", "/api/corbeille/reprise", undefined, A());
  assert.deepEqual(pendant.corps.reprises, []);

  // Le bail a expiré : la reprise prend le relais.
  await pool.query("UPDATE corbeille_operations SET bail_jusqu_au = now() - interval '1 minute' WHERE drive_file_id = 'CC_ANC_3'");
  const apres = await api("POST", "/api/corbeille/reprise", undefined, A());
  assert.deepEqual(apres.corps.reprises.map((r) => r.statut), ["confirmee"]);
  assert.deepEqual(etat.updates.filter((f) => f === "CC_ANC_3"), ["CC_ANC_3"]);
});

test("planificateur : démarrage non bloquant, jamais deux cycles simultanés dans le processus", async () => {
  let appels = 0;
  let liberer;
  const barriere = new Promise((r) => { liberer = r; });
  const journal = { log() {}, error() {} };
  const obtenirDrive = async () => { appels++; await barriere; return null; };

  const rep = demarrerRepriseCorbeille({ intervalleMs: 20, obtenirDrive, journal });
  assert.equal(appels, 0, "le démarrage n'est pas exécuté de façon synchrone");
  await sommeil(120); // plusieurs intervalles pendant que le premier cycle est suspendu
  assert.equal(appels, 1, "les déclenchements suivants ne lancent pas de second cycle");

  liberer();
  await sommeil(80);
  assert.ok(appels > 1, "les cycles reprennent une fois le précédent terminé");
  await rep.arreter();
  const figes = appels;
  await sommeil(80);
  assert.equal(appels, figes, "aucun cycle après l'arrêt");
});

test("planificateur : une erreur est journalisée par son code seulement, sans interrompre les cycles", async () => {
  let appels = 0;
  const erreurs = [];
  const journal = { log() {}, error: (m) => erreurs.push(m) };
  const obtenirDrive = async () => {
    appels++;
    throw Object.assign(new Error("jeton secret ya29.xyz"), { code: "drive_jeton_expire" });
  };
  const rep = demarrerRepriseCorbeille({ intervalleMs: 20, obtenirDrive, journal });
  await sommeil(120);
  await rep.arreter();
  assert.ok(appels >= 2, "les cycles suivants restent actifs après une erreur");
  assert.ok(erreurs.length >= 2);
  assert.ok(erreurs.every((m) => m === "Reprise corbeille : drive_jeton_expire"), JSON.stringify(erreurs));
});
