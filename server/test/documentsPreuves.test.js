// ─────────────────────────────────────────────────────────────
//  Service documents partagés (étape 3A) : statuts, rattachements,
//  remplacement, revalidation, transactions et miroir legacy.
//  PostgreSQL RÉEL (embarqué), schéma joué par le runner réel.
//  Données entièrement fictives.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import os from "node:os";
import path from "node:path";
import pg from "pg";

import { setPoolFactory } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import {
  transaction, changerStatut, creerDocument, attacherDocument, detacherDocument,
  remplacerDocument, revaliderLien, synchroniserImport, ErreurDocument,
} from "../src/services/documentsPreuves.js";

// Contrôle Drive conforme simulé : ces tests ne testent pas Drive (voir documentsPreuvesDrive.test.js).
const OK = async () => ({ ok: true });

const PORT = 55471;
const DATA = path.join(os.tmpdir(), "vq-docprev-" + process.pid);

let cluster, pool;

async function lire(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

async function statut(preuveId) {
  const [p] = await lire("SELECT statut, statut_avant_remplacement FROM preuves WHERE id = $1", [preuveId]);
  return p;
}

async function erreurAttendue(fn, code) {
  try {
    await fn();
  } catch (e) {
    assert.ok(e instanceof ErreurDocument || e.message, "erreur attendue");
    if (code) assert.equal(e.code, code, `code attendu ${code}, obtenu ${e.code} : ${e.message}`);
    return e;
  }
  assert.fail(`aucune erreur levée (attendu ${code})`);
}

const erreur = erreurAttendue;

async function docId(fichier) {
  const [d] = await lire("SELECT id FROM documents WHERE drive_file_id = $1", [fichier]);
  return d.id;
}

async function versionsDe(documentId) {
  return lire("SELECT numero, drive_file_id, remplacee_le, motif FROM document_versions WHERE document_id = $1 ORDER BY numero", [documentId]);
}

async function miroir(preuveId) {
  return (await lire("SELECT drive_file_id, source FROM preuve_fichiers WHERE preuve_id = $1 ORDER BY drive_file_id", [preuveId]))
    .map((r) => r.drive_file_id);
}

// Crée une preuve avec son statut voulu (les créations hors service sont exemptées).
async function preuve(id, indicateur, statutInitial, { session = null, groupe = null } = {}) {
  await pool.query(
    "INSERT INTO preuves (id, indicateur_id, titre, statut, session_id, groupe_id) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, indicateur, "Preuve " + id, statutInitial, session, groupe]
  );
  return id;
}

function fichier(nom) {
  return { drive_file_id: nom, drive_url: "https://drive.google.com/file/d/" + nom + "/view", drive_nom: nom + ".pdf", drive_mime: "application/pdf" };
}

// Crée un document (version 1) rattaché à une liste de preuves, sans changer leur statut.
async function documentRattache(nom, preuves) {
  return transaction(async (cx) => {
    const { documentId } = await creerDocument(cx, { controle: OK, fichier: fichier(nom), source: "manuel", utilisateurId: 1 });
    for (const p of preuves) {
      await attacherDocument(cx, { preuveId: p, documentId, utilisateurId: 1 });
    }
    return documentId;
  });
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
  setPoolFactory(() => pool);
  await migrate({ log: () => {} });

  await pool.query(`
    INSERT INTO referentiel_versions (id, code, libelle, est_active) VALUES (1, 'V9', 'Référentiel V9', true);
    INSERT INTO criteres (id, version_id, numero, libelle) VALUES (1, 1, 1, 'Critère 1');
    INSERT INTO indicateurs (id, version_id, critere_id, numero, libelle) VALUES
      (1, 1, 1, 1, 'Indicateur 1'), (2, 1, 1, 2, 'Indicateur 2'), (3, 1, 1, 3, 'Indicateur 3'), (4, 1, 1, 4, 'Indicateur 4');
    INSERT INTO utilisateurs (id, email, nom, role) VALUES (1, 'admin@test.local', 'Admin', 'admin');
    INSERT INTO formations (id, intitule) VALUES (1, 'Formation A');
    INSERT INTO sessions (id, formation_id, date_debut, date_fin) VALUES (1, 1, '2025-01-01', '2025-01-02');
    INSERT INTO groupes (id, session_id, nom) VALUES (1, 1, 'G1');
  `);
});

