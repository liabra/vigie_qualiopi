// ─────────────────────────────────────────────────────────────
//  L10 — Sécurité applicative : droits, cookies, mass assignment,
//  en-têtes, non-fuite de données.
//
//  Application Express RÉELLE montée ; la base est simulée quand une
//  route en a besoin (setPoolFactory).
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { setPoolFactory } from "../src/db.js";
import { encode } from "../src/session.js";

const SQL_UTILISATEUR = "SELECT id, email, nom, role FROM utilisateurs WHERE id = $1 AND actif";
const sqlNormalise = (t) => String(t).replace(/\s+/g, " ").trim();

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

const cookieAdmin = "vq_session=" + encode({ uid: 1, exp: Date.now() + 60_000 });

// ── /me et en-têtes ──────────────────────────────────────────

test("/api/me n'expose ni rôle fantaisiste ni adresse interne", async () => {
  const r = await fetch(origine + "/api/me");
  const corps = await r.json();
  assert.equal(typeof corps.googleConfigured, "boolean");
  assert.equal(corps.user, null, "anonyme : user null");
  assert.ok(!("driveAccountEmail" in corps), "l'adresse du compte Drive ne fuit pas");
});

test("les en-têtes de sécurité minimaux sont posés, sans x-powered-by", async () => {
  // /api/me ne touche pas la base : idéal pour vérifier les en-têtes seuls.
  const r = await fetch(origine + "/api/me");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("x-powered-by"), null);
});

// ── Cookies ──────────────────────────────────────────────────

test("un cookie falsifié répond 401, jamais 500", async () => {
  const corps = Buffer.from(JSON.stringify({ uid: 1, exp: Date.now() + 60_000 })).toString("base64url");
  const r = await fetch(origine + "/api/sessions", { headers: { cookie: "vq_session=" + corps + ".signature-bidon" } });
  assert.equal(r.status, 401);
});

test("un cookie expiré répond 401, jamais 500", async () => {
  const r = await fetch(origine + "/api/sessions", {
    headers: { cookie: "vq_session=" + encode({ uid: 1, exp: Date.now() - 1000 }) },
  });
  assert.equal(r.status, 401);
});

// ── Mass assignment ──────────────────────────────────────────

// Base simulée qui capture exactement les colonnes de l'UPDATE stagiaire.
function baseStagiaire() {
  let colonnes = null;
  const executer = async (text, params) => {
    const sql = sqlNormalise(text);
    if (sql === SQL_UTILISATEUR) {
      return { rows: [{ id: 1, email: "admin@exemple.fr", nom: "Mme Stark", role: "admin" }] };
    }
    const m = /^UPDATE stagiaires SET (.+) WHERE id = \$1 RETURNING \*$/.exec(sql);
    if (m) {
      colonnes = m[1].split(",").map((c) => c.trim().split(" = ")[0]);
      return { rows: [{ id: params[0] }] };
    }
    throw new Error("Requête inattendue pour la base simulée : " + sql);
  };
  const pool = {
    query: executer,
    connect: async () => ({ query: executer, release: () => {} }),
  };
  setPoolFactory(() => pool);
  return { getColonnes: () => colonnes };
}

test("mass assignment : un PATCH stagiaire n'applique pas role/id/created_at", async () => {
  const b = baseStagiaire();
  const r = await fetch(origine + "/api/stagiaires/1", {
    method: "PATCH",
    headers: { cookie: cookieAdmin, "content-type": "application/json" },
    body: JSON.stringify({ nom: "Dupont", role: "admin", id: 999, created_at: "1999-01-01" }),
  });
  assert.equal(r.status, 200);
  const colonnes = b.getColonnes();
  assert.ok(colonnes.includes("nom"), "le champ autorisé est appliqué");
  for (const interdit of ["role", "id", "created_at", "created_by", "updated_at"]) {
    assert.ok(!colonnes.includes(interdit), `la colonne ${interdit} ne doit pas être injectable`);
  }
});

test("mass assignment : une inscription n'accepte pas de colonne système", async () => {
  // L'UPDATE inscriptions ne retient que les colonnes de sa liste blanche ;
  // une base simulée qui capture les colonnes prouve que `statut` passe,
  // mais pas un champ arbitraire.
  let colonnes = null;
  const executer = async (text, params) => {
    const sql = sqlNormalise(text);
    if (sql === SQL_UTILISATEUR) return { rows: [{ id: 1, email: "admin@exemple.fr", nom: "Mme Stark", role: "admin" }] };
    if (sql === "SELECT 1 FROM prescripteurs WHERE code = $1") return { rows: [], rowCount: 0 };
    const m = /^UPDATE inscriptions SET (.+) WHERE id = \$1 RETURNING \*$/.exec(sql);
    if (m) {
      colonnes = m[1].split(",").map((c) => c.trim().split(" = ")[0]);
      return { rows: [{ id: params[0] }] };
    }
    throw new Error("Requête inattendue : " + sql);
  };
  const pool = { query: executer, connect: async () => ({ query: executer, release: () => {} }) };
  setPoolFactory(() => pool);
  const r = await fetch(origine + "/api/inscriptions/11", {
    method: "PATCH",
    headers: { cookie: cookieAdmin, "content-type": "application/json" },
    body: JSON.stringify({ statut: "abandon", created_by: 99, stagiaire_id: 9999 }),
  });
  assert.equal(r.status, 200);
  assert.ok(colonnes.includes("statut"));
  assert.ok(!colonnes.includes("created_by"));
  assert.ok(!colonnes.includes("stagiaire_id"));
});

// ── Droits admin / contributeur ──────────────────────────────

test("la recherche Drive est réservée à l'admin (403 pour un contributeur)", async () => {
  const contrib = "vq_session=" + encode({ uid: 2, exp: Date.now() + 60_000 });
  const executer = async (text, params) => {
    const sql = sqlNormalise(text);
    if (sql === SQL_UTILISATEUR) {
      return { rows: [{ id: 2, email: "contrib@exemple.fr", nom: "Tukui", role: "contributeur" }] };
    }
    throw new Error("Requête inattendue : " + sql);
  };
  const pool = { query: executer, connect: async () => ({ query: executer, release: () => {} }) };
  setPoolFactory(() => pool);
  const r = await fetch(origine + "/api/drive/recherche?q=abc", { headers: { cookie: contrib } });
  assert.equal(r.status, 403);
});
