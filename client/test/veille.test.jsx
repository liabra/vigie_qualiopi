// UX-3 — Veille : liste à segments, fiche en trois temps, formulaire en
// page dédiée, sélecteur d'indicateurs, droits. API simulée ; aucune boîte
// de dialogue native.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { attendre, bouton, champ, cliquer, demonter, monter, saisir, saisirRapide, texte } from "./outils.jsx";

const IND = (id, numero, libelle) => ({ id, numero, libelle });
const REFERENTIEL = {
  version: { id: 1, code: "V9" }, totalIndicateurs: 32,
  score: { maitrise: 0, a_consolider: 0, a_risque: 0, non_applicable: 0, total: 32, preuves: 0, a_confirmer: 0 },
  criteres: [
    { id: 1, numero: 1, libelle: "Information du public", indicateurs: [IND(1001, 1, "Information accessible au public"), IND(1002, 2, "Indicateurs de résultats")] },
    { id: 5, numero: 5, libelle: "Qualification du personnel", indicateurs: [IND(1011, 11, "Atteinte des objectifs"), IND(1023, 23, "Veille légale et réglementaire"), IND(1024, 24, "Veille emplois et métiers")] },
    { id: 7, numero: 7, libelle: "Amélioration continue", indicateurs: [IND(1026, 26, "Handicap"), IND(1032, 32, "Amélioration continue")] },
  ],
};
const VEILLES = [
  { id: 1, titre: "Décret 2026-123 sur la formation continue", type: "legale_reglementaire", source: "Légifrance", date_publication: "2026-09-01",
    statut: "a_analyser", statut_action: "aucune", rupture_reglementaire: true, indicateurs: [IND(1023, 23, "Veille légale et réglementaire")] },
  { id: 2, titre: "Nouveau guide accessibilité", type: "handicap", source: "Agefiph", date_publication: "2026-08-20", url: "https://www.agefiph.fr/actu",
    resume: "Le guide évolue.\nDeux nouvelles fiches.", analyse_impact: "Mettre à jour le livret d'accueil.", statut: "analysee", statut_action: "a_realiser",
    action: "Réviser le livret d'accueil", rupture_reglementaire: false,
    indicateurs: [IND(1011, 11, "Atteinte des objectifs"), IND(1023, 23, "x"), IND(1024, 24, "x"), IND(1026, 26, "Handicap"), IND(1032, 32, "x")] },
  { id: 3, titre: "Évolution de la plateforme LMS", type: "innovations_pedagogiques", statut: "sans_impact", statut_action: "aucune", indicateurs: [] },
  { id: 4, titre: "Mise à jour des CGV", type: "autre", statut: "integree", statut_action: "realisee", action: "CGV publiées", action_realisee_le: "2026-09-10", indicateurs: [IND(1001, 1, "x")] },
];
const DETAIL_2 = {
  veille: VEILLES[1],
  preuves: [{ id: 81, titre: "Livret d'accueil v3", indicateur_id: 1011, fichiers: [{ id: 1, url: "https://drive.google.com/file/d/LIV/view", nom: "Livret.pdf" }] }],
};
const routes = (extra = {}) => ({
  "GET /api/referentiel": REFERENTIEL,
  "GET /api/veille": { veilles: VEILLES, total: VEILLES.length },
  "GET /api/veille/2": DETAIL_2,
  "GET /api/veille/5": { veille: { ...VEILLES[2], id: 5, url: "javascript:alert(1)" }, preuves: [] },
  "GET /api/veille/404": [404, { error: "Veille introuvable." }],
  ...extra,
});

let natifs = 0;
beforeEach(() => { natifs = 0; window.alert = () => { natifs++; }; window.confirm = () => { natifs++; return true; }; });
afterEach(async () => { assert.equal(natifs, 0, "aucune boîte native"); await demonter(); });

const titre = () => document.querySelector("h1")?.textContent;
const lignes = () => [...document.querySelectorAll(".veille-table tbody tr")].map((tr) => tr.textContent);
const segment = (debut) => [...document.querySelectorAll(".sess-vue")].find((b) => b.textContent.startsWith(debut));

