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
