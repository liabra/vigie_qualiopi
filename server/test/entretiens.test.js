// ─────────────────────────────────────────────────────────────
//  DOC-9C — Entretiens initiaux FSE-IA : routes et règles métier,
//  base PostgreSQL RÉELLE + Express réelle.
//
//  Couvert : plusieurs entretiens par jeune, création sans inscription,
//  sauvegarde/reprise de brouillon, distinction des sources, validation
//  explicite, refus des données interdites, droits, conflits de version,
//  non-régression DOC-9B.
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

const PORT = 55464;
const DATA = path.join(os.tmpdir(), "vq-entretiens-" + process.pid);

let cluster, pool, serveur, origine, adminId, contribId;

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
  setQueryExecutor((text, params) => pool.query(text, params));
  await migrate({ log: () => {} });
  await seedReferentiel();
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@e.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@e.local', 'Tukui', 'contributeur') RETURNING id"));
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
  await fs.rm(DATA, { recursive: true, force: true }).catch(() => {});
});

const cookie = (uid) => "vq_session=" + encode({ uid, exp: Date.now() + 60_000 });
const A = () => ({ cookie: cookie(adminId) });
const C = () => ({ cookie: cookie(contribId) });
const api = async (methode, chemin, corps, enTetes = {}) => {
  const r = await fetch(origine + chemin, { method: methode, headers: { "content-type": "application/json", ...enTetes }, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};
const ok = (r) => { assert.ok(r.statut < 300, JSON.stringify(r.corps)); return r.corps; };

async function creerStagiaire() {
  return ok(await api("POST", "/api/stagiaires", { nom: "Durand", prenom: "Élodie", email: "elodie.durand@exemple.fr" }, A())).stagiaire;
}

// ── Migration ────────────────────────────────────────────────

test("migration 026 : tables entretiens et entretien_reponses présentes", async () => {
  for (const t of ["entretiens", "entretien_reponses"]) {
    assert.equal((await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = $1", [t])).rowCount, 1, t);
  }
  const { rows } = await pool.query("SELECT nom FROM schema_migrations WHERE nom = '026_entretiens_initiaux.sql'");
  assert.equal(rows.length, 1, "migration 026 appliquée");
});

// ── Création / listage / multiple ────────────────────────────

test("créer plusieurs entretiens pour un même jeune, sans inscription", async () => {
  const st = await creerStagiaire();
  const e1 = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, C())).entretien;
  const e2 = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;
  assert.equal(e1.statut, "brouillon");
  assert.equal(e1.version, 1);
  assert.notEqual(e1.id, e2.id);

  const liste = ok(await api("GET", `/api/stagiaires/${st.id}/entretiens`, undefined, A()));
  assert.equal(liste.total, 2, "deux entretiens pour la même personne");

  // Aucune inscription créée.
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM inscriptions WHERE stagiaire_id = $1", [st.id]);
  assert.equal(n, 0);
});

test("création pour un stagiaire inexistant : 404", async () => {
  assert.equal((await api("POST", "/api/stagiaires/999999/entretiens", undefined, A())).statut, 404);
});

// ── Sauvegarde / reprise / sources ───────────────────────────

test("sauvegarde progressive, reprise, distinction des sources", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;

  const save = await api("PUT", `/api/entretiens/${e.id}/reponses`, {
    version: 1,
    reponses: [
      { cle: "motif_venue", valeur: "Trouver un emploi" },
      { cle: "parole_jeune", valeur: "Je veux avancer" },
      { cle: "synthese", valeur: "Motivé, à accompagner sur la mobilité" },
    ],
  }, A());
  assert.equal(save.statut, 200);
  assert.equal(save.corps.entretien.version, 2, "version incrémentée");

  const relu = ok(await api("GET", `/api/entretiens/${e.id}`, undefined, A()));
  assert.equal(relu.entretien.statut, "brouillon");
  const parCle = Object.fromEntries(relu.reponses.map((r) => [r.cle, r]));
  assert.equal(parCle.motif_venue.valeur, "Trouver un emploi");
  assert.equal(parCle.motif_venue.source, "jeune");
  assert.equal(parCle.synthese.source, "accompagnateur", "synthèse = accompagnateur");
  assert.equal(parCle.parole_jeune.source, "jeune", "parole du jeune = jeune");
});

test("reprise : un brouillon vide se relit sans erreur", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;
  const relu = ok(await api("GET", `/api/entretiens/${e.id}`, undefined, A()));
  assert.deepEqual(relu.reponses, []);
  assert.equal(relu.entretien.statut, "brouillon");
});

