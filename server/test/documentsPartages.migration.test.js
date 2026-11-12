// ─────────────────────────────────────────────────────────────
//  Documents partagés — migration 034, réconciliation et rollback.
//  Base PostgreSQL RÉELLE (embedded) + schéma legacy rejoué dans l'ordre
//  des migrations 001–025. Données entièrement fictives.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(HERE, "../db/migrations");
const RECONCILIATION = path.resolve(HERE, "../db/reconciliation/034_reconciliation.sql");
const ROLLBACK = path.resolve(HERE, "../db/rollback/034_documents_partages.down.sql");
const FICHIER_034 = "034_documents_partages.sql";

const PORT = 55461;
const DATA = path.join(os.tmpdir(), "vq-docs-" + process.pid);

let cluster, pool;

async function appliquer(fichier, { sql, nom } = {}) {
  const texte = sql ?? await fs.readFile(path.join(MIGRATIONS, fichier), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(texte);
    if (nom) await client.query("INSERT INTO schema_migrations (nom) VALUES ($1)", [nom]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function jouer(chemin) {
  const texte = await fs.readFile(chemin, "utf8");
  const client = await pool.connect();
  try {
    await client.query(texte);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function lire(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

async function compter(table) {
  return (await lire(`SELECT count(*)::int AS n FROM ${table}`))[0].n;
}

// Empreintes des tables legacy : colonnes explicites, pour ne pas être
// sensibles à l'ajout de colonnes (statut_avant_remplacement, document_id).
async function empreintes() {
  const [pf] = await lire(`SELECT count(*)::int n, md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), '')) h
    FROM (SELECT id, preuve_id, drive_file_id, source, ajoute_le FROM preuve_fichiers) x`);
  const [pr] = await lire(`SELECT count(*)::int n, md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), '')) h
    FROM (SELECT id, titre, statut FROM preuves) x`);
  const [dg] = await lire(`SELECT count(*)::int n, md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), '')) h
    FROM (SELECT id, modele_id, drive_file_id, nom FROM documents_generes) x`);
  return { preuve_fichiers: pf, preuves: pr, documents_generes: dg };
}

async function statuts() {
  return lire("SELECT id, statut FROM preuves ORDER BY id");
}

// Jeu de données legacy, réaliste, avant migration 034.
async function seedLegacy() {
  await pool.query(`
    INSERT INTO referentiel_versions (id, code, libelle, est_active) VALUES (1, 'V9', 'Référentiel V9', true);
    INSERT INTO criteres (id, version_id, numero, libelle) VALUES (1, 1, 1, 'Critère 1');
    INSERT INTO indicateurs (id, version_id, critere_id, numero, libelle) VALUES
      (1, 1, 1, 1, 'Indicateur 1'), (2, 1, 1, 2, 'Indicateur 2'),
      (3, 1, 1, 3, 'Indicateur 3'), (4, 1, 1, 4, 'Indicateur 4');
    INSERT INTO utilisateurs (id, email, nom, role) VALUES (1, 'admin@test.local', 'Admin', 'admin');
    INSERT INTO formations (id, intitule) VALUES (1, 'Formation A'), (2, 'Formation B');
    INSERT INTO sessions (id, formation_id, date_debut, date_fin) VALUES
      (1, 1, '2025-01-01', '2025-01-02'), (2, 2, '2025-02-01', '2025-02-02');
    INSERT INTO groupes (id, session_id, nom) VALUES (1, 1, 'G1');
    INSERT INTO stagiaires (id, nom, prenom) VALUES (1, 'Test', 'Un'), (2, 'Test', 'Deux');
    INSERT INTO inscriptions (id, stagiaire_id, session_id, groupe_id) VALUES
      (1, 1, 1, 1), (2, 2, 1, 1), (3, 2, 2, NULL);
    INSERT INTO modeles_documents (id, nom, portee, drive_file_id) VALUES (1, 'Attestation', 'stagiaire', 'MODELE_1');
    INSERT INTO modele_indicateurs (modele_id, indicateur_id) VALUES (1, 1);
    INSERT INTO preuves (id, indicateur_id, titre, statut, session_id, groupe_id) VALUES
      (1, 1, 'P_a', 'maitrise', 1, NULL),
      (2, 2, 'P_b', 'maitrise', 1, NULL),
      (3, 3, 'P_c', 'maitrise', NULL, 1),
      (4, 4, 'P_d', 'a_risque', NULL, NULL),
      (5, 1, 'P_x', 'maitrise', 2, NULL),
      (6, 4, 'P_conf', 'maitrise', 1, NULL);
    INSERT INTO preuves_confidentielles (preuve_id) VALUES (6);
    INSERT INTO preuve_fichiers (preuve_id, drive_file_id, source, stagiaire_id) VALUES
      (1, 'F_shared', 'manuel', NULL), (2, 'F_shared', 'manuel', NULL), (5, 'F_shared', 'manuel', NULL),
      (1, 'F_import', 'import_drive', NULL),
      (6, 'F_conf', 'manuel', NULL), (1, 'F_conf', 'manuel', NULL),
      (4, 'F_solo', 'manuel', NULL),
      (3, 'F_group', 'manuel', NULL);
    INSERT INTO documents_generes (modele_id, session_id, groupe_id, stagiaire_id, drive_file_id, nom) VALUES
      (1, 1, NULL, 1, 'F_gen_s1', 'Attestation S1'),
      (1, NULL, NULL, 1, 'F_gen_st1', 'Attestation ST1'),
      (1, NULL, NULL, 2, 'F_gen_st2', 'Attestation ST2'),
      (1, NULL, NULL, NULL, 'F_gen_orphan', 'Attestation orpheline');
  `);
}

before(async () => {
  cluster = new EmbeddedPostgres({ databaseDir: DATA, port: PORT, user: "postgres", password: "postgres", persistent: false, onLog: () => {}, onError: () => {} });
  await cluster.initialise();
  await cluster.start();
  const racine = cluster.getPgClient("postgres");
  await racine.connect();
  await racine.query("CREATE DATABASE vq");
  await racine.end();
  pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/vq`, ssl: false });

  // Schéma legacy : 001–025 dans l'ordre, comme le runner.
  await pool.query("CREATE TABLE schema_migrations (nom text PRIMARY KEY, applique_le timestamptz NOT NULL DEFAULT now())");
  const fichiers = (await fs.readdir(MIGRATIONS)).filter((f) => /^\d+_.+\.sql$/.test(f) && f !== FICHIER_034 && !f.startsWith("035_")).sort();
  for (const f of fichiers) await appliquer(f, { nom: f });
  await seedLegacy();
});

after(async () => {
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
});

test("034 : le backfill rattache un fichier partagé à plusieurs preuves sans duplication", async () => {
  const avant = await empreintes();
  const statutsAvant = await statuts();
  await appliquer(FICHIER_034, { nom: FICHIER_034 });

  // Aucune ligne legacy supprimée ou modifiée.
  assert.deepEqual(await empreintes(), avant);
  assert.deepEqual(await statuts(), statutsAvant);

  // Un document par fichier distinct : 5 fichiers preuve + 4 générés.
  assert.equal(await compter("documents"), 9);
  assert.equal(await compter("preuve_documents"), 8);

  const [partage] = await lire("SELECT id FROM documents WHERE drive_file_id = 'F_shared'");
  const liens = await lire("SELECT preuve_id, origine, version_validee FROM preuve_documents WHERE document_id = $1 ORDER BY preuve_id", [partage.id]);
  assert.deepEqual(liens.map((l) => l.preuve_id), [1, 2, 5]);
  assert.ok(liens.every((l) => l.version_validee === 1 && l.origine === "manuel"));

  const [importe] = await lire("SELECT origine FROM preuve_documents pd JOIN documents d ON d.id = pd.document_id WHERE d.drive_file_id = 'F_import'");
  assert.equal(importe.origine, "import");

  assert.equal((await lire("SELECT count(*)::int n FROM document_versions WHERE numero = 1 AND remplacee_le IS NULL"))[0].n, 9);
});

test("034 : les rattachements formation sont dérivés, sans en inventer", async () => {
  const formationsDe = async (fichier) => (await lire(
    `SELECT df.formation_id, df.origine, df.valide_le FROM document_formations df
     JOIN documents d ON d.id = df.document_id WHERE d.drive_file_id = $1 ORDER BY df.formation_id`, [fichier]));

  // Fichier partagé entre session 1 (F1) et session 2 (F2) : rattachement multiple à valider.
  assert.deepEqual((await formationsDe("F_shared")).map((r) => r.formation_id), [1, 2]);
  assert.ok((await formationsDe("F_shared")).every((r) => r.origine === "derive_session" && r.valide_le === null));

  // Fichier de groupe : formation via groupes → sessions.
  assert.deepEqual((await formationsDe("F_group")).map((r) => r.formation_id), [1]);

  // Document généré de session : formation de la session.
  assert.deepEqual((await formationsDe("F_gen_s1")).map((r) => r.formation_id), [1]);

  // Document de stagiaire sans session, stagiaire dans une seule formation : dérivation par inscription.
  const st1 = await formationsDe("F_gen_st1");
  assert.deepEqual(st1.map((r) => [r.formation_id, r.origine]), [[1, "derive_inscription"]]);

  // Stagiaire dans deux formations, ou document orphelin : aucun lien créé.
  assert.deepEqual(await formationsDe("F_gen_st2"), []);
  assert.deepEqual(await formationsDe("F_gen_orphan"), []);
  assert.deepEqual(await formationsDe("F_solo"), []);
});

test("034 : le rapport liste les cas à valider humainement", async () => {
  const cas = await lire("SELECT cas, cible FROM migration_034_cas_a_valider ORDER BY cas, cible");
  const par = (c) => cas.filter((r) => r.cas === c).map((r) => r.cible);
  assert.deepEqual(par("P1"), ["4"], "preuve sans session ni groupe");
  const [{ id: orphelin }] = await lire("SELECT id FROM documents_generes WHERE drive_file_id = 'F_gen_orphan'");
  assert.ok(par("P2").includes(String(orphelin)), "document orphelin listé");
  assert.ok(par("P3").length >= 1, "stagiaire inscrit à deux formations sans session");
  assert.ok(par("P4").length >= 1, "document dérivé vers plusieurs formations");
});

test("034 : les contrôles post-migration ont été exécutés et sont verts", async () => {
  const [{ n }] = await lire("SELECT count(*)::int n FROM migration_034_controle WHERE cle IN ('cutover', 'backfill_formations')");
  assert.equal(n, 2);
  const [{ n: ko }] = await lire(`SELECT count(*)::int n FROM documents d
    WHERE (SELECT count(*) FROM document_versions v WHERE v.document_id = d.id AND v.remplacee_le IS NULL) <> 1`);
  assert.equal(ko, 0);
});

test("034 : le bloc de contrôle refuse un état incohérent", async () => {
  const texte = await fs.readFile(path.join(MIGRATIONS, FICHIER_034), "utf8");
  const bloc = texte.slice(texte.lastIndexOf("DO $$"));
  // Ligne legacy sans lien : le contrôle 1 doit lever une exception.
  await pool.query("INSERT INTO preuve_fichiers (preuve_id, drive_file_id, source) VALUES (4, 'F_violation', 'manuel')");
  await assert.rejects(() => pool.query(bloc), /Contrôle 034/);
  await pool.query("DELETE FROM preuve_fichiers WHERE drive_file_id = 'F_violation'");
  await pool.query(bloc); // état cohérent : le bloc passe
});

test("réconciliation : rejouable, n'ajoute que le legacy post-bascule, ne ressuscite rien", async () => {
  // Lignes legacy créées après la bascule, par l'ancien code.
  await pool.query(`
    INSERT INTO preuve_fichiers (preuve_id, drive_file_id, source) VALUES (3, 'F_nouveau', 'manuel');
    INSERT INTO preuve_fichiers (preuve_id, drive_file_id, source) VALUES (4, 'F_shared', 'manuel');`);
  const statutsAvant = await statuts();
  const formationsAvant = await compter("document_formations");

  await jouer(RECONCILIATION);
  const apres1 = { docs: await compter("documents"), liens: await compter("preuve_documents"), versions: await compter("document_versions") };
  assert.equal(apres1.docs, 10, "F_nouveau devient un document");
  assert.equal(apres1.liens, 10, "P_c et P_d sont rattachés");

  // Rejouer ne change rien.
  await jouer(RECONCILIATION);
  assert.deepEqual({ docs: await compter("documents"), liens: await compter("preuve_documents"), versions: await compter("document_versions") }, apres1);

  // Aucun rattachement formation, aucun statut touché.
  assert.equal(await compter("document_formations"), formationsAvant);
  assert.deepEqual(await statuts(), statutsAvant);
});

test("réconciliation : un lien détaché (legacy + nouveau) ne réapparaît pas au rejeu", async () => {
  // Détachement tel que le fait le code (même transaction sur les deux modèles).
  await pool.query(`
    DELETE FROM preuve_documents WHERE preuve_id = 3 AND document_id = (SELECT id FROM documents WHERE drive_file_id = 'F_nouveau');
    DELETE FROM preuve_fichiers WHERE preuve_id = 3 AND drive_file_id = 'F_nouveau';`);
  await jouer(RECONCILIATION);
  const [{ n }] = await lire("SELECT count(*)::int n FROM preuve_documents pd JOIN documents d ON d.id = pd.document_id WHERE pd.preuve_id = 3 AND d.drive_file_id = 'F_nouveau'");
  assert.equal(n, 0);
});

test("réconciliation : un fichier déjà version d'un autre document est signalé, jamais réaffecté", async () => {
  // Remplacement simulé : F_shared devient version 1 remplacée, F_v2 courante.
  // Remplacement tel que le fait R4 : version clôturée, nouvelle version courante, miroir legacy mis à jour
  // pour les preuves liées (preuves 1, 2, 4, 5). La ligne legacy de la preuve 6 n'est pas liée : elle reste.
  await pool.query(`
    UPDATE document_versions SET remplacee_le = now() WHERE drive_file_id = 'F_shared';
    UPDATE documents SET drive_file_id = 'F_v2', version_courante = 2 WHERE drive_file_id = 'F_shared';
    INSERT INTO document_versions (document_id, numero, drive_file_id) SELECT id, 2, 'F_v2' FROM documents WHERE drive_file_id = 'F_v2';
    UPDATE preuve_fichiers SET drive_file_id = 'F_v2' WHERE drive_file_id = 'F_shared' AND preuve_id IN (1, 2, 4, 5);`);
  // Legacy post-bascule : ancien fichier F_shared réattaché à la preuve 6 (P_conf).
  await pool.query("INSERT INTO preuve_fichiers (preuve_id, drive_file_id, source) VALUES (6, 'F_shared', 'manuel')");
  const docsAvant = await compter("documents");
  const rapport = await pool.query(`SELECT 1 FROM preuve_fichiers pf JOIN migration_034_controle c ON c.cle='cutover'
    JOIN document_versions v ON v.drive_file_id = pf.drive_file_id WHERE pf.drive_file_id = 'F_shared' AND pf.ajoute_le > c.valeur`);
  await jouer(RECONCILIATION);
  assert.equal(await compter("documents"), docsAvant, "aucun document créé pour ce fichier");
  assert.equal((await lire("SELECT count(*)::int n FROM preuve_documents pd JOIN preuves p ON p.id = pd.preuve_id WHERE p.id = 6 AND pd.document_id IN (SELECT document_id FROM document_versions WHERE drive_file_id = 'F_shared')"))[0].n, 0);
  assert.ok(rapport.rowCount >= 1, "le conflit est détectable par la requête de rapport");
});

test("rollback : refusé si une contrainte n'est pas satisfaite, sans rien supprimer", async () => {
  // Lien sans miroir legacy : R2 doit refuser.
  const [{ id: docId }] = await lire("SELECT id FROM documents WHERE drive_file_id = 'F_gen_st1'");
  await pool.query("INSERT INTO preuve_documents (preuve_id, document_id, origine, version_validee) VALUES (4, $1, 'manuel', 1)", [docId]);
  await assert.rejects(() => jouer(ROLLBACK), /R2/);
  assert.equal(await compter("documents") > 0, true, "documents encore présent");
  const [{ n }] = await lire("SELECT count(*)::int n FROM information_schema.tables WHERE table_name LIKE 'archive_034_%'");
  assert.equal(n, 0, "aucune archive laissée après échec");
  // Retirer le lien incohérent, puis le rollback doit passer.
  await pool.query("DELETE FROM preuve_documents WHERE preuve_id = 4 AND document_id = $1", [docId]);
});

test("rollback : archive les données, restaure les statuts, laisse le legacy intact", async () => {
  const avant = await empreintes();
  const docsAvant = await compter("documents");
  const versionsAvant = await compter("document_versions");
  const liensAvant = await compter("preuve_documents");
  await jouer(ROLLBACK);

  assert.deepEqual(await empreintes(), avant, "legacy inchangé");
  assert.equal(await compter("archive_034_documents"), docsAvant);
  assert.equal(await compter("archive_034_document_versions"), versionsAvant);
  assert.equal(await compter("archive_034_preuve_documents"), liensAvant);

  const [{ n }] = await lire("SELECT count(*)::int n FROM information_schema.columns WHERE table_name = 'preuves' AND column_name = 'statut_avant_remplacement'");
  assert.equal(n, 0, "colonne supprimée");
  const [{ m }] = await lire("SELECT count(*)::int m FROM schema_migrations WHERE nom = $1", [FICHIER_034]);
  assert.equal(m, 0, "migration retirée de l'historique");
});

test("up → down → up : la migration se réapplique et les contrôles repassent", async () => {
  await appliquer(FICHIER_034, { nom: FICHIER_034 });
  // État legacy au moment du test : 10 lignes preuve_fichiers. Fichiers distincts : F_v2 et F_shared
  // (conservé par la preuve 6), plus F_import, F_conf, F_solo, F_group et 4 générés = 10.
  assert.equal(await compter("preuve_fichiers"), 10);
  assert.equal(await compter("documents"), 10);
  assert.equal(await compter("preuve_documents"), 10);
  const [{ n }] = await lire("SELECT count(*)::int n FROM migration_034_controle WHERE cle IN ('cutover', 'backfill_formations')");
  assert.equal(n, 2);
});

test("runner : migrate() applique 034 comme les autres migrations, sur base vierge", async () => {
  const { migrate } = await import("../src/migrate.js");
  const { setPoolFactory } = await import("../src/db.js");
  const racine = cluster.getPgClient("postgres");
  await racine.connect();
  await racine.query("CREATE DATABASE vq_runner");
  await racine.end();
  const autre = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/vq_runner`, ssl: false });
  setPoolFactory(() => autre);
  try {
    await migrate({ log: () => {} });
    const lignes = await autre.query("SELECT nom FROM schema_migrations WHERE nom = $1", [FICHIER_034]);
    assert.equal(lignes.rowCount, 1);
    const tables = await autre.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_name IN ('documents','document_versions','document_formations','preuve_documents','migration_034_controle')");
    assert.equal(tables.rows[0].n, 5);
  } finally {
    setPoolFactory(null);
    await autre.end();
  }
});
