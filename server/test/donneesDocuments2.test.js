// ─────────────────────────────────────────────────────────────
//  Données complémentaires des documents A2C : fiche stagiaire/entreprise, domaines de handicap (admin), niveau de
//  positionnement, contact du prescripteur et indicateurs de session. PostgreSQL réel, Drive SIMULÉ, données FICTIVES.
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
import { clientDriveSimule as simulateur } from "./helpers/genererDrive.js";

const PORT = 55501;
const DATA = path.join(os.tmpdir(), "vq-donnees-documents2-" + process.pid);

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
  const lien = `MODELE_D2_${String(++numero).padStart(6, "0")}`;
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


import { calculerIndicateurs } from "../src/services/indicateursSession.js";
const C = () => ({ cookie: cookie(contribId) });
let contribId;
test("indicateurs : méthodes de calcul (pur) — taux null sans donnée, jamais de 0 % inventé", () => {
  const vide = calculerIndicateurs({});
  assert.equal(vide.taux_satisfaction, null); assert.equal(vide.taux_assiduite, null); assert.equal(vide.taux_abandon, null); assert.equal(vide.taux_atteinte, null);
  assert.deepEqual([vide.repondants, vide.abandons, vide.reussites], [0, 0, 0]);
  const r = calculerIndicateurs({
    heuresPrevues: 20,
    inscriptions: [
      { id: 1, statut: "inscrit", heures_absence: 2, prescripteur: null, categorie_abandon: null },
      { id: 2, statut: "abandon", heures_absence: 0, prescripteur: "pole_emploi", categorie_abandon: "financement" },
      { id: 3, statut: "inscrit", heures_absence: 0, prescripteur: "mission_locale", categorie_abandon: null },
      { id: 4, statut: "abandon", heures_absence: 0, prescripteur: null, categorie_abandon: null },
    ],
    satisfactions: [{ type: "a_chaud", note_globale: 5, note_max: 5 }, { type: "a_chaud", note_globale: 3, note_max: 5 }, { type: "a_froid", note_globale: 1, note_max: 5 }, { type: "a_chaud", note_globale: 8, note_max: 10 }],
    qcm: [
      { id: 1, inscription_id: 1, type: "qcm", date_passage: "2026-12-01", score: 4, score_max: 20, seuil_reussite: null, resultat: "valide" },
      { id: 2, inscription_id: 1, type: "qcm", date_passage: "2026-12-05", score: 18, score_max: 20, seuil_reussite: 12, resultat: "non_determine" },
      { id: 3, inscription_id: 3, type: "qcm", date_passage: "2026-12-05", score: 4, score_max: 10, seuil_reussite: null, resultat: "non_determine" },
    ],
  });
  assert.equal(r.taux_assiduite, 95); assert.equal(r.taux_absence, 5);
  assert.equal(r.taux_abandon, 50); assert.equal(r.abandons, 2);
  assert.deepEqual(r.motifs, { personnel: 0, professionnel: 0, financement: 1, reorientation: 0, sans_nouvelles: 0, autre: 1 });
  assert.equal(r.repondants, 3, "seules les réponses « à chaud » comptent"); assert.equal(r.taux_satisfaction, 67);
  assert.deepEqual(r.niveaux, { 5: 1, 4: 1, 3: 1, 2: 0, 1: 0 });
  assert.deepEqual([r.reussites, r.echecs, r.taux_atteinte], [1, 1, 50], "dernier QCM par stagiaire ; 4/10 = échec, 18 ≥ seuil 12 = réussite");
  assert.deepEqual(r.prescripteurs, { pole_emploi: 0, mission_locale: 1, of: 0, autres: 1 }, "abandons exclus");
});

test("fiche stagiaire : champs validés, domaines de handicap réservés à l'administrateur", async () => {
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@d2.local', 'Contrib Test', 'contributeur') RETURNING id"));
  const ins = F.inscrits.Alpha;
  const url = `/api/stagiaires/${ins.stagiaire_id}`;
  const corps = { date_naissance: "1980-06-15", adresse: "3 rue Test", code_postal: "97300", ville: "Cayenne", profession: "Aide-soignante",
    entreprise: "Société Fictive", entreprise_adresse: "5 avenue Test", entreprise_siret: "123 456 789 00010", entreprise_ape: "8899B", entreprise_effectifs: "12",
    entreprise_responsable: "Paul Exemple", entreprise_opca: "OPCO Fictif" };
  assert.equal((await api("PATCH", url, { date_naissance: "pas une date" }, A())).statut, 400);
  assert.equal((await api("PATCH", url, { date_naissance: "2999-01-01" }, A())).statut, 400, "date future");
  assert.equal((await api("PATCH", url, { entreprise_siret: "ABC" }, A())).statut, 400);
  assert.equal((await api("PATCH", url, { ville: "x".repeat(101) }, A())).statut, 400);
  assert.equal((await api("PATCH", url, { adresse: 12 }, A())).statut, 400);
  ok(await api("PATCH", url, corps, C()));
  assert.equal((await api("PATCH", url, { domaines_handicap: ["moteur"] }, C())).statut, 403, "contributeur refusé");
  assert.equal((await api("PATCH", url, { domaines_handicap: ["inconnu"] }, A())).statut, 400);
  ok(await api("PATCH", url, { domaines_handicap: ["moteur", "visuel", "moteur"] }, A()));
  const { rows: [s] } = await pool.query("SELECT domaines_handicap, ville, date_naissance::text AS n FROM stagiaires WHERE id = $1", [ins.stagiaire_id]);
  assert.deepEqual([s.domaines_handicap, s.ville, s.n], [["moteur", "visuel"], "Cayenne", "1980-06-15"]);
  const relu = ok(await api("PATCH", url, { profession: "" }, C())).stagiaire;
  assert.equal(relu.profession, null, "effacement par chaîne vide");
  assert.equal("domaines_handicap" in relu, false, "jamais renvoyé à un contributeur");
  ok(await api("PATCH", url, { profession: "Aide-soignante" }, A()));
});

