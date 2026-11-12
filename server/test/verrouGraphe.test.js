// ─────────────────────────────────────────────────────────────
//  Verrou global du graphe documentaire (étape 3C.1).
//  Preuve que les opérations formations et corbeille prennent le verrou global EN PREMIER,
//  et garde-fou statique : aucune écriture du graphe hors d'une fonction verrouillée.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { setPoolFactory, setQueryExecutor } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { seedReferentiel } from "../src/seed.js";
import { createApp } from "../src/app.js";
import { encode } from "../src/session.js";
import { setDriveFactory } from "../src/services/google.js";
import { driveConforme } from "./helpers/driveConforme.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 55468;
const DATA = path.join(os.tmpdir(), "vq-verrou-" + process.pid);
const TABLES_GRAPHE = ["documents", "document_versions", "document_formations", "preuve_documents", "preuve_fichiers", "corbeille_operations"];

let cluster, pool, serveur, origine, adminId, indicateur, session, formation;
let driveActif = null;

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

function driveSimule() {
  const d = driveConforme(() => ({ name: "Fiche.pdf", mimeType: "application/pdf" }));
  d.files.update = async () => ({ data: {} });
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

async function documentRattache(nom) {
  driveActif = driveSimule();
  const p = await preuve(nom);
  const r = await api("POST", `/api/preuves/${p}/documents`, { drive_file_id: nom }, A());
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  return (await pool.query("SELECT id FROM documents WHERE drive_file_id = $1", [nom])).rows[0].id;
}

// Tient le verrou global ET le verrou de ligne du document ; lance la requête ; observe
// la PREMIÈRE attente de la requête. Si le verrou global est pris en premier, l'attente
// porte sur le verrou consultatif et non sur la ligne du document.
async function premiereAttente(documentId, requete) {
  const tenant = await pool.connect();
  let attentes;
  try {
    await tenant.query("BEGIN");
    await tenant.query("SELECT pg_advisory_xact_lock(7406001)");
    await tenant.query("SELECT id FROM documents WHERE id = $1 FOR UPDATE", [documentId]);
    const p = requete();
    await new Promise((r) => setTimeout(r, 500));
    attentes = (await pool.query(
      `SELECT query FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND datname = current_database() AND pid <> pg_backend_pid()`
    )).rows.map((r) => r.query);
    await tenant.query("ROLLBACK");
    const reponse = await p;
    return { attentes, reponse };
  } finally {
    tenant.release();
  }
}

function attenteSurVerrouGlobal(attentes) {
  assert.ok(attentes.some((q) => /pg_advisory_xact_lock/.test(q)), "la requête attend le verrou global : " + JSON.stringify(attentes));
  assert.ok(attentes.every((q) => !/FROM documents|documents WHERE|document_versions|preuve_documents/.test(q)),
    "aucune attente sur une ligne documentaire avant le verrou : " + JSON.stringify(attentes));
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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@v.local', 'Mme Stark', 'admin') RETURNING id"));
  indicateur = (await pool.query("SELECT i.id FROM indicateurs i ORDER BY i.id LIMIT 1")).rows[0].id;
  ({ rows: [{ id: formation }] } = await pool.query("INSERT INTO formations (intitule) VALUES ('Formation V') RETURNING id"));
  ({ rows: [{ id: session }] } = await pool.query("INSERT INTO sessions (formation_id, reference, date_debut, date_fin) VALUES ($1, 'SESS-V', '2026-01-05', '2026-03-05') RETURNING id", [formation]));
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

test("rattachement à une formation : le verrou global est pris avant toute ligne documentaire", async () => {
  const d = await documentRattache("V_FOR_1");
  const { attentes, reponse } = await premiereAttente(d, () => api("POST", `/api/documents/${d}/formations`, { formation_id: formation }, A()));
  attenteSurVerrouGlobal(attentes);
  assert.equal(reponse.statut, 201);
});

test("détachement d'une formation : le verrou global est pris avant toute ligne documentaire", async () => {
  const d = await documentRattache("V_FOR_2");
  await api("POST", `/api/documents/${d}/formations`, { formation_id: formation }, A());
  const { attentes, reponse } = await premiereAttente(d, () => api("DELETE", `/api/documents/${d}/formations/${formation}`, undefined, A()));
  attenteSurVerrouGlobal(attentes);
  assert.equal(reponse.statut, 200);
});

test("corbeille : le verrou global est pris avant toute ligne documentaire", async () => {
  const d = await documentRattache("V_COR_1");
  driveActif = driveSimule();
  const p = await preuve("Autre preuve corbeille");
  await api("POST", `/api/documents/${d}/remplacer`, { drive_file_id: "V_COR_2", version_attendue: 1 }, A());
  await api("POST", `/api/preuves/${p}/documents`, { document_id: d }, A());
  await api("DELETE", `/api/preuves/${p}/documents/${d}`, undefined, A());
  const { attentes, reponse } = await premiereAttente(d, () => api("POST", `/api/documents/${d}/versions/1/corbeille`, { confirmer: true }, A()));
  attenteSurVerrouGlobal(attentes);
  assert.equal(reponse.statut, 200, JSON.stringify(reponse.corps));
});

test("garde-fou : aucune écriture du graphe documentaire hors d'une fonction qui prend le verrou", async () => {
  const src = path.resolve(HERE, "../src");
  const regexEcriture = new RegExp(`(INSERT INTO|UPDATE|DELETE FROM) (${TABLES_GRAPHE.join("|")})\\b`);
  const garde = /verrouillerGraphe|insererDocument\(|changerStatut\(|verifierCorbeille\(/;

  // 1) Aucune écriture du graphe hors du service central et du module corbeille.
  const parcourir = async (dossier) => {
    const sortie = [];
    for (const e of await fs.readdir(dossier, { withFileTypes: true })) {
      const c = path.join(dossier, e.name);
      if (e.isDirectory()) sortie.push(...await parcourir(c));
      else if (e.name.endsWith(".js")) sortie.push(c);
    }
    return sortie;
  };
  const autorises = [path.join(src, "services", "documentsPreuves.js"), path.join(src, "services", "corbeille.js")];
  for (const f of await parcourir(src)) {
    if (autorises.includes(f)) continue;
    const texte = await fs.readFile(f, "utf8");
    assert.ok(!regexEcriture.test(texte), `écriture du graphe directe dans ${path.relative(src, f)}`);
  }

  // 2) Dans le service : chaque fonction exportée qui écrit appelle le verrou global.
  const texte = await fs.readFile(autorises[0], "utf8");
  const blocs = texte.split(/\n(?=export (?:async )?function )/).filter((b) => b.startsWith("export"));
  for (const bloc of blocs) {
    const nom = /export (?:async )?function (\w+)/.exec(bloc)[1];
    if (regexEcriture.test(bloc)) {
      assert.ok(garde.test(bloc), `la fonction ${nom} écrit dans le graphe sans verrou global`);
    }
  }

  // 3) Dans le module corbeille : chaque écriture passe par une fonction verrouillée.
  const corbeille = await fs.readFile(autorises[1], "utf8");
  for (const bloc of corbeille.split(/\n(?=(?:export )?(?:async )?function )/)) {
    if (/UPDATE corbeille_operations/.test(bloc)) {
      assert.ok(/verrouillerGraphe|transaction\(/.test(bloc), "écriture de corbeille_operations sans verrou : " + bloc.slice(0, 60));
    }
  }
});
