// ─────────────────────────────────────────────────────────────
//  Génération automatique et conditionnelle : déclencheurs réels (routes), file des tâches,
//  complément sans doublon, conditions métier, échecs Drive, blocage et relance.
//  PostgreSQL réel, Drive SIMULÉ (aucun réseau).
// ─────────────────────────────────────────────────────────────
import { test, before, after, beforeEach } from "node:test";
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
import { MAX_TENTATIVES, planifier, planifierParDates, traiterFile } from "../src/services/generationsAutomatiques.js";
import { clientDriveSimule as simulateur } from "./helpers/genererDrive.js";

const PORT = 55490;
const DATA = path.join(os.tmpdir(), "vq-generations-auto-" + process.pid);

let cluster, pool, serveur, origine, adminId, contribId, formationId;

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

// Les modèles ont chacun leur fichier : le simulateur lit le même contenu de modèle pour tous.
function clientDriveSimule(options) {
  const simule = simulateur(options);
  const lire = simule.client.docs.documents.get;
  simule.client.docs.documents.get = ({ documentId, ...reste }) =>
    lire({ documentId: documentId.startsWith("MODELE_AUTO_") ? "MODELE" : documentId, ...reste });
  return simule;
}

let numero = 0;
const fichier = () => `MODELE_AUTO_${String(++numero).padStart(4, "0")}`;

async function creerModele(champs) {
  const r = await api("POST", "/api/modeles", { lien: fichier(), type_document: "autre", indicateurs: [11], ...champs }, A());
  assert.equal(r.statut, 201, JSON.stringify(r.corps));
  return r.corps.modele?.id ?? r.corps.id;
}

async function creerSession(extra = {}) {
  const r = await api("POST", "/api/sessions", {
    formation_id: formationId, date_debut: "2026-12-01", date_fin: "2026-12-05", ...extra,
  }, A());
  assert.equal(r.statut, 201, JSON.stringify(r.corps));
  return r.corps.session.id;
}

async function inscrire(sessionId, nom, champs = {}) {
  const r = await api("POST", `/api/sessions/${sessionId}/stagiaires`, { nom, prenom: "Test", ...champs }, A());
  assert.equal(r.statut, 201, JSON.stringify(r.corps));
  return r.corps.inscription;
}

const taches = async (sessionId) =>
  (await pool.query("SELECT * FROM generations_planifiees WHERE session_id = $1 ORDER BY id", [sessionId])).rows;
const documents = async (sessionId, modeleId) =>
  (await pool.query("SELECT * FROM documents_generes WHERE session_id = $1 AND modele_id = $2 ORDER BY stagiaire_id", [sessionId, modeleId])).rows;

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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@auto.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@auto.local', 'Tukui', 'contributeur') RETURNING id"));
  ({ rows: [{ id: formationId }] } = await pool.query("INSERT INTO formations (intitule, code_interne) VALUES ('Atelier numérique', 'AUTO-1') RETURNING id"));
  await pool.query("INSERT INTO formation_versions (formation_id, numero, duree_heures_defaut) VALUES ($1, 1, 21)", [formationId]);
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

// Chaque test part d'une bibliothèque sans déclencheur actif : seuls ses propres modèles agissent.
beforeEach(async () => {
  await pool.query("UPDATE modeles_documents SET actif = false");
  await pool.query("UPDATE generations_planifiees SET statut = 'sans_objet' WHERE statut = 'en_attente'");
});

