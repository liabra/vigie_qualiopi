// ─────────────────────────────────────────────────────────────
//  Bibliothèque de modèles : routes réelles (POST, GET, PATCH, DELETE, réactivation), PostgreSQL réel.
//  Aucun appel Drive : les modèles sont déclarés par leur identifiant de fichier, sans contrôle de contenu.
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

const PORT = 55485;
const DATA = path.join(os.tmpdir(), "vq-modeles-routes-" + process.pid);
const FICHIER = (n) => `https://docs.google.com/document/d/FICHIER_MODELE_${n}_ABCDEF/edit`;

let cluster, pool, serveur, origine, adminId, contribId;

const cookie = (uid) => "vq_session=" + encode({ uid, exp: Date.now() + 60_000 });
const A = () => ({ cookie: cookie(adminId) });
const C = () => ({ cookie: cookie(contribId) });

async function api(methode, chemin, corps, enTetes = {}) {
  const r = await fetch(origine + chemin, {
    method: methode,
    headers: { "Content-Type": "application/json", ...enTetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}

const MODELE = (n, extra = {}) => ({
  nom: `Modèle ${n}`, lien: FICHIER(n), portee: "session", type_document: "attestation",
  mode_generation: "manuel", indicateurs: [1], ...extra,
});

before(async () => {
  cluster = new EmbeddedPostgres({ databaseDir: DATA, port: PORT, user: "postgres", password: "postgres", persistent: false, onLog: () => {}, onError: () => {} });
  await cluster.initialise();
  await cluster.start();
  const racine = cluster.getPgClient("postgres");
  await racine.connect();
  await racine.query("CREATE DATABASE vq");
  await racine.end();
  pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/vq`, ssl: false, max: 8 });
  setPoolFactory(() => pool);
  setQueryExecutor((text, params) => pool.query(text, params));
  await migrate({ log: () => {} });
  await seedReferentiel();
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@mod.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@mod.local', 'Tukui', 'contributeur') RETURNING id"));
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
});

test("migration 036 : colonnes et contraintes présentes, défauts neutres pour les insertions directes", async () => {
  const { rows } = await pool.query(
    "SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'modeles_documents' AND column_name IN ('type_document', 'mode_generation', 'condition_generation') ORDER BY column_name"
  );
  assert.deepEqual(rows.map((r) => r.column_name), ["condition_generation", "mode_generation", "type_document"]);
  const { rows: [d] } = await pool.query("INSERT INTO modeles_documents (nom, drive_file_id, portee) VALUES ('Brut', 'BRUT_1', 'session') RETURNING type_document, mode_generation");
  assert.deepEqual(d, { type_document: "autre", mode_generation: "manuel" });
  await assert.rejects(pool.query("UPDATE modeles_documents SET mode_generation = 'conditionnel' WHERE drive_file_id = 'BRUT_1'"), /modeles_condition_coherente/);
});

test("création : type et mode obligatoires, réponse complète avec indicateurs", async () => {
  const sans = MODELE(1); delete sans.type_document;
  const r1 = await api("POST", "/api/modeles", sans, A());
  assert.equal(r1.statut, 400);
  assert.match(r1.corps.error, /Type de document obligatoire/);

  const r2 = await api("POST", "/api/modeles", MODELE(2), A());
  assert.equal(r2.statut, 201, JSON.stringify(r2.corps));
  assert.equal(r2.corps.modele.type_document, "attestation");
  assert.equal(r2.corps.modele.mode_generation, "manuel");
  assert.equal(r2.corps.modele.condition_generation, null);
  assert.deepEqual(r2.corps.modele.indicateurs.map((i) => i.numero), [1]);
});

test("création : mode conditionnel exige une condition, refusée en mode manuel", async () => {
  const sansCondition = await api("POST", "/api/modeles", MODELE(3, { mode_generation: "conditionnel", declencheur: "inscription" }), A());
  assert.equal(sansCondition.statut, 400);
  assert.match(sansCondition.corps.error, /choisissez une condition/);

  const avecCondition = await api("POST", "/api/modeles", MODELE(4, { mode_generation: "conditionnel", declencheur: "inscription", condition_code: "situation_handicap", condition_generation: "Si le stagiaire est en situation de handicap" }), A());
  assert.equal(avecCondition.statut, 201, JSON.stringify(avecCondition.corps));
  assert.equal(avecCondition.corps.modele.condition_generation, "Si le stagiaire est en situation de handicap");

  const mauvais = await api("POST", "/api/modeles", MODELE(5, { condition_generation: "x" }), A());
  assert.equal(mauvais.statut, 400);
  assert.match(mauvais.corps.error, /n'est admise qu'en mode conditionnel/);
});

test("GET : filtres par type et par mode, liste des valeurs admises, modèles inactifs séparés", async () => {
  const tous = await api("GET", "/api/modeles", undefined, C());
  assert.equal(tous.statut, 200);
  assert.deepEqual(tous.corps.modes_generation, ["manuel", "automatique", "conditionnel"]);
  assert.deepEqual(Object.keys(tous.corps.declencheurs), ["creation_session", "inscription", "debut_session", "fin_session"]);
  assert.deepEqual(Object.keys(tous.corps.conditions), ["situation_handicap", "besoin_adaptation", "prescripteur_renseigne"]);
  assert.ok(tous.corps.types_document.includes("convocation"));

  const conditionnels = await api("GET", "/api/modeles?mode_generation=conditionnel", undefined, C());
  assert.ok(conditionnels.corps.modeles.length >= 1);
  assert.ok(conditionnels.corps.modeles.every((m) => m.mode_generation === "conditionnel"));

  const attestations = await api("GET", "/api/modeles?type_document=attestation", undefined, C());
  assert.ok(attestations.corps.modeles.every((m) => m.type_document === "attestation"));
});

test("PATCH : modification partielle, indicateurs remplacés, fichier changé, champ inconnu refusé", async () => {
  const cree = await api("POST", "/api/modeles", MODELE(7), A());
  const id = cree.corps.modele.id;

  const nom = await api("PATCH", `/api/modeles/${id}`, { nom: "Attestation renommée", type_document: "bilan" }, A());
  assert.equal(nom.statut, 200, JSON.stringify(nom.corps));
  assert.equal(nom.corps.modele.nom, "Attestation renommée");
  assert.equal(nom.corps.modele.type_document, "bilan");
  assert.equal(nom.corps.modele.mode_generation, "manuel", "champ non transmis inchangé");

  const indicateurs = await api("PATCH", `/api/modeles/${id}`, { indicateurs: [2, 3] }, A());
  assert.deepEqual(indicateurs.corps.modele.indicateurs.map((i) => i.numero), [2, 3]);

  const fichier = await api("PATCH", `/api/modeles/${id}`, { lien: FICHIER(70) }, A());
  assert.equal(fichier.statut, 200);
  assert.match(fichier.corps.modele.drive_url, /FICHIER_MODELE_70/);

  assert.equal((await api("PATCH", `/api/modeles/${id}`, { actif: false }, A())).statut, 400, "champ d'état non modifiable");
  assert.equal((await api("PATCH", `/api/modeles/${id}`, {}, A())).statut, 400, "modification vide refusée");
  assert.equal((await api("PATCH", `/api/modeles/${id}`, { nom: "" }, A())).statut, 400);
  assert.equal((await api("PATCH", "/api/modeles/999999", { nom: "Absent" }, A())).statut, 404);
  assert.equal((await api("PATCH", `/api/modeles/${id}`, { nom: "Droits" }, C())).statut, 403, "réservé à l'administrateur");
});

test("PATCH : changement de mode conditionnel, condition retirée au retour en mode manuel", async () => {
  const cree = await api("POST", "/api/modeles", MODELE(8), A());
  const id = cree.corps.modele.id;

  const sansCondition = await api("PATCH", `/api/modeles/${id}`, { mode_generation: "conditionnel" }, A());
  assert.equal(sansCondition.statut, 400);

  const conditionnel = await api("PATCH", `/api/modeles/${id}`, { mode_generation: "conditionnel", declencheur: "fin_session", condition_code: "prescripteur_renseigne", condition_generation: "Après validation du positionnement" }, A());
  assert.equal(conditionnel.statut, 200, JSON.stringify(conditionnel.corps));
  assert.equal(conditionnel.corps.modele.condition_generation, "Après validation du positionnement");

  const retour = await api("PATCH", `/api/modeles/${id}`, { mode_generation: "manuel" }, A());
  assert.equal(retour.statut, 200, JSON.stringify(retour.corps));
  assert.equal(retour.corps.modele.condition_generation, null, "condition retirée automatiquement");
  assert.deepEqual([retour.corps.modele.declencheur, retour.corps.modele.condition_code], [null, null], "déclencheur et condition retirés");
});

test("PATCH : conflit de fichier et de portée renvoie 409", async () => {
  const a = await api("POST", "/api/modeles", MODELE(9, { portee: "groupe" }), A());
  await api("POST", "/api/modeles", MODELE(10, { portee: "groupe" }), A());
  const conflit = await api("PATCH", `/api/modeles/${a.corps.modele.id}`, { lien: FICHIER(10) }, A());
  assert.equal(conflit.statut, 409);
  assert.match(conflit.corps.error, /actif existe déjà/);
});

test("désactivation, liste des inactifs, modification puis réactivation", async () => {
  const cree = await api("POST", "/api/modeles", MODELE(11), A());
  const id = cree.corps.modele.id;
  assert.equal((await api("DELETE", `/api/modeles/${id}`, undefined, A())).statut, 200);

  const actifs = await api("GET", "/api/modeles", undefined, A());
  assert.equal(actifs.corps.modeles.some((m) => m.id === id), false, "désactivé : absent de la liste courante");
  const inactifs = await api("GET", "/api/modeles?inactifs=1", undefined, A());
  assert.equal(inactifs.corps.modeles.some((m) => m.id === id), true, "désactivé : présent dans la liste des inactifs");

  const modifie = await api("PATCH", `/api/modeles/${id}`, { description: "Préparé avant réactivation" }, A());
  assert.equal(modifie.statut, 200, "un modèle inactif reste modifiable");

  const reactive = await api("POST", `/api/modeles/${id}/reactiver`, undefined, A());
  assert.equal(reactive.statut, 200, JSON.stringify(reactive.corps));
  assert.equal((await api("GET", "/api/modeles", undefined, A())).corps.modeles.some((m) => m.id === id), true);

  const deja = await api("POST", `/api/modeles/${id}/reactiver`, undefined, A());
  assert.equal(deja.statut, 409);
  assert.equal(deja.corps.code, "modele_deja_actif");
  assert.equal((await api("POST", "/api/modeles/999999/reactiver", undefined, A())).statut, 404);
  assert.equal((await api("POST", `/api/modeles/${id}/reactiver`, undefined, C())).statut, 403);
});

test("plusieurs modèles désactivés peuvent partager un couple fichier × portée ; un seul reste actif", async () => {
  const ancien = await api("POST", "/api/modeles", MODELE(12, { portee: "formation" }), A());
  await api("DELETE", `/api/modeles/${ancien.corps.modele.id}`, undefined, A());
  const nouveau = await api("POST", "/api/modeles", MODELE(12, { portee: "formation" }), A());
  assert.equal(nouveau.statut, 201, "un autre modèle peut reprendre le couple tant que l'ancien est désactivé");
  const reactive = await api("POST", `/api/modeles/${ancien.corps.modele.id}/reactiver`, undefined, A());
  assert.equal(reactive.statut, 409, "réactivation refusée : un autre modèle actif occupe le couple");
  assert.equal(reactive.corps.code, "modele_conflit");
  await api("DELETE", `/api/modeles/${nouveau.corps.modele.id}`, undefined, A());
  assert.equal((await api("POST", `/api/modeles/${ancien.corps.modele.id}/reactiver`, undefined, A())).statut, 200, "réactivation possible une fois l'autre désactivé");
});
