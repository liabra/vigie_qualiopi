// ─────────────────────────────────────────────────────────────
//  Routes documentaires et intégration des anciens sites d'écriture (étape 3B).
//  PostgreSQL RÉEL, application Express RÉELLE, Drive SIMULÉ (conforme ou non).
//  Données entièrement fictives.
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
import { driveConforme, RACINE_TEST } from "./helpers/driveConforme.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 55462;
const DATA = path.join(os.tmpdir(), "vq-routes-" + process.pid);

let cluster, pool, serveur, origine, adminId, contribId, indicateurs;
let driveActif = null; // fabrique Drive courante (null = non connecté)
const appelsDrive = [];

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

// Drive simulé : `horsRacine` / `permissionsOuvertes` = identifiants de fichiers à rendre non conformes.
function driveSimule({ horsRacine = [], permissionsOuvertes = [] } = {}) {
  const d = driveConforme((id) => {
    if (id === "AILLEURS") return { parents: [] };
    if (horsRacine.includes(id)) return { parents: ["AILLEURS"] };
    return { name: "Fiche-" + id + ".pdf", mimeType: "application/pdf" };
  });
  const base = d.permissions.list;
  d.permissions.list = async (args) => {
    const r = await base(args);
    if (permissionsOuvertes.includes(args.fileId)) r.data.permissions.push({ id: "ouvert", type: "anyone", role: "reader" });
    return r;
  };
  for (const methode of ["update", "delete", "copy", "create"]) {
    d.files[methode] = async (...args) => {
      appelsDrive.push(methode);
      throw new Error("Interdit dans ce test : " + methode);
    };
  }
  return { drive: d };
}

async function preuve(titre, indicateur, statut = "maitrise", extra = {}) {
  const { rows: [p] } = await pool.query(
    "INSERT INTO preuves (indicateur_id, titre, statut, mode_fichiers, session_id, groupe_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    [indicateur, titre, statut, extra.mode || "multiple", extra.session ?? null, extra.groupe ?? null]
  );
  return p.id;
}

const statutDe = async (id) => (await lire("SELECT statut, statut_avant_remplacement FROM preuves WHERE id = $1", [id]))[0];
const documentDe = async (fichier) => (await lire("SELECT id FROM documents WHERE drive_file_id = $1", [fichier]))[0]?.id;

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
  indicateurs = (await pool.query("SELECT i.id FROM indicateurs i ORDER BY i.id LIMIT 6")).rows.map((r) => r.id);
  await pool.query("INSERT INTO formations (id, intitule) VALUES (1, 'Formation R')");
  await pool.query("INSERT INTO sessions (id, formation_id, date_debut, date_fin) VALUES (1, 1, '2025-01-01', '2025-01-02')");

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

// ── Création et rattachement ─────────────────────────────────

test("création d'une preuve avec un fichier conforme : un document, un lien, un miroir legacy", async () => {
  driveActif = driveSimule();
  const r = await api("POST", "/api/preuves", { indicateur_id: indicateurs[0], titre: "Émargement A", statut: "maitrise", mode_fichiers: "multiple", session_id: 1, drive_file_id: "F_CREA", drive_nom: "Émargement.pdf" }, A());
  assert.equal(r.statut, 201, JSON.stringify(r.corps));
  const id = r.corps.preuves[0].id;
  assert.ok(await documentDe("F_CREA"), "document créé");
  assert.equal((await lire("SELECT count(*)::int n FROM preuve_documents WHERE preuve_id = $1", [id]))[0].n, 1);
  assert.equal((await lire("SELECT count(*)::int n FROM preuve_fichiers WHERE preuve_id = $1 AND drive_file_id = 'F_CREA'", [id]))[0].n, 1, "miroir legacy");
});

test("un même fichier rattaché à une autre preuve : même document, aucun doublon", async () => {
  const p2 = await preuve("Autre preuve", indicateurs[1], "maitrise", { session: 1 });
  const r = await api("POST", `/api/preuves/${p2}/documents`, { drive_file_id: "F_CREA" }, A());
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal((await lire("SELECT count(*)::int n FROM documents WHERE drive_file_id = 'F_CREA'"))[0].n, 1);
  assert.equal((await lire("SELECT count(*)::int n FROM preuve_documents WHERE document_id = $1", [await documentDe("F_CREA")]))[0].n, 2);
});

