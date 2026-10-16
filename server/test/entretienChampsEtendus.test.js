// DOC-9D3 lot B — Validation pure des champs étendus de l'entretien initial
// (sélections fermées, échelles, dates, cases à cocher, tableaux
// répétables). Aucune base.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLES_ENTRETIEN, DATES_ENTRETIEN, ECHELLES_ENTRETIEN, SELECTS_ENTRETIEN, validerReponse,
} from "../src/services/entretiens.js";
import { REFERENTIELS_CHOIX, validerChoix, validerChoixListe } from "../src/services/entretienChoix.js";
import { validerLignes } from "../src/services/entretienLignes.js";

test("sélection fermée : valeur connue acceptée, inconnue refusée, aucun texte libre", () => {
  assert.deepEqual(validerReponse({ cle: "logement", valeur: "seul" }), { cle: "logement", valeur: "seul", source: "jeune" });
  assert.ok(validerReponse({ cle: "logement", valeur: "chez un ami" }).erreur, "texte libre refusé pour une sélection");
  assert.ok(validerReponse({ cle: "sais_quoi_faire", valeur: "peut-être" }).erreur);
});

test("échelle 0-10 : bornes respectées, hors bornes refusé, jamais de valeur par défaut", () => {
  assert.deepEqual(validerReponse({ cle: "confiance_en_soi", valeur: "0" }), { cle: "confiance_en_soi", valeur: "0", source: "jeune" });
  assert.deepEqual(validerReponse({ cle: "confiance_en_soi", valeur: "10" }), { cle: "confiance_en_soi", valeur: "10", source: "jeune" });
  assert.ok(validerReponse({ cle: "confiance_en_soi", valeur: "11" }).erreur);
  assert.ok(validerReponse({ cle: "confiance_en_soi", valeur: "-1" }).erreur);
  assert.ok(validerReponse({ cle: "confiance_en_soi", valeur: "beaucoup" }).erreur);
});

test("date ISO : forme valide acceptée, forme invalide refusée", () => {
  assert.deepEqual(validerReponse({ cle: "date_naissance", valeur: "2008-05-12" }), { cle: "date_naissance", valeur: "2008-05-12", source: "jeune" });
  assert.ok(validerReponse({ cle: "date_naissance", valeur: "12/05/2008" }).erreur);
  assert.ok(validerReponse({ cle: "date_naissance", valeur: "2008-13-40" }).erreur, "date calendaire impossible refusée");
});

test("aucune donnée médicale/handicap dans les nouvelles clés, sélections, échelles ou dates", () => {
  const toutesLesCles = [...Object.keys(CLES_ENTRETIEN), ...Object.keys(SELECTS_ENTRETIEN), ...Object.keys(ECHELLES_ENTRETIEN), ...Object.keys(DATES_ENTRETIEN)];
  for (const c of toutesLesCles) assert.ok(!/medical|diagnostic|rqth|handicap|sante|maladie/i.test(c), `clé sensible interdite : ${c}`);
});

test("cases à cocher : référentiel fermé, 8 groupes, aucune option hors modèle", () => {
  assert.equal(Object.keys(REFERENTIELS_CHOIX).length, 8);
  assert.deepEqual(validerChoix({ groupe: "loisirs", code: "sport" }), { groupe: "loisirs", code: "sport" });
  assert.ok(validerChoix({ groupe: "loisirs", code: "escalade" }).erreur, "option hors référentiel refusée");
  assert.ok(validerChoix({ groupe: "groupe_invente", code: "x" }).erreur);
});

test("cases à cocher : liste valide, doublon (groupe, code) refusé", () => {
  const r = validerChoixListe([{ groupe: "loisirs", code: "sport" }, { groupe: "loisirs", code: "lecture" }]);
  assert.ok(!r.erreur);
  assert.equal(r.choix.length, 2);
  assert.match(validerChoixListe([{ groupe: "loisirs", code: "sport" }, { groupe: "loisirs", code: "sport" }]).erreur, /double/);
});

test("tableau répétable « expériences » : ligne partiellement remplie acceptée, totalement vide refusée", () => {
  const r = validerLignes("experiences", [{ ordre: 1, structure: "Stage caissière", duree: "2 semaines" }]);
  assert.ok(!r.erreur);
  assert.deepEqual(r.lignes[0], { ordre: 1, structure: "Stage caissière", duree: "2 semaines", missions: null, retenue: null });
  assert.ok(validerLignes("experiences", [{ ordre: 1 }]).erreur, "ligne vide refusée : à omettre plutôt");
  assert.ok(validerLignes("experiences", [{ ordre: 21, structure: "x" }]).erreur, "ordre hors bornes (max 20)");
});

test("tableau répétable « plan d'action » : état fermé, phase 1-6, pas de nombre de lignes imposé", () => {
  const r = validerLignes("plan_action", [{ ordre: 1, objectif: "Reprendre confiance", phase: 1, etat: "en_cours" }]);
  assert.ok(!r.erreur);
  assert.equal(r.lignes.length, 1, "une seule ligne acceptée, jamais 5 forcées");
  assert.ok(validerLignes("plan_action", [{ ordre: 1, etat: "termine" }]).erreur, "état hors référentiel refusé");
  assert.ok(validerLignes("plan_action", [{ ordre: 1, phase: 7 }]).erreur, "phase hors 1-6 refusée");
  assert.match(validerLignes("plan_action", [{ ordre: 1, objectif: "a" }, { ordre: 1, objectif: "b" }]).erreur, /double/);
});
