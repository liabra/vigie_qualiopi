// ─────────────────────────────────────────────────────────────
//  Données documentaires : contenu de formation (objectifs opérationnels, méthodes, modalités
//  d'évaluation), analyse du besoin, évaluations, adaptations, financeur. Routes réelles,
//  PostgreSQL réel, Drive SIMULÉ. Données FICTIVES uniquement.
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
import { lireObjectifs } from "../src/routes/gestion.js";
import { clientDriveSimule as simulateur } from "./helpers/genererDrive.js";

const PORT = 55495;
const DATA = path.join(os.tmpdir(), "vq-donnees-documentaires-" + process.pid);

let cluster, pool, serveur, origine, adminId, contribId;
const F = {};
let numero = 0;

const cookie = (uid) => "vq_session=" + encode({ uid, exp: Date.now() + 60_000 });
const A = () => ({ cookie: cookie(adminId) });
const C = () => ({ cookie: cookie(contribId) });
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
// Chaque modèle a son texte ; le simulateur lit celui du fichier demandé.
const TEXTES = new Map();
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
  const lien = `MODELE_DONNEES_${String(++numero).padStart(4, "0")}`;
  TEXTES.set(lien, texte);
  return ok(await api("POST", "/api/modeles", { nom: `Modèle données ${numero}`, lien, portee: "stagiaire", type_document: "autre", mode_generation: "manuel", indicateurs: [11], ...extra }, A()), 201).modele.id;
}
async function genere(modeleId, utilisateur = A()) {
  const r = await api("POST", "/api/generations", { modele_id: modeleId, session_id: F.session }, utilisateur);
  return r;
}
async function contenu(modeleId) {
  const { rows } = await pool.query("SELECT drive_file_id FROM documents_generes WHERE session_id = $1 AND modele_id = $2 ORDER BY stagiaire_id", [F.session, modeleId]);
  return rows.map((r) => F.drive.trace.contenuCopies.get(r.drive_file_id));
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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@dd.local', 'Admin Test', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@dd.local', 'Contrib Test', 'contributeur') RETURNING id"));
  serveur = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
  F.drive = drive();
  setDriveFactory(() => F.drive.client);
});

after(async () => {
  setDriveFactory(null);
  setPoolFactory(null);
  setQueryExecutor(null);
  if (serveur) await new Promise((r) => serveur.close(r));
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
});

test("objectifs : liste ou texte « un par ligne », puces retirées, vides ignorés", () => {
  assert.deepEqual(lireObjectifs("- Utiliser un ordinateur\n\n• Naviguer sur Internet\r\n  * Écrire un message  "), ["Utiliser un ordinateur", "Naviguer sur Internet", "Écrire un message"]);
  assert.deepEqual(lireObjectifs(["A", " B ", ""]), ["A", "B"]);
  assert.deepEqual([lireObjectifs(undefined), lireObjectifs(null), lireObjectifs("")], [[], [], []]);
});

