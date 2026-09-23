// Contrat HTTP des versions du référentiel : coexistence de plusieurs
// versions, classification active / future / historique, création d'une
// COQUILLE de version (sans contenu d'indicateurs), activation
// transactionnelle explicite, et permissions par rôle.
//
// Même technique que les autres suites de routes : l'application Express
// réelle est montée et la couche base est remplacée (setPoolFactory).
// La base simulée refuse toute requête qu'elle ne connaît pas : si une
// route se met à écrire ailleurs, ces tests échouent au lieu de passer
// à vide.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { setPoolFactory } from "../src/db.js";
import { encode } from "../src/session.js";

const ADMIN = { id: 1, email: "admin@exemple.fr", nom: "Mme Stark", role: "admin" };
const CONTRIBUTEUR = { id: 2, email: "tukui@exemple.fr", nom: "Tukui", role: "contributeur" };
const SQL_UTILISATEUR = "SELECT id, email, nom, role FROM utilisateurs WHERE id = $1 AND actif";
const sqlNormalise = (text) => String(text).replace(/\s+/g, " ").trim();
const aujourdhui = () => new Date().toISOString().slice(0, 10);

// Contenu technique minimal (fictif, non réglementaire) : une version qui en
// dispose peut être activée, une coquille non. C'est la seule garde demandée :
// pas de nombre obligatoire de critères/indicateurs inventé.
const CONTENU_MINIMAL = {
  criteres: [{ id: 10, numero: 1, libelle: "Critère technique" }],
  indicateurs: [{ id: 100, critere_id: 10, numero: 1, libelle: "Indicateur technique", type: "commun", categories: null, texte_source_verifie: false }],
};

function baseSimulee(versions = []) {
  const etat = { versions: new Map(versions.map((v) => [v.id, { est_active: false, ...v }])) };
  const prochainId = Math.max(0, ...versions.map((v) => v.id)) + 1;

  const executer = async (text, params = []) => {
    const sql = sqlNormalise(text);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };

    if (sql === SQL_UTILISATEUR) {
      const u = [ADMIN, CONTRIBUTEUR].find((x) => x.id === params[0]);
      return { rows: u ? [u] : [] };
    }

    if (sql.startsWith("SELECT id, code, libelle, date_publication, date_application, source, note, est_active FROM referentiel_versions")) {
      const rows = [...etat.versions.values()]
        .sort((a, b) => (b.date_application || "").localeCompare(a.date_application || "") || b.id - a.id);
      return { rows };
    }

    if (sql === "SELECT * FROM referentiel_versions WHERE id = $1") {
      const v = etat.versions.get(params[0]);
      return { rows: v ? [{ ...v }] : [] };
    }

    if (sql.startsWith("SELECT (SELECT count(*)::int FROM criteres")) {
      const v = etat.versions.get(params[0]);
      return { rows: [{ nb_criteres: (v?.criteres || []).length, nb_indicateurs: (v?.indicateurs || []).length }] };
    }

    if (sql.startsWith("SELECT id, numero, libelle FROM criteres")) {
      const v = etat.versions.get(params[0]);
      return { rows: (v.criteres || []).map((c) => ({ id: c.id, numero: c.numero, libelle: c.libelle })) };
    }

    if (sql.startsWith("SELECT id, critere_id, numero, libelle, type, categories, texte_source_verifie FROM indicateurs")) {
      const v = etat.versions.get(params[0]);
      return { rows: v.indicateurs || [] };
    }

    if (sql.startsWith("INSERT INTO referentiel_versions")) {
      const cols = /\(([^)]+)\) VALUES/.exec(sql)[1].split(",").map((s) => s.trim());
      const id = prochainId;
      const v = { id, est_active: false };
      cols.forEach((c, i) => { v[c] = params[i]; });
      const deja = [...etat.versions.values()].find((x) => x.code === v.code);
      if (deja) { const e = new Error("doublon"); e.code = "23505"; throw e; }
      etat.versions.set(id, v);
      return { rows: [{ ...v }] };
    }

    if (sql.startsWith("UPDATE referentiel_versions SET est_active = false")) {
      for (const v of etat.versions.values()) if (v.est_active && v.id !== params[0]) v.est_active = false;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE referentiel_versions SET est_active = true")) {
      const v = etat.versions.get(params[0]);
      if (v) v.est_active = true;
      return { rows: v ? [{ id: v.id }] : [], rowCount: v ? 1 : 0 };
    }

    throw new Error("Requête inattendue pour la base simulée : " + sql);
  };

  const pool = { query: executer, connect: async () => ({ query: executer, release: () => {} }) };
  return { etat, installer: () => { setPoolFactory(() => pool); return pool; } };
}