test("un fichier hors de la racine Vigie est refusé (409) : rien n'est créé", async () => {
  driveActif = driveSimule({ horsRacine: ["F_HORS"] });
  const p = await preuve("Hors racine", indicateurs[2], "maitrise", { session: 1 });
  const r = await api("POST", `/api/preuves/${p}/documents`, { drive_file_id: "F_HORS" }, A());
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, "fichier_hors_racine");
  assert.equal(await documentDe("F_HORS"), undefined);
});

test("permissions non conformes (partage ouvert) : 409 sans adresse dans la réponse", async () => {
  driveActif = driveSimule({ permissionsOuvertes: ["F_OUVERT"] });
  const p = await preuve("Partage ouvert", indicateurs[2], "maitrise", { session: 1 });
  const r = await api("POST", `/api/preuves/${p}/documents`, { drive_file_id: "F_OUVERT" }, A());
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, "permissions_non_conformes");
  assert.equal(JSON.stringify(r.corps).includes("@"), false);
  assert.equal(await documentDe("F_OUVERT"), undefined);
});

test("Drive non connecté : 503 explicite, aucune écriture", async () => {
  driveActif = null;
  const p = await preuve("Sans Drive", indicateurs[2], "maitrise", { session: 1 });
  const r = await api("POST", `/api/preuves/${p}/documents`, { drive_file_id: "F_SANS_DRIVE" }, A());
  assert.equal(r.statut, 503);
  assert.equal(r.corps.code, "drive_indisponible");
  assert.equal(await documentDe("F_SANS_DRIVE"), undefined);
});

test("document existant rattaché par son identifiant : aucun contrôle Drive requis", async () => {
  driveActif = null; // Drive indisponible : le rattachement par document_id ne doit pas en dépendre
  const p = await preuve("Par identifiant", indicateurs[3], "maitrise", { session: 1 });
  const r = await api("POST", `/api/preuves/${p}/documents`, { document_id: await documentDe("F_CREA") }, A());
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
});

// ── Droits ───────────────────────────────────────────────────

test("contributeur : aucune écriture documentaire (403), anonyme : 401", async () => {
  driveActif = driveSimule();
  const p = await preuve("Droits", indicateurs[4], "maitrise", { session: 1 });
  assert.equal((await api("POST", `/api/preuves/${p}/documents`, { drive_file_id: "F_DROIT" }, C())).statut, 403);
  assert.equal((await api("POST", `/api/documents/${await documentDe("F_CREA")}/remplacer`, { drive_file_id: "F_DROIT", version_attendue: 1 }, C())).statut, 403);
  assert.equal((await api("GET", "/api/documents")).statut, 401);
});

test("consultation : un contributeur ne voit pas un document confidentiel (404) ; l'admin voit les versions", async () => {
  driveActif = driveSimule();
  const pConf = await preuve("Confidentielle", indicateurs[5], "maitrise", { session: 1 });
  const docConf = await documentDe("F_CREA");
  assert.equal((await api("POST", `/api/preuves/${pConf}/documents`, { document_id: docConf }, A())).statut, 200);
  await pool.query("INSERT INTO preuves_confidentielles (preuve_id) VALUES ($1)", [pConf]);
  const pVisible = await preuve("Publique", indicateurs[5], "maitrise", { session: 1 });
  const d = await api("POST", `/api/preuves/${pVisible}/documents`, { document_id: docConf }, A());
  assert.equal(d.statut, 200);
  // Le document est lié à une preuve confidentielle : invisible du contributeur partout.
  assert.equal((await api("GET", `/api/documents/${docConf}`, undefined, C())).statut, 404);
  const liste = await api("GET", "/api/documents", undefined, C());
  assert.equal(liste.corps.documents.some((x) => x.id === docConf), false);
  const admin = await api("GET", `/api/documents/${docConf}`, undefined, A());
  assert.equal(admin.statut, 200);
  assert.ok(Array.isArray(admin.corps.versions), "les versions ne sont visibles que de l'admin");
});

// ── Remplacement, détachement, revalidation ──────────────────

test("remplacement : nouvelle version, preuves liées à revalider, ancien fichier jamais supprimé", async () => {
  driveActif = driveSimule();
  appelsDrive.length = 0;
  const id = await documentDe("F_CREA");
  const r = await api("POST", `/api/documents/${id}/remplacer`, { drive_file_id: "F_CREA_V2", version_attendue: 1, motif: "Nouvelle signature" }, A());
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(r.corps.version, 2);
  assert.equal(appelsDrive.length, 0, "aucune opération Drive d'écriture");
  const preuves = await lire("SELECT preuve_id FROM preuve_documents WHERE document_id = $1", [id]);
  for (const { preuve_id } of preuves) {
    assert.equal((await statutDe(preuve_id)).statut, "a_consolider");
  }
  const miroir = await lire("SELECT count(*)::int n FROM preuve_fichiers WHERE drive_file_id = 'F_CREA_V2'");
  assert.equal(miroir[0].n, preuves.length, "miroir legacy sur le fichier courant");
});

