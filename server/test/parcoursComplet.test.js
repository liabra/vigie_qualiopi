// ─────────────────────────────────────────────────────────────
//  Parcours complet d'une formation, de bout en bout, par l'API réelle :
//  bibliothèque de modèles → session → inscriptions (contributeur) → générations automatiques,
//  conditionnelles et manuelles → absences, évaluation, satisfaction → réclamation et action
//  qualité → indicateurs (7, 30, 31, 32) → archivage. PostgreSQL réel, Drive SIMULÉ.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import os from "node:os";
import path from "node:path";
import pg from "pg";

import { setPoolFactory, setQueryExecutor } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { seedReferentiel } from "../src/seed.js";
import { createApp } from "../src/app.js";
import { encode } from "../src/session.js";
import { setDriveFactory } from "../src/services/google.js";
import { traiterFile } from "../src/services/generationsAutomatiques.js";
import { clientDriveSimule as simulateur } from "./helpers/genererDrive.js";

const PORT = 55491;
const DATA = path.join(os.tmpdir(), "vq-parcours-complet-" + process.pid);

let cluster, pool, serveur, origine, adminId, contribId;
const F = {};

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
// Réponse attendue en succès : le corps d'erreur est affiché sinon.
function ok(r, statut = [200, 201]) {
  assert.ok([].concat(statut).includes(r.statut), `${r.statut} ${JSON.stringify(r.corps)}`);
  return r.corps;
}

