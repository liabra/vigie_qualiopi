// Après VF — tutoriel guidé : chaque étape amène sa page réelle derrière le
// panneau (React Router), le panneau reste ouvert, l'étape et le focus sont
// conservés. Le lancement est protégé si un formulaire métier est ouvert.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, monter, texte } from "./outils.jsx";
import { dialogueMetierEnCours } from "../src/ui/dialogue.js";

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

const titreDrawer = () => document.querySelector(".ui-drawer__titre")?.textContent;
const chemin = () => window.location.pathname;
const texteEtape = () => document.querySelector(".aide-tutoriel__texte")?.textContent;

test("démarrage : l'étape 1 amène la page /accueil derrière le panneau", async () => {
  await monter("/preuves", "admin", {}, { premierUsage: true });
  await attendre(() => titreDrawer()?.includes("(1/7)"));
  await attendre(() => chemin() === "/accueil");
  assert.equal(chemin(), "/accueil");
  assert.ok(texteEtape()?.includes("Vigie aide A2C"), "le panneau reste ouvert sur l'étape 1");
});

test("Suivant : Les sessions => /sessions, panneau toujours ouvert", async () => {
  await monter("/accueil", "admin", {}, { premierUsage: true });
  await attendre(() => titreDrawer()?.includes("(1/7)"));
  await cliquer(bouton("Suivant"));
  await attendre(() => titreDrawer()?.includes("(2/7)"));
  await cliquer(bouton("Suivant"));
  await attendre(() => titreDrawer()?.includes("(3/7)"));
  await attendre(() => chemin() === "/sessions");
  assert.equal(chemin(), "/sessions");
  assert.ok(document.querySelector(".ui-drawer"), "le tutoriel reste ouvert après navigation");
});

test("Suivant : Les preuves => /preuves puis La veille => /veille", async () => {
  await monter("/accueil", "admin", {}, { premierUsage: true });
  await attendre(() => titreDrawer()?.includes("(1/7)"));
  for (let i = 0; i < 3; i++) {
    await cliquer(bouton("Suivant"));
    await attendre(() => titreDrawer()?.includes(`(${i + 2}/7)`));
  }
  await attendre(() => chemin() === "/preuves");
  assert.equal(chemin(), "/preuves");
  await cliquer(bouton("Suivant"));
  await attendre(() => titreDrawer()?.includes("(5/7)"));
  await attendre(() => chemin() === "/veille");
  assert.equal(chemin(), "/veille");
});

test("Précédent : revient en arrière ET change la page derrière", async () => {
  await monter("/accueil", "admin", {}, { premierUsage: true });
  await attendre(() => titreDrawer()?.includes("(1/7)"));
  for (let i = 0; i < 4; i++) {
    await cliquer(bouton("Suivant"));
    await attendre(() => titreDrawer()?.includes(`(${i + 2}/7)`));
  }
  await attendre(() => chemin() === "/veille");
  await cliquer(bouton("Précédent"));
  await attendre(() => titreDrawer()?.includes("(4/7)"));
  await attendre(() => chemin() === "/preuves");
  assert.equal(chemin(), "/preuves");
  assert.equal(titreDrawer()?.includes("(4/7)"), true, "le numéro d'étape est conservé");
});

test("fin du tutoriel : on reste sur /accueil, sans redirection", async () => {
  await monter("/accueil", "admin", {}, { premierUsage: true });
  await attendre(() => titreDrawer()?.includes("(1/7)"));
  for (let i = 0; i < 6; i++) {
    await cliquer(bouton("Suivant"));
    await attendre(() => titreDrawer()?.includes(`(${i + 2}/7)`));
  }
  await cliquer(bouton("Terminer"));
  await attendre(() => !document.querySelector(".ui-drawer"));
  assert.equal(chemin(), "/accueil");
});

test("contributeur : même parcours guidé, sans contenu admin", async () => {
  await monter("/accueil", "contributeur", {}, { premierUsage: true });
  await attendre(() => titreDrawer()?.includes("(1/7)"));
  await cliquer(bouton("Suivant"));
  await attendre(() => titreDrawer()?.includes("(2/7)"));
  assert.ok(!(texteEtape() || "").includes("paramètres"), "aucune mention admin dans l'étape Navigation");
  await cliquer(bouton("Suivant"));
  await attendre(() => titreDrawer()?.includes("(3/7)"));
  await attendre(() => chemin() === "/sessions");
  assert.equal(chemin(), "/sessions");
  assert.ok(document.querySelector(".ui-drawer"), "tutoriel ouvert");
});

test("l'aide et le tutoriel ne comptent pas comme formulaire métier", async () => {
  await monter("/accueil", "admin");
  await cliquer(document.querySelector(".shell-aide"));
  await attendre(() => titreDrawer() === "Aide Vigie");
  assert.equal(dialogueMetierEnCours(), false, "l'aide ouverte n'est pas un formulaire métier");
});

test("lancement protégé si un formulaire métier est ouvert", async () => {
  await monter("/sessions", "admin");
  await attendre(() => bouton("+ Nouvelle session"));
  await cliquer(bouton("+ Nouvelle session"));
  await attendre(() => titreDrawer() === "Nouvelle session");
  assert.equal(dialogueMetierEnCours(), true, "le formulaire de création est détecté");

  await cliquer(document.querySelector(".shell-aide"));
  await attendre(() => bouton("Découvrir Vigie"));
  await cliquer(bouton("Découvrir Vigie"));
  await attendre(() => texte().includes("Un formulaire est actuellement ouvert"));
  assert.ok(!document.querySelector(".aide-tutoriel__texte"), "le tutoriel ne démarre pas");
});