let serveur, origine;
before(async () => {
  serveur = createApp().listen(0);
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});
after(async () => {
  setPoolFactory(null);
  if (serveur) await new Promise((r) => serveur.close(r));
});

const appel = async (chemin, { methode = "GET", corps, utilisateur = ADMIN } = {}) => {
  const r = await fetch(origine + chemin, {
    method: methode,
    headers: {
      "content-type": "application/json",
      ...(utilisateur ? { cookie: "vq_session=" + encode({ uid: utilisateur.id, exp: Date.now() + 60_000 }) } : {}),
    },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};

// ── Classification et coexistence ────────────────────────────

test("les versions se classent en active / future / historique", async () => {
  const b = baseSimulee([
    { id: 1, code: "V9", libelle: "Référentiel V9", date_application: "2023-01-01", est_active: true },
    { id: 2, code: "V10", libelle: "Référentiel V10", date_application: "2999-01-01", est_active: false },
    { id: 3, code: "V8", libelle: "Référentiel V8", date_application: "2022-01-01", est_active: false },
  ]);
  b.installer();
  const r = await appel("/api/referentiel/versions", { utilisateur: CONTRIBUTEUR });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.total, 3);
  assert.deepEqual(r.corps.versions.map((v) => v.type), ["future", "active", "historique"]);
  // Une seule active, jamais deux.
  assert.equal(r.corps.versions.filter((v) => v.type === "active").length, 1);
});

test("un contributeur consulte le détail d'une version", async () => {
  const b = baseSimulee([
    { id: 1, code: "V9", libelle: "Référentiel V9", date_application: "2023-01-01", est_active: true,
      criteres: [{ id: 10, numero: 1, libelle: "Critère 1" }],
      indicateurs: [{ id: 100, critere_id: 10, numero: 1, libelle: "Indicateur 1", type: "commun", categories: null, texte_source_verifie: false }] },
  ]);
  b.installer();
  const r = await appel("/api/referentiel/versions/1");
  assert.equal(r.statut, 200);
  assert.equal(r.corps.version.code, "V9");
  assert.equal(r.corps.criteres.length, 1);
  assert.equal(r.corps.criteres[0].indicateurs.length, 1);
});

test("un contributeur lit une version inexistante → 404", async () => {
  baseSimulee([]).installer();
  const r = await appel("/api/referentiel/versions/99", { utilisateur: CONTRIBUTEUR });
  assert.equal(r.statut, 404);
});

// ── Création d'une coquille ──────────────────────────────────

test("un admin prépare une nouvelle version (coquille, sans contenu)", async () => {
  const b = baseSimulee([{ id: 1, code: "V9", libelle: "V9", date_application: "2023-01-01", est_active: true }]);
  b.installer();
  const r = await appel("/api/referentiel/versions", {
    methode: "POST",
    corps: { code: " V10 ", libelle: " Référentiel V10 ", date_application: "2999-01-01", source: "Ministère", note: "En préparation" },
  });
  assert.equal(r.statut, 201);
  assert.equal(r.corps.version.code, "V10", "code rogné");
  assert.equal(r.corps.version.est_active, false, "une nouvelle version n'est jamais active d'office");
  assert.equal([...b.etat.versions.values()].filter((v) => v.est_active).length, 1, "la V9 reste la seule active");
});

test("un code vide est refusé", async () => {
  baseSimulee([]).installer();
  const r = await appel("/api/referentiel/versions", { methode: "POST", corps: { code: "  ", libelle: "X" } });
  assert.equal(r.statut, 400);
});

test("un code de version déjà utilisé est refusé (409)", async () => {
  baseSimulee([{ id: 1, code: "V9", libelle: "V9" }]).installer();
  const r = await appel("/api/referentiel/versions", { methode: "POST", corps: { code: "V9", libelle: "Doublon" } });
  assert.equal(r.statut, 409);
});

test("un contributeur ne crée pas de version", async () => {
  baseSimulee([]).installer();
  const r = await appel("/api/referentiel/versions", { methode: "POST", corps: { code: "V10", libelle: "X" }, utilisateur: CONTRIBUTEUR });
  assert.equal(r.statut, 403);
});

// ── Activation transactionnelle ──────────────────────────────

test("activer une version désactive l'ancienne (une seule active)", async () => {
  const b = baseSimulee([
    { id: 1, code: "V9", libelle: "V9", date_application: "2023-01-01", est_active: true, ...CONTENU_MINIMAL },
    { id: 2, code: "V10", libelle: "V10", date_application: "2024-01-01", est_active: false, ...CONTENU_MINIMAL },
  ]);
  b.installer();
  const r = await appel("/api/referentiel/versions/2/activer", { methode: "POST" });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.ok, true);
  assert.equal(b.etat.versions.get(1).est_active, false, "l'ancienne version devient historique");
  assert.equal(b.etat.versions.get(2).est_active, true);
});

