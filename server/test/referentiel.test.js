import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateReferentiel, DEFAULT_SEED } from "../src/seed.js";

const data = JSON.parse(fs.readFileSync(DEFAULT_SEED, "utf8"));

test("le seed V9 est complet : 7 critères, 32 indicateurs", () => {
  assert.deepEqual(validateReferentiel(data), []);
});

test("répartition des indicateurs par critère", () => {
  const parCritere = {};
  for (const i of data.indicateurs) (parCritere[i.critere] ||= []).push(i.numero);
  assert.deepEqual(parCritere, {
    1: [1, 2, 3], 2: [4, 5, 6, 7, 8], 3: [9, 10, 11, 12, 13, 14, 15, 16],
    4: [17, 18, 19, 20], 5: [21, 22], 6: [23, 24, 25, 26, 27, 28, 29], 7: [30, 31, 32],
  });
});

test("la validation détecte un indicateur manquant", () => {
  const broken = { ...data, indicateurs: data.indicateurs.filter((i) => i.numero !== 17) };
  assert.ok(validateReferentiel(broken).some((e) => e.includes("indicateur 17 absent")));
});
