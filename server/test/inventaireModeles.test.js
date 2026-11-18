// ─────────────────────────────────────────────────────────────
//  Inventaire des modèles : suggestions, classement, export CSV (fonctions pures).
//  Rien n'est enregistré : les propositions sont des brouillons.
// ─────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { INDICATEURS_SUGGERES, classer, cellule, marqueursDe, proposer, versCsv } from "../src/services/inventaireModeles.js";
import { TYPES_DOCUMENT } from "../src/services/modelesBibliotheque.js";

test("une suggestion existe pour chacun des 12 types, sans indicateur inventé pour « autre »", () => {
  assert.deepEqual(Object.keys(INDICATEURS_SUGGERES).sort(), [...TYPES_DOCUMENT].sort());
  assert.deepEqual(INDICATEURS_SUGGERES.autre, []);
});

test("proposition : type et portée déduits du nom, mode toujours manuel, jamais enregistrée", () => {
  const p = proposer({ nom: "Émargement – stagiaire" });
  assert.equal(p.type_document, "emargement");
  assert.equal(p.portee, "stagiaire");
  assert.equal(p.mode_generation, "manuel");
  assert.deepEqual(p.indicateurs, INDICATEURS_SUGGERES.emargement);
  assert.equal(p.statut, "proposition_non_enregistree");
  assert.ok(p.motifs.some((m) => /portée déduite/.test(m)));
});

test("proposition : nom sans indice → type « autre » et portée à déterminer", () => {
  const p = proposer({ nom: "Document sans titre" });
  assert.equal(p.type_document, "autre");
  assert.equal(p.portee, null);
  assert.deepEqual(p.indicateurs, []);
  assert.ok(p.motifs.some((m) => /à déterminer/.test(m)));
});

test("proposition : « Fiche récapitulative de session » → fiche_recapitulative, portée session", () => {
  const p = proposer({ nom: "TEST — Fiche récapitulative de session" });
  assert.equal(p.type_document, "fiche_recapitulative");
  assert.equal(p.portee, "session");
});

test("classement : un modèle propre est utilisable ; tout défaut le place en correction avec motifs", () => {
  const propre = { etat: "valide", trashed: false, erreurs: [], avertissements: [], inconnues: [], historiques: [], canoniques: ["nom_stagiaire"] };
  assert.deepEqual(classer(propre), { statut: "utilisable", motifs: [] });
  assert.equal(classer({ ...propre, trashed: true }).statut, "correction");
  assert.equal(classer({ ...propre, etat: "invalide", erreurs: [{}] }).statut, "correction");
  assert.equal(classer({ ...propre, inconnues: ["x"] }).statut, "correction");
  assert.equal(classer({ ...propre, historiques: ["civilite"] }).statut, "correction");
  assert.equal(classer({ ...propre, etat: "valide_avec_avertissements", avertissements: [{}] }).statut, "correction");
});

test("marqueurs : reconnus, historiques et inconnus séparés", () => {
  const m = marqueursDe({ canoniques: ["a"], historiques: ["b"], inconnues: ["c"] });
  assert.deepEqual(m, { reconnus: ["a"], historiques: ["b"], inconnus: ["c"] });
});

test("CSV : formules neutralisées, guillemets et séparateurs échappés, BOM et CRLF", () => {
  assert.match(cellule("=HYPERLINK(\"x\")"), /^"?'=HYPERLINK/, "formule neutralisée par une apostrophe, jamais en tête de cellule");
  assert.equal(cellule("+1"), "'+1");
  assert.equal(cellule("-2"), "'-2");
  assert.equal(cellule("a;b"), "\"a;b\"");
  assert.equal(cellule("il dit \"oui\""), "\"il dit \"\"oui\"\"\"");
  assert.equal(cellule(null), "");
  const csv = versCsv([{ titre: "Nom", valeur: (l) => l.nom }, { titre: "Type", valeur: (l) => l.type }], [{ nom: "=cmd", type: "bilan" }]);
  assert.equal(csv.charCodeAt(0), 0xfeff, "BOM UTF-8");
  assert.equal(csv, "﻿Nom;Type\r\n'=cmd;bilan\r\n");
});

test("classement : un alias (balise à migrer) impose une correction ; marqueurs rangés par famille", () => {
  const d = { etat: "valide", trashed: false, erreurs: [], avertissements: [], inconnues: ["zz"], historiques: [], alias: [{ alias: "nom_stagiaire", canonique: "stagiaire_nom" }], canoniques: ["stagiaire_nom"] };
  assert.equal(classer(d).statut, "correction");
  assert.deepEqual(marqueursDe(d), { reconnus: ["stagiaire_nom"], historiques: ["nom_stagiaire"], inconnus: ["zz"] });
});
