// ─────────────────────────────────────────────────────────────
//  Questionnaire de formation dans les documents (bloc questionnaire_formation) et condition
//  « assiduité atteinte » : attestation produite automatiquement en fin de session aux seuls
//  stagiaires concernés. PostgreSQL réel, Drive SIMULÉ, données FICTIVES.
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
import { stagiairesConcernes, traiterFile } from "../src/services/generationsAutomatiques.js";
import { SEUIL_ASSIDUITE } from "../src/services/assiduite.js";
import { clientDriveSimule as simulateur } from "./helpers/genererDrive.js";

const PORT = 55496;
const DATA = path.join(os.tmpdir(), "vq-questionnaire-assiduite-" + process.pid);

let cluster, pool, serveur, origine, adminId;
const F = {};
let numero = 0;
const TEXTES = new Map();

const cookie = (uid) => "vq_session=" + encode({ uid, exp: Date.now() + 60_000 });
const A = () => ({ cookie: cookie(adminId) });
async function api(methode, chemin, corps, enTetes = {}) {
  const r = await fetch(origine + chemin, {
    method: methode, headers: { "Content-Type": "application/json", ...enTetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
function ok(r, statut = [200, 201]) {
  assert.ok([].concat(statut).includes(r.statut), `${r.statut} ${JSON.stringify(r.corps)}`);
  return r.corps;
}
function drive() {
  const s = simulateur({ modeleTexte: "" });
  const lire = s.client.docs.documents.get;
  const copier = s.client.drive.files.copy;
  s.client.drive.files.copy = async (args) => {
    const r = await copier(args);
    s.trace.contenuCopies.set(r.data.id, TEXTES.get(args.fileId) ?? "");
    return r;
  };
  s.client.docs.documents.get = async ({ documentId, ...reste }) => {
    if (TEXTES.has(documentId)) return { data: { body: { content: [{ paragraph: { elements: [{ textRun: { content: TEXTES.get(documentId) } }] } }] }, headers: {}, footers: {} } };
    return lire({ documentId, ...reste });
  };
  return s;
}
async function modele(texte, extra = {}) {
  const lien = `MODELE_QA_${String(++numero).padStart(6, "0")}`;
  TEXTES.set(lien, texte);
  return ok(await api("POST", "/api/modeles", { nom: `Modèle QA ${numero}`, lien, portee: "stagiaire", type_document: "autre", mode_generation: "manuel", indicateurs: [5], ...extra }, A()), 201).modele.id;
}
async function documents(sessionId, modeleId) {
  const { rows } = await pool.query("SELECT drive_file_id, stagiaire_id FROM documents_generes WHERE session_id = $1 AND modele_id = $2 ORDER BY stagiaire_id", [sessionId, modeleId]);
  return rows.map((r) => ({ stagiaire_id: r.stagiaire_id, texte: (F.drive.trace.contenuCopies.get(r.drive_file_id) || "").replace(/\s+/g, " ").trim() }));
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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@qa.local', 'Admin Test', 'admin') RETURNING id"));
  serveur = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
  F.drive = drive();
  setDriveFactory(() => F.drive.client);
  F.formation = ok(await api("POST", "/api/formations", { intitule: "Atelier fictif", duree_heures_defaut: 20, modalite: "presentiel" }, A()), 201).formation.id;
  F.session = ok(await api("POST", "/api/sessions", { formation_id: F.formation, date_debut: "2026-12-01", date_fin: "2026-12-10", reference: "QA-1" }, A()), 201).session.id;
  F.inscrits = {};
  for (const nom of ["Alpha", "Bravo", "Charlie", "Delta"]) {
    F.inscrits[nom] = ok(await api("POST", `/api/sessions/${F.session}/stagiaires`, { nom, prenom: "Test" }, A()), 201).inscription;
  }
});

after(async () => {
  setDriveFactory(null);
  setPoolFactory(null);
  setQueryExecutor(null);
  if (serveur) await new Promise((r) => serveur.close(r));
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
});

test("questionnaire : réponses dans le document, question telle que posée, ordre du questionnaire, vide sans réponse", async () => {
  const q1 = ok(await api("POST", `/api/formations/${F.formation}/questionnaire/questions`, { libelle: "Quel est votre projet ?", type: "texte_libre" }, A()), 201).question;
  const q2 = ok(await api("POST", `/api/formations/${F.formation}/questionnaire/questions`, { libelle: "Niveau actuel ?", type: "choix_unique", options: ["Débutant", "Confirmé"] }, A()), 201).question;
  const q3 = ok(await api("POST", `/api/formations/${F.formation}/questionnaire/questions`, { libelle: "Outils utilisés ?", type: "choix_multiple", options: ["Ordinateur", "Tablette", "Téléphone"] }, A()), 201).question;
  ok(await api("PUT", `/api/inscriptions/${F.inscrits.Alpha.id}/questionnaire/reponses`, { reponses: [
    { question_id: q2.id, valeurs_choisies: ["Débutant"] }, { question_id: q1.id, valeur_texte: "Trouver un emploi" }, { question_id: q3.id, valeurs_choisies: ["Tablette", "Téléphone"] },
  ] }, A()));
  // La question est reformulée après la réponse : le document garde l'énoncé d'origine.
  ok(await api("PATCH", `/api/questionnaire-questions/${q1.id}`, { libelle: "Quel est votre projet professionnel ?", type: "texte_libre" }, A()));

  const m = await modele("QUESTIONNAIRE {{#questionnaire_formation}}{{question_libelle}} => {{question_reponse}};{{/questionnaire_formation}}");
  ok(await api("POST", "/api/generations", { modele_id: m, session_id: F.session }, A()));
  const docs = await documents(F.session, m);
  const alpha = docs.find((d) => d.stagiaire_id === F.inscrits.Alpha.stagiaire_id).texte;
  assert.equal(alpha, "QUESTIONNAIRE Quel est votre projet ? => Trouver un emploi;Niveau actuel ? => Débutant;Outils utilisés ? => Tablette, Téléphone;", "ordre du questionnaire, énoncé d'origine");
  const bravo = docs.find((d) => d.stagiaire_id === F.inscrits.Bravo.stagiaire_id).texte;
  assert.equal(bravo, "QUESTIONNAIRE", "aucune réponse : bloc vide");
});

test("assiduité : seuil 80 %, calcul partagé avec l'écran d'assiduité, abandons et durée inconnue exclus", async () => {
  assert.equal(SEUIL_ASSIDUITE, 80);
  const absence = (inscription, heures) => pool.query("INSERT INTO absences (inscription_id, date_absence, duree_heures) VALUES ($1, '2026-12-02', $2)", [inscription.id, heures]);
  await absence(F.inscrits.Bravo, 5);   // 15/20 = 75 % : sous le seuil
  await absence(F.inscrits.Charlie, 4); // 16/20 = 80 % : au seuil, concerné
  await pool.query("UPDATE inscriptions SET statut = 'abandon' WHERE id = $1", [F.inscrits.Delta.id]);
  const concernes = await stagiairesConcernes("assiduite_atteinte", F.session);
  assert.deepEqual([...concernes].sort(), [F.inscrits.Alpha.stagiaire_id, F.inscrits.Charlie.stagiaire_id].sort());

  const sansDuree = ok(await api("POST", "/api/formations", { intitule: "Sans durée fictive" }, A()), 201).formation.id;
  const s2 = ok(await api("POST", "/api/sessions", { formation_id: sansDuree, date_debut: "2026-12-01", date_fin: "2026-12-02" }, A()), 201).session.id;
  ok(await api("POST", `/api/sessions/${s2}/stagiaires`, { nom: "Echo", prenom: "Test" }, A()), 201);
  assert.equal((await stagiairesConcernes("assiduite_atteinte", s2)).size, 0, "durée inconnue : jamais de taux inventé");
});

test("modèle conditionnel « assiduité atteinte » : accepté par l'API, refusé hors mode conditionnel", async () => {
  const lien = "MODELE_QA_ATTEST_0001";
  TEXTES.set(lien, "ATTESTATION {{stagiaire_prenom}} {{stagiaire_nom}}");
  const base = { nom: "Attestation automatique", lien, portee: "stagiaire", type_document: "attestation", indicateurs: [5] };
  assert.equal((await api("POST", "/api/modeles", { ...base, mode_generation: "automatique", declencheur: "fin_session", condition_code: "assiduite_atteinte" }, A())).statut, 400);
  const cree = ok(await api("POST", "/api/modeles", { ...base, mode_generation: "conditionnel", declencheur: "fin_session", condition_code: "assiduite_atteinte" }, A()), 201).modele;
  assert.equal(cree.condition_code, "assiduite_atteinte");
  assert.match(cree.condition_generation, /80 % d'assiduité/);
  F.attestation = cree.id;
  assert.equal((await api("GET", "/api/modeles", undefined, A())).corps.conditions.assiduite_atteinte.length > 0, true);
});

test("fin de session : l'attestation n'est produite que pour les stagiaires à 80 % et plus, une seule fois", async () => {
  ok(await api("PATCH", `/api/sessions/${F.session}`, { statut: "terminee" }, A()));
  const { rows: [t] } = await pool.query("SELECT * FROM generations_planifiees WHERE modele_id = $1 AND session_id = $2", [F.attestation, F.session]);
  assert.deepEqual([t.evenement, t.statut], ["fin_session", "en_attente"]);
  await traiterFile({ client: F.drive.client });
  const docs = await documents(F.session, F.attestation);
  assert.deepEqual(docs.map((d) => d.texte), ["ATTESTATION Test Alpha", "ATTESTATION Test Charlie"]);
  const { rows: [fin] } = await pool.query("SELECT statut, documents FROM generations_planifiees WHERE id = $1", [t.id]);
  assert.deepEqual([fin.statut, fin.documents], ["faite", 2]);
  await traiterFile({ client: F.drive.client });
  assert.equal((await documents(F.session, F.attestation)).length, 2, "aucun doublon ni régénération");
});
