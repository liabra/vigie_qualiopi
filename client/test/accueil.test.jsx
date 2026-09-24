// UX-4 — Accueil : blocs utiles selon les droits, sans nouveau backend.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, demonter, monter, texte } from "./outils.jsx";

const REFERENTIEL = {
  version: { id: 1, code: "V9" }, totalIndicateurs: 32, criteres: [],
  score: { total: 32, non_applicable: 2, maitrise: 20, a_consolider: 3, a_risque: 7, preuves: 144, a_confirmer: 1, incomplets: 0 },
};
const PREUVES = [
  { id: 1, titre: "Livret", a_confirmer: true, alerte_statut: null },
  { id: 2, titre: "Habilitation", a_confirmer: false, alerte_statut: "perime" },
];
const VEILLES = [{ id: 1, statut_action: "a_realiser" }, { id: 2, statut_action: "aucune" }];
const SESSIONS = [
  { id: 1, reference: "SESS-EN-COURS", formation: "Formation test", statut: "en_cours", date_debut: "2026-09-01" },
  { id: 2, reference: "SESS-AVENIR", formation: "Aide à domicile", statut: "planifiee", date_debut: "2026-12-01" },
];
const AUDITS = [{ id: 9, type: "surveillance", date_audit: "2026-09-01", resultat: "certifie" }];

const routes = (extra = {}) => ({
  "GET /api/referentiel": REFERENTIEL,
  "GET /api/preuves": { preuves: PREUVES, total: PREUVES.length },
  "GET /api/veille": { veilles: VEILLES, total: VEILLES.length },
  "GET /api/sessions": { sessions: SESSIONS, total: SESSIONS.length },
  "GET /api/audits": { audits: AUDITS, total: AUDITS.length },
  ...extra,
});

let natifs = 0;
beforeEach(() => { natifs = 0; window.confirm = () => { natifs++; return true; }; window.alert = () => { natifs++; }; });
afterEach(async () => { assert.equal(natifs, 0, "aucune boîte native"); await demonter(); });

test("admin : à traiter, activité formation, qualité, raccourcis — sans gros bloc Drive", async () => {
  await monter("/accueil", "admin", routes());
  await attendre(() => texte().includes("À traiter"));
  assert.ok(texte().includes("Preuves à confirmer"));
  assert.ok(texte().includes("Preuves périmées"));
  assert.ok(texte().includes("Veille : actions à réaliser"));
  assert.ok(texte().includes("Activité formation") && texte().includes("SESS-EN-COURS"));
  assert.ok(texte().includes("Indicateurs au vert"));
  assert.ok(texte().includes("Dernier audit"));
  for (const l of ["Sessions", "Preuves", "Veille", "Audits"]) assert.ok(bouton(l), `raccourci ${l}`);
  assert.ok(!bouton("Paramètres Drive"), "pas de bloc Drive quand tout va bien");
});

test("contributeur : pas d'alertes admin, accès en lecture", async () => {
  await monter("/accueil", "contributeur", routes());
  await attendre(() => texte().includes("Activité formation"));
  assert.ok(!texte().includes("À traiter"), "aucune alerte admin");
  assert.ok(texte().includes("Indicateurs"), "accès lecture Indicateurs");
  assert.ok(!bouton("Paramètres Drive"));
});

test("admin : bandeau Drive uniquement quand une action est requise", async () => {
  await monter("/accueil", "admin", routes({ "GET /api/drive/status": { configured: true, connected: false, compte: "drive@exemple.fr" } }));
  await attendre(() => texte().includes("Google Drive"));
  assert.ok(bouton("Paramètres Drive"));
});
