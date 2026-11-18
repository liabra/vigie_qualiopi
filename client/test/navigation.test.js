// Navigation : les 5 espaces et leurs rubriques par rôle, l'espace courant,
// le fil d'Ariane, et le chemin de retour après connexion (jamais une URL
// externe ni l'API).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ESPACES, cheminRetourValide, contexteDe, espacesPour, positionDe } from "../src/navigation.js";

const espaces = (role) => espacesPour(role).map((e) => e.libelle);
const rubriques = (role, id) => espacesPour(role).find((e) => e.id === id)?.pages.map((p) => p.to);

test("admin : 5 espaces, dans l'ordre", () => {
  assert.deepEqual(espaces("admin"), ["Aujourd'hui", "Formations", "Qualiopi", "Équipe", "Réglages"]);
});

test("contributeur : seulement « Aujourd'hui » et « Formations », sans rubrique d'administration", () => {
  assert.deepEqual(espaces("contributeur"), ["Aujourd'hui", "Formations"]);
  assert.deepEqual(rubriques("contributeur", "formations"), ["/sessions", "/jeunes"]);
  assert.deepEqual(rubriques("contributeur", "aujourdhui"), ["/aujourdhui", "/taches", "/echeancier"]);
});

test("rôle inconnu : traité comme un contributeur (refus par défaut)", () => {
  assert.deepEqual(espaces(undefined), ["Aujourd'hui", "Formations"]);
  assert.deepEqual(espaces("pirate"), ["Aujourd'hui", "Formations"]);
});

test("auditeur : seulement les dossiers d'audit", () => {
  assert.deepEqual(espacesPour("auditeur").flatMap((e) => e.pages.map((p) => p.to)), ["/portail-audit"]);
});

test("aucune ancienne page n'est perdue : chaque adresse d'avant est rangée dans un espace", () => {
  const toutes = ESPACES.flatMap((e) => e.pages.map((p) => p.to));
  for (const ancienne of ["/sessions", "/jeunes", "/formations", "/intervenants", "/justificatifs-intervenants", "/candidatures", "/acces-portails",
    "/tableau-de-bord-qualite", "/indicateurs", "/preuves", "/veille", "/audits", "/actions-qualite", "/signalements-qualite", "/synthese-satisfactions",
    "/enquetes", "/preuves-pdf", "/taches", "/echeancier", "/risques", "/preparation-audit", "/developpement-intervenants", "/partenaires", "/ressources",
    "/variables-documentaires", "/modeles", "/prescripteurs", "/questionnaires", "/versions", "/parametres/organisme", "/parametres/comptes",
    "/parametres/rgpd", "/parametres/google", "/parametres/inventaire-drive"]) {
    assert.ok(toutes.includes(ancienne), ancienne);
  }
  assert.equal(new Set(toutes).size, toutes.length, "une adresse n'appartient qu'à un espace");
});

test("espace courant : préfixe le plus long, sous-pages comprises, selon le rôle", () => {
  assert.equal(positionDe("/sessions/12/assiduite", "admin").espace.id, "formations");
  assert.equal(positionDe("/sessions/12/assiduite", "admin").page.to, "/sessions");
  assert.equal(positionDe("/actions-qualite/4", "admin").espace.id, "qualiopi");
  assert.equal(positionDe("/indicateurs/non-applicables", "admin").page.to, "/indicateurs");
  assert.equal(positionDe("/parametres/google", "admin").espace.id, "reglages");
  assert.equal(positionDe("/actions-qualite/4", "contributeur"), null, "hors du menu du contributeur");
  assert.equal(positionDe("/sessionsX", "admin"), null, "pas de faux préfixe");
});

test("fil d'Ariane : [espace, rubrique] ; l'espace n'est pas répété quand il porte le même nom", () => {
  assert.deepEqual(contexteDe("/sessions/12/assiduite"), { groupe: "Formations", page: "Sessions", to: "/sessions" });
  assert.deepEqual(contexteDe("/parametres/google"), { groupe: "Réglages", page: "Google Drive", to: "/parametres/google" });
  assert.deepEqual(contexteDe("/preuves"), { groupe: "Qualiopi", page: "Toutes les preuves", to: "/preuves" });
  assert.deepEqual(contexteDe("/reglages"), { groupe: null, page: "Réglages", to: "/reglages" });
  assert.equal(contexteDe("/nimporte-quoi"), null);
});

test("retour après connexion : seulement un chemin interne à l'application", () => {
  for (const ok of ["/sessions/1", "/veille?statut=a_analyser", "/parametres/google", "/aujourdhui"]) assert.equal(cheminRetourValide(ok), true, ok);
  for (const ko of [null, "", "/", "/?erreur=x", "//exemple.com", "https://exemple.com", "/\\exemple.com",
    "/api/me", "/auth/google/login", "/api", "sessions/1"]) {
    assert.equal(cheminRetourValide(ko), false, String(ko));
  }
});
