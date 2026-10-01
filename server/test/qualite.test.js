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

const PORT = 55447; // distinct de transversal (55445, et 55446 = son serveur réel PORT + 1)
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

test("installation existante 001→014 + données : 015 à 018 appliquées sans perte, preuves intactes", async () => {
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
  assert.deepEqual(appliquees.map((m) => m.slice(0, 3)), ["015", "016", "017", "018"]);

  const { rows: [{ n }] } = await p.query("SELECT count(*)::int AS n FROM sessions WHERE reference = 'SESS-PRE'");
  assert.equal(n, 1, "la session antérieure a survécu à 015");
  const { rows: [col] } = await p.query("SELECT is_nullable FROM information_schema.columns WHERE table_name='preuves' AND column_name='indicateur_id'");
  assert.equal(col.is_nullable, "NO", "preuves.indicateur_id reste NOT NULL");
  const { rowCount } = await p.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'actions_qualite'");
  assert.equal(rowCount, 1, "actions_qualite créée");
  await p.end();
});

// ── Acteurs lisibles + utilisateurs actifs (Q1-B2A) ──────────

test("GET /api/utilisateurs : admin 200, contributeur 403, anonyme 401", async () => {
  assert.equal((await api("GET", "/api/utilisateurs", undefined, C())).statut, 403);
  assert.equal((await api("GET", "/api/utilisateurs")).statut, 401);
  const r = await api("GET", "/api/utilisateurs", undefined, A());
  assert.equal(r.statut, 200);
  assert.ok(Array.isArray(r.corps.utilisateurs));
});

test("GET /api/utilisateurs : actifs uniquement, champs minimaux, tri", async () => {
  const { rows: [inactif] } = await pool.query("INSERT INTO utilisateurs (email, nom, role, actif) VALUES ('off2@q1.local','Off Deux','contributeur', false) RETURNING id");
  const r = await api("GET", "/api/utilisateurs", undefined, A());
  const courriels = r.corps.utilisateurs.map((u) => u.email);
  assert.ok(courriels.includes("admin@q1.local") && courriels.includes("contrib@q1.local"));
  assert.ok(!courriels.includes("off2@q1.local"), "inactif exclu");
  const u = r.corps.utilisateurs.find((x) => x.id === adminId);
  assert.deepEqual(Object.keys(u).sort(), ["email", "id", "nom", "role"], "aucun champ sensible (google_sub…)");
  const noms = r.corps.utilisateurs.map((x) => x.nom);
  assert.deepEqual(noms, [...noms].sort(), "tri par nom stable");
  await pool.query("DELETE FROM utilisateurs WHERE id = $1", [inactif.id]);
});

test("actions : noms lisibles (responsable, créateur, clôture)", async () => {
  const a = (await creerAction({ responsable_id: contribId })).corps.action;
  // Liste admin enrichie.
  const liste = await api("GET", "/api/actions-qualite", undefined, A());
  const ligne = liste.corps.actions.find((x) => x.id === a.id);
  assert.equal(ligne.responsable_nom, "Tukui");
  assert.equal(ligne.cree_par_nom, "Mme Stark");
  // Détail admin enrichi.
  const detail = (await api("GET", `/api/actions-qualite/${a.id}`, undefined, A())).corps.action;
  assert.equal(detail.responsable_nom, "Tukui");
  assert.equal(detail.cree_par_nom, "Mme Stark");
  // Clôture → cloture_par_nom.
  await api("PATCH", `/api/actions-qualite/${a.id}/demarrer`, {}, A());
  await api("PATCH", `/api/actions-qualite/${a.id}/realiser`, { resultat: "Fait" }, A());
  await api("PATCH", `/api/actions-qualite/${a.id}/controle-efficacite`, { controle_efficacite: "OK", date_controle_efficacite: "2026-10-01" }, A());
  await api("PATCH", `/api/actions-qualite/${a.id}`, { indicateur_ids: [indicateurId] }, A());
  await api("PATCH", `/api/actions-qualite/${a.id}/cloturer`, {}, A());
  const clot = (await api("GET", `/api/actions-qualite/${a.id}`, undefined, A())).corps.action;
  assert.equal(clot.cloture_par_nom, "Mme Stark");
});

