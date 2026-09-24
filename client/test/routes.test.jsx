// Routage et coque : URL par écran, lien direct, retour arrière, droits de
// navigation, pages introuvable / réservée. API simulée (aucun serveur).
import "./dom.mjs";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { attendre, cliquer, demonter, liensNavigation, monter, texte } from "./outils.jsx";

afterEach(demonter);

test("« / » redirige vers /accueil pour un utilisateur connecté", async () => {
  await monter("/");
  await attendre(() => window.location.pathname === "/accueil");
  await attendre(() => document.querySelector("h1")?.textContent === "Accueil");
  assert.equal(document.title, "Accueil — Vigie Qualiopi");
});

test("/sessions affiche la liste des sessions", async () => {
  await monter("/sessions");
  await attendre(() => texte().includes("SESS-TEST"));
  assert.equal(document.querySelector("h1").textContent, "Sessions");
  assert.equal(document.querySelector('a[aria-current="page"]').textContent, "Sessions", "entrée active");
});

test("lien direct /sessions/1 : la session s'ouvre (pas de retour au référentiel)", async () => {
  await monter("/sessions/1");
  await attendre(() => texte().includes("Formation test · SESS-TEST"));
  assert.equal(window.location.pathname, "/sessions/1");
  assert.ok(texte().includes("Toutes les sessions"));
  assert.ok(!texte().includes("Référentiel V9"));
});

test("sous-page de session /sessions/1/assiduite : même session affichée", async () => {
  await monter("/sessions/1/assiduite");
  await attendre(() => texte().includes("Formation test · SESS-TEST"));
});

test("session inexistante ou identifiant invalide : état « Session introuvable »", async () => {
  await monter("/sessions/999");
  await attendre(() => texte().includes("Session introuvable"));
  await demonter();
  await monter("/sessions/abc");
  await attendre(() => texte().includes("Session introuvable"));
});

test("admin : la navigation contient Formations et les Paramètres", async () => {
  await monter("/accueil", "admin");
  await attendre(() => liensNavigation().length > 0);
  const liens = liensNavigation();
  for (const l of ["Formations", "Modèles de documents", "Prescripteurs", "Versions du référentiel", "Google Drive"]) {
    assert.ok(liens.includes(l), l);
  }
  assert.ok(texte().includes("Paramètres"));
});

test("contributeur : aucune entrée d'administration, pages réservées refusées proprement", async () => {
  await monter("/accueil", "contributeur");
  await attendre(() => liensNavigation().length > 0);
  assert.deepEqual(liensNavigation(), ["Accueil", "Sessions", "Indicateurs", "Preuves", "Veille", "Audits"]);
  assert.ok(!document.querySelector("nav").textContent.includes("Paramètres"));
  await demonter();
  for (const chemin of ["/modeles", "/formations", "/prescripteurs", "/versions", "/parametres/google"]) {
    await monter(chemin, "contributeur");
    await attendre(() => texte().includes("Cette page est réservée aux administrateurs."));
    await demonter();
  }
});

test("adresse inconnue : page « Page introuvable » dans la coque", async () => {
  await monter("/nimporte-quoi");
  await attendre(() => texte().includes("Page introuvable"));
  assert.ok(document.querySelector('nav[aria-label="Navigation principale"]'), "la navigation reste disponible");
});

test("navigation par le menu puis retour arrière du navigateur", async () => {
  await monter("/sessions");
  await attendre(() => texte().includes("SESS-TEST"));
  const veille = [...document.querySelectorAll("nav a")].find((a) => a.textContent === "Veille");
  await cliquer(veille);
  await attendre(() => window.location.pathname === "/veille");
  await attendre(() => texte().includes("Veille Qualiopi"));
  await act(async () => { window.history.back(); });
  await attendre(() => window.location.pathname === "/sessions");
  await attendre(() => texte().includes("SESS-TEST"));
  await act(async () => { window.history.forward(); });
  await attendre(() => window.location.pathname === "/veille");
});

test("ouvrir une session depuis la liste change l'URL", async () => {
  await monter("/sessions");
  await attendre(() => texte().includes("SESS-TEST"));
  await cliquer(document.querySelector('a[href="/sessions/1"]'));
  await attendre(() => window.location.pathname === "/sessions/1");
  await attendre(() => texte().includes("Formation test · SESS-TEST"));
});

test("/versions (admin) : les versions se chargent par lien direct", async () => {
  await monter("/versions");
  await attendre(() => texte().includes("Versions du référentiel") && texte().includes("Référentiel V9"));
});

test("non connecté sur un lien direct : écran de connexion, page mémorisée pour après", async () => {
  await monter("/sessions/1", null);
  await attendre(() => texte().includes("Se connecter avec Google"));
  assert.equal(window.sessionStorage.getItem("vq_retour_apres_connexion"), "/sessions/1");
});

test("après connexion (« / ») : retour à la page mémorisée", async () => {
  window.sessionStorage.setItem("vq_retour_apres_connexion", "/veille");
  await monter("/", "admin");
  await attendre(() => window.location.pathname === "/veille");
  assert.equal(window.sessionStorage.getItem("vq_retour_apres_connexion"), null, "mémoire effacée");
});

test("déconnexion : retour à l'écran de connexion", async () => {
  await monter("/sessions");
  await attendre(() => texte().includes("SESS-TEST"));
  await cliquer([...document.querySelectorAll("button")].find((b) => b.textContent === "Déconnexion"));
  await attendre(() => texte().includes("Se connecter avec Google"));
});