test("bibliothèque : déclencheur exigé, condition réservée au conditionnel, retour en manuel nettoyé", async () => {
  const sans = await api("POST", "/api/modeles", { nom: "Sans déclencheur", lien: fichier(), portee: "session", type_document: "autre", indicateurs: [11], mode_generation: "automatique" }, A());
  assert.equal(sans.statut, 400);
  assert.match(sans.corps.error, /déclencheur/);
  const sansCondition = await api("POST", "/api/modeles", { nom: "Sans condition", lien: fichier(), portee: "stagiaire", type_document: "autre", mode_generation: "conditionnel", declencheur: "inscription", indicateurs: [11] }, A());
  assert.equal(sansCondition.statut, 400);
  assert.match(sansCondition.corps.error, /condition/);
  const inconnu = await api("POST", "/api/modeles", { nom: "Inconnu", lien: fichier(), portee: "session", type_document: "autre", mode_generation: "automatique", declencheur: "chaque_heure", indicateurs: [11] }, A());
  assert.equal(inconnu.statut, 400);

  const id = await creerModele({ nom: "Conditionnel", portee: "stagiaire", mode_generation: "conditionnel", declencheur: "inscription", condition_code: "situation_handicap" });
  let { rows: [m] } = await pool.query("SELECT * FROM modeles_documents WHERE id = $1", [id]);
  assert.equal(m.condition_generation, "Stagiaire en situation de handicap", "description reprise du libellé de la condition");
  assert.ok(m.declencheur_actif_depuis, "date d'activation posée");

  const manuel = await api("PATCH", `/api/modeles/${id}`, { mode_generation: "manuel" }, A());
  assert.equal(manuel.statut, 200, JSON.stringify(manuel.corps));
  ({ rows: [m] } = await pool.query("SELECT * FROM modeles_documents WHERE id = $1", [id]));
  assert.deepEqual([m.declencheur, m.condition_code, m.condition_generation, m.declencheur_actif_depuis], [null, null, null, null]);
});

test("modèle classé « automatique » avant les déclencheurs : conservé, modifiable, sans effet", async () => {
  const { rows: [{ id }] } = await pool.query(
    "INSERT INTO modeles_documents (nom, drive_file_id, portee, mode_generation) VALUES ('Ancien auto', $1, 'session', 'automatique') RETURNING id",
    [fichier()]
  );
  const renomme = await api("PATCH", `/api/modeles/${id}`, { nom: "Ancien auto renommé" }, A());
  assert.equal(renomme.statut, 200, JSON.stringify(renomme.corps));
  const session = await creerSession();
  assert.deepEqual(await taches(session), [], "aucun déclenchement sans déclencheur choisi");
  const sansChoix = await api("PATCH", `/api/modeles/${id}`, { mode_generation: "automatique" }, A());
  assert.equal(sansChoix.statut, 400, "toucher au mode impose de choisir le déclencheur");
});

test("création de session : tâche planifiée, document produit, rattaché à la session et aux preuves", async () => {
  const modeleId = await creerModele({ nom: "Fiche récap auto", portee: "session", mode_generation: "automatique", declencheur: "creation_session", indicateurs: [11] });
  const sessionId = await creerSession({ reference: "AUTO-CREA" });
  const [t] = await taches(sessionId);
  assert.deepEqual([t.modele_id, t.evenement, t.statut], [modeleId, "creation_session", "en_attente"]);

  const { client, trace } = clientDriveSimule({ modeleTexte: "Session du {{session_date_debut}}" });
  await traiterFile({ client });
  const [faite] = await taches(sessionId);
  assert.equal(faite.statut, "faite", faite.derniere_erreur || "");
  assert.equal(faite.documents, 1);
  assert.equal(trace.copies, 1);
  const [doc] = await documents(sessionId, modeleId);
  assert.ok(doc.preuve_id, "document rattaché à une preuve");
  const { rows: [gen] } = await pool.query("SELECT planification_id, lancee_par FROM generations WHERE id = $1", [doc.generation_id]);
  assert.deepEqual(gen, { planification_id: faite.id, lancee_par: null }, "historique : génération automatique tracée");
  assert.equal(trace.contenuCopies.get(doc.drive_file_id), "Session du 01/12/2026", "variable remplie");

  // Événement ponctuel : jamais replanifié pour la même session.
  assert.equal(await planifier("creation_session", sessionId), 0);
  assert.deepEqual(await traiterFile({ client }), []);
  assert.equal(trace.copies, 1);
});

