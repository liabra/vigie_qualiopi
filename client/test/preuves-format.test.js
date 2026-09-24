// Preuves : module pur — groupement par indicateur, filtres, sources.
import test from "node:test";
import assert from "node:assert/strict";
import { filtresActifs, filtrerPreuves, grouperParIndicateur, SOURCES } from "../src/preuves/format.js";

const REFERENTIEL = {
  criteres: [
    { id: 1, numero: 1, libelle: "Information du public", indicateurs: [
      { id: 101, numero: 1, libelle: "Info accessible", non_applicable_force: false },
      { id: 102, numero: 2, libelle: "Indicateurs de résultats", non_applicable_force: false },
      { id: 103, numero: 3, libelle: "Hors périmètre", non_applicable_force: true },
    ] },
    { id: 5, numero: 5, libelle: "Qualification", indicateurs: [
      { id: 501, numero: 11, libelle: "Atteinte des objectifs", non_applicable_force: false },
    ] },
  ],
};
const PREUVES = [
  { id: 1, titre: "Livret", indicateur_id: 101, indicateur: 1, source: "manuel", statut: "maitrise", alerte_statut: null, a_confirmer: false },
  { id: 2, titre: "Programme", indicateur_id: 101, indicateur: 1, source: "generation", statut: "maitrise", alerte_statut: null, a_confirmer: false },
  { id: 3, titre: "Habilitation", indicateur_id: 501, indicateur: 11, source: "manuel", statut: "maitrise", alerte_statut: "perime", a_confirmer: false },
];

test("grouperParIndicateur : critère → indicateur → preuves, trous visibles", () => {
  const g = grouperParIndicateur(REFERENTIEL, PREUVES);
  assert.equal(g.length, 2);
  assert.equal(g[0].indicateurs.length, 3);
  assert.equal(g[0].indicateurs[0].preuves.length, 2);
  assert.equal(g[0].indicateurs[1].preuves.length, 0, "indicateur sans preuve reste présent");
  assert.equal(g[0].indicateurs[2].non_applicable_force, true);
  assert.equal(g[1].indicateurs[0].preuves.length, 1);
});

test("filtrerPreuves : recherche, source, échéance, indicateur, à confirmer", () => {
  assert.equal(filtrerPreuves(PREUVES, { q: "livret" }).length, 1);
  assert.equal(filtrerPreuves(PREUVES, { source: "generation" }).length, 1);
  assert.equal(filtrerPreuves(PREUVES, { alerte: "perime" }).length, 1);
  assert.equal(filtrerPreuves(PREUVES, { indicateur: "11" }).length, 1, "filtre par numéro d'indicateur");
  assert.equal(filtrerPreuves(PREUVES, { a_confirmer: true }).length, 0);
});

test("filtresActifs : vrai dès qu'un filtre est posé", () => {
  assert.equal(filtresActifs({}), false);
  assert.equal(filtresActifs({ q: "a" }), true);
  assert.equal(filtresActifs({ source: "manuel" }), true);
  assert.equal(filtresActifs({ alerte: "perime" }), true);
});

test("SOURCES : trois origines métier distinctes, jamais fusionnées", () => {
  assert.deepEqual(Object.keys(SOURCES).sort(), ["generation", "import_drive", "manuel"]);
});
