// ─────────────────────────────────────────────────────────────
//  L11 — Tests transversaux de bout en bout sur PostgreSQL RÉEL
//  (embedded-postgres) + application Express réelle + client Google FAKE.
//
//  Contenu :
//   · migrations 001→013 depuis zéro, idempotence, montée incrémentale ;
//   · parcours A2C complet (formation → … → régénération) ;
//   · parcours contributeur (autorisés / refusés) ;
//   · cohérences relationnelles (croisements refusés) ;
//   · rollback d'un import transactionnel.
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
import { setDriveFactory, DRIVE_FILE } from "../src/services/google.js";
import { encode } from "../src/session.js";

const PORT = 55445; // distinct du harnais manuel (55433)
const DATA = path.join(os.tmpdir(), "vq-l11-" + process.pid);
const DIR_MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../db/migrations");
const DOC = "application/vnd.google-apps.document";

let cluster, pool, serveur, origine, adminId, contribId;

// ── Client Google FAKE minimal pour la génération ────────────
function googleFake() {
  const trace = { copies: 0, copiesCreees: [], corbeille: [] };
  let n = 0;
  const client = {
    row: { scopes: DRIVE_FILE, expiry: Date.now() + 60_000, access_token: "x" },
    drive: {
      files: {
        get: async () => ({ data: { id: "MODELE", name: "Attestation", mimeType: DOC, trashed: false } }),
        list: async () => ({ data: { files: [] } }),
        create: async () => ({ data: { id: "dossier-" + ++n } }),
        copy: async ({ requestBody }) => {
          trace.copies++;
          const id = "copie-" + trace.copies;
          trace.copiesCreees.push(id);
          return { data: { id, name: requestBody.name, webViewLink: "https://d/" + id, mimeType: DOC } };
        },
        update: async ({ fileId, requestBody }) => {
          if (requestBody?.trashed) trace.corbeille.push(fileId);
          return { data: {} };
        },
      },
    },
    docs: {
      documents: {
        get: async ({ documentId }) => (documentId === "MODELE"
          ? { data: { body: { content: [] }, headers: {}, footers: {} } }
          : { data: { body: { content: [] }, headers: {}, footers: {} } }),
        batchUpdate: async () => ({ data: {} }),
      },
    },
    sheets: { spreadsheets: { batchUpdate: async () => ({ data: {} }) } },
  };
  return { trace, client };
}

// Applique les N premières migrations (ou toutes si limite absent) en direct,
// pour simuler une base arrêtée en cours de route.
async function appliquerJusqua(p, limite) {
  await p.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    nom text PRIMARY KEY, applique_le timestamptz NOT NULL DEFAULT now())`);
  const files = (await fs.readdir(DIR_MIGRATIONS)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const cibles = limite === undefined ? files : files.slice(0, limite);
  for (const f of cibles) {
    const sql = await fs.readFile(path.join(DIR_MIGRATIONS, f), "utf8");
    const cx = await p.connect();
    try {
      await cx.query("BEGIN");
      await cx.query(sql);
      await cx.query("INSERT INTO schema_migrations (nom) VALUES ($1) ON CONFLICT DO NOTHING", [f]);
      await cx.query("COMMIT");
    } finally { cx.release(); }
  }
  return cibles;
}

before(async () => {
  cluster = new EmbeddedPostgres({
    databaseDir: DATA, port: PORT, user: "postgres", password: "postgres",
    persistent: false, onLog: () => {}, onError: () => {},
  });
  await cluster.initialise();
  await cluster.start();
  const racine = cluster.getPgClient("postgres");
  await racine.connect();
  await racine.query("CREATE DATABASE vq");
  await racine.end();

  pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/vq`, ssl: false });
  setPoolFactory(() => pool);
  setQueryExecutor((text, params) => pool.query(text, params));

  await migrate({ log: () => {} });
  await seedReferentiel();

  const { rows: [admin] } = await pool.query(
    "INSERT INTO utilisateurs (email, nom, role) VALUES ($1, $2, 'admin') RETURNING id",
    ["admin@e2e.local", "Mme Stark"]);
  const { rows: [contrib] } = await pool.query(
    "INSERT INTO utilisateurs (email, nom, role) VALUES ($1, $2, 'contributeur') RETURNING id",
    ["contrib@e2e.local", "Tukui"]);
  adminId = admin.id;
  contribId = contrib.id;

  const { trace, client } = googleFake();
  setDriveFactory(() => client);

  serveur = createApp().listen(0);
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

