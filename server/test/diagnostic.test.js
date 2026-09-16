import { test } from "node:test";
import assert from "node:assert/strict";
import { appelGoogle, diagnostiquerErreur, etatJeton, nettoyer } from "../src/services/google.js";

// Erreur telle que gaxios l'emballe : le corps Google est dans response.data,
// et la requête d'origine porte des secrets qui ne doivent JAMAIS ressortir.
function erreurGoogle() {
  const e = new Error(
    "Method doesn't allow unregistered callers (callers without established identity). " +
    "Please use API Key or other form of API consumer identity to call this API."
  );
  e.code = 403;
  e.status = 403;
  e.config = {
    url: "https://sheets.googleapis.com/v4/spreadsheets/abc?fields=properties&access_token=SECRET",
    method: "GET",
    headers: { Authorization: "Bearer SECRET-JETON" },
    data: { client_secret: "SECRET-CLIENT", refresh_token: "SECRET-REFRESH" },
  };
  e.response = {
    status: 403,
    statusText: "Forbidden",
    data: { error: { code: 403, message: "Method doesn't allow unregistered callers.", status: "PERMISSION_DENIED",
      details: [{ reason: "CREDENTIALS_MISSING", domain: "googleapis.com" }] } },
  };
  return e;
}

test("le diagnostic retient code, statut, URL et corps renvoyé par Google", () => {
  const d = diagnostiquerErreur(erreurGoogle(), { operation: "sheets.spreadsheets.get" });
  assert.equal(d.operation, "sheets.spreadsheets.get");
  assert.equal(d.code, 403);
  assert.equal(d.status, 403);
  assert.equal(d.statusText, "Forbidden");
  assert.equal(d.methode, "GET");
  assert.equal(d.googleErreur.error.status, "PERMISSION_DENIED");
  assert.equal(d.googleErreur.error.details[0].reason, "CREDENTIALS_MISSING");
  assert.match(d.message, /unregistered callers/);
});

test("aucun jeton ne ressort du diagnostic", () => {
  const d = diagnostiquerErreur(erreurGoogle(), { operation: "sheets.spreadsheets.get" });
  const serialise = JSON.stringify(d);
  for (const secret of ["SECRET-JETON", "SECRET-CLIENT", "SECRET-REFRESH", "access_token=SECRET"])
    assert.ok(!serialise.includes(secret), "fuite : " + secret);
  // l'URL est gardée, mais sans sa chaîne de requête
  assert.equal(d.url, "https://sheets.googleapis.com/v4/spreadsheets/abc");
});

test("nettoyer masque les clés sensibles à toute profondeur", () => {
  const n = nettoyer({ ok: "visible", access_token: "x", niveau: { refresh_token: "y", client_secret: "z", liste: [{ authorization: "w" }] } });
  assert.equal(n.ok, "visible");
  assert.equal(n.access_token, "[masqué]");
  assert.equal(n.niveau.refresh_token, "[masqué]");
  assert.equal(n.niveau.client_secret, "[masqué]");
  assert.equal(n.niveau.liste[0].authorization, "[masqué]");
});

test("l'état du jeton dit s'il était expiré au moment de l'appel", () => {
  const maintenant = Date.parse("2026-09-16T12:00:00Z");
  const perime = etatJeton({ access_token: "x", expiry: "2026-09-16T11:00:00Z", scopes: "openid drive.readonly" }, maintenant);
  assert.equal(perime.expire, true);
  assert.equal(perime.secondesRestantes, -3600);
  assert.deepEqual(perime.scopes, ["openid", "drive.readonly"]);
  const valide = etatJeton({ access_token: "x", expiry: "2026-09-16T12:30:00Z", scopes: "" }, maintenant);
  assert.equal(valide.expire, false);
  assert.equal(valide.secondesRestantes, 1800);
  assert.equal(etatJeton(null).connu, false);
  assert.equal(etatJeton({ access_token: null, expiry: null, scopes: "" }).expire, null);
});

test("appelGoogle attache le diagnostic à l'erreur et la relance telle quelle", async () => {
  const original = erreurGoogle();
  const logs = [];
  const vrai = console.error;
  console.error = (...a) => logs.push(a.join(" "));
  try {
    await assert.rejects(
      appelGoogle("sheets.spreadsheets.get", () => { throw original; }, { api: "sheets", jeton: etatJeton(null) }),
      (e) => {
        assert.equal(e, original, "la même erreur est relancée");
        assert.equal(e.diagnostic.status, 403);
        assert.equal(e.diagnostic.api, "sheets");
        assert.equal(e.diagnostic.operation, "sheets.spreadsheets.get");
        return true;
      }
    );
  } finally { console.error = vrai; }
  assert.equal(logs.length, 1);
  assert.match(logs[0], /sheets\.spreadsheets\.get/);
  assert.ok(!logs[0].includes("SECRET"), "aucun secret dans le journal");
});

test("appelGoogle laisse passer le résultat quand tout va bien", async () => {
  assert.equal(await appelGoogle("drive.files.list", async () => "ok"), "ok");
});
