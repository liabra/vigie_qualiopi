import { test } from "node:test";
import assert from "node:assert/strict";
import { cheminPorteIndicateur, rapprocher, score } from "../src/services/driveIndex.js";

const index = [
  { id: "f1", nom: "CGV_A2C", chemin: "critère 1 - 1_2 / indicateur 1 / CGV_A2C" },
  { id: "f2", nom: "Livret PSH", chemin: "critère 1 - 1_2 / indicateur 1 / Livret PSH" },
  { id: "f3", nom: "Livret stagiaire", chemin: "critère 3 - 9_10_11_12 / Indicateur 9 / Livret stagiaire" },
  { id: "f4", nom: "Programmes des formations", chemin: "critère 1 - 1_2 / indicateur 1 / Programmes des formations" },
  { id: "f5", nom: "Auto evaluation", chemin: "critère 3 - 9_10_11_12 / Indicateur 11 / Auto evaluation" },
];

test("un nom identique est rattaché sans confirmation", () => {
  const r = rapprocher("CGV_A2C", index, { indicateur: 1 });
  assert.equal(r.fichier.id, "f1");
  assert.equal(r.aConfirmer, false);
});

test("l'accentuation et la ponctuation n'empêchent pas le rattachement", () => {
  assert.equal(score("auto évaluation", { nom: "Auto evaluation" }), 100);
});

test("deux fichiers également plausibles passent en « à confirmer »", () => {
  const r = rapprocher("Livret", index, { indicateur: 1 });
  assert.equal(r.fichier, null);
  assert.equal(r.aConfirmer, true);
  assert.ok(r.candidats.length >= 2);
  assert.match(r.motif, /plausibles|incertain/);
});

test("aucun fichier proche : à confirmer, sans candidat", () => {
  const r = rapprocher("Attestation de fin de formation", index, { indicateur: 5 });
  assert.equal(r.fichier, null);
  assert.equal(r.aConfirmer, true);
  assert.equal(r.candidats.length, 0);
  assert.match(r.motif, /Aucun fichier/);
});

test("le dossier de l'indicateur départage les homonymes", () => {
  const deux = [
    { id: "a", nom: "Auto evaluation", chemin: "critère 2 - 4_5_6_8 / Indicateur 8 / Auto evaluation" },
    { id: "b", nom: "Auto evaluation", chemin: "critère 3 - 9_10_11_12 / Indicateur 11 / Auto evaluation" },
  ];
  const r = rapprocher("Auto evaluation", deux, { indicateur: 11 });
  assert.equal(r.fichier.id, "b");
});

test("indicateur 1 ne se confond pas avec indicateur 11", () => {
  assert.equal(cheminPorteIndicateur("critère 3 / Indicateur 11 / x", 1), false);
  assert.equal(cheminPorteIndicateur("critère 1 / indicateur 1 / x", 1), true);
});