after(async () => {
  setPoolFactory(null);
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
});

// ── Statuts partagés ─────────────────────────────────────────

test("un document partagé garde des statuts indépendants par preuve", async () => {
  await preuve(101, 1, "maitrise", { session: 1 });
  await preuve(102, 2, "a_risque", { session: 1 });
  const docId1 = await documentRattache("F_indep", [101, 102]);

  await transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: docId1, fichier: fichier("F_indep_v2"), versionAttendue: 1, utilisateurId: 1 }));

  assert.deepEqual(await statut(101), { statut: "a_consolider", statut_avant_remplacement: "maitrise" });
  assert.deepEqual(await statut(102), { statut: "a_risque", statut_avant_remplacement: null }, "a_risque reste à risque");
});

test("remplacement d'un document lié à plusieurs preuves : seules les preuves maîtrisées passent à revalider", async () => {
  await preuve(111, 1, "maitrise", { session: 1 });
  await preuve(112, 2, "maitrise", { session: 1 });
  await preuve(113, 3, "non_applicable", { session: 1 });
  const d = await documentRattache("F_multi", [111, 112, 113]);

  const { preuves_a_revalider } = await transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_multi_v2"), versionAttendue: 1, utilisateurId: 1 }));

  assert.deepEqual([...preuves_a_revalider].sort((a, b) => a - b), [111, 112, 113]);
  assert.equal((await statut(111)).statut, "a_consolider");
  assert.equal((await statut(112)).statut, "a_consolider");
  assert.equal((await statut(113)).statut, "non_applicable", "non applicable inchangé");
  const liens = await lire("SELECT preuve_id, version_validee FROM preuve_documents WHERE document_id = $1 ORDER BY preuve_id", [d]);
  assert.ok(liens.every((l) => l.version_validee === 1), "les liens gardent la version revue (1) : en attente");
});

// ── Deux documents sur une même preuve ───────────────────────

test("deux documents remplacés sur une preuve : restauration seulement après revalidation des deux", async () => {
  await preuve(121, 1, "maitrise", { session: 1 });
  const d1 = await documentRattache("F_double_1", [121]);
  const d2 = await documentRattache("F_double_2", [121]);

  await transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d1, fichier: fichier("F_double_1b"), versionAttendue: 1, utilisateurId: 1 }));
  assert.deepEqual(await statut(121), { statut: "a_consolider", statut_avant_remplacement: "maitrise" });

  await transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d2, fichier: fichier("F_double_2b"), versionAttendue: 1, utilisateurId: 1 }));
  assert.deepEqual(await statut(121), { statut: "a_consolider", statut_avant_remplacement: "maitrise" }, "l'avant n'est pas écrasé");

  await transaction((cx) => revaliderLien(cx, { preuveId: 121, documentId: d1, utilisateurId: 1 }));
  assert.equal((await statut(121)).statut, "a_consolider", "un lien revalidé ne suffit pas");

  const r = await transaction((cx) => revaliderLien(cx, { preuveId: 121, documentId: d2, utilisateurId: 1 }));
  assert.equal(r.statut, "maitrise");
  assert.deepEqual(await statut(121), { statut: "maitrise", statut_avant_remplacement: null });
});

// ── Restauration conditionnée (R6) ───────────────────────────

