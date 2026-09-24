// UX-2 — Sessions : liste, création, détail à onglets, droits et règles
// métier conservées. API simulée ; aucune boîte de dialogue native.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { attendre, bouton, champ, cliquer, demonter, dialogue, monter, saisir, saisirRapide, texte, touche } from "./outils.jsx";

let natifs = 0;
beforeEach(() => {
  natifs = 0;
  window.alert = () => { natifs++; };
  window.confirm = () => { natifs++; return true; };
});
afterEach(async () => {
  assert.equal(natifs, 0, "aucun window.alert / window.confirm dans Sessions");
  await demonter();
});

const titre = () => document.querySelector("h1")?.textContent;
const lignes = () => [...document.querySelectorAll(".sess-table tbody tr")].map((tr) => tr.textContent);

// ── Liste ────────────────────────────────────────────────────
test("liste : tableau des sessions, statut en toutes lettres, action principale admin", async () => {
  await monter("/sessions");
  await attendre(() => lignes().length === 3);
  assert.equal(titre(), "Sessions");
  assert.ok(texte().includes("Gestion des sessions de formation"));
  assert.ok(lignes()[0].includes("SESS-TEST") && lignes()[0].includes("En cours") && lignes()[0].includes("du 01/09/2026 au 15/12/2026"));
  assert.ok(bouton("+ Nouvelle session"), "bouton Nouvelle session (admin)");
  assert.ok(!document.querySelector("form"), "aucun formulaire de création ouvert en permanence");
});

test("liste : vues par statut et recherche, conservées dans l'URL", async () => {
  await monter("/sessions");
  await attendre(() => lignes().length === 3);
  await cliquer([...document.querySelectorAll(".sess-vue")].find((b) => b.textContent.startsWith("En cours")));
  await attendre(() => lignes().length === 1);
  assert.ok(lignes()[0].includes("SESS-TEST"));
  assert.equal(window.location.search, "?vue=en_cours");
  assert.equal(document.querySelector(".sess-vue--active").getAttribute("aria-pressed"), "true");
  await demonter();

  await monter("/sessions?vue=terminees");
  await attendre(() => lignes().length === 1 && lignes()[0].includes("SESS-FINIE"));
  await cliquer([...document.querySelectorAll(".sess-vue")].find((b) => b.textContent.startsWith("Toutes")));
  await saisir(document.querySelector('input[type="search"]'), "villeurbanne");
  await attendre(() => lignes().length === 1 && lignes()[0].includes("SESS-AVENIR"));
  await saisir(document.querySelector('input[type="search"]'), "introuvable");
  await attendre(() => texte().includes("Aucune session ne correspond à ces filtres."));
  await cliquer(bouton("Effacer les filtres"));
  await attendre(() => lignes().length === 3);
});

test("saisie rapide : aucun caractère perdu, recherche conservée au changement de vue", async () => {
  await monter("/sessions");
  await attendre(() => lignes().length === 3);
  await saisirRapide(document.querySelector('input[type="search"]'), "agefiph");
  await attendre(() => new URLSearchParams(window.location.search).get("q") === "agefiph");
  assert.equal(document.querySelector('input[type="search"]').value, "agefiph", "aucun caractère perdu");
  assert.equal(new URLSearchParams(window.location.search).get("q"), "agefiph");
  await cliquer([...document.querySelectorAll(".sess-vue")].find((b) => b.textContent.startsWith("En cours")));
  await attendre(() => new URLSearchParams(window.location.search).get("vue") === "en_cours");
  assert.equal(document.querySelector('input[type="search"]').value, "agefiph", "recherche conservée après changement de vue");
  assert.equal(new URLSearchParams(window.location.search).get("q"), "agefiph", "paramètre q conservé dans l'URL");
});

test("liste vide : état vide avec action pour l'admin", async () => {
  await monter("/sessions", "admin", { "GET /api/sessions": { sessions: [], total: 0 } });
  await attendre(() => texte().includes("Aucune session"));
  assert.equal([...document.querySelectorAll(".ui-empty button")].length, 1);
});

