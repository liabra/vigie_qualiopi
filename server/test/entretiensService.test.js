// DOC-9C — Validation pure des réponses d'entretien (aucune base).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLES_ENTRETIEN, MAX_REPONSE, validerReponse, validerReponses } from "../src/services/entretiens.js";

test("clé connue : normalisée, source dérivée de la clé", () => {
  assert.deepEqual(validerReponse({ cle: "motif_venue", valeur: "  Revenir vers l'emploi  " }),
    { cle: "motif_venue", valeur: "Revenir vers l'emploi", source: "jeune" });
  assert.deepEqual(validerReponse({ cle: "synthese", valeur: "Synthèse" }),
    { cle: "synthese", valeur: "Synthèse", source: "accompagnateur" });
  assert.deepEqual(validerReponse({ cle: "parole_jeune", valeur: "Je veux avancer" }),
    { cle: "parole_jeune", valeur: "Je veux avancer", source: "jeune" });
  assert.deepEqual(validerReponse({ cle: "plan_action", valeur: "Étapes" }),
    { cle: "plan_action", valeur: "Étapes", source: "accompagnateur" });
});

test("clé inconnue, vide ou trop longue : refusée (jamais inventée)", () => {
  assert.ok(validerReponse({ cle: "diagnostic_medical", valeur: "x" }).erreur);
  assert.ok(validerReponse({ cle: "rqth", valeur: "x" }).erreur);
  assert.ok(validerReponse({ cle: "phase1_q1", valeur: "x" }).erreur, "six phases non modélisées");
  assert.ok(validerReponse({ cle: "motif_venue", valeur: "" }).erreur);
  assert.ok(validerReponse({ cle: "motif_venue", valeur: "   " }).erreur);
  assert.ok(validerReponse({ cle: "motif_venue", valeur: "x".repeat(MAX_REPONSE + 1) }).erreur);
  assert.ok(validerReponse({ cle: "", valeur: "x" }).erreur);
  assert.ok(validerReponse(undefined).erreur);
});

test("liste : valide, clé en double refusée, liste invalide refusée", () => {
  const ok = validerReponses([
    { cle: "motif_venue", valeur: "a" },
    { cle: "synthese", valeur: "b" },
  ]);
  assert.ok(!ok.erreur);
  assert.equal(ok.reponses.length, 2);
  assert.deepEqual(ok.reponses.map((r) => r.source), ["jeune", "accompagnateur"]);

  assert.match(validerReponses([{ cle: "motif_venue", valeur: "a" }, { cle: "motif_venue", valeur: "b" }]).erreur, /double/);
  assert.match(validerReponses("pas une liste").erreur, /liste/);
  assert.match(validerReponses([{ cle: "inconnue", valeur: "x" }]).erreur, /inconnue/);
});

test("aucune clé médicale, RQTH ou handicap dans le socle", () => {
  const cles = Object.keys(CLES_ENTRETIEN);
  for (const c of cles) {
    assert.ok(!/medical|diagnostic|rqth|handicap|sante|maladie/i.test(c), `clé sensible interdite : ${c}`);
  }
  assert.ok(!("phase1" in CLES_ENTRETIEN), "six phases non modélisées");
});
