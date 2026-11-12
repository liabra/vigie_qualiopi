// ─────────────────────────────────────────────────────────────
//  Confidentialité de GET /api/sessions/:id (étape 3B.1).
//  Route réelle, PostgreSQL réel. Données entièrement fictives.
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

const PORT = 55465;
const DATA = path.join(os.tmpdir(), "vq-confsession-" + process.pid);
const MODELE_NOM = "Attestation";

let cluster, pool, serveur, origine, adminId, contribId;
const ID = {};

const cookie = (uid) => "vq_session=" + encode({ uid, exp: Date.now() + 60_000 });
const A = () => ({ cookie: cookie(adminId) });
const C = () => ({ cookie: cookie(contribId) });

async function api(methode, chemin, corps, enTetes = {}) {
  const r = await fetch(origine + chemin, {
    method: methode,
    headers: { "Content-Type": "application/json", ...enTetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  return { statut: r.status, corps: await r.json().catch(() => null), texte: null };
}

// Document généré dans la session, identifiable par son identifiant Drive, son nom et son URL.
let prochainStagiaire = 0;
async function documentGenere(nom, { preuves = [], document = true }) {
  // Une génération par stagiaire (clé d'unicité de documents_generes).
  const { rows: [st] } = await pool.query("INSERT INTO stagiaires (nom, prenom) VALUES ($1, 'Test') RETURNING id", ["St" + (++prochainStagiaire)]);
  const drive = "DRV-" + nom;
  const url = "https://drive.google.com/file/d/" + drive + "/view";
  let documentId = null;
  if (document) {
    const { rows: [d] } = await pool.query(
      "INSERT INTO documents (drive_file_id, drive_url, drive_nom, source) VALUES ($1, $2, $3, 'generation') RETURNING id",
      [drive, url, "NOM-" + nom]
    );
    documentId = d.id;
    await pool.query("INSERT INTO document_versions (document_id, numero, drive_file_id, drive_url, drive_nom) VALUES ($1, 1, $2, $3, $4)",
      [documentId, drive, url, "NOM-" + nom]);
    for (const p of preuves) {
      await pool.query("INSERT INTO preuve_documents (preuve_id, document_id, origine, version_validee) VALUES ($1, $2, 'generation', 1)", [p, documentId]);
    }
  }
  await pool.query(
    `INSERT INTO documents_generes (modele_id, session_id, stagiaire_id, drive_file_id, drive_url, nom, document_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [ID.modele, ID.session, st.id, drive, url, "NOM-" + nom, documentId]
  );
  return { drive, url, nom: "NOM-" + nom };
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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@c.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@c.local', 'Tukui', 'contributeur') RETURNING id"));
  const indicateur = (await pool.query("SELECT i.id FROM indicateurs i ORDER BY i.id LIMIT 1")).rows[0].id;
  await pool.query("INSERT INTO formations (id, intitule) VALUES (1, 'Formation C')");
  ({ rows: [{ id: ID.session }] } = await pool.query("INSERT INTO sessions (formation_id, reference, date_debut, date_fin) VALUES (1, 'SESS-C', '2026-01-05', '2026-03-05') RETURNING id"));
  ({ rows: [{ id: ID.modele }] } = await pool.query(`INSERT INTO modeles_documents (nom, drive_file_id, drive_mime, portee, actif)
    VALUES ($1, 'MODELE-C', 'application/vnd.google-apps.document', 'session', true) RETURNING id`, [MODELE_NOM]));
  ({ rows: [{ id: ID.pPublique }] } = await pool.query("INSERT INTO preuves (indicateur_id, titre, statut, session_id) VALUES ($1, 'Publique', 'maitrise', $2) RETURNING id", [indicateur, ID.session]));
  ({ rows: [{ id: ID.pConf }] } = await pool.query("INSERT INTO preuves (indicateur_id, titre, statut, session_id) VALUES ($1, 'Confidentielle', 'maitrise', $2) RETURNING id", [indicateur, ID.session]));
  await pool.query("INSERT INTO preuves_confidentielles (preuve_id) VALUES ($1)", [ID.pConf]);

  ID.docPublic = await documentGenere("PUBLIC", { preuves: [ID.pPublique] });
  ID.docMixte = await documentGenere("MIXTE", { preuves: [ID.pPublique, ID.pConf] });
  ID.docConf = await documentGenere("CONF", { preuves: [ID.pConf] });
  ID.docLegacy = await documentGenere("LEGACY", { document: false });

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

test("contributeur : seul le document visible est listé, avec son nom et son URL", async () => {
  const r = await api("GET", `/api/sessions/${ID.session}`, undefined, C());
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.documents.length, 1, "un seul document visible");
  assert.equal(r.corps.documents[0].nom, ID.docPublic.nom);
  assert.equal(r.corps.documents[0].drive_url, ID.docPublic.url);
});

test("contributeur : aucun nom, URL, identifiant Drive ni métadonnée d'un document confidentiel ou partagé avec du confidentiel", async () => {
  const r = await api("GET", `/api/sessions/${ID.session}`, undefined, C());
  const texte = JSON.stringify(r.corps);
  for (const doc of [ID.docMixte, ID.docConf, ID.docLegacy]) {
    assert.equal(texte.includes(doc.drive), false, `identifiant Drive ${doc.drive} absent`);
    assert.equal(texte.includes(doc.url), false, `URL absente`);
    assert.equal(texte.includes(doc.nom), false, `nom ${doc.nom} absent`);
  }
});

test("document partagé entre une preuve publique et une preuve confidentielle : invisible du contributeur, y compris via la preuve publique", async () => {
  const preuvePublique = await api("GET", `/api/preuves/${ID.pPublique}`, undefined, C());
  assert.equal(preuvePublique.statut, 200);
  assert.equal(JSON.stringify(preuvePublique.corps).includes(ID.docMixte.drive), false, "pas de fichier partagé exposé sur la preuve publique");
  assert.equal(JSON.stringify(preuvePublique.corps).includes(ID.docMixte.nom), false);
});

test("administrateur : tous les documents de la session, avec leurs métadonnées", async () => {
  const r = await api("GET", `/api/sessions/${ID.session}`, undefined, A());
  assert.equal(r.statut, 200);
  const noms = r.corps.documents.map((d) => d.nom).sort();
  assert.deepEqual(noms, [ID.docConf.nom, ID.docLegacy.nom, ID.docMixte.nom, ID.docPublic.nom].sort());
});
