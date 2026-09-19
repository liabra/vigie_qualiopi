import { test } from "node:test";
import assert from "node:assert/strict";
import { encode, decode, readCookie, safeEqual } from "../src/session.js";

const SECRET = "secret-de-test";

test("un jeton signé se relit", () => {
  const t = encode({ uid: 42, exp: Date.now() + 60_000 }, SECRET);
  assert.equal(decode(t, SECRET).uid, 42);
});

test("un jeton falsifié, expiré ou signé ailleurs est refusé", () => {
  const t = encode({ uid: 42, exp: Date.now() + 60_000 }, SECRET);
  const [body, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ uid: 1, exp: Date.now() + 60_000 })).toString("base64url");
  assert.equal(decode(forged + "." + sig, SECRET), null);
  assert.equal(decode(t, "autre-secret"), null);
  assert.equal(decode(encode({ uid: 42, exp: Date.now() - 1 }, SECRET), SECRET), null);
  assert.equal(decode(body, SECRET), null);
  assert.equal(decode(t + ".x", SECRET), null);
  assert.equal(decode(null, SECRET), null);
});

test("readCookie isole le bon cookie", () => {
  const req = { headers: { cookie: "a=1; vq_session=abc.def; b=2" } };
  assert.equal(readCookie(req, "vq_session"), "abc.def");
  assert.equal(readCookie(req, "absent"), null);
});

test("safeEqual tolère des longueurs différentes", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual(undefined, "x"), false);
});

// ── Garde-fou de saisie ──────────────────────────────────────
// requireRedacteur ouvre la saisie courante aux contributeurs, sans leur
// donner accès à la configuration, qui reste sous requireAdmin.
import { requireAdmin, requireRedacteur } from "../src/session.js";

function fausseReponse() {
  const r = { code: null, corps: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (o) => { r.corps = o; return r; };
  return r;
}
const passage = (garde, user) => {
  const res = fausseReponse();
  let suivant = false;
  garde({ user }, res, () => { suivant = true; });
  return { suivant, code: res.code, erreur: res.corps?.error };
};

test("requireRedacteur laisse passer admin et contributeur, refuse le reste", () => {
  assert.equal(passage(requireRedacteur, { role: "admin" }).suivant, true);
  assert.equal(passage(requireRedacteur, { role: "contributeur" }).suivant, true);

  const anonyme = passage(requireRedacteur, null);
  assert.equal(anonyme.suivant, false);
  assert.equal(anonyme.code, 401);

  const inconnu = passage(requireRedacteur, { role: "lecteur" });
  assert.equal(inconnu.suivant, false);
  assert.equal(inconnu.code, 403);
  assert.match(inconnu.erreur, /contributeurs/);
});

test("requireAdmin reste fermé au contributeur : la configuration ne s'ouvre pas", () => {
  assert.equal(passage(requireAdmin, { role: "admin" }).suivant, true);
  const contributeur = passage(requireAdmin, { role: "contributeur" });
  assert.equal(contributeur.suivant, false);
  assert.equal(contributeur.code, 403);
  assert.match(contributeur.erreur, /administrateurs/);
});
