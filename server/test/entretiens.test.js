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
import { setDriveFactory, DRIVE_FILE } from "../src/services/google.js";

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
  setDriveFactory(null);
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

// ── DOC-9D3 lot B/C : champs étendus (choix, lignes), cohabitation ──

test("migration 030 : tables de choix et de lignes répétables présentes", async () => {
  for (const t of ["entretien_choix", "entretien_experiences", "entretien_plan_action"]) {
    assert.equal((await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = $1", [t])).rowCount, 1, t);
  }
});

test("choix et lignes : sauvegarde, reprise, cohabitent avec réponses et positionnement", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;

  let v = 1;
  const r1 = ok(await api("PUT", `/api/entretiens/${e.id}/reponses`, { version: v, reponses: [{ cle: "resume_demande", valeur: "Trouver un métier" }] }, A())); v = r1.entretien.version;
  const r2 = ok(await api("PUT", `/api/entretiens/${e.id}/choix`, { version: v, choix: [{ groupe: "loisirs", code: "sport" }, { groupe: "objectifs_souhaites", code: "emploi" }] }, A())); v = r2.entretien.version;
  const r3 = ok(await api("PUT", `/api/entretiens/${e.id}/lignes`, {
    version: v, bloc: "experiences", lignes: [{ ordre: 1, structure: "Stage découverte", missions: "Accueil" }],
  }, A())); v = r3.entretien.version;
  const r4 = ok(await api("PUT", `/api/entretiens/${e.id}/lignes`, {
    version: v, bloc: "plan_action", lignes: [{ ordre: 1, objectif: "Reprendre confiance", phase: 1, etat: "a_faire" }],
  }, A())); v = r4.entretien.version;
  assert.equal(v, 5, "4 écritures successives, un seul compteur de version");

  const relu = ok(await api("GET", `/api/entretiens/${e.id}`, undefined, A()));
  assert.equal(relu.reponses.find((r) => r.cle === "resume_demande").valeur, "Trouver un métier");
  assert.deepEqual(relu.choix.map((c) => `${c.groupe}:${c.code}`).sort(), ["loisirs:sport", "objectifs_souhaites:emploi"]);
  assert.equal(relu.lignes.experiences.length, 1);
  assert.equal(relu.lignes.experiences[0].structure, "Stage découverte");
  assert.equal(relu.lignes.plan_action.length, 1);
  assert.equal(relu.lignes.plan_action[0].etat, "a_faire");

  // Modifier le bloc « expériences » NE touche PAS le bloc « plan_action ».
  const r5 = ok(await api("PUT", `/api/entretiens/${e.id}/lignes`, { version: v, bloc: "experiences", lignes: [] }, A()));
  const relu2 = ok(await api("GET", `/api/entretiens/${e.id}`, undefined, A()));
  assert.equal(relu2.lignes.experiences.length, 0, "expériences vidées");
  assert.equal(relu2.lignes.plan_action.length, 1, "plan d'action intact");
  assert.equal(relu2.choix.length, 2, "les choix restent intacts");
  assert.equal(r5.entretien.version, 6);
});

test("choix/lignes : option inconnue, ligne vide, conflit de version refusés sans écriture partielle", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;

  assert.equal((await api("PUT", `/api/entretiens/${e.id}/choix`, { version: 1, choix: [{ groupe: "loisirs", code: "escalade" }] }, A())).statut, 400);
  assert.equal((await api("PUT", `/api/entretiens/${e.id}/lignes`, { version: 1, bloc: "experiences", lignes: [{ ordre: 1 }] }, A())).statut, 400, "ligne vide refusée");
  assert.equal((await api("PUT", `/api/entretiens/${e.id}/lignes`, { version: 1, bloc: "inconnu", lignes: [] }, A())).statut, 400);

  ok(await api("PUT", `/api/entretiens/${e.id}/choix`, { version: 1, choix: [{ groupe: "loisirs", code: "sport" }] }, A()));
  const conflit = await api("PUT", `/api/entretiens/${e.id}/choix`, { version: 1, choix: [{ groupe: "loisirs", code: "lecture" }] }, A());
  assert.equal(conflit.statut, 409);
  const relu = ok(await api("GET", `/api/entretiens/${e.id}`, undefined, A()));
  assert.deepEqual(relu.choix.map((c) => c.code), ["sport"], "aucun écrasement");
});

