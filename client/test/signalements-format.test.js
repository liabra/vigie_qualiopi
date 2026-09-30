// Q1-B3-B1 — Signalements : règles pures de formatage, compteurs, segments,
// filtres et retard. Aucun navigateur requis.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAUSES_SIGNALEMENT, STATUTS_SIGNALEMENT, TYPES_SIGNALEMENT,
  compteursSignalements, compterSegmentsSignalements, estEnRetardReclamation,
  filtrerSignalements,
} from "../src/qualite/signalements-format.js";

const rec = (sur = {}) => ({ id: 1, reference: "REC-2026-001", type: "reclamation", objet: "Retard convocation",
  date_constat: "2026-09-28", statut: "ouverte", date_echeance_cible: "2026-10-19", responsable_id: 2,
  formation_id: null, session_id: null, indicateurs: [], ...sur });

test("libellés : types, statuts et causes lisibles", () => {
  assert.equal(TYPES_SIGNALEMENT.reclamation.libelle, "Réclamation");
  assert.equal(TYPES_SIGNALEMENT.incident.libelle, "Incident");
  assert.equal(TYPES_SIGNALEMENT.non_conformite.libelle, "Non-conformité");
  assert.equal(STATUTS_SIGNALEMENT.en_traitement.libelle, "En traitement");
  assert.equal(CAUSES_SIGNALEMENT.pedagogie, "Pédagogie");
});

test("retard : uniquement réclamation, échéance renseignée et strictement antérieure", () => {
  assert.equal(estEnRetardReclamation(rec({ date_echeance_cible: "2026-09-30" }), "2026-09-30"), false, "échéance aujourd'hui : pas en retard");
  assert.equal(estEnRetardReclamation(rec({ date_echeance_cible: "2026-10-01" }), "2026-09-30"), false, "échéance future");
  assert.equal(estEnRetardReclamation(rec({ date_echeance_cible: null }), "2026-09-30"), false, "échéance absente");
  assert.equal(estEnRetardReclamation(rec({ type: "incident", date_echeance_cible: "2026-09-29" }), "2026-09-30"), false, "incident : jamais en retard");
  assert.equal(estEnRetardReclamation(rec({ type: "non_conformite", date_echeance_cible: "2026-09-29" }), "2026-09-30"), false);
});

// Règle PO : seule une réclamation EN COURS peut être en retard.
test("retard (règle PO) : ouverte / qualifiée / en traitement dépassées ⇒ en retard", () => {
  for (const statut of ["ouverte", "qualifiee", "en_traitement"]) {
    assert.equal(estEnRetardReclamation(rec({ statut, date_echeance_cible: "2026-09-29" }), "2026-09-30"), true, statut);
  }
});

test("retard (règle PO) : résolue / clôturée / annulée dépassées ⇒ jamais en retard", () => {
  for (const statut of ["resolue", "cloturee", "annulee"]) {
    assert.equal(estEnRetardReclamation(rec({ statut, date_echeance_cible: "2026-09-29" }), "2026-09-30"), false, statut);
  }
});

test("compteurs : à traiter, en retard, résolues, clôturées", () => {
  const liste = [
    rec({ id: 1, statut: "ouverte", date_echeance_cible: "2026-09-29" }),
    rec({ id: 2, statut: "qualifiee", date_echeance_cible: "2026-10-01" }),
    rec({ id: 3, statut: "en_traitement", date_echeance_cible: "2026-10-01" }),
    rec({ id: 4, statut: "resolue", date_echeance_cible: "2026-09-29" }), // dépassée mais résolue : pas en retard
    rec({ id: 5, statut: "cloturee", date_echeance_cible: "2026-09-29" }),
    rec({ id: 6, statut: "annulee", date_echeance_cible: "2026-09-29" }),
  ];
  const c = compteursSignalements(liste);
  assert.equal(c.a_traiter, 3, "ouverte + qualifiee + en_traitement");
  assert.equal(c.en_retard, 1, "seule la réclamation en cours dépassée (pas la résolue)");
  assert.equal(c.resolues, 1);
  assert.equal(c.cloturees, 1);
});

test("segments : actifs = ouverte/qualifiee/en_traitement/resolue", () => {
  const liste = [
    rec({ id: 1, statut: "ouverte" }),
    rec({ id: 2, statut: "resolue" }),
    rec({ id: 3, statut: "cloturee" }),
    rec({ id: 4, statut: "annulee" }),
  ];
  const s = compterSegmentsSignalements(liste);
  assert.equal(s.actifs, 2);
  assert.equal(s.clotures, 1);
  assert.equal(s.annules, 1);
  assert.equal(s.tous, 4);
});

test("filtres : type, statut, responsable, indicateur, recherche (référence/objet)", () => {
  const liste = [
    rec({ id: 1, reference: "REC-2026-001", type: "reclamation", statut: "ouverte", objet: "Retard convocation", responsable_id: 2, indicateurs: [{ id: 5, numero: 32, libelle: "X" }] }),
    rec({ id: 2, reference: "INC-2026-001", type: "incident", statut: "resolue", objet: "Salle indisponible", responsable_id: 1, indicateurs: [] }),
  ];
  assert.equal(filtrerSignalements(liste, { type: "incident" }).length, 1);
  assert.equal(filtrerSignalements(liste, { statut: "resolue" }).length, 1);
  assert.equal(filtrerSignalements(liste, { responsable: "2" }).length, 1);
  assert.equal(filtrerSignalements(liste, { indicateur: "5" }).length, 1);
  assert.equal(filtrerSignalements(liste, { q: "convocation" }).length, 1);
  assert.equal(filtrerSignalements(liste, { q: "INC-2026" }).length, 1, "recherche sur la référence");
});

test("filtres : valeurs inconnues ou non numériques neutralisées", () => {
  const liste = [rec({}), rec({ id: 2, type: "incident", statut: "resolue" })];
  assert.equal(filtrerSignalements(liste, { type: "bidon" }).length, 2, "type inconnu ignoré");
  assert.equal(filtrerSignalements(liste, { statut: "inconnu" }).length, 2);
  assert.equal(filtrerSignalements(liste, { responsable: "abc" }).length, 2, "responsable non numérique ignoré");
  assert.equal(filtrerSignalements(liste, { indicateur: "-3" }).length, 2);
});

test("recherche : n'utilise jamais le nom, l'e-mail ni l'entreprise du réclamant", () => {
  const liste = [rec({ reclamant_nom: "Dupont", reclamant_email: "d@x.fr", reclamant_entreprise: "ACME" })];
  assert.equal(filtrerSignalements(liste, { q: "Dupont" }).length, 0);
  assert.equal(filtrerSignalements(liste, { q: "d@x.fr" }).length, 0);
  assert.equal(filtrerSignalements(liste, { q: "ACME" }).length, 0);
});
