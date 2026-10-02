// ─────────────────────────────────────────────────────────────
//  Q5 — Poste de pilotage (GET /api/pilotage/accueil) : compteurs exacts par
//  rôle, sessions archivées / annulées exclues, absence de doublons, retards
//  au jour civil de Cayenne, priorités ordonnées, aucune fuite, nombre de
//  requêtes constant. Base PostgreSQL RÉELLE et vierge. Données fictives.
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
import { dateMetierAujourdhui, fixerHorlogeMetier } from "../src/services/dates.js";
import { MAX_PRIORITES, prioritesPilotage } from "../src/services/pilotage.js";

const PORT = 55459; // distinct des autres fichiers (55445-55447, 55449-55458)
const DATA = path.join(os.tmpdir(), "vq-pilotage-" + process.pid);
const SECRETS = ["Commentaire-satisfaction-fictif", "Besoin-handicap-historique-fictif", "CV-confidentiel-fictif", "DRV-CONF", "Description-signalement-reservee"];

let cluster, pool, serveur, origine, adminId, contribId, indicateurId, sonde = null;
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
  setQueryExecutor((text, params) => { if (sonde) sonde.n++; return pool.query(text, params); });
  await migrate({ log: () => {} });
  await seedReferentiel();
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@p.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@p.local', 'Tukui', 'contributeur') RETURNING id"));
  ({ rows: [{ id: indicateurId }] } = await pool.query("SELECT id FROM indicateurs ORDER BY id LIMIT 1"));
  serveur = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
  // Jour métier figé : 1er octobre 2026 à Cayenne.
  fixerHorlogeMetier(() => new Date("2026-10-01T15:00:00Z"));
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

