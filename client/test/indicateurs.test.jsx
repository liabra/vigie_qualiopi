// UX-4 — Indicateurs : regroupement par critère, recherche, détail en
// panneau, lien vers les preuves de l'indicateur.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, monter, saisir, texte } from "./outils.jsx";

const IND = (id, numero, libelle, extra = {}) => ({
  id, numero, libelle, statut: "maitrise", nb_preuves: 0, nb_a_confirmer: 0,
  non_applicable_force: false, type: "general", categories: ["OF"], gradation: null,
  texte_source_verifie: true, ...extra,
});
const REFERENTIEL = {
  version: { id: 1, code: "V9" }, totalIndicateurs: 32,
  score: { maitrise: 2, a_consolider: 0, a_risque: 0, non_applicable: 0, total: 2, preuves: 3, a_confirmer: 0, incomplets: 0 },
  criteres: [
    { id: 1, numero: 1, libelle: "Information du public", indicateurs: [
      IND(101, 1, "Information accessible au public", { nb_preuves: 2 }),
    ] },
    { id: 5, numero: 5, libelle: "Qualification du personnel", indicateurs: [
      IND(501, 11, "Atteinte des objectifs", { nb_preuves: 1 }),
    ] },
  ],
};
const routes = (extra = {}) => ({ "GET /api/referentiel": REFERENTIEL, ...extra });

let natifs = 0;
beforeEach(() => { natifs = 0; window.confirm = () => { natifs++; return true; }; window.alert = () => { natifs++; }; });
afterEach(async () => { assert.equal(natifs, 0, "aucune boîte native"); await demonter(); });

test("regroupement par critère et recherche", async () => {
  await monter("/indicateurs", "admin", routes());
  await attendre(() => texte().includes("Critère 1"));
  assert.ok(texte().includes("Information accessible au public"));
  // Le critère 5 est replié par défaut : la recherche l'ouvre et le filtre.
  await saisir(document.querySelector('input[type="search"]'), "objectifs");
  await attendre(() => texte().includes("Atteinte des objectifs"));
  assert.ok(!texte().includes("Information accessible au public"));
});

test("détail en panneau et lien vers les preuves de l'indicateur", async () => {
  await monter("/indicateurs", "admin", routes());
  await attendre(() => texte().includes("Critère 1"));
  await cliquer(bouton("Détail"));
  await attendre(() => document.querySelector(".ui-drawer")?.textContent.includes("Indicateur 1"));
  assert.ok(document.querySelector(".ui-drawer").textContent.includes("Applicable"));
  const lien = document.querySelector('.ui-drawer a[href="/preuves?indicateur=1"]');
  assert.ok(lien, "lien vers les preuves de l'indicateur");
});
