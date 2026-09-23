// ─────────────────────────────────────────────────────────────
//  L8 — Robustesse des identifiants et des erreurs HTTP.
//
//  Convention : un ID de ressource Vigie est un entier strictement positif,
//  sans décimale ni caractère supplémentaire. ID mal formé ⇒ 400 ; ID
//  valide mais inexistant ⇒ 404 ; jamais de 500 sur une erreur utilisateur,
//  jamais de détail SQL exposé au client.
//
//  L'application Express réelle est montée ; la couche base est remplacée
//  (db.setQueryExecutor). Deux fausses bases : une qui REFUSE toute requête
//  (prouve que les routes 400 ne touchent pas la base), une qui renvoie
//  toujours vide (prouve le 404 sur ressource inexistante).
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { setQueryExecutor } from "../src/db.js";
import { encode } from "../src/session.js";
import { parseIdPositif } from "../src/services/ids.js";

const ADMIN = { id: 1, email: "admin@exemple.fr", nom: "Mme Stark", role: "admin" };
const CONTRIBUTEUR = { id: 2, email: "tukui@exemple.fr", nom: "Tukui", role: "contributeur" };

const parUid = { 1: ADMIN, 2: CONTRIBUTEUR };
const estQueryAuth = (sql) => sql.includes("FROM utilisateurs") && sql.includes("actif");

// Auth OK, puis : refuse toute autre requête.
const baseQuiRefuse = () => setQueryExecutor(async (sql, params) => {
  if (estQueryAuth(sql)) return { rows: [parUid[params[0]]].filter(Boolean) };
  throw new Error("accès base inattendu : " + sql);
});
// Auth OK, puis : tout le reste est vide.
const baseVide = () => setQueryExecutor(async (sql, params) => {
  if (estQueryAuth(sql)) return { rows: [parUid[params[0]]].filter(Boolean) };
  return { rows: [] };
});

let serveur, origine;
before(async () => {
  serveur = createApp().listen(0);
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});
after(async () => {
  setQueryExecutor(null);
  if (serveur) await new Promise((r) => serveur.close(r));
});

const appel = async (chemin, { methode = "GET", corps, utilisateur = ADMIN, brut = false } = {}) => {
  const r = await fetch(origine + chemin, {
    method: methode,
    headers: {
      "content-type": "application/json",
      ...(utilisateur ? { cookie: "vq_session=" + encode({ uid: utilisateur.id, exp: Date.now() + 60_000 }) } : {}),
    },
    ...(brut ? { body: corps } : corps !== undefined ? { body: JSON.stringify(corps) } : {}),
  });
  return { statut: r.status, corps: await r.json().catch(() => null), texte: await r.text().catch(() => "") };
};

// ── Helper pur ───────────────────────────────────────────────

test("parseIdPositif refuse tout ce qui n'est pas un entier strictement positif", () => {
  for (const v of ["abc", "1abc", "1.5", "0", "-1", "", "  ", "12 ", " 12", "1e2", "0x10", "12.0"]) {
    assert.equal(parseIdPositif(v), null, "refusé : " + JSON.stringify(v));
  }
  for (const v of [0, -1, 1.5, NaN, Infinity]) {
    assert.equal(parseIdPositif(v), null, "refusé (nombre) : " + v);
  }
  assert.equal(parseIdPositif("12"), 12);
  assert.equal(parseIdPositif(12), 12);
});

// ── Matrice : ID mal formé ⇒ 400, sans accès base ───────────

test("un identifiant mal formé répond 400 sans toucher la base", async () => {
  baseQuiRefuse();
  const routes = [
    ["GET", "/api/sessions/abc"],
    ["GET", "/api/sessions/0"],
    ["GET", "/api/sessions/-1"],
    ["PATCH", "/api/inscriptions/abc"],
    ["PATCH", "/api/absences/abc"],
    ["PATCH", "/api/evaluations/abc"],
    ["PATCH", "/api/satisfactions/abc"],
    ["GET", "/api/preuves/abc"],
    ["GET", "/api/veille/1.5"],
    ["GET", "/api/referentiel/versions/abc"],
    ["GET", "/api/referentiel/versions/0"],
  ];
  for (const [methode, chemin] of routes) {
    const r = await appel(chemin, { methode, corps: methode === "PATCH" ? {} : undefined });
    assert.equal(r.statut, 400, `${methode} ${chemin} doit répondre 400`);
    assert.ok(r.corps?.error, `${methode} ${chemin} doit donner un message`);
  }
});

// ── ID valide mais inexistant ⇒ 404 ─────────────────────────

