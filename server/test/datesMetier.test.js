// ─────────────────────────────────────────────────────────────
//  TIME-1 — Dates métier « aujourd'hui » = jour civil de Cayenne
//  (America/Cayenne, UTC−3), quel que soit le fuseau de la machine.
//  Frontières de minuit, dates saisies préservées, horodatages techniques
//  inchangés. Base PostgreSQL RÉELLE et vierge + Express réelle.
// ─────────────────────────────────────────────────────────────
import { test, before, after, afterEach } from "node:test";
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
import { FUSEAU_METIER, dateMetierAujourdhui, fixerHorlogeMetier } from "../src/services/dates.js";

const PORT = 55453; // distinct des autres fichiers (55445-55447, 55449-55452)
const DATA = path.join(os.tmpdir(), "vq-dates-" + process.pid);
// 2026-10-02T00:30Z = 1er octobre, 21 h 30 à Cayenne.
const SOIR_CAYENNE = new Date("2026-10-02T00:30:00Z");

let cluster, pool, serveur, origine, adminId, indicateurId;
const F = {};

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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@d.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: indicateurId }] } = await pool.query("SELECT id FROM indicateurs ORDER BY id LIMIT 1"));
  serveur = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});

after(async () => {
  fixerHorlogeMetier(null);
  setPoolFactory(null);
  setQueryExecutor(null);
  if (serveur) await new Promise((r) => serveur.close(r));
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
  await fs.rm(DATA, { recursive: true, force: true }).catch(() => {});
});
afterEach(() => fixerHorlogeMetier(null));

