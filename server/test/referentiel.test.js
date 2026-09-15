import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DEFAULT_SEED, normalizeReferentiel, validateReferentiel } from "../src/seed.js";

const raw = JSON.parse(fs.readFileSync(DEFAULT_SEED, "utf8"));
const ref = normalizeReferentiel(raw);

test("le guide V9 est complet et valide : 7 critères, 32 indicateurs", () => {
  assert.equal(ref.version.code, "V9");
  assert.equal(ref.criteres.length, 7);
  assert.equal(ref.indicateurs.length, 32);
  assert.deepEqual(validateReferentiel(ref), []);
});

test("répartition des indicateurs par critère", () => {
  const parCritere = {};
  for (const i of ref.indicateurs) (parCritere[i.critere] ||= []).push(i.numero);
  assert.deepEqual(parCritere, {
    1: [1, 2, 3], 2: [4, 5, 6, 7, 8], 3: [9, 10, 11, 12, 13, 14, 15, 16],
    4: [17, 18, 19, 20], 5: [21, 22], 6: [23, 24, 25, 26, 27, 28, 29], 7: [30, 31, 32],
  });
});

test("un fichier sans marque provisoire est réputé vérifié", () => {
  assert.ok(ref.indicateurs.every((i) => i.texte_source_verifie));
  const prov = normalizeReferentiel({ ...raw, provisoire: true });
  assert.ok(prov.indicateurs.every((i) => !i.texte_source_verifie));
});

test("la validation détecte un indicateur manquant ou une catégorie inconnue", () => {
  const manque = { ...ref, indicateurs: ref.indicateurs.filter((i) => i.numero !== 17) };
  assert.ok(validateReferentiel(manque).some((e) => e.includes("indicateur 17 absent")));
  const cat = { ...ref, indicateurs: ref.indicateurs.map((i) => (i.numero === 1 ? { ...i, categories: ["XX"] } : i)) };
  assert.ok(validateReferentiel(cat).some((e) => e.includes("catégorie « XX »")));
});
