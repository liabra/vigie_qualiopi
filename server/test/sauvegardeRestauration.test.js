// ─────────────────────────────────────────────────────────────
//  SÉCU-01 — Sauvegarde PostgreSQL chiffrée + restauration, de bout en
//  bout, entre DEUX bases isolées (jamais la production). Données
//  entièrement fictives. Si `pg_dump`/`pg_restore` ne sont pas installés
//  sur la machine qui exécute les tests, ce fichier est IGNORÉ (jamais
//  présenté comme réussi) plutôt que de faire échouer toute la suite.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";

import { setPoolFactory, setQueryExecutor } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { seedReferentiel } from "../src/seed.js";

const run = promisify(execFile);

// Localise pg_dump/pg_restore : PATH d'abord, puis l'emplacement connu de
// Postgres.app (18.x, même version majeure que l'image Railway en
// production) — jamais une version devinée ou téléchargée ici.
async function outilPostgres(nom) {
  try { await run(nom, ["--version"]); return nom; } catch { /* pas sur le PATH */ }
  const candidat = `/Applications/Postgres.app/Contents/Versions/18/bin/${nom}`;
  try { await fs.access(candidat); return candidat; } catch { return null; }
}

const PORT_SOURCE = 55480;
const PORT_CIBLE = 55481;
const DATA_SOURCE = path.join(os.tmpdir(), "vq-sauvegarde-source-" + process.pid);
const DATA_CIBLE = path.join(os.tmpdir(), "vq-sauvegarde-cible-" + process.pid);
const DOSSIER_SAUVEGARDE = path.join(os.tmpdir(), "vq-sauvegarde-fichiers-" + process.pid);
const PASSPHRASE = "phrase-de-test-jamais-utilisee-en-production";

let pgDump, pgRestore, openssl;
let clusterSource, clusterCible, poolSource, poolCible;
let disponible = false;

before(async () => {
  pgDump = await outilPostgres("pg_dump");
  pgRestore = await outilPostgres("pg_restore");
  try { await run("openssl", ["version"]); openssl = "openssl"; } catch { openssl = null; }
  disponible = !!(pgDump && pgRestore && openssl);
  if (!disponible) return; // Chaque test vérifie `disponible` et se marque `skip` sinon.

  clusterSource = new EmbeddedPostgres({ databaseDir: DATA_SOURCE, port: PORT_SOURCE, user: "postgres", password: "postgres", persistent: false, onLog: () => {}, onError: () => {} });
  await clusterSource.initialise();
  await clusterSource.start();
  const racineSource = clusterSource.getPgClient("postgres");
  await racineSource.connect();
  await racineSource.query("CREATE DATABASE vq");
  await racineSource.end();
  poolSource = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT_SOURCE}/vq`, ssl: false });
  setPoolFactory(() => poolSource);
  setQueryExecutor((text, params) => poolSource.query(text, params));
  await migrate({ log: () => {} });
  await seedReferentiel();
  // Données fictives, jamais une personne réelle.
  const { rows: [f] } = await poolSource.query(
    "INSERT INTO formations (intitule, code_interne) VALUES ('Formation SÉCU-01 (fictive)', 'SECU01-TEST') RETURNING id"
  );
  await poolSource.query("INSERT INTO formation_versions (formation_id, numero, duree_heures_defaut) VALUES ($1, 1, 21)", [f.id]);
  await poolSource.query(
    "INSERT INTO sessions (formation_id, formation_version_id, reference, date_debut, date_fin) VALUES ($1, 1, 'SECU01-SESS', '2026-11-03', '2026-12-20')",
    [f.id]
  );

  await fs.mkdir(DOSSIER_SAUVEGARDE, { recursive: true });

  clusterCible = new EmbeddedPostgres({ databaseDir: DATA_CIBLE, port: PORT_CIBLE, user: "postgres", password: "postgres", persistent: false, onLog: () => {}, onError: () => {} });
  await clusterCible.initialise();
  await clusterCible.start();
  const racineCible = clusterCible.getPgClient("postgres");
  await racineCible.connect();
  await racineCible.query("CREATE DATABASE vq_cible");
  await racineCible.end();
  poolCible = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT_CIBLE}/vq_cible`, ssl: false });
});

after(async () => {
  setPoolFactory(null);
  setQueryExecutor(null);
  if (poolSource) await poolSource.end().catch(() => {});
  if (poolCible) await poolCible.end().catch(() => {});
  if (clusterSource) await clusterSource.stop().catch(() => {});
  if (clusterCible) await clusterCible.stop().catch(() => {});
  await fs.rm(DATA_SOURCE, { recursive: true, force: true }).catch(() => {});
  await fs.rm(DATA_CIBLE, { recursive: true, force: true }).catch(() => {});
  await fs.rm(DOSSIER_SAUVEGARDE, { recursive: true, force: true }).catch(() => {});
});