const cookie = (uid) => "vq_session=" + encode({ uid, exp: Date.now() + 60_000 });
const A = () => ({ cookie: cookie(adminId) });
const C = () => ({ cookie: cookie(contribId) });
const api = async (methode, chemin, corps, enTetes = {}) => {
  const r = await fetch(origine + chemin, { method: methode, headers: { "content-type": "application/json", ...enTetes }, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};
const ok = (r) => { assert.ok(r.statut < 300, JSON.stringify(r.corps)); return r.corps; };
const pilotage = async (u) => ok(await api("GET", "/api/pilotage/accueil", undefined, u));

async function session(reference, statut, debut, fin, archivee = false) {
  const { rows: [s] } = await pool.query(
    `INSERT INTO sessions (formation_id, formation_version_id, reference, date_debut, date_fin, statut, archivee_le)
     VALUES ($1, (SELECT id FROM formation_versions WHERE formation_id = $1 LIMIT 1), $2, $3, $4, $5, $6) RETURNING id`,
    [F.formation, reference, debut, fin, statut, archivee ? new Date() : null]);
  return s.id;
}
async function inscrire(sessionId, nom, { complet = false, statut = "inscrit" } = {}) {
  const { rows: [st] } = await pool.query("INSERT INTO stagiaires (nom, prenom) VALUES ($1, 'Fictif') RETURNING id", [nom]);
  const { rows: [i] } = await pool.query("INSERT INTO inscriptions (stagiaire_id, session_id, dossier_complet, statut) VALUES ($1,$2,$3,$4) RETURNING id", [st.id, sessionId, complet, statut]);
  return { stagiaire: st.id, inscription: i.id };
}

test("pur : ordre fixe, plafond, « voir davantage » vers une destination réelle uniquement", () => {
  const d = { qualite: { actions_en_retard: 1, reclamations_en_retard: 1, efficacite_a_verifier: 1 }, preuves: { perimees: 1, bientot: 1, a_confirmer: 1 },
    justificatifs: { perimes: 1, manquants: 1, bientot: 1 }, veille_actions: 1,
    sessions_suivi: [{ id: 2, reference: "B", date_debut: "2026-11-01", dossiers_incomplets: 1, recueils_a_faire: 1, mesures_prevues: 1 },
      { id: 1, reference: "A", date_debut: "2026-09-01", dossiers_incomplets: 2, recueils_a_faire: 0, mesures_prevues: 0 }] };
  const p = prioritesPilotage(d, true);
  assert.equal(p.lignes.length, MAX_PRIORITES);
  assert.deepEqual(p.lignes.slice(0, 9).map((l) => l.cle), ["actions_retard", "reclamations_retard", "efficacite", "preuves_perimees", "justificatifs_perimes",
    "justificatifs_manquants", "preuves_a_confirmer", "dossiers:1", "dossiers:2"]);
  assert.equal(p.reste, 4, "14 priorités : 10 visibles, 4 restantes");
  assert.deepEqual(p.voir_davantage, { libelle: "Voir toutes les sessions", to: "/sessions" });
  assert.equal(p.lignes[7].to, "/sessions/1/stagiaires");
  const peu = prioritesPilotage({ qualite: { actions_en_retard: 0 }, sessions_suivi: [] }, true);
  assert.deepEqual([peu.lignes, peu.reste, peu.voir_davantage], [[], 0, null]);
  const c = prioritesPilotage({ mes_actions: { en_retard: 1, liste: [{ id: 7, en_retard: true }] }, sessions_suivi: [] }, false);
  assert.deepEqual(c.lignes.map((l) => [l.cle, l.to]), [["actions_retard", "/actions-qualite/7"]]);
});

test("préparation : données Q1 à Q4 fictives (sessions de tous états, inscriptions, recueil, mesures, qualité, preuves, justificatifs, satisfaction)", async () => {
  F.formation = ok(await api("POST", "/api/formations", { intitule: "Formation fictive", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation.id;
  F.s1 = await session("EN-COURS", "en_cours", "2026-09-01", "2026-12-15");
  F.s2 = await session("A-VENIR", "planifiee", "2026-11-01", "2026-12-20");
  F.s3 = await session("PLANIFIEE-PASSEE", "planifiee", "2026-09-15", "2026-10-30");
  F.sArch = await session("ARCHIVEE", "en_cours", "2026-01-05", "2026-03-05", true);
  F.sAnn = await session("ANNULEE", "annulee", "2026-10-10", "2026-11-10");
  const a = await inscrire(F.s1, "Alpha");
  const b = await inscrire(F.s1, "Beta");
  await inscrire(F.s1, "Gamma", { complet: true });
  const ab = await inscrire(F.s1, "Abandon", { statut: "abandon" });
  await inscrire(F.s3, "Delta");
  await inscrire(F.sArch, "Archive");
  await inscrire(F.sAnn, "Annule");
  await pool.query("UPDATE stagiaires SET situation_handicap = true, besoins_adaptation = $1 WHERE id = $2", [SECRETS[1], a.stagiaire]);
  await pool.query("INSERT INTO recueils_besoin (inscription_id, statut, date_recueil) VALUES ($1, 'realise', '2026-09-02')", [a.inscription]);
  for (const [insc, statut] of [[a.inscription, "prevue"], [a.inscription, "prevue"], [b.inscription, "mise_en_oeuvre"], [ab.inscription, "prevue"]]) {
    await pool.query(`INSERT INTO adaptations_parcours (inscription_id, categorie, mesure, statut, date_decision, date_mise_en_oeuvre)
      VALUES ($1, 'supports', 'Mesure fictive', $2, '2026-09-03', $3)`, [insc, statut, statut === "mise_en_oeuvre" ? "2026-09-04" : null]);
  }
  // Q1 : actions (une en retard pour le contributeur, une échéance AUJOURD'HUI non en retard, une efficacité à vérifier), réclamations.
  F.aRetard = ok(await api("POST", "/api/actions-qualite", { titre: "Action en retard", echeance: "2026-09-30", responsable_id: contribId }, A())).action.id;
  F.aJour = ok(await api("POST", "/api/actions-qualite", { titre: "Action du jour", echeance: "2026-10-01", responsable_id: contribId }, A())).action.id;
  F.aAutre = ok(await api("POST", "/api/actions-qualite", { titre: "Action d'une autre personne", echeance: "2026-01-01", responsable_id: adminId }, A())).action.id;
  await pool.query("UPDATE actions_qualite SET statut = 'efficacite_a_verifier' WHERE id = $1", [F.aAutre]);
  const rec = ok(await api("POST", "/api/signalements", { type: "reclamation", objet: "Réclamation fictive", description: SECRETS[4], date_constat: "2026-09-01" }, A())).signalement;
  await pool.query("UPDATE signalements_qualite SET date_echeance_cible = '2026-09-20' WHERE id = $1", [rec.id]);
  ok(await api("POST", "/api/signalements", { type: "incident", objet: "Incident fictif" }, A()));
  // Preuves : périmée, bientôt (réel + 10 j), à confirmer ; un justificatif confidentiel.
  const d10 = (() => { const d = new Date(`${dateMetierAujourdhui(new Date())}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 10); return d.toISOString().slice(0, 10); })();
  await pool.query("INSERT INTO preuves (indicateur_id, titre, type_alerte, date_echeance) VALUES ($1, 'Preuve périmée', 'echeance_fixe', '2020-01-01'), ($1, 'Preuve bientôt', 'echeance_fixe', $2)", [indicateurId, d10]);
  await pool.query("INSERT INTO preuves (indicateur_id, titre, a_confirmer) VALUES ($1, 'Preuve à confirmer', true)", [indicateurId]);
  const { rows: [pc] } = await pool.query("INSERT INTO preuves (indicateur_id, titre) VALUES ($1, $2) RETURNING id", [indicateurId, SECRETS[2]]);
  await pool.query("INSERT INTO preuve_fichiers (preuve_id, drive_file_id, drive_url) VALUES ($1, 'DRV-CONF', 'https://drive.google.com/file/d/DRV-CONF/view')", [pc.id]);
  const z = ok(await api("POST", "/api/intervenants", { nom: "Martin", prenom: "Zoé", nature: "salarie" }, A())).intervenant.id;
  ok(await api("PUT", `/api/intervenants/${z}/justificatifs/attendus`, { categories: ["cv", "diplome"] }, A()));
  ok(await api("POST", `/api/intervenants/${z}/justificatifs`, { preuve_id: pc.id, categorie: "cv" }, A()));
  // Satisfaction : 2 réponses en session courante (1 commentée), 1 en session archivée (exclue).
  await pool.query("INSERT INTO satisfactions (session_id, type, date_recueil, note_globale, commentaires) VALUES ($1, 'a_chaud', '2026-09-30', 4, $2), ($1, 'a_chaud', '2026-09-30', 5, NULL), ($3, 'a_chaud', '2026-03-05', 3, NULL)", [F.s1, SECRETS[0], F.sArch]);
  await pool.query("INSERT INTO veille (type, titre, statut_action) VALUES ('autre', 'Veille fictive', 'a_realiser')");
});

test("admin : compteurs exacts (archivées et annulées exclues, abandons exclus, sans doublon), qualité, preuves, justificatifs, satisfaction", async () => {
  const d = await pilotage(A());
  assert.equal(d.role, "admin");
  assert.equal(d.aujourdhui, "2026-10-01", "jour civil de Cayenne");
  assert.deepEqual([d.sessions.en_cours, d.sessions.a_venir.map((s) => s.reference)], [1, ["A-VENIR"]], "planifiée passée exclue des « à venir », archivée et annulée exclues");
  assert.deepEqual([d.sessions.inscrits_actifs, d.sessions.dossiers_incomplets, d.sessions.recueils_a_faire, d.sessions.mesures_prevues], [4, 3, 3, 2],
    "EN-COURS : 3 actifs (2 incomplets, 2 recueils à faire, 2 mesures prévues) + PLANIFIEE-PASSEE : 1 actif ; abandon exclu");
  assert.deepEqual(d.sessions_suivi.map((s) => [s.reference, s.dossiers_incomplets, s.recueils_a_faire, s.mesures_prevues]), [["EN-COURS", 2, 2, 2], ["PLANIFIEE-PASSEE", 1, 1, 0]]);
  assert.deepEqual(d.qualite, { actions_ouvertes: 3, actions_en_retard: 2, efficacite_a_verifier: 1, reclamations_en_cours: 1, reclamations_en_retard: 1, signalements_a_traiter: 2 },
    "échéance = aujourd'hui (Cayenne) n'est pas en retard");
  assert.deepEqual(d.preuves, { perimees: 1, bientot: 1, a_confirmer: 1 });
  assert.deepEqual(d.justificatifs, { manquants: 1, bientot: 0, perimes: 0, intervenants: 1 });
  assert.deepEqual([d.satisfaction.reponses, d.veille_actions], [2, 1], "session archivée exclue");
  assert.deepEqual(d.priorites.lignes.map((l) => l.cle), ["actions_retard", "reclamations_retard", "efficacite", "preuves_perimees", "justificatifs_manquants",
    "preuves_a_confirmer", `dossiers:${F.s1}`, `dossiers:${F.s3}`, `recueils:${F.s1}`, `recueils:${F.s3}`]);
  assert.equal(d.priorites.reste, 3);
  assert.equal(d.priorites.lignes.find((l) => l.cle === `dossiers:${F.s1}`).to, `/sessions/${F.s1}/stagiaires`);
  assert.equal(d.priorites.lignes.find((l) => l.cle === "efficacite").to, "/actions-qualite?statut=efficacite_a_verifier");
});

test("contributeur : son périmètre seulement — ses actions, sessions communes ; aucune donnée qualité globale, preuve, justificatif ni satisfaction", async () => {
  const d = await pilotage(C());
  assert.equal(d.role, "contributeur");
  for (const k of ["qualite", "preuves", "justificatifs", "satisfaction", "veille_actions", "dernier_audit"]) assert.ok(!(k in d), `pas de « ${k} »`);
  assert.deepEqual([d.mes_actions.ouvertes, d.mes_actions.en_retard], [2, 1]);
  assert.deepEqual(d.mes_actions.liste.map((a) => a.id), [F.aRetard, F.aJour], "jamais l'action d'une autre personne");
  assert.equal(d.sessions.dossiers_incomplets, 3);
  assert.deepEqual(d.priorites.lignes.map((l) => l.cle), ["actions_retard", `dossiers:${F.s1}`, `dossiers:${F.s3}`, `recueils:${F.s1}`, `recueils:${F.s3}`, `mesures:${F.s1}`]);
  assert.equal(d.priorites.lignes[0].to, `/actions-qualite/${F.aRetard}`, "une seule action en retard : sa fiche");
});

test("confidentialité : aucune fuite (commentaire, handicap, justificatif, lien Drive, signalement, nom de stagiaire) dans les deux réponses ; anonyme 401", async () => {
  for (const u of [A(), C()]) {
    const t = JSON.stringify(await pilotage(u));
    for (const s of [...SECRETS, "Alpha", "situation_handicap", "besoins_adaptation", "drive_url", "commentaires"]) assert.ok(!t.includes(s), s);
  }
  assert.ok(!JSON.stringify(await pilotage(C())).includes("Action d'une autre personne"));
  assert.equal((await api("GET", "/api/pilotage/accueil")).statut, 401);
});

test("dates de Cayenne : le soir à Cayenne (lendemain en UTC), l'échéance du jour n'est pas en retard", async () => {
  fixerHorlogeMetier(() => new Date("2026-10-02T02:30:00Z")); // 1er octobre, 23 h 30 à Cayenne
  try {
    const d = await pilotage(C());
    assert.equal(d.aujourdhui, "2026-10-01");
    assert.equal(d.mes_actions.en_retard, 1);
  } finally { fixerHorlogeMetier(() => new Date("2026-10-01T15:00:00Z")); }
});

test("performance : nombre de requêtes constant, indépendant du nombre de stagiaires", async () => {
  sonde = { n: 0 }; await pilotage(A()); const avantA = sonde.n;
  sonde = { n: 0 }; await pilotage(C()); const avantC = sonde.n;
  for (let i = 0; i < 25; i++) await inscrire(F.s1, `Volume${i}`);
  sonde = { n: 0 }; const d = await pilotage(A()); const apresA = sonde.n;
  sonde = { n: 0 }; await pilotage(C()); const apresC = sonde.n;
  sonde = null;
  assert.equal(d.sessions.dossiers_incomplets, 28);
  assert.deepEqual([apresA, apresC], [avantA, avantC]);
  assert.ok(avantA <= 15 && avantC <= 10, `requêtes : admin ${avantA}, contributeur ${avantC}`);
});

test("non-régression : tableau de bord qualité, synthèse des satisfactions, annuaire et dossier Q2 inchangés", async () => {
  assert.ok(ok(await api("GET", "/api/qualite/tableau-de-bord?aujourdhui=2026-10-01", undefined, A())).kpis);
  assert.equal((await api("GET", "/api/qualite/tableau-de-bord", undefined, C())).statut, 403);
  assert.ok(ok(await api("GET", "/api/qualite/satisfactions/synthese", undefined, A())).reponses >= 2);
  assert.equal((await api("GET", "/api/qualite/satisfactions/synthese", undefined, C())).statut, 403);
  assert.ok(ok(await api("GET", `/api/sessions/${F.s1}/parcours`, undefined, C())).inscriptions.length > 0);
  assert.ok(ok(await api("GET", "/api/intervenants", undefined, C())).total >= 1);
});