test("choix/lignes : figés après validation, droits — anonyme refusé", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;
  assert.equal((await api("PUT", `/api/entretiens/${e.id}/choix`, { version: 1, choix: [] }, undefined)).statut, 401);
  assert.equal((await api("PUT", `/api/entretiens/${e.id}/lignes`, { version: 1, bloc: "experiences", lignes: [] }, undefined)).statut, 401);

  ok(await api("POST", `/api/entretiens/${e.id}/valider`, undefined, A()));
  assert.equal((await api("PUT", `/api/entretiens/${e.id}/choix`, { version: 1, choix: [] }, A())).statut, 409);
  assert.equal((await api("PUT", `/api/entretiens/${e.id}/lignes`, { version: 1, bloc: "plan_action", lignes: [] }, A())).statut, 409);
});

// ── DOC-9E : génération de la fiche FSE-IA ───────────────────

function driveSimule({ echoueA = null } = {}) {
  let nDossier = 0;
  let nDoc = 0;
  const requetes = [];
  const supprimes = [];
  const dossiersCrees = [];
  const parentsDesFiches = [];
  return {
    requetes, supprimes, dossiersCrees, parentsDesFiches,
    factory: () => ({
      row: { scopes: DRIVE_FILE, expiry: Date.now() + 60_000, access_token: "x" },
      docs: {
        documents: {
          batchUpdate: async ({ documentId, requestBody }) => {
            if (echoueA === "batchUpdate") throw Object.assign(new Error("Panne Google"), { response: { status: 500 } });
            requetes.push({ documentId, requests: requestBody.requests });
            return { data: {} };
          },
        },
      },
      drive: {
        files: {
          list: async () => ({ data: { files: [] } }), // aucun dossier existant : toujours créé
          create: async ({ requestBody }) => {
            if (requestBody.mimeType === "application/vnd.google-apps.folder") {
              dossiersCrees.push(requestBody.name);
              return { data: { id: "dossier-" + ++nDossier } };
            }
            if (echoueA === "create") throw Object.assign(new Error("Panne Google"), { response: { status: 500 } });
            parentsDesFiches.push(requestBody.parents);
            return { data: { id: "doc-" + ++nDoc } };
          },
          get: async ({ fileId }) => ({ data: { id: fileId, name: "Fiche", webViewLink: "https://drive/" + fileId } }),
          update: async ({ fileId, requestBody }) => { if (requestBody.trashed) supprimes.push(fileId); return { data: {} }; },
        },
      },
    }),
  };
}

test("fiche : refusée tant que l'entretien n'est pas validé, aucune écriture", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;
  const { factory } = driveSimule();
  setDriveFactory(factory);
  const r = await api("POST", `/api/entretiens/${e.id}/fiche`, {}, A());
  assert.equal(r.statut, 400);
  const relu = ok(await api("GET", `/api/entretiens/${e.id}`, undefined, A()));
  assert.equal(relu.entretien.fiche_drive_file_id, null);
});

