// Statut du référentiel (texte réglementaire vérifié vs guide de lecture
// disponible), porté par VERSION et non plus par indicateur : vérifie que
// l'écran /indicateurs affiche correctement les deux signaux, séparément,
// et que le compteur « attendus » suit la version active plutôt qu'une
// constante codée en dur.
import "./dom.mjs";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, demonter, monter, texte } from "./outils.jsx";

const BASE = {
  criteres: [{ id: 1, numero: 1, libelle: "Critère 1" }],
  score: { maitrise: 0, a_consolider: 0, a_risque: 0, non_applicable: 0, total: 1, preuves: 0, a_confirmer: 0 },
};
const indicateur = (n) => ({
  id: n, critere_id: 1, numero: n, libelle: `Indicateur ${n}`, type: "commun", categories: ["OF"],
  gradation: null, texte_source_verifie: true, nb_preuves: 0, nb_a_confirmer: 0, nb_incomplets: 0, statut: "a_risque",
});

afterEach(async () => { await demonter(); });

test("guide de lecture disponible (V9) : aucun message, aucun écart de compteur", async () => {
  await monter("/indicateurs", "admin", {
    "GET /api/referentiel": {
      ...BASE, version: { id: 1, code: "V9", guide_de_lecture_disponible: true, nb_indicateurs_attendu: 1 },
      totalIndicateurs: 1, perimetre_preuves: "toutes",
      criteres: [{ id: 1, numero: 1, libelle: "Critère 1", indicateurs: [indicateur(1)] }],
    },
  });
  await attendre(() => texte().includes("Référentiel V9"));
  assert.ok(!texte().includes("Guide de lecture non disponible"));
  assert.ok(!texte().includes("attendus"));
});

test("guide de lecture indisponible (candidat décret) : message affiché, libellés pas remis en cause", async () => {
  await monter("/indicateurs", "admin", {
    "GET /api/referentiel": {
      ...BASE, version: { id: 2, code: "DECRET-2026-728-DRAFT", guide_de_lecture_disponible: false, nb_indicateurs_attendu: 1 },
      totalIndicateurs: 1, perimetre_preuves: "toutes",
      criteres: [{ id: 1, numero: 1, libelle: "Critère 1", indicateurs: [indicateur(1)] }],
    },
  });
  await attendre(() => texte().includes("Guide de lecture non disponible"));
  // Le message de guide manquant coexiste avec des libellés déjà vérifiés :
  // aucun indicateur n'est marqué « provisoire » (texte_source_verifie: true).
  assert.ok(!texte().includes("libellé(s) provisoire(s)"));
});

test("compteur « attendus » suit la version active, pas une constante : 33 n'est jamais signalé en écart pour sa propre version", async () => {
  await monter("/indicateurs", "admin", {
    "GET /api/referentiel": {
      ...BASE, version: { id: 2, code: "DECRET-2026-728-DRAFT", guide_de_lecture_disponible: false, nb_indicateurs_attendu: 33 },
      totalIndicateurs: 33, perimetre_preuves: "toutes",
      criteres: [{ id: 1, numero: 1, libelle: "Critère 1", indicateurs: [indicateur(1)] }],
    },
  });
  await attendre(() => texte().includes("33 indicateurs"));
  // Le mot « attendus » apparaît aussi dans le message de guide manquant
  // (« niveaux attendus »), et « .text-erreur » sert aussi à la pastille
  // « à confirmer » (dans .score, sans rapport avec ce compteur) : on cible
  // précisément le bloc d'en-tête (.ref-head) qui porte le compteur.
  assert.ok(!document.querySelector(".ref-head .text-erreur"), "33 est le compte attendu pour cette version, pas un écart");
});

test("compteur « attendus » : nombre attendu inconnu (version-coquille) ⇒ aucun faux avertissement, écran fonctionnel", async () => {
  await monter("/indicateurs", "admin", {
    "GET /api/referentiel": {
      ...BASE, version: { id: 3, code: "COQUILLE", guide_de_lecture_disponible: false, nb_indicateurs_attendu: null },
      totalIndicateurs: 1, perimetre_preuves: "toutes",
      criteres: [{ id: 1, numero: 1, libelle: "Critère 1", indicateurs: [indicateur(1)] }],
    },
  });
  await attendre(() => texte().includes("Référentiel COQUILLE"));
  // Aucun écart de compteur signalé quand la valeur attendue est inconnue.
  assert.ok(!document.querySelector(".ref-head .text-erreur"));
  // Le reste de l'écran reste cohérent et fonctionnel : le guide manquant
  // est bien signalé (donnée connue), le libellé n'est pas remis en cause,
  // et l'indicateur s'affiche normalement.
  assert.ok(texte().includes("Guide de lecture non disponible"));
  assert.ok(!texte().includes("libellé(s) provisoire(s)"));
  assert.ok(texte().includes("Indicateur 1"));
});

test("un écart réel entre le nombre importé et le nombre attendu de la version est signalé", async () => {
  await monter("/indicateurs", "admin", {
    "GET /api/referentiel": {
      ...BASE, version: { id: 1, code: "V9", guide_de_lecture_disponible: true, nb_indicateurs_attendu: 32 },
      totalIndicateurs: 1, perimetre_preuves: "toutes",
      criteres: [{ id: 1, numero: 1, libelle: "Critère 1", indicateurs: [indicateur(1)] }],
    },
  });
  await attendre(() => texte().includes("32 attendus"));
});
