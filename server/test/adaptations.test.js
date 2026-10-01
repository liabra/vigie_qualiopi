// ─────────────────────────────────────────────────────────────
//  Q2-2 — Adaptations pédagogiques + séparation des accès aux champs
//  stagiaires réservés à l'administrateur. Base PostgreSQL RÉELLE et
//  vierge + Express réelle. Données entièrement fictives.
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
import { lireAdaptation } from "../src/services/parcours.js";
import { projeterStagiaire } from "../src/services/confidentialite.js";

const PORT = 55451; // distinct des autres fichiers (55445-55447, 55449, 55450)
const DATA = path.join(os.tmpdir(), "vq-adapt-" + process.pid);
const RESERVE = "Mention-historique-fictive-RSV";
const MESURE = "Supports remis en gros caractères";

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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@a.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@a.local', 'Tukui', 'contributeur') RETURNING id"));
  for (const m of ["log", "info", "warn", "error"]) {
    const orig = console[m];
    console[m] = (...a) => { journal.push(a.map(String).join(" ")); orig.apply(console, a); };
  }
  serveur = createApp().listen(0, "127.0.0.1"); // fix : même pile que l'origine (aucun port partagé avec un autre fichier)
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
const valide = (sur = {}) => ({ categorie: "supports", mesure: MESURE, date_decision: "2026-09-03", ...sur });