const SCRIPTS = path.join(import.meta.dirname, "..", "scripts");
// `VIGIE_BACKUP_NO_KEYCHAIN` est FORCÉ sur tous les appels de test : jamais
// de repli silencieux vers un vrai item du Trousseau macOS de la machine
// qui exécute les tests (qui pourrait contenir de VRAIS secrets de
// production une fois SÉCU-02 mis en service) — l'isolation du test ne
// doit jamais dépendre de ce qui est, ou n'est pas, configuré par ailleurs.
const envAvecOutils = (base) => {
  const dossierOutils = path.dirname(pgDump);
  return { ...process.env, ...base, PATH: `${dossierOutils}:${process.env.PATH}`, VIGIE_BACKUP_NO_KEYCHAIN: "1" };
};

test("sauvegarde + restauration : les données fictives sont intactes après le cycle complet, chiffré", async (t) => {
  if (!disponible) return t.skip("pg_dump/pg_restore/openssl indisponibles sur cette machine — test ignoré, jamais présenté comme réussi.");

  const { stdout: sortieSauvegarde } = await run("bash", [path.join(SCRIPTS, "sauvegarder.sh")], {
    env: envAvecOutils({
      VIGIE_BACKUP_DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${PORT_SOURCE}/vq`,
      VIGIE_BACKUP_PASSPHRASE: PASSPHRASE,
      VIGIE_BACKUP_DIR: DOSSIER_SAUVEGARDE,
    }),
  });
  assert.match(sortieSauvegarde, /Sauvegarde réussie et vérifiée/);

  const tousLesFichiers = await fs.readdir(DOSSIER_SAUVEGARDE);
  const fichiers = tousLesFichiers.filter((f) => f.endsWith(".dump.enc"));
  assert.equal(fichiers.length, 1, "un seul fichier chiffré produit");
  assert.ok(tousLesFichiers.includes(".dernier-statut"), "un fichier d'état est écrit pour la surveillance");
  const fichierChiffre = path.join(DOSSIER_SAUVEGARDE, fichiers[0]);
  assert.match(fichiers[0], /^vigie-\d{8}-\d{6}\.dump\.enc$/);

  // Le fichier est bien chiffré : ni le SQL ni les données fictives n'y
  // apparaissent en clair.
  const contenuBrut = await fs.readFile(fichierChiffre, "latin1");
  assert.ok(!contenuBrut.includes("SECU01"), "aucune donnée en clair dans le fichier chiffré");
  assert.ok(!contenuBrut.includes("CREATE TABLE"), "aucun SQL en clair dans le fichier chiffré");

  const { stdout: sortieRestauration } = await run("bash", [path.join(SCRIPTS, "restaurer.sh"), fichierChiffre], {
    env: envAvecOutils({
      VIGIE_RESTORE_TARGET_URL: `postgresql://postgres:postgres@127.0.0.1:${PORT_CIBLE}/vq_cible`,
      VIGIE_BACKUP_PASSPHRASE: PASSPHRASE,
    }),
  });
  assert.match(sortieRestauration, /Restauration réussie/);

  const { rows: [compteMigrations] } = await poolCible.query("SELECT count(*)::int AS n FROM schema_migrations");
  assert.ok(compteMigrations.n >= 26, "les migrations restaurées sont présentes (schema_migrations intact)");
  const { rows: [session] } = await poolCible.query("SELECT reference, date_debut, date_fin FROM sessions WHERE reference = 'SECU01-SESS'");
  assert.deepEqual(session, { reference: "SECU01-SESS", date_debut: "2026-11-03", date_fin: "2026-12-20" }, "la donnée fictive restaurée est identique à l'originale");
  const { rows: [formation] } = await poolCible.query("SELECT intitule, code_interne FROM formations WHERE code_interne = 'SECU01-TEST'");
  assert.deepEqual(formation, { intitule: "Formation SÉCU-01 (fictive)", code_interne: "SECU01-TEST" });
});