test("une preuve à risque n'est jamais restaurée en maîtrisé par la revalidation", async () => {
  await preuve(131, 1, "a_risque", { session: 1 });
  const d = await documentRattache("F_risque", [131]);
  await transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_risque_v2"), versionAttendue: 1, utilisateurId: 1 }));
  await transaction((cx) => revaliderLien(cx, { preuveId: 131, documentId: d, utilisateurId: 1 }));
  assert.deepEqual(await statut(131), { statut: "a_risque", statut_avant_remplacement: null });
});

test("une cause manuelle de a_consolider est préservée à la revalidation", async () => {
  await preuve(141, 1, "a_consolider", { session: 1 });
  const d = await documentRattache("F_manuel", [141]);
  await transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_manuel_v2"), versionAttendue: 1, utilisateurId: 1 }));
  await transaction((cx) => revaliderLien(cx, { preuveId: 141, documentId: d, utilisateurId: 1 }));
  assert.deepEqual(await statut(141), { statut: "a_consolider", statut_avant_remplacement: null });
});

// ── Blocage des passages à maîtrisé ─────────────────────────

test("passer à maîtrisé est refusé tant qu'une revalidation est en attente", async () => {
  await preuve(151, 1, "maitrise", { session: 1 });
  const d = await documentRattache("F_bloque", [151]);
  await transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_bloque_v2"), versionAttendue: 1, utilisateurId: 1 }));

  const e = await erreurAttendue(() => transaction((cx) => changerStatut(cx, 151, "admin_statut", { statut: "maitrise" })), "revalidations_en_attente");
  assert.deepEqual(e.details.documents, [d]);
  assert.deepEqual(await statut(151), { statut: "a_consolider", statut_avant_remplacement: "maitrise" }, "inchangé après refus");

  await erreurAttendue(() => transaction((cx) => changerStatut(cx, 151, "bulk_admin", { statut: "maitrise" })), "revalidations_en_attente");
});

// ── Changements manuels : effacement de l'avant ─────────────

test("un changement manuel explicite efface statut_avant_remplacement", async () => {
  await preuve(161, 1, "maitrise", { session: 1 });
  const d = await documentRattache("F_manuel_efface", [161]);
  await transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_manuel_efface_v2"), versionAttendue: 1, utilisateurId: 1 }));

  await transaction((cx) => changerStatut(cx, 161, "admin_statut", { statut: "a_risque" }));
  assert.deepEqual(await statut(161), { statut: "a_risque", statut_avant_remplacement: null });

  await transaction((cx) => revaliderLien(cx, { preuveId: 161, documentId: d, utilisateurId: 1 }));
  assert.equal((await statut(161)).statut, "a_risque", "la décision manuelle l'emporte");
});

test("une valeur identique envoyée explicitement efface aussi l'avant", async () => {
  await preuve(171, 1, "maitrise", { session: 1 });
  const d = await documentRattache("F_meme_valeur", [171]);
  await transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_meme_valeur_v2"), versionAttendue: 1, utilisateurId: 1 }));
  await transaction((cx) => changerStatut(cx, 171, "admin_statut", { statut: "a_consolider" }));
  assert.deepEqual(await statut(171), { statut: "a_consolider", statut_avant_remplacement: null });
  await transaction((cx) => revaliderLien(cx, { preuveId: 171, documentId: d, utilisateurId: 1 }));
  assert.equal((await statut(171)).statut, "a_consolider", "pas de restauration après une décision explicite");
});

// ── Détachement ──────────────────────────────────────────────

test("détacher supprime le lien, jamais le document ni ses versions", async () => {
  await preuve(181, 1, "maitrise", { session: 1 });
  await preuve(182, 2, "maitrise", { session: 1 });
  const d = await documentRattache("F_detache", [181, 182]);
  await transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_detache_v2"), versionAttendue: 1, utilisateurId: 1 }));
  const versionsAvant = await versionsDe(d);

  await transaction((cx) => detacherDocument(cx, { preuveId: 181, documentId: d }));

  assert.equal((await lire("SELECT 1 FROM preuve_documents WHERE preuve_id = 181")).length, 0);
  assert.deepEqual(await versionsDe(d), versionsAvant, "versions intactes");
  assert.equal((await lire("SELECT count(*)::int n FROM documents WHERE id = $1", [d]))[0].n, 1);
  assert.equal((await lire("SELECT count(*)::int n FROM preuve_documents WHERE document_id = $1", [d]))[0].n, 1, "l'autre lien reste");
});