test("formation : contenu documentaire saisi, validé, relu, repris par une modification sans ces champs", async () => {
  const corps = { intitule: "Atelier fictif", duree_heures_defaut: 21, modalite: "presentiel", objectifs: "Objectif général fictif",
    objectifs_operationnels: "Utiliser un ordinateur\nNaviguer sur Internet", methodes_pedagogiques: "Ateliers pratiques", modalites_evaluation: "Exercices et quiz" };
  assert.equal((await api("POST", "/api/formations", { ...corps, objectifs_operationnels: 12 }, A())).statut, 400, "type invalide");
  assert.equal((await api("POST", "/api/formations", { ...corps, objectifs_operationnels: Array.from({ length: 31 }, (_, i) => `O${i}`) }, A())).statut, 400, "trop d'objectifs");
  assert.equal((await api("POST", "/api/formations", { ...corps, methodes_pedagogiques: "x".repeat(4001) }, A())).statut, 400);
  assert.equal((await api("POST", "/api/formations", { ...corps, modalites_evaluation: 5 }, A())).statut, 400);
  const creee = ok(await api("POST", "/api/formations", corps, A()), 201);
  F.formation = creee.formation.id;
  assert.deepEqual(creee.version.objectifs_operationnels, ["Utiliser un ordinateur", "Naviguer sur Internet"]);

  // Un ancien client modifie l'intitulé sans connaître les nouveaux champs : ils sont repris, jamais effacés.
  ok(await api("PUT", `/api/formations/${F.formation}`, { duree_heures_defaut: 21, objectifs: "Objectif général fictif" }, A()));
  const v2 = ok(await api("GET", `/api/formations/${F.formation}/versions`, undefined, A())).versions[0];
  assert.equal(v2.numero, 2);
  assert.deepEqual([v2.objectifs_operationnels, v2.methodes_pedagogiques, v2.modalites_evaluation], [["Utiliser un ordinateur", "Naviguer sur Internet"], "Ateliers pratiques", "Exercices et quiz"]);
  // Effacement explicite.
  ok(await api("PUT", `/api/formations/${F.formation}`, { duree_heures_defaut: 21, objectifs_operationnels: [], methodes_pedagogiques: "" }, A()));
  const v3 = ok(await api("GET", `/api/formations/${F.formation}/versions`, undefined, A())).versions[0];
  assert.deepEqual([v3.objectifs_operationnels, v3.methodes_pedagogiques, v3.modalites_evaluation], [[], null, "Exercices et quiz"]);
  ok(await api("PUT", `/api/formations/${F.formation}`, { duree_heures_defaut: 21, objectifs_operationnels: "Utiliser un ordinateur\nNaviguer sur Internet", methodes_pedagogiques: "Ateliers pratiques" }, A()));
  const liste = ok(await api("GET", "/api/formations", undefined, C())).formations.find((f) => f.id === F.formation);
  assert.deepEqual([liste.objectifs_operationnels.length, liste.methodes_pedagogiques], [2, "Ateliers pratiques"], "visible dans la liste");
});

test("préparation : session, deux stagiaires, recueil du besoin, évaluations, adaptation, financeur", async () => {
  F.session = ok(await api("POST", "/api/sessions", { formation_id: F.formation, date_debut: "2026-12-01", date_fin: "2026-12-05", reference: "DD-1" }, A()), 201).session.id;
  const a = ok(await api("POST", `/api/sessions/${F.session}/stagiaires`, { nom: "Alpha", prenom: "Ana" }, A()), 201).inscription;
  const b = ok(await api("POST", `/api/sessions/${F.session}/stagiaires`, { nom: "Bravo", prenom: "Ben" }, A()), 201).inscription;
  F.alpha = a; F.bravo = b;
  await pool.query("UPDATE stagiaires SET financeur = 'Région Fictive', situation_handicap = true, besoins_adaptation = 'Poste adapté fictif' WHERE id = $1", [a.stagiaire_id]);
  await pool.query(
    `INSERT INTO recueils_besoin (inscription_id, statut, date_recueil, attentes, objectifs_personnels, prerequis_verifies, conclusion)
     VALUES ($1, 'realise', '2026-11-20', 'Apprendre la messagerie', 'Devenir autonome', 'partiel', 'parcours_adapte')`, [a.id]);
  await pool.query("INSERT INTO resultats_qcm (inscription_id, type, intitule, date_passage, score, score_max, seuil_reussite, resultat, commentaire) VALUES ($1, 'intermediaire', 'Quiz 1', '2026-12-02', 14, 20, 12, 'valide', 'Bon travail')", [a.id]);
  await pool.query("INSERT INTO resultats_qcm (inscription_id, type, intitule, date_passage, score, score_max, seuil_reussite, resultat) VALUES ($1, 'qcm', 'Quiz 2', '2026-12-03', 8, 20, 12, 'non_determine')", [a.id]);
  await pool.query("INSERT INTO adaptations_parcours (inscription_id, categorie, mesure, statut, date_decision, date_mise_en_oeuvre) VALUES ($1, 'supports', 'Supports en gros caractères', 'mise_en_oeuvre', '2026-11-25', '2026-12-01')", [a.id]);
});