const cookie = () => "vq_session=" + encode({ uid: adminId, exp: Date.now() + 60_000 });
const api = async (methode, chemin, corps) => {
  const r = await fetch(origine + chemin, { method: methode, headers: { "content-type": "application/json", cookie: cookie() }, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};
const ok = (r) => { assert.ok(r.statut < 300, JSON.stringify(r.corps)); return r.corps; };
const soirCayenne = () => fixerHorlogeMetier(() => SOIR_CAYENNE);

test("helper : frontières de minuit à Cayenne, indépendant du fuseau de la machine", () => {
  assert.equal(FUSEAU_METIER, "America/Cayenne");
  assert.equal(dateMetierAujourdhui(new Date("2026-10-02T00:30:00Z")), "2026-10-01", "cas de référence");
  assert.equal(dateMetierAujourdhui(new Date("2026-10-02T02:59:59Z")), "2026-10-01", "23:59:59 à Cayenne");
  assert.equal(dateMetierAujourdhui(new Date("2026-10-02T03:00:00Z")), "2026-10-02", "minuit pile à Cayenne");
  assert.equal(dateMetierAujourdhui(new Date("2026-10-02T03:00:01Z")), "2026-10-02", "juste après minuit");
  assert.equal(dateMetierAujourdhui(new Date("2027-01-01T01:00:00Z")), "2026-12-31", "réveillon : encore l'année précédente");
  assert.equal(dateMetierAujourdhui(new Date("2028-03-01T02:00:00Z")), "2028-02-29", "année bissextile");
  const tz = process.env.TZ;
  try {
    for (const z of ["UTC", "Asia/Tokyo", "Pacific/Kiritimati", "America/Los_Angeles"]) {
      process.env.TZ = z;
      assert.equal(dateMetierAujourdhui(new Date("2026-10-02T00:30:00Z")), "2026-10-01", `machine en ${z}`);
    }
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
  fixerHorlogeMetier(() => SOIR_CAYENNE);
  assert.equal(dateMetierAujourdhui(), "2026-10-01", "horloge injectée");
  fixerHorlogeMetier(null);
  assert.match(dateMetierAujourdhui(), /^\d{4}-\d{2}-\d{2}$/);
});

test("préparation : formation et session", async () => {
  const f = ok(await api("POST", "/api/formations", { intitule: "Formation fictive", duree_heures_defaut: 35, modalite: "presentiel" })).formation;
  F.session = ok(await api("POST", "/api/sessions", { formation_id: f.id, reference: "S-DATES", date_debut: "2026-09-01", date_fin: "2026-12-15" })).session;
});

test("inscription (unitaire et import CSV) : défaut = jour de Cayenne ; date saisie préservée", async () => {
  soirCayenne();
  const a = ok(await api("POST", `/api/sessions/${F.session.id}/stagiaires`, { nom: "Martin", prenom: "Alice" })).inscription;
  assert.equal(a.date_inscription, "2026-10-01");
  F.alice = a.id;
  const b = ok(await api("POST", `/api/sessions/${F.session.id}/stagiaires`, { nom: "Bernard", prenom: "Paul", date_inscription: "2026-09-15" })).inscription;
  assert.equal(b.date_inscription, "2026-09-15", "date explicite jamais écrasée");
  F.paul = b.id;
  ok(await api("POST", `/api/sessions/${F.session.id}/stagiaires/import`, { texte: "nom;prenom\nDurand;Léa\n" }));
  const { rows: [lea] } = await pool.query("SELECT i.date_inscription FROM inscriptions i JOIN stagiaires s ON s.id = i.stagiaire_id WHERE s.nom = 'Durand'");
  assert.equal(lea.date_inscription, "2026-10-01");
});

test("abandon : défaut = jour de Cayenne ; date saisie préservée ; horodatage technique inchangé (UTC réel)", async () => {
  soirCayenne();
  const avant = Date.now();
  const r = ok(await api("PATCH", `/api/inscriptions/${F.alice}`, { statut: "abandon" })).inscription;
  assert.equal(r.date_abandon, "2026-10-01");
  const ts = new Date(r.updated_at).getTime();
  assert.ok(Math.abs(ts - avant) < 60_000, "updated_at = instant réel, pas l'horloge métier simulée");
  const e = ok(await api("PATCH", `/api/inscriptions/${F.paul}`, { statut: "abandon", date_abandon: "2026-09-30" })).inscription;
  assert.equal(e.date_abandon, "2026-09-30", "date explicite jamais écrasée");
});

test("Qualité : référence (année), résolution et clôture d'un signalement, clôture d'une action ; date saisie préservée", async () => {
  fixerHorlogeMetier(() => new Date("2027-01-01T01:00:00Z")); // 31/12/2026, 22 h à Cayenne
  const s = ok(await api("POST", "/api/signalements", { type: "reclamation", objet: "Retard de convocation" })).signalement;
  assert.match(s.reference, /^REC-2026-\d{3}$/, "année civile de Cayenne");
  soirCayenne();
  ok(await api("PATCH", `/api/signalements/${s.id}/qualifier`, {}));
  ok(await api("PATCH", `/api/signalements/${s.id}/traiter`, {}));
  const res = ok(await api("PATCH", `/api/signalements/${s.id}/resoudre`, { synthese_reponse: "Rappel envoyé" })).signalement;
  assert.equal(res.date_resolution, "2026-10-01");
  ok(await api("PATCH", `/api/signalements/${s.id}`, { indicateur_ids: [indicateurId] }));
  const clos = ok(await api("PATCH", `/api/signalements/${s.id}/cloturer`, {})).signalement;
  assert.equal(clos.date_cloture, "2026-10-01");
  // Date de résolution saisie : préservée.
  const s2 = ok(await api("POST", "/api/signalements", { type: "reclamation", objet: "Autre" })).signalement;
  ok(await api("PATCH", `/api/signalements/${s2.id}/qualifier`, {}));
  ok(await api("PATCH", `/api/signalements/${s2.id}/traiter`, {}));
  assert.equal(ok(await api("PATCH", `/api/signalements/${s2.id}/resoudre`, { synthese_reponse: "x", date_resolution: "2026-09-20" })).signalement.date_resolution, "2026-09-20");
  // Action.
  const a = ok(await api("POST", "/api/actions-qualite", { titre: "Relancer les convocations" })).action;
  ok(await api("PATCH", `/api/actions-qualite/${a.id}/demarrer`, {}));
  ok(await api("PATCH", `/api/actions-qualite/${a.id}/realiser`, { resultat: "Fait" }));
  ok(await api("PATCH", `/api/actions-qualite/${a.id}/controle-efficacite`, { controle_efficacite: "Vérifié", date_controle_efficacite: "2026-09-28" }));
  ok(await api("PATCH", `/api/actions-qualite/${a.id}`, { indicateur_ids: [indicateurId] }));
  const ac = ok(await api("PATCH", `/api/actions-qualite/${a.id}/cloturer`, {})).action;
  assert.equal(ac.date_cloture, "2026-10-01");
  assert.equal(ac.date_controle_efficacite, "2026-09-28", "date saisie préservée");
});

test("tableau de bord Qualité : défaut = jour de Cayenne ; ?aujourdhui explicite prioritaire", async () => {
  soirCayenne();
  assert.equal(ok(await api("GET", "/api/qualite/tableau-de-bord")).aujourdhui, "2026-10-01");
  assert.equal(ok(await api("GET", "/api/qualite/tableau-de-bord?aujourdhui=2026-09-15")).aujourdhui, "2026-09-15");
});

test("preuve « marquer révisée » : défaut = jour de Cayenne ; date saisie préservée", async () => {
  soirCayenne();
  const p = ok(await api("POST", "/api/preuves", { titre: "Preuve fictive", indicateur_id: indicateurId })).preuves[0];
  ok(await api("PATCH", `/api/preuves/${p.id}`, { marquer_revise: true }));
  const lire = async () => (await pool.query("SELECT date_derniere_revision FROM preuves WHERE id = $1", [p.id])).rows[0].date_derniere_revision;
  assert.equal(await lire(), "2026-10-01");
  ok(await api("PATCH", `/api/preuves/${p.id}`, { date_derniere_revision: "2026-08-01", marquer_revise: true }));
  assert.equal(await lire(), "2026-08-01", "date explicite prioritaire");
});

test("version de référentiel : « future » jugée au jour de Cayenne", async () => {
  ok(await api("POST", "/api/referentiel/versions", { code: "VTEST", libelle: "Version fictive", date_application: "2026-10-02" }));
  soirCayenne(); // 1er octobre au soir à Cayenne, 2 octobre en UTC
  const v = ok(await api("GET", "/api/referentiel/versions")).versions.find((x) => x.code === "VTEST");
  assert.equal(v.type, "future", "le 2 octobre n'est pas encore arrivé à Cayenne");
  fixerHorlogeMetier(() => new Date("2026-10-02T03:00:01Z"));
  assert.equal(ok(await api("GET", "/api/referentiel/versions")).versions.find((x) => x.code === "VTEST").type, "historique");
});

test("aucune modification rétroactive : les dates déjà enregistrées ne bougent pas", async () => {
  const { rows } = await pool.query("SELECT date_inscription FROM inscriptions WHERE id = $1", [F.paul]);
  assert.equal(rows[0].date_inscription, "2026-09-15");
});