// ── Refus des données interdites ─────────────────────────────

test("refus des clés inconnues, médicales, vides, en double", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;

  assert.equal((await api("PUT", `/api/entretiens/${e.id}/reponses`, { version: 1, reponses: [{ cle: "rqth", valeur: "oui" }] }, A())).statut, 400);
  assert.equal((await api("PUT", `/api/entretiens/${e.id}/reponses`, { version: 1, reponses: [{ cle: "motif_venue", valeur: "" }] }, A())).statut, 400);
  assert.equal((await api("PUT", `/api/entretiens/${e.id}/reponses`, { version: 1, reponses: [{ cle: "motif_venue", valeur: "a" }, { cle: "motif_venue", valeur: "b" }] }, A())).statut, 400);
  // version absente ou invalide
  assert.equal((await api("PUT", `/api/entretiens/${e.id}/reponses`, { reponses: [] }, A())).statut, 400);
});

// ── Validation explicite ─────────────────────────────────────

test("validation explicite : brouillon → valide ; revalidation refusée ; écriture figée", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;

  const v = await api("POST", `/api/entretiens/${e.id}/valider`, undefined, A());
  assert.equal(v.statut, 200);
  assert.equal(v.corps.entretien.statut, "valide");
  assert.ok(v.corps.entretien.valide_le, "date de validation posée");

  assert.equal((await api("POST", `/api/entretiens/${e.id}/valider`, undefined, A())).statut, 409, "déjà validé");
  assert.equal((await api("PUT", `/api/entretiens/${e.id}/reponses`, { version: 1, reponses: [{ cle: "motif_venue", valeur: "x" }] }, A())).statut, 409, "validé = lecture seule");
});

// ── Conflit de version ───────────────────────────────────────

test("conflit : version périmée refusée (409), aucune écriture partielle", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;

  ok(await api("PUT", `/api/entretiens/${e.id}/reponses`, { version: 1, reponses: [{ cle: "motif_venue", valeur: "premier" }] }, A()));

  // Rejoue avec l'ancienne version : refus.
  const conflit = await api("PUT", `/api/entretiens/${e.id}/reponses`, { version: 1, reponses: [{ cle: "motif_venue", valeur: "écrasement" }] }, A());
  assert.equal(conflit.statut, 409);

  const relu = ok(await api("GET", `/api/entretiens/${e.id}`, undefined, A()));
  const motif = relu.reponses.find((r) => r.cle === "motif_venue");
  assert.equal(motif.valeur, "premier", "l'écrasement n'a pas eu lieu");
});

// ── Droits ───────────────────────────────────────────────────

test("droits : anonyme refusé ; contributeur autorisé en écriture", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;

  assert.equal((await api("GET", `/api/entretiens/${e.id}`, undefined)).statut, 401);
  assert.equal((await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined)).statut, 401);
  assert.equal((await api("PUT", `/api/entretiens/${e.id}/reponses`, { version: 1, reponses: [] }, undefined)).statut, 401);

  assert.equal((await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, C())).statut, 201, "contributeur autorisé");
});

// ── DOC-9D2 lot B : questionnaire de positionnement (6 phases) ──

