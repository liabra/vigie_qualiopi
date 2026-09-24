// UX-4 — Preuves : vue par indicateur, vue toutes, densité, filtres, droits,
// création en panneau. API simulée ; aucune boîte native.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, monter, saisir, texte } from "./outils.jsx";

const IND = (id, numero, libelle, nonApp = false) => ({
  id, numero, libelle, non_applicable_force: nonApp,
  statut: nonApp ? "non_applicable" : "maitrise", nb_preuves: 0, nb_a_confirmer: 0,
  categories: [], texte_source_verifie: true,
});
const REFERENTIEL = {
  version: { id: 1, code: "V9" }, totalIndicateurs: 32,
  score: { maitrise: 3, a_consolider: 0, a_risque: 0, non_applicable: 1, total: 4, preuves: 3, a_confirmer: 0, incomplets: 0 },
  criteres: [
    { id: 1, numero: 1, libelle: "Information du public", indicateurs: [
      IND(101, 1, "Information accessible au public"),
      IND(102, 2, "Indicateurs de résultats"),
    ] },
    { id: 5, numero: 5, libelle: "Qualification du personnel", indicateurs: [
      IND(501, 11, "Atteinte des objectifs"),
      IND(502, 12, "Hors périmètre", true),
    ] },
  ],
};
const FICHIER = (id, driveId, nom, source = "manuel") => ({ id, drive_file_id: driveId, url: `https://d/${id}`, nom, mime: null, source });
const PREUVE = (id, titre, indicateurId, indicateur, critere, extra = {}) => ({
  id, titre, description: null, indicateur_id: indicateurId, indicateur, critere,
  statut: "maitrise", statut_effectif: "maitrise", a_confirmer: false, source: "manuel",
  mode_fichiers: "unique", nb_fichiers: 1, fichiers_attendus: 1, incomplet: false,
  type_alerte: null, periodicite_mois: null, date_echeance: null, date_derniere_revision: null,
  alerte_statut: null, fichiers: [FICHIER(id, `F${id}`, `${titre}.pdf`)], candidats: [], ...extra,
});
const PREUVES = [
  PREUVE(1, "Livret d'accueil", 101, 1, 1),
  PREUVE(2, "Programme de formation", 101, 1, 1, { source: "generation" }),
  PREUVE(3, "Habilitation électrique", 501, 11, 5, { type_alerte: "echeance_fixe", date_echeance: "2020-01-01", alerte_statut: "perime" }),
];
const routes = (extra = {}) => ({
  "GET /api/preuves": { preuves: PREUVES, total: PREUVES.length },
  "GET /api/referentiel": REFERENTIEL,
  ...extra,
});

let natifs = 0;
beforeEach(() => { natifs = 0; window.confirm = () => { natifs++; return true; }; window.alert = () => { natifs++; }; });
afterEach(async () => { assert.equal(natifs, 0, "aucune boîte native"); await demonter(); });

test("vue par indicateur par défaut : indicateurs avec et sans preuve, non applicables signalés", async () => {
  await monter("/preuves", "admin", routes());
  await attendre(() => texte().includes("Critère 1"));
  assert.ok(texte().includes("Indicateur 1 — Information accessible au public"));
  assert.ok(texte().includes("Indicateur 2 — Indicateurs de résultats"));
  assert.ok(texte().includes("Aucune preuve rattachée"), "indicateur sans preuve visible");
  assert.ok(texte().includes("Non applicable"), "indicateur non applicable signalé");
  assert.equal(window.location.search, "", "vue par défaut sans paramètre d'URL");
});

test("bascule « Toutes les preuves » : liste plate et vue conservée dans l'URL", async () => {
  await monter("/preuves", "admin", routes());
  await attendre(() => texte().includes("Critère 1"));
  await cliquer([...document.querySelectorAll(".preuves-vue")].find((b) => b.textContent.startsWith("Toutes")));
  await attendre(() => new URLSearchParams(window.location.search).get("vue") === "toutes");
  assert.equal(document.querySelectorAll(".liste-preuves .preuve").length, 3);
  assert.ok(!texte().includes("Aucune preuve rattachée"), "vue toutes sans les trous");
});

test("deep-link ?indicateur=11 : seule la preuve de l'indicateur 11 est visible", async () => {
  await monter("/preuves?indicateur=11", "admin", routes());
  await attendre(() => texte().includes("Habilitation électrique"));
  assert.ok(!texte().includes("Livret d'accueil"), "preuves des autres indicateurs masquées");
});

test("recherche et filtre source", async () => {
  await monter("/preuves", "admin", routes());
  await attendre(() => texte().includes("Critère 1"));
  await saisir(document.querySelector('input[type="search"]'), "habilitation");
  await attendre(() => !texte().includes("Livret d'accueil") && texte().includes("Habilitation électrique"));
});

test("contributeur : lecture seule, aucune action d'écriture", async () => {
  await monter("/preuves", "contributeur", routes());
  await attendre(() => texte().includes("Critère 1"));
  assert.ok(!bouton("Ajouter une preuve"), "pas de bouton Ajouter");
  assert.equal(document.querySelectorAll(".case-selection").length, 0, "pas de cases de sélection");
});

test("création en panneau : pas de formulaire permanent, validation avant envoi", async () => {
  const appels = await monter("/preuves", "admin", routes({ "POST /api/preuves": { preuves: [] } }));
  await attendre(() => texte().includes("Critère 1"));
  assert.ok(!document.querySelector("form"), "aucun formulaire ouvert en permanence");
  await cliquer(bouton("Ajouter une preuve"));
  await attendre(() => document.querySelector(".ui-drawer")?.textContent.includes("Nouvelle preuve"));
  await cliquer(bouton("Enregistrer la preuve"));
  await attendre(() => texte().includes("Choisissez au moins un indicateur."));
  assert.equal(appels.filter((a) => a.methode === "POST").length, 0, "rien n'est envoyé si incomplet");
});

test("suppression : ConfirmDialog, Annuler sans envoi, confirmer supprime", async () => {
  const appels = await monter("/preuves", "admin", routes({ "DELETE /api/preuves/1": { ok: true } }));
  await attendre(() => texte().includes("Critère 1"));
  // Ouvre le panneau de la première preuve (Livret d'accueil).
  await cliquer(document.querySelector(".liste-preuves .preuve button"));
  await attendre(() => document.querySelector(".ui-drawer")?.textContent.includes("Supprimer"));
  // Le clic sur Supprimer ouvre la confirmation (pas window.confirm).
  await cliquer(bouton("Supprimer"));
  await attendre(() => document.querySelector('[role="alertdialog"]')?.textContent.includes("Supprimer la preuve « Livret d'accueil » ?"));
  assert.equal(natifs, 0, "aucun window.confirm appelé");
  // Annuler : rien ne part.
  await cliquer([...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.trim() === "Annuler"));
  await attendre(() => !document.querySelector('[role="alertdialog"]'));
  assert.equal(appels.filter((a) => a.methode === "DELETE").length, 0, "aucune suppression sans confirmation");
  // Confirmer : l'appel DELETE part.
  await cliquer(bouton("Supprimer"));
  await attendre(() => document.querySelector('[role="alertdialog"]'));
  await cliquer(bouton("Supprimer la preuve"));
  await attendre(() => appels.some((a) => a.methode === "DELETE" && a.chemin === "/api/preuves/1"));
});