test("préparation : session active, session archivée, inscriptions, données historiques réservées", async () => {
  const f = ok(await api("POST", "/api/formations", { intitule: "Formation fictive", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation;
  F.session = ok(await api("POST", "/api/sessions", { formation_id: f.id, reference: "S-ADAPT", date_debut: "2026-09-01", date_fin: "2026-12-15" }, A())).session;
  F.archive = ok(await api("POST", "/api/sessions", { formation_id: f.id, reference: "S-ARCH", date_debut: "2025-01-01", date_fin: "2025-03-01" }, A())).session;
  for (const [n, p] of [["Martin", "Alice"], ["Bernard", "Paul"]]) ok(await api("POST", `/api/sessions/${F.session.id}/stagiaires`, { nom: n, prenom: p }, A()));
  ok(await api("POST", `/api/sessions/${F.archive.id}/stagiaires`, { nom: "Archive", prenom: "Zoé" }, A()));
  const det = ok(await api("GET", `/api/sessions/${F.session.id}`, undefined, A()));
  const alice = det.stagiaires.find((s) => s.nom === "Martin");
  F.alice = alice.inscription_id; F.aliceStagiaire = alice.id;
  F.paul = det.stagiaires.find((s) => s.nom === "Bernard").inscription_id;
  F.zoe = ok(await api("GET", `/api/sessions/${F.archive.id}`, undefined, A())).stagiaires[0].inscription_id;
  ok(await api("PATCH", `/api/stagiaires/${F.aliceStagiaire}`, { situation_handicap: true, besoins_adaptation: RESERVE }, A()));
});

test("1. migration 018 : table, contraintes SQL (catégorie, mesure, statut, date de mise en œuvre, longueurs)", async () => {
  const { rowCount } = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'adaptations_parcours'");
  assert.equal(rowCount, 1);
  const ins = (sql, p) => pool.query(sql, p);
  await assert.rejects(ins("INSERT INTO adaptations_parcours (inscription_id, categorie, mesure, date_decision) VALUES ($1,'bidon','x','2026-09-01')", [F.paul]));
  await assert.rejects(ins("INSERT INTO adaptations_parcours (inscription_id, categorie, mesure, date_decision) VALUES ($1,'rythme','   ','2026-09-01')", [F.paul]));
  await assert.rejects(ins("INSERT INTO adaptations_parcours (inscription_id, categorie, mesure, date_decision) VALUES ($1,'rythme',repeat('x',501),'2026-09-01')", [F.paul]));
  await assert.rejects(ins("INSERT INTO adaptations_parcours (inscription_id, categorie, mesure) VALUES ($1,'rythme','x')", [F.paul]), "date de décision obligatoire");
  await assert.rejects(ins("INSERT INTO adaptations_parcours (inscription_id, categorie, mesure, statut, date_decision) VALUES ($1,'rythme','x','mise_en_oeuvre','2026-09-01')", [F.paul]));
  await assert.rejects(ins("INSERT INTO adaptations_parcours (inscription_id, categorie, mesure, date_decision, bilan) VALUES ($1,'rythme','x','2026-09-01',repeat('x',501))", [F.paul]));
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM adaptations_parcours");
  assert.equal(n, 0, "aucune reprise automatique de besoins_adaptation");
});

test("service : validation de l'état final, erreurs sans contenu", () => {
  assert.match(lireAdaptation(valide({ categorie: "x" })).erreur, /Catégorie/);
  assert.match(lireAdaptation(valide({ mesure: "  " })).erreur, /Décrivez/);
  assert.match(lireAdaptation(valide({ mesure: "y".repeat(501) })).erreur, /trop longue/);
  assert.ok(!lireAdaptation(valide({ mesure: "y".repeat(501) })).erreur.includes("yyy"));
  assert.match(lireAdaptation(valide({ date_decision: "" })).erreur, /date de décision/);
  assert.match(lireAdaptation(valide({ statut: "mise_en_oeuvre" })).erreur, /mise en œuvre/);
  assert.equal(lireAdaptation({ statut: "abandonnee" }, { ...valide(), date_mise_en_oeuvre: null, bilan: null }).champs.statut, "abandonnee", "fusion avant + corps");
});

test("2-3. création valide (contributeur) et plusieurs mesures pour la même inscription ; auteur conservé", async () => {
  const a1 = ok(await api("POST", `/api/inscriptions/${F.alice}/adaptations`, valide(), C())).adaptation;
  assert.equal(a1.statut, "prevue");
  assert.equal(a1.cree_par_nom, "Tukui");
  F.a1 = a1.id;
  F.a2 = ok(await api("POST", `/api/inscriptions/${F.alice}/adaptations`, valide({ categorie: "modalites_evaluation", mesure: "Évaluation orale plutôt qu'écrite" }), A())).adaptation.id;
  F.a3 = ok(await api("POST", `/api/inscriptions/${F.alice}/adaptations`, valide({ categorie: "rythme", mesure: "Temps supplémentaire pour les exercices" }), A())).adaptation.id;
  const l = ok(await api("GET", `/api/inscriptions/${F.alice}/adaptations`, undefined, C())).adaptations;
  assert.equal(l.length, 3);
});

test("4-6. catégorie invalide, mesure vide, mesure trop longue : 400 sans écriture", async () => {
  const avant = (await pool.query("SELECT count(*)::int AS n FROM adaptations_parcours")).rows[0].n;
  for (const corps of [valide({ categorie: "diagnostic" }), valide({ mesure: "" }), valide({ mesure: "z".repeat(501) }), valide({ date_decision: "demain" })]) {
    assert.equal((await api("POST", `/api/inscriptions/${F.alice}/adaptations`, corps, A())).statut, 400, JSON.stringify(corps).slice(0, 60));
  }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM adaptations_parcours")).rows[0].n, avant);
});

test("7-9. mise en œuvre avec date, sans date refusée (aucune écriture), modification, bilan, abandon de mesure", async () => {
  const sans = await api("PATCH", `/api/inscriptions/${F.alice}/adaptations/${F.a1}`, { statut: "mise_en_oeuvre" }, C());
  assert.equal(sans.statut, 400);
  assert.equal((await pool.query("SELECT statut FROM adaptations_parcours WHERE id = $1", [F.a1])).rows[0].statut, "prevue", "aucune écriture partielle");
  const mo = ok(await api("PATCH", `/api/inscriptions/${F.alice}/adaptations/${F.a1}`, { statut: "mise_en_oeuvre", date_mise_en_oeuvre: "2026-09-10", bilan: "Supports utilisés à chaque séance" }, C())).adaptation;
  assert.deepEqual([mo.statut, String(mo.date_mise_en_oeuvre).slice(0, 10), mo.bilan], ["mise_en_oeuvre", "2026-09-10", "Supports utilisés à chaque séance"]);
  assert.equal(mo.mis_a_jour_par_nom, "Tukui");
  const modif = ok(await api("PATCH", `/api/inscriptions/${F.alice}/adaptations/${F.a1}`, { mesure: "Supports remis en gros caractères (A3)" }, A())).adaptation;
  assert.equal(modif.mesure, "Supports remis en gros caractères (A3)");
  assert.equal(modif.statut, "mise_en_oeuvre", "modification partielle : le reste est conservé");
  assert.equal(modif.cree_par_nom, "Tukui");
  assert.equal(modif.mis_a_jour_par_nom, "Mme Stark");
  const ab = ok(await api("PATCH", `/api/inscriptions/${F.alice}/adaptations/${F.a2}`, { statut: "abandonnee" }, A())).adaptation;
  assert.equal(ab.statut, "abandonnee");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM adaptations_parcours WHERE id = $1", [F.a2])).rows[0].n, 1, "mesure abandonnée conservée");
  const insc = ok(await api("GET", `/api/sessions/${F.session.id}`, undefined, A())).stagiaires.find((s) => s.inscription_id === F.alice);
  assert.notEqual(insc.statut, "abandon", "abandon d'une mesure ≠ abandon de la formation");
});

test("10. adaptation d'une autre inscription : 404, aucune écriture ; identifiants invalides 400 ; inscription inconnue 404", async () => {
  const r = await api("PATCH", `/api/inscriptions/${F.paul}/adaptations/${F.a3}`, { statut: "abandonnee" }, A());
  assert.equal(r.statut, 404);
  assert.equal((await pool.query("SELECT statut FROM adaptations_parcours WHERE id = $1", [F.a3])).rows[0].statut, "prevue");
  assert.equal((await api("PATCH", `/api/inscriptions/${F.alice}/adaptations/abc`, { statut: "abandonnee" }, A())).statut, 400);
  assert.equal((await api("POST", "/api/inscriptions/999999/adaptations", valide(), A())).statut, 404);
  assert.equal((await api("GET", "/api/inscriptions/999999/adaptations", undefined, A())).statut, 404);
});

test("11. session archivée : lecture autorisée, écriture 409 (création et modification)", async () => {
  const z = ok(await api("POST", `/api/inscriptions/${F.zoe}/adaptations`, valide(), A())).adaptation;
  await pool.query("UPDATE sessions SET archivee_le = now() WHERE id = $1", [F.archive.id]);
  assert.equal(ok(await api("GET", `/api/inscriptions/${F.zoe}/adaptations`, undefined, C())).archivee, true);
  assert.equal((await api("POST", `/api/inscriptions/${F.zoe}/adaptations`, valide(), C())).statut, 409);
  assert.equal((await api("PATCH", `/api/inscriptions/${F.zoe}/adaptations/${z.id}`, { statut: "abandonnee" }, A())).statut, 409);
});

test("12-14. droits : admin et contributeur autorisés, anonyme refusé", async () => {
  assert.equal((await api("GET", `/api/inscriptions/${F.alice}/adaptations`)).statut, 401);
  assert.equal((await api("POST", `/api/inscriptions/${F.alice}/adaptations`, valide())).statut, 401);
  assert.equal((await api("PATCH", `/api/inscriptions/${F.alice}/adaptations/${F.a3}`, { statut: "abandonnee" })).statut, 401);
  assert.equal((await api("GET", `/api/inscriptions/${F.alice}/adaptations`, undefined, A())).statut, 200);
  assert.equal((await api("GET", `/api/inscriptions/${F.alice}/adaptations`, undefined, C())).statut, 200);
});

test("15. API des adaptations : aucune donnée sensible ni personnelle", async () => {
  for (const u of [A(), C()]) {
    const brut = JSON.stringify(ok(await api("GET", `/api/inscriptions/${F.alice}/adaptations`, undefined, u)));
    for (const interdit of ["situation_handicap", "besoins_adaptation", RESERVE, "email", "telephone"]) assert.ok(!brut.includes(interdit), interdit);
  }
});

test("16-17. GET session / PATCH stagiaire : champs réservés absents pour le contributeur, présents pour l'admin", async () => {
  const c = ok(await api("GET", `/api/sessions/${F.session.id}`, undefined, C()));
  assert.ok(c.stagiaires.every((s) => !("situation_handicap" in s) && !("besoins_adaptation" in s)));
  assert.ok(!JSON.stringify(c).includes(RESERVE));
  const a = ok(await api("GET", `/api/sessions/${F.session.id}`, undefined, A()));
  const alice = a.stagiaires.find((s) => s.inscription_id === F.alice);
  assert.equal(alice.situation_handicap, true);
  assert.equal(alice.besoins_adaptation, RESERVE);
  const rc = ok(await api("PATCH", `/api/stagiaires/${F.aliceStagiaire}`, { telephone: "0600000000" }, C()));
  assert.ok(!("situation_handicap" in rc.stagiaire) && !JSON.stringify(rc).includes(RESERVE), "réponse du PATCH projetée");
});

test("18-19. contributeur : modification des champs réservés refusée ; autre champ modifié sans écraser l'historique", async () => {
  for (const corps of [{ besoins_adaptation: "" }, { besoins_adaptation: null }, { situation_handicap: false }, { entreprise: "ACME", situation_handicap: false }]) {
    assert.equal((await api("PATCH", `/api/stagiaires/${F.aliceStagiaire}`, corps, C())).statut, 403, JSON.stringify(corps));
  }
  ok(await api("PATCH", `/api/stagiaires/${F.aliceStagiaire}`, { entreprise: "Entreprise fictive" }, C()));
  const { rows: [s] } = await pool.query("SELECT situation_handicap, besoins_adaptation, entreprise FROM stagiaires WHERE id = $1", [F.aliceStagiaire]);
  assert.deepEqual([s.situation_handicap, s.besoins_adaptation, s.entreprise], [true, RESERVE, "Entreprise fictive"]);
  const csv = "nom;prénom;situation handicap\nDurand;Léa;oui";
  assert.equal((await api("POST", `/api/sessions/${F.session.id}/stagiaires/import-apercu`, { texte: csv }, C())).statut, 403);
  assert.equal((await api("POST", `/api/sessions/${F.session.id}/stagiaires/import`, { texte: csv }, C())).statut, 403);
  assert.equal((await api("POST", `/api/sessions/${F.session.id}/stagiaires/import-apercu`, { texte: csv }, A())).statut, 200, "admin : import inchangé");
});

test("20. synthèse Parcours : compteurs exacts, sans contenu libre ; recueil Q2-1 intact", async () => {
  ok(await api("PUT", `/api/inscriptions/${F.alice}/recueil`, { statut: "realise", date_recueil: "2026-09-03", conclusion: "parcours_adapte" }, C()));
  const p = ok(await api("GET", `/api/sessions/${F.session.id}/parcours`, undefined, C()));
  const a = p.inscriptions.find((i) => i.inscription_id === F.alice);
  assert.deepEqual([a.adaptations_total, a.adaptations_prevues, a.adaptations_mises_en_oeuvre, a.adaptations_abandonnees], [3, 1, 1, 1]);
  const b = p.inscriptions.find((i) => i.inscription_id === F.paul);
  assert.deepEqual([b.adaptations_total, b.adaptations_prevues], [0, 0]);
  assert.equal(a.recueil_statut, "realise");
  const brut = JSON.stringify(p);
  assert.ok(!brut.includes("Supports") && !brut.includes(RESERVE) && !brut.includes("situation_handicap"));
});

test("confidentialité : projection centralisée et journaux sans texte libre", () => {
  assert.deepEqual(projeterStagiaire({ nom: "X", situation_handicap: true, besoins_adaptation: "y" }, { role: "contributeur" }), { nom: "X" });
  assert.deepEqual(projeterStagiaire({ nom: "X", situation_handicap: true }, { role: "admin" }), { nom: "X", situation_handicap: true });
  const tout = journal.join("\n");
  for (const t of [RESERVE, MESURE, "Évaluation orale", "Supports utilisés"]) assert.ok(!tout.includes(t), t);
});
