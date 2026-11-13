import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SEED, normalizeReferentiel, validateReferentiel } from "../src/seed.js";

const raw = JSON.parse(fs.readFileSync(DEFAULT_SEED, "utf8"));
const ref = normalizeReferentiel(raw);

// Candidat non officiel, texte réglementaire seul (décret n° 2026-728) —
// jamais importé, seulement relu ici pour vérifier qu'il reste compatible
// avec le schéma et correctement distingué de V9.
const CANDIDAT_DECRET = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../seed/referentiel_qualiopi_decret_2026-728_draft.json"
);
const rawDecret = JSON.parse(fs.readFileSync(CANDIDAT_DECRET, "utf8"));
const refDecret = normalizeReferentiel(rawDecret);

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

// Non-régression V9 : l'ajout du statut de guide par version ne doit rien
// changer pour une version dont le guide existe déjà.
test("V9 : absence de la clé dans le fichier ⇒ guide réputé disponible, nombre attendu = 32", () => {
  assert.equal(ref.version.guide_de_lecture_disponible, true);
  assert.equal(ref.version.nb_indicateurs_attendu, 32);
});

// Candidat du décret n° 2026-728 : texte réglementaire vérifié, mais guide
// de lecture absent — les deux notions doivent rester indépendantes.
test("candidat décret 2026-728 : 33 indicateurs, 7 critères, valide", () => {
  assert.equal(refDecret.version.code, "DECRET-2026-728-DRAFT");
  assert.equal(refDecret.criteres.length, 7);
  assert.equal(refDecret.indicateurs.length, 33);
  assert.deepEqual(validateReferentiel(refDecret), []);
});

test("candidat décret 2026-728 : texte vérifié (non provisoire) ET guide de lecture indisponible", () => {
  assert.equal(refDecret.version.guide_de_lecture_disponible, false,
    "le guide n'existe pas encore pour ce décret");
  assert.ok(refDecret.indicateurs.every((i) => i.texte_source_verifie),
    "les libellés, confrontés au texte officiel du décret, ne sont pas provisoires");
  assert.equal(refDecret.version.nb_indicateurs_attendu, 33);
});

test("candidat décret 2026-728 : répartition par critère inclut le nouvel indicateur 33 (critère 7)", () => {
  const parCritere = {};
  for (const i of refDecret.indicateurs) (parCritere[i.critere] ||= []).push(i.numero);
  assert.deepEqual(parCritere[7], [30, 31, 32, 33]);
});
