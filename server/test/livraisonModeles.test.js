// ─────────────────────────────────────────────────────────────
//  Livraison B + C sur un schéma de production (001 à 025) : les modèles existants survivent,
//  reçoivent des valeurs neutres, et les nouvelles règles (unicité des actifs) s'appliquent.
//  PostgreSQL réel. Les migrations 001 à 025 sont rejouées telles quelles, puis 036 et 037.
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
const PORT = 55487;
const DATA = path.join(os.tmpdir(), "vq-livraison-modeles-" + process.pid);

let cluster, pool;

async function appliquer(nom) {
  const sql = await fs.readFile(path.join(MIGRATIONS, nom), "utf8");
  await pool.query(sql);
}

before(async () => {
  cluster = new EmbeddedPostgres({ databaseDir: DATA, port: PORT, user: "postgres", password: "postgres", persistent: false, onLog: () => {}, onError: () => {} });
  await cluster.initialise();
  await cluster.start();
  const racine = cluster.getPgClient("postgres");
  await racine.connect();
  await racine.query("CREATE DATABASE vq");
  await racine.end();
  pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/vq`, ssl: false, max: 2 });
  const fichiers = (await fs.readdir(MIGRATIONS)).filter((f) => /^(0[01][0-9]|02[0-5])_.+\.sql$/.test(f)).sort();
  for (const f of fichiers) await appliquer(f);
  // Modèles existants, tels qu'ils sont en production avant la livraison.
  await pool.query(`INSERT INTO modeles_documents (nom, drive_file_id, drive_mime, portee, actif)
    VALUES ('Attestation historique', 'PROD_FICHIER_1', 'application/vnd.google-apps.document', 'stagiaire', true),
           ('Convocation ancienne', 'PROD_FICHIER_2', 'application/vnd.google-apps.document', 'session', false)`);
});

after(async () => {
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
});

test("036 : les modèles existants gardent leurs données et reçoivent « autre » et « manuel »", async () => {
  await appliquer("036_modeles_bibliotheque.sql");
  const { rows } = await pool.query("SELECT nom, drive_file_id, portee, actif, type_document, mode_generation, condition_generation FROM modeles_documents ORDER BY id");
  assert.equal(rows.length, 2, "aucun modèle perdu");
  assert.deepEqual(rows[0], { nom: "Attestation historique", drive_file_id: "PROD_FICHIER_1", portee: "stagiaire", actif: true, type_document: "autre", mode_generation: "manuel", condition_generation: null });
  assert.equal(rows[1].actif, false, "le modèle désactivé reste désactivé");
});

test("037 : fiche_session devient fiche_recapitulative ; unicité limitée aux modèles actifs", async () => {
  await appliquer("037_modeles_typologie_unicite.sql");
  // Un modèle désactivé peut partager le couple d'un modèle actif (cas historique).
  await pool.query("INSERT INTO modeles_documents (nom, drive_file_id, portee, actif) VALUES ('Attestation reprise', 'PROD_FICHIER_1', 'stagiaire', false)");
  // Un second modèle actif sur le même couple est refusé.
  await assert.rejects(
    pool.query("INSERT INTO modeles_documents (nom, drive_file_id, portee, actif) VALUES ('Doublon actif', 'PROD_FICHIER_1', 'stagiaire', true)"),
    /modeles_un_actif_par_fichier_portee/
  );
  // La typologie à 12 valeurs : une valeur hors liste est refusée.
  await assert.rejects(
    pool.query("UPDATE modeles_documents SET type_document = 'facture' WHERE drive_file_id = 'PROD_FICHIER_2'"),
    /modeles_documents_type_document_check/
  );
});

test("aucune table existante autre que modeles_documents n'est modifiée par 036 et 037", async () => {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM documents_generes");
  assert.equal(rows[0].n, 0, "documents_generes intact (aucune génération rejouée)");
  const colonnes = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'documents_generes' AND column_name = 'libelle'");
  assert.equal(colonnes.rowCount, 0, "pas de libellé de génération : 028 n'est pas livrée");
});
