// ─────────────────────────────────────────────────────────────
//  « Aujourd'hui » (GET /api/pilotage/aujourdhui) : classement pur
//  (retard / semaine / plus tard), périmètre par rôle (le contributeur ne voit
//  ni réclamations, ni candidatures, ni intervenants, ni les tâches des
//  autres), aucune donnée sensible, auditeur refusé. Base PostgreSQL RÉELLE.
//  Données fictives.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";

import { setPoolFactory } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { seedReferentiel } from "../src/seed.js";
import { createApp } from "../src/app.js";
import { encode } from "../src/session.js";
import { fixerHorlogeMetier } from "../src/services/dates.js";
import { ajouterJours, classerElements } from "../src/services/aujourdhui.js";

const PORT = 55520;
const DATA = path.join(os.tmpdir(), "vq-aujourdhui-" + process.pid);
const SECRET_HANDICAP = "Besoin-handicap-fictif-AJD";

let cluster, pool, serveur, origine, adminId, contribId, autreId, auditeurId;

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
  await migrate({ log: () => {} });
  await seedReferentiel();
  const u = async (email, nom, role) => (await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ($1,$2,$3) RETURNING id", [email, nom, role])).rows[0].id;
  adminId = await u("admin@a.local", "Admin", "admin");
  contribId = await u("contrib@a.local", "Contrib", "contributeur");
  autreId = await u("autre@a.local", "Autre", "contributeur");
  auditeurId = await u("audit@a.local", "Audit", "auditeur");
  await pool.query("UPDATE utilisateurs SET expire_le = now() + interval '30 days' WHERE id = $1", [auditeurId]).catch(() => {});
  serveur = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
  fixerHorlogeMetier(() => new Date("2026-11-18T15:00:00Z"));

  // Données fictives.
  const { rows: [f] } = await pool.query("INSERT INTO formations (intitule, code_interne) VALUES ('Remobilisation fictive', 'AJD-1') RETURNING id");
  const { rows: [s] } = await pool.query(
    `INSERT INTO sessions (formation_id, reference, date_debut, date_fin, statut) VALUES ($1, 'S-AJD', '2026-11-03', '2026-11-25', 'en_cours') RETURNING id`, [f.id]);
  const { rows: [st] } = await pool.query("INSERT INTO stagiaires (nom, prenom, situation_handicap, besoins_adaptation) VALUES ('Nomfictif', 'Prenomfictif', true, $1) RETURNING id", [SECRET_HANDICAP]);
  await pool.query("INSERT INTO inscriptions (stagiaire_id, session_id, dossier_complet) VALUES ($1, $2, false)", [st.id, s.id]);
  await pool.query("INSERT INTO seances (session_id, date_seance, heure_debut, heure_fin, lieu) VALUES ($1, '2026-11-19', '09:00', '12:00', 'Salle 2')", [s.id]);
  await pool.query("INSERT INTO seances (session_id, date_seance) VALUES ($1, '2026-12-30')", [s.id]);
  await pool.query(`INSERT INTO taches_qualite (titre, echeance, responsable_id) VALUES
    ('Tache-retard-contrib', '2026-11-10', $1), ('Tache-semaine-sans-resp', '2026-11-20', NULL),
    ('Tache-autre-contrib', '2026-11-19', $2), ('Tache-lointaine', '2027-06-01', NULL)`, [contribId, autreId]);
  await pool.query("INSERT INTO taches_qualite (titre, echeance, statut) VALUES ('Tache-faite', '2026-11-01', 'faite')");
  await pool.query("INSERT INTO actions_qualite (reference, titre, echeance, responsable_id) VALUES ('AQ-1', 'Action-contrib', '2026-12-10', $1), ('AQ-2', 'Action-autre', '2026-11-12', $2)", [contribId, autreId]);
  await pool.query("INSERT INTO signalements_qualite (reference, type, objet, date_echeance_cible) VALUES ('REC-1', 'reclamation', 'Objet-reclamation-confidentiel', '2026-11-06')");
  await pool.query(`INSERT INTO candidatures (formation_id, nom, prenom, consentement_le) VALUES ($1, 'Candidatnom', 'Candidatprenom', now())`, [f.id]);
  await pool.query("INSERT INTO intervenants (nom, prenom, nature, date_dernier_entretien) VALUES ('Lefictif', 'Nadia', 'salarie', '2025-10-01')");
});