test("inscriptions successives : seuls les documents manquants sont produits, jamais de remplacement", async () => {
  const modeleId = await creerModele({ nom: "Convocation auto", portee: "stagiaire", mode_generation: "automatique", declencheur: "inscription" });
  const sessionId = await creerSession({ reference: "AUTO-INSCR" });
  assert.deepEqual(await taches(sessionId), [], "pas de tâche à la création pour ce déclencheur");

  const { client, trace } = clientDriveSimule({ modeleTexte: "Bonjour {{stagiaire_nom}}" });
  await inscrire(sessionId, "Alpha");
  await inscrire(sessionId, "Bravo");
  assert.equal((await taches(sessionId)).filter((t) => t.statut === "en_attente").length, 1, "rafale d'inscriptions : une seule tâche en attente");
  await traiterFile({ client });
  const premiers = await documents(sessionId, modeleId);
  assert.equal(premiers.length, 2);

  await inscrire(sessionId, "Charlie");
  await traiterFile({ client });
  const tous = await documents(sessionId, modeleId);
  assert.equal(tous.length, 3);
  assert.equal(trace.copies, 3, "Alpha et Bravo ne sont pas régénérés");
  assert.deepEqual(trace.corbeille, [], "aucun document mis à la corbeille");
  for (const p of premiers) assert.equal(tous.find((d) => d.stagiaire_id === p.stagiaire_id).drive_file_id, p.drive_file_id);
  assert.ok([...trace.contenuCopies.values()].some((t) => t === "Bonjour Charlie"));
});

test("conditionnel : seuls les stagiaires concernés ; condition non remplie : sans objet", async () => {
  const modeleId = await creerModele({ nom: "Suivi adaptation", portee: "stagiaire", mode_generation: "conditionnel", declencheur: "inscription", condition_code: "situation_handicap" });
  const sessionId = await creerSession({ reference: "AUTO-COND" });
  const { client, trace } = clientDriveSimule({ modeleTexte: "Suivi de {{stagiaire_nom}}" });

  await inscrire(sessionId, "Sanscondition");
  await traiterFile({ client });
  assert.equal((await taches(sessionId)).at(-1).statut, "sans_objet");
  assert.equal(trace.copies, 0);

  const ins = await inscrire(sessionId, "Concerne");
  await pool.query("UPDATE stagiaires SET situation_handicap = true WHERE id = $1", [ins.stagiaire_id]);
  await planifier("inscription", sessionId);
  await traiterFile({ client });
  const docs = await documents(sessionId, modeleId);
  assert.deepEqual(docs.map((d) => d.stagiaire_id), [ins.stagiaire_id]);
});

test("Drive indisponible : la tâche reste en attente, sans tentative consommée", async () => {
  await creerModele({ nom: "Émargement auto", portee: "session", mode_generation: "automatique", declencheur: "creation_session" });
  const sessionId = await creerSession({ reference: "AUTO-DRIVE" });
  setDriveFactory(() => null);
  try {
    await traiterFile();
  } finally {
    setDriveFactory(null);
  }
  const [t] = await taches(sessionId);
  assert.equal(t.statut, "en_attente");
  assert.equal(t.tentatives, 0);
  assert.match(t.derniere_erreur, /indisponible/);
});

test("échecs répétés : nouvel essai différé, bloquée au bout du maximum, relance par l'administrateur", async () => {
  await creerModele({ nom: "Bilan auto", portee: "session", mode_generation: "automatique", declencheur: "creation_session" });
  const sessionId = await creerSession({ reference: "AUTO-ECHEC" });
  const casse = clientDriveSimule({ modeleTexte: "{{session_date_debut}}", echecCopy: { message: "quota", statut: 500 } });
  for (let i = 1; i <= MAX_TENTATIVES; i++) {
    await traiterFile({ client: casse.client });
    const [t] = await taches(sessionId);
    assert.equal(t.tentatives, i);
    assert.equal(t.statut, i < MAX_TENTATIVES ? "en_attente" : "bloquee");
    assert.equal(JSON.stringify(t).includes("quota"), false, "erreur Google brute non exposée");
    await pool.query("UPDATE generations_planifiees SET bail_jusqu_au = NULL WHERE id = $1", [t.id]); // délai écoulé
  }
  assert.equal(await documents(sessionId, (await taches(sessionId))[0].modele_id).then((d) => d.length), 0);

  const [bloquee] = await taches(sessionId);
  assert.equal((await api("POST", `/api/generations-planifiees/${bloquee.id}/relancer`, {}, C())).statut, 403);
  const relance = await api("POST", `/api/generations-planifiees/${bloquee.id}/relancer`, {}, A());
  assert.equal(relance.statut, 200, JSON.stringify(relance.corps));
  const { client } = clientDriveSimule({ modeleTexte: "{{session_date_debut}}" });
  await traiterFile({ client });
  const [reprise] = await taches(sessionId);
  assert.deepEqual([reprise.statut, reprise.documents, reprise.derniere_erreur], ["faite", 1, null]);
  assert.equal((await api("POST", `/api/generations-planifiees/${bloquee.id}/relancer`, {}, A())).statut, 409, "tâche faite : pas de relance");
});