test("fiche : générée une première fois, puis la régénération est bloquée sans confirmation, puis régénérée avec remplacer:true (ancienne mise à la corbeille)", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;
  ok(await api("PUT", `/api/entretiens/${e.id}/reponses`, { version: 1, reponses: [{ cle: "parole_fierte", valeur: "D'avoir osé venir." }] }, A()));
  ok(await api("POST", `/api/entretiens/${e.id}/valider`, undefined, A()));

  const { factory, requetes, supprimes, dossiersCrees, parentsDesFiches } = driveSimule();
  setDriveFactory(factory);

  const r1 = await api("POST", `/api/entretiens/${e.id}/fiche`, {}, A());
  assert.equal(r1.statut, 200);
  // Rangée dans le dossier habituel des documents générés, jamais à la
  // racine brute du compte Drive (introuvable sinon pour l'équipe).
  assert.deepEqual(dossiersCrees, ["A2C Qualiopi", "Entretiens FSE-IA"]);
  assert.deepEqual(parentsDesFiches[0], ["dossier-2"]);
  const premierId = r1.corps.fiche.id;
  assert.ok(premierId);
  assert.equal(r1.corps.entretien.fiche_drive_file_id, premierId);
  // Le texte inséré doit contenir la réponse réelle, verbatim.
  assert.ok(requetes[0].requests[0].insertText.text.includes("D'avoir osé venir."));

  const r2 = await api("POST", `/api/entretiens/${e.id}/fiche`, {}, A());
  assert.equal(r2.statut, 409, "régénération refusée sans confirmation explicite");
  assert.equal(r2.corps.fiche_existante.drive_file_id, premierId);

  const r3 = await api("POST", `/api/entretiens/${e.id}/fiche`, { remplacer: true }, A());
  assert.equal(r3.statut, 200);
  assert.notEqual(r3.corps.fiche.id, premierId, "un nouveau document est créé, pas une réécriture du même fichier");
  assert.deepEqual(supprimes, [premierId], "l'ancienne fiche est mise à la corbeille après le succès de la nouvelle");

  const relu = ok(await api("GET", `/api/entretiens/${e.id}`, undefined, A()));
  assert.equal(relu.entretien.fiche_drive_file_id, r3.corps.fiche.id);
});

test("fiche : un échec Google ne laisse aucun document orphelin ni aucune trace en base", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;
  ok(await api("POST", `/api/entretiens/${e.id}/valider`, undefined, A()));

  const { factory, supprimes } = driveSimule({ echoueA: "batchUpdate" });
  setDriveFactory(factory);
  const r = await api("POST", `/api/entretiens/${e.id}/fiche`, {}, A());
  assert.equal(r.statut, 400);
  assert.deepEqual(supprimes, ["doc-1"], "le document partiellement créé est mis à la corbeille, jamais présenté comme réussi");

  const relu = ok(await api("GET", `/api/entretiens/${e.id}`, undefined, A()));
  assert.equal(relu.entretien.fiche_drive_file_id, null, "aucune trace en base d'une génération échouée");
});

test("fiche : droits — anonyme refusé, contributeur autorisé", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;
  ok(await api("POST", `/api/entretiens/${e.id}/valider`, undefined, A()));
  const { factory } = driveSimule();
  setDriveFactory(factory);
  assert.equal((await api("POST", `/api/entretiens/${e.id}/fiche`, {}, undefined)).statut, 401);
  assert.equal((await api("POST", `/api/entretiens/${e.id}/fiche`, {}, C())).statut, 200, "contributeur autorisé");
});

test("fiche : modèle Drive indisponible → 503, Drive en lecture seule → 400", async () => {
  const st = await creerStagiaire();
  const e = ok(await api("POST", `/api/stagiaires/${st.id}/entretiens`, undefined, A())).entretien;
  ok(await api("POST", `/api/entretiens/${e.id}/valider`, undefined, A()));

  setDriveFactory(() => null);
  assert.equal((await api("POST", `/api/entretiens/${e.id}/fiche`, {}, A())).statut, 503);

  setDriveFactory(() => ({ row: { scopes: "https://www.googleapis.com/auth/drive.readonly", expiry: Date.now() + 60_000, access_token: "x" } }));
  assert.equal((await api("POST", `/api/entretiens/${e.id}/fiche`, {}, A())).statut, 400);
});

// ── Non-régression DOC-9B ────────────────────────────────────

test("non-régression DOC-9B : POST /api/stagiaires et recherche toujours opérationnels", async () => {
  const r = await api("POST", "/api/stagiaires", { nom: "Martin", prenom: "Alice", email: "alice.martin@exemple.fr" }, A());
  assert.equal(r.statut, 201);
  const q = ok(await api("GET", "/api/stagiaires?q=Martin", undefined, A()));
  assert.equal(q.total, 1);
});
