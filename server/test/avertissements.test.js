// Avertissements affichés côté client après l'enregistrement d'une session.
// Le message est une fonction pure (pas de JSX, pas de navigateur) : on le
// fige ici pour que la correction de durée reste explicite et testable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { messageDepassementDuree } from "../../client/src/messages.js";

test("le dépassement de durée est formulé clairement", () => {
  assert.equal(
    messageDepassementDuree({ total_heures_absence: 10, duree_prevue: "7.00" }),
    "Attention : 10 h d'absence dépassent la nouvelle durée prévue de 7 h."
  );
});

test("les décimales de la durée sont écrites sans zéro superflu", () => {
  assert.equal(
    messageDepassementDuree({ total_heures_absence: 12.5, duree_prevue: 7 }),
    "Attention : 12.5 h d'absence dépassent la nouvelle durée prévue de 7 h."
  );
});
