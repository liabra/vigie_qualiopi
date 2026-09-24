// Sessions : formats d'affichage et calculs purs (aucune règle métier ici).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compterParVue, dureePrevue, filtrerSessions, formaterDate, formaterHeures, incoherencesStatut, syntheseAssiduite, syntheseStagiaires,
} from "../src/sessions/format.js";

const S = [
  { reference: "SESS-A", formation: "Aide à domicile", lieu: "Lyon", statut: "en_cours" },
  { reference: "SESS-B", formation: "Sécurité", lieu: "Villeurbanne", statut: "planifiee" },
  { reference: null, formation: "Éducation", lieu: null, statut: "annulee" },
];

test("dates : ISO → JJ/MM/AAAA, valeur absente → vide", () => {
  assert.equal(formaterDate("2026-09-28"), "28/09/2026");
  assert.equal(formaterDate("2026-09-28T00:00:00.000Z"), "28/09/2026");
  assert.equal(formaterDate(null), "");
  assert.equal(formaterDate("n'importe quoi"), "");
});

test("heures : « 210.00 » → « 210 h », décimales à la française", () => {
  assert.equal(formaterHeures("210.00"), "210 h");
  assert.equal(formaterHeures(7.5), "7,5 h");
  assert.equal(formaterHeures(null), "");
});

test("durée prévue : celle de la session, sinon celle de la formation", () => {
  assert.deepEqual(dureePrevue({ duree_heures_reelle: "35.00", duree_heures_defaut: "70.00" }), { heures: "35.00", source: "session" });
  assert.deepEqual(dureePrevue({ duree_heures_reelle: null, duree_heures_defaut: "70.00" }), { heures: "70.00", source: "formation" });
  assert.deepEqual(dureePrevue({ duree_heures_reelle: null, duree_heures_defaut: null }), { heures: null, source: null });
});

test("filtres : vue par statut déclaré, recherche sans accents ni casse", () => {
  assert.equal(filtrerSessions(S, { vue: "en_cours" }).length, 1);
  assert.equal(filtrerSessions(S, { vue: "a_venir" })[0].reference, "SESS-B");
  assert.equal(filtrerSessions(S, { q: "villeur" })[0].reference, "SESS-B");
  assert.equal(filtrerSessions(S, { q: "education" })[0].formation, "Éducation", "insensible aux accents");
  assert.equal(filtrerSessions(S, { vue: "en_cours", q: "securite" }).length, 0, "vue ET recherche");
  assert.deepEqual(compterParVue(S), { toutes: 3, a_venir: 1, en_cours: 1, terminees: 0, annulees: 1 });
});

test("incohérences statut / dates : signalées, jamais corrigées", () => {
  assert.equal(incoherencesStatut({ statut: "planifiee", date_debut: "2026-01-01", date_fin: "2026-02-01" }, "2026-09-24").length, 1);
  assert.equal(incoherencesStatut({ statut: "terminee", date_debut: "2027-01-01", date_fin: "2027-02-01" }, "2026-09-24").length, 1);
  assert.equal(incoherencesStatut({ statut: "en_cours", date_debut: "2026-09-01", date_fin: "2026-12-01" }, "2026-09-24").length, 0);
});

test("synthèses : stagiaires actifs, dossiers incomplets hors abandons, taux fiables seulement", () => {
  assert.deepEqual(syntheseStagiaires([
    { statut: "inscrit", dossier_complet: false }, { statut: "abandon", dossier_complet: false }, { statut: "inscrit", dossier_complet: true },
  ]), { total: 3, actifs: 2, abandons: 1, dossiersIncomplets: 1 });
  const s = syntheseAssiduite({
    total_heures_absence: 10,
    stagiaires: [
      { absences: [{}, {}], assiduite: { fiable: true, taux: 70 } },
      { absences: [], assiduite: { fiable: true, taux: 100 } },
      { absences: [{}], assiduite: { fiable: false, raison: "abandon", depassement: true } },
    ],
  });
  assert.deepEqual(s, { totalHeures: 10, nbAbsences: 3, fiables: 2, sousSeuil: 1, nonCalcules: 1, depassements: 1 });
});