test("contributeur : pas de bouton Nouvelle session", async () => {
  await monter("/sessions", "contributeur");
  await attendre(() => lignes().length === 3);
  assert.ok(!bouton("+ Nouvelle session"), "pas de bouton Nouvelle session");
});

// ── Création ─────────────────────────────────────────────────
test("création : panneau, validation, envoi puis ouverture de la nouvelle session", async () => {
  const appels = await monter("/sessions", "admin", { "POST /api/sessions": { session: { id: 42 } } });
  await attendre(() => lignes().length === 3);
  const declencheur = bouton("+ Nouvelle session");
  await cliquer(declencheur);
  await attendre(() => dialogue()?.textContent.includes("Nouvelle session") && champ("Formation")?.options.length === 2);
  for (const l of ["Formation", "Référence", "Date de début", "Date de fin", "Horaire", "Durée prévue (heures)", "Lieu", "Formateur"]) {
    assert.ok(champ(l), `champ « ${l} » avec libellé`);
  }
  await cliquer(bouton("Créer la session"));
  await attendre(() => texte().includes("Choisissez une formation."));
  assert.ok(texte().includes("La date de début est obligatoire."));
  assert.equal(appels.filter((a) => a.methode === "POST").length, 0, "rien n'est envoyé si le formulaire est incomplet");

  await saisir(champ("Formation"), "7");
  await saisir(champ("Date de début"), "2027-02-01");
  await saisir(champ("Date de fin"), "2027-03-01");
  await saisir(champ("Lieu"), "Bron");
  await cliquer(bouton("Créer la session"));
  await attendre(() => window.location.pathname === "/sessions/42");
  const post = appels.find((a) => a.methode === "POST" && a.chemin === "/api/sessions");
  assert.deepEqual({ f: post.corps.formation_id, d: post.corps.date_debut, l: post.corps.lieu, h: post.corps.duree_heures_reelle }, { f: 7, d: "2027-02-01", l: "Bron", h: null });
  assert.ok(!dialogue(), "panneau refermé");
});

test("création : erreur serveur affichée dans le panneau ; Échap referme et rend le focus", async () => {
  await monter("/sessions", "admin", { "POST /api/sessions": [409, { error: "Cette référence est déjà utilisée par une autre session." }] });
  await attendre(() => lignes().length === 3);
  const declencheur = bouton("+ Nouvelle session");
  declencheur.focus();
  await cliquer(declencheur);
  await attendre(() => champ("Formation")?.options.length === 2);
  await saisir(champ("Formation"), "7");
  await saisir(champ("Date de début"), "2027-02-01");
  await saisir(champ("Date de fin"), "2027-03-01");
  await cliquer(bouton("Créer la session"));
  await attendre(() => dialogue()?.textContent.includes("Cette référence est déjà utilisée"));
  assert.equal(window.location.pathname, "/sessions");
  await touche("Escape");
  await attendre(() => dialogue() === null);
  assert.ok(document.activeElement === declencheur, "focus rendu au déclencheur");
});

// ── Détail et onglets ────────────────────────────────────────
test("détail : en-tête complet, fil d'Ariane, onglets et vue d'ensemble", async () => {
  await monter("/sessions/1");
  await attendre(() => titre() === "Formation test");
  const t = texte();
  for (const x of ["SESS-TEST", "En cours", "du 01/09/2026 au 15/12/2026", "35 h", "9h–17h", "Lyon", "M. Durand"]) assert.ok(t.includes(x), x);
  assert.deepEqual(
    [...document.querySelectorAll('nav[aria-label="Fil d\'Ariane"] li')].map((l) => l.textContent),
    ["Formation", "Sessions", "SESS-TEST"],
  );
  const onglets = [...document.querySelectorAll('nav[aria-label="Sections de la session"] a')];
  assert.deepEqual(onglets.map((a) => a.childNodes[0].textContent), ["Vue d'ensemble", "Stagiaires", "Assiduité", "Évaluations", "Satisfaction", "Documents"]);
  assert.equal(document.querySelector('nav[aria-label="Sections de la session"] a[aria-current="page"]').textContent, "Vue d'ensemble");
  assert.ok(t.includes("Dossiers incomplets") && t.includes("Générés par Vigie"));
  assert.equal(document.title, "SESS-TEST — Vigie Qualiopi");
});