test("remplacement avec une version attendue périmée : 409 version_obsolete", async () => {
  driveActif = driveSimule();
  const id = await documentDe("F_CREA_V2");
  const r = await api("POST", `/api/documents/${id}/remplacer`, { drive_file_id: "F_CREA_V3", version_attendue: 1 }, A());
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, "version_obsolete");
});

test("remplacement par un fichier hors racine : 409, aucune version créée", async () => {
  driveActif = driveSimule({ horsRacine: ["F_HORS_REMP"] });
  const id = await documentDe("F_CREA_V2");
  const avant = (await lire("SELECT count(*)::int n FROM document_versions WHERE document_id = $1", [id]))[0].n;
  const r = await api("POST", `/api/documents/${id}/remplacer`, { drive_file_id: "F_HORS_REMP", version_attendue: 2 }, A());
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, "fichier_hors_racine");
  assert.equal((await lire("SELECT count(*)::int n FROM document_versions WHERE document_id = $1", [id]))[0].n, avant);
});

test("détacher un document garde le document et ses versions", async () => {
  driveActif = driveSimule();
  const id = await documentDe("F_CREA_V2");
  const lien = (await lire("SELECT preuve_id FROM preuve_documents WHERE document_id = $1 ORDER BY preuve_id LIMIT 1", [id]))[0];
  const r = await api("DELETE", `/api/preuves/${lien.preuve_id}/documents/${id}`, undefined, A());
  assert.equal(r.statut, 200);
  assert.equal((await lire("SELECT count(*)::int n FROM documents WHERE id = $1", [id]))[0].n, 1);
  assert.equal((await lire("SELECT count(*)::int n FROM document_versions WHERE document_id = $1", [id]))[0].n, 2);
});

test("revalidation : idempotente, et PATCH maîtrisé refusé tant qu'un lien est en attente", async () => {
  driveActif = driveSimule();
  const id = await documentDe("F_CREA_V2");
  const liens = await lire("SELECT preuve_id FROM preuve_documents WHERE document_id = $1 ORDER BY preuve_id", [id]);
  const p = liens[0].preuve_id;
  const bloque = await api("PATCH", `/api/preuves/${p}`, { statut: "maitrise" }, A());
  assert.equal(bloque.statut, 409);
  assert.equal(bloque.corps.code, "revalidations_en_attente");
  assert.deepEqual(bloque.corps.details.documents, [id]);

  const premiere = await api("POST", `/api/preuves/${p}/documents/${id}/revalider`, undefined, A());
  assert.equal(premiere.statut, 200);
  assert.equal(premiere.corps.revalide, true);
  const seconde = await api("POST", `/api/preuves/${p}/documents/${id}/revalider`, undefined, A());
  assert.equal(seconde.statut, 200);
  assert.equal(seconde.corps.revalide, false, "idempotent");
  assert.equal((await statutDe(p)).statut, "maitrise", "restauration après revalidation");
});

test("changement groupé vers maîtrisé : tout ou rien en présence d'une attente", async () => {
  driveActif = driveSimule();
  const id = await documentDe("F_CREA_V2");
  const [a, b] = (await lire("SELECT preuve_id FROM preuve_documents WHERE document_id = $1 ORDER BY preuve_id", [id])).map((r) => r.preuve_id);
  const libre = await preuve("Libre", indicateurs[0], "a_risque", { session: 1 });
  await api("POST", `/api/documents/${id}/remplacer`, { drive_file_id: "F_CREA_V4", version_attendue: 2 }, A());
  const avant = await statutDe(libre);
  const r = await api("PATCH", "/api/preuves", { ids: [libre, a], statut: "maitrise" }, A());
  assert.equal(r.statut, 409);
  assert.deepEqual(await statutDe(libre), avant, "la preuve sans attente n'a pas été modifiée");
});

test("statut manuel explicite : efface la restauration", async () => {
  const p = await preuve("Manuel", indicateurs[1], "maitrise", { session: 1 });
  const d = await documentDe("F_CREA_V4");
  await api("POST", `/api/preuves/${p}/documents`, { document_id: d }, A());
  await pool.query("UPDATE preuves SET statut = 'a_consolider', statut_avant_remplacement = 'maitrise' WHERE id = $1", [p]);
  const r = await api("PATCH", `/api/preuves/${p}`, { statut: "a_risque" }, A());
  assert.equal(r.statut, 200);
  assert.deepEqual(await statutDe(p), { statut: "a_risque", statut_avant_remplacement: null });
});

