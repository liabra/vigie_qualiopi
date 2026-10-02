// ─────────────────────────────────────────────────────────────
//  Q3-1 — Import des réponses Google Forms de satisfaction (admin), publics
//  prescripteur / partenaire, échelles conservées, restitution REGROUPÉE au
//  contributeur (seuil de 5 réponses). Base PostgreSQL RÉELLE et vierge +
//  Express réelle. Données entièrement fictives.
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
import { classerReponses, dateHorodateur, devinerColonnes, noteSurEchelle, parserCsvComplet } from "../src/services/satisfactionImport.js";

const PORT = 55455; // distinct des autres fichiers (55445-55447, 55449-55454)
const DATA = path.join(os.tmpdir(), "vq-satimport-" + process.pid);

let cluster, pool, serveur, origine, adminId, contribId;
const F = {};
const journal = [];

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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@q.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@q.local', 'Tukui', 'contributeur') RETURNING id"));
  for (const m of ["log", "info", "warn", "error"]) {
    const orig = console[m];
    console[m] = (...a) => { journal.push(a.map(String).join(" ")); orig.apply(console, a); };
  }
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
const nbSatisfactions = async () => (await pool.query("SELECT count(*)::int AS n FROM satisfactions")).rows[0].n;

// Export Google Forms fictif : horodateur FR, e-mail, note sur 5,
// commentaire sur plusieurs lignes (entre guillemets), question libre.
const FORMS = [
  "Horodateur,Adresse e-mail,\"Globalement, êtes-vous satisfait(e) de la formation ? (note)\",Qu'avez-vous apprécié ?,Commentaires et suggestions",
  "\"01/10/2026 18:12:05\",alice@exemple.fr,5,Les mises en situation,\"Très bien.",
  "Merci à l'équipe.\"",
  "\"01/10/2026 18:20:41\",paul@exemple.fr,\"4 - Satisfait\",\"Le rythme, les supports\",",
  "\"01/10/2026 19:02:00\",inconnu@exemple.fr,\"3,5\",,Salle trop chaude",
].join("\n");

test("pur : CSV multiligne, horodateur, note sur 5, colonnes proposées", () => {
  const a = parserCsvComplet(FORMS);
  assert.equal(a.lignes.length, 3, "le commentaire sur deux lignes reste UNE réponse");
  assert.equal(a.lignes[0][4], "Très bien.\nMerci à l'équipe.");
  assert.equal(a.enTetes[2], "Globalement, êtes-vous satisfait(e) de la formation ? (note)");
  assert.deepEqual(devinerColonnes(a.enTetes), { colonne_note: 2, colonne_commentaire: 4 });
  assert.equal(dateHorodateur("01/10/2026 18:12:05"), "2026-10-01");
  assert.equal(dateHorodateur("2026-10-01 18:12:05"), "2026-10-01");
  assert.equal(dateHorodateur("31/02/2026 10:00:00"), null);
  assert.deepEqual(noteSurEchelle("4 - Satisfait"), { valeur: 4 });
  assert.deepEqual(noteSurEchelle("3,5"), { valeur: 3.5 });
  assert.deepEqual(noteSurEchelle(""), { valeur: null });
  assert.ok(noteSurEchelle("6").erreur && noteSurEchelle("Très satisfait").erreur, "échelle par défaut : 5");
  assert.deepEqual(noteSurEchelle("8", 10), { valeur: 8 }, "échelle du formulaire conservée");
  assert.equal(parserCsvComplet('a,b\n"non fermé,1').erreur, "Fichier mal formé : un guillemet n'est pas refermé.");
  const proto = classerReponses({ enTetes: ["Horodateur", "__proto__", "constructor"], lignes: [["01/10/2026 10:00:00", "{\"pollue\":1}", "x"]], options: {} });
  assert.equal(proto.resultats[0].reponses["__proto__"], "{\"pollue\":1}", "en-tête « __proto__ » = simple clé");
  assert.equal(({}).pollue, undefined, "aucune pollution de prototype");
  assert.match(JSON.stringify(proto.resultats[0].reponses), /__proto__/);
  const r = classerReponses({ enTetes: ["Note"], lignes: [["4"]], options: { colonne_note: 0 } });
  assert.equal(r.erreur, "Le fichier n'a pas d'horodateur : indiquez la date du recueil.");
});