test("détacher le dernier lien en attente restaure la maîtrise", async () => {
  await preuve(191, 1, "maitrise", { session: 1 });
  const d = await documentRattache("F_dernier", [191]);
  await transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_dernier_v2"), versionAttendue: 1, utilisateurId: 1 }));
  assert.equal((await statut(191)).statut, "a_consolider");
  await transaction((cx) => detacherDocument(cx, { preuveId: 191, documentId: d }));
  assert.deepEqual(await statut(191), { statut: "maitrise", statut_avant_remplacement: null });
});

// ── Idempotence de la revalidation ──────────────────────────

test("revalider deux fois : la seconde ne change rien", async () => {
  await preuve(201, 1, "maitrise", { session: 1 });
  const d = await documentRattache("F_idem", [201]);
  await transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_idem_v2"), versionAttendue: 1, utilisateurId: 1 }));
  const premiere = await transaction((cx) => revaliderLien(cx, { preuveId: 201, documentId: d, utilisateurId: 1 }));
  const seconde = await transaction((cx) => revaliderLien(cx, { preuveId: 201, documentId: d, utilisateurId: 1 }));
  assert.equal(premiere.revalide, true);
  assert.equal(seconde.revalide, false);
  assert.equal((await statut(201)).statut, "maitrise");
});

// ── Identité et R3 ───────────────────────────────────────────

test("créer un fichier déjà identifié est refusé (R3)", async () => {
  await documentRattache("F_identite", []);
  await erreurAttendue(() => transaction((cx) => creerDocument(cx, { controle: OK, fichier: fichier("F_identite") })), "fichier_deja_identifie");
});

test("remplacer par la version courante est refusé ; par l'ancien fichier d'un autre document aussi", async () => {
  await preuve(211, 1, "maitrise", { session: 1 });
  const d1 = await documentRattache("F_id_a", [211]);
  await documentRattache("F_id_b", []);
  await erreurAttendue(() => transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d1, fichier: fichier("F_id_a"), versionAttendue: 1 })), "version_deja_courante");
  await transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d1, fichier: fichier("F_id_a2"), versionAttendue: 1, utilisateurId: 1 }));
  await erreurAttendue(() => transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d1, fichier: fichier("F_id_b"), versionAttendue: 2 })), "fichier_deja_identifie");
});

