// ─────────────────────────────────────────────────────────────
//  Q1 — Cœur qualité : tests de bout en bout sur PostgreSQL RÉEL
//  (embedded-postgres) + application Express réelle.
//
//  Migration 015, références transactionnelles, workflows, RBAC,
//  confidentialité (pas de fuite d'identité réclamant), historique.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { setPoolFactory, setQueryExecutor } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { seedReferentiel } from "../src/seed.js";
import { createApp } from "../src/app.js";
import { encode } from "../src/session.js";

const PORT = 55446; // distinct de transversal (55445)
const DATA = path.join(os.tmpdir(), "vq-q1-" + process.pid);
const DIR_MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../db/migrations");

// Applique les N premières migrations en direct (pour simuler une
// installation arrêtée à une version donnée).
async function appliquerJusqua(p, limite) {
  await p.query("CREATE TABLE IF NOT EXISTS schema_migrations (nom text PRIMARY KEY, applique_le timestamptz NOT NULL DEFAULT now())");
  const files = (await fs.readdir(DIR_MIGRATIONS)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const cibles = limite === undefined ? files : files.slice(0, limite);
  for (const f of cibles) {
    const sql = await fs.readFile(path.join(DIR_MIGRATIONS, f), "utf8");
    const cx = await p.connect();
    try {
      await cx.query("BEGIN");
      await cx.query(sql);
      await cx.query("INSERT INTO schema_migrations (nom) VALUES ($1) ON CONFLICT DO NOTHING", [f]);
      await cx.query("COMMIT");
    } finally { cx.release(); }
  }
  return cibles;
}

let cluster, pool, serveur, origine, adminId, contribId, indicateurId;

before(async () => {
  cluster = new EmbeddedPostgres({
    databaseDir: DATA, port: PORT, user: "postgres", password: "postgres",
    persistent: false, onLog: () => {}, onError: () => {},
  });
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

  const { rows: [admin] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ($1, $2, 'admin') RETURNING id", ["admin@q1.local", "Mme Stark"]);
  const { rows: [contrib] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ($1, $2, 'contributeur') RETURNING id", ["contrib@q1.local", "Tukui"]);
  adminId = admin.id; contribId = contrib.id;
  const { rows: [ind] } = await pool.query("SELECT id FROM indicateurs ORDER BY id LIMIT 1");
  indicateurId = ind.id;

  serveur = createApp().listen(0);
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
    method: methode,
    headers: { "content-type": "application/json", ...enTetes },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};

const creerSignalement = async (corps = {}) =>
  api("POST", "/api/signalements", { type: "reclamation", objet: "Retard de convocation", ...corps }, A());

const creerAction = async (corps = {}) =>
  api("POST", "/api/actions-qualite", { titre: "Relancer les convocations", ...corps }, A());

// ── Migration 015 ────────────────────────────────────────────

test("migration 015 : tables cœur qualité présentes", async () => {
  for (const t of ["signalements_qualite", "actions_qualite", "signalements_qualite_causes",
                   "signalements_qualite_indicateurs", "actions_qualite_indicateurs",
                   "historique_qualite", "compteurs_qualite"]) {
    const { rowCount } = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = $1", [t]);
    assert.equal(rowCount, 1, `table ${t} absente`);
  }
});

// ── Signalements ─────────────────────────────────────────────

test("création d'une réclamation : référence REC, délai 15 j ouvrés, échéance calculée", async () => {
  const r = await creerSignalement({ date_constat: "2026-09-28", causes: ["organisation"] });
  assert.equal(r.statut, 201);
  assert.match(r.corps.signalement.reference, /^REC-\d{4}-001$/);
  assert.equal(r.corps.signalement.statut, "ouverte");
  assert.equal(r.corps.signalement.delai_cible_jours_ouvres, 15);
  assert.equal(r.corps.signalement.date_echeance_cible, "2026-10-19");
});

test("références distinctes et croissantes (concurrence simulée)", async () => {
  const a = await creerSignalement();
  const b = await creerSignalement();
  const c = await creerSignalement({ type: "incident" });
  assert.match(a.corps.signalement.reference, /^REC-2026-002$/);
  assert.match(b.corps.signalement.reference, /^REC-2026-003$/);
  assert.match(c.corps.signalement.reference, /^INC-2026-001$/);
});

test("signalement invalide : type inconnu, objet manquant, responsable inexistant", async () => {
  assert.equal((await creerSignalement({ type: "bug" })).statut, 400);
  assert.equal((await creerSignalement({ objet: "  " })).statut, 400);
  assert.equal((await creerSignalement({ responsable_id: 999999 })).statut, 400);
});

test("causes multiples normalisées dans la table de liaison", async () => {
  const r = await creerSignalement({ causes: ["communication", "logistique"] });
  const { rows } = await pool.query("SELECT cause FROM signalements_qualite_causes WHERE signalement_id = $1 ORDER BY cause", [r.corps.signalement.id]);
  assert.deepEqual(rows.map((x) => x.cause), ["communication", "logistique"]);
});

test("cause « autre » sans libellé est refusée", async () => {
  assert.equal((await creerSignalement({ causes: ["autre"] })).statut, 400);
});

test("workflow signalement : qualifier → traiter → resoudre → cloturer (avec indicateur)", async () => {
  const s = (await creerSignalement()).corps.signalement;
  const q = await api("PATCH", `/api/signalements/${s.id}/qualifier`, {}, A());
  assert.equal(q.corps.signalement.statut, "qualifiee");
  const t = await api("PATCH", `/api/signalements/${s.id}/traiter`, {}, A());
  assert.equal(t.corps.signalement.statut, "en_traitement");
  const res = await api("PATCH", `/api/signalements/${s.id}/resoudre`, { synthese_reponse: "Rappel envoyé" }, A());
  assert.equal(res.corps.signalement.statut, "resolue");
  // Clôture sans indicateur refusée.
  assert.equal((await api("PATCH", `/api/signalements/${s.id}/cloturer`, {}, A())).statut, 409);
  // Rattachement d'un indicateur puis clôture.
  const patch = await api("PATCH", `/api/signalements/${s.id}`, { indicateur_ids: [indicateurId] }, A());
  assert.equal(patch.corps.signalement.indicateurs.length, 1);
  const clot = await api("PATCH", `/api/signalements/${s.id}/cloturer`, {}, A());
  assert.equal(clot.corps.signalement.statut, "cloturee");
  assert.ok(clot.corps.signalement.date_cloture, "date de clôture posée");
});

test("réouverture et annulation d'un signalement", async () => {
  const s = (await creerSignalement()).corps.signalement;
  await api("PATCH", `/api/signalements/${s.id}/qualifier`, {}, A());
  await api("PATCH", `/api/signalements/${s.id}/annuler`, {}, A());
  assert.equal((await api("GET", `/api/signalements/${s.id}`, undefined, A())).corps.signalement.statut, "annulee");
  // Annuler un signalement annulé est refusé.
  assert.equal((await api("PATCH", `/api/signalements/${s.id}/annuler`, {}, A())).statut, 409);
});

test("listes : actives par défaut, filtres clôturés / annulés / tous", async () => {
  const s = (await creerSignalement()).corps.signalement;
  await api("PATCH", `/api/signalements/${s.id}/annuler`, {}, A());
  const actifs = await api("GET", "/api/signalements", undefined, A());
  assert.ok(actifs.corps.signalements.every((x) => x.statut !== "annulee" && x.statut !== "cloturee"));
  const annules = await api("GET", "/api/signalements?etat=annules", undefined, A());
  assert.ok(annules.corps.signalements.some((x) => x.id === s.id));
  const tous = await api("GET", "/api/signalements?etat=tous", undefined, A());
  assert.ok(tous.corps.signalements.length >= actifs.corps.signalements.length);
});

test("session incohérente avec la formation est refusée ; la formation est dérivée", async () => {
  const { rows: [f1] } = await pool.query("INSERT INTO formations (intitule, code_interne) VALUES ('F1','F1-Q1') RETURNING id");
  const { rows: [f2] } = await pool.query("INSERT INTO formations (intitule, code_interne) VALUES ('F2','F2-Q1') RETURNING id");
  await pool.query("INSERT INTO formation_versions (formation_id, numero) VALUES ($1,1)", [f1.id]);
  await pool.query("INSERT INTO formation_versions (formation_id, numero) VALUES ($1,1)", [f2.id]);
  const { rows: [sess] } = await pool.query("INSERT INTO sessions (formation_id, formation_version_id, reference, date_debut, date_fin) VALUES ($1,1,'SESS-Q1','2026-09-01','2026-12-15') RETURNING id", [f1.id]);

  // Session + formation incohérente → 400.
  assert.equal((await creerSignalement({ session_id: sess.id, formation_id: f2.id })).statut, 400);
  // Session seule → formation dérivée.
  const ok = await creerSignalement({ session_id: sess.id });
  assert.equal(ok.statut, 201);
  assert.equal(ok.corps.signalement.formation_id, f1.id);
});

// ── Actions qualité ──────────────────────────────────────────

test("création d'action : référence AQ, origine dérivée du signalement", async () => {
  const s = (await creerSignalement()).corps.signalement;
  const a = await creerAction({ signalement_id: s.id });
  assert.equal(a.statut, 201);
  assert.match(a.corps.action.reference, /^AQ-2026-001$/);
  assert.equal(a.corps.action.origine, "signalement");
  assert.equal(a.corps.action.signalement_id, s.id);
});

test("action manuelle : origine manuel", async () => {
  const a = await creerAction();
  assert.equal(a.corps.action.origine, "manuel");
  assert.equal(a.corps.action.signalement_id, null);
});

test("workflow action : demarrer → realiser → controle-efficacite → cloturer", async () => {
  const a = (await creerAction()).corps.action;
  assert.equal((await api("PATCH", `/api/actions-qualite/${a.id}/realiser`, { resultat: "x" }, A())).statut, 409, "réaliser avant démarrer refusé");
  assert.equal((await api("PATCH", `/api/actions-qualite/${a.id}/demarrer`, {}, A())).corps.action.statut, "en_cours");
  assert.equal((await api("PATCH", `/api/actions-qualite/${a.id}/realiser`, { resultat: "" }, A())).statut, 400, "résultat obligatoire");
  assert.equal((await api("PATCH", `/api/actions-qualite/${a.id}/realiser`, { resultat: "Convocations relancées" }, A())).corps.action.statut, "realisee");
  assert.equal((await api("PATCH", `/api/actions-qualite/${a.id}/controle-efficacite`, { controle_efficacite: "Vérifié par sondage", date_controle_efficacite: "2026-10-05" }, A())).corps.action.statut, "efficacite_a_verifier");
  // Clôture sans indicateur refusée.
  assert.equal((await api("PATCH", `/api/actions-qualite/${a.id}/cloturer`, {}, A())).statut, 409);
  await api("PATCH", `/api/actions-qualite/${a.id}`, { indicateur_ids: [indicateurId] }, A());
  assert.equal((await api("PATCH", `/api/actions-qualite/${a.id}/cloturer`, {}, A())).corps.action.statut, "cloturee");
});

test("réouverture et annulation d'une action", async () => {
  const a = (await creerAction()).corps.action;
  await api("PATCH", `/api/actions-qualite/${a.id}/annuler`, {}, A());
  assert.equal((await api("GET", `/api/actions-qualite/${a.id}`, undefined, A())).corps.action.statut, "annulee");
  assert.equal((await api("PATCH", `/api/actions-qualite/${a.id}/annuler`, {}, A())).statut, 409);
});

// ── RBAC ─────────────────────────────────────────────────────

test("contributeur : aucun accès aux signalements", async () => {
  const s = (await creerSignalement()).corps.signalement;
  assert.equal((await api("GET", "/api/signalements", undefined, C())).statut, 403);
  assert.equal((await api("GET", `/api/signalements/${s.id}`, undefined, C())).statut, 403);
  assert.equal((await api("POST", "/api/signalements", { type: "reclamation", objet: "x" }, C())).statut, 403);
});

test("contributeur : ne voit que ses actions, ne peut ni créer ni assigner ni clôturer", async () => {
  const aAutre = (await creerAction()).corps.action;                 // non assignée
  const aSienne = (await creerAction({ responsable_id: contribId })).corps.action;
  const liste = await api("GET", "/api/actions-qualite", undefined, C());
  assert.equal(liste.statut, 200);
  assert.ok(liste.corps.actions.every((x) => x.responsable_id === contribId), "seulement ses actions");
  assert.equal((await api("GET", `/api/actions-qualite/${aAutre.id}`, undefined, C())).statut, 403);
  assert.equal((await api("POST", "/api/actions-qualite", { titre: "x" }, C())).statut, 403);
  assert.equal((await api("PATCH", `/api/actions-qualite/${aSienne.id}`, { responsable_id: adminId }, C())).statut, 403);
  assert.equal((await api("PATCH", `/api/actions-qualite/${aSienne.id}/cloturer`, {}, C())).statut, 403);
});

test("contributeur : peut démarrer et réaliser SON action", async () => {
  const a = (await creerAction({ responsable_id: contribId })).corps.action;
  assert.equal((await api("PATCH", `/api/actions-qualite/${a.id}/demarrer`, {}, C())).statut, 200);
  const r = await api("PATCH", `/api/actions-qualite/${a.id}/realiser`, { resultat: "Fait" }, C());
  assert.equal(r.statut, 200);
  assert.equal(r.corps.action.statut, "realisee");
});

// ── Confidentialité ──────────────────────────────────────────

test("pas de fuite d'identité réclamant vers le contributeur", async () => {
  const s = (await creerSignalement({
    objet: "Réclamation confidentielle",
    description: "données sensibles internes",
    reclamant_nom: "John Doe",
    reclamant_email: "john@exemple.fr",
  })).corps.signalement;
  const a = (await creerAction({ signalement_id: s.id, responsable_id: contribId })).corps.action;
  const vue = (await api("GET", `/api/actions-qualite/${a.id}`, undefined, C())).corps.action;
  assert.equal(vue.signalement_reference, s.reference, "libellé neutre présent");
  assert.ok(!("signalement_objet" in vue), "pas d'objet exposé");
  const brut = JSON.stringify(vue);
  assert.ok(!brut.includes("John Doe"), "identité non exposée");
  assert.ok(!brut.includes("données sensibles internes"), "texte sensible non exposé");
  assert.ok(!brut.includes("john@exemple.fr"), "e-mail non exposé");
});

// ── Historique ───────────────────────────────────────────────

test("historique append-only : création, statuts, rattachement d'indicateur", async () => {
  const s = (await creerSignalement()).corps.signalement;
  await api("PATCH", `/api/signalements/${s.id}/qualifier`, {}, A());
  await api("PATCH", `/api/signalements/${s.id}`, { indicateur_ids: [indicateurId] }, A());
  const { rows } = await pool.query("SELECT evenement, champ FROM historique_qualite WHERE entite_type = 'signalement' AND entite_id = $1 ORDER BY id", [s.id]);
  const evenements = rows.map((r) => `${r.evenement}:${r.champ}`);
  assert.ok(evenements.includes("creation:statut"));
  assert.ok(evenements.includes("qualifier:statut"));
  assert.ok(evenements.includes("rattachement_indicateur:indicateur_id"));
});

test("l'historique ne recopie pas le contenu sensible", async () => {
  const s = (await creerSignalement({ description: "secret médical" })).corps.signalement;
  await api("PATCH", `/api/signalements/${s.id}`, { description: "autre chose" }, A());
  const { rows } = await pool.query("SELECT * FROM historique_qualite WHERE entite_id = $1 AND champ = 'description'", [s.id]);
  assert.ok(rows.length > 0, "modification tracée");
  assert.ok(rows.every((r) => r.ancienne_valeur === null && r.nouvelle_valeur === null), "contenu jamais recopié");
});

// ── Non-régression : revue Q1-B1-R ───────────────────────────

const numeroDe = (reference) => Number((reference || "").split("-").pop());

test("dates invalides sur les transitions → 400, jamais 500", async () => {
  const s = (await creerSignalement()).corps.signalement;
  await api("PATCH", `/api/signalements/${s.id}/qualifier`, {}, A());
  await api("PATCH", `/api/signalements/${s.id}/traiter`, {}, A());
  assert.equal((await api("PATCH", `/api/signalements/${s.id}/resoudre`, { date_resolution: "2026-13-40" }, A())).statut, 400);
  assert.equal((await api("PATCH", `/api/signalements/${s.id}/resoudre`, { date_reponse: "demain" }, A())).statut, 400);

  const a = (await creerAction({ responsable_id: adminId })).corps.action;
  await api("PATCH", `/api/actions-qualite/${a.id}/demarrer`, {}, A());
  assert.equal((await api("PATCH", `/api/actions-qualite/${a.id}/realiser`, { resultat: "x", date_mise_en_oeuvre: "32/01/2026" }, A())).statut, 400);
});

test("session archivée : lien signalement et action autorisés, session inchangée", async () => {
  const { rows: [f] } = await pool.query("INSERT INTO formations (intitule, code_interne) VALUES ('F-ARCH','F-ARCH') RETURNING id");
  await pool.query("INSERT INTO formation_versions (formation_id, numero) VALUES ($1,1)", [f.id]);
  const { rows: [sess] } = await pool.query(
    "INSERT INTO sessions (formation_id, formation_version_id, reference, date_debut, date_fin, statut, archivee_le) VALUES ($1,1,'SESS-ARCH','2026-01-01','2026-03-01','terminee', now()) RETURNING id", [f.id]);
  const s = await creerSignalement({ session_id: sess.id });
  assert.equal(s.statut, 201);
  assert.equal(s.corps.signalement.session_id, sess.id);
  const a = await creerAction({ session_id: sess.id });
  assert.equal(a.statut, 201);
  const { rows: [apres] } = await pool.query("SELECT archivee_le FROM sessions WHERE id = $1", [sess.id]);
  assert.ok(apres.archivee_le, "la session reste archivée, non modifiée");
});

test("inscription : dérive la session, refuse une session incohérente", async () => {
  const { rows: [f] } = await pool.query("INSERT INTO formations (intitule, code_interne) VALUES ('F-INS','F-INS') RETURNING id");
  await pool.query("INSERT INTO formation_versions (formation_id, numero) VALUES ($1,1)", [f.id]);
  const { rows: [s1] } = await pool.query("INSERT INTO sessions (formation_id, formation_version_id, reference, date_debut, date_fin) VALUES ($1,1,'S1','2026-01-01','2026-02-01') RETURNING id", [f.id]);
  const { rows: [s2] } = await pool.query("INSERT INTO sessions (formation_id, formation_version_id, reference, date_debut, date_fin) VALUES ($1,1,'S2','2026-02-02','2026-03-01') RETURNING id", [f.id]);
  const { rows: [stag] } = await pool.query("INSERT INTO stagiaires (nom, prenom) VALUES ('Martin','Alice') RETURNING id");
  const { rows: [ins] } = await pool.query("INSERT INTO inscriptions (stagiaire_id, session_id) VALUES ($1,$2) RETURNING id", [stag.id, s1.id]);
  // Inscription seule → session dérivée.
  const ok = await creerSignalement({ inscription_id: ins.id });
  assert.equal(ok.statut, 201);
  assert.equal(ok.corps.signalement.session_id, s1.id);
  // Inscription + session incohérente → 400.
  assert.equal((await creerSignalement({ inscription_id: ins.id, session_id: s2.id })).statut, 400);
});

test("références : 20 créations parallèles par type, aucune collision", async () => {
  const feux = [];
  for (let i = 0; i < 20; i++) {
    feux.push(creerAction(), creerSignalement({ type: "reclamation" }), creerSignalement({ type: "incident" }), creerSignalement({ type: "non_conformite" }));
  }
  const reponses = await Promise.all(feux);
  assert.ok(reponses.every((r) => r.statut === 201), "toutes les créations réussissent");
  const refs = reponses.map((r) => (r.corps.action || r.corps.signalement).reference);
  assert.equal(new Set(refs).size, refs.length, "toutes les références sont uniques");
  assert.ok(refs.every((x) => /^(AQ|REC|INC|NC)-\d{4}-\d{3}$/.test(x)), "format correct");
});

test("références : un échec de création ne consomme pas de numéro", async () => {
  const a = (await creerSignalement()).corps.signalement;
  const n1 = numeroDe(a.reference);
  assert.equal((await creerSignalement({ responsable_id: 999999 })).statut, 400, "échec (responsable inexistant)");
  const b = (await creerSignalement()).corps.signalement;
  assert.equal(numeroDe(b.reference), n1 + 1, "numéros contigus malgré l'échec intermédiaire");
});

test("responsable inactif refusé ; suppression d'un utilisateur sans perte d'historique", async () => {
  const { rows: [inactif] } = await pool.query("INSERT INTO utilisateurs (email, nom, role, actif) VALUES ('off@q1.local','Off', 'contributeur', false) RETURNING id");
  assert.equal((await creerAction({ responsable_id: inactif.id })).statut, 400);

  const { rows: [util] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('resp@q1.local','Resp','contributeur') RETURNING id");
  const a = (await creerAction({ responsable_id: util.id })).corps.action;
  await pool.query("INSERT INTO historique_qualite (entite_type, entite_id, evenement, par) VALUES ('action', $1, 'test-par', $2)", [a.id, util.id]);
  await pool.query("DELETE FROM utilisateurs WHERE id = $1", [util.id]);
  const { rows: [apres] } = await pool.query("SELECT responsable_id FROM actions_qualite WHERE id = $1", [a.id]);
  assert.equal(apres.responsable_id, null, "responsable_id SET NULL, pas de cascade");
  const { rows: [ev] } = await pool.query("SELECT par FROM historique_qualite WHERE entite_id = $1 AND evenement = 'test-par'", [a.id]);
  assert.equal(ev.par, null, "le journal survit (par SET NULL)");
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM historique_qualite WHERE entite_type = 'action' AND entite_id = $1", [a.id]);
  assert.ok(n > 0, "l'historique de l'action est conservé");
});

test("recherche contributeur : ne révèle pas un réclamant", async () => {
  const s = (await creerSignalement({ reclamant_nom: "Jean Secret", objet: "Dossier sensible" })).corps.signalement;
  await creerAction({ signalement_id: s.id, responsable_id: contribId, titre: "Relancer unique-zeta" });
  const fuite = await api("GET", "/api/actions-qualite?q=Secret", undefined, C());
  assert.equal(fuite.corps.actions.length, 0, "le nom du réclamant ne révèle aucune action");
  const legitime = await api("GET", "/api/actions-qualite?q=unique-zeta", undefined, C());
  assert.equal(legitime.corps.actions.length, 1, "la recherche sur le titre de l'action fonctionne");
});

test("cause « autre » retirée : le libellé explicatif est purgé", async () => {
  const s = (await creerSignalement({ causes: ["autre"], cause_autre_libelle: "matériel défaillant" })).corps.signalement;
  assert.equal(s.cause_autre_libelle, "matériel défaillant");
  const patch = await api("PATCH", `/api/signalements/${s.id}`, { causes: ["organisation"] }, A());
  assert.equal(patch.corps.signalement.cause_autre_libelle, null);
  const { rows } = await pool.query("SELECT cause FROM signalements_qualite_causes WHERE signalement_id = $1", [s.id]);
  assert.deepEqual(rows.map((r) => r.cause), ["organisation"]);
});

test("cohérence origine / signalement_id garantie par la base (CHECK)", async () => {
  const s = (await creerSignalement()).corps.signalement;
  const a = (await creerAction({ signalement_id: s.id })).corps.action;
  assert.equal(a.origine, "signalement");
  await assert.rejects(
    pool.query("UPDATE actions_qualite SET origine = 'manuel' WHERE id = $1", [a.id]),
    /check|violation/i,
    "une origine incohérente avec signalement_id est refusée par PostgreSQL"
  );
});

test("installation existante 001→014 + données : 015 appliquée sans perte, preuves intactes", async () => {
  const racine = cluster.getPgClient("postgres");
  await racine.connect();
  await racine.query("CREATE DATABASE vq_pre");
  await racine.end();
  const p = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/vq_pre`, ssl: false });
  await appliquerJusqua(p, 14);
  const { rows: [f] } = await p.query("INSERT INTO formations (intitule, code_interne) VALUES ('F-PRE','PRE-1') RETURNING id");
  await p.query("INSERT INTO formation_versions (formation_id, numero) VALUES ($1,1)", [f.id]);
  await p.query("INSERT INTO sessions (formation_id, formation_version_id, reference, date_debut, date_fin) VALUES ($1,1,'SESS-PRE','2026-01-01','2026-06-30')", [f.id]);

  setPoolFactory(() => p);
  const appliquees = await migrate({ log: () => {} });
  setPoolFactory(() => pool);
  assert.deepEqual(appliquees.map((m) => m.slice(0, 3)), ["015"]);

  const { rows: [{ n }] } = await p.query("SELECT count(*)::int AS n FROM sessions WHERE reference = 'SESS-PRE'");
  assert.equal(n, 1, "la session antérieure a survécu à 015");
  const { rows: [col] } = await p.query("SELECT is_nullable FROM information_schema.columns WHERE table_name='preuves' AND column_name='indicateur_id'");
  assert.equal(col.is_nullable, "NO", "preuves.indicateur_id reste NOT NULL");
  const { rowCount } = await p.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'actions_qualite'");
  assert.equal(rowCount, 1, "actions_qualite créée");
  await p.end();
});