// Un seul faux Drive pour tout le parcours ; chaque modèle a son contenu.
const CONTENUS = {
  MODELE_CONVOCATION_01: "Convocation de {{stagiaire_nom}} le {{session_date_debut}}",
  MODELE_ADAPTATION_01: "Suivi d'adaptation de {{stagiaire_nom}}",
  MODELE_ATTESTATION_01: "Attestation de {{stagiaire_nom}}",
  MODELE_EMARGEMENT_01: "Émargement du {{session_date_debut}}",
};
function drive() {
  const simule = simulateur({ modeleTexte: "" });
  const lire = simule.client.docs.documents.get;
  const copier = simule.client.drive.files.copy;
  const source = new Map();
  simule.client.drive.files.copy = async (args) => {
    const r = await copier(args);
    simule.trace.contenuCopies.set(r.data.id, CONTENUS[args.fileId] ?? "");
    source.set(r.data.id, args.fileId);
    return r;
  };
  simule.client.docs.documents.get = async ({ documentId, ...reste }) => {
    if (CONTENUS[documentId] !== undefined) {
      return { data: { body: { content: [{ paragraph: { elements: [{ textRun: { content: CONTENUS[documentId] } }] } }] }, headers: {}, footers: {} } };
    }
    return lire({ documentId, ...reste });
  };
  return { ...simule, source };
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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@parcours.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@parcours.local', 'Tukui', 'contributeur') RETURNING id"));
  F.drive = drive();
  setDriveFactory(() => F.drive.client);
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

test("1. administrateur : formation et bibliothèque de modèles (manuel, automatique, conditionnel)", async () => {
  F.formation = ok(await api("POST", "/api/formations", { intitule: "Agent de propreté", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation.id;
  const modele = async (champs) => ok(await api("POST", "/api/modeles", { type_document: "autre", indicateurs: [11], ...champs }, A()), 201).modele.id;
  F.convocation = await modele({ nom: "Convocation", lien: "MODELE_CONVOCATION_01", portee: "stagiaire", type_document: "convocation", mode_generation: "automatique", declencheur: "inscription" });
  F.adaptation = await modele({ nom: "Suivi d'adaptation", lien: "MODELE_ADAPTATION_01", portee: "stagiaire", mode_generation: "conditionnel", declencheur: "inscription", condition_code: "situation_handicap", indicateurs: [26] });
  F.attestation = await modele({ nom: "Attestation", lien: "MODELE_ATTESTATION_01", portee: "stagiaire", type_document: "attestation", mode_generation: "automatique", declencheur: "fin_session" });
  F.emargement = await modele({ nom: "Émargement", lien: "MODELE_EMARGEMENT_01", portee: "session", type_document: "emargement", mode_generation: "manuel" });
  const { modeles } = ok(await api("GET", "/api/modeles", undefined, C()));
  assert.equal(modeles.length, 4, "bibliothèque visible du contributeur");
});

test("2. session et inscriptions par un contributeur : convocations et suivi conditionnel générés seuls", async () => {
  F.session = ok(await api("POST", "/api/sessions", { formation_id: F.formation, date_debut: "2026-11-16", date_fin: "2026-11-20", reference: "PROP-2611" }, A()), 201).session.id;
  assert.equal((await api("POST", "/api/sessions", { formation_id: F.formation, date_debut: "2026-11-16", date_fin: "2026-11-20" }, C())).statut, 403, "création de session réservée");
  F.alpha = ok(await api("POST", `/api/sessions/${F.session}/stagiaires`, { nom: "Alpha", prenom: "Ana" }, C()), 201).inscription;
  F.bravo = ok(await api("POST", `/api/sessions/${F.session}/stagiaires`, { nom: "Bravo", prenom: "Ben" }, C()), 201).inscription;
  assert.equal((await api("PATCH", `/api/stagiaires/${F.bravo.stagiaire_id}`, { situation_handicap: true }, C())).statut, 403, "donnée réservée à l'administration");
  ok(await api("PATCH", `/api/stagiaires/${F.bravo.stagiaire_id}`, { situation_handicap: true }, A()));

  await traiterFile({ client: F.drive.client });
  const { rows } = await pool.query("SELECT modele_id, stagiaire_id, preuve_id FROM documents_generes WHERE session_id = $1 ORDER BY modele_id, stagiaire_id", [F.session]);
  assert.deepEqual(rows.map((d) => [d.modele_id, d.stagiaire_id]), [
    [F.convocation, F.alpha.stagiaire_id], [F.convocation, F.bravo.stagiaire_id], [F.adaptation, F.bravo.stagiaire_id],
  ]);
  assert.ok(rows.every((d) => d.preuve_id), "chaque document est rattaché à une preuve");
  const contenus = [...F.drive.trace.contenuCopies.values()];
  assert.ok(contenus.includes("Convocation de Alpha le 16/11/2026"), contenus.join(" | "));
  assert.ok(contenus.includes("Suivi d'adaptation de Bravo"));

  const suivi = ok(await api("GET", `/api/sessions/${F.session}/generations-planifiees`, undefined, C()));
  assert.ok(suivi.taches.every((t) => t.statut === "faite"), JSON.stringify(suivi.taches));
});

test("3. génération manuelle : document produit, doublon refusé sans confirmation", async () => {
  const r = ok(await api("POST", "/api/generations", { modele_id: F.emargement, session_id: F.session }, C()));
  assert.equal(r.documents, 1);
  const doublon = await api("POST", "/api/generations", { modele_id: F.emargement, session_id: F.session }, C());
  assert.equal(doublon.statut, 409);
  const detail = ok(await api("GET", `/api/sessions/${F.session}`, undefined, C()));
  assert.equal(detail.documents.length, 4);
});

test("4. suivi pédagogique : absence, évaluation, satisfaction ; parcours de la session", async () => {
  ok(await api("PATCH", `/api/sessions/${F.session}`, { statut: "en_cours" }, A()));
  ok(await api("POST", `/api/inscriptions/${F.alpha.id}/absences`, { date_absence: "2026-11-17", duree_heures: 3.5, motif: "Rendez-vous médical" }, C()), 201);
  ok(await api("POST", `/api/sessions/${F.session}/evaluations`, { inscription_id: F.alpha.id, type: "evaluation_finale", date_passage: "2026-11-20", resultat: "valide" }, C()), 201);
  const reponse = { inscription_id: F.bravo.id, type: "a_chaud", date_recueil: "2026-11-20", note_globale: 2, note_max: 5, commentaire: "Salle trop froide" };
  assert.equal((await api("POST", `/api/sessions/${F.session}/satisfactions`, reponse, C())).statut, 403, "satisfaction saisie par l'administration");
  F.satisfaction = ok(await api("POST", `/api/sessions/${F.session}/satisfactions`, reponse, A()), 201).satisfaction;
  const parcours = ok(await api("GET", `/api/sessions/${F.session}/parcours`, undefined, C()));
  assert.ok(JSON.stringify(parcours).includes("Alpha"));
  const synthese = ok(await api("GET", "/api/qualite/satisfactions/synthese?du=2026-11-01&au=2026-11-30", undefined, A()));
  assert.ok(JSON.stringify(synthese).length > 2);
});

test("5. fin de session : attestations générées pour les stagiaires actifs", async () => {
  ok(await api("PATCH", `/api/sessions/${F.session}`, { statut: "terminee" }, A()));
  await traiterFile({ client: F.drive.client });
  const { rows } = await pool.query("SELECT stagiaire_id FROM documents_generes WHERE session_id = $1 AND modele_id = $2 ORDER BY stagiaire_id", [F.session, F.attestation]);
  assert.deepEqual(rows.map((r) => r.stagiaire_id), [F.alpha.stagiaire_id, F.bravo.stagiaire_id]);
});

test("6. qualité : réclamation traitée, action corrective issue de la satisfaction, indicateurs", async () => {
  const reclamation = { type: "reclamation", objet: "Salle trop froide", session_id: F.session };
  assert.equal((await api("POST", "/api/signalements", reclamation, C())).statut, 403, "réclamations gérées par l'administration");
  const rec = ok(await api("POST", "/api/signalements", reclamation, A()), 201).signalement;
  ok(await api("PATCH", `/api/signalements/${rec.id}/qualifier`, {}, A()));
  ok(await api("PATCH", `/api/signalements/${rec.id}/traiter`, {}, A()));
  ok(await api("PATCH", `/api/signalements/${rec.id}/resoudre`, { synthese_reponse: "Chauffage réparé" }, A()));
  const action = ok(await api("POST", "/api/actions-qualite", { titre: "Contrôler le chauffage avant chaque session", satisfaction_id: F.satisfaction.id }, A()), 201).action;
  ok(await api("PATCH", `/api/actions-qualite/${action.id}/demarrer`, {}, A()));
  ok(await api("PATCH", `/api/actions-qualite/${action.id}/realiser`, { resultat: "Contrôle ajouté à la check-list" }, A()));
  const tableau = ok(await api("GET", "/api/qualite/tableau-de-bord", undefined, A()));
  assert.ok(tableau, "tableau de bord qualité disponible");

  // Indicateur 7 (certification) : non applicable sans formation certifiante, motif tracé, réservé à l'administrateur.
  const referentiel = ok(await api("GET", "/api/referentiel", undefined, A()));
  const indic = (n) => referentiel.criteres.flatMap((c) => c.indicateurs).find((i) => i.numero === n);
  assert.equal((await api("PATCH", `/api/indicateurs/${indic(7).id}/non-applicable`, { non_applicable: true, motif: "Aucune formation certifiante" }, C())).statut, 403);
  ok(await api("PATCH", `/api/indicateurs/${indic(7).id}/non-applicable`, { non_applicable: true, motif: "Aucune formation certifiante" }, A()));
  const apres = ok(await api("GET", "/api/referentiel", undefined, C()));
  const i7 = apres.criteres.flatMap((c) => c.indicateurs).find((i) => i.numero === 7);
  assert.deepEqual([i7.statut, i7.non_applicable_motif], ["non_applicable", "Aucune formation certifiante"]);
  const i11 = apres.criteres.flatMap((c) => c.indicateurs).find((i) => i.numero === 11);
  assert.ok(i11.nb_preuves >= 1, "les documents générés alimentent l'indicateur 11");
});

test("7. archivage : plus aucune génération ni relance ; documents conservés", async () => {
  ok(await api("PATCH", `/api/sessions/${F.session}/archive`, {}, A()));
  assert.equal((await api("POST", `/api/sessions/${F.session}/stagiaires`, { nom: "Charlie", prenom: "C" }, C())).statut, 409);
  assert.equal((await api("POST", "/api/generations", { modele_id: F.emargement, session_id: F.session, remplacer: true }, A())).statut, 409);
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM documents_generes WHERE session_id = $1", [F.session]);
  assert.equal(n, 6);
});
