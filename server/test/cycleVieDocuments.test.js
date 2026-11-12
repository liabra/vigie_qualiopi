// ─────────────────────────────────────────────────────────────
//  Cycle de vie documentaire (étape 3C) : archivage, corbeille de version,
//  rattachements formations. Routes réelles, PostgreSQL réel, Drive SIMULÉ
//  (toute écriture Drive est enregistrée). Données entièrement fictives.
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
import { driveConforme, RACINE_TEST } from "./helpers/driveConforme.js";

const PORT = 55466;
const DATA = path.join(os.tmpdir(), "vq-cycle-" + process.pid);

let cluster, pool, serveur, origine, adminId, contribId;
let indicateur, session, formation;
let driveActif = null;
let ecritures = [];      // écritures Drive (update) observées
let echecCorbeille = false;

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

function driveAvecEcritures() {
  const d = driveConforme(() => ({ name: "Fiche.pdf", mimeType: "application/pdf" }));
  d.files.update = async ({ fileId, requestBody }) => {
    if (echecCorbeille) throw Object.assign(new Error("Drive indisponible"), { status: 500 });
    ecritures.push({ fileId, trashed: requestBody?.trashed === true });
    return { data: {} };
  };
  for (const m of ["delete", "copy", "create"]) {
    d.files[m] = async () => { ecritures.push({ fileId: null, methode: m }); throw new Error("interdit : " + m); };
  }
  return { drive: d, row: { scopes: "", email: "vigie@compte.test" } };
}

// Crée un document rattaché à une preuve, par la route réelle (contrôle Drive simulé conforme).
async function documentRattache(fichier, preuve) {
  driveActif = driveAvecEcritures();
  const r = await api("POST", `/api/preuves/${preuve}/documents`, { drive_file_id: fichier }, A());
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  return (await lire("SELECT id FROM documents WHERE drive_file_id = $1", [fichier]))[0].id;
}

async function preuve(titre, statut = "maitrise", extra = {}) {
  const { rows: [p] } = await pool.query(
    "INSERT INTO preuves (indicateur_id, titre, statut, session_id, mode_fichiers) VALUES ($1, $2, $3, $4, 'multiple') RETURNING id",
    [indicateur, titre, statut, session]
  );
  if (extra.confidentielle) await pool.query("INSERT INTO preuves_confidentielles (preuve_id) VALUES ($1)", [p.id]);
  return p.id;
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
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@v.local', 'Tukui', 'contributeur') RETURNING id"));
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
  await fs.rm(DATA, { recursive: true, force: true }).catch(() => {});
});

// ── Archivage et restauration (R9) ───────────────────────────

test("archivage refusé tant qu'un lien existe ; accepté après détachement ; historique intact", async () => {
  const p = await preuve("Archivage A");
  const d = await documentRattache("F_ARCH_A", p);
  const versionsAvant = (await lire("SELECT count(*)::int n FROM document_versions WHERE document_id = $1", [d]))[0].n;

  const refus = await api("POST", `/api/documents/${d}/archiver`, undefined, A());
  assert.equal(refus.statut, 409);
  assert.equal(refus.corps.code, "liens_actifs");
  assert.deepEqual(refus.corps.details.preuves, [p]);

  assert.equal((await api("DELETE", `/api/preuves/${p}/documents/${d}`, undefined, A())).statut, 200);
  const ok = await api("POST", `/api/documents/${d}/archiver`, undefined, A());
  assert.equal(ok.statut, 200);
  assert.ok((await lire("SELECT archive_le FROM documents WHERE id = $1", [d]))[0].archive_le);
  assert.equal((await lire("SELECT count(*)::int n FROM document_versions WHERE document_id = $1", [d]))[0].n, versionsAvant, "historique conservé");
});

