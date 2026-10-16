// DOC-9D2 lot B — Validation pure du questionnaire de positionnement
// (aucune base). Référentiel transcrit depuis
// `modeles-local/entree/FSE-IA_Rubrique_8_Positionnement_SOURCE.md`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPETENCES_PAR_CODE, NIVEAUX_COMPETENCE, PHASES_POSITIONNEMENT, PRIORITES_PHASE,
  validerEvaluation, validerEvaluations, validerPhase, validerPhases,
} from "../src/services/positionnementEntretien.js";

test("référentiel : 6 phases, 34 compétences au total, réparties 4/8/8/5/6/3", () => {
  assert.equal(PHASES_POSITIONNEMENT.length, 6);
  assert.deepEqual(PHASES_POSITIONNEMENT.map((p) => p.competences.length), [4, 8, 8, 5, 6, 3]);
  assert.equal(Object.keys(COMPETENCES_PAR_CODE).length, 34);
  assert.deepEqual(PHASES_POSITIONNEMENT.map((p) => p.dureeHeures), [45, 60, 57, 42, 52, 14]);
  assert.equal(PHASES_POSITIONNEMENT.reduce((s, p) => s + p.dureeHeures, 0), 270);
  assert.deepEqual(NIVEAUX_COMPETENCE, ["autonome", "avec_aide", "a_developper"]);
  assert.deepEqual(PRIORITES_PHASE, ["forte", "moyenne", "faible"]);
});

test("aucune compétence hors référentiel, aucune note/score/moyenne nommée", () => {
  for (const [code, ref] of Object.entries(COMPETENCES_PAR_CODE)) {
    assert.ok(!/note|score|moyenne|seuil|resultat/i.test(code + ref.libelle), `${code} ne doit porter aucune notion de score`);
  }
});

test("évaluation : code connu → phase dérivée, jamais fournie par l'appelant", () => {
  assert.deepEqual(validerEvaluation({ competence_code: "p2_c4", niveau: "autonome" }),
    { competence_code: "p2_c4", phase: 2, niveau: "autonome" });
  // Une phase fournie par erreur dans la requête est ignorée (dérivée du code).
  assert.deepEqual(validerEvaluation({ competence_code: "p2_c4", niveau: "avec_aide", phase: 99 }),
    { competence_code: "p2_c4", phase: 2, niveau: "avec_aide" });
});

test("évaluation : code inconnu, niveau invalide, valeur manquante → refusés", () => {
  assert.ok(validerEvaluation({ competence_code: "p7_c1", niveau: "autonome" }).erreur, "phase 7 inexistante");
  assert.ok(validerEvaluation({ competence_code: "p1_c1", niveau: "excellent" }).erreur, "niveau hors référentiel");
  assert.ok(validerEvaluation({ competence_code: "p1_c1" }).erreur);
  assert.ok(validerEvaluation(undefined).erreur);
});

test("liste d'évaluations : valide, double refusé", () => {
  const r = validerEvaluations([{ competence_code: "p1_c1", niveau: "autonome" }, { competence_code: "p1_c2", niveau: "a_developper" }]);
  assert.ok(!r.erreur);
  assert.equal(r.evaluations.length, 2);
  assert.match(validerEvaluations([{ competence_code: "p1_c1", niveau: "autonome" }, { competence_code: "p1_c1", niveau: "avec_aide" }]).erreur, /double/);
  assert.match(validerEvaluations("pas une liste").erreur, /liste/);
});

test("phase : priorité et observations indépendamment facultatives, mais pas les deux absentes", () => {
  assert.deepEqual(validerPhase({ phase: 1, priorite: "forte", observations: "Bon démarrage" }),
    { phase: 1, priorite: "forte", observations: "Bon démarrage" });
  assert.deepEqual(validerPhase({ phase: 2, priorite: "moyenne" }), { phase: 2, priorite: "moyenne", observations: null });
  assert.deepEqual(validerPhase({ phase: 3, observations: "À revoir" }), { phase: 3, priorite: null, observations: "À revoir" });
  assert.ok(validerPhase({ phase: 1 }).erreur, "phase totalement vide refusée");
  assert.ok(validerPhase({ phase: 7, priorite: "forte" }).erreur, "phase hors 1-6");
  assert.ok(validerPhase({ phase: 1, priorite: "urgentissime" }).erreur, "priorité hors référentiel");
});

test("liste de phases : valide, phase en double refusée", () => {
  const r = validerPhases([{ phase: 1, priorite: "forte" }, { phase: 2, observations: "x" }]);
  assert.ok(!r.erreur);
  assert.equal(r.phases.length, 2);
  assert.match(validerPhases([{ phase: 1, priorite: "forte" }, { phase: 1, priorite: "faible" }]).erreur, /double/);
});
