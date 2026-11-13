// Q2-4 — Questionnaires personnalisables par formation : validation PURE
// (aucune base, aucun Drive). Vérification ciblée du nouveau parcours.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lireQuestion, lireReponse, reponseAffichage } from "../src/services/questionnaires.js";

test("lireQuestion : texte libre valide, sans options", () => {
  const { champs, erreur } = lireQuestion({ libelle: "Quel est votre objectif ?", type: "texte_libre" });
  assert.equal(erreur, undefined);
  assert.deepEqual(champs, { libelle: "Quel est votre objectif ?", type: "texte_libre", options: [], obligatoire: false });
});

test("lireQuestion : choix_unique exige au moins deux options distinctes", () => {
  assert.ok(lireQuestion({ libelle: "Niveau ?", type: "choix_unique", options: ["Débutant"] }).erreur);
  assert.ok(lireQuestion({ libelle: "Niveau ?", type: "choix_unique", options: ["Débutant", "Débutant"] }).erreur);
  const { champs, erreur } = lireQuestion({ libelle: "Niveau ?", type: "choix_unique", options: ["Débutant", "Avancé"] });
  assert.equal(erreur, undefined);
  assert.deepEqual(champs.options, ["Débutant", "Avancé"]);
});

test("lireQuestion : type inconnu refusé", () => {
  assert.ok(lireQuestion({ libelle: "X", type: "note_sur_10" }).erreur);
});

test("lireReponse : texte_libre obligatoire sans valeur → refusée", () => {
  const question = { libelle: "Pourquoi ?", type: "texte_libre", obligatoire: true, options: [] };
  assert.ok(lireReponse(question, {}).erreur);
  const { champs, erreur } = lireReponse(question, { valeur_texte: "Pour progresser." });
  assert.equal(erreur, undefined);
  assert.deepEqual(champs, { valeur_texte: "Pour progresser.", valeurs_choisies: [] });
});

test("lireReponse : oui_non n'accepte que Oui/Non", () => {
  const question = { libelle: "Avez-vous un ordinateur ?", type: "oui_non", obligatoire: false, options: [] };
  assert.ok(lireReponse(question, { valeur_texte: "peut-être" }).erreur);
  assert.deepEqual(lireReponse(question, { valeur_texte: "Oui" }).champs, { valeur_texte: "Oui", valeurs_choisies: [] });
});

test("lireReponse : choix_unique refuse une option qui n'existe plus sur la question", () => {
  const question = { libelle: "Niveau ?", type: "choix_unique", obligatoire: false, options: ["Débutant", "Avancé"] };
  assert.ok(lireReponse(question, { valeurs_choisies: ["Expert"] }).erreur);
  assert.ok(lireReponse(question, { valeurs_choisies: ["Débutant", "Avancé"] }).erreur, "une seule réponse acceptée");
  assert.deepEqual(lireReponse(question, { valeurs_choisies: ["Avancé"] }).champs, { valeur_texte: null, valeurs_choisies: ["Avancé"] });
});

test("lireReponse : choix_multiple accepte plusieurs options valides, dédoublonnées", () => {
  const question = { libelle: "Centres d'intérêt ?", type: "choix_multiple", obligatoire: false, options: ["Sport", "Lecture", "Cuisine"] };
  const { champs } = lireReponse(question, { valeurs_choisies: ["Sport", "Lecture", "Sport"] });
  assert.deepEqual(champs.valeurs_choisies, ["Sport", "Lecture"]);
});

test("reponseAffichage : relit l'instantané porté par la réponse, jamais une valeur inventée", () => {
  assert.equal(reponseAffichage(null), "");
  assert.equal(reponseAffichage({ valeur_texte: "Pour progresser.", valeurs_choisies: [] }), "Pour progresser.");
  assert.equal(reponseAffichage({ valeur_texte: null, valeurs_choisies: ["Sport", "Lecture"] }), "Sport, Lecture");
  assert.equal(reponseAffichage({ valeur_texte: null, valeurs_choisies: [] }), "");
});
