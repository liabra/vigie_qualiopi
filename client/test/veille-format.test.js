// Veille : segments, filtres, indicateurs compacts, corps envoyé à l'API.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEGMENTS, compterSegments, corpsVeille, filtrerVeilles, groupesIndicateurs, indicateursCompacts, lienExterneSur, valeursDepuisVeille,
} from "../src/veille/format.js";

const V = [
  { id: 1, titre: "Décret", source: "Légifrance", type: "legale_reglementaire", statut: "a_analyser", statut_action: "aucune", indicateurs: [{ id: 23, numero: 23 }] },
  { id: 2, titre: "Handicap", source: "Agefiph", type: "handicap", statut: "analysee", statut_action: "a_realiser", indicateurs: [{ id: 11, numero: 11 }] },
  { id: 3, titre: "Plateforme", type: "innovations_pedagogiques", statut: "sans_impact", statut_action: "aucune", indicateurs: [] },
  { id: 4, titre: "CGV", type: "autre", statut: "integree", statut_action: "realisee", indicateurs: [] },
  { id: 5, titre: "Urgent", type: "autre", statut: "a_analyser", statut_action: "a_realiser", indicateurs: [] },
];
const ids = (l) => l.map((v) => v.id);

test("segments : mapping exact sur les statuts serveur", () => {
  assert.deepEqual(ids(filtrerVeilles(V, { segment: "a_analyser" })), [1, 5]);
  assert.deepEqual(ids(filtrerVeilles(V, { segment: "actions" })), [2, 5], "une action à réaliser n'est jamais masquée");
  assert.deepEqual(ids(filtrerVeilles(V, { segment: "traitees" })), [3, 4]);
  assert.deepEqual(compterSegments(V), { a_analyser: 2, actions: 2, traitees: 2, toutes: 5 });
});

test("segments : toute entrée figure dans au moins un segment opérationnel", () => {
  const combos = [];
  for (const statut of ["a_analyser", "analysee", "integree", "sans_impact"]) {
    for (const statut_action of ["aucune", "a_realiser", "realisee"]) combos.push({ statut, statut_action });
  }
  for (const v of combos) assert.ok(SEGMENTS.slice(0, 3).some((s) => s.test(v)), JSON.stringify(v));
});

test("filtres : type, indicateur, recherche sans accents sur titre / source / résumé", () => {
  assert.deepEqual(ids(filtrerVeilles(V, { type: "handicap" })), [2]);
  assert.deepEqual(ids(filtrerVeilles(V, { indicateur: "23" })), [1]);
  assert.deepEqual(ids(filtrerVeilles(V, { q: "legifrance" })), [1]);
  assert.deepEqual(ids(filtrerVeilles(V, { q: "decret", segment: "traitees" })), []);
});

test("indicateurs compacts : trois numéros triés, puis +n", () => {
  const r = indicateursCompacts([32, 11, 24, 23, 26].map((n) => ({ numero: n })));
  assert.deepEqual(r.visibles, [11, 23, 24]);
  assert.equal(r.reste, 2);
});

test("corps envoyé : mêmes champs ; date de réalisation seulement pour une action réalisée", () => {
  const base = { ...valeursDepuisVeille({ type: "autre", titre: "T", statut: "analysee", statut_action: "realisee", action: "A", action_realisee_le: "2026-09-10", indicateurs: [{ id: 7 }] }) };
  assert.equal(corpsVeille(base).action_realisee_le, "2026-09-10");
  assert.deepEqual(corpsVeille(base).indicateur_ids, [7]);
  assert.equal(corpsVeille({ ...base, statut_action: "a_realiser" }).action_realisee_le, null, "règle serveur L6");
  assert.equal(corpsVeille({ ...base, date_publication: "" }).date_publication, null);
  assert.deepEqual(Object.keys(corpsVeille(base)).sort(), [
    "action", "action_realisee_le", "analyse_impact", "date_consultation", "date_effet", "date_publication", "indicateur_ids",
    "resume", "rupture_reglementaire", "source", "statut", "statut_action", "titre", "type", "url",
  ]);
});

test("groupes d'indicateurs : par critère, recherche, liens hors référentiel actif conservés", () => {
  const criteres = [
    { id: 1, numero: 1, libelle: "Information", indicateurs: [{ id: 101, numero: 1, libelle: "Information accessible" }] },
    { id: 2, numero: 2, libelle: "Objectifs", indicateurs: [{ id: 111, numero: 11, libelle: "Atteinte des objectifs" }] },
  ];
  assert.deepEqual(groupesIndicateurs(criteres).map((g) => g.titre), ["Critère 1", "Critère 2"]);
  assert.deepEqual(groupesIndicateurs(criteres, "objectifs").map((g) => g.titre), ["Critère 2"]);
  assert.deepEqual(groupesIndicateurs(criteres, "1").flatMap((g) => g.indicateurs.map((i) => i.numero)), [1], "numéro exact");
  const avecAncien = groupesIndicateurs(criteres, "", [{ id: 999, numero: 30, libelle: "Ancien" }]);
  assert.equal(avecAncien.at(-1).titre, "Hors référentiel actif");
});

test("lien externe : seulement http(s)", () => {
  assert.equal(lienExterneSur("https://www.legifrance.gouv.fr/x"), "https://www.legifrance.gouv.fr/x");
  assert.equal(lienExterneSur("javascript:alert(1)"), null);
  assert.equal(lienExterneSur("data:text/html,x"), null);
  assert.equal(lienExterneSur("pas une url"), null);
});
