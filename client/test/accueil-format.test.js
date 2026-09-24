// Accueil : module pur — agrégation en lecture seule des données existantes.
import test from "node:test";
import assert from "node:assert/strict";
import { construireAccueil } from "../src/accueil/format.js";

test("construireAccueil : compteurs, prochaines sessions, dernier audit", () => {
  const b = construireAccueil({
    preuves: [
      { a_confirmer: true, alerte_statut: null },
      { a_confirmer: false, alerte_statut: "perime" },
      { a_confirmer: false, alerte_statut: "bientot" },
    ],
    veilles: [{ statut_action: "a_realiser" }, { statut_action: "aucune" }],
    sessions: [
      { id: 1, statut: "en_cours", date_debut: "2026-09-01" },
      { id: 2, statut: "planifiee", date_debut: "2027-01-10" },
      { id: 3, statut: "planifiee", date_debut: "2026-12-01" },
    ],
    audits: [{ id: 9, date_audit: "2026-09-01", resultat: "certifie" }],
    referentiel: { score: { total: 32, non_applicable: 2, maitrise: 20, preuves: 144 } },
  });
  assert.equal(b.aConfirmer, 1);
  assert.equal(b.perimees, 1);
  assert.equal(b.bientot, 1);
  assert.equal(b.veillesAction, 1);
  assert.equal(b.aTraiterTotal, 4);
  assert.equal(b.sessionsEnCours.length, 1);
  assert.equal(b.prochaines[0].id, 3, "prochaine session = date la plus proche");
  assert.equal(b.totalApplicable, 30, "total hors indicateurs non applicables");
  assert.equal(b.dernierAudit.id, 9);
});

test("construireAccueil : aucun élément → aucun compteur inventé", () => {
  const b = construireAccueil({});
  assert.equal(b.aTraiterTotal, 0);
  assert.equal(b.sessionsEnCours.length, 0);
  assert.equal(b.prochaines.length, 0);
  assert.equal(b.dernierAudit, null);
  assert.equal(b.totalApplicable, 0);
});