test("restauration : refusée si la cible est identique à DATABASE_URL (garde-fou anti-erreur)", async (t) => {
  if (!disponible) return t.skip("pg_dump/pg_restore/openssl indisponibles sur cette machine — test ignoré.");
  await fs.writeFile(path.join(DOSSIER_SAUVEGARDE, "faux.dump.enc"), "contenu sans importance");
  await assert.rejects(
    run("bash", [path.join(SCRIPTS, "restaurer.sh"), path.join(DOSSIER_SAUVEGARDE, "faux.dump.enc")], {
      env: envAvecOutils({
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:9999/production-simulee",
        VIGIE_RESTORE_TARGET_URL: "postgresql://postgres:postgres@127.0.0.1:9999/production-simulee",
        VIGIE_BACKUP_PASSPHRASE: PASSPHRASE,
      }),
    }),
    /refusée par sécurité/
  );
});

test("sauvegarde : variables manquantes refusées explicitement, jamais un secret par défaut", async (t) => {
  if (!disponible) return t.skip("pg_dump/pg_restore/openssl indisponibles sur cette machine — test ignoré.");
  await assert.rejects(
    run("bash", [path.join(SCRIPTS, "sauvegarder.sh")], { env: envAvecOutils({ VIGIE_BACKUP_DATABASE_URL: "" }) }),
    /VIGIE_BACKUP_DATABASE_URL absente/
  );
  await assert.rejects(
    run("bash", [path.join(SCRIPTS, "sauvegarder.sh")], {
      env: envAvecOutils({ VIGIE_BACKUP_DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${PORT_SOURCE}/vq`, VIGIE_BACKUP_PASSPHRASE: "" }),
    }),
    /VIGIE_BACKUP_PASSPHRASE absente/
  );
});

test("sauvegarde : le mot de passe de l'URL n'apparaît JAMAIS dans la sortie, même en cas d'échec pg_dump", async (t) => {
  if (!disponible) return t.skip("pg_dump/pg_restore/openssl indisponibles sur cette machine — test ignoré.");
  const dossier = path.join(DOSSIER_SAUVEGARDE, "echec-redaction");
  await fs.mkdir(dossier, { recursive: true });
  // Port fermé + mot de passe reconnaissable dans l'URL : pg_dump échoue et
  // peut inclure la chaîne de connexion dans son message d'erreur.
  const motDePasseSecret = "MotDePasseVisibleSiNonMasque123";
  let erreur;
  try {
    await run("bash", [path.join(SCRIPTS, "sauvegarder.sh")], {
      env: envAvecOutils({
        VIGIE_BACKUP_DATABASE_URL: `postgresql://postgres:${motDePasseSecret}@127.0.0.1:9/inexistante`,
        VIGIE_BACKUP_PASSPHRASE: PASSPHRASE,
        VIGIE_BACKUP_DIR: dossier,
      }),
    });
    assert.fail("pg_dump devait échouer (port fermé)");
  } catch (e) { erreur = e; }
  const sortieCombinee = (erreur.stdout || "") + (erreur.stderr || "") + (erreur.message || "");
  assert.ok(!sortieCombinee.includes(motDePasseSecret), "le mot de passe ne doit jamais apparaître dans la sortie/les journaux");
  assert.ok(sortieCombinee.includes("[SECRET MASQUÉ]") || !sortieCombinee.toLowerCase().includes("motdepasse"), "le message d'erreur reste informatif, juste sans le secret");
});

test("sauvegarde : rétention — un ancien fichier chiffré est purgé après un nouveau succès, un récent est conservé", async (t) => {
  if (!disponible) return t.skip("pg_dump/pg_restore/openssl indisponibles sur cette machine — test ignoré.");
  const dossier = path.join(DOSSIER_SAUVEGARDE, "retention");
  await fs.mkdir(dossier, { recursive: true });
  const ancien = path.join(dossier, "vigie-20200101-000000.dump.enc");
  await fs.writeFile(ancien, "contenu factice ancien");
  const vieilleDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
  await fs.utimes(ancien, vieilleDate, vieilleDate);

  await run("bash", [path.join(SCRIPTS, "sauvegarder.sh")], {
    env: envAvecOutils({
      VIGIE_BACKUP_DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${PORT_SOURCE}/vq`,
      VIGIE_BACKUP_PASSPHRASE: PASSPHRASE,
      VIGIE_BACKUP_DIR: dossier,
      VIGIE_BACKUP_RETENTION_JOURS: "30",
    }),
  });

  const fichiers = (await fs.readdir(dossier)).filter((f) => f.endsWith(".dump.enc"));
  assert.ok(!fichiers.includes("vigie-20200101-000000.dump.enc"), "le fichier vieux de plus de 30 jours est purgé");
  assert.equal(fichiers.length, 1, "le nouveau fichier reste présent");
});

test("sauvegarde : rétention désactivée (0) — l'ancien fichier n'est jamais purgé", async (t) => {
  if (!disponible) return t.skip("pg_dump/pg_restore/openssl indisponibles sur cette machine — test ignoré.");
  const dossier = path.join(DOSSIER_SAUVEGARDE, "retention-desactivee");
  await fs.mkdir(dossier, { recursive: true });
  const ancien = path.join(dossier, "vigie-20200101-000000.dump.enc");
  await fs.writeFile(ancien, "contenu factice ancien");
  const vieilleDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
  await fs.utimes(ancien, vieilleDate, vieilleDate);

  await run("bash", [path.join(SCRIPTS, "sauvegarder.sh")], {
    env: envAvecOutils({
      VIGIE_BACKUP_DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${PORT_SOURCE}/vq`,
      VIGIE_BACKUP_PASSPHRASE: PASSPHRASE,
      VIGIE_BACKUP_DIR: dossier,
      VIGIE_BACKUP_RETENTION_JOURS: "0",
    }),
  });

  const fichiers = (await fs.readdir(dossier)).filter((f) => f.endsWith(".dump.enc"));
  assert.ok(fichiers.includes("vigie-20200101-000000.dump.enc"), "rétention à 0 : rien n'est jamais purgé");
});

