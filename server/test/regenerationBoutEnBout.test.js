// ─────────────────────────────────────────────────────────────
//  Régénération de bout en bout (étape 3B.1).
//  Route réelle POST /api/generations, PostgreSQL réel, Drive/Docs/Sheets SIMULÉS.
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
import { clientDriveSimule } from "./helpers/genererDrive.js";

const PORT = 55464;
const DATA = path.join(os.tmpdir(), "vq-regen-" + process.pid);

let cluster, pool, serveur, origine, adminId, indicateur;
let client = null;
let trace = null;

const cookie = (uid) => "vq_session=" + encode({ uid, exp: Date.now() + 60_000 });
const A = () => ({ cookie: cookie(adminId) });

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

let copiesEmises = 0;

// Identifiants de copie uniques sur toute la session de test (sinon une « nouvelle » copie
// serait identique à la version courante).
function nouveauDrive(opts = {}) {
  if (trace) copiesEmises += trace.copies;
  const s = clientDriveSimule({ ...opts, depart: copiesEmises });
  trace = s.trace;
  client = s.client;
  return client;
}

async function genererModele(remplacer, extra = {}) {
  return api("POST", "/api/generations", { modele_id: 1, session_id: 1, remplacer, ...extra }, A());
}

async function etatDocuments() {
  return lire(`SELECT dg.stagiaire_id, dg.drive_file_id, d.id AS document_id, d.version_courante,
      (SELECT count(*)::int FROM document_versions v WHERE v.document_id = d.id) AS versions
    FROM documents_generes dg JOIN documents d ON d.id = dg.document_id ORDER BY dg.stagiaire_id`);
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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@g.local', 'Mme Stark', 'admin') RETURNING id"));
  indicateur = (await pool.query("SELECT i.id FROM indicateurs i ORDER BY i.id LIMIT 1")).rows[0].id;
  await pool.query("INSERT INTO formations (id, intitule) VALUES (1, 'Formation G')");
  await pool.query(`INSERT INTO sessions (id, formation_id, reference, date_debut, date_fin) VALUES
    (1, 1, 'SESS-G1', '2026-01-05', '2026-03-05'), (2, 1, 'SESS-G2', '2026-04-05', '2026-06-05')`);
  await pool.query(`INSERT INTO stagiaires (id, nom, prenom) VALUES (1, 'Stark', 'Anne'), (2, 'Carr', 'Luc')`);
  await pool.query(`INSERT INTO inscriptions (stagiaire_id, session_id) VALUES (1, 1), (2, 1)`);
  await pool.query(`INSERT INTO modeles_documents (id, nom, drive_file_id, drive_mime, portee, actif)
    VALUES (1, 'Attestation', 'MODELE', 'application/vnd.google-apps.document', 'stagiaire', true)`);
  await pool.query("INSERT INTO modele_indicateurs (modele_id, indicateur_id) VALUES (1, $1)", [indicateur]);

  setDriveFactory(() => client && { ...client, row: client.row });
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

test("première génération : un document par stagiaire, versions 1, liens à la preuve", async () => {
  nouveauDrive();
  const r = await genererModele(false);
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.documents, 2);
  const docs = await etatDocuments();
  assert.equal(docs.length, 2);
  assert.ok(docs.every((d) => d.versions === 1 && d.version_courante === 1));
  const liens = await lire("SELECT count(*)::int n FROM preuve_documents WHERE origine = 'generation'");
  assert.equal(liens[0].n, 2, "chaque document est lié à la preuve de l'indicateur");
});