// ── Liste ────────────────────────────────────────────────────
test("liste : statuts en toutes lettres, indicateurs compacts, bouton admin", async () => {
  await monter("/veille", "admin", routes());
  await attendre(() => lignes().length === 4);
  assert.equal(titre(), "Veille");
  assert.ok(texte().includes("Suivi réglementaire, pédagogique et qualité"));
  assert.ok(lignes()[0].includes("À analyser") && lignes()[0].includes("Rupture réglementaire") && lignes()[0].includes("01/09/2026"));
  assert.ok(lignes()[1].includes("Analysée") && lignes()[1].includes("Action à réaliser") && lignes()[1].includes("Ind. 11, 23, 24 +2"));
  assert.ok(lignes()[3].includes("Intégrée") && lignes()[3].includes("Action réalisée"));
  assert.ok(!document.querySelector(".ind-num"), "plus de pastille à une lettre");
  assert.ok(bouton("+ Nouvelle veille"));
});

test("segments : À analyser / Actions à réaliser / Traitées, dans l'URL", async () => {
  await monter("/veille", "admin", routes());
  await attendre(() => lignes().length === 4);
  await cliquer(segment("À analyser"));
  await attendre(() => lignes().length === 1 && lignes()[0].includes("Décret"));
  assert.equal(window.location.search, "?vue=a_analyser");
  await cliquer(segment("Actions à réaliser"));
  await attendre(() => lignes().length === 1 && lignes()[0].includes("guide accessibilité"));
  await cliquer(segment("Traitées"));
  await attendre(() => lignes().length === 2);
  await demonter();
  await monter("/veille?vue=actions", "admin", routes());
  await attendre(() => lignes().length === 1);
  assert.equal(document.querySelector(".sess-vue--active").getAttribute("aria-pressed"), "true");
});

test("filtres : recherche, type et indicateur ; effacement", async () => {
  await monter("/veille", "admin", routes());
  await attendre(() => lignes().length === 4);
  await saisir(champ("Rechercher"), "agefiph");
  await attendre(() => lignes().length === 1);
  await saisir(champ("Rechercher"), "");
  await saisir(champ("Type"), "autre");
  await attendre(() => lignes().length === 1 && lignes()[0].includes("CGV"));
  await saisir(champ("Type"), "");
  await saisir(champ("Indicateur"), "23");
  await attendre(() => lignes().length === 2);
  await saisir(champ("Rechercher"), "introuvable");
  await attendre(() => texte().includes("Aucune veille ne correspond à ces filtres."));
  await cliquer(bouton("Effacer les filtres"));
  await attendre(() => lignes().length === 4);
});

test("saisie rapide : aucun caractère perdu, recherche conservée au changement de segment", async () => {
  await monter("/veille", "admin", routes());
  await attendre(() => lignes().length === 4);
  await saisirRapide(document.querySelector('input[type="search"]'), "agefiph");
  await attendre(() => new URLSearchParams(window.location.search).get("q") === "agefiph");
  assert.equal(document.querySelector('input[type="search"]').value, "agefiph", "aucun caractère perdu");
  assert.equal(new URLSearchParams(window.location.search).get("q"), "agefiph");
  await cliquer(segment("Actions à réaliser"));
  await attendre(() => new URLSearchParams(window.location.search).get("vue") === "actions");
  assert.equal(document.querySelector('input[type="search"]').value, "agefiph", "recherche conservée après changement de segment");
  assert.equal(new URLSearchParams(window.location.search).get("q"), "agefiph", "paramètre q conservé dans l'URL");
});

test("états vides : aucune entrée, segment vide", async () => {
  await monter("/veille", "admin", routes({ "GET /api/veille": { veilles: [], total: 0 } }));
  await attendre(() => texte().includes("Aucune entrée de veille"));
  assert.ok(document.querySelector(".ui-empty a[href='/veille/nouvelle']"));
  await demonter();
  await monter("/veille?vue=a_analyser", "admin", routes({ "GET /api/veille": { veilles: VEILLES.slice(1), total: 3 } }));
  await attendre(() => texte().includes("Aucune veille à analyser"));
});

