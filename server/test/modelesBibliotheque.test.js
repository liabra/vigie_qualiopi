// ─────────────────────────────────────────────────────────────
//  Bibliothèque de modèles (étape A) : règles métier pures.
//  Type de document, mode de génération, condition, portée, indicateurs.
// ─────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { validerChamps, verifierCoherence, TYPES_DOCUMENT, MODES_GENERATION, CHAMPS_MODIFIABLES } from "../src/services/modelesBibliotheque.js";

const COMPLET = {
  nom: "Convocation", lien: "https://docs.google.com/document/d/ABCDEFGHIJKLMNOP/edit", portee: "session",
  type_document: "convocation", mode_generation: "manuel", indicateurs: [11, 23],
};

test("création : champs obligatoires exigés, valeurs normalisées", () => {
  const r = validerChamps(COMPLET, { complet: true });
  assert.equal(r.erreur, undefined);
  assert.equal(r.valeur.type_document, "convocation");
  assert.equal(r.valeur.mode_generation, "manuel");
  assert.deepEqual(r.valeur.indicateurs, [11, 23]);
});

test("type de document obligatoire à la création et contrôlé en liste fermée", () => {
  const sans = { ...COMPLET }; delete sans.type_document;
  assert.match(validerChamps(sans, { complet: true }).erreur, /Type de document obligatoire/);
  assert.match(validerChamps({ ...COMPLET, type_document: "facture" }, { complet: true }).erreur, /Type de document obligatoire/);
  for (const t of TYPES_DOCUMENT) assert.equal(validerChamps({ ...COMPLET, type_document: t }, { complet: true }).erreur, undefined, t);
});

test("typologie : 12 catégories exactement", () => {
  assert.deepEqual(TYPES_DOCUMENT, ["attestation", "convocation", "emargement", "fiche_recapitulative", "convention", "compte_rendu", "evaluation", "bilan", "programme", "scenario_pedagogique", "questionnaire", "autre"]);
});

test("mode de génération obligatoire, trois valeurs seulement", () => {
  const sans = { ...COMPLET }; delete sans.mode_generation;
  assert.match(validerChamps(sans, { complet: true }).erreur, /Mode de génération obligatoire/);
  assert.match(validerChamps({ ...COMPLET, mode_generation: "planifie" }, { complet: true }).erreur, /Mode de génération obligatoire/);
  assert.deepEqual(MODES_GENERATION, ["manuel", "automatique", "conditionnel"]);
});

test("portée contrôlée ; indicateurs entiers positifs, au moins un, sans doublon", () => {
  assert.match(validerChamps({ ...COMPLET, portee: "classe" }, { complet: true }).erreur, /Portée inconnue/);
  assert.match(validerChamps({ ...COMPLET, indicateurs: [] }, { complet: true }).erreur, /au moins un indicateur/);
  assert.match(validerChamps({ ...COMPLET, indicateurs: [0] }, { complet: true }).erreur, /entier positif/);
  assert.match(validerChamps({ ...COMPLET, indicateurs: ["abc"] }, { complet: true }).erreur, /entier positif/);
  assert.deepEqual(validerChamps({ ...COMPLET, indicateurs: [23, 11, 11] }, { complet: true }).valeur.indicateurs, [11, 23]);
});

test("modification partielle : seuls les champs transmis sont validés", () => {
  const r = validerChamps({ nom: "  Nouveau nom " }, { complet: false });
  assert.deepEqual(r.valeur, { nom: "Nouveau nom" });
  assert.match(validerChamps({ nom: "   " }, { complet: false }).erreur, /Nom obligatoire/);
  assert.match(validerChamps({ type_document: "facture" }, { complet: false }).erreur, /Type de document obligatoire/);
});

test("longueurs bornées : nom, description, condition", () => {
  assert.match(validerChamps({ nom: "x".repeat(201) }, { complet: false }).erreur, /Nom trop long/);
  assert.match(validerChamps({ description: "x".repeat(1001) }, { complet: false }).erreur, /Description trop longue/);
  assert.match(validerChamps({ condition_generation: "x".repeat(301) }, { complet: false }).erreur, /Condition trop longue/);
});

test("cohérence : mode conditionnel exige une condition ; condition refusée hors mode conditionnel", () => {
  const base = { mode_generation: "conditionnel", condition_generation: null, portee: "session", generation_multiple: false };
  assert.match(verifierCoherence(base).erreur, /décrivez la condition/);
  assert.equal(verifierCoherence({ ...base, condition_generation: "Si l'apprenant est en situation de handicap" }).ok, true);
  assert.match(verifierCoherence({ ...base, mode_generation: "manuel", condition_generation: "x" }).erreur, /n'est admise qu'en mode conditionnel/);
});

test("cohérence : plusieurs documents par session refusés pour la portée stagiaire", () => {
  const modele = { mode_generation: "manuel", condition_generation: null, portee: "stagiaire", generation_multiple: true };
  assert.match(verifierCoherence(modele).erreur, /stagiaire/);
  assert.equal(verifierCoherence({ ...modele, portee: "session" }).ok, true);
});

test("champs modifiables : liste fermée, sans champ d'identité du modèle", () => {
  assert.ok(CHAMPS_MODIFIABLES.includes("type_document"));
  assert.ok(CHAMPS_MODIFIABLES.includes("mode_generation"));
  assert.ok(!CHAMPS_MODIFIABLES.includes("id"));
  assert.ok(!CHAMPS_MODIFIABLES.includes("actif"));
});