test("document archivé : rattachement, remplacement refusés ; restauration possible puis refusée si non archivé", async () => {
  const d = (await lire("SELECT id FROM documents WHERE drive_file_id = 'F_ARCH_A'"))[0].id;
  const p = await preuve("Archivage B");
  driveActif = driveAvecEcritures();
  const att = await api("POST", `/api/preuves/${p}/documents`, { document_id: d }, A());
  assert.equal(att.statut, 409);
  assert.equal(att.corps.code, "document_archive");
  const rem = await api("POST", `/api/documents/${d}/remplacer`, { drive_file_id: "F_ARCH_NOUVEAU", version_attendue: 1 }, A());
  assert.equal(rem.statut, 409);
  assert.equal(rem.corps.code, "document_archive");

  const restaure = await api("POST", `/api/documents/${d}/restaurer`, undefined, A());
  assert.equal(restaure.statut, 200);
  assert.equal((await api("POST", `/api/documents/${d}/restaurer`, undefined, A())).corps.code, "document_non_archive");
});

test("archivage déjà fait : refusé ; document inconnu : 404", async () => {
  const d = (await lire("SELECT id FROM documents WHERE drive_file_id = 'F_ARCH_A'"))[0].id;
  await api("POST", `/api/documents/${d}/archiver`, undefined, A());
  assert.equal((await api("POST", `/api/documents/${d}/archiver`, undefined, A())).corps.code, "document_deja_archive");
  assert.equal((await api("POST", "/api/documents/999999/archiver", undefined, A())).statut, 404);
});

test("transaction : un échec pendant l'archivage ne laisse aucune trace partielle", async () => {
  const p = await preuve("Archivage C");
  const d = await documentRattache("F_ARCH_C", p);
  await api("DELETE", `/api/preuves/${p}/documents/${d}`, undefined, A());
  await pool.query(`
    CREATE OR REPLACE FUNCTION vq_echec_archive() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'échec injecté archivage'; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER vq_echec_archive_trg BEFORE UPDATE ON documents FOR EACH ROW
      WHEN (NEW.archive_le IS NOT NULL) EXECUTE FUNCTION vq_echec_archive();`);
  try {
    const r = await api("POST", `/api/documents/${d}/archiver`, undefined, A());
    assert.equal(r.statut, 500);
  } finally {
    await pool.query("DROP TRIGGER vq_echec_archive_trg ON documents; DROP FUNCTION vq_echec_archive();");
  }
  assert.equal((await lire("SELECT archive_le FROM documents WHERE id = $1", [d]))[0].archive_le, null, "aucun archivage partiel");
});

test("verrou global : l'archivage attend qu'une autre transaction du graphe se termine", async () => {
  const p = await preuve("Archivage verrou");
  const d = await documentRattache("F_ARCH_V", p);
  await api("DELETE", `/api/preuves/${p}/documents/${d}`, undefined, A());
  const tenant = await pool.connect();
  let libere = false;
  try {
    await tenant.query("BEGIN");
    await tenant.query("SELECT pg_advisory_xact_lock(7406001)");
    const requete = api("POST", `/api/documents/${d}/archiver`, undefined, A()).then((r) => {
      assert.ok(libere, "la route a attendu le verrou global");
      return r;
    });
    await new Promise((r) => setTimeout(r, 400));
    libere = true;
    await tenant.query("ROLLBACK");
    assert.equal((await requete).statut, 200);
  } finally {
    tenant.release();
  }
});

// ── Corbeille explicite d'une ancienne version (R5) ──────────

test("corbeille : version courante et sans confirmation refusées ; sans Drive, rien ne change", async () => {
  const p = await preuve("Corbeille A");
  const d = await documentRattache("F_COR_1", p);
  driveActif = driveAvecEcritures();
  await api("POST", `/api/documents/${d}/remplacer`, { drive_file_id: "F_COR_2", version_attendue: 1 }, A());

  assert.equal((await api("POST", `/api/documents/${d}/versions/2/corbeille`, { confirmer: true }, A())).corps.code, "version_courante");
  assert.equal((await api("POST", `/api/documents/${d}/versions/1/corbeille`, {}, A())).corps.code, "confirmation_requise");

  driveActif = null;
  const sansDrive = await api("POST", `/api/documents/${d}/versions/1/corbeille`, { confirmer: true }, A());
  assert.equal(sansDrive.statut, 503);
  assert.equal((await lire("SELECT corbeille_le FROM document_versions WHERE document_id = $1 AND numero = 1", [d]))[0].corbeille_le, null);
});