test("préparation : session, deux stagiaires inscrits, session archivée", async () => {
  const f = ok(await api("POST", "/api/formations", { intitule: "Formation fictive", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation;
  F.session = ok(await api("POST", "/api/sessions", { formation_id: f.id, reference: "S-SATIMP", date_debut: "2026-09-01", date_fin: "2026-09-30" }, A())).session;
  F.archive = ok(await api("POST", "/api/sessions", { formation_id: f.id, reference: "S-SATARC", date_debut: "2025-01-01", date_fin: "2025-03-01" }, A())).session;
  F.alice = ok(await api("POST", `/api/sessions/${F.session.id}/stagiaires`, { nom: "Martin", prenom: "Alice", email: "alice@exemple.fr" }, A())).inscription.id;
  F.paul = ok(await api("POST", `/api/sessions/${F.session.id}/stagiaires`, { nom: "Bernard", prenom: "Paul", email: "paul@exemple.fr" }, A())).inscription.id;
});

test("migration 021 : publics prescripteur et partenaire acceptés ; type inconnu refusé ; réponses existantes intactes", async () => {
  for (const type of ["prescripteur", "partenaire"]) {
    const r = ok(await api("POST", `/api/sessions/${F.session.id}/satisfactions`, { type, date_recueil: "2026-10-01", note_globale: 4, commentaires: "Avis fictif" }, C()));
    assert.equal(r.satisfaction.type, type);
    assert.deepEqual(Object.keys(r.satisfaction).sort(), ["date_recueil", "id", "session_id", "type"], "contributeur : réponse projetée, sans commentaire ni répondant");
  }
  assert.equal((await api("POST", `/api/sessions/${F.session.id}/satisfactions`, { type: "fournisseur", date_recueil: "2026-10-01" }, A())).statut, 400);
  await assert.rejects(pool.query("INSERT INTO satisfactions (session_id, type, date_recueil) VALUES ($1, 'fournisseur', '2026-10-01')", [F.session.id]));
  await pool.query("DELETE FROM satisfactions");
});

test("échelles conservées : réponse sur 10 acceptée ; réponse historique intacte ; moyennes jamais mélangées entre échelles", async () => {
  ok(await api("POST", `/api/sessions/${F.session.id}/satisfactions`, { type: "a_chaud", date_recueil: "2026-10-01", note_globale: 8, note_max: 10 }, A()));
  ok(await api("POST", `/api/sessions/${F.session.id}/satisfactions`, { type: "a_chaud", date_recueil: "2026-10-01", note_globale: 4, note_max: 5 }, A()));
  assert.equal((await api("POST", `/api/sessions/${F.session.id}/satisfactions`, { type: "a_chaud", date_recueil: "2026-10-01", note_globale: 6, note_max: 5 }, A())).statut, 400, "note > échelle refusée");
  const g = ok(await api("GET", `/api/sessions/${F.session.id}/satisfactions`, undefined, A()));
  assert.equal(g.agregation.moyenne, null, "échelles différentes : aucune moyenne");
  assert.deepEqual(g.groupes.map((x) => [x.type, x.reponses, x.moyenne, x.echelle]), [["a_chaud", 2, null, null]]);
  await pool.query("DELETE FROM satisfactions");
});

test("aperçu anonyme (défaut) : aucune écriture, e-mail jamais renvoyé, colonnes d'identité écartées", async () => {
  assert.equal((await api("POST", `/api/sessions/${F.session.id}/satisfactions/import-apercu`, { texte: FORMS, type: "a_chaud" }, C())).statut, 403, "import réservé à l'admin");
  const r = ok(await api("POST", `/api/sessions/${F.session.id}/satisfactions/import-apercu`, { texte: FORMS, type: "a_chaud" }, A()));
  assert.equal(await nbSatisfactions(), 0, "aperçu sans écriture");
  assert.deepEqual(r.resume, { importables: 3, invalides: 0, aVerifier: 0, doublons: 0 });
  assert.equal(r.rapprochement, false);
  assert.equal(r.colonneEmailPresente, true);
  assert.deepEqual(r.colonnesEcartees, ["Adresse e-mail"]);
  assert.equal(r.colonne_note, 2); assert.equal(r.colonne_commentaire, 4); assert.equal(r.colonne_horodateur, 0);
  assert.deepEqual(r.lignes.map((l) => [l.date, l.note, l.stagiaire]), [["2026-10-01", 5, null], ["2026-10-01", 4, null], ["2026-10-01", 3.5, null]]);
  assert.ok(!JSON.stringify(r).includes("@exemple.fr"), "aucun e-mail dans la réponse");
});

test("import anonyme : 3 réponses, note sur 5, réponses sans e-mail ; réimport ⇒ doublons, aucune écriture", async () => {
  assert.equal((await api("POST", `/api/sessions/${F.session.id}/satisfactions/import`, { texte: FORMS, type: "a_chaud" }, C())).statut, 403);
  assert.equal(await nbSatisfactions(), 0);
  const r = ok(await api("POST", `/api/sessions/${F.session.id}/satisfactions/import`, { texte: FORMS, type: "a_chaud" }, A()));
  assert.deepEqual([r.bilan.importees, r.bilan.anonymes, r.bilan.nominatives], [3, 3, 0]);
  const { rows } = await pool.query("SELECT inscription_id, type, date_recueil, note_globale, note_max, commentaires, reponses FROM satisfactions ORDER BY id");
  assert.ok(rows.every((x) => x.inscription_id === null && x.type === "a_chaud" && Number(x.note_max) === 5));
  assert.equal(rows[0].commentaires, "Très bien.\nMerci à l'équipe.");
  assert.equal(rows[1].commentaires, null);
  assert.equal(rows[0].reponses["Qu'avez-vous apprécié ?"], "Les mises en situation");
  assert.equal(rows[0].reponses.Horodateur, "01/10/2026 18:12:05");
  assert.ok(rows.every((x) => !JSON.stringify(x.reponses).includes("@")), "e-mail jamais stocké");
  const ap = ok(await api("POST", `/api/sessions/${F.session.id}/satisfactions/import-apercu`, { texte: FORMS, type: "a_chaud" }, A()));
  assert.equal(ap.resume.doublons, 3);
  assert.equal(ok(await api("POST", `/api/sessions/${F.session.id}/satisfactions/import`, { texte: FORMS, type: "a_chaud" }, A())).bilan.importees, 0);
  assert.equal(await nbSatisfactions(), 3);
  // Même fichier pour un AUTRE public : ce ne sont pas des doublons.
  assert.equal(ok(await api("POST", `/api/sessions/${F.session.id}/satisfactions/import-apercu`, { texte: FORMS, type: "a_froid" }, A())).resume.importables, 3);
  const g = ok(await api("GET", `/api/sessions/${F.session.id}/satisfactions`, undefined, A()));
  assert.equal(g.agregation.anonymes, 3);
  assert.equal(g.agregation.moyenne, 4.17);
  await pool.query("DELETE FROM satisfactions");
});

test("rapprochement par e-mail (option) : nominatives pour les inscrits, e-mail inconnu invalide, e-mail non stocké", async () => {
  const ap = ok(await api("POST", `/api/sessions/${F.session.id}/satisfactions/import-apercu`, { texte: FORMS, type: "a_chaud", rapprocher_email: true }, A()));
  assert.deepEqual(ap.resume, { importables: 2, invalides: 1, aVerifier: 0, doublons: 0 });
  assert.deepEqual(ap.lignes.map((l) => l.stagiaire && `${l.prenom ?? l.stagiaire.prenom}`), ["Alice", "Paul", null]);
  assert.equal(ap.lignes[2].motif, "e-mail inconnu dans cette session");
  const r = ok(await api("POST", `/api/sessions/${F.session.id}/satisfactions/import`, { texte: FORMS, type: "a_chaud", rapprocher_email: true }, A()));
  assert.deepEqual([r.bilan.importees, r.bilan.nominatives, r.bilan.ignorees.length], [2, 2, 1]);
  const { rows } = await pool.query("SELECT inscription_id, reponses FROM satisfactions ORDER BY id");
  assert.deepEqual(rows.map((x) => x.inscription_id), [F.alice, F.paul]);
  assert.ok(rows.every((x) => !JSON.stringify(x.reponses).includes("@")));
  await pool.query("DELETE FROM satisfactions");
});

test("colonnes choisies, date du recueil sans horodateur, note hors échelle invalide, aucune écriture partielle", async () => {
  const sans = "Note,Remarque,Nom\n4,Bien,Martin\n7,Trop long,Bernard\n,,\n";
  const sur10 = ok(await api("POST", `/api/sessions/${F.session.id}/satisfactions/import-apercu`, { texte: sans, type: "formateur", date_defaut: "2026-09-30", note_max: 10 }, A()));
  assert.equal(sur10.resume.importables, 2, "échelle du formulaire sur 10 : 7 est valide");
  assert.equal((await api("POST", `/api/sessions/${F.session.id}/satisfactions/import-apercu`, { texte: sans, type: "formateur", date_defaut: "2026-09-30", note_max: 0 }, A())).statut, 400, "échelle invalide");
  assert.equal((await api("POST", `/api/sessions/${F.session.id}/satisfactions/import-apercu`, { texte: sans, type: "formateur" }, A())).corps.error,
    "Le fichier n'a pas d'horodateur : indiquez la date du recueil.");
  const ap = ok(await api("POST", `/api/sessions/${F.session.id}/satisfactions/import-apercu`, { texte: sans, type: "formateur", date_defaut: "2026-09-30" }, A()));
  assert.deepEqual(ap.resume, { importables: 1, invalides: 1, aVerifier: 0, doublons: 0 });
  assert.equal(ap.lignes[1].motif, "note hors de l'échelle 0 à 5");
  assert.deepEqual(ap.colonnesEcartees, ["Nom"]);
  assert.equal((await api("POST", `/api/sessions/${F.session.id}/satisfactions/import-apercu`, { texte: sans, type: "formateur", date_defaut: "2026-09-30", colonne_note: 2 }, A())).statut, 400, "colonne d'identité refusée comme note");
  assert.equal((await api("POST", `/api/sessions/${F.session.id}/satisfactions/import-apercu`, { texte: sans, type: "formateur", date_defaut: "2026-09-30", colonne_note: 9 }, A())).statut, 400);
  const r = ok(await api("POST", `/api/sessions/${F.session.id}/satisfactions/import`, { texte: sans, type: "formateur", date_defaut: "2026-09-30", colonne_note: null, colonne_commentaire: 1 }, A()));
  assert.equal(r.bilan.importees, 2, "sans colonne de note, la note est vide et la ligne reste importable");
  const { rows } = await pool.query("SELECT note_globale, commentaires, reponses FROM satisfactions ORDER BY id");
  assert.deepEqual(rows.map((x) => [x.note_globale, x.commentaires]), [[null, "Bien"], [null, "Trop long"]]);
  assert.ok(rows.every((x) => !("Nom" in x.reponses)), "colonne d'identité jamais conservée");
  await pool.query("DELETE FROM satisfactions");
});

test("garde-fous : public obligatoire, rapprochement sans colonne e-mail, fichier vide, droits, session archivée 409, anonyme 401", async () => {
  assert.equal((await api("POST", `/api/sessions/${F.session.id}/satisfactions/import-apercu`, { texte: FORMS }, A())).corps.error, "Choisissez le public interrogé.");
  assert.equal((await api("POST", `/api/sessions/${F.session.id}/satisfactions/import-apercu`, { texte: "Horodateur,Note\n01/10/2026 10:00:00,4", type: "a_chaud", rapprocher_email: true }, A())).corps.error,
    "Rapprochement demandé, mais le fichier n'a pas de colonne e-mail.");
  assert.equal((await api("POST", `/api/sessions/${F.session.id}/satisfactions/import-apercu`, { texte: "  ", type: "a_chaud" }, A())).statut, 400);
  assert.equal((await api("POST", `/api/sessions/999999/satisfactions/import-apercu`, { texte: FORMS, type: "a_chaud" }, A())).statut, 404);
  assert.equal((await api("POST", `/api/sessions/${F.session.id}/satisfactions/import`, { texte: FORMS, type: "a_chaud" })).statut, 401);
  await pool.query("UPDATE sessions SET archivee_le = now() WHERE id = $1", [F.archive.id]);
  assert.equal((await api("POST", `/api/sessions/${F.archive.id}/satisfactions/import`, { texte: FORMS, type: "a_chaud" }, A())).statut, 409);
  assert.equal(await nbSatisfactions(), 0);
  assert.ok(!journal.some((l) => l.includes("@exemple.fr") || l.includes("Salle trop chaude")), "journaux sans e-mail ni réponse");
});

test("contributeur : résultats REGROUPÉS uniquement (aucun nom, commentaire, réponse ni fichier) ; groupe < 5 non restitué", async () => {
  // 4 réponses « à chaud » (dont une nominative, avec fichier source), 6 « prescripteur » sur 5.
  await pool.query(`INSERT INTO satisfactions (session_id, inscription_id, type, date_recueil, note_globale, note_max, commentaires, reponses, drive_file_id)
    VALUES ($1, $2, 'a_chaud', '2026-09-30', 4, 5, 'Commentaire-identifiant-fictif', '{"Q":"R-fictive"}', 'DRV-SOURCE')`, [F.session.id, F.alice]);
  for (let i = 0; i < 3; i++) await pool.query("INSERT INTO satisfactions (session_id, type, date_recueil, note_globale, note_max) VALUES ($1, 'a_chaud', '2026-09-30', 5, 5)", [F.session.id]);
  for (let i = 0; i < 6; i++) await pool.query("INSERT INTO satisfactions (session_id, type, date_recueil, note_globale, note_max) VALUES ($1, 'prescripteur', '2026-09-30', $2, 5)", [F.session.id, 3 + (i % 2)]);
  const c = ok(await api("GET", `/api/sessions/${F.session.id}/satisfactions`, undefined, C()));
  const brut = JSON.stringify(c);
  for (const interdit of ["Commentaire-identifiant-fictif", "R-fictive", "DRV-SOURCE", "Martin", "Alice", "inscription_id", "commentaires", "drive_file_id", "\"satisfactions\"", "anonymes", "nominatives"]) {
    assert.ok(!brut.includes(interdit), `aucun « ${interdit} » pour le contributeur`);
  }
  assert.equal(c.restreint, true); assert.equal(c.seuil, 5);
  assert.deepEqual(c.agregation, { reponses: 10, insuffisant: false, moyenne: 4, echelleHomogene: 5 });
  assert.deepEqual(c.groupes.find((g) => g.type === "a_chaud"), { type: "a_chaud", insuffisant: true }, "4 réponses : non restitué");
  assert.deepEqual(c.groupes.find((g) => g.type === "prescripteur"), { type: "prescripteur", insuffisant: false, reponses: 6, moyenne: 3.5, echelle: 5 });
  // Admin : accès individuel complet, groupes inclus.
  const a = ok(await api("GET", `/api/sessions/${F.session.id}/satisfactions`, undefined, A()));
  assert.equal(a.satisfactions.length, 10);
  assert.ok(JSON.stringify(a).includes("Commentaire-identifiant-fictif") && a.satisfactions.some((x) => x.nom === "Martin" && x.drive_file_id === "DRV-SOURCE"));
  // Session de 1 à 4 réponses au total : rien de détaillé.
  await pool.query("DELETE FROM satisfactions WHERE type = 'prescripteur'");
  const peu = ok(await api("GET", `/api/sessions/${F.session.id}/satisfactions`, undefined, C()));
  assert.deepEqual(peu.agregation, { reponses: null, insuffisant: true, moyenne: null, echelleHomogene: null });
  // Session sans réponse : simplement vide.
  await pool.query("DELETE FROM satisfactions");
  assert.deepEqual(ok(await api("GET", `/api/sessions/${F.session.id}/satisfactions`, undefined, C())).agregation, { reponses: 0, insuffisant: false, moyenne: null, echelleHomogene: null });
});

test("contributeur : modification d'une réponse refusée (403, rien d'écrit, rien renvoyé) ; anciens types et données historiques conservés", async () => {
  const { rows: [h] } = await pool.query("INSERT INTO satisfactions (session_id, type, date_recueil, note_globale, note_max, commentaires) VALUES ($1, 'entreprise', '2025-12-01', 7, 10, 'Historique fictif') RETURNING id", [F.session.id]);
  const r = await api("PATCH", `/api/satisfactions/${h.id}`, { commentaires: "x" }, C());
  assert.equal(r.statut, 403);
  assert.ok(!JSON.stringify(r.corps).includes("Historique fictif"));
  for (const type of ["a_chaud", "a_froid", "financeur", "entreprise", "formateur"]) {
    assert.equal((await api("POST", `/api/sessions/${F.session.id}/satisfactions`, { type, date_recueil: "2026-10-01" }, A())).statut, 201, type);
  }
  ok(await api("PATCH", `/api/satisfactions/${h.id}`, { note_globale: 8 }, A()));
  const { rows: [apres] } = await pool.query("SELECT note_globale, note_max, commentaires FROM satisfactions WHERE id = $1", [h.id]);
  assert.deepEqual([Number(apres.note_globale), Number(apres.note_max), apres.commentaires], [8, 10, "Historique fictif"], "échelle et commentaire historiques intacts");
  await pool.query("DELETE FROM satisfactions");
});