test("génération : contenu de formation, besoin, financeur ; absent = vide, jamais inventé", async () => {
  const m = await modele("Objectifs : {{formation_objectifs_operationnels}} | Méthodes : {{formation_methodes_pedagogiques}} | Évaluation : {{formation_modalites_evaluation}} | Financeur : {{financeur_nom}} | Recueil : {{besoin_date_recueil}} / {{besoin_attentes}} / {{besoin_objectifs_personnels}} / {{besoin_prerequis_verifies}} / {{besoin_conclusion}}");
  ok(await genere(m, C()));
  const [alpha, bravo] = (await contenu(m)).map((t) => t.replace(/\s+/g, " ").trim());
  assert.equal(alpha, "Objectifs : Utiliser un ordinateur Naviguer sur Internet | Méthodes : Ateliers pratiques | Évaluation : Exercices et quiz | Financeur : Région Fictive | Recueil : 20/11/2026 / Apprendre la messagerie / Devenir autonome / Partiellement / Parcours adapté");
  assert.equal(bravo, "Objectifs : Utiliser un ordinateur Naviguer sur Internet | Méthodes : Ateliers pratiques | Évaluation : Exercices et quiz | Financeur : | Recueil : / / / /", "stagiaire sans recueil ni financeur : champs vides");
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM documents_generes WHERE modele_id = $1", [m]);
  assert.equal(n, 2);
});

test("données de santé : refusées au contributeur, produites pour l'administrateur seul", async () => {
  const m = await modele("Handicap : {{stagiaire_situation_handicap}} | Besoins : {{stagiaire_besoins_specifiques}}");
  const refus = await genere(m, C());
  assert.equal(refus.statut, 400);
  assert.ok(refus.corps.precontrole.erreurs.every((e) => e.code === "VARIABLE_RESTREINTE_REFUSEE"));
  assert.deepEqual(await contenu(m), [], "aucun document produit");
  ok(await genere(m, A()));
  const [alpha, bravo] = (await contenu(m)).map((t) => t.replace(/\s+/g, " ").trim());
  assert.equal(alpha, "Handicap : Oui | Besoins : Poste adapté fictif");
  assert.equal(bravo, "Handicap : Non | Besoins :");
});

test("blocs : objectifs de formation codés, évaluations complètes (moment, résultat, commentaire, seuil)", async () => {
  const m = await modele("OBJ {{#objectifs_formation}}[{{objectif_code}}] {{objectif_libelle}};{{/objectifs_formation}} EVAL {{#evaluations}}{{evaluation_intitule}} {{evaluation_score_obtenu}}/{{evaluation_score_max}} seuil {{evaluation_seuil_reussite}} {{evaluation_moment}} {{evaluation_resultat_validation}} ({{evaluation_commentaire}});{{/evaluations}}");
  ok(await genere(m, C()));
  const [alpha, bravo] = (await contenu(m)).map((t) => t.replace(/\s+/g, " "));
  assert.match(alpha, /\[O1\] Utiliser un ordinateur;/);
  assert.match(alpha, /\[O2\] Naviguer sur Internet;/);
  assert.match(alpha, /Quiz 1 14\/20 seuil 12 Intermédiaire Validé \(Bon travail\);/);
  assert.match(alpha, /Quiz 2 8\/20 seuil 12 QCM \(\);/, "résultat « non déterminé » et commentaire absents : vides, jamais inventés");
  assert.doesNotMatch(bravo, /Quiz/, "aucune évaluation pour ce stagiaire");
});

test("bloc adaptations : accès restreint, administrateur seulement, libellés lisibles", async () => {
  const m = await modele("ADAPT {{#adaptations}}{{adaptation_categorie}} : {{adaptation_mesure}} ({{adaptation_statut}}, décidée le {{adaptation_date_decision}});{{/adaptations}}");
  const refus = await genere(m, C());
  assert.equal(refus.statut, 400);
  assert.ok(refus.corps.precontrole.erreurs.some((e) => e.code === "VARIABLE_RESTREINTE_REFUSEE" && e.nom === "adaptations"));
  ok(await genere(m, A()));
  const [alpha] = (await contenu(m)).map((t) => t.replace(/\s+/g, " "));
  assert.match(alpha, /Supports : Supports en gros caractères \(Mise en œuvre, décidée le 25\/11\/2026\);/);
});