test("migration 029 : tables de positionnement présentes", async () => {
  for (const t of ["entretien_positionnement_evaluations", "entretien_positionnement_phases"]) {
    assert.equal((await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = $1", [t])).rowCount, 1, t);
  }
});

test("positionnement : sauvegarde progressive, reprise, cohabite avec les réponses classiques", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;

  // Les réponses classiques (rubriques 3-13) d'abord.
  const r1 = ok(await api("PUT", `/api/entretiens/${e.id}/reponses`, { version: 1, reponses: [{ cle: "motif_venue", valeur: "Retour emploi" }] }, A()));
  assert.equal(r1.entretien.version, 2);

  // Puis le positionnement, sur le MÊME verrou de version (partagé).
  const r2 = await api("PUT", `/api/entretiens/${e.id}/positionnement`, {
    version: 2,
    evaluations: [
      { competence_code: "p1_c1", niveau: "autonome" },
      { competence_code: "p2_c4", niveau: "avec_aide" },
    ],
    phases: [{ phase: 1, priorite: "forte", observations: "Bon démarrage" }],
  }, A());
  assert.equal(r2.statut, 200);
  assert.equal(r2.corps.entretien.version, 3, "le même compteur de version avance");

  const relu = ok(await api("GET", `/api/entretiens/${e.id}`, undefined, A()));
  assert.equal(relu.reponses.length, 1, "les réponses classiques sont intactes");
  assert.equal(relu.positionnement.evaluations.length, 2);
  assert.deepEqual(relu.positionnement.evaluations.find((ev) => ev.competence_code === "p2_c4"), { phase: 2, competence_code: "p2_c4", niveau: "avec_aide" });
  assert.equal(relu.positionnement.phases.length, 1);
  assert.equal(relu.positionnement.phases[0].priorite, "forte");

  // Reprise : un deuxième enregistrement remplace, n'empile pas.
  const r3 = ok(await api("PUT", `/api/entretiens/${e.id}/positionnement`, {
    version: 3,
    evaluations: [{ competence_code: "p1_c1", niveau: "a_developper" }],
    phases: [],
  }, A()));
  assert.equal(r3.entretien.version, 4);
  const relu2 = ok(await api("GET", `/api/entretiens/${e.id}`, undefined, A()));
  assert.equal(relu2.positionnement.evaluations.length, 1);
  assert.equal(relu2.positionnement.evaluations[0].niveau, "a_developper");
  assert.equal(relu2.positionnement.phases.length, 0, "une phase omise est effacée, pas inventée");
});

test("positionnement : compétence inconnue, niveau invalide, phase hors 1-6 refusés (aucune invention)", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;

  assert.equal((await api("PUT", `/api/entretiens/${e.id}/positionnement`, { version: 1, evaluations: [{ competence_code: "p9_c1", niveau: "autonome" }], phases: [] }, A())).statut, 400);
  assert.equal((await api("PUT", `/api/entretiens/${e.id}/positionnement`, { version: 1, evaluations: [{ competence_code: "p1_c1", niveau: "parfait" }], phases: [] }, A())).statut, 400);
  assert.equal((await api("PUT", `/api/entretiens/${e.id}/positionnement`, { version: 1, evaluations: [], phases: [{ phase: 7, priorite: "forte" }] }, A())).statut, 400);
  assert.equal((await api("PUT", `/api/entretiens/${e.id}/positionnement`, { version: 1, evaluations: [], phases: [{ phase: 1, priorite: "critique" }] }, A())).statut, 400);
  // Aucune écriture partielle derrière ces refus.
  const relu = ok(await api("GET", `/api/entretiens/${e.id}`, undefined, A()));
  assert.equal(relu.positionnement.evaluations.length, 0);
  assert.equal(relu.positionnement.phases.length, 0);
});

test("positionnement : conflit de version refusé (409), figé après validation", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;
  ok(await api("PUT", `/api/entretiens/${e.id}/positionnement`, { version: 1, evaluations: [{ competence_code: "p1_c1", niveau: "autonome" }], phases: [] }, A()));

  const conflit = await api("PUT", `/api/entretiens/${e.id}/positionnement`, { version: 1, evaluations: [{ competence_code: "p1_c1", niveau: "a_developper" }], phases: [] }, A());
  assert.equal(conflit.statut, 409);
  const relu = ok(await api("GET", `/api/entretiens/${e.id}`, undefined, A()));
  assert.equal(relu.positionnement.evaluations[0].niveau, "autonome", "aucun écrasement");

  ok(await api("POST", `/api/entretiens/${e.id}/valider`, undefined, A()));
  assert.equal((await api("PUT", `/api/entretiens/${e.id}/positionnement`, { version: 2, evaluations: [], phases: [] }, A())).statut, 409, "validé = lecture seule");
});

test("positionnement : droits — anonyme refusé", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;
  assert.equal((await api("PUT", `/api/entretiens/${e.id}/positionnement`, { version: 1, evaluations: [], phases: [] }, undefined)).statut, 401);
});

// ── Non-régression DOC-9B ────────────────────────────────────

test("non-régression DOC-9B : POST /api/stagiaires et recherche toujours opérationnels", async () => {
  const r = await api("POST", "/api/stagiaires", { nom: "Martin", prenom: "Alice", email: "alice.martin@exemple.fr" }, A());
  assert.equal(r.statut, 201);
  const q = ok(await api("GET", "/api/stagiaires?q=Martin", undefined, A()));
  assert.equal(q.total, 1);
});