test("régénération : version 2 par document, documents_generes mis à jour, liens conservés, R6 appliqué", async () => {
  nouveauDrive();
  const avant = await etatDocuments();
  const liensAvant = (await lire("SELECT count(*)::int n FROM preuve_documents"))[0].n;
  const r = await genererModele(true);
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.remplaces, 2);
  const apres = await etatDocuments();
  assert.deepEqual(apres.map((d) => d.document_id), avant.map((d) => d.document_id), "mêmes documents (identité conservée)");
  assert.ok(apres.every((d) => d.versions === 2 && d.version_courante === 2));
  assert.notDeepEqual(apres.map((d) => d.drive_file_id), avant.map((d) => d.drive_file_id), "documents_generes pointe vers la copie courante");
  assert.equal((await lire("SELECT count(*)::int n FROM preuve_documents"))[0].n, liensAvant, "aucun lien perdu");
  assert.equal((await lire("SELECT statut FROM preuves WHERE id IN (SELECT preuve_id FROM preuve_documents WHERE origine = 'generation')"))[0].statut, "a_consolider", "R6 : la preuve liée doit être revalidée");
  assert.deepEqual(trace.corbeille, [], "l'ancien fichier n'est jamais mis à la corbeille");
});

test("R11 : un document partagé avec une preuve hors contexte bloque la régénération AVANT toute copie", async () => {
  nouveauDrive();
  const doc = (await etatDocuments())[0];
  const autre = (await pool.query("INSERT INTO preuves (indicateur_id, titre, statut, session_id) VALUES ($1, 'Hors contexte', 'maitrise', 2) RETURNING id", [indicateur])).rows[0].id;
  const att = await api("POST", `/api/preuves/${autre}/documents`, { document_id: doc.document_id }, A());
  assert.equal(att.statut, 200, JSON.stringify(att.corps));
  const copiesAvant = trace.copiesCreees.length;
  const r = await genererModele(true);
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, "document_partage_hors_contexte");
  assert.equal(trace.copiesCreees.length, copiesAvant, "aucune copie créée avant le refus");
  assert.equal((await lire("SELECT statut FROM preuves WHERE id = $1", [autre]))[0].statut, "maitrise", "rien n'a été modifié");
});

test("régénération confirmée : R6 s'applique aussi à la preuve hors contexte, liens conservés", async () => {
  nouveauDrive();
  const r = await genererModele(true, { confirmer_partage: true });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const hors = (await lire("SELECT p.statut FROM preuves p WHERE p.titre = 'Hors contexte'"))[0];
  assert.equal(hors.statut, "a_consolider", "la preuve hors contexte passe à revalider");
  const liens = (await lire("SELECT count(*)::int n FROM preuve_documents pd JOIN preuves p ON p.id = pd.preuve_id WHERE p.titre = 'Hors contexte'"))[0].n;
  assert.equal(liens, 1, "le lien hors contexte est conservé");
  assert.deepEqual(trace.corbeille, [], "aucune suppression");
});

test("échec injecté pendant la régénération : ancien document et historique intacts, seule la copie non committée est nettoyée", async () => {
  nouveauDrive();
  const avantEtat = await etatDocuments();
  const avantVersions = (await lire("SELECT count(*)::int n FROM document_versions"))[0].n;
  const avantGen = (await lire("SELECT count(*)::int n FROM generations"))[0].n;
  await pool.query(`
    CREATE OR REPLACE FUNCTION vq_echec_regen() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'échec injecté en régénération'; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER vq_echec_regen_trg BEFORE INSERT ON document_versions
      FOR EACH ROW WHEN (NEW.numero >= 4) EXECUTE FUNCTION vq_echec_regen();`);
  let r;
  try {
    r = await genererModele(true, { confirmer_partage: true });
  } finally {
    await pool.query("DROP TRIGGER vq_echec_regen_trg ON document_versions; DROP FUNCTION vq_echec_regen();");
  }
  assert.equal(r.statut, 500);
  assert.equal((await lire("SELECT count(*)::int n FROM document_versions"))[0].n, avantVersions, "aucune version ajoutée");
  assert.deepEqual(await etatDocuments(), avantEtat, "documents et pointeurs inchangés");
  assert.equal((await lire("SELECT count(*)::int n FROM generations"))[0].n, avantGen, "génération annulée");
  assert.ok(trace.corbeille.length > 0, "les copies non committées sont nettoyées");
  assert.ok(trace.corbeille.every((id) => trace.copiesCreees.includes(id)), "seules des copies créées par cette tentative sont mises à la corbeille");
  assert.ok(!trace.corbeille.includes("ancien-fichier"));
});
