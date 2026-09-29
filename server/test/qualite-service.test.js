// Q1 — cœur qualité : règles PURES (validation, références, jours ouvrés,
// workflows) testées sans base ni réseau.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  champsAction, champsSignalement, datePlusJoursOuvres, lireCauses, lireIndicateurs,
  prefixeReference, referencePour, transitionInvalide,
  TRANSITIONS_ACTION, TRANSITIONS_SIGNALEMENT,
} from "../src/services/qualite.js";

test("référence lisible : préfixe par type, numéro sur 3 chiffres", () => {
  assert.equal(prefixeReference("reclamation"), "REC");
  assert.equal(prefixeReference("incident"), "INC");
  assert.equal(prefixeReference("non_conformite"), "NC");
  assert.equal(referencePour("AQ", 2026, 1), "AQ-2026-001");
  assert.equal(referencePour("REC", 2026, 42), "REC-2026-042");
});

test("jours ouvrés : lundi-vendredi, jour de réception non compté", () => {
  // Du mardi 2026-09-29, +1 jour ouvré = mercredi 30.
  assert.equal(datePlusJoursOuvres("2026-09-29", 1), "2026-09-30");
  // Du vendredi 2026-09-25, +1 jour ouvré = lundi 28 (week-end sauté).
  assert.equal(datePlusJoursOuvres("2026-09-25", 1), "2026-09-28");
  // 15 jours ouvrés à compter du lundi 2026-09-28 : 3 semaines = 2026-10-19.
  assert.equal(datePlusJoursOuvres("2026-09-28", 15), "2026-10-19");
  assert.equal(datePlusJoursOuvres("pas-une-date", 15), null);
});

test("jours ouvrés : franchissement de fin de mois et de fin d'année", () => {
  // Lundi 2026-11-30 (fin de mois) + 1 jour ouvré = mardi 2026-12-01.
  assert.equal(datePlusJoursOuvres("2026-11-30", 1), "2026-12-01");
  // Vendredi 2026-12-25 + 15 jours ouvrés : week-end + jours fériés non gérés,
  // on atterrit le vendredi 2027-01-15 (franchissement d'année).
  assert.equal(datePlusJoursOuvres("2026-12-25", 15), "2027-01-15");
});

test("champsSignalement : création exige type + objet", () => {
  const { erreur } = champsSignalement({ objet: "x" }, {}, { creation: true });
  assert.match(erreur, /Type de signalement inconnu/);
  const ok = champsSignalement({ type: "reclamation", objet: "  Objet  " }, {}, { creation: true });
  assert.equal(ok.erreur, undefined);
  assert.equal(ok.champs.objet, "Objet");
  assert.equal(ok.champs.type, "reclamation");
});

test("champsSignalement : enum, dates et identifiants invalides refusés", () => {
  assert.match(champsSignalement({ canal: "fax" }).erreur, /Canal inconnu/);
  assert.match(champsSignalement({ date_constat: "2026-02-31" }).erreur, /Date invalide/);
  assert.match(champsSignalement({ responsable_id: "abc" }).erreur, /Identifiant invalide/);
  assert.match(champsSignalement({ delai_cible_jours_ouvres: 0 }).erreur, /entier positif/);
});

test("lireCauses : 0..N, valeurs connues, « autre » explicitée", () => {
  assert.deepEqual(lireCauses({ causes: ["organisation", "pedagogie"] }), { causes: ["organisation", "pedagogie"] });
  assert.deepEqual(lireCauses({}), { causes: null });
  assert.match(lireCauses({ causes: ["bidon"] }).erreur, /Cause inconnue/);
  assert.match(lireCauses({ causes: ["autre"] }).erreur, /doit être explicitée/);
  assert.deepEqual(lireCauses({ causes: ["autre"], cause_autre_libelle: "matériel" }), { causes: ["autre"] });
});

test("lireIndicateurs : liste dédupliquée, identifiants positifs uniquement", () => {
  assert.deepEqual(lireIndicateurs({ indicateur_ids: [3, 1, 3] }), { ids: [3, 1] });
  assert.match(lireIndicateurs({ indicateur_ids: [0] }).erreur, /invalide/);
  assert.deepEqual(lireIndicateurs({}), { ids: null });
});

test("champsAction : titre obligatoire s'il est fourni vide, origine dérivée du signalement", () => {
  assert.match(champsAction({ titre: "   " }).erreur, /Titre obligatoire/);
  const ok = champsAction({ titre: "Corriger", signalement_id: 7 });
  assert.equal(ok.champs.origine, "signalement");
  const manuel = champsAction({ titre: "Corriger", signalement_id: null });
  assert.equal(manuel.champs.origine, "manuel");
  assert.match(champsAction({ titre: "x", priorite: "extreme" }).erreur, /Priorité inconnue/);
});

test("workflows : transitions valides et refusées", () => {
  assert.equal(transitionInvalide(TRANSITIONS_SIGNALEMENT, "qualifier", "ouverte"), null);
  assert.match(transitionInvalide(TRANSITIONS_SIGNALEMENT, "qualifier", "en_traitement"), /Transition impossible/);
  assert.equal(transitionInvalide(TRANSITIONS_SIGNALEMENT, "annuler", "cloturee"), "Transition impossible depuis le statut « cloturee ».");
  assert.equal(transitionInvalide(TRANSITIONS_ACTION, "realiser", "en_cours"), null);
  assert.match(transitionInvalide(TRANSITIONS_ACTION, "cloturer", "a_faire"), /Transition impossible/);
  assert.match(transitionInvalide(TRANSITIONS_ACTION, "bricolage", "a_faire"), /Transition inconnue/);
});
