// ─────────────────────────────────────────────────────────────
//  DOC-7B — Séances + suivi pédagogique individuel : migration 025,
//  API, droits, ordre, contraintes, sensibilité et blocs documentaires.
//  Base PostgreSQL RÉELLE et vierge + Express réelle.
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
import { champBloc } from "../src/services/resolversBlocs.js";
import { renduBlocs } from "../src/services/renduBlocs.js";
import { blocCanonique, variableCanonique } from "../src/services/catalogueVariables.js";

const PORT = 55451;
const DATA = path.join(os.tmpdir(), "vq-seances-" + process.pid);

let cluster, pool, serveur, origine, adminId, contribId;
let F = {};

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
  await import("node:fs/promises").then((fs) => fs.rm(DATA, { recursive: true, force: true })).catch(() => {});
});

const cookie = (uid) => "vq_session=" + encode({ uid, exp: Date.now() + 60_000 });
const A = () => ({ cookie: cookie(adminId) });
const C = () => ({ cookie: cookie(contribId) });
const api = async (methode, chemin, corps, enTetes = {}) => {
  const r = await fetch(origine + chemin, { method: methode, headers: { "content-type": "application/json", ...enTetes }, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};
const ok = (r) => { assert.ok(r.statut < 300, JSON.stringify(r.corps)); return r.corps; };

test("préparation : formation, session, groupe et stagiaires", async () => {
  const f = ok(await api("POST", "/api/formations", { intitule: "Insertion Pro", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation;
  F.session = ok(await api("POST", "/api/sessions", { formation_id: f.id, reference: "S-1", date_debut: "2026-09-01", date_fin: "2026-12-15" }, A())).session;
  F.groupe = ok(await api("POST", `/api/sessions/${F.session.id}/groupes`, { nom: "Groupe A" }, A())).groupe;
  // Deux stagiaires dans le groupe, un hors groupe (pour tester la portée).
  for (const [n, p, gid] of [["Martin", "Alice", F.groupe.id], ["Bernard", "Paul", F.groupe.id], ["Dupont", "Zoé", null]]) {
    const corps = gid ? { nom: n, prenom: p, groupe_id: gid } : { nom: n, prenom: p };
    const r = ok(await api("POST", `/api/sessions/${F.session.id}/stagiaires`, corps, A()));
    F[n] = r.inscription.id;
  }
});

test("migration 025 : tables, contraintes (heure, phase, unicité) et cascades", async () => {
  for (const t of ["seances", "suivi_seance"]) {
    assert.equal((await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = $1", [t])).rowCount, 1, t);
  }
  // Session dédiée pour ne pas polluer la session du parcours API.
  const { rows: [sm] } = await pool.query(
    "INSERT INTO sessions (formation_id, reference, date_debut, date_fin) SELECT id, 'S-MIG', '2026-09-01', '2026-09-30' FROM formations LIMIT 1 RETURNING id");
  const sid = sm.id;
  // Heure de fin <= début refusée en base (CHECK).
  await assert.rejects(
    pool.query(`INSERT INTO seances (session_id, date_seance, heure_debut, heure_fin) VALUES ($1, '2026-09-02', '10:00', '09:00')`, [sid]),
    /check constraint/);
  await assert.rejects(
    pool.query(`INSERT INTO seances (session_id, date_seance, heure_debut, heure_fin) VALUES ($1, '2026-09-02', '10:00', '10:00')`, [sid]),
    /check constraint/);
  // phase_numero doit être > 0, jamais de borne à 6 côté base.
  await assert.rejects(pool.query(`INSERT INTO seances (session_id, date_seance, phase_numero) VALUES ($1, '2026-09-02', 0)`, [sid]), /check constraint/);
  await assert.rejects(pool.query(`INSERT INTO seances (session_id, date_seance, phase_numero) VALUES ($1, '2026-09-02', -1)`, [sid]), /check constraint/);
  const { rows: [large] } = await pool.query(`INSERT INTO seances (session_id, date_seance, phase_numero) VALUES ($1, '2026-09-02', 9) RETURNING id`, [sid]);
  assert.ok(large.id, "phase 9 acceptée (aucune borne à 6 en base)");
  // Unicité seance × inscription.
  const { rows: [se] } = await pool.query(`INSERT INTO seances (session_id, date_seance) VALUES ($1, '2026-09-03') RETURNING id`, [sid]);
  await pool.query(`INSERT INTO suivi_seance (seance_id, inscription_id, difficultes) VALUES ($1, $2, 'x')`, [se.id, F.Martin]);
  await assert.rejects(pool.query(`INSERT INTO suivi_seance (seance_id, inscription_id) VALUES ($1, $2)`, [se.id, F.Martin]), /suivi_seance/);
  // Cascade séance → suivi.
  const { rows: [se2] } = await pool.query(`INSERT INTO seances (session_id, date_seance) VALUES ($1, '2026-09-04') RETURNING id`, [sid]);
  await pool.query(`INSERT INTO suivi_seance (seance_id, inscription_id) VALUES ($1, $2)`, [se2.id, F.Martin]);
  await pool.query("DELETE FROM seances WHERE id = $1", [se2.id]);
  assert.equal((await pool.query("SELECT count(*)::int n FROM suivi_seance WHERE seance_id = $1", [se2.id])).rows[0].n, 0, "suivi supprimé avec sa séance");
});

test("API : création, ordre, modification, suppression, heure et groupe/session", async () => {
  const creer = (corps) => api("POST", `/api/sessions/${F.session.id}/seances`, corps, A());
  const s1 = ok(await creer({ date_seance: "2026-09-05", heure_debut: "09:00", heure_fin: "12:00", theme: "Accueil", competences: ["communication", "autonomie"], activites: "Atelier présentation" })).seance;
  const s2 = ok(await creer({ date_seance: "2026-09-05", heure_debut: "13:00", phase_numero: 2 })).seance;
  const s3 = ok(await creer({ date_seance: "2026-09-06", groupe_id: F.groupe.id })).seance;

  // Heure de fin <= début refusée par l'API (avant écriture).
  assert.equal((await creer({ date_seance: "2026-09-07", heure_debut: "10:00", heure_fin: "09:00" })).statut, 400);
  assert.equal((await creer({ date_seance: "2026-09-07", heure_debut: "abc" })).statut, 400);
  // phase_numero invalide refusé.
  assert.equal((await creer({ date_seance: "2026-09-07", phase_numero: 0 })).statut, 400);
  // Groupe d'une AUTRE session refusé.
  const autre = ok(await api("POST", "/api/sessions", { formation_id: (await pool.query("SELECT formation_id FROM sessions WHERE id = $1", [F.session.id])).rows[0].formation_id, reference: "S-2", date_debut: "2026-10-01", date_fin: "2026-12-15" }, A())).session;
  const gAutre = ok(await api("POST", `/api/sessions/${autre.id}/groupes`, { nom: "G B" }, A())).groupe;
  assert.equal((await creer({ date_seance: "2026-09-08", groupe_id: gAutre.id })).statut, 400);

  // Ordre : date_seance, puis heure_debut, puis id.
  const liste = ok(await api("GET", `/api/sessions/${F.session.id}/seances`, undefined, A())).seances;
  assert.deepEqual(liste.map((s) => s.id), [s1.id, s2.id, s3.id]);

  // Modification partielle.
  const patch = ok(await api("PATCH", `/api/seances/${s2.id}`, { theme: "Bilan", heure_fin: "15:00" }, A())).seance;
  assert.equal(patch.theme, "Bilan");
  assert.equal(patch.heure_fin, "15:00:00", "heure stockée en time (HH:MM:SS)");
  assert.equal((await api("PATCH", `/api/seances/${s2.id}`, { heure_debut: "16:00" }, A())).statut, 400, "fin 15:00 <= début 16:00 refusée");
  assert.equal((await api("PATCH", `/api/seances/${s2.id}`, {}, A())).statut, 400, "corps vide refusé");

  // Suppression.
  ok(await api("DELETE", `/api/seances/${s3.id}`, undefined, A()));
  assert.equal((await api("GET", `/api/sessions/${F.session.id}/seances`, undefined, A())).corps.seances.length, 2);
  F.s1 = s1; F.s2 = s2;
});

test("API : suivi individuel — séance sans suivi, avec suivi, unicité, lecture sans N+1", async () => {
  // Séance de groupe : seuls les inscrits du groupe sont listés.
  ok(await api("POST", `/api/sessions/${F.session.id}/seances`, { date_seance: "2026-09-10", groupe_id: F.groupe.id }, A()));
  const det = ok(await api("GET", `/api/sessions/${F.session.id}/seances`, undefined, A())).seances;
  const seanceGroupe = det.find((s) => s.groupe_id === F.groupe.id);

  const suivi = ok(await api("GET", `/api/seances/${seanceGroupe.id}/suivi`, undefined, A()));
  assert.equal(suivi.inscrits.length, 2, "deux inscrits du groupe, pas le stagiaire hors groupe");
  for (const i of suivi.inscrits) assert.equal(i.accompagnement, null, "sans suivi : champs absents");

  // Lecture multi-stagiaires sans N+1 : 2 requêtes quel que soit le nombre.
  let compteur = 0;
  const orig = pool.query.bind(pool);
  pool.query = async (...a) => { compteur++; return orig(...a); };
  ok(await api("GET", `/api/seances/${seanceGroupe.id}/suivi`, undefined, A()));
  const requetesDeux = compteur;
  // Ajoute deux stagiaires de plus au groupe.
  for (const [n, p] of [["Moreau", "Léa"], ["Petit", "Luc"]]) {
    ok(await api("POST", `/api/sessions/${F.session.id}/stagiaires`, { nom: n, prenom: p, groupe_id: F.groupe.id }, A()));
  }
  compteur = 0;
  ok(await api("GET", `/api/seances/${seanceGroupe.id}/suivi`, undefined, A()));
  assert.equal(compteur, requetesDeux, "même nombre de requêtes avec plus d'inscrits (aucun N+1)");
  pool.query = orig;

  // Saisie d'un suivi (contributeur) + unicité par upsert.
  ok(await api("PUT", `/api/seances/${seanceGroupe.id}/suivi/${F.Martin}`, { difficultes: "Compréhension orale", impressions: "Bien", accompagnement: "Reprise individuelle" }, C()));
  const relu = ok(await api("GET", `/api/seances/${seanceGroupe.id}/suivi`, undefined, A()));
  const alice = relu.inscrits.find((i) => i.inscription_id === F.Martin);
  assert.equal(alice.difficultes, "Compréhension orale");
  assert.equal(alice.accompagnement, "Reprise individuelle");
  assert.equal(relu.inscrits.find((i) => i.inscription_id === F.Bernard).difficultes, null, "l'autre stagiaire reste sans suivi");

  // Un stagiaire hors groupe ne peut pas être suivi sur une séance de groupe.
  assert.equal((await api("PUT", `/api/seances/${seanceGroupe.id}/suivi/${F.Dupont}`, { difficultes: "x" }, A())).statut, 400);

  // Lecture par stagiaire (vue Livret) : séances applicables + suivi, dans l'ordre.
  const livret = ok(await api("GET", `/api/inscriptions/${F.Martin}/suivi-pedagogique`, undefined, A())).seances;
  const dates = livret.map((s) => s.date_seance);
  assert.deepEqual(dates, [...dates].sort(), "ordre date_seance croissant");
  const avecSuivi = livret.find((s) => s.difficultes !== null);
  assert.equal(avecSuivi.difficultes, "Compréhension orale");
  // Zoé (hors groupe) ne voit pas la séance de groupe.
  const zoe = ok(await api("GET", `/api/inscriptions/${F.Dupont}/suivi-pedagogique`, undefined, A())).seances;
  assert.ok(!zoe.some((s) => s.groupe_id === F.groupe.id), "séance de groupe invisible hors groupe");
});

test("permissions : lecture connectée, écriture rédacteur, anonyme 401", async () => {
  assert.equal((await api("GET", `/api/sessions/${F.session.id}/seances`)).statut, 401);
  assert.equal((await api("POST", `/api/sessions/${F.session.id}/seances`, { date_seance: "2026-09-11" }, {})).statut, 401);
  // Le contributeur peut écrire (même rôle que les absences/évaluations).
  assert.equal((await api("POST", `/api/sessions/${F.session.id}/seances`, { date_seance: "2026-09-12" }, C())).statut, 201);
});

test("catalogue : variables et blocs DOC-7B, sensibilité personnelle", () => {
  const competences = variableCanonique("seance_competences");
  assert.equal(competences.id, "SEA-11");
  assert.equal(competences.type, "liste");
  assert.equal(competences.depuis, "1.4");
  const activites = variableCanonique("seance_activites");
  assert.equal(activites.id, "SEA-12");
  assert.equal(activites.format, "texte_long");

  const bloc = blocCanonique("suivi_pedagogique");
  assert.ok(bloc);
  assert.deepEqual(bloc.champs.map((c) => c.nom || c.variable), ["seance_date", "seance_competences", "seance_activites", "suivi_accompagnement", "suivi_difficultes", "suivi_impressions", "suivi_observations"]);
  for (const nom of ["suivi_accompagnement", "suivi_difficultes", "suivi_impressions", "suivi_observations"]) {
    assert.equal(bloc.champs.find((c) => c.nom === nom).sensibilite, "personnelle", nom);
  }
  // Les champs séance sont aussi dans le bloc seances.
  assert.ok(blocCanonique("seances").champs.some((c) => c.variable === "seance_competences"));
});

test("blocs documentaires : seances et suivi_pedagogique, séance sans suivi", () => {
  const ligneSeance = { date_seance: "2026-09-10", heure_debut: "09:00:00", heure_fin: "12:00:00", theme: "Atelier", competences: ["communication", "autonomie"], activites: "Jeu de rôle", groupe_nom: "Groupe A", phase_numero: 2 };
  assert.equal(champBloc("seances", "seance_date", ligneSeance).valeur, "10/09/2026");
  assert.equal(champBloc("seances", "seance_heure_debut", ligneSeance).valeur, "09:00");
  assert.equal(champBloc("seances", "seance_competences", ligneSeance).valeur, "communication, autonomie");
  assert.equal(champBloc("seances", "seance_activites", ligneSeance).valeur, "Jeu de rôle");
  assert.equal(champBloc("seances", "seance_numero", ligneSeance).statut, "non_resoluble");

  // suivi_pedagogique SANS suivi : champs séance présents, champs suivi absents.
  const ligneSansSuivi = { date_seance: "2026-09-10", competences: ["communication"], activites: "Jeu" };
  assert.equal(champBloc("suivi_pedagogique", "seance_date", ligneSansSuivi).valeur, "10/09/2026");
  assert.equal(champBloc("suivi_pedagogique", "suivi_difficultes", ligneSansSuivi).statut, "absent");
  assert.equal(champBloc("suivi_pedagogique", "suivi_impressions", ligneSansSuivi).statut, "absent");

  // Rendu intégral : une séance sans suivi donne quand même une ligne.
  const texte = "{{#suivi_pedagogique}}{{seance_date}} — {{suivi_accompagnement}}/{{suivi_difficultes}}{{/suivi_pedagogique}}";
  assert.equal(renduBlocs(texte, { suivi_pedagogique: [ligneSansSuivi] }), "10/09/2026 — /");

  // Plusieurs séances : ordre déterministe conservé, aucune valeur inventée.
  const deux = [ligneSansSuivi, { date_seance: "2026-09-11", competences: ["autonomie"], activites: "Bilan", difficultes: "Un peu rapide", impressions: "Intéressant" }];
  assert.equal(
    renduBlocs("{{#suivi_pedagogique}}{{seance_date}};{{/suivi_pedagogique}}", { suivi_pedagogique: deux }),
    "10/09/2026;11/09/2026;");
  assert.equal(
    renduBlocs("{{#suivi_pedagogique}}{{seance_date}}: {{suivi_difficultes}}{{/suivi_pedagogique}}", { suivi_pedagogique: deux }),
    "10/09/2026: 11/09/2026: Un peu rapide");
});
