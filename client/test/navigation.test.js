// Navigation : ce qu'un rôle voit, le fil d'Ariane, et le chemin de retour
// après connexion (jamais une URL externe ni l'API).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cheminRetourValide, contexteDe, navigationPour } from "../src/navigation.js";

const liens = (role) => navigationPour(role).flatMap((g) => g.entrees.map((e) => e.to));

test("admin : toutes les entrées, dont Formations et le groupe Paramètres", () => {
  assert.deepEqual(liens("admin"), [
    "/accueil", "/sessions", "/formations", "/indicateurs", "/preuves", "/veille", "/audits",
    "/modeles", "/prescripteurs", "/versions", "/parametres/google",
  ]);
  assert.ok(navigationPour("admin").some((g) => g.titre === "Paramètres"));
});

test("contributeur : aucune entrée d'administration, aucun groupe Paramètres", () => {
  assert.deepEqual(liens("contributeur"), ["/accueil", "/sessions", "/indicateurs", "/preuves", "/veille", "/audits"]);
  assert.ok(!navigationPour("contributeur").some((g) => g.titre === "Paramètres"));
});

test("rôle inconnu : traité comme non administrateur", () => {
  assert.ok(!liens(undefined).includes("/modeles"));
});

test("fil d'Ariane : préfixe le plus long, sous-pages de session comprises", () => {
  assert.deepEqual(contexteDe("/sessions/12/assiduite"), { groupe: "Formation", page: "Sessions", to: "/sessions" });
  assert.deepEqual(contexteDe("/parametres/google"), { groupe: "Paramètres", page: "Google Drive", to: "/parametres/google" });
  assert.equal(contexteDe("/nimporte-quoi"), null);
  assert.equal(contexteDe("/sessionsX"), null, "pas de faux préfixe");
});

test("retour après connexion : seulement un chemin interne à l'application", () => {
  for (const ok of ["/sessions/1", "/veille?statut=a_analyser", "/parametres/google"]) assert.equal(cheminRetourValide(ok), true, ok);
  for (const ko of [null, "", "/", "/?erreur=x", "//exemple.com", "https://exemple.com", "/\\exemple.com",
    "/api/me", "/auth/google/login", "/api", "sessions/1"]) {
    assert.equal(cheminRetourValide(ko), false, String(ko));
  }
});