test("corbeille : un fichier encore utilisé par une génération est refusé", async () => {
  const p = await preuve("Corbeille B");
  const d = await documentRattache("F_COR_B1", p);
  driveActif = driveAvecEcritures();
  await api("POST", `/api/documents/${d}/remplacer`, { drive_file_id: "F_COR_B2", version_attendue: 1 }, A());
  const { rows: [m] } = await pool.query("INSERT INTO modeles_documents (nom, drive_file_id, drive_mime, portee) VALUES ('M corbeille', 'MOD-COR', 'application/vnd.google-apps.document', 'session') RETURNING id");
  await pool.query("INSERT INTO documents_generes (modele_id, session_id, drive_file_id, drive_url, nom, document_id) VALUES ($1, $2, 'F_COR_B1', 'https://x', 'gen', $3)", [m.id, session, d]);
  const r = await api("POST", `/api/documents/${d}/versions/1/corbeille`, { confirmer: true }, A());
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, "fichier_encore_utilise");
  assert.equal(ecritures.filter((e) => e.fileId === "F_COR_B1").length, 0, "aucun appel Drive");
});

test("corbeille réussie : seul l'ancien fichier est mis à la corbeille, la version reste dans l'historique", async () => {
  const p = await preuve("Corbeille C");
  const d = await documentRattache("F_COR_C1", p);
  driveActif = driveAvecEcritures();
  await api("POST", `/api/documents/${d}/remplacer`, { drive_file_id: "F_COR_C2", version_attendue: 1 }, A());
  ecritures = [];
  const r = await api("POST", `/api/documents/${d}/versions/1/corbeille`, { confirmer: true }, A());
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.deepEqual(ecritures, [{ fileId: "F_COR_C1", trashed: true }], "une seule écriture Drive, sur l'ancien fichier");
  const v = (await lire("SELECT corbeille_le, drive_file_id FROM document_versions WHERE document_id = $1 AND numero = 1", [d]))[0];
  assert.ok(v.corbeille_le, "marquée à la corbeille");
  assert.equal(v.drive_file_id, "F_COR_C1", "identité de la version conservée");
  assert.equal((await lire("SELECT drive_file_id FROM documents WHERE id = $1", [d]))[0].drive_file_id, "F_COR_C2", "version courante intacte");
  assert.equal((await api("POST", `/api/documents/${d}/versions/1/corbeille`, { confirmer: true }, A())).corps.code, "deja_a_la_corbeille");
});

test("corbeille : un échec Drive ne modifie pas la base et l'opération peut être rejouée", async () => {
  const p = await preuve("Corbeille D");
  const d = await documentRattache("F_COR_D1", p);
  driveActif = driveAvecEcritures();
  await api("POST", `/api/documents/${d}/remplacer`, { drive_file_id: "F_COR_D2", version_attendue: 1 }, A());
  echecCorbeille = true;
  try {
    const r = await api("POST", `/api/documents/${d}/versions/1/corbeille`, { confirmer: true }, A());
    assert.equal(r.statut, 503);
    assert.equal(r.corps.code, "corbeille_echec");
    assert.equal((await lire("SELECT corbeille_le FROM document_versions WHERE document_id = $1 AND numero = 1", [d]))[0].corbeille_le, null);
  } finally {
    echecCorbeille = false;
  }
  const refusDouble = await api("POST", `/api/documents/${d}/versions/1/corbeille`, { confirmer: true }, A());
  assert.equal(refusDouble.corps.code, "corbeille_en_attente", "pas de seconde demande pendant l'attente");
  const rep = await api("POST", "/api/corbeille/reprise", undefined, A());
  assert.equal(rep.statut, 200);
  assert.ok(await lire("SELECT corbeille_le FROM document_versions WHERE document_id = $1 AND numero = 1", [d]).then((r) => r[0].corbeille_le));
});

