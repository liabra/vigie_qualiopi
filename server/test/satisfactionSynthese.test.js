// ─────────────────────────────────────────────────────────────
//  Q3-2 — Exploitation des satisfactions : droits de saisie (admin seul),
//  synthèse multi-sessions (filtres, échelles, taux), actions qualité
//  issues d'un retour (provenance, confidentialité), tableau de bord.
//  Base PostgreSQL RÉELLE et vierge + Express réelle. Données fictives.
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
import { synthetiserSatisfactions } from "../src/services/satisfactionSynthese.js";
import { lireProvenanceSatisfaction } from "../src/services/qualite.js";

const PORT = 55456; // distinct des autres fichiers (55445-55447, 55449-55455)
const DATA = path.join(os.tmpdir(), "vq-satsynth-" + process.pid);
const COMMENTAIRE = "Commentaire-identifiant-fictif-Q32";

let cluster, pool, serveur, origine, adminId, contribId, indicateurId;
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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@s2.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@s2.local', 'Tukui', 'contributeur') RETURNING id"));
  ({ rows: [{ id: indicateurId }] } = await pool.query("SELECT id FROM indicateurs ORDER BY id LIMIT 1"));
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
const nbActions = async () => (await pool.query("SELECT count(*)::int AS n FROM actions_qualite")).rows[0].n;
const synthese = async (qs = "", u = A()) => api("GET", `/api/qualite/satisfactions/synthese${qs}`, undefined, u);

