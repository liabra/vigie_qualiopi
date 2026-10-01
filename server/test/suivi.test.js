// ─────────────────────────────────────────────────────────────
//  Q2-3 — Abandon enrichi et suivi factuel du décrochage (signaux,
//  relances). Base PostgreSQL RÉELLE et vierge + Express réelle.
//  Données entièrement fictives.
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
import { lireAbandon, lireSuivi } from "../src/services/parcours.js";

const PORT = 55452; // distinct des autres fichiers (55445-55447, 55449-55451)
const DATA = path.join(os.tmpdir(), "vq-suivi-" + process.pid);
const RESERVE = "Mention-historique-fictive-SUIVI";
const NOTE = "Contact tente le matin";
const MOTIF = "Nouvel emploi a temps plein";

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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@s.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@s.local', 'Tukui', 'contributeur') RETURNING id"));
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
const signal = (sur = {}) => ({ type: "signal", date_evenement: "2026-09-10", categorie: "absences_repetees", ...sur });
const relance = (sur = {}) => ({ type: "relance", date_evenement: "2026-09-12", categorie: "sans_reponse", canal: "telephone", note: NOTE, ...sur });
const nbSuivis = async () => (await pool.query("SELECT count(*)::int AS n FROM suivis_inscription")).rows[0].n;
const insc = async (id) => (await pool.query("SELECT statut, date_abandon, motif_abandon, categorie_abandon FROM inscriptions WHERE id = $1", [id])).rows[0];
const nbInscritsSession = async () => ok(await api("GET", "/api/sessions", undefined, A())).sessions.find((s) => s.id === F.session.id).nb_inscrits;