after(async () => {
  fixerHorlogeMetier(null);
  setPoolFactory(null);
  if (serveur) await new Promise((r) => serveur.close(r));
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
  await fs.rm(DATA, { recursive: true, force: true }).catch(() => {});
});

const cookie = (uid) => ({ cookie: "vq_session=" + encode({ uid, exp: Date.now() + 60_000 }) });
async function lire(uid) {
  const r = await fetch(origine + "/api/pilotage/aujourdhui", { headers: uid ? cookie(uid) : {} });
  return { statut: r.status, corps: await r.json().catch(() => null), brut: r };
}
const titres = (g) => g.map((e) => e.titre);

test("pur : classement retard / semaine / plus tard, sans date = cette semaine, groupe forcé respecté", () => {
  const jour = "2026-11-18";
  assert.equal(ajouterJours(jour, 14), "2026-12-02");
  const g = classerElements([
    { titre: "B", date: "2026-11-17" }, { titre: "A", date: "2026-11-25" }, { titre: "C", date: "2026-11-26" },
    { titre: "D", date: null }, { titre: "E", date: null, groupe: "retard" }, { titre: "F", date: "2026-11-18" },
  ], jour);
  assert.deepEqual(titres(g.retard), ["E", "B"]);
  assert.deepEqual(titres(g.semaine), ["D", "F", "A"]);
  assert.deepEqual(titres(g.plus_tard), ["C"]);
});

test("administrateur : tout, rangé ; rien de sensible dans la réponse", async () => {
  const { statut, corps } = await lire(adminId);
  assert.equal(statut, 200);
  const tous = [...corps.groupes.retard, ...corps.groupes.semaine, ...corps.groupes.plus_tard];
  const t = titres(tous);
  for (const attendu of ["Tache-retard-contrib", "Tache-semaine-sans-resp", "Tache-autre-contrib", "Action-contrib", "Action-autre",
    "Traiter la réclamation REC-1", "Étudier 1 candidature", "Compléter 1 dossier stagiaire", "Préparer l'enquête de fin de formation",
    "Planifier l'entretien annuel — Nadia L."]) assert.ok(t.includes(attendu), attendu);
  assert.ok(!t.includes("Tache-faite"), "tâche terminée exclue");
  assert.ok(!t.includes("Tache-lointaine"), "au-delà de l'horizon");
  assert.ok(titres(corps.groupes.retard).includes("Traiter la réclamation REC-1"));
  assert.ok(titres(corps.groupes.retard).includes("Compléter 1 dossier stagiaire"), "session commencée : en retard");
  assert.deepEqual(corps.compteurs, { retard: corps.groupes.retard.length, semaine: corps.groupes.semaine.length, plus_tard: corps.groupes.plus_tard.length });
  assert.deepEqual(corps.seances.map((s) => [s.date, s.lieu, s.inscrits]), [["2026-11-19", "Salle 2", 1]], "séances des 7 prochains jours");
  const json = JSON.stringify(corps);
  for (const secret of [SECRET_HANDICAP, "Objet-reclamation-confidentiel", "Candidatnom", "Nomfictif"]) assert.ok(!json.includes(secret), secret);
});

test("contributeur : ses tâches et celles sans responsable, ses actions, le suivi des sessions — rien d'autre", async () => {
  const { statut, corps } = await lire(contribId);
  assert.equal(statut, 200);
  assert.equal(corps.role, "contributeur");
  const t = titres([...corps.groupes.retard, ...corps.groupes.semaine, ...corps.groupes.plus_tard]);
  assert.deepEqual(t.filter((x) => x.startsWith("Tache-")).sort(), ["Tache-retard-contrib", "Tache-semaine-sans-resp"]);
  assert.ok(t.includes("Action-contrib") && !t.includes("Action-autre"));
  assert.ok(t.includes("Compléter 1 dossier stagiaire"));
  for (const interdit of ["Traiter la réclamation REC-1", "Étudier 1 candidature", "Planifier l'entretien annuel — Nadia L.", "Préparer l'enquête de fin de formation"]) {
    assert.ok(!t.includes(interdit), interdit);
  }
  const tache = corps.groupes.retard.find((e) => e.titre === "Tache-retard-contrib");
  assert.ok(Number.isInteger(tache.tache_id), "une tâche peut être cochée");
});

test("sans session : 401 ; auditeur : refusé", async () => {
  assert.equal((await lire(null)).statut, 401);
  assert.ok([401, 403].includes((await lire(auditeurId)).statut));
});