// ── Fiche ────────────────────────────────────────────────────
test("fiche : lien direct, trois temps, statuts, indicateurs, lien externe, preuves liées", async () => {
  await monter("/veille/2", "admin", routes());
  await attendre(() => titre() === "Nouveau guide accessibilité");
  assert.deepEqual([...document.querySelectorAll(".veille-etape__titre")].map((h) => h.textContent), ["1S'informer", "2Analyser", "3Agir"]);
  assert.ok(texte().includes("Analysée") && texte().includes("Action à réaliser"));
  assert.ok(texte().includes("Indicateur 26 — Handicap"));
  assert.ok(texte().includes("Réviser le livret d'accueil"));
  const lien = document.querySelector("a.veille-lien-externe");
  assert.equal(lien.getAttribute("href"), "https://www.agefiph.fr/actu");
  assert.equal(lien.getAttribute("target"), "_blank");
  assert.ok(lien.getAttribute("rel").includes("noopener"));
  assert.ok(lien.textContent.includes("site externe"), "lien externe annoncé");
  assert.ok(texte().includes("Livret d'accueil v3") && texte().includes("Indicateur 11"), "numéro d'indicateur, pas l'identifiant");
  assert.ok(document.querySelector('a[href="https://drive.google.com/file/d/LIV/view"]'));
  assert.equal(document.title, "Nouveau guide accessibilité — Vigie Qualiopi");
});

test("fiche : une URL non http(s) n'est jamais rendue en lien", async () => {
  await monter("/veille/5", "admin", routes());
  await attendre(() => texte().includes("javascript:alert(1)"));
  assert.ok(![...document.querySelectorAll("a")].some((a) => (a.getAttribute("href") || "").startsWith("javascript:")));
});

test("fiche inexistante : page propre", async () => {
  await monter("/veille/404", "admin", routes());
  await attendre(() => texte().includes("Cette veille n'existe pas ou n'existe plus."));
});

// ── Admin : création / modification ──────────────────────────
test("création : validation, indicateurs cochés, rupture, envoi puis fiche", async () => {
  const appels = await monter("/veille/nouvelle", "admin", routes({
    "POST /api/veille": { veille: { id: 99 } },
    "GET /api/veille/99": { veille: { ...VEILLES[0], id: 99, titre: "Arrêté test" }, preuves: [] },
  }));
  await attendre(() => titre() === "Nouvelle veille" && document.querySelector(".indic-groupe"));
  await cliquer(bouton("Enregistrer"));
  await attendre(() => texte().includes("Indiquez un titre."));
  assert.equal(appels.filter((a) => a.methode === "POST").length, 0);

  await saisir(champ("Titre"), "Arrêté test");
  await saisir(champ("Type"), "legale_reglementaire");
  await saisir(champ("Lien"), "https://www.legifrance.gouv.fr/a");
  await cliquer([...document.querySelectorAll(".indic-groupe__tete")].find((b) => b.textContent.includes("Critère 5")));
  await cliquer(document.querySelector(".indic-groupe__liste input"));
  await cliquer([...document.querySelectorAll('input[name="rupture"]')][0]);
  await cliquer([...document.querySelectorAll('input[name="statut_action"]')].find((r) => r.value === "realisee"));
  await saisir(champ("Action à mener"), "Procédure mise à jour");
  await saisir(champ("Date de réalisation"), "2026-09-20");
  await cliquer(bouton("Enregistrer"));
  await attendre(() => window.location.pathname === "/veille/99" && texte().includes("Veille créée."));
  const post = appels.find((a) => a.methode === "POST" && a.chemin === "/api/veille").corps;
  assert.deepEqual(
    { t: post.titre, ty: post.type, i: post.indicateur_ids, r: post.rupture_reglementaire, s: post.statut_action, d: post.action_realisee_le, a: post.action },
    { t: "Arrêté test", ty: "legale_reglementaire", i: [1011], r: true, s: "realisee", d: "2026-09-20", a: "Procédure mise à jour" },
  );
});