test("remplacement avec une version attendue périmée est refusé", async () => {
  await preuve(221, 1, "maitrise", { session: 1 });
  const d = await documentRattache("F_perime", [221]);
  await transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_perime_v2"), versionAttendue: 1, utilisateurId: 1 }));
  await erreurAttendue(() => transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_perime_v3"), versionAttendue: 1 })), "version_obsolete");
});

// ── Transactions et miroir legacy ───────────────────────────

test("une erreur en cours de remplacement annule tout : versions, statuts, miroir", async () => {
  await preuve(231, 1, "maitrise", { session: 1 });
  const d = await documentRattache("F_atomique", [231]);
  const versionsAvant = await versionsDe(d);
  const miroirAvant = await miroir(231);
  await pool.query(`
    CREATE OR REPLACE FUNCTION vq_test_echec() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'échec injecté'; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER vq_test_echec_trg BEFORE UPDATE ON preuves
      FOR EACH ROW WHEN (NEW.statut = 'a_consolider') EXECUTE FUNCTION vq_test_echec();`);
  try {
    await assert.rejects(() => transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_atomique_v2"), versionAttendue: 1, utilisateurId: 1 })), /échec injecté/);
  } finally {
    await pool.query("DROP TRIGGER vq_test_echec_trg ON preuves; DROP FUNCTION vq_test_echec();");
  }
  assert.deepEqual(await versionsDe(d), versionsAvant, "aucune version créée");
  assert.equal((await lire("SELECT drive_file_id FROM documents WHERE id = $1", [d]))[0].drive_file_id, "F_atomique");
  assert.deepEqual(await statut(231), { statut: "maitrise", statut_avant_remplacement: null });
  assert.deepEqual(await miroir(231), miroirAvant, "miroir legacy inchangé");
});

test("miroir legacy : rattachement, remplacement et détachement restent cohérents", async () => {
  await preuve(241, 1, "maitrise", { session: 1 });
  const d = await documentRattache("F_miroir", [241]);
  assert.deepEqual(await miroir(241), ["F_miroir"]);
  await transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_miroir_v2"), versionAttendue: 1, utilisateurId: 1 }));
  assert.deepEqual(await miroir(241), ["F_miroir_v2"]);
  await transaction((cx) => detacherDocument(cx, { preuveId: 241, documentId: d }));
  assert.deepEqual(await miroir(241), []);
});

test("un miroir legacy incohérent fait échouer le remplacement sans rien écrire", async () => {
  await preuve(251, 1, "maitrise", { session: 1 });
  const d = await documentRattache("F_sans_miroir", [251]);
  await pool.query("DELETE FROM preuve_fichiers WHERE preuve_id = 251");
  const versionsAvant = await versionsDe(d);
  await erreurAttendue(() => transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_sans_miroir_v2"), versionAttendue: 1, utilisateurId: 1 })), "miroir_incoherent");
  assert.deepEqual(await versionsDe(d), versionsAvant);
  assert.equal((await statut(251)).statut, "maitrise");
});

// ── Concurrence ──────────────────────────────────────────────

test("deux remplacements simultanés avec la même version attendue : un seul réussit", async () => {
  await preuve(261, 1, "maitrise", { session: 1 });
  const d = await documentRattache("F_course", [261]);
  const tentatives = await Promise.allSettled([
    transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_course_a"), versionAttendue: 1, utilisateurId: 1 })),
    transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_course_b"), versionAttendue: 1, utilisateurId: 1 })),
  ]);
  const reussites = tentatives.filter((t) => t.status === "fulfilled");
  const echecs = tentatives.filter((t) => t.status === "rejected");
  assert.equal(reussites.length, 1);
  assert.equal(echecs.length, 1);
  assert.equal(echecs[0].reason.code, "version_obsolete");
  assert.equal((await versionsDe(d)).length, 2, "exactement deux versions");
});

// ── Import ───────────────────────────────────────────────────

test("synchroniserImport : détache les liens d'import absents, n'efface aucun document", async () => {
  await preuve(271, 1, "maitrise", { session: 1 });
  const r1 = await transaction((cx) => synchroniserImport(cx, { controle: OK, preuveId: 271, fichiers: [fichier("F_imp_a"), fichier("F_imp_b")], utilisateurId: 1 }));
  assert.equal(r1.ajoutes.length, 2);
  const r2 = await transaction((cx) => synchroniserImport(cx, { controle: OK, preuveId: 271, fichiers: [fichier("F_imp_a")], utilisateurId: 1 }));
  assert.equal(r2.detaches.length, 1);
  assert.deepEqual(await miroir(271), ["F_imp_a"]);
  assert.equal((await lire("SELECT count(*)::int n FROM documents WHERE drive_file_id = 'F_imp_b'"))[0].n, 1, "le document reste");
});

test("synchroniserImport : un import ne change pas le statut d'une preuve en attente", async () => {
  await preuve(281, 1, "maitrise", { session: 1 });
  await transaction((cx) => synchroniserImport(cx, { controle: OK, preuveId: 281, fichiers: [fichier("F_imp_att")], utilisateurId: 1 }));
  const d = await docId("F_imp_att");
  await transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_imp_att_v2"), versionAttendue: 1, utilisateurId: 1 }));
  assert.equal((await statut(281)).statut, "a_consolider");
  await transaction((cx) => synchroniserImport(cx, { controle: OK, preuveId: 281, fichiers: [fichier("F_imp_att_v2")], statutImport: "maitrise", utilisateurId: 1 }));
  assert.deepEqual(await statut(281), { statut: "a_consolider", statut_avant_remplacement: "maitrise" }, "statut en attente préservé");
});

// ── Phase 3A.1 : cas manquants, courses, graphes qui se chevauchent ─────

async function invariants() {
  const docs = await lire(`SELECT d.id, d.version_courante,
      (SELECT count(*)::int FROM document_versions v WHERE v.document_id = d.id AND v.remplacee_le IS NULL) AS courantes,
      (SELECT v.numero FROM document_versions v WHERE v.document_id = d.id AND v.remplacee_le IS NULL) AS numero_courant
    FROM documents d`);
  for (const d of docs) {
    assert.equal(d.courantes, 1, `document ${d.id} : une seule version courante`);
    assert.equal(d.numero_courant, d.version_courante, `document ${d.id} : numéro courant = version_courante`);
  }
  const liens = await lire(`SELECT pd.preuve_id, pd.document_id, pd.version_validee, d.version_courante, d.drive_file_id,
      (SELECT count(*)::int FROM preuve_fichiers pf WHERE pf.preuve_id = pd.preuve_id AND pf.drive_file_id = d.drive_file_id) AS miroir
    FROM preuve_documents pd JOIN documents d ON d.id = pd.document_id WHERE pd.preuve_id >= 1000`);
  for (const l of liens) {
    assert.ok(l.version_validee <= l.version_courante, `lien ${l.preuve_id}/${l.document_id} : version revue ≤ courante`);
    assert.equal(l.miroir, 1, `lien ${l.preuve_id}/${l.document_id} : miroir legacy présent`);
  }
  const preuves = await lire(`SELECT p.id, p.statut, p.statut_avant_remplacement,
      (SELECT count(*)::int FROM preuve_documents pd JOIN documents d ON d.id = pd.document_id
        WHERE pd.preuve_id = p.id AND pd.version_validee < d.version_courante) AS en_attente
    FROM preuves p WHERE p.id >= 1000`);
  for (const p of preuves) {
    if (p.statut_avant_remplacement !== null) {
      assert.equal(p.statut, "a_consolider", `preuve ${p.id} : avant ⇒ a_consolider`);
      assert.ok(p.en_attente >= 1, `preuve ${p.id} : avant ⇒ revalidation en attente`);
    }
    if (p.en_attente > 0) assert.notEqual(p.statut, "maitrise", `preuve ${p.id} : attente ⇒ pas maîtrisé`);
  }
}

async function erreurOuSucces(promesse) {
  try { return { ok: await promesse }; } catch (e) { return { erreur: e }; }
}

test("lien inexistant : détachement et revalidation renvoient 404", async () => {
  await preuve(301, 1, "maitrise", { session: 1 });
  const d = await documentRattache("F_sans_lien", []);
  await erreur(() => transaction((cx) => detacherDocument(cx, { preuveId: 301, documentId: d })), "lien_introuvable");
  await erreur(() => transaction((cx) => revaliderLien(cx, { preuveId: 301, documentId: d, utilisateurId: 1 })), "lien_introuvable");
});

test("motif supérieur à 500 caractères refusé (400), sans effet", async () => {
  await preuve(311, 1, "maitrise", { session: 1 });
  const d = await documentRattache("F_motif", [311]);
  const versionsAvant = await versionsDe(d);
  await erreur(() => transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_motif_v2"), versionAttendue: 1, motif: "x".repeat(501), utilisateurId: 1 })), "motif_trop_long");
  assert.deepEqual(await versionsDe(d), versionsAvant);
  await transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_motif_v2"), versionAttendue: 1, motif: "x".repeat(500), utilisateurId: 1 }));
});

test("rattachement d'un document archivé refusé (409) ; le lien n'est pas créé", async () => {
  await preuve(321, 1, "maitrise", { session: 1 });
  const d = await documentRattache("F_archive", []);
  await pool.query("UPDATE documents SET archive_le = now() WHERE id = $1", [d]);
  await erreur(() => transaction((cx) => attacherDocument(cx, { preuveId: 321, documentId: d, utilisateurId: 1 })), "document_archive");
  assert.equal((await lire("SELECT count(*)::int n FROM preuve_documents WHERE preuve_id = 321"))[0].n, 0);
});

test("course sur la même identité : une seule création réussit, l'autre est un 409, jamais un succès", async () => {
  const essais = await Promise.allSettled([
    transaction((cx) => creerDocument(cx, { controle: OK, fichier: fichier("F_course_id") })),
    transaction((cx) => creerDocument(cx, { controle: OK, fichier: fichier("F_course_id") })),
  ]);
  const reussis = essais.filter((e) => e.status === "fulfilled");
  const echoues = essais.filter((e) => e.status === "rejected");
  assert.equal(reussis.length, 1, "une seule réussite");
  assert.equal(echoues.length, 1, "un seul refus");
  assert.equal(echoues[0].reason.code, "fichier_deja_identifie");
  assert.equal((await lire("SELECT count(*)::int n FROM documents WHERE drive_file_id = 'F_course_id'"))[0].n, 1);
  assert.equal((await lire("SELECT count(*)::int n FROM document_versions WHERE drive_file_id = 'F_course_id'"))[0].n, 1);
});

test("créer un fichier identifié via attacherDocument est un 409 explicite, jamais un rattachement silencieux", async () => {
  await preuve(331, 1, "maitrise", { session: 1 });
  await documentRattache("F_deja", []);
  await erreur(() => transaction((cx) => attacherDocument(cx, { preuveId: 331, fichier: fichier("F_deja"), controle: OK, utilisateurId: 1 })), "fichier_deja_identifie");
  assert.equal((await lire("SELECT count(*)::int n FROM preuve_documents WHERE preuve_id = 331"))[0].n, 0);
});

test("deux rattachements simultanés du même document à la même preuve : un seul lien, un seul miroir", async () => {
  await preuve(341, 1, "maitrise", { session: 1 });
  const d = await documentRattache("F_double_lien", []);
  const essais = await Promise.allSettled([
    transaction((cx) => attacherDocument(cx, { preuveId: 341, documentId: d, utilisateurId: 1 })),
    transaction((cx) => attacherDocument(cx, { preuveId: 341, documentId: d, utilisateurId: 1 })),
  ]);
  assert.ok(essais.every((e) => e.status === "fulfilled"), "aucune erreur : le second est un no-op");
  const sorties = essais.map((e) => e.value.deja_rattache).sort();
  assert.deepEqual(sorties, [false, true]);
  assert.equal((await lire("SELECT count(*)::int n FROM preuve_fichiers WHERE preuve_id = 341"))[0].n, 1);
});

test("échec du contrôle Drive pendant un remplacement : aucune écriture", async () => {
  await preuve(351, 1, "maitrise", { session: 1 });
  const d = await documentRattache("F_controle_ko", [351]);
  const versionsAvant = await versionsDe(d);
  const refuse = async () => { throw new ErreurDocument(409, "fichier_hors_racine", "hors racine"); };
  await erreur(() => transaction((cx) => remplacerDocument(cx, { controle: refuse, documentId: d, fichier: fichier("F_controle_ko_v2"), versionAttendue: 1, utilisateurId: 1 })), "fichier_hors_racine");
  assert.deepEqual(await versionsDe(d), versionsAvant);
  assert.equal((await statut(351)).statut, "maitrise");
});

test("un fichier manuel sans contrôle Drive est refusé par programme (aucune création silencieuse)", async () => {
  await assert.rejects(() => transaction((cx) => creerDocument(cx, { fichier: fichier("F_sans_controle") })), /Contrôle Drive requis/);
  assert.equal((await lire("SELECT count(*)::int n FROM documents WHERE drive_file_id = 'F_sans_controle'"))[0].n, 0);
});

test("graphes qui se chevauchent sous concurrence : aucun interblocage, invariants vérifiés à chaque tour", async () => {
  for (let tour = 0; tour < 6; tour++) {
    const base = 1000 + tour * 10;
    for (let k = 1; k <= 3; k++) await preuve(base + k, k, "maitrise", { session: 1 });
    const X = await documentRattache(`X_${tour}`, [base + 1, base + 2]);
    const Y = await documentRattache(`Y_${tour}`, [base + 2, base + 3]);
    const Z = await documentRattache(`Z_${tour}`, [base + 3]);

    const resultats = await Promise.allSettled([
      transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: X, fichier: fichier(`X_${tour}_v2`), versionAttendue: 1, utilisateurId: 1 })),
      transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: Z, fichier: fichier(`Z_${tour}_v2`), versionAttendue: 1, utilisateurId: 1 })),
      transaction((cx) => revaliderLien(cx, { preuveId: base + 2, documentId: Y, utilisateurId: 1 })),
      transaction((cx) => detacherDocument(cx, { preuveId: base + 3, documentId: Y })),
      transaction((cx) => attacherDocument(cx, { preuveId: base + 3, fichier: fichier(`W_${tour}`), controle: OK, utilisateurId: 1 })),
      transaction((cx) => changerStatut(cx, base + 2, "admin_statut", { statut: "maitrise" })),
      transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: Y, fichier: fichier(`Y_${tour}_v2`), versionAttendue: 1, utilisateurId: 1 })),
    ]);
    const erreurs = resultats.filter((r) => r.status === "rejected").map((r) => r.reason);
    for (const e of erreurs) {
      assert.notEqual(e.code, "40P01", "aucun interblocage PostgreSQL");
      assert.ok(
        ["version_obsolete", "lien_introuvable", "revalidations_en_attente", "fichier_deja_identifie", "version_deja_courante"].includes(e.code),
        `erreur métier attendue, obtenue ${e.code} : ${e.message}`
      );
    }
    await invariants();
  }
});