test("onglets : chaque URL affiche son contenu ; clic, précédent et lien direct", async () => {
  const attendus = {
    "/sessions/1/stagiaires": "Martin Alice",
    "/sessions/1/assiduite": "90 %",
    "/sessions/1/evaluations": "QCM séance 1",
    "/sessions/1/satisfaction": "4.5 / 5",
    "/sessions/1/documents": "Documents externes / EduSign",
  };
  for (const [chemin, attendu] of Object.entries(attendus)) {
    await monter(chemin);
    await attendre(() => texte().includes(attendu));
    assert.equal(document.querySelector('nav[aria-label="Sections de la session"] a[aria-current="page"]').getAttribute("href"), chemin);
    await demonter();
  }
  await monter("/sessions/1");
  await attendre(() => titre() === "Formation test");
  await cliquer(document.querySelector('a[href="/sessions/1/documents"]'));
  await attendre(() => window.location.pathname === "/sessions/1/documents" && texte().includes("Attestation - Martin"));
  await act(async () => { window.history.back(); });
  await attendre(() => window.location.pathname === "/sessions/1" && texte().includes("Dossiers incomplets"));
});

test("stagiaires : champs sensibles absents du tableau, présents dans le dossier", async () => {
  await monter("/sessions/1/stagiaires");
  await attendre(() => texte().includes("Martin Alice"));
  const tableau = document.querySelector(".sess-table").textContent;
  assert.ok(!tableau.includes("Poste adapté") && !tableau.includes("handicap"), "rien de sensible dans le tableau");
  await cliquer(document.querySelector('button[aria-label="Dossier de Alice Martin"]'));
  await attendre(() => dialogue()?.textContent.includes("Dossier de Alice Martin"));
  assert.equal(champ("Besoins d'adaptation").value, "Poste adapté");
  assert.ok(dialogue().textContent.includes("Accessibilité (confidentiel)"));
});

test("stagiaires : abandon confirmé dans l'interface, puis enregistré", async () => {
  const appels = await monter("/sessions/1/stagiaires", "admin", { "PATCH /api/inscriptions/12": { inscription: {} } });
  await attendre(() => texte().includes("Bernard Paul"));
  await cliquer(document.querySelector('button[aria-label="Déclarer l\'abandon de Paul Bernard"]'));
  await attendre(() => document.querySelector('[role="alertdialog"]'));
  assert.equal(document.activeElement.textContent, "Annuler", "focus initial sur Annuler");
  await cliquer(bouton("Déclarer l'abandon"));
  await attendre(() => appels.some((a) => a.methode === "PATCH" && a.chemin === "/api/inscriptions/12"));
  assert.deepEqual(appels.find((a) => a.methode === "PATCH").corps, { statut: "abandon" });
});

test("assiduité : synthèse, détail des absences, suppression confirmée", async () => {
  const appels = await monter("/sessions/1/assiduite", "admin", { "DELETE /api/absences/900": { ok: true } });
  await attendre(() => texte().includes("présent par défaut"));
  await cliquer(bouton("Voir les absences"));
  await attendre(() => texte().includes("Retard train"));
  await cliquer(bouton("Supprimer"));
  await attendre(() => document.querySelector('[role="alertdialog"]'));
  await cliquer(bouton("Supprimer l'absence"));
  await attendre(() => appels.some((a) => a.methode === "DELETE" && a.chemin === "/api/absences/900"));
});