test("recueil : niveau de positionnement enregistré, conservé si le corps l'omet, refusé si inconnu", async () => {
  const id = F.inscrits.Alpha.id;
  const base = { statut: "realise", date_recueil: "2026-11-20", attentes: "Messagerie", conclusion: "parcours_adapte" };
  assert.equal((await api("PUT", `/api/inscriptions/${id}/recueil`, { ...base, niveau_positionnement: "expert" }, A())).statut, 400);
  ok(await api("PUT", `/api/inscriptions/${id}/recueil`, { ...base, niveau_positionnement: "debutant" }, A()));
  const r2 = ok(await api("PUT", `/api/inscriptions/${id}/recueil`, base, A())).recueil;
  assert.equal(r2.niveau_positionnement, "debutant", "ancien client : valeur conservée");
  const r3 = ok(await api("PUT", `/api/inscriptions/${id}/recueil`, { ...base, niveau_positionnement: null }, A())).recueil;
  assert.equal(r3.niveau_positionnement, null, "effacement explicite");
  ok(await api("PUT", `/api/inscriptions/${id}/recueil`, { ...base, niveau_positionnement: "debutant" }, A()));
});

test("génération : fiche, entreprise, prescripteur et indicateurs de session injectés ; handicap réservé", async () => {
  const [a, b, c] = [F.inscrits.Alpha, F.inscrits.Bravo, F.inscrits.Charlie];
  await pool.query("UPDATE prescripteurs SET adresse = '9 place Test', contact_nom = 'Anne Contact', contact_fonction = 'Conseillère', contact_email = 'a@pe.test', contact_telephone = '0594111111' WHERE code = 'pole_emploi'");
  await pool.query("UPDATE inscriptions SET prescripteur = 'pole_emploi' WHERE id = $1", [a.id]);
  await pool.query("UPDATE inscriptions SET prescripteur = 'mission_locale' WHERE id = $1", [c.id]);
  await pool.query("UPDATE inscriptions SET statut = 'abandon', categorie_abandon = 'financement', date_abandon = '2026-12-03' WHERE id = $1", [b.id]);
  await pool.query("INSERT INTO absences (inscription_id, date_absence, duree_heures) VALUES ($1, '2026-12-02', 2)", [a.id]);
  await pool.query("INSERT INTO satisfactions (session_id, type, date_recueil, note_globale, note_max) VALUES ($1, 'a_chaud', '2026-12-10', 5, 5), ($1, 'a_chaud', '2026-12-10', 3, 5)", [F.session]);
  await pool.query("INSERT INTO resultats_qcm (inscription_id, type, intitule, date_passage, score, score_max, resultat) VALUES ($1, 'qcm', 'QCM final', '2026-12-09', 17, 20, 'valide'), ($2, 'qcm', 'QCM final', '2026-12-09', 3, 20, 'non_valide')", [a.id, c.id]);
  const m = await modele("FICHE {{stagiaire_nom_complet}} né(e) le {{stagiaire_date_naissance}} ({{stagiaire_age}} ans) — {{stagiaire_adresse}}, {{stagiaire_code_postal}} {{stagiaire_ville}} — {{stagiaire_profession}} — ENTREPRISE {{stagiaire_entreprise_nom}} {{stagiaire_entreprise_siret}} {{stagiaire_entreprise_opca}} — NIVEAU {{stagiaire_niveau_positionnement}} — PRESCRIPTEUR {{prescripteur_nom}} {{prescripteur_contact_nom}} {{prescripteur_telephone}} | SESSION satisfaction {{indicateur_taux_satisfaction}} % ({{indicateur_nombre_repondants_satisfaction}}) assiduité {{indicateur_taux_assiduite}} % abandon {{indicateur_taux_abandon}} % ({{indicateur_abandons_financement}} financement) objectifs {{indicateur_taux_atteinte_objectifs}} % ML {{indicateur_inscrits_mission_locale}}");
  ok(await api("POST", "/api/generations", { modele_id: m, session_id: F.session }, C()));
  const docs = await documents(F.session, m);
  const alpha = docs.find((d) => d.stagiaire_id === a.stagiaire_id).texte;
  assert.match(alpha, /^FICHE Test Alpha né\(e\) le 15\/06\/1980 \(46 ans\) — 3 rue Test, 97300 Cayenne — Aide-soignante — ENTREPRISE Société Fictive 123 456 789 00010 OPCO Fictif — NIVEAU Débutant — PRESCRIPTEUR Pôle Emploi Anne Contact 0594111111 \|/);
  assert.match(alpha, /satisfaction 50 % \(2\) assiduité 97 % abandon 25 % \(1 financement\) objectifs 50 % ML 1$/, "4 inscrits dont Delta sans absence : (18+20+20)/60");
  assert.equal(docs.length, 3, "Alpha, Charlie et Delta : l'abandon (Bravo) n'a pas de document");
  const sensible = await modele("HANDICAP {{stagiaire_domaines_handicap}}");
  const refus = await api("POST", "/api/generations", { modele_id: sensible, session_id: F.session }, C());
  assert.equal(refus.statut, 400);
  ok(await api("POST", "/api/generations", { modele_id: sensible, session_id: F.session }, A()));
  const h = (await documents(F.session, sensible)).find((d) => d.stagiaire_id === a.stagiaire_id).texte;
  assert.equal(h, "HANDICAP Moteur, Visuel");
});