test("suppression d'un fichier legacy : détache le lien, garde le document", async () => {
  driveActif = driveSimule();
  const p = await preuve("Pièce à retirer", indicateurs[2], "maitrise", { session: 1, mode: "multiple" });
  await api("POST", `/api/preuves/${p}/fichiers`, { drive_file_id: "F_RETIRE" }, A());
  const legacy = (await lire("SELECT id FROM preuve_fichiers WHERE preuve_id = $1 AND drive_file_id = 'F_RETIRE'", [p]))[0];
  const r = await api("DELETE", `/api/preuves/${p}/fichiers/${legacy.id}`, undefined, A());
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal((await lire("SELECT count(*)::int n FROM preuve_documents WHERE preuve_id = $1", [p]))[0].n, 0);
  assert.ok(await documentDe("F_RETIRE"), "le document reste");
});

test("suppression d'une preuve : les documents restent", async () => {
  const p = await preuve("À supprimer", indicateurs[3], "maitrise", { session: 1 });
  const d = await documentDe("F_CREA_V4");
  await api("POST", `/api/preuves/${p}/documents`, { document_id: d }, A());
  assert.equal((await api("DELETE", `/api/preuves/${p}`, undefined, A())).statut, 200);
  assert.ok(await documentDe("F_CREA_V4"));
});

// ── Verrou global : aucun contournement ──────────────────────

test("le verrou global est respecté : une route d'écriture attend qu'une transaction le libère", async () => {
  const p = await preuve("Verrou", indicateurs[4], "maitrise", { session: 1 });
  const tenant = await pool.connect();
  let libere = false;
  try {
    await tenant.query("BEGIN");
    await tenant.query("SELECT pg_advisory_xact_lock(7406001)");
    const requete = api("PATCH", `/api/preuves/${p}`, { titre: "Changé sous verrou" }, A()).then((r) => { assert.ok(libere, "la route a attendu le verrou"); return r; });
    await new Promise((r) => setTimeout(r, 400));
    libere = true;
    await tenant.query("ROLLBACK");
    const r = await requete;
    assert.equal(r.statut, 200);
  } finally {
    tenant.release();
  }
});

// ── Concurrence HTTP ─────────────────────────────────────────

test("deux changements de statut simultanés sur une même preuve : réponses cohérentes, aucune erreur serveur", async () => {
  const p = await preuve("Course HTTP", indicateurs[5], "a_risque", { session: 1 });
  const [r1, r2] = await Promise.all([
    api("PATCH", `/api/preuves/${p}`, { statut: "a_consolider" }, A()),
    api("PATCH", `/api/preuves/${p}`, { statut: "non_applicable" }, A()),
  ]);
  assert.ok([r1.statut, r2.statut].every((s) => s === 200), "les deux sont acceptés, sans 500");
  assert.ok(["a_consolider", "non_applicable"].includes((await statutDe(p)).statut));
});

// ── Garde-fou structurel : aucune écriture directe hors du service ─

test("aucune écriture directe des tables documentaires legacy ni du statut hors du service central", async () => {
  const racine = path.resolve(HERE, "../src");
  const fichiers = [];
  const parcourir = async (dossier) => {
    for (const e of await fs.readdir(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, e.name);
      if (e.isDirectory()) await parcourir(chemin);
      else if (e.name.endsWith(".js")) fichiers.push(chemin);
    }
  };
  await parcourir(racine);
  const service = path.join(racine, "services", "documentsPreuves.js");
  for (const f of fichiers) {
    if (f === service) continue;
    const texte = await fs.readFile(f, "utf8");
    assert.ok(!/(INSERT INTO|UPDATE|DELETE FROM) preuve_fichiers\b/.test(texte), `écriture legacy directe dans ${path.relative(racine, f)}`);
    assert.ok(!/(INSERT INTO|UPDATE|DELETE FROM) preuve_documents\b/.test(texte), `écriture de lien directe dans ${path.relative(racine, f)}`);
    assert.ok(!/UPDATE (document_versions|documents)\b/.test(texte), `écriture documentaire directe dans ${path.relative(racine, f)}`);
    const statut = texte.match(/UPDATE preuves SET[^`"']*\bstatut\b/g) || [];
    assert.deepEqual(statut, [], `écriture de statut directe dans ${path.relative(racine, f)}`);
  }
});