test("un identifiant valide mais inexistant répond 404", async () => {
  baseVide();
  const routes = [
    ["GET", "/api/sessions/999999"],
    ["GET", "/api/preuves/999999"],
    ["GET", "/api/veille/999999"],
    ["GET", "/api/referentiel/versions/999999"],
    ["PATCH", "/api/evaluations/999999"],
    ["PATCH", "/api/satisfactions/999999"],
  ];
  for (const [methode, chemin] of routes) {
    const r = await appel(chemin, { methode, corps: methode === "PATCH" ? {} : undefined });
    assert.equal(r.statut, 404, `${methode} ${chemin} doit répondre 404, reçu ${r.statut} (${r.corps?.error})`);
  }
});

// ── PATCH : corps vide / champs inconnus ─────────────────────

test("un PATCH sans aucun champ modifiable répond 400 « Rien à modifier »", async () => {
  baseQuiRefuse();   // la route ne doit pas écrire ni lire pour ce refus
  assert.equal((await appel("/api/audits/1", { methode: "PATCH", corps: {} })).statut, 400);
  const r = await appel("/api/audits/1", { methode: "PATCH", corps: { champ_inconnu: "x" } });
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /Rien à modifier/);
});

// ── Auth : anonyme 401, contributeur 403 sur route admin ─────

test("l'anonyme est refusé (401) et le contributeur sur une route admin (403)", async () => {
  baseQuiRefuse();
  assert.equal((await appel("/api/sessions/1", { utilisateur: null })).statut, 401);
  assert.equal((await appel("/api/preuves/1", { methode: "PATCH", corps: {}, utilisateur: CONTRIBUTEUR })).statut, 403);
});

// ── Erreurs SQL : traduites ou génériques, sans fuite ────────

test("une violation d'unicité SQL (23505) est traduite en 409", async () => {
  setQueryExecutor(async (sql, params) => {
    if (estQueryAuth(sql)) return { rows: [parUid[params[0]]].filter(Boolean) };
    const e = new Error("duplicate key value violates unique constraint");
    e.code = "23505";
    throw e;
  });
  const r = await appel("/api/sessions/999999");
  assert.equal(r.statut, 409);
  assert.match(r.corps.error, /existe déjà/);
});

// Seule l'unicité (23505) est traduite GLOBALEMENT. Toute autre erreur SQL
// (FK, CHECK, NOT NULL, conversion, hors limites…) peut cacher un bug
// serveur : elle répond 500 générique, sans JAMAIS exposer de détail.
test("une erreur SQL inattendue répond 500 générique sans aucune fuite", async () => {
  const codes = ["23503", "23514", "23502", "22P02", "22003"];
  for (const code of codes) {
    setQueryExecutor(async (sql, params) => {
      if (estQueryAuth(sql)) return { rows: [parUid[params[0]]].filter(Boolean) };
      const e = new Error(`erreur simulée ${code} : detail interne ${sql}`);
      e.code = code;
      e.detail = "secret de connexion";
      e.stack = "at pg (lib/pool.js:1:2)";
      throw e;
    });
    const r = await appel("/api/sessions/999999");
    assert.equal(r.statut, 500, `code ${code} doit répondre 500`);
    assert.deepEqual(r.corps, { error: "Erreur serveur." }, `code ${code} : corps générique`);
    const fuite = ["23503", "23514", "23502", "22P02", "22003", "detail", "stack", "secret", "SELECT", "invalid"];
    for (const mot of fuite) {
      assert.ok(!r.texte.includes(mot), `code ${code} : « ${mot} » ne doit pas fuir (${r.texte})`);
    }
  }
});

// ── JSON mal formé ───────────────────────────────────────────

test("un corps JSON mal formé répond 400 sans fuite", async () => {
  baseVide();
  const r = await appel("/api/sessions", { methode: "POST", corps: '{"intitule":', brut: true });
  assert.equal(r.statut, 400);
  assert.ok(!r.texte.includes("SyntaxError"), "aucun détail interne ne fuit");
});

// Exception documentée : express.json() analyse le corps AVANT tout
// middleware d'auth. Un JSON mal formé répond donc 400 même anonyme —
// c'est le parseur global qui refuse, avant l'authentification. Aucune
// ressource ni information sensible n'est exposée.
test("JSON mal formé + anonyme : 400 avant authentification (parseur global)", async () => {
  baseVide();
  const r = await appel("/api/sessions", { methode: "POST", corps: '{"intitule":', brut: true, utilisateur: null });
  assert.equal(r.statut, 400);
  assert.ok(!r.texte.includes("SyntaxError"), "aucun détail interne ne fuit");
});