test("préparation : session active, session archivée, trois inscriptions, données réservées historiques", async () => {
  const f = ok(await api("POST", "/api/formations", { intitule: "Formation fictive", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation;
  F.session = ok(await api("POST", "/api/sessions", { formation_id: f.id, reference: "S-SUIVI", date_debut: "2026-09-01", date_fin: "2026-12-15" }, A())).session;
  F.archive = ok(await api("POST", "/api/sessions", { formation_id: f.id, reference: "S-SARCH", date_debut: "2025-01-01", date_fin: "2025-03-01" }, A())).session;
  for (const [n, p] of [["Martin", "Alice"], ["Bernard", "Paul"], ["Durand", "Léa"]]) ok(await api("POST", `/api/sessions/${F.session.id}/stagiaires`, { nom: n, prenom: p }, A()));
  ok(await api("POST", `/api/sessions/${F.archive.id}/stagiaires`, { nom: "Archive", prenom: "Zoé" }, A()));
  const det = ok(await api("GET", `/api/sessions/${F.session.id}`, undefined, A()));
  const alice = det.stagiaires.find((s) => s.nom === "Martin");
  F.alice = alice.inscription_id; F.aliceStagiaire = alice.id;
  F.paul = det.stagiaires.find((s) => s.nom === "Bernard").inscription_id;
  F.lea = det.stagiaires.find((s) => s.nom === "Durand").inscription_id;
  F.zoe = ok(await api("GET", `/api/sessions/${F.archive.id}`, undefined, A())).stagiaires[0].inscription_id;
  ok(await api("PATCH", `/api/stagiaires/${F.aliceStagiaire}`, { situation_handicap: true, besoins_adaptation: RESERVE }, A()));
});

test("migration 019 : colonne categorie_abandon facultative, table suivis_inscription et contraintes SQL", async () => {
  const { rows: col } = await pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_name = 'inscriptions' AND column_name = 'categorie_abandon'");
  assert.equal(col[0]?.is_nullable, "YES");
  const { rows: [m] } = await pool.query("SELECT count(*)::int AS n FROM schema_migrations WHERE nom = '019_suivi_inscriptions.sql'");
  assert.equal(m.n, 1);
  await assert.rejects(pool.query("UPDATE inscriptions SET categorie_abandon = 'sante' WHERE id = $1", [F.alice]));
  const ins = (t, cat, canal) => pool.query("INSERT INTO suivis_inscription (inscription_id, type, date_evenement, categorie, canal) VALUES ($1,$2,'2026-09-01',$3,$4)", [F.alice, t, cat, canal]);
  await assert.rejects(ins("signal", "absences_repetees", "email"), "signal avec canal");
  await assert.rejects(ins("relance", "sans_reponse", null), "relance sans canal");
  await assert.rejects(ins("signal", "sans_reponse", null), "catégorie d'un autre type");
  await assert.rejects(ins("appel", "autre", null), "type inconnu");
  await assert.rejects(pool.query("INSERT INTO suivis_inscription (inscription_id, type, date_evenement, categorie, note) VALUES ($1,'signal','2026-09-01','autre',$2)", [F.alice, "x".repeat(301)]));
  assert.equal(await nbSuivis(), 0);
});

test("service : validation de l'abandon et du suivi, erreurs sans contenu", () => {
  assert.deepEqual(lireAbandon({}).champs, {});
  assert.deepEqual(lireAbandon({ categorie_abandon: "", motif_abandon: "  " }).champs, { categorie_abandon: null, motif_abandon: null });
  assert.equal(lireAbandon({ categorie_abandon: "sante" }).erreur, "Catégorie d'abandon inconnue.");
  const long = lireAbandon({ motif_abandon: "secret".repeat(60) }).erreur;
  assert.match(long, /300 caractères/); assert.ok(!long.includes("secret"));
  assert.equal(lireSuivi(signal({ canal: "email" })).erreur, "Un signal observé n'a pas de canal.");
  assert.equal(lireSuivi(relance({ canal: undefined })).erreur, "Indiquez le canal de la relance.");
  assert.equal(lireSuivi(relance({ categorie: "absences_repetees" })).erreur, "Catégorie de suivi inconnue pour ce type d'événement.");
  assert.equal(lireSuivi(signal({ date_evenement: "" })).erreur, "Indiquez la date de l'événement.");
  assert.equal(lireSuivi({ categorie: "autre" }, { type: "signal", date_evenement: "2026-09-01", categorie: "autre", canal: null, note: null }).champs.type, "signal");
  assert.equal(lireSuivi({ type: "relance" }, { type: "signal", date_evenement: "2026-09-01", categorie: "autre" }).erreur, "Le type d'un événement de suivi ne se modifie pas.");
});

test("abandon historique (sans catégorie ni motif) : compatible, date par défaut inchangée, effectifs et assiduité inchangés", async () => {
  const avant = await nbInscritsSession();
  const r = ok(await api("PATCH", `/api/inscriptions/${F.lea}`, { statut: "abandon" }, C()));
  assert.equal(r.inscription.statut, "abandon");
  assert.equal(r.inscription.date_abandon, new Date().toISOString().slice(0, 10), "date du jour par défaut (règle existante)");
  assert.equal(r.inscription.categorie_abandon, null);
  assert.equal(r.inscription.motif_abandon, null);
  assert.equal(await nbInscritsSession(), avant - 1, "sorti des effectifs attendus");
  const abs = ok(await api("GET", `/api/sessions/${F.session.id}/absences`, undefined, A()));
  assert.equal(abs.stagiaires.find((s) => s.inscription_id === F.lea).assiduite.raison, "abandon");
});

test("abandon enrichi : catégorie + précision, date explicite conservée ; catégorie invalide et précision trop longue 400 sans écriture", async () => {
  assert.equal((await api("PATCH", `/api/inscriptions/${F.paul}`, { statut: "abandon", categorie_abandon: "sante" }, C())).statut, 400);
  assert.equal((await api("PATCH", `/api/inscriptions/${F.paul}`, { statut: "abandon", categorie_abandon: "professionnel", motif_abandon: "x".repeat(301) }, C())).statut, 400);
  assert.equal((await insc(F.paul)).statut, "inscrit", "aucune écriture partielle");
  const r = ok(await api("PATCH", `/api/inscriptions/${F.paul}`, { statut: "abandon", date_abandon: "2026-09-20", categorie_abandon: "professionnel", motif_abandon: `  ${MOTIF}  ` }, C()));
  assert.equal(r.inscription.date_abandon, "2026-09-20");
  assert.deepEqual({ ...(await insc(F.paul)) }, { statut: "abandon", date_abandon: "2026-09-20", motif_abandon: MOTIF, categorie_abandon: "professionnel" });
  // Catégorie facultative : on peut la compléter / l'effacer sans toucher au reste.
  ok(await api("PATCH", `/api/inscriptions/${F.paul}`, { categorie_abandon: null }, A()));
  assert.equal((await insc(F.paul)).categorie_abandon, null);
  assert.equal((await insc(F.paul)).motif_abandon, MOTIF);
  ok(await api("PATCH", `/api/inscriptions/${F.paul}`, { categorie_abandon: "professionnel" }, A()));
  // Les autres transitions restent possibles comme avant.
  assert.equal((await api("PATCH", `/api/inscriptions/${F.paul}`, { statut: "inconnu" }, A())).statut, 400);
});

test("invariant : catégorie d'abandon seulement si le statut EFFECTIF est « abandon » ; complément sans rejouer la transition ; sortie d'abandon cohérente", async () => {
  // Inscription active : refus, aucune écriture.
  for (const corps of [{ categorie_abandon: "personnel" }, { statut: "en_cours", categorie_abandon: "autre" }, { statut: "termine", categorie_abandon: "autre", motif_abandon: "x" }]) {
    const r = await api("PATCH", `/api/inscriptions/${F.alice}`, corps, C());
    assert.equal(r.statut, 400, JSON.stringify(corps));
    assert.equal(r.corps.error, "La catégorie d'abandon ne s'applique qu'à une inscription en abandon.");
  }
  assert.deepEqual({ ...(await insc(F.alice)) }, { statut: "inscrit", date_abandon: null, motif_abandon: null, categorie_abandon: null });
  // PATCH partiels existants préservés.
  ok(await api("PATCH", `/api/inscriptions/${F.alice}`, { categorie_abandon: null }, C()));
  ok(await api("PATCH", `/api/inscriptions/${F.alice}`, { dossier_complet: true }, C()));
  // Complément d'un abandon existant : date, statut et effectifs inchangés.
  const avantInscrits = await nbInscritsSession();
  const { date_abandon: dateLea } = await insc(F.lea);
  const r = ok(await api("PATCH", `/api/inscriptions/${F.lea}`, { categorie_abandon: "sans_nouvelles", motif_abandon: "Aucune reponse depuis deux semaines" }, C()));
  assert.equal(r.inscription.statut, "abandon");
  assert.deepEqual({ ...(await insc(F.lea)) }, { statut: "abandon", date_abandon: dateLea, motif_abandon: "Aucune reponse depuis deux semaines", categorie_abandon: "sans_nouvelles" });
  assert.equal(await nbInscritsSession(), avantInscrits, "effectifs non recalculés");
  // Correction puis effacement de la précision, catégorie conservée.
  ok(await api("PATCH", `/api/inscriptions/${F.lea}`, { motif_abandon: "" }, A()));
  assert.equal((await insc(F.lea)).motif_abandon, null);
  assert.equal((await insc(F.lea)).categorie_abandon, "sans_nouvelles");
  // Sortie d'abandon (transition existante) : la catégorie est retirée dans la MÊME écriture.
  ok(await api("PATCH", `/api/inscriptions/${F.lea}`, { statut: "inscrit" }, A()));
  const apres = await insc(F.lea);
  assert.equal(apres.statut, "inscrit");
  assert.equal(apres.categorie_abandon, null, "aucun état incohérent");
  assert.equal(apres.date_abandon, dateLea, "date d'abandon conservée (comportement existant)");
  assert.equal((await api("PATCH", `/api/inscriptions/${F.lea}`, { statut: "inscrit", categorie_abandon: "autre" }, A())).statut, 400);
  // Retour en abandon : comportement existant, puis complément possible.
  ok(await api("PATCH", `/api/inscriptions/${F.lea}`, { statut: "abandon", date_abandon: dateLea }, A()));
  ok(await api("PATCH", `/api/inscriptions/${F.lea}`, { categorie_abandon: "autre" }, C()));
  assert.equal((await insc(F.lea)).categorie_abandon, "autre");
});

test("signal factuel et relance : création (contributeur et admin), auteur conservé, ordre antéchronologique", async () => {
  const s = ok(await api("POST", `/api/inscriptions/${F.alice}/suivi`, signal(), C()));
  assert.equal(s.evenement.type, "signal"); assert.equal(s.evenement.canal, null); assert.equal(s.evenement.cree_par_nom, "Tukui");
  const r = ok(await api("POST", `/api/inscriptions/${F.alice}/suivi`, relance(), A()));
  assert.equal(r.evenement.canal, "telephone"); assert.equal(r.evenement.note, NOTE);
  F.relance = r.evenement.id; F.signal = s.evenement.id;
  const g = ok(await api("GET", `/api/inscriptions/${F.alice}/suivi`, undefined, C()));
  assert.deepEqual(g.evenements.map((e) => e.type), ["relance", "signal"]);
  assert.equal(g.archivee, false);
  assert.equal(g.inscription.statut, "inscrit");
});

test("suivi invalide : type, catégorie, canal, date, note trop longue → 400 sans écriture", async () => {
  const n = await nbSuivis();
  for (const corps of [signal({ type: "appel" }), signal({ categorie: "sans_reponse" }), signal({ canal: "email" }), relance({ canal: "pigeon" }), relance({ canal: null }),
    signal({ date_evenement: "" }), signal({ date_evenement: "2026-02-31" }), relance({ note: "y".repeat(301) })]) {
    const r = await api("POST", `/api/inscriptions/${F.alice}/suivi`, corps, C());
    assert.equal(r.statut, 400, JSON.stringify(corps).slice(0, 80));
    assert.ok(!JSON.stringify(r.corps).includes("yyyy"), "aucun texte saisi renvoyé");
  }
  assert.equal(await nbSuivis(), n);
});

test("correction (PATCH) : état final validé ; mauvaise inscription 404 sans écriture ; type immuable", async () => {
  const p = ok(await api("PATCH", `/api/inscriptions/${F.alice}/suivi/${F.relance}`, { categorie: "entretien_realise", canal: "presentiel" }, C()));
  assert.equal(p.evenement.categorie, "entretien_realise"); assert.equal(p.evenement.note, NOTE); assert.equal(p.evenement.mis_a_jour_par_nom, "Tukui");
  assert.equal((await api("PATCH", `/api/inscriptions/${F.alice}/suivi/${F.relance}`, { canal: null }, C())).statut, 400);
  assert.equal((await api("PATCH", `/api/inscriptions/${F.alice}/suivi/${F.signal}`, { type: "relance", canal: "email" }, C())).statut, 400);
  assert.equal((await api("PATCH", `/api/inscriptions/${F.paul}/suivi/${F.relance}`, { note: "x" }, A())).statut, 404, "événement d'une autre inscription");
  assert.equal((await api("GET", `/api/inscriptions/999999/suivi`, undefined, A())).statut, 404);
  assert.equal((await api("POST", `/api/inscriptions/999999/suivi`, signal(), A())).statut, 404);
  assert.equal((await api("POST", `/api/inscriptions/abc/suivi`, signal(), A())).statut, 400);
  const { rows: [e] } = await pool.query("SELECT categorie, canal, note FROM suivis_inscription WHERE id = $1", [F.relance]);
  assert.deepEqual({ ...e }, { categorie: "entretien_realise", canal: "presentiel", note: NOTE });
});

test("session archivée : lecture autorisée, écriture 409 (suivi et abandon)", async () => {
  const e = ok(await api("POST", `/api/inscriptions/${F.zoe}/suivi`, signal(), A())).evenement;
  await pool.query("UPDATE sessions SET archivee_le = now() WHERE id = $1", [F.archive.id]);
  assert.equal(ok(await api("GET", `/api/inscriptions/${F.zoe}/suivi`, undefined, C())).archivee, true);
  assert.equal((await api("POST", `/api/inscriptions/${F.zoe}/suivi`, signal(), C())).statut, 409);
  assert.equal((await api("PATCH", `/api/inscriptions/${F.zoe}/suivi/${e.id}`, { note: "x" }, A())).statut, 409);
  assert.equal((await api("PATCH", `/api/inscriptions/${F.zoe}`, { statut: "abandon", categorie_abandon: "autre" }, A())).statut, 409);
  assert.equal((await insc(F.zoe)).categorie_abandon, null);
});

test("droits : anonyme refusé (401) ; admin et contributeur autorisés", async () => {
  assert.equal((await api("GET", `/api/inscriptions/${F.alice}/suivi`)).statut, 401);
  assert.equal((await api("POST", `/api/inscriptions/${F.alice}/suivi`, signal())).statut, 401);
  assert.equal((await api("PATCH", `/api/inscriptions/${F.alice}/suivi/${F.signal}`, { note: "x" })).statut, 401);
  assert.equal((await api("GET", `/api/inscriptions/${F.alice}/suivi`, undefined, A())).statut, 200);
});

test("confidentialité : aucune donnée handicap dans les nouvelles réponses ; aucun texte libre dans l'agrégat Parcours", async () => {
  for (const u of [A(), C()]) {
    const suivi = JSON.stringify(ok(await api("GET", `/api/inscriptions/${F.alice}/suivi`, undefined, u)));
    const parc = JSON.stringify(ok(await api("GET", `/api/sessions/${F.session.id}/parcours`, undefined, u)));
    for (const t of [suivi, parc]) for (const k of ["situation_handicap", "besoins_adaptation", RESERVE]) assert.ok(!t.includes(k), k);
    for (const k of [NOTE, MOTIF, "motif_abandon", "categorie_abandon", "\"note\""]) assert.ok(!parc.includes(k), `agrégat sans ${k}`);
  }
  // Le motif n'est renvoyé QUE dans l'espace de suivi individuel.
  assert.equal(ok(await api("GET", `/api/inscriptions/${F.paul}/suivi`, undefined, C())).inscription.motif_abandon, MOTIF);
  assert.ok(!JSON.stringify(ok(await api("GET", `/api/sessions/${F.session.id}`, undefined, C()))).includes(MOTIF), "détail de session sans motif");
  for (const t of [NOTE, MOTIF, RESERVE]) assert.ok(!journal.some((l) => l.includes(t)), "journaux sans texte libre");
});

test("synthèse Parcours : issue, dernier événement, relances ; recueil Q2-1 et adaptations Q2-2 intacts ; nombre de requêtes constant", async () => {
  ok(await api("PUT", `/api/inscriptions/${F.alice}/recueil`, { statut: "a_faire" }, A()));
  ok(await api("POST", `/api/inscriptions/${F.alice}/adaptations`, { categorie: "supports", mesure: "Supports fictifs", date_decision: "2026-09-03" }, A()));
  ok(await api("POST", `/api/inscriptions/${F.alice}/suivi`, relance({ date_evenement: "2026-09-15", categorie: "echange_realise", canal: "email", note: null }), C()));
  const p = ok(await api("GET", `/api/sessions/${F.session.id}/parcours`, undefined, C()));
  const a = p.inscriptions.find((l) => l.inscription_id === F.alice);
  assert.equal(a.statut_inscription, "inscrit");
  assert.equal(a.relances_total, 2); assert.equal(a.signaux_total, 1);
  assert.deepEqual([a.dernier_suivi_type, a.dernier_suivi_categorie, a.dernier_suivi_date], ["relance", "echange_realise", "2026-09-15"]);
  assert.equal(a.recueil_statut, "a_faire"); assert.equal(a.adaptations_total, 1);
  const pa = p.inscriptions.find((l) => l.inscription_id === F.paul);
  assert.deepEqual([pa.statut_inscription, pa.date_abandon, pa.relances_total, pa.dernier_suivi_type], ["abandon", "2026-09-20", 0, null]);
  assert.ok(!("categorie_abandon" in pa), "catégorie d'abandon réservée au suivi individuel");
  // Pas de N+1 : le nombre de requêtes ne dépend pas du nombre d'inscriptions.
  let n = 0;
  setQueryExecutor((t, pr) => { n++; return pool.query(t, pr); });
  ok(await api("GET", `/api/sessions/${F.session.id}/parcours`, undefined, A()));
  const n3 = n;
  for (const [nm, pr] of [["Extra", "Un"], ["Extra", "Deux"]]) ok(await api("POST", `/api/sessions/${F.session.id}/stagiaires`, { nom: nm, prenom: pr }, A()));
  n = 0;
  ok(await api("GET", `/api/sessions/${F.session.id}/parcours`, undefined, A()));
  setQueryExecutor((t, pr) => pool.query(t, pr));
  assert.equal(n, n3);
});
