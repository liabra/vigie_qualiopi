// Après VF — aide intégrée : contenu CENTRALISÉ (module pur, sans React).
import { test } from "node:test";
import assert from "node:assert/strict";
import { aideDe, etapesTutoriel, notion, rechercherGuide, rubriquesPour } from "../src/aide/contenu.js";

test("aideDe : contenu adapté à la route, préfixe le plus long gagnant", () => {
  assert.equal(aideDe("/sessions").titre, "Sessions");
  assert.equal(aideDe("/sessions/12").titre, "Détail d'une session");
  assert.equal(aideDe("/sessions/12/stagiaires").titre, "Détail d'une session");
  assert.equal(aideDe("/preuves").titre, "Preuves");
  assert.equal(aideDe("/veille").titre, "Veille");
  assert.equal(aideDe("/audits").titre, "Audits");
  assert.equal(aideDe("/indicateurs").titre, "Indicateurs");
  assert.equal(aideDe("/indicateurs/non-applicables").titre, "Indicateurs");
  assert.equal(aideDe("/formations").titre, "Formations");
  assert.equal(aideDe("/modeles").titre, "Modèles de documents");
  assert.equal(aideDe("/prescripteurs").titre, "Prescripteurs");
  assert.equal(aideDe("/versions").titre, "Versions du référentiel");
  assert.equal(aideDe("/parametres/google").titre, "Google Drive");
  assert.equal(aideDe("/accueil").titre, "Accueil");
  assert.equal(aideDe("/route-inconnue"), null);
});

test("aideDe : les contenus ne décrivent jamais une fonction inexistante", () => {
  for (const chemin of ["/sessions", "/preuves", "/veille", "/audits"]) {
    const a = aideDe(chemin);
    assert.ok(a && a.sections.length > 0, chemin);
    for (const s of a.sections) assert.ok(s.lignes.length > 0, chemin + " → " + s.titre);
  }
});

test("rubriquesPour : le guide respecte le rôle", () => {
  const admin = rubriquesPour("admin");
  const contrib = rubriquesPour("contributeur");
  assert.ok(admin.some((r) => r.id === "parametres"));
  assert.ok(!contrib.some((r) => r.id === "parametres"), "pas de rubrique admin pour un contributeur");
  assert.ok(contrib.length >= 10, "le contributeur voit les rubriques communes");
});

test("etapesTutoriel : 5 à 7 étapes, ordre stable, contenu présent", () => {
  for (const role of ["admin", "contributeur"]) {
    const e = etapesTutoriel(role);
    assert.ok(e.length >= 5 && e.length <= 7, role);
    assert.equal(e[0].titre, "Bienvenue dans Vigie");
    assert.equal(e[e.length - 1].id, "aide");
    for (const s of e) assert.ok(s.texte.length > 0, s.id);
  }
});

test("rechercherGuide : filtre insensible à la casse et aux accents", () => {
  const r = rechercherGuide("admin", "archivage");
  assert.ok(r.some((x) => x.id === "sessions"));
  assert.equal(rechercherGuide("admin", "zzzzintrouvable").length, 0);
  assert.equal(rechercherGuide("admin", "  ").length, rubriquesPour("admin").length, "recherche vide = tout");
});

test("notion : connue ou inconnue", () => {
  assert.equal(notion("duree_prevue").libelle, "Durée prévue");
  assert.equal(notion("rupture_reglementaire").libelle, "Rupture réglementaire");
  assert.equal(notion("inconnue"), null);
});