test("modification : préremplie ; repasser l'action à « aucune » envoie une date nulle", async () => {
  const appels = await monter("/veille/2/modifier", "admin", routes({ "PATCH /api/veille/2": { veille: { id: 2 } } }));
  await attendre(() => champ("Titre")?.value === "Nouveau guide accessibilité");
  assert.equal(document.querySelector(".indic-selecteur__compteur").textContent, "5 indicateur(s) sélectionné(s)");
  await cliquer([...document.querySelectorAll('input[name="statut_action"]')].find((r) => r.value === "aucune"));
  await cliquer(bouton("Enregistrer les modifications"));
  await attendre(() => window.location.pathname === "/veille/2" && texte().includes("Modifications enregistrées."));
  const patch = appels.find((a) => a.methode === "PATCH").corps;
  assert.equal(patch.statut_action, "aucune");
  assert.equal(patch.action_realisee_le, null);
  assert.deepEqual(patch.indicateur_ids.sort(), [1011, 1023, 1024, 1026, 1032]);
});

test("erreur serveur : message près des boutons, pas de navigation", async () => {
  await monter("/veille/2/modifier", "admin", routes({ "PATCH /api/veille/2": [400, { error: "Une action réalisée doit avoir un libellé d'action." }] }));
  await attendre(() => champ("Titre")?.value);
  await cliquer(bouton("Enregistrer les modifications"));
  await attendre(() => document.querySelector(".veille-form__actions")?.textContent.includes("Une action réalisée doit avoir un libellé d'action."));
  assert.equal(window.location.pathname, "/veille/2/modifier");
  assert.equal(bouton("Enregistrer les modifications").disabled, false, "le bouton redevient actif");
});

// ── Sélecteur d'indicateurs ──────────────────────────────────
test("sélecteur : groupes par critère, recherche, sélection et désélection", async () => {
  await monter("/veille/nouvelle", "admin", routes());
  await attendre(() => document.querySelector(".indic-groupe"));
  assert.deepEqual([...document.querySelectorAll(".indic-groupe__titre")].map((t) => t.textContent), ["Critère 1", "Critère 5", "Critère 7"]);
  assert.ok(!document.querySelector('select[multiple]'), "plus de select multiple natif");
  assert.equal(document.querySelectorAll(".indic-groupe__liste").length, 0, "groupes repliés par défaut");
  await saisir(document.querySelector(".indic-selecteur input[type='search']"), "objectifs");
  await attendre(() => document.querySelectorAll(".indic-groupe").length === 1);
  await cliquer(document.querySelector(".indic-groupe__liste input"));
  await attendre(() => texte().includes("1 indicateur(s) sélectionné(s)"));
  assert.ok(document.querySelector('button[aria-label="Retirer l\'indicateur 11"]'));
  await saisir(document.querySelector(".indic-selecteur input[type='search']"), "");
  await cliquer([...document.querySelectorAll(".indic-groupe__tete")].find((b) => b.textContent.includes("Critère 7")));
  await cliquer(document.querySelector(".indic-groupe__liste input"));
  await attendre(() => texte().includes("2 indicateur(s) sélectionné(s)"));
  await cliquer(document.querySelector('button[aria-label="Retirer l\'indicateur 11"]'));
  await attendre(() => texte().includes("1 indicateur(s) sélectionné(s)"));
  await cliquer(bouton("Tout désélectionner"));
  await attendre(() => texte().includes("Aucun indicateur sélectionné"));
});

// ── Contributeur ─────────────────────────────────────────────
test("contributeur : lecture seule ; création et modification réservées", async () => {
  await monter("/veille", "contributeur", routes());
  await attendre(() => lignes().length === 4);
  assert.ok(!bouton("+ Nouvelle veille"));
  await demonter();
  await monter("/veille/2", "contributeur", routes());
  await attendre(() => titre() === "Nouveau guide accessibilité");
  assert.ok(!bouton("Modifier") && !bouton("Rattacher une preuve"), "aucune action d'écriture");
  await demonter();
  for (const chemin of ["/veille/nouvelle", "/veille/2/modifier"]) {
    await monter(chemin, "contributeur", routes());
    await attendre(() => texte().includes("Cette page est réservée aux administrateurs."));
    await demonter();
  }
});

test("navigation : liste → fiche → précédent", async () => {
  await monter("/veille?vue=actions", "admin", routes());
  await attendre(() => lignes().length === 1);
  await cliquer(document.querySelector('.veille-table a[href="/veille/2"]'));
  await attendre(() => titre() === "Nouveau guide accessibilité");
  await act(async () => { window.history.back(); });
  await attendre(() => window.location.search === "?vue=actions" && lignes().length === 1);
});