const ck = (uid) => "vq_session=" + encode({ uid, exp: Date.now() + 60_000 });
const api = async (methode, chemin, corps, utilisateurId) => {
  const r = await fetch(origine + chemin, {
    method: methode,
    headers: {
      "content-type": "application/json",
      ...(utilisateurId ? { cookie: ck(utilisateurId) } : {}),
    },
    ...(corps === undefined || corps === null ? {} : { body: JSON.stringify(corps) }),
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};

// ── Migrations ───────────────────────────────────────────────

test("migrations 001→013 appliquées depuis zéro, dans l'ordre", async () => {
  const { rows } = await pool.query("SELECT nom FROM schema_migrations ORDER BY nom");
  const noms = rows.map((r) => r.nom);
  assert.equal(noms.length, 13, "13 migrations attendues");
  assert.match(noms[0], /^001_/, "commence par 001");
  assert.match(noms[12], /^013_/, "finit par 013");
  // Tables clés présentes.
  for (const t of ["referentiel_versions", "sessions", "preuves", "veille", "satisfactions"]) {
    const { rowCount } = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = $1", [t]);
    assert.equal(rowCount, 1, `table ${t} absente`);
  }
});

test("relancer les migrations ne rejoue rien (idempotence)", async () => {
  const appliquees = await migrate({ log: () => {} });
  assert.deepEqual(appliquees, [], "aucune migration rejouée");
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM schema_migrations");
  assert.equal(rows[0].n, 13);
});

test("montée incrémentale : base arrêtée à 010, données conservées après 011→013", async () => {
  const racine = cluster.getPgClient("postgres");
  await racine.connect();
  await racine.query("CREATE DATABASE vq_incr");
  await racine.end();
  const p = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/vq_incr`, ssl: false });

  await appliquerJusqua(p, 10);   // 001 → 010
  const { rows: [formation] } = await p.query(
    "INSERT INTO formations (intitule, code_interne) VALUES ($1, $2) RETURNING id",
    ["Formation historique", "HIST-1"]);
  await p.query("INSERT INTO formation_versions (formation_id, numero) VALUES ($1, 1)", [formation.id]);
  await p.query(
    "INSERT INTO sessions (formation_id, formation_version_id, reference, date_debut, date_fin) VALUES ($1, 1, $2, $3, $4)",
    [formation.id, "SESS-HIST", "2026-01-05", "2026-03-05"]);

  // Finit la montée avec le vrai runner (011→013).
  setPoolFactory(() => p);
  const appliquees = await migrate({ log: () => {} });
  setPoolFactory(() => pool);   // restaure la fabrique principale
  assert.deepEqual(appliquees.map((m) => m.slice(0, 3)), ["011", "012", "013"]);

  const { rows: [{ n }] } = await p.query("SELECT count(*)::int AS n FROM sessions WHERE reference = 'SESS-HIST'");
  assert.equal(n, 1, "la session historique a survécu");
  await p.end();
});

// ── Parcours A2C de bout en bout ─────────────────────────────

test("parcours A2C complet : formation → … → régénération", async () => {
  const A = adminId;

  // 1. formation
  const f = await api("POST", "/api/formations", { intitule: "Atelier numérique", code_interne: "AN-2026" }, A);
  assert.equal(f.statut, 201);
  const formationId = f.corps.formation.id;

  // 2. session avec dates et durée
  const s = await api("POST", "/api/sessions", {
    formation_id: formationId, date_debut: "2026-01-05", date_fin: "2026-03-05",
    duree_heures_reelle: 28, reference: "SESS-E2E", lieu: "Cayenne",
  }, A);
  assert.equal(s.statut, 201);
  const sessionId = s.corps.session.id;

  // 3. groupe
  const g = await api("POST", `/api/sessions/${sessionId}/groupes`, { nom: "Soula" }, A);
  assert.equal(g.statut, 201);
  const groupeId = g.corps.groupe.id;

  // 4. stagiaire + inscription (avec prescripteur)
  const st = await api("POST", `/api/sessions/${sessionId}/stagiaires`, {
    civilite: "Mme", nom: "Stark", prenom: "Blandine", email: "blandine@exemple.fr",
    groupe_id: groupeId, prescripteur: "pole_emploi",
  }, A);
  assert.equal(st.statut, 201);
  const inscriptionId = st.corps.inscription.id;

  // 5. absence
  const ab = await api("POST", `/api/inscriptions/${inscriptionId}/absences`, {
    date_absence: "2026-01-06", demi_journee: "matin", duree_heures: 3.5, justifiee: true, motif: "rendez-vous",
  }, A);
  assert.equal(ab.statut, 201);

  // 6. assiduité recalculée (3,5 h sur 28 h)
  const ass = await api("GET", `/api/sessions/${sessionId}/absences`, null, A);
  assert.equal(ass.statut, 200);
  const fiche = ass.corps.stagiaires.find((x) => x.inscription_id === inscriptionId);
  assert.ok(fiche, "fiche d'assiduité présente");
  assert.ok(fiche.total_heures_absence >= 3.5, "heures d'absence cumulées");
  assert.ok(fiche.assiduite.taux >= 0 && fiche.assiduite.taux <= 100, "taux borné");

  // 7. évaluation dans la période
  const ev = await api("POST", `/api/sessions/${sessionId}/evaluations`, {
    inscription_id: inscriptionId, type: "qcm", intitule: "QCM final",
    date_passage: "2026-02-10", score: 18, score_max: 20, resultat: "valide",
  }, A);
  assert.equal(ev.statut, 201);

  // 8. satisfaction
  const sat = await api("POST", `/api/sessions/${sessionId}/satisfactions`, {
    type: "a_chaud", date_recueil: "2026-03-01", note_globale: 4, note_max: 5,
  }, A);
  assert.equal(sat.statut, 201);

  // 9. preuve (indicateur du référentiel actif)
  const ref = await api("GET", "/api/referentiel", null, A);
  const indicateur = ref.corps.criteres[0].indicateurs[0];
  const pr = await api("POST", "/api/preuves", {
    indicateur_id: indicateur.id, titre: "Attestation E2E", session_id: sessionId,
  }, A);
  assert.equal(pr.statut, 201);

  // 10. modèle + génération (client Google fake)
  const mo = await api("POST", "/api/modeles", {
    nom: "Attestation", lien: "https://drive.google.com/open?id=MODELE1234567890",
    portee: "stagiaire", indicateurs: [indicateur.numero], drive_mime: DOC,
  }, A);
  assert.equal(mo.statut, 201);
  const modeleId = mo.corps.modele.id;

  const gen = await api("POST", "/api/generations", { modele_id: modeleId, session_id: sessionId }, A);
  assert.equal(gen.statut, 200, JSON.stringify(gen.corps));
  assert.equal(gen.corps.documents, 1);

  // 11. modification d'un champ imprimé → documents potentiellement obsolètes
  const patch = await api("PATCH", `/api/sessions/${sessionId}`, { lieu: "Kourou" }, A);
  assert.equal(patch.statut, 200);
  assert.equal(patch.corps.documentsObsoletes, true);

  // 12. régénération (ancien fichier archivé après commit)
  const regen = await api("POST", "/api/generations", { modele_id: modeleId, session_id: sessionId, remplacer: true }, A);
  assert.equal(regen.statut, 200);
  assert.equal(regen.corps.remplaces, 1);

  // 13. vérification finale cohérente
  const fin = await api("GET", `/api/sessions/${sessionId}`, null, A);
  assert.equal(fin.statut, 200);
  assert.equal(fin.corps.stagiaires.length, 1);
  assert.equal(fin.corps.documents.length, 1, "un document généré");
  assert.equal(fin.corps.documents[0].modele, "Attestation");
});

// ── Parcours contributeur ────────────────────────────────────

test("contributeur : saisies pédagogiques OK, administration refusée", async () => {
  const C = contribId;
  // Trouve une session existante (créée au parcours précédent).
  const sessions = await api("GET", "/api/sessions", null, C);
  assert.equal(sessions.statut, 200);
  const sessionId = sessions.corps.sessions[0].id;

  // Autorisé : consulter, ajouter un stagiaire, une absence, une évaluation, une satisfaction.
  assert.equal((await api("GET", `/api/sessions/${sessionId}`, null, C)).statut, 200);
  const st = await api("POST", `/api/sessions/${sessionId}/stagiaires`, { nom: "Tonate", prenom: "Noé" }, C);
  assert.equal(st.statut, 201);
  const ev = await api("POST", `/api/sessions/${sessionId}/evaluations`, {
    inscription_id: st.corps.inscription.id, type: "autre", intitule: "positionnement",
    date_passage: "2026-01-15", resultat: "non_determine",
  }, C);
  assert.equal(ev.statut, 201);
  const sat = await api("POST", `/api/sessions/${sessionId}/satisfactions`, {
    type: "a_froid", date_recueil: "2026-04-01", note_globale: 3, note_max: 5,
  }, C);
  assert.equal(sat.statut, 201);

  // Refusé : administration / référentiel / veille / modèles / Drive / preuves.
  for (const [m, p, b] of [
    ["POST", "/api/referentiel/versions", { code: "V99", libelle: "x" }],
    ["POST", "/api/formations", { intitule: "x" }],
    ["POST", "/api/preuves", { indicateur_id: 1, titre: "x" }],
    ["POST", "/api/modeles", { nom: "x", lien: "https://d/abc1234567890", portee: "stagiaire" }],
    ["POST", "/api/veille", { titre: "x" }],
  ]) {
    const r = await api(m, p, b, C);
    assert.equal(r.statut, 403, `${m} ${p} doit être 403 pour un contributeur`);
  }
  assert.equal((await api("GET", "/api/drive/recherche?q=abc", null, C)).statut, 403);
  assert.equal((await api("GET", "/api/drive/status", null, C)).statut, 403);
});

// ── Cohérences relationnelles (croisements refusés) ──────────

test("croisements incohérents refusés, aucune écriture partielle", async () => {
  const A = adminId;
  // Deux sessions distinctes.
  const s1 = await api("POST", "/api/sessions", { formation_id: (await api("GET", "/api/formations", null, A)).corps.formations[0].id, date_debut: "2026-01-05", date_fin: "2026-03-05", reference: "SESS-A" }, A);
  const s2 = await api("POST", "/api/sessions", { formation_id: (await api("GET", "/api/formations", null, A)).corps.formations[0].id, date_debut: "2026-04-06", date_fin: "2026-06-06", reference: "SESS-B" }, A);
  const sessionA = s1.corps.session.id, sessionB = s2.corps.session.id;
  const grpA = (await api("POST", `/api/sessions/${sessionA}/groupes`, { nom: "GA" }, A)).corps.groupe.id;

  // Stagiaire de la session A.
  const stA = await api("POST", `/api/sessions/${sessionA}/stagiaires`, { nom: "A", prenom: "Un", groupe_id: grpA }, A);
  const inscA = stA.corps.inscription.id;

  // Inscription d'une autre session refusée dans une évaluation de la session B.
  const evCroise = await api("POST", `/api/sessions/${sessionB}/evaluations`, {
    inscription_id: inscA, type: "qcm", date_passage: "2026-05-10", resultat: "non_determine",
  }, A);
  assert.equal(evCroise.statut, 400);
  assert.match(evCroise.corps.error, /n'appartient pas/);

  // Satisfaction nominative croisée refusée.
  const satCroise = await api("POST", `/api/sessions/${sessionB}/satisfactions`, {
    type: "a_chaud", date_recueil: "2026-05-10", inscription_id: inscA,
  }, A);
  assert.equal(satCroise.statut, 400);

  // Absence hors période refusée.
  const abHors = await api("POST", `/api/inscriptions/${inscA}/absences`, {
    date_absence: "2026-09-01", duree_heures: 2,
  }, A);
  assert.equal(abHors.statut, 400);

  // Génération avec un groupe d'une autre session refusée.
  const genCroise = await api("POST", "/api/generations", {
    modele_id: 1, session_id: sessionB, groupe_id: grpA,
  }, A);
  assert.equal(genCroise.statut, 400);
  assert.match(genCroise.corps.error, /Groupe introuvable/);
});

// ── Rollback d'import ────────────────────────────────────────

test("un import d'évaluations invalide n'écrit rien (rollback)", async () => {
  const A = adminId;
  const sessions = await api("GET", "/api/sessions", null, A);
  const sessionId = sessions.corps.sessions[0].id;
  const st = await api("POST", `/api/sessions/${sessionId}/stagiaires`, { nom: "Dupont", prenom: "X", email: "dupont@exemple.fr" }, A);
  assert.equal(st.statut, 201);

  const csv = "email;type;date;resultat\ndupont@exemple.fr;qcm;2026-09-01;valide\n"; // hors période
  const r = await api("POST", `/api/sessions/${sessionId}/evaluations/import`, { texte: csv }, A);
  assert.equal(r.statut, 200);
  assert.equal(r.corps.bilan.importes, 0, "aucune ligne importée");
  const { rows: [{ n }] } = await pool.query(
    "SELECT count(*)::int AS n FROM resultats_qcm e JOIN inscriptions i ON i.id = e.inscription_id WHERE i.session_id = $1", [sessionId]);
  assert.equal(n, 0, "aucune évaluation écrite");
});