test("graphe qui évolue pendant un remplacement : la nouvelle preuve voit la nouvelle version", async () => {
  await preuve(1101, 1, "maitrise", { session: 1 });
  await preuve(1102, 2, "maitrise", { session: 1 });
  const d = await documentRattache("F_evolue", [1101]);
  const [remp, att] = await Promise.allSettled([
    transaction((cx) => remplacerDocument(cx, { controle: OK, documentId: d, fichier: fichier("F_evolue_v2"), versionAttendue: 1, utilisateurId: 1 })),
    transaction((cx) => attacherDocument(cx, { preuveId: 1102, documentId: d, utilisateurId: 1 })),
  ]);
  assert.equal(remp.status, "fulfilled");
  assert.equal(att.status, "fulfilled");
  // Deux ordres de sérialisation sont valides ; le résultat doit correspondre à l'ordre obtenu.
  const [lien] = await lire("SELECT version_validee FROM preuve_documents WHERE preuve_id = 1102 AND document_id = $1", [d]);
  if (lien.version_validee === 2) {
    assert.deepEqual(await statut(1102), { statut: "maitrise", statut_avant_remplacement: null }, "attachement après remplacement : version revue 2, maîtrise conservée");
  } else {
    assert.equal(lien.version_validee, 1, "attachement avant remplacement : version revue 1");
    assert.deepEqual(await statut(1102), { statut: "a_consolider", statut_avant_remplacement: "maitrise" }, "attachement avant remplacement : en attente");
  }
  await invariants();
});
