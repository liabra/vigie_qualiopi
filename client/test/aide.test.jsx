// Après VF — aide intégrée : bouton global, panneau contextuel, guide
// (rôle + recherche), tutoriel (Suivant/Précédent, premier usage, relance),
// localStorage, petits « ? ». Aucune boîte de dialogue native.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, dialogue, monter, saisir, texte, touche } from "./outils.jsx";
import { tutorielTermine } from "../src/aide/index.js";

let natifs = 0;
beforeEach(() => {
  natifs = 0;
  window.alert = () => { natifs++; };
  window.confirm = () => { natifs++; return true; };
});
afterEach(async () => {
  assert.equal(natifs, 0, "aucun window.alert / window.confirm");
  await demonter();
});

const boutonAide = () => document.querySelector(".shell-aide");
const titreDrawer = () => document.querySelector(".ui-drawer__titre")?.textContent;
const ouvrirAide = async () => { await cliquer(boutonAide()); await attendre(() => dialogue()); };
const fermer = async () => { await cliquer(document.querySelector('.ui-drawer__tete button[aria-label="Fermer le panneau"]')); };

test("bouton Aide : visible en permanence dans la barre latérale, accessible au clavier", async () => {
  await monter("/accueil");
  await attendre(() => boutonAide());
  assert.ok(boutonAide(), "bouton « ? Aide » présent");
  assert.equal(boutonAide().tagName, "BUTTON", "un vrai bouton, atteignable au clavier");
});

test("panneau : s'ouvre, propose les trois accès, aide adaptée à la route, se ferme", async () => {
  await monter("/sessions");
  await attendre(() => boutonAide());
  await ouvrirAide();
  assert.equal(titreDrawer(), "Aide Vigie");
  assert.ok(bouton("Aide de cette page") && bouton("Découvrir Vigie") && bouton("Guide complet"), "trois accès");
  assert.ok(texte().includes("La liste des sessions"), "contenu de la page Sessions affiché");
  await fermer();
  await attendre(() => !dialogue());
});

test("aide adaptée à la route : Preuves", async () => {
  await monter("/preuves");
  await attendre(() => boutonAide());
  await ouvrirAide();
  await attendre(() => texte().includes("Par indicateur"));
  assert.ok(texte().includes("Statuts et échéances"));
});

test("guide : l'admin voit les paramètres, le contributeur non", async () => {
  await monter("/accueil", "admin");
  await ouvrirAide();
  await cliquer(bouton("Guide complet"));
  await attendre(() => texte().includes("Paramètres admin"));
  await demonter();

  await monter("/accueil", "contributeur");
  await ouvrirAide();
  await cliquer(bouton("Guide complet"));
  await attendre(() => texte().includes("Sessions"));
  assert.ok(!texte().includes("Paramètres admin"), "le contributeur ne voit pas la rubrique admin");
});

test("guide : recherche simple", async () => {
  await monter("/accueil", "admin");
  await ouvrirAide();
  await cliquer(bouton("Guide complet"));
  await attendre(() => texte().includes("Paramètres admin"));
  await saisir(document.querySelector('.ui-drawer input[type="search"]'), "archivage");
  await attendre(() => !texte().includes("Paramètres admin"));
  assert.ok(texte().includes("Cycle de vie"));
});

test("tutoriel : Suivant / Précédent, puis Terminer marque localStorage", async () => {
  await monter("/accueil");
  await ouvrirAide();
  await cliquer(bouton("Découvrir Vigie"));
  await attendre(() => titreDrawer()?.includes("(1/7)"));

  await cliquer(bouton("Suivant"));
  await attendre(() => titreDrawer()?.includes("(2/7)"));
  assert.ok(bouton("Précédent") && !bouton("Précédent").disabled);

  await cliquer(bouton("Précédent"));
  await attendre(() => titreDrawer()?.includes("(1/7)"));
  assert.ok(bouton("Précédent").disabled, "Précédent désactivé à la première étape");

  for (let i = 0; i < 6; i++) {
    await cliquer(bouton("Suivant"));
    await attendre(() => titreDrawer()?.includes(`(${i + 2}/7)`));
  }
  await cliquer(bouton("Terminer"));
  await attendre(() => !document.querySelector(".ui-drawer"));
  assert.equal(window.localStorage.getItem("vigie_tutoriel_termine"), "true");
});

test("premier usage : le tutoriel s'ouvre automatiquement, quittable d'un clic", async () => {
  await monter("/accueil", "admin", {}, { premierUsage: true });
  await attendre(() => titreDrawer()?.includes("(1/7)"));
  await fermer();
  await attendre(() => !document.querySelector(".ui-drawer"));
  assert.equal(window.localStorage.getItem("vigie_tutoriel_termine"), "true", "quitter marque le tutoriel comme terminé");
});

test("relancer le tutoriel depuis l'aide", async () => {
  await monter("/accueil");
  await ouvrirAide();
  await cliquer(bouton("Découvrir Vigie"));
  await attendre(() => titreDrawer()?.includes("(1/7)"));
});

test("localStorage indisponible : l'application continue, sans tutoriel bloquant", async () => {
  const descripteur = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    value: { getItem: () => { throw new Error("stockage bloqué"); }, setItem: () => {}, removeItem: () => {}, clear: () => {} },
    configurable: true,
  });
  try {
    assert.equal(tutorielTermine(), true, "tutorielTermine() est sûr quand le stockage échoue");
    await monter("/accueil", "admin", {}, { premierUsage: true });
    await attendre(() => document.querySelector("main"));
    assert.ok(!document.querySelector(".ui-drawer"), "aucun tutoriel : l'application continue normalement");
  } finally {
    Object.defineProperty(window, "localStorage", descripteur);
  }
});

test("petit « ? » : la durée prévue est expliquée", async () => {
  await monter("/sessions/1", "admin");
  await attendre(() => document.querySelector(".aide-info__btn"));
  await cliquer(document.querySelector(".aide-info__btn"));
  await attendre(() => texte().includes("La durée prévue est celle déclarée"));
});
