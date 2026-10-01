// ─────────────────────────────────────────────────────────────
//  Q1-B5 — Tableau de bord qualité : GET /api/qualite/tableau-de-bord.
//  Base PostgreSQL RÉELLE et VIERGE (compteurs exacts) + Express réelle.
//  Faits opérationnels seulement : compteurs, priorités, indicateurs,
//  activité récente ; droits ; aucune donnée personnelle.
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

const PORT = 55449; // distinct de transversal (55445 + 55446) et qualite (55447)
const DATA = path.join(os.tmpdir(), "vq-tdb-" + process.pid);
const AUJOURDHUI = "2030-01-15";

let cluster, pool, serveur, origine, adminId, contribId, ind11, ind12;
let sonde = null; // compte les requêtes SQL pendant un appel

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
  setQueryExecutor((text, params) => { if (sonde) sonde.n++; return pool.query(text, params); });
  await migrate({ log: () => {} });
  await seedReferentiel();
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@tdb.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@tdb.local', 'Tukui', 'contributeur') RETURNING id"));
  const actifs = (await pool.query("SELECT i.id, i.numero FROM indicateurs i JOIN referentiel_versions v ON v.id = i.version_id AND v.est_active")).rows;
  ind11 = actifs.find((i) => i.numero === 11).id;
  ind12 = actifs.find((i) => i.numero === 12).id;
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
  const r = await fetch(origine + chemin, {
    method: methode, headers: { "content-type": "application/json", ...enTetes },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};
const tdb = async (jour = AUJOURDHUI) => (await api("GET", `/api/qualite/tableau-de-bord?aujourdhui=${jour}`, undefined, A())).corps;
const ok = (r) => { assert.ok(r.statut < 300, JSON.stringify(r.corps)); return r.corps; };

// Jeu de données : chaque objet a UNE raison d'attention claire.
let F = {};
test("préparation du jeu de données (via l'API réelle)", async () => {
  const action = async (corps) => ok(await api("POST", "/api/actions-qualite", corps, A())).action;
  const signalement = async (corps) => ok(await api("POST", "/api/signalements", corps, A())).signalement;
  const t = (chemin, corps = {}) => api("PATCH", chemin, corps, A()).then(ok);
  const { rows: [preuve] } = await pool.query(
    "INSERT INTO preuves (indicateur_id, titre, description, type_alerte, periodicite_mois, statut) VALUES ($1, 'Émargement', 'Description privée', 'revision_periodique', 12, 'maitrise') RETURNING id", [ind11]);
  await pool.query("INSERT INTO preuves (indicateur_id, titre, type_alerte, periodicite_mois, statut) VALUES ($1, 'Livret', 'revision_periodique', 12, 'maitrise')", [ind11]);

  F.enRetard = await action({ titre: "Action en retard", echeance: "2030-01-10", indicateur_ids: [ind11] });
  F.aJour = await action({ titre: "Action à jour", echeance: "2030-02-01" });
  ok(await api("POST", `/api/actions-qualite/${F.aJour.id}/preuves`, { preuve_id: preuve.id }, A()));
  F.efficacite = await action({ titre: "Action à vérifier", echeance: "2030-03-01", indicateur_ids: [ind12] });
  await t(`/api/actions-qualite/${F.efficacite.id}/demarrer`);
  await t(`/api/actions-qualite/${F.efficacite.id}/realiser`, { resultat: "Fait" });
  await t(`/api/actions-qualite/${F.efficacite.id}/controle-efficacite`, { controle_efficacite: "À observer", date_controle_efficacite: "2030-01-05" });
  F.cloturee = await action({ titre: "Action close", indicateur_ids: [ind11] });
  await t(`/api/actions-qualite/${F.cloturee.id}/demarrer`);
  await t(`/api/actions-qualite/${F.cloturee.id}/realiser`, { resultat: "Fait" });
  await t(`/api/actions-qualite/${F.cloturee.id}/controle-efficacite`, { controle_efficacite: "Efficace", date_controle_efficacite: "2030-01-05" });
  await t(`/api/actions-qualite/${F.cloturee.id}/cloturer`);

  F.recRetard = await signalement({ type: "reclamation", objet: "Réclamation en retard", date_echeance_cible: "2030-01-05",
    reclamant_nom: "Jean Dupont-Secret", reclamant_email: "secret@acme.fr", description: "Description sensible", indicateur_ids: [ind11] });
  F.recResolue = await signalement({ type: "reclamation", objet: "Réclamation résolue", date_echeance_cible: "2030-01-05" });
  for (const x of ["qualifier", "traiter"]) await t(`/api/signalements/${F.recResolue.id}/${x}`);
  await t(`/api/signalements/${F.recResolue.id}/resoudre`, { date_resolution: "2030-01-12" });
  F.incident = await signalement({ type: "incident", objet: "Incident ouvert" });
  ok(await api("POST", `/api/signalements/${F.incident.id}/preuves`, { preuve_id: preuve.id }, A()));
  F.annule = await signalement({ type: "non_conformite", objet: "NC annulée" });
  await t(`/api/signalements/${F.annule.id}/annuler`);
});

test("droits : admin 200, contributeur 403, date invalide 400", async () => {
  assert.equal((await api("GET", "/api/qualite/tableau-de-bord", undefined, A())).statut, 200);
  assert.equal((await api("GET", "/api/qualite/tableau-de-bord", undefined, C())).statut, 403);
  assert.equal((await api("GET", "/api/qualite/tableau-de-bord")).statut, 401);
  assert.equal((await api("GET", "/api/qualite/tableau-de-bord?aujourdhui=demain", undefined, A())).statut, 400);
});

test("KPI actions : ouvertes, en retard, efficacité à vérifier, clôturées, avec / sans preuve", async () => {
  const k = (await tdb()).kpis.actions;
  assert.deepEqual(k, { ouvertes: 3, en_retard: 1, efficacite_a_verifier: 1, cloturees: 1, ouvertes_avec_preuve: 1, ouvertes_sans_preuve: 2 });
  assert.equal((await tdb("2030-01-10")).kpis.actions.en_retard, 0, "échéance du jour : pas en retard (strictement antérieure)");
});

test("KPI signalements : à traiter, réclamations en retard (résolue exclue), résolus à clôturer, preuves", async () => {
  const k = (await tdb()).kpis.signalements;
  assert.deepEqual(k, { a_traiter: 2, reclamations_en_retard: 1, resolus_a_cloturer: 1, clotures: 0, actifs_avec_preuve: 1, actifs_sans_preuve: 2 });
  assert.equal((await tdb()).kpis.preuves.total, 2);
});

test("priorités : ordre fixe et explicable, un objet une seule fois, 10 au plus, liens identifiables", async () => {
  const p = (await tdb()).priorites;
  assert.ok(p.length <= 10);
  assert.deepEqual(p.slice(0, 4).map((x) => [x.type, x.id, x.raison]), [
    ["action", F.enRetard.id, "action_en_retard"],
    ["signalement", F.recRetard.id, "reclamation_en_retard"],
    ["action", F.efficacite.id, "efficacite_a_verifier"],
    ["signalement", F.recResolue.id, "resolu_a_cloturer"],
  ]);
  assert.equal(p[0].raison_libelle, "Action en retard");
  assert.equal(String(p[0].echeance).slice(0, 10), "2030-01-10");
  assert.equal(p[0].reference, F.enRetard.reference);
  const cles = p.map((x) => `${x.type}:${x.id}`);
  assert.equal(new Set(cles).size, cles.length, "aucun doublon");
  // La réclamation en retard est AUSSI sans preuve : elle n'apparaît qu'une
  // fois, avec sa première raison (ordre des catégories).
  assert.deepEqual(p.filter((x) => x.type === "signalement" && x.id === F.recRetard.id).map((x) => x.raison), ["reclamation_en_retard"]);
  assert.ok(!cles.includes(`action:${F.aJour.id}`), "action à jour avec preuve : aucune priorité");
  assert.ok(!cles.includes(`signalement:${F.annule.id}`) && !cles.includes(`action:${F.cloturee.id}`), "clos / annulés exclus");
});

test("vue par indicateur (référentiel actif) : preuves, actions et signalements ACTIFS liés", async () => {
  const ind = (await tdb()).indicateurs;
  const i11 = ind.find((x) => x.numero === 11);
  const i12 = ind.find((x) => x.numero === 12);
  assert.deepEqual([i11.preuves, i11.actions_actives, i11.signalements_actifs], [2, 1, 1], "l'action clôturée liée à 11 n'est pas comptée");
  assert.deepEqual([i12.preuves, i12.actions_actives, i12.signalements_actifs], [0, 1, 0]);
  assert.ok(ind.every((x) => typeof x.libelle === "string" && x.critere));
  assert.equal(new Set(ind.map((x) => x.numero)).size, ind.length);
});

test("activité récente : cycle de vie seulement, références et acteurs, aucune donnée personnelle", async () => {
  const d = await tdb();
  const a = d.activite_recente;
  assert.ok(a.length > 0 && a.length <= 15);
  const ev = new Set(a.map((x) => x.evenement));
  for (const e of ev) assert.ok(["creation", "cloturer", "annuler", "rouvrir", "preuve_rattachee", "preuve_detachee"].includes(e), e);
  assert.ok(a.every((x) => x.reference && x.acteur_nom === "Mme Stark" && x.objet_id && ["action", "signalement"].includes(x.type)));
  assert.ok(!a.some((x) => "ancienne_valeur" in x || "nouvelle_valeur" in x), "jamais les valeurs de champ");
  const brut = JSON.stringify(d);
  for (const secret of ["Jean Dupont-Secret", "secret@acme.fr", "Description sensible", "Description privée"]) {
    assert.ok(!brut.includes(secret), `absent : ${secret}`);
  }
});

test("performance : nombre de requêtes SQL constant (aucun N+1)", async () => {
  sonde = { n: 0 };
  await tdb();
  const avant = sonde.n;
  for (let i = 0; i < 5; i++) ok(await api("POST", "/api/actions-qualite", { titre: `Action ${i}`, indicateur_ids: [ind11] }, A()));
  sonde.n = 0;
  await tdb();
  const apres = sonde.n;
  sonde = null;
  assert.ok(avant > 0 && avant <= 15, `requêtes : ${avant}`);
  assert.ok(apres <= avant + 2, `requêtes indépendantes du volume (${avant} → ${apres})`);
});