test("donnée restreinte : jamais générée sans administrateur, tâche bloquée immédiatement", async () => {
  await creerModele({ nom: "Besoins auto", portee: "stagiaire", mode_generation: "automatique", declencheur: "inscription" });
  const sessionId = await creerSession({ reference: "AUTO-RESTREINT" });
  await inscrire(sessionId, "Delta");
  const { client, trace } = clientDriveSimule({ modeleTexte: "{{stagiaire_besoins_specifiques}}" });
  await traiterFile({ client });
  const [t] = await taches(sessionId);
  assert.equal(t.statut, "bloquee");
  assert.equal(t.tentatives, 1);
  assert.match(t.derniere_erreur, /restreinte/);
  assert.equal(trace.copies, 0);
});

test("début et fin de session : passage de statut, balayage par date borné à l'activation", async () => {
  const debut = await creerModele({ nom: "Émargement début", portee: "session", mode_generation: "automatique", declencheur: "debut_session" });
  const fin = await creerModele({ nom: "Attestation fin", portee: "session", mode_generation: "automatique", declencheur: "fin_session" });
  await pool.query("UPDATE modeles_documents SET declencheur_actif_depuis = '2026-11-10T12:00:00Z' WHERE id = ANY($1)", [[debut, fin]]);

  const ancienne = await creerSession({ reference: "AUTO-ANCIENNE", date_debut: "2026-10-01", date_fin: "2026-10-05" });
  const courante = await creerSession({ reference: "AUTO-COURANTE", date_debut: "2026-11-12", date_fin: "2026-11-20" });
  const annulee = await creerSession({ reference: "AUTO-ANNULEE", date_debut: "2026-11-12", date_fin: "2026-11-13" });
  await pool.query("UPDATE sessions SET statut = 'annulee' WHERE id = $1", [annulee]);

  await planifierParDates({ aujourdhui: "2026-11-15" });
  assert.deepEqual(await taches(ancienne), [], "aucun rattrapage des sessions antérieures à l'activation");
  assert.deepEqual(await taches(annulee), []);
  assert.deepEqual((await taches(courante)).map((t) => [t.modele_id, t.evenement]), [[debut, "debut_session"]]);
  await planifierParDates({ aujourdhui: "2026-11-15" });
  assert.equal((await taches(courante)).length, 1, "balayage idempotent");

  const passage = await api("PATCH", `/api/sessions/${courante}`, { statut: "terminee" }, A());
  assert.equal(passage.statut, 200, JSON.stringify(passage.corps));
  assert.deepEqual((await taches(courante)).map((t) => t.evenement).sort(), ["debut_session", "fin_session"]);

  // Modèle désactivé entre la planification et le traitement : sans objet, rien produit.
  await api("DELETE", `/api/modeles/${fin}`, undefined, A());
  const { client, trace } = clientDriveSimule({ modeleTexte: "{{session_date_debut}}" });
  await traiterFile({ client });
  const etats = Object.fromEntries((await taches(courante)).map((t) => [t.evenement, t.statut]));
  assert.deepEqual(etats, { debut_session: "faite", fin_session: "sans_objet" });
  assert.equal(trace.copies, 1);
});

test("suivi : tâches visibles par session, identifiants invalides refusés", async () => {
  await creerModele({ nom: "Programme auto", portee: "session", mode_generation: "automatique", declencheur: "creation_session" });
  const sessionId = await creerSession({ reference: "AUTO-SUIVI" });
  const r = await api("GET", `/api/sessions/${sessionId}/generations-planifiees`, undefined, C());
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps.taches.map((t) => [t.modele, t.evenement, t.statut]), [["Programme auto", "creation_session", "en_attente"]]);
  assert.equal((await api("GET", "/api/sessions/abc/generations-planifiees", undefined, C())).statut, 400);
  assert.equal((await api("POST", "/api/generations-planifiees/0/relancer", {}, A())).statut, 400);
  assert.equal((await api("POST", "/api/generations-planifiees/999999/relancer", {}, A())).statut, 404);
});