test("préparation : deux formations, trois sessions, réponses sur 5 et sur 10 (une nominative, avec commentaire et fichier)", async () => {
  const f1 = ok(await api("POST", "/api/formations", { intitule: "Formation Alpha", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation;
  const f2 = ok(await api("POST", "/api/formations", { intitule: "Formation Beta", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation;
  F.f1 = f1.id; F.f2 = f2.id;
  F.s1 = ok(await api("POST", "/api/sessions", { formation_id: f1.id, reference: "ALPHA-1", date_debut: "2026-01-05", date_fin: "2026-03-05" }, A())).session.id;
  F.s2 = ok(await api("POST", "/api/sessions", { formation_id: f1.id, reference: "ALPHA-2", date_debut: "2026-04-01", date_fin: "2026-06-30" }, A())).session.id;
  F.s3 = ok(await api("POST", "/api/sessions", { formation_id: f2.id, reference: "BETA-1", date_debut: "2026-05-01", date_fin: "2026-07-31" }, A())).session.id;
  F.insc = ok(await api("POST", `/api/sessions/${F.s1}/stagiaires`, { nom: "Martin", prenom: "Alice", email: "alice@exemple.fr" }, A())).inscription.id;
  const ins = (session, type, date, note, max, extra = {}) => pool.query(
    `INSERT INTO satisfactions (session_id, type, date_recueil, note_globale, note_max, inscription_id, commentaires, drive_file_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [session, type, date, note, max, extra.insc ?? null, extra.com ?? null, extra.drive ?? null]);
  F.nominative = (await ins(F.s1, "a_chaud", "2026-03-05", 2, 5, { insc: F.insc, com: COMMENTAIRE, drive: "DRV-NOMINATIF" })).rows[0].id;
  await ins(F.s1, "a_chaud", "2026-03-05", 4, 5);
  await ins(F.s1, "a_chaud", "2026-03-06", 5, 5);
  await ins(F.s1, "a_froid", "2026-06-01", null, 5);
  await ins(F.s2, "a_chaud", "2026-06-30", 4, 5);
  await ins(F.s2, "prescripteur", "2026-07-01", 8, 10);
  await ins(F.s3, "partenaire", "2026-07-31", 6, 10);
  await ins(F.s3, "a_chaud", "2026-07-31", 3, 5);
});

test("1-3. droits de saisie : admin saisit ; contributeur refusé (403) en saisie, modification et import, sans écriture", async () => {
  const avant = (await pool.query("SELECT count(*)::int n FROM satisfactions")).rows[0].n;
  assert.equal((await api("POST", `/api/sessions/${F.s1}/satisfactions`, { type: "formateur", date_recueil: "2026-03-05", note_globale: 4 }, C())).statut, 403);
  assert.equal((await api("PATCH", `/api/satisfactions/${F.nominative}`, { commentaires: "x" }, C())).statut, 403);
  assert.equal((await api("POST", `/api/sessions/${F.s1}/satisfactions/import-apercu`, { texte: "a\n1", type: "a_chaud" }, C())).statut, 403);
  assert.equal((await api("POST", `/api/sessions/${F.s1}/satisfactions/import`, { texte: "a\n1", type: "a_chaud" }, C())).statut, 403);
  assert.equal((await pool.query("SELECT count(*)::int n FROM satisfactions")).rows[0].n, avant, "aucune écriture");
  const r = ok(await api("POST", `/api/sessions/${F.s1}/satisfactions`, { type: "formateur", date_recueil: "2026-03-05", note_globale: 4, note_max: 5 }, A()));
  await pool.query("DELETE FROM satisfactions WHERE id = $1", [r.satisfaction.id]);
});

test("4, 8-11. synthèse multi-sessions : publics, échelles séparées, répartition, sessions, aucune moyenne mélangée, taux indisponible", async () => {
  const s = ok(await synthese());
  assert.equal(s.reponses, 8);
  assert.deepEqual(s.periode, { du: "2026-03-05", au: "2026-07-31" });
  assert.deepEqual(s.publics, [{ type: "a_chaud", reponses: 5 }, { type: "a_froid", reponses: 1 }, { type: "partenaire", reponses: 1 }, { type: "prescripteur", reponses: 1 }]);
  assert.deepEqual(s.echelles, [
    { echelle: 5, reponses: 5, moyenne: 3.6, repartition: [{ note: 2, reponses: 1 }, { note: 3, reponses: 1 }, { note: 4, reponses: 2 }, { note: 5, reponses: 1 }] },
    { echelle: 10, reponses: 2, moyenne: 7, repartition: [{ note: 6, reponses: 1 }, { note: 8, reponses: 1 }] },
  ]);
  assert.equal(s.sans_note, 1);
  assert.equal(s.moyenne_globale, null, "notes sur 5 et sur 10 : jamais de moyenne globale");
  assert.deepEqual(s.taux, { disponible: false, message: "Taux de réponse non disponible" });
  assert.deepEqual(s.sessions.map((x) => [x.reference, x.formation, x.reponses]), [["BETA-1", "Formation Beta", 2], ["ALPHA-2", "Formation Alpha", 2], ["ALPHA-1", "Formation Alpha", 4]]);
  // Une seule échelle ⇒ moyenne globale = moyenne de cette échelle.
  assert.equal(ok(await synthese("?type=a_chaud")).moyenne_globale, 3.6);
  // Pur : jamais de conversion entre échelles.
  assert.equal(synthetiserSatisfactions([{ session_id: 1, type: "a_chaud", date_recueil: "2026-01-01", note_globale: 5, note_max: 5 }, { session_id: 1, type: "a_chaud", date_recueil: "2026-01-01", note_globale: 5, note_max: 10 }]).moyenne_globale, null);
});

test("5-7. filtres : période, formation, public, session ; erreurs de filtre lisibles", async () => {
  assert.equal(ok(await synthese("?du=2026-06-01&au=2026-06-30")).reponses, 2);
  const alpha = ok(await synthese(`?formation_id=${F.f1}`));
  assert.equal(alpha.reponses, 6);
  assert.ok(alpha.sessions.every((x) => x.formation === "Formation Alpha"));
  const pres = ok(await synthese("?type=prescripteur"));
  assert.deepEqual([pres.reponses, pres.echelles.map((e) => e.echelle)], [1, [10]]);
  assert.equal(ok(await synthese(`?session_id=${F.s3}`)).reponses, 2);
  assert.equal(ok(await synthese(`?formation_id=${F.f2}&type=a_froid`)).reponses, 0, "filtre vide : 0, sans erreur");
  assert.equal((await synthese("?du=2026-13-01")).statut, 400);
  assert.equal((await synthese("?du=2026-07-01&au=2026-06-01")).statut, 400);
  assert.equal((await synthese("?type=fournisseur")).statut, 400);
  assert.equal((await synthese("?formation_id=abc")).statut, 400);
});

test("12-13, 19. confidentialité : synthèse réservée à l'admin ; aucune donnée individuelle ; contributeur limité aux groupes ≥ 5 de sa session", async () => {
  assert.equal((await synthese("", C())).statut, 403, "aucune vue multi-sessions pour le contributeur");
  assert.equal((await synthese("?type=prescripteur", C())).statut, 403, "aucun contournement par filtre");
  assert.equal((await api("GET", "/api/qualite/satisfactions/synthese")).statut, 401);
  const brut = JSON.stringify(ok(await synthese()));
  for (const interdit of [COMMENTAIRE, "DRV-NOMINATIF", "Martin", "alice@", "inscription_id", "commentaires", "drive_file_id", "note_globale", "reponses\":{", "date_recueil"]) {
    assert.ok(!brut.includes(interdit), `synthèse sans « ${interdit} »`);
  }
  // Onglet de session (contributeur) : inchangé, groupes < 5 masqués.
  const c = ok(await api("GET", `/api/sessions/${F.s1}/satisfactions`, undefined, C()));
  assert.equal(c.restreint, true);
  assert.equal(c.agregation.insuffisant, true, "4 réponses dans la session : rien de détaillé");
  assert.ok(!JSON.stringify(c).includes(COMMENTAIRE));
});

test("14, 16, 18. action depuis une réponse : lien fiable, session de la réponse, aucune donnée sensible recopiée", async () => {
  const r = ok(await api("POST", "/api/actions-qualite", { titre: "Revoir l'accueil", satisfaction_id: F.nominative, responsable_id: contribId }, A()));
  const a = r.action;
  assert.deepEqual([a.origine, a.satisfaction_id, a.satisfaction_public, a.session_id, a.formation_id, a.signalement_id],
    ["satisfaction", F.nominative, "a_chaud", F.s1, F.f1, null]);
  assert.equal(a.constat, null, "rien n'est recopié automatiquement");
  const { rows: [enBase] } = await pool.query("SELECT row_to_json(a)::text AS t FROM actions_qualite a WHERE id = $1", [a.id]);
  for (const interdit of [COMMENTAIRE, "DRV-NOMINATIF", "Martin", "alice@"]) assert.ok(!enBase.t.includes(interdit), interdit);
  F.actionReponse = a.id;
  // Une autre session que celle de la réponse : refusée.
  assert.equal((await api("POST", "/api/actions-qualite", { titre: "x", satisfaction_id: F.nominative, session_id: F.s2 }, A())).statut, 400);
  assert.equal((await api("POST", "/api/actions-qualite", { titre: "x", satisfaction_id: 999999 }, A())).statut, 400);
  assert.equal((await api("POST", "/api/actions-qualite", { titre: "x", satisfaction_id: F.nominative, satisfaction_public: "a_froid" }, A())).statut, 400);
});

test("15-16. action depuis une synthèse : période et public conservés ; formation seule (pas de session inventée) ; validations", async () => {
  const a = ok(await api("POST", "/api/actions-qualite", { titre: "Améliorer le suivi des partenaires", satisfaction_du: "2026-01-01", satisfaction_au: "2026-12-31",
    satisfaction_public: "partenaire", formation_id: F.f2, session_id: null }, A())).action;
  assert.deepEqual([a.origine, a.satisfaction_id, a.satisfaction_public, a.satisfaction_du, a.satisfaction_au, a.formation_id, a.session_id],
    ["satisfaction", null, "partenaire", "2026-01-01", "2026-12-31", F.f2, null]);
  const tous = ok(await api("POST", "/api/actions-qualite", { titre: "Synthèse tous publics", satisfaction_du: "2026-01-01", satisfaction_au: "2026-06-30" }, A())).action;
  assert.deepEqual([tous.satisfaction_public, tous.session_id, tous.formation_id], [null, null, null], "plusieurs sessions : aucun rattachement inventé");
  for (const corps of [{ satisfaction_du: "2026-07-01", satisfaction_au: "2026-06-01" }, { satisfaction_du: "2026-01-01" }, { satisfaction_du: "2026-01-01", satisfaction_au: "2026-02-01", satisfaction_public: "inconnu" },
    { satisfaction_du: "2026-01-01", satisfaction_au: "2026-02-01", signalement_id: 1 }]) {
    assert.equal((await api("POST", "/api/actions-qualite", { titre: "x", ...corps }, A())).statut, 400, JSON.stringify(corps));
  }
  assert.equal(lireProvenanceSatisfaction({ titre: "x" }), null, "sans provenance : action manuelle inchangée");
  // Provenance immuable.
  assert.equal((await api("PATCH", `/api/actions-qualite/${a.id}`, { satisfaction_public: "a_chaud" }, A())).statut, 400);
  assert.equal((await api("PATCH", `/api/actions-qualite/${a.id}`, { signalement_id: null }, A())).statut, 400);
  ok(await api("PATCH", `/api/actions-qualite/${a.id}`, { action_prevue: "Enquête de suivi" }, A()));
});

test("17. aucune création automatique : importer ou saisir de mauvaises notes ne crée ni action ni signalement", async () => {
  const actions = await nbActions();
  const { rows: [{ n: sig }] } = await pool.query("SELECT count(*)::int AS n FROM signalements_qualite");
  ok(await api("POST", `/api/sessions/${F.s2}/satisfactions`, { type: "a_chaud", date_recueil: "2026-06-30", note_globale: 0, note_max: 5, commentaires: "Très déçu (fictif)" }, A()));
  ok(await api("POST", `/api/sessions/${F.s2}/satisfactions/import`, { texte: "Horodateur,Note\n\"30/06/2026 10:00:00\",1\n", type: "a_froid" }, A()));
  ok(await synthese());
  assert.equal(await nbActions(), actions);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM signalements_qualite")).rows[0].n, sig);
});

test("18-19. contributeur responsable : lit son action (libellé neutre) sans provenance confidentielle ; aucune autre action", async () => {
  const c = ok(await api("GET", `/api/actions-qualite/${F.actionReponse}`, undefined, C()));
  assert.equal(c.action.origine, "satisfaction");
  for (const k of ["satisfaction_id", "satisfaction_public", "satisfaction_du", "satisfaction_au"]) assert.ok(!(k in c.action), k);
  assert.ok(!JSON.stringify(c).includes(COMMENTAIRE));
  const liste = ok(await api("GET", "/api/actions-qualite", undefined, C()));
  assert.deepEqual(liste.actions.map((x) => x.id), [F.actionReponse], "ses actions seulement");
  assert.ok(liste.actions.every((x) => !("satisfaction_id" in x)));
  assert.equal((await api("POST", "/api/actions-qualite", { titre: "x", satisfaction_id: F.nominative }, C())).statut, 403);
  const admin = ok(await api("GET", `/api/actions-qualite/${F.actionReponse}`, undefined, A()));
  assert.equal(admin.action.satisfaction_id, F.nominative, "l'admin garde le lien vers la réponse");
});

test("20. tableau de bord qualité : bloc satisfaction factuel (moyennes par échelle) ; fonctionnement Q1 conservé", async () => {
  const t = ok(await api("GET", "/api/qualite/tableau-de-bord?aujourdhui=2026-10-01", undefined, A()));
  assert.ok(t.kpis && t.priorites && t.indicateurs && t.activite_recente, "structure Q1 intacte");
  const s = t.satisfaction;
  assert.equal(s.reponses, 10);
  assert.deepEqual([...s.publics].sort(), ["a_chaud", "a_froid", "partenaire", "prescripteur"]);
  assert.deepEqual(s.periode, { du: "2026-03-05", au: "2026-07-31" });
  assert.deepEqual(s.echelles.map((e) => [e.echelle, e.reponses]), [[5, 7], [10, 2]], "une ligne par échelle, jamais de moyenne mélangée");
  assert.ok(!JSON.stringify(s).includes(COMMENTAIRE));
  assert.equal((await api("GET", "/api/qualite/tableau-de-bord", undefined, C())).statut, 403);
});