// ── Droits ───────────────────────────────────────────────────
test("contributeur : aucune action d'administration, actions pédagogiques présentes", async () => {
  const verifier = async (chemin, presents, absents) => {
    await monter(chemin, "contributeur");
    await attendre(() => titre() === "Formation test");
    await attendre(() => presents.every((b) => bouton(b)));
    for (const b of absents) assert.ok(!bouton(b), `« ${b} » absent pour un contributeur`);
    await demonter();
  };
  await verifier("/sessions/1", [], ["Modifier la session"]);
  await verifier("/sessions/1/stagiaires", ["Ajouter un stagiaire", "Importer un CSV"], ["Ajouter un groupe", "Modifier la session"]);
  await verifier("/sessions/1/assiduite", ["Saisir une absence"], []);
  await verifier("/sessions/1/evaluations", ["Ajouter une évaluation"], []);
  await verifier("/sessions/1/satisfaction", ["Ajouter un recueil"], []);
  await verifier("/sessions/1/documents", ["Générer un document"], ["Rattacher un document"]);
});

// ── Règles conservées ────────────────────────────────────────
test("modification : documents peut-être obsolètes et absences au-delà de la durée → bandeaux dans la page", async () => {
  const appels = await monter("/sessions/1", "admin", {
    "PATCH /api/sessions/1": (corps) => ({ session: { ...corps, duree_heures_reelle: "2.00" }, documentsObsoletes: true, absencesDepassentDuree: true, total_heures_absence: 3.5 }),
  });
  await attendre(() => titre() === "Formation test");
  await cliquer(bouton("Modifier la session"));
  await attendre(() => champ("Statut"));
  assert.equal(champ("Lieu").value, "Lyon", "formulaire prérempli");
  await saisir(champ("Durée prévue (heures)"), "2");
  await cliquer(bouton("Enregistrer la session"));
  await attendre(() => texte().includes("Documents peut-être obsolètes"));
  assert.ok(texte().includes("1 document(s) généré(s) peuvent être obsolètes"));
  assert.ok(texte().includes("Absences supérieures à la durée prévue"));
  assert.ok(!dialogue(), "panneau refermé");
  assert.equal(appels.find((a) => a.methode === "PATCH").corps.duree_heures_reelle, "2");
});

test("modification refusée par le serveur : erreur dans le panneau, qui reste ouvert", async () => {
  await monter("/sessions/1", "admin", {
    "PATCH /api/sessions/1": [400, { error: "Impossible : 1 absence tomberait hors des nouvelles dates de la session. Corrigez d'abord leurs dates." }],
  });
  await attendre(() => titre() === "Formation test");
  await cliquer(bouton("Modifier la session"));
  await attendre(() => champ("Statut"));
  await cliquer(bouton("Enregistrer la session"));
  await attendre(() => dialogue()?.textContent.includes("hors des nouvelles dates"));
});

test("génération : 409 « déjà générés » → confirmation → remplacement, résultat détaillé", async () => {
  let n = 0;
  const appels = await monter("/sessions/1/documents", "admin", {
    "POST /api/generations": (corps) => (++n === 1
      ? [409, { error: "1 document(s) ont déjà été générés pour ce modèle sur cette session. Confirmez le remplacement." }]
      : { documents: 2, remplaces: 1, preuves: 2, marqueursNonResolus: ["{{date_fin}}"], anciensNonArchives: ["x"], remplacerRecu: corps.remplacer }),
  });
  await attendre(() => bouton("Générer un document"));
  await cliquer(bouton("Générer un document"));
  await attendre(() => champ("Modèle"));
  await saisir(champ("Modèle"), "3");
  await cliquer(bouton("Générer"));
  await attendre(() => document.querySelector('[role="alertdialog"]')?.textContent.includes("déjà été générés"));
  await cliquer(bouton("Remplacer les documents"));
  await attendre(() => texte().includes("2 document(s) généré(s), dont 1 remplacé(s)."));
  assert.ok(texte().includes("{{date_fin}}"), "marqueur non résolu signalé");
  assert.ok(texte().includes("n'ont pas pu être archivé(s)"), "ancien fichier non archivé signalé");
  const posts = appels.filter((a) => a.chemin === "/api/generations");
  assert.deepEqual(posts.map((p) => p.corps.remplacer), [false, true]);
});

test("session inexistante : page propre dans la coque", async () => {
  await monter("/sessions/999/documents");
  await attendre(() => texte().includes("Cette session n'existe pas ou n'existe plus."));
  assert.equal(titre(), "Session introuvable");
});