test("corbeille : contributeur refusé (403)", async () => {
  const d = (await lire("SELECT id FROM documents WHERE drive_file_id = 'F_COR_C2'"))[0].id;
  assert.equal((await api("POST", `/api/documents/${d}/versions/1/corbeille`, { confirmer: true }, C())).statut, 403);
});

// ── Rattachements formations ─────────────────────────────────

test("rattachement manuel à une formation, doublon refusé, détachement sans effet sur les preuves", async () => {
  const p = await preuve("Formation A");
  const d = await documentRattache("F_FOR_A", p);
  const ok = await api("POST", `/api/documents/${d}/formations`, { formation_id: formation }, A());
  assert.equal(ok.statut, 201, JSON.stringify(ok.corps));
  assert.equal((await api("POST", `/api/documents/${d}/formations`, { formation_id: formation }, A())).corps.code, "deja_rattache");
  assert.equal((await api("POST", `/api/documents/${d}/formations`, { formation_id: 999999 }, A())).statut, 404);

  const detail = await api("GET", `/api/documents/${d}`, undefined, A());
  assert.equal(detail.corps.formations[0].formation_id, formation);

  assert.equal((await api("DELETE", `/api/documents/${d}/formations/${formation}`, undefined, A())).statut, 200);
  assert.equal((await lire("SELECT count(*)::int n FROM preuve_documents WHERE preuve_id = $1", [p]))[0].n, 1, "les preuves ne sont pas touchées");
  assert.equal((await api("DELETE", `/api/documents/${d}/formations/${formation}`, undefined, A())).statut, 404);
});

test("association dérivée : validation humaine, puis validation refusée une seconde fois", async () => {
  const p = await preuve("Formation B");
  const d = await documentRattache("F_FOR_B", p);
  await pool.query("INSERT INTO document_formations (document_id, formation_id, origine) VALUES ($1, $2, 'derive_session')", [d, formation]);
  const avant = await lire("SELECT valide_le FROM document_formations WHERE document_id = $1", [d]);
  assert.equal(avant[0].valide_le, null, "dérivé : à valider");
  assert.equal((await api("POST", `/api/documents/${d}/formations/${formation}/valider`, undefined, A())).statut, 200);
  assert.ok((await lire("SELECT valide_le FROM document_formations WHERE document_id = $1", [d]))[0].valide_le);
  assert.equal((await api("POST", `/api/documents/${d}/formations/${formation}/valider`, undefined, A())).statut, 404);
});

test("formations : contributeur refusé en écriture, et voit seulement les documents visibles", async () => {
  const p = await preuve("Formation C");
  const d = await documentRattache("F_FOR_C", p);
  assert.equal((await api("POST", `/api/documents/${d}/formations`, { formation_id: formation }, C())).statut, 403);
  const confidentiel = await preuve("Formation confidentielle", "maitrise", { confidentielle: true });
  const dConf = await documentRattache("F_FOR_CONF", confidentiel);
  const liste = await api("GET", `/api/formations/${formation}/documents`, undefined, C());
  assert.equal(liste.statut, 200);
  assert.equal(liste.corps.documents.some((x) => x.id === dConf), false, "document confidentiel invisible");
  assert.equal(liste.corps.documents.some((x) => x.id === d), true, "document visible présent");
  const admin = await api("GET", `/api/formations/${formation}/documents`, undefined, A());
  assert.equal(admin.corps.documents.some((x) => x.id === dConf), true);
});

// ── Garde-fous globaux ───────────────────────────────────────

test("aucune suppression Drive involontaire sur l'ensemble des opérations de ce fichier", () => {
  assert.equal(ecritures.some((e) => e.methode === "delete" || e.methode === "create"), false);
  assert.ok(ecritures.every((e) => e.trashed === true), "toute écriture Drive est une mise à la corbeille");
});
