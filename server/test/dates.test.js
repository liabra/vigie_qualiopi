// Dates saisies : règle centrale « AAAA-MM-JJ » strict (services/dates.js).
// Le comportement de bout en bout (400 avant écriture, sur PostgreSQL réel)
// est couvert dans transversal.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dateOptionnelleInvalide, estDateValide } from "../src/services/dates.js";
import { champsAudit } from "../src/services/audits.js";
import { estDateValide as estDateValideGestion } from "../src/routes/gestion.js";

test("date ISO réelle acceptée, y compris le 29 février bissextile", () => {
  for (const d of ["2026-09-24", "2024-02-29", "2026-12-31", "2026-01-01"]) assert.equal(estDateValide(d), true, d);
});

test("date impossible, format étranger ou type inattendu refusés", () => {
  for (const d of ["2026-02-31", "2025-02-29", "2026-13-01", "2026-00-10", "31/12/2026", "12/31/2026",
    "abc", "2026-1-5", " 2026-01-05", "2026-01-05T10:00:00Z", 20260105, true, {}, ["2026-01-05"]]) {
    assert.equal(estDateValide(d), false, String(d));
  }
});

test("champ facultatif : vide / null / absent restent permis (sémantique `|| null`)", () => {
  for (const v of [undefined, null, ""]) assert.equal(dateOptionnelleInvalide(v), false, String(v));
  assert.equal(dateOptionnelleInvalide("2026-09-24"), false);
  assert.equal(dateOptionnelleInvalide("2026-02-31"), true);
  assert.equal(dateOptionnelleInvalide("n'importe quoi"), true);
});

test("audit : date obligatoire, puis format strict", () => {
  assert.match(champsAudit({ date_audit: "" }).erreur, /obligatoire/);
  assert.match(champsAudit({ date_audit: "2026-02-31" }).erreur, /Date d'audit invalide/);
  assert.match(champsAudit({ date_audit: "15/03/2026" }).erreur, /AAAA-MM-JJ/);
  assert.deepEqual(champsAudit({ date_audit: "2026-03-15" }), { champs: { date_audit: "2026-03-15" } });
});

test("gestion.js ré-exporte la même règle (absences, sessions)", () => {
  assert.equal(estDateValideGestion, estDateValide);
});