test("activer une version future n'est pas bloqué, mais signalé", async () => {
  const b = baseSimulee([
    { id: 1, code: "V9", libelle: "V9", date_application: "2023-01-01", est_active: true, ...CONTENU_MINIMAL },
    { id: 2, code: "V10", libelle: "V10", date_application: "2999-01-01", est_active: false, ...CONTENU_MINIMAL },
  ]);
  b.installer();
  const r = await appel("/api/referentiel/versions/2/activer", { methode: "POST" });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.avertissement, "Cette version a une date d'application future.");
  assert.equal(b.etat.versions.get(2).est_active, true);
});

test("une coquille sans critères ni indicateurs ne peut pas être activée", async () => {
  const b = baseSimulee([
    { id: 1, code: "V9", libelle: "V9", date_application: "2023-01-01", est_active: true, ...CONTENU_MINIMAL },
    { id: 2, code: "V10", libelle: "V10", date_application: "2999-01-01", est_active: false },
  ]);
  b.installer();
  const r = await appel("/api/referentiel/versions/2/activer", { methode: "POST" });
  assert.equal(r.statut, 409);
  assert.match(r.corps.error, /aucun critère ou indicateur/);
  assert.equal(b.etat.versions.get(1).est_active, true, "le refus ne désactive pas la version active");
  assert.equal(b.etat.versions.get(2).est_active, false, "la coquille reste inactive et visible");
  assert.equal([...b.etat.versions.values()].filter((v) => v.est_active).length, 1, "une et une seule version active");
});

test("une version sans indicateurs (critères seuls) est refusée", async () => {
  const b = baseSimulee([
    { id: 1, code: "V9", libelle: "V9", est_active: true, ...CONTENU_MINIMAL },
    { id: 2, code: "V10", libelle: "V10", est_active: false, criteres: [{ id: 20, numero: 1, libelle: "C" }] },
  ]);
  b.installer();
  const r = await appel("/api/referentiel/versions/2/activer", { methode: "POST" });
  assert.equal(r.statut, 409);
  assert.equal(b.etat.versions.get(1).est_active, true);
});

test("une version sans critères (indicateurs seuls) est refusée", async () => {
  const b = baseSimulee([
    { id: 1, code: "V9", libelle: "V9", est_active: true, ...CONTENU_MINIMAL },
    { id: 2, code: "V10", libelle: "V10", est_active: false, indicateurs: [{ id: 200, critere_id: 20, numero: 1, libelle: "I", type: "commun", categories: null, texte_source_verifie: false }] },
  ]);
  b.installer();
  const r = await appel("/api/referentiel/versions/2/activer", { methode: "POST" });
  assert.equal(r.statut, 409);
  assert.equal(b.etat.versions.get(1).est_active, true);
});

test("activer une version inconnue → 404", async () => {
  baseSimulee([]).installer();
  const r = await appel("/api/referentiel/versions/42/activer", { methode: "POST" });
  assert.equal(r.statut, 404);
});

test("un contributeur ne peut pas activer une version", async () => {
  baseSimulee([{ id: 1, code: "V9", libelle: "V9", est_active: false }]).installer();
  const r = await appel("/api/referentiel/versions/1/activer", { methode: "POST", utilisateur: CONTRIBUTEUR });
  assert.equal(r.statut, 403);
});

test("un contributeur consulte les versions et le détail d'une version", async () => {
  baseSimulee([{ id: 1, code: "V9", libelle: "V9", est_active: true, ...CONTENU_MINIMAL }]).installer();
  assert.equal((await appel("/api/referentiel/versions", { utilisateur: CONTRIBUTEUR })).statut, 200);
  assert.equal((await appel("/api/referentiel/versions/1", { utilisateur: CONTRIBUTEUR })).statut, 200);
});

test("un visiteur anonyme n'accède ni à la liste, ni à la création, ni à l'activation (401)", async () => {
  baseSimulee([{ id: 1, code: "V9", libelle: "V9", est_active: false, ...CONTENU_MINIMAL }]).installer();
  assert.equal((await appel("/api/referentiel/versions", { utilisateur: null })).statut, 401);
  assert.equal((await appel("/api/referentiel/versions", { methode: "POST", corps: { code: "V10", libelle: "X" }, utilisateur: null })).statut, 401);
  assert.equal((await appel("/api/referentiel/versions/1/activer", { methode: "POST", utilisateur: null })).statut, 401);
});