test("utilisateur désactivé après assignation : l'action reste lisible", async () => {
  const { rows: [util] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('resp2@q1.local','Resp Deux','contributeur') RETURNING id");
  const a = (await creerAction({ responsable_id: util.id })).corps.action;
  await pool.query("UPDATE utilisateurs SET actif = false WHERE id = $1", [util.id]);
  const detail = (await api("GET", `/api/actions-qualite/${a.id}`, undefined, A())).corps.action;
  assert.equal(detail.responsable_nom, "Resp Deux", "nom conservé malgré la désactivation");
  await pool.query("DELETE FROM utilisateurs WHERE id = $1", [util.id]);
});

test("utilisateur supprimé : absence de responsable affichée proprement", async () => {
  const { rows: [util] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('resp3@q1.local','Resp Trois','contributeur') RETURNING id");
  const a = (await creerAction({ responsable_id: util.id })).corps.action;
  await pool.query("DELETE FROM utilisateurs WHERE id = $1", [util.id]);
  const detail = (await api("GET", `/api/actions-qualite/${a.id}`, undefined, A())).corps.action;
  assert.equal(detail.responsable_id, null);
  assert.equal(detail.responsable_nom, null);
});

test("contributeur : voit le nom du responsable de SON action, pas la liste utilisateurs", async () => {
  const a = (await creerAction({ responsable_id: contribId })).corps.action;
  const vue = (await api("GET", `/api/actions-qualite/${a.id}`, undefined, C())).corps.action;
  assert.equal(vue.responsable_nom, "Tukui");
  assert.equal((await api("GET", "/api/utilisateurs", undefined, C())).statut, 403);
});

test("historique : acteur lisible et aucune donnée réclamant", async () => {
  const s = (await creerSignalement({ reclamant_nom: "Jane Roe", objet: "Confidentiel" })).corps.signalement;
  const a = (await creerAction({ signalement_id: s.id, responsable_id: contribId })).corps.action;
  const detail = await api("GET", `/api/actions-qualite/${a.id}`, undefined, A());
  assert.ok(Array.isArray(detail.corps.historique));
  const creation = detail.corps.historique.find((h) => h.evenement === "creation");
  assert.equal(creation.acteur_nom, "Mme Stark", "auteur lisible");
  const brut = JSON.stringify(detail.corps.historique);
  assert.ok(!brut.includes("Jane Roe"), "aucune donnée réclamant dans l'historique");
});

// ── Q1-B3-B2-API : PATCH partiel, historique et noms du détail ─────
// Absence d'un champ de collection = collection INCHANGÉE ; liste vide
// explicite = vidage volontaire.

async function deuxIndicateurs() {
  const { rows } = await pool.query("SELECT id FROM indicateurs ORDER BY id LIMIT 2");
  return rows.map((r) => r.id);
}
const causesDe = async (id) =>
  (await pool.query("SELECT cause FROM signalements_qualite_causes WHERE signalement_id = $1 ORDER BY cause", [id])).rows.map((r) => r.cause);
const indicateursDe = async (table, colonne, id) =>
  (await pool.query(`SELECT indicateur_id FROM ${table} WHERE ${colonne} = $1 ORDER BY indicateur_id`, [id])).rows.map((r) => r.indicateur_id);
const evenementsDe = async (type, id) =>
  (await pool.query("SELECT evenement, champ FROM historique_qualite WHERE entite_type = $1 AND entite_id = $2 ORDER BY id", [type, id])).rows
    .map((r) => `${r.evenement}:${r.champ}`);

test("PATCH partiel signalement : causes, libellé « autre » et indicateurs conservés", async () => {
  const [i1, i2] = await deuxIndicateurs();
  const s = (await creerSignalement({
    causes: ["organisation", "autre"], cause_autre_libelle: "salle indisponible",
    indicateur_ids: [i1, i2], responsable_id: contribId,
  })).corps.signalement;
  const avantEvts = await evenementsDe("signalement", s.id);

  const patch = await api("PATCH", `/api/signalements/${s.id}`, { responsable_id: adminId }, A());
  assert.equal(patch.statut, 200);
  assert.equal(patch.corps.signalement.responsable_id, adminId, "responsable modifié");
  assert.deepEqual(await causesDe(s.id), ["autre", "organisation"], "causes strictement conservées");
  assert.equal(patch.corps.signalement.cause_autre_libelle, "salle indisponible", "libellé « autre » conservé");
  assert.deepEqual(await indicateursDe("signalements_qualite_indicateurs", "signalement_id", s.id), [i1, i2].sort((a, b) => a - b), "indicateurs conservés");

  const nouveaux = (await evenementsDe("signalement", s.id)).slice(avantEvts.length);
  assert.deepEqual(nouveaux, ["modification:responsable_id"], "seul le responsable est journalisé (ni retrait d'indicateur, ni causes)");
});

test("PATCH explicite causes=[] vide les causes et purge le libellé « autre »", async () => {
  const s = (await creerSignalement({ causes: ["pedagogie", "autre"], cause_autre_libelle: "horaires" })).corps.signalement;
  const patch = await api("PATCH", `/api/signalements/${s.id}`, { causes: [] }, A());
  assert.equal(patch.statut, 200);
  assert.deepEqual(await causesDe(s.id), []);
  assert.equal(patch.corps.signalement.cause_autre_libelle, null);
});

test("PATCH explicite indicateur_ids=[] vide les indicateurs (retrait journalisé)", async () => {
  const [i1] = await deuxIndicateurs();
  const s = (await creerSignalement({ indicateur_ids: [i1] })).corps.signalement;
  const patch = await api("PATCH", `/api/signalements/${s.id}`, { indicateur_ids: [] }, A());
  assert.equal(patch.statut, 200);
  assert.deepEqual(await indicateursDe("signalements_qualite_indicateurs", "signalement_id", s.id), []);
  assert.ok((await evenementsDe("signalement", s.id)).includes("retrait_indicateur:indicateur_id"));
});

test("« autre » : explicitement retiré ⇒ libellé purgé ; renvoyé sans libellé ⇒ 400, rien n'est modifié", async () => {
  const s = (await creerSignalement({ causes: ["autre", "logistique"], cause_autre_libelle: "transport" })).corps.signalement;
  const refus = await api("PATCH", `/api/signalements/${s.id}`, { causes: ["autre"] }, A());
  assert.equal(refus.statut, 400, "validation existante conservée");
  assert.deepEqual(await causesDe(s.id), ["autre", "logistique"], "refus : causes intactes");
  const retrait = await api("PATCH", `/api/signalements/${s.id}`, { causes: ["logistique"] }, A());
  assert.equal(retrait.statut, 200);
  assert.deepEqual(await causesDe(s.id), ["logistique"]);
  assert.equal(retrait.corps.signalement.cause_autre_libelle, null);
});

test("PATCH partiel action : priorité modifiée, indicateurs conservés", async () => {
  const [i1, i2] = await deuxIndicateurs();
  const a = (await creerAction({ indicateur_ids: [i1, i2] })).corps.action;
  const patch = await api("PATCH", `/api/actions-qualite/${a.id}`, { priorite: "haute" }, A());
  assert.equal(patch.statut, 200);
  assert.equal(patch.corps.action.priorite, "haute");
  assert.deepEqual(await indicateursDe("actions_qualite_indicateurs", "action_id", a.id), [i1, i2].sort((x, y) => x - y), "indicateurs conservés");
  assert.ok(!(await evenementsDe("action", a.id)).includes("retrait_indicateur:indicateur_id"), "aucun faux retrait");
});

test("PATCH explicite action indicateur_ids=[] vide les indicateurs", async () => {
  const [i1] = await deuxIndicateurs();
  const a = (await creerAction({ indicateur_ids: [i1] })).corps.action;
  assert.equal((await api("PATCH", `/api/actions-qualite/${a.id}`, { indicateur_ids: [] }, A())).statut, 200);
  assert.deepEqual(await indicateursDe("actions_qualite_indicateurs", "action_id", a.id), []);
});

test("création sans cause : aucun faux événement « modification des causes »", async () => {
  const s = (await creerSignalement()).corps.signalement;
  const evts = await evenementsDe("signalement", s.id);
  assert.deepEqual(evts, ["creation:statut"]);
  const avecCauses = (await creerSignalement({ causes: ["communication"] })).corps.signalement;
  assert.ok((await evenementsDe("signalement", avecCauses.id)).includes("creation:statut"));
  assert.deepEqual(await causesDe(avecCauses.id), ["communication"], "création avec causes inchangée");
});

test("GET détail : historique chronologique avec acteur lisible", async () => {
  const [i1] = await deuxIndicateurs();
  const s = (await creerSignalement()).corps.signalement;
  await api("PATCH", `/api/signalements/${s.id}/qualifier`, {}, A());
  await api("PATCH", `/api/signalements/${s.id}`, { indicateur_ids: [i1] }, A());
  await api("PATCH", `/api/signalements/${s.id}/traiter`, {}, A());
  const d = await api("GET", `/api/signalements/${s.id}`, undefined, A());
  assert.equal(d.statut, 200);
  assert.deepEqual(Object.keys(d.corps).sort(), ["actions", "historique", "preuves", "signalement"]);
  const h = d.corps.historique;
  assert.deepEqual(h.map((e) => e.evenement), ["creation", "qualifier", "rattachement_indicateur", "traiter"], "ordre chronologique");
  assert.ok(h.every((e, i) => i === 0 || e.id > h[i - 1].id), "trié par id croissant");
  assert.ok(h.every((e) => e.acteur_nom === "Mme Stark" && e.par === adminId), "acteur lisible et identifiant conservé");
  const q = h.find((e) => e.evenement === "qualifier");
  assert.equal(q.ancienne_valeur, "ouverte");
  assert.equal(q.nouvelle_valeur, "qualifiee");
  assert.equal(h.find((e) => e.evenement === "rattachement_indicateur").nouvelle_valeur, String(i1), "identifiant d'indicateur conservé tel quel");
  assert.ok(h.every((e) => e.cree_le), "horodatage présent");
});

test("GET détail : noms du responsable, de l'auteur, de la clôture et de l'annulation", async () => {
  const [i1] = await deuxIndicateurs();
  const s = (await creerSignalement({ responsable_id: contribId, indicateur_ids: [i1] })).corps.signalement;
  let d = (await api("GET", `/api/signalements/${s.id}`, undefined, A())).corps.signalement;
  assert.equal(d.responsable_id, contribId);
  assert.equal(d.responsable_nom, "Tukui");
  assert.equal(d.cree_par, adminId);
  assert.equal(d.cree_par_nom, "Mme Stark");
  assert.equal(d.cloture_par_nom, null);
  assert.equal(d.annulee_par_nom, null);
  for (const t of ["qualifier", "traiter", "resoudre", "cloturer"]) await api("PATCH", `/api/signalements/${s.id}/${t}`, {}, A());
  d = (await api("GET", `/api/signalements/${s.id}`, undefined, A())).corps.signalement;
  assert.equal(d.cloture_par_nom, "Mme Stark");

  const s2 = (await creerSignalement()).corps.signalement;
  await api("PATCH", `/api/signalements/${s2.id}/annuler`, {}, A());
  const d2 = (await api("GET", `/api/signalements/${s2.id}`, undefined, A())).corps.signalement;
  assert.equal(d2.annulee_par, adminId);
  assert.equal(d2.annulee_par_nom, "Mme Stark");
  assert.equal(d2.responsable_nom, null, "sans responsable : null");
});

test("utilisateur désactivé : son nom reste visible dans le détail et l'historique", async () => {
  const { rows: [ancien] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('ancien@q1.local','Mme Ancienne','admin') RETURNING id");
  const cAncien = () => ({ cookie: cookie(ancien.id) });
  const s = (await api("POST", "/api/signalements", { type: "incident", objet: "Panne", responsable_id: ancien.id }, cAncien())).corps.signalement;
  await api("PATCH", `/api/signalements/${s.id}/qualifier`, {}, cAncien());
  await pool.query("UPDATE utilisateurs SET actif = false WHERE id = $1", [ancien.id]);

  const d = await api("GET", `/api/signalements/${s.id}`, undefined, A());
  assert.equal(d.corps.signalement.responsable_nom, "Mme Ancienne");
  assert.equal(d.corps.signalement.cree_par_nom, "Mme Ancienne");
  assert.ok(d.corps.historique.length >= 2 && d.corps.historique.every((e) => e.acteur_nom === "Mme Ancienne"));
  const actifs = (await api("GET", "/api/utilisateurs", undefined, A())).corps.utilisateurs;
  assert.ok(!actifs.some((u) => u.id === ancien.id), "/api/utilisateurs reste limité aux actifs");
});

test("historique du détail : aucun contenu sensible recopié", async () => {
  const sensibles = {
    description: "Description très-confidentielle-A", reclamant_nom: "Réclamant-Secret-B",
    reclamant_email: "secret-c@exemple.fr", reclamant_entreprise: "Entreprise-Secrète-D",
    personne_concernee_libelle: "Personne-Secrète-E",
  };
  const s = (await creerSignalement(sensibles)).corps.signalement;
  await api("PATCH", `/api/signalements/${s.id}`, {
    description: "Nouvelle-description-F", reclamant_nom: "Réclamant-G", reclamant_email: "g@exemple.fr",
    reclamant_entreprise: "Entreprise-H", personne_concernee_libelle: "Personne-I", synthese_reponse: "Réponse-J",
  }, A());
  for (const t of ["qualifier", "traiter"]) await api("PATCH", `/api/signalements/${s.id}/${t}`, {}, A());
  await api("PATCH", `/api/signalements/${s.id}/resoudre`, { synthese_reponse: "Réponse-finale-K" }, A());
  const h = (await api("GET", `/api/signalements/${s.id}`, undefined, A())).corps.historique;
  const brut = JSON.stringify(h);
  for (const v of [...Object.values(sensibles), "Nouvelle-description-F", "Réclamant-G", "g@exemple.fr", "Entreprise-H", "Personne-I", "Réponse-J", "Réponse-finale-K"]) {
    assert.ok(!brut.includes(v), `contenu absent : ${v}`);
  }
  const modifs = h.filter((e) => e.evenement === "modification");
  for (const champ of ["description", "reclamant_nom", "reclamant_email", "reclamant_entreprise", "personne_concernee_libelle", "synthese_reponse"]) {
    const e = modifs.find((m) => m.champ === champ);
    assert.ok(e, `modification de ${champ} tracée`);
    assert.equal(e.ancienne_valeur, null);
    assert.equal(e.nouvelle_valeur, null);
  }
});

test("contributeur : détail signalement (avec historique) toujours refusé", async () => {
  const s = (await creerSignalement()).corps.signalement;
  const r = await api("GET", `/api/signalements/${s.id}`, undefined, C());
  assert.equal(r.statut, 403);
  assert.ok(!JSON.stringify(r.corps).includes("historique"));
});

// ── Q1-B3-B2-API-FINAL : invariants avant la fiche B2 ─────────────

const etatSignalement = async (id) => {
  const { rows: [s] } = await pool.query("SELECT statut, date_resolution, cause_autre_libelle, responsable_id, description FROM signalements_qualite WHERE id = $1", [id]);
  return { ...s, causes: await causesDe(id), indicateurs: await indicateursDe("signalements_qualite_indicateurs", "signalement_id", id) };
};

test("date_resolution : refusée par le PATCH général (400), rien n'est modifié", async () => {
  const s = (await creerSignalement({ description: "Avant" })).corps.signalement;
  await api("PATCH", `/api/signalements/${s.id}/qualifier`, {}, A());
  await api("PATCH", `/api/signalements/${s.id}/traiter`, {}, A());
  const avant = await etatSignalement(s.id);
  const r = await api("PATCH", `/api/signalements/${s.id}`, { date_resolution: "2026-09-30" }, A());
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /Résoudre/);
  const combine = await api("PATCH", `/api/signalements/${s.id}`, { description: "Après", date_resolution: "2026-09-30" }, A());
  assert.equal(combine.statut, 400, "même combiné à un champ valide");
  assert.deepEqual(await etatSignalement(s.id), avant, "statut et données inchangés");
  assert.equal(avant.statut, "en_traitement");
  assert.equal(avant.date_resolution, null);
});

test("date_resolution : toujours renseignée par /resoudre ; réponse éditable avant résolution", async () => {
  const s = (await creerSignalement()).corps.signalement;
  const rep = await api("PATCH", `/api/signalements/${s.id}`, { synthese_reponse: "Réponse", date_reponse: "2026-09-29" }, A());
  assert.equal(rep.statut, 200, "réponse et date de réponse éditables avant résolution");
  for (const t of ["qualifier", "traiter"]) await api("PATCH", `/api/signalements/${s.id}/${t}`, {}, A());
  const r = await api("PATCH", `/api/signalements/${s.id}/resoudre`, { date_resolution: "2026-09-30" }, A());
  assert.equal(r.statut, 200);
  assert.equal(r.corps.signalement.statut, "resolue");
  assert.equal(String(r.corps.signalement.date_resolution).slice(0, 10), "2026-09-30");
});

test("« autre » : libellé vidé alors que « autre » reste présent ⇒ 400, rien n'est modifié", async () => {
  const s = (await creerSignalement({ causes: ["autre"], cause_autre_libelle: "Salle trop petite" })).corps.signalement;
  for (const vide of ["", null, "   "]) {
    const r = await api("PATCH", `/api/signalements/${s.id}`, { cause_autre_libelle: vide }, A());
    assert.equal(r.statut, 400, `libellé ${JSON.stringify(vide)} refusé`);
  }
  const combine = await api("PATCH", `/api/signalements/${s.id}`, { description: "X", cause_autre_libelle: "" }, A());
  assert.equal(combine.statut, 400, "aucune modification partielle");
  const e = await etatSignalement(s.id);
  assert.deepEqual(e.causes, ["autre"]);
  assert.equal(e.cause_autre_libelle, "Salle trop petite");
  assert.equal(e.description, null, "le champ valide du même PATCH n'est pas appliqué");
});

test("« autre » : libellé envoyé sans cause « autre » ⇒ 400, aucun libellé orphelin", async () => {
  const s = (await creerSignalement({ causes: ["organisation"] })).corps.signalement;
  const r = await api("PATCH", `/api/signalements/${s.id}`, { cause_autre_libelle: "Texte orphelin" }, A());
  assert.equal(r.statut, 400);
  const retraitEtLibelle = await api("PATCH", `/api/signalements/${s.id}`, { causes: ["pedagogie"], cause_autre_libelle: "Texte orphelin" }, A());
  assert.equal(retraitEtLibelle.statut, 400, "liste finale sans « autre » + libellé : incohérent");
  const e = await etatSignalement(s.id);
  assert.deepEqual(e.causes, ["organisation"]);
  assert.equal(e.cause_autre_libelle, null);
  const creation = (await creerSignalement({ causes: ["logistique"], cause_autre_libelle: "Orphelin à la création" })).corps.signalement;
  assert.equal((await etatSignalement(creation.id)).cause_autre_libelle, null, "création : jamais de libellé orphelin persisté");
});

test("« autre » : règles effectives (inchangé, modification du libellé, ajout, retrait)", async () => {
  const s = (await creerSignalement({ causes: ["autre"], cause_autre_libelle: "Salle trop petite" })).corps.signalement;
  assert.equal((await api("PATCH", `/api/signalements/${s.id}`, { responsable_id: contribId }, A())).statut, 200);
  assert.equal((await etatSignalement(s.id)).cause_autre_libelle, "Salle trop petite", "A. rien d'autre ne change");
  assert.equal((await api("PATCH", `/api/signalements/${s.id}`, { cause_autre_libelle: "Salle bruyante" }, A())).statut, 200);
  assert.equal((await etatSignalement(s.id)).cause_autre_libelle, "Salle bruyante", "libellé modifiable s'il reste non vide");
  assert.equal((await api("PATCH", `/api/signalements/${s.id}`, { causes: ["organisation"] }, A())).statut, 200);
  let e = await etatSignalement(s.id);
  assert.deepEqual(e.causes, ["organisation"]);
  assert.equal(e.cause_autre_libelle, null, "D. retrait de « autre » ⇒ libellé purgé");
  assert.equal((await api("PATCH", `/api/signalements/${s.id}`, { causes: ["organisation", "autre"] }, A())).statut, 400, "E. ajout sans libellé refusé");
  assert.equal((await api("PATCH", `/api/signalements/${s.id}`, { causes: ["organisation", "autre"], cause_autre_libelle: "Matériel" }, A())).statut, 200);
  e = await etatSignalement(s.id);
  assert.deepEqual(e.causes, ["autre", "organisation"]);
  assert.equal(e.cause_autre_libelle, "Matériel");
});

test("historique de création : « creation » en premier, puis rattachements initiaux", async () => {
  const [i1, i2] = await deuxIndicateurs();
  const s = (await creerSignalement({ causes: ["communication"], indicateur_ids: [i1, i2] })).corps.signalement;
  const h = (await api("GET", `/api/signalements/${s.id}`, undefined, A())).corps.historique;
  assert.equal(h[0].evenement, "creation", "premier événement");
  const suite = h.slice(1).map((e) => `${e.evenement}:${e.champ}`);
  assert.equal(suite.filter((x) => x === "rattachement_indicateur:indicateur_id").length, 2, "indicateurs initiaux tracés");
  assert.ok(suite.includes("modification:causes"), "causes initiales tracées");
  const sansCause = (await creerSignalement()).corps.signalement;
  assert.deepEqual((await api("GET", `/api/signalements/${sansCause.id}`, undefined, A())).corps.historique.map((e) => e.evenement), ["creation"]);
});

test("date_resolution : refusée à la création (400), aucun signalement créé", async () => {
  const { rows: [{ n: avant }] } = await pool.query("SELECT count(*)::int AS n FROM signalements_qualite");
  const { rows: [{ n: histAvant }] } = await pool.query("SELECT count(*)::int AS n FROM historique_qualite");
  const r = await creerSignalement({ date_constat: "2026-09-28", date_resolution: "2026-09-30" });
  assert.equal(r.statut, 400);
  assert.equal(r.corps.error, "La date de résolution se renseigne uniquement avec l'action « Résoudre ».");
  const { rows: [{ n: apres }] } = await pool.query("SELECT count(*)::int AS n FROM signalements_qualite");
  const { rows: [{ n: histApres }] } = await pool.query("SELECT count(*)::int AS n FROM historique_qualite");
  assert.equal(apres, avant, "aucun signalement créé");
  assert.equal(histApres, histAvant, "aucune écriture d'historique");
});

test("date_resolution : invariant complet (POST 400, PATCH 400, /resoudre 200)", async () => {
  assert.equal((await creerSignalement({ date_resolution: "2026-09-30" })).statut, 400, "POST");
  const s = (await creerSignalement()).corps.signalement;
  for (const t of ["qualifier", "traiter"]) await api("PATCH", `/api/signalements/${s.id}/${t}`, {}, A());
  assert.equal((await api("PATCH", `/api/signalements/${s.id}`, { date_resolution: "2026-09-30" }, A())).statut, 400, "PATCH général");
  const r = await api("PATCH", `/api/signalements/${s.id}/resoudre`, { date_resolution: "2026-09-30" }, A());
  assert.equal(r.statut, 200, "/resoudre");
  assert.equal(r.corps.signalement.statut, "resolue");
  assert.equal(String(r.corps.signalement.date_resolution).slice(0, 10), "2026-09-30");
});

// ── Q1-B3-B3 : historique de création d'une action ────────────────

test("création d'action : « creation » en premier, puis les rattachements d'indicateurs (même transaction)", async () => {
  const [i1, i2] = await deuxIndicateurs();
  const a = (await creerAction({ indicateur_ids: [i1, i2] })).corps.action;
  const h = (await api("GET", `/api/actions-qualite/${a.id}`, undefined, A())).corps.historique;
  assert.equal(h[0].evenement, "creation", "premier événement");
  assert.deepEqual(h.slice(1).map((e) => e.evenement), ["rattachement_indicateur", "rattachement_indicateur"], "indicateurs initiaux toujours tracés, après la création");
  assert.ok(h.every((e) => e.acteur_nom === "Mme Stark"));
});

test("action liée à un signalement : origine « signalement », historique ordonné, contributeur toujours refusé à la création", async () => {
  const [i1] = await deuxIndicateurs();
  const s = (await creerSignalement()).corps.signalement;
  const r = await creerAction({ signalement_id: s.id, indicateur_ids: [i1], responsable_id: contribId });
  assert.equal(r.statut, 201);
  assert.equal(r.corps.action.origine, "signalement");
  assert.equal(r.corps.action.signalement_id, s.id);
  const h = (await api("GET", `/api/actions-qualite/${r.corps.action.id}`, undefined, A())).corps.historique;
  assert.deepEqual(h.map((e) => e.evenement), ["creation", "rattachement_indicateur"]);
  const d = (await api("GET", `/api/signalements/${s.id}`, undefined, A())).corps.actions;
  assert.deepEqual(d.map((x) => x.id), [r.corps.action.id], "visible dans le détail du signalement");
  assert.equal((await api("POST", "/api/actions-qualite", { titre: "X", signalement_id: s.id }, C())).statut, 403, "droits inchangés");
});

// ── Q1-B4 : liens preuve ↔ action / signalement ───────────────────

async function creerPreuve(titre = "Preuve liée") {
  const { rows: [p] } = await pool.query(
    "INSERT INTO preuves (indicateur_id, titre, description, type_alerte, periodicite_mois, statut) VALUES ($1, $2, 'Description interne à ne pas exposer', 'revision_periodique', 12, 'maitrise') RETURNING id",
    [indicateurId, titre]
  );
  await pool.query("INSERT INTO preuve_fichiers (preuve_id, drive_file_id, drive_url, drive_nom) VALUES ($1, 'FICHIER_DRIVE_1', 'https://drive.google.com/file/d/FICHIER_DRIVE_1/view', 'Feuille.pdf')", [p.id]);
  return p.id;
}
const etatPreuve = async (id) => {
  const { rows: [p] } = await pool.query("SELECT id, titre, indicateur_id, statut FROM preuves WHERE id = $1", [id]);
  const { rows: f } = await pool.query("SELECT drive_file_id FROM preuve_fichiers WHERE preuve_id = $1", [id]);
  return { preuve: p || null, fichiers: f.map((x) => x.drive_file_id) };
};

test("migration 016 : contraintes (une seule cible, pas de doublon, indicateur_id toujours NOT NULL)", async () => {
  const pid = await creerPreuve();
  const a = (await creerAction()).corps.action;
  const s = (await creerSignalement()).corps.signalement;
  await assert.rejects(pool.query("INSERT INTO liens_preuves_qualite (preuve_id) VALUES ($1)", [pid]), "aucune cible refusée");
  await assert.rejects(pool.query("INSERT INTO liens_preuves_qualite (preuve_id, action_qualite_id, signalement_qualite_id) VALUES ($1, $2, $3)", [pid, a.id, s.id]), "deux cibles refusées");
  await pool.query("INSERT INTO liens_preuves_qualite (preuve_id, action_qualite_id) VALUES ($1, $2)", [pid, a.id]);
  await assert.rejects(pool.query("INSERT INTO liens_preuves_qualite (preuve_id, action_qualite_id) VALUES ($1, $2)", [pid, a.id]), "doublon refusé");
  await pool.query("INSERT INTO liens_preuves_qualite (preuve_id, signalement_qualite_id) VALUES ($1, $2)", [pid, s.id]);
  const { rows: [col] } = await pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_name='preuves' AND column_name='indicateur_id'");
  assert.equal(col.is_nullable, "NO");
});

test("rattacher une preuve à une action et à un signalement ; détails enrichis ; une même preuve partagée", async () => {
  const pid = await creerPreuve("Émargement session");
  const s = (await creerSignalement()).corps.signalement;
  const a = (await creerAction({ signalement_id: s.id })).corps.action;
  const ra = await api("POST", `/api/actions-qualite/${a.id}/preuves`, { preuve_id: pid }, A());
  assert.equal(ra.statut, 201);
  assert.deepEqual(ra.corps.preuves.map((p) => p.id), [pid]);
  const rs = await api("POST", `/api/signalements/${s.id}/preuves`, { preuve_id: pid }, A());
  assert.equal(rs.statut, 201, "la même preuve peut soutenir le signalement ET l'action");
  const da = (await api("GET", `/api/actions-qualite/${a.id}`, undefined, A())).corps.preuves;
  const ds = (await api("GET", `/api/signalements/${s.id}`, undefined, A())).corps.preuves;
  for (const liste of [da, ds]) {
    assert.equal(liste.length, 1);
    assert.equal(liste[0].titre, "Émargement session");
    assert.equal(typeof liste[0].indicateur, "number", "indicateur propre de la preuve");
    assert.equal(liste[0].fichiers[0].url, "https://drive.google.com/file/d/FICHIER_DRIVE_1/view", "lien Drive existant");
    assert.ok(!("description" in liste[0]), "aucune description renvoyée");
  }
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM preuves WHERE titre = 'Émargement session'");
  assert.equal(n, 1, "aucune copie de preuve");
});

test("rattachement : doublon 409, preuve / action / signalement inexistants 404, identifiants invalides 400", async () => {
  const pid = await creerPreuve();
  const a = (await creerAction()).corps.action;
  const s = (await creerSignalement()).corps.signalement;
  assert.equal((await api("POST", `/api/actions-qualite/${a.id}/preuves`, { preuve_id: pid }, A())).statut, 201);
  const doublon = await api("POST", `/api/actions-qualite/${a.id}/preuves`, { preuve_id: pid }, A());
  assert.equal(doublon.statut, 409);
  assert.equal(doublon.corps.error, "Cette preuve est déjà liée.");
  assert.equal((await api("POST", `/api/actions-qualite/${a.id}/preuves`, { preuve_id: 999999 }, A())).corps.error, "Preuve introuvable.");
  assert.equal((await api("POST", "/api/actions-qualite/999999/preuves", { preuve_id: pid }, A())).statut, 404);
  assert.equal((await api("POST", "/api/signalements/999999/preuves", { preuve_id: pid }, A())).statut, 404);
  assert.equal((await api("POST", `/api/signalements/${s.id}/preuves`, { preuve_id: "abc" }, A())).statut, 400);
  assert.equal((await api("POST", "/api/signalements/abc/preuves", { preuve_id: pid }, A())).statut, 400);
});

test("retirer le lien : supprime UNIQUEMENT la relation (preuve, fichiers Drive et indicateur intacts)", async () => {
  const pid = await creerPreuve("Preuve à conserver");
  const avant = await etatPreuve(pid);
  const a = (await creerAction()).corps.action;
  const s = (await creerSignalement()).corps.signalement;
  await api("POST", `/api/actions-qualite/${a.id}/preuves`, { preuve_id: pid }, A());
  await api("POST", `/api/signalements/${s.id}/preuves`, { preuve_id: pid }, A());
  const da = await api("DELETE", `/api/actions-qualite/${a.id}/preuves/${pid}`, undefined, A());
  assert.equal(da.statut, 200);
  assert.deepEqual(da.corps.preuves, []);
  const ds = await api("DELETE", `/api/signalements/${s.id}/preuves/${pid}`, undefined, A());
  assert.equal(ds.statut, 200);
  assert.deepEqual(await etatPreuve(pid), avant, "preuve, indicateur et fichiers Drive inchangés");
  assert.equal((await api("DELETE", `/api/signalements/${s.id}/preuves/${pid}`, undefined, A())).statut, 404, "lien déjà retiré");
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM liens_preuves_qualite WHERE preuve_id = $1", [pid]);
  assert.equal(n, 0);
});

test("historique : preuve_rattachee / preuve_detachee (identifiant seul, aucun contenu)", async () => {
  const pid = await creerPreuve("Titre de preuve confidentiel");
  const a = (await creerAction()).corps.action;
  const s = (await creerSignalement()).corps.signalement;
  await api("POST", `/api/actions-qualite/${a.id}/preuves`, { preuve_id: pid }, A());
  await api("DELETE", `/api/actions-qualite/${a.id}/preuves/${pid}`, undefined, A());
  await api("POST", `/api/signalements/${s.id}/preuves`, { preuve_id: pid }, A());
  await api("DELETE", `/api/signalements/${s.id}/preuves/${pid}`, undefined, A());
  const ha = (await api("GET", `/api/actions-qualite/${a.id}`, undefined, A())).corps.historique;
  const hs = (await api("GET", `/api/signalements/${s.id}`, undefined, A())).corps.historique;
  for (const h of [ha, hs]) {
    const r = h.find((e) => e.evenement === "preuve_rattachee");
    const d = h.find((e) => e.evenement === "preuve_detachee");
    assert.equal(r.nouvelle_valeur, String(pid));
    assert.equal(d.ancienne_valeur, String(pid));
    assert.equal(r.acteur_nom, "Mme Stark");
    assert.ok(!JSON.stringify(h).includes("confidentiel") && !JSON.stringify(h).includes("Feuille.pdf"));
  }
});

test("liens : objet clôturé ou annulé ⇒ 409 (même règle que le PATCH), preuves toujours visibles", async () => {
  const pid = await creerPreuve();
  const s = (await creerSignalement()).corps.signalement;
  await api("POST", `/api/signalements/${s.id}/preuves`, { preuve_id: pid }, A());
  await api("PATCH", `/api/signalements/${s.id}/annuler`, {}, A());
  assert.equal((await api("DELETE", `/api/signalements/${s.id}/preuves/${pid}`, undefined, A())).statut, 409);
  assert.equal((await api("POST", `/api/signalements/${s.id}/preuves`, { preuve_id: await creerPreuve("Autre") }, A())).statut, 409);
  assert.equal((await api("GET", `/api/signalements/${s.id}`, undefined, A())).corps.preuves.length, 1, "toujours visible");
});

test("droits : contributeur lit les preuves de SON action seulement, ne lie ni ne délie rien", async () => {
  const pid = await creerPreuve("Preuve partagée");
  const sienne = (await creerAction({ responsable_id: contribId })).corps.action;
  const autre = (await creerAction({ responsable_id: adminId })).corps.action;
  const s = (await creerSignalement()).corps.signalement;
  await api("POST", `/api/actions-qualite/${sienne.id}/preuves`, { preuve_id: pid }, A());
  await api("POST", `/api/actions-qualite/${autre.id}/preuves`, { preuve_id: pid }, A());
  await api("POST", `/api/signalements/${s.id}/preuves`, { preuve_id: pid }, A());
  const vue = await api("GET", `/api/actions-qualite/${sienne.id}`, undefined, C());
  assert.equal(vue.statut, 200);
  assert.deepEqual(vue.corps.preuves.map((p) => p.id), [pid], "lecture seule, comme GET /api/preuves");
  assert.equal((await api("GET", `/api/actions-qualite/${autre.id}`, undefined, C())).statut, 403, "action d'autrui : aucune fuite");
  assert.equal((await api("GET", `/api/signalements/${s.id}`, undefined, C())).statut, 403);
  assert.equal((await api("POST", `/api/actions-qualite/${sienne.id}/preuves`, { preuve_id: pid }, C())).statut, 403);
  assert.equal((await api("DELETE", `/api/actions-qualite/${sienne.id}/preuves/${pid}`, undefined, C())).statut, 403);
  assert.equal((await api("POST", `/api/signalements/${s.id}/preuves`, { preuve_id: pid }, C())).statut, 403);
  assert.equal((await api("DELETE", `/api/signalements/${s.id}/preuves/${pid}`, undefined, C())).statut, 403);
});

test("supprimer une preuve (route existante) nettoie ses liens sans toucher l'action", async () => {
  const pid = await creerPreuve();
  const a = (await creerAction()).corps.action;
  await api("POST", `/api/actions-qualite/${a.id}/preuves`, { preuve_id: pid }, A());
  assert.equal((await api("DELETE", `/api/preuves/${pid}`, undefined, A())).statut, 200);
  const d = await api("GET", `/api/actions-qualite/${a.id}`, undefined, A());
  assert.equal(d.statut, 200);
  assert.deepEqual(d.corps.preuves, []);
});
