// Règle de normalisation de l'horaire d'une session, partagée par la
// création (POST /api/sessions) et la correction (PATCH /api/sessions/:id).
// Les deux chemins DOIVENT stocker la même chose : sinon un horaire saisi
// puis corrigé ne s'imprimerait pas pareil dans {{horaire}}. La fonction est
// exportée par routes/gestion.js, comme extraireFileId l'est déjà.
// Le contrat HTTP du PATCH (droits, champs modifiables, documents obsolètes)
// vit désormais dans sessions.test.js — ici, uniquement la règle de saisie.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliserHoraire } from "../src/routes/gestion.js";

test("les espaces autour de l'horaire sont rognés", () => {
  assert.equal(normaliserHoraire("  8h30–12h00  "), "8h30–12h00");
  assert.equal(normaliserHoraire("\n9h00–12h30 / 14h00–17h00\t"), "9h00–12h30 / 14h00–17h00");
});

test("horaire vide, fait d'espaces, ou absent : NULL en base", () => {
  assert.equal(normaliserHoraire(""), null);
  assert.equal(normaliserHoraire("   "), null);
  assert.equal(normaliserHoraire("\t\n "), null);
  assert.equal(normaliserHoraire(null), null);
  assert.equal(normaliserHoraire(undefined), null);
});

test("l'horaire reste du texte libre : rien n'est reformaté ni validé", () => {
  // Tiret simple, deux-points, virgules : rien de tout cela n'est corrigé.
  assert.equal(normaliserHoraire("8h30-12h00, 13h-16h"), "8h30-12h00, 13h-16h");
  assert.equal(normaliserHoraire("09:00 → 17:00"), "09:00 → 17:00");
  assert.equal(normaliserHoraire("le matin"), "le matin");
  // Une valeur qui n'est pas une chaîne ne fait pas échouer la route.
  assert.equal(normaliserHoraire(9), "9");
});