test("sauvegarde : copie hors-Mac déposée dans VIGIE_BACKUP_COPIE_DIR sans affecter la sauvegarde locale", async (t) => {
  if (!disponible) return t.skip("pg_dump/pg_restore/openssl indisponibles sur cette machine — test ignoré.");
  const dossier = path.join(DOSSIER_SAUVEGARDE, "principale-copie");
  const copie = path.join(DOSSIER_SAUVEGARDE, "copie-hors-mac");
  await fs.mkdir(dossier, { recursive: true });

  await run("bash", [path.join(SCRIPTS, "sauvegarder.sh")], {
    env: envAvecOutils({
      VIGIE_BACKUP_DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${PORT_SOURCE}/vq`,
      VIGIE_BACKUP_PASSPHRASE: PASSPHRASE,
      VIGIE_BACKUP_DIR: dossier,
      VIGIE_BACKUP_COPIE_DIR: copie,
    }),
  });

  const principale = (await fs.readdir(dossier)).filter((f) => f.endsWith(".dump.enc"));
  const secondaire = (await fs.readdir(copie)).filter((f) => f.endsWith(".dump.enc"));
  assert.equal(principale.length, 1);
  assert.equal(secondaire.length, 1, "la copie hors-Mac existe");
  assert.equal(principale[0], secondaire[0], "même nom de fichier dans les deux emplacements");
  const contenuPrincipal = await fs.readFile(path.join(dossier, principale[0]));
  const contenuSecondaire = await fs.readFile(path.join(copie, secondaire[0]));
  assert.deepEqual(contenuPrincipal, contenuSecondaire, "la copie est identique, octet pour octet");
});

test("sauvegarde : un fichier chiffré corrompu après coup est détecté par restaurer.sh, jamais restauré silencieusement", async (t) => {
  if (!disponible) return t.skip("pg_dump/pg_restore/openssl indisponibles sur cette machine — test ignoré.");
  const dossier = path.join(DOSSIER_SAUVEGARDE, "corruption");
  await fs.mkdir(dossier, { recursive: true });
  await run("bash", [path.join(SCRIPTS, "sauvegarder.sh")], {
    env: envAvecOutils({
      VIGIE_BACKUP_DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${PORT_SOURCE}/vq`,
      VIGIE_BACKUP_PASSPHRASE: PASSPHRASE,
      VIGIE_BACKUP_DIR: dossier,
    }),
  });
  const [nomFichier] = (await fs.readdir(dossier)).filter((f) => f.endsWith(".dump.enc"));
  const fichier = path.join(dossier, nomFichier);
  // Corruption délibérée : quelques octets au milieu du fichier chiffré.
  const buffer = await fs.readFile(fichier);
  const milieu = Math.floor(buffer.length / 2);
  for (let i = 0; i < 16 && milieu + i < buffer.length; i++) buffer[milieu + i] = 0;
  await fs.writeFile(fichier, buffer);

  await assert.rejects(
    run("bash", [path.join(SCRIPTS, "restaurer.sh"), fichier], {
      env: envAvecOutils({
        VIGIE_RESTORE_TARGET_URL: `postgresql://postgres:postgres@127.0.0.1:${PORT_CIBLE}/vq_cible`,
        VIGIE_BACKUP_PASSPHRASE: PASSPHRASE,
      }),
    })
  );
});
