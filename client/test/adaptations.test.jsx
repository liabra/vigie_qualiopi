// Q2-2 — Adaptations pédagogiques (onglet Parcours) et confidentialité des
// champs stagiaires réservés à l'administrateur. API simulée, données
// fictives ; aucune boîte native.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, dialogue, monter, saisir, texte, touche } from "./outils.jsx";
import { SESSION } from "./outils.jsx";
import { aujourdhuiISO } from "../src/qualite/format.js";
import { corpsAdaptation, erreursAdaptation, filtrerParcoursPar, resumeAdaptations } from "../src/sessions/parcours-format.js";

// Réponse retenue jusqu'à ouverture explicite : le double clic a lieu
// PENDANT la requête, quelle que soit la charge de la machine.
const vanne = () => { let ouvrir; const p = new Promise((r) => { ouvrir = r; }); return { attendre: () => p, ouvrir }; };

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

const RESERVE = "Mention-historique-fictive";
const ligne = (sur) => ({ statut_inscription: "inscrit", recueil_statut: null, date_recueil: null, conclusion: null, prerequis_verifies: null, positionnement_id: null,
  adaptations_total: 0, adaptations_prevues: 0, adaptations_mises_en_oeuvre: 0, adaptations_abandonnees: 0, ...sur });
const PARCOURS = {
  archivee: false, positionnements: [],
  inscriptions: [
    ligne({ inscription_id: 12, nom: "Bernard", prenom: "Paul" }),
    ligne({ inscription_id: 11, nom: "Martin", prenom: "Alice", adaptations_total: 3, adaptations_prevues: 1, adaptations_mises_en_oeuvre: 1, adaptations_abandonnees: 1 }),
  ],
};
const ADAPT = (sur) => ({ inscription_id: 11, categorie: "supports", mesure: "Supports remis en gros caractères", statut: "prevue", date_decision: "2026-09-03",
  date_mise_en_oeuvre: null, bilan: null, cree_par_nom: "Tukui", mis_a_jour_par_nom: "Tukui", ...sur });
const LISTE = { archivee: false, adaptations: [
  ADAPT({ id: 1 }),
  ADAPT({ id: 2, categorie: "modalites_evaluation", mesure: "Évaluation orale plutôt qu'écrite", statut: "mise_en_oeuvre", date_mise_en_oeuvre: "2026-09-10", bilan: null }),
  ADAPT({ id: 3, categorie: "rythme", mesure: "Temps supplémentaire", statut: "abandonnee" }),
] };
const routes = (sur = {}) => ({
  "GET /api/sessions/1/parcours": PARCOURS,
  "GET /api/inscriptions/11/adaptations": LISTE,
  "GET /api/inscriptions/12/adaptations": { archivee: false, adaptations: [] },
  ...sur,
});
const champ = (libelle) => {
  const racine = dialogue() || document;
  const l = [...racine.querySelectorAll("label")].find((x) => x.textContent.replace(/\s*\(facultatif\)/, "").trim() === libelle);
  return l ? document.getElementById(l.htmlFor) : null;
};
const lignes = () => [...document.querySelectorAll("tbody tr")];
const ouvrirAdaptations = async (nom, sur = {}, role = "admin") => {
  const appels = await monter(`/sessions/${SESSION.id}/parcours`, role, routes(sur));
  await attendre(() => document.querySelector(`button[aria-label="Adaptations de ${nom}"]`));
  await cliquer(document.querySelector(`button[aria-label="Adaptations de ${nom}"]`));
  await attendre(() => dialogue()?.textContent.includes("Adaptations pédagogiques") && !dialogue().querySelector(".ui-loading"));
  return appels;
};
const soumettre = () => cliquer(document.querySelector('button[type="submit"][form="form-adaptation"]'));
const ecritures = (appels) => appels.filter((a) => (a.methode === "POST" || a.methode === "PATCH") && a.chemin.includes("/adaptations"));
const boutonDialogue = (l) => [...dialogue().querySelectorAll("button")].find((b) => b.textContent === l);

test("pur : validation, corps complet, filtre et résumé", () => {
  assert.equal(erreursAdaptation({ categorie: "", mesure: "", statut: "prevue", date_decision: "" }).categorie, "Choisissez une catégorie.");
  assert.equal(erreursAdaptation({ categorie: "supports", mesure: "   ", statut: "prevue", date_decision: "2026-09-01" }).mesure, "Décrivez la mesure mise en place.");
  assert.equal(erreursAdaptation({ categorie: "supports", mesure: "x", statut: "mise_en_oeuvre", date_decision: "2026-09-01" }).date_mise_en_oeuvre, "Indiquez la date de mise en œuvre.");
  assert.deepEqual(corpsAdaptation({ categorie: "supports", mesure: " Mesure ", statut: "prevue", date_decision: "2026-09-01", date_mise_en_oeuvre: "", bilan: "" }),
    { categorie: "supports", mesure: "Mesure", statut: "prevue", date_decision: "2026-09-01", date_mise_en_oeuvre: null, bilan: null });
  assert.deepEqual(filtrerParcoursPar(PARCOURS.inscriptions, "adaptations").map((l) => l.inscription_id), [11]);
  assert.equal(resumeAdaptations(PARCOURS.inscriptions[1]), "3 mesures · 1 prévue · 1 mise en œuvre · 1 abandonnée");
});

test("synthèse : compteurs par inscription, filtre « Adaptations à mettre en œuvre », « Recueil à faire » conservé", async () => {
  await monter(`/sessions/${SESSION.id}/parcours`, "admin", routes());
  await attendre(() => lignes().length === 2);
  assert.ok(lignes()[1].textContent.includes("3 mesures · 1 prévue · 1 mise en œuvre · 1 abandonnée"));
  assert.ok(lignes()[0].textContent.includes("Aucune mesure"));
  assert.ok(!texte().includes("Supports remis"), "aucun texte de mesure dans la synthèse");
  const vue = (l) => [...document.querySelectorAll(".sess-vue")].find((b) => b.textContent.startsWith(l));
  await cliquer(vue("Adaptations à mettre en œuvre"));
  assert.deepEqual(lignes().map((tr) => tr.textContent.includes("Alice Martin")), [true]);
  await cliquer(vue("Recueil à faire"));
  assert.equal(lignes().length, 2);
});

test("mobile 390 px : chaque cellule porte son libellé (cartes empilées), bouton Adaptations par ligne", async () => {
  await monter(`/sessions/${SESSION.id}/parcours`, "admin", routes());
  await attendre(() => lignes().length === 2);
  for (const tr of lignes()) {
    assert.ok([...tr.querySelectorAll("td:not(.sess-table__actions)")].every((td) => td.getAttribute("data-label")), "data-label sur chaque cellule");
    assert.ok(tr.querySelector('td[data-label="Adaptations"]'));
  }
  assert.ok(document.querySelector('button[aria-label="Adaptations de Paul Bernard"]'));
});

test("panneau : liste lisible (catégorie, statut, dates, bilan, auteurs), état vide", async () => {
  await ouvrirAdaptations("Alice Martin");
  const t = dialogue().textContent;
  for (const x of ["Supports", "Prévue", "Supports remis en gros caractères", "Modalités d'évaluation", "Mise en œuvre", "mise en œuvre le 10/09/2026",
    "Mesure abandonnée", "Décidée le 03/09/2026", "Saisie par Tukui"]) assert.ok(t.includes(x), x);
  await demonter();
  await ouvrirAdaptations("Paul Bernard");
  assert.ok(dialogue().textContent.includes("Aucune adaptation"));
});

test("création : catégorie obligatoire, aide RGPD, date de décision du jour modifiable, corps exact, compteurs rechargés", async () => {
  let creee = false;
  const appels = await ouvrirAdaptations("Paul Bernard", {
    "POST /api/inscriptions/12/adaptations": (c) => { creee = true; return [201, { adaptation: { id: 9, ...c } }]; },
    "GET /api/inscriptions/12/adaptations": () => ({ archivee: false, adaptations: creee ? [ADAPT({ id: 9, inscription_id: 12 })] : [] }),
  });
  await cliquer(boutonDialogue("Ajouter une mesure"));
  await attendre(() => champ("Catégorie"));
  assert.ok(dialogue().textContent.includes("Décrivez uniquement ce qui est mis en place pour faciliter la formation. Ne saisissez aucun diagnostic ni aucune information médicale."));
  assert.equal(champ("Date de décision").value, aujourdhuiISO());
  await saisir(champ("Mesure mise en place"), "Supports remis en gros caractères");
  await soumettre();
  await attendre(() => dialogue().textContent.includes("Choisissez une catégorie."));
  assert.equal(ecritures(appels).length, 0, "aucun appel sans catégorie");
  await saisir(champ("Catégorie"), "supports");
  await saisir(champ("Date de décision"), "2026-09-03");
  const avant = appels.filter((a) => a.chemin === "/api/sessions/1/parcours").length;
  await soumettre();
  await attendre(() => dialogue()?.textContent.includes("Supports remis en gros caractères") && !champ("Catégorie"));
  assert.deepEqual(ecritures(appels)[0].corps, { categorie: "supports", mesure: "Supports remis en gros caractères", statut: "prevue", date_decision: "2026-09-03", date_mise_en_oeuvre: null, bilan: null });
  assert.equal(appels.filter((a) => a.chemin === "/api/sessions/1/parcours").length - avant, 1, "compteurs rechargés");
  assert.equal(window.location.pathname, "/sessions/1/parcours", "onglet Parcours conservé");
});

test("mise en œuvre (date exigée) puis bilan : PATCH exacts", async () => {
  const appels = await ouvrirAdaptations("Alice Martin", { "PATCH /api/inscriptions/11/adaptations/1": (c) => ({ adaptation: ADAPT({ id: 1, ...c }) }),
    "PATCH /api/inscriptions/11/adaptations/2": (c) => ({ adaptation: ADAPT({ id: 2, ...c }) }) });
  await cliquer(boutonDialogue("Marquer comme mise en œuvre"));
  await attendre(() => champ("Statut")?.value === "mise_en_oeuvre");
  assert.equal(champ("Date de mise en œuvre").value, aujourdhuiISO());
  await saisir(champ("Date de mise en œuvre"), "");
  await soumettre();
  await attendre(() => dialogue().textContent.includes("Indiquez la date de mise en œuvre."));
  assert.equal(ecritures(appels).length, 0);
  await saisir(champ("Date de mise en œuvre"), "2026-09-15");
  await soumettre();
  await attendre(() => ecritures(appels).length === 1 && !champ("Catégorie"));
  assert.deepEqual(ecritures(appels)[0], { methode: "PATCH", chemin: "/api/inscriptions/11/adaptations/1",
    corps: { categorie: "supports", mesure: "Supports remis en gros caractères", statut: "mise_en_oeuvre", date_decision: "2026-09-03", date_mise_en_oeuvre: "2026-09-15", bilan: null } });
  await cliquer(boutonDialogue("Renseigner le bilan"));
  await attendre(() => champ("Bilan"));
  await saisir(champ("Bilan"), "Mesure utile à chaque séance");
  await soumettre();
  await attendre(() => ecritures(appels).length === 2);
  assert.equal(ecritures(appels)[1].chemin, "/api/inscriptions/11/adaptations/2");
  assert.equal(ecritures(appels)[1].corps.bilan, "Mesure utile à chaque séance");
});

test("abandon de la mesure : confirmation explicite (Échap n'envoie rien), PATCH statut seul", async () => {
  const appels = await ouvrirAdaptations("Alice Martin", { "PATCH /api/inscriptions/11/adaptations/1": (c) => ({ adaptation: ADAPT({ id: 1, ...c }) }) });
  const alerte = () => document.querySelector('[role="alertdialog"]');
  await cliquer(boutonDialogue("Abandonner la mesure"));
  await attendre(() => alerte());
  assert.ok(alerte().textContent.includes("Cela ne concerne pas l'inscription du stagiaire à la formation."));
  await touche("Escape");
  await attendre(() => !alerte());
  assert.equal(ecritures(appels).length, 0);
  await cliquer(boutonDialogue("Abandonner la mesure"));
  await attendre(() => alerte());
  await cliquer([...alerte().querySelectorAll("button")].find((b) => b.textContent === "Abandonner la mesure"));
  await attendre(() => ecritures(appels).length === 1);
  assert.deepEqual(ecritures(appels)[0].corps, { statut: "abandonnee" });
});

test("erreur serveur : formulaire ouvert, saisie conservée ; double clic ⇒ un seul envoi", async () => {
  const v = vanne();
  const appels = await ouvrirAdaptations("Paul Bernard", {
    "POST /api/inscriptions/12/adaptations": async () => { await v.attendre(); return [400, { error: "Indiquez la date de décision." }]; },
  });
  await cliquer(boutonDialogue("Ajouter une mesure"));
  await attendre(() => champ("Catégorie"));
  await saisir(champ("Catégorie"), "materiel");
  await saisir(champ("Mesure mise en place"), "Équipement adapté prêté");
  const b = document.querySelector('button[type="submit"][form="form-adaptation"]');
  await cliquer(b); await cliquer(b);
  v.ouvrir();
  await attendre(() => dialogue()?.textContent.includes("La mesure n'a pas été enregistrée."));
  assert.equal(ecritures(appels).length, 1);
  assert.equal(champ("Mesure mise en place").value, "Équipement adapté prêté");
});

test("échec de chargement des adaptations : message et Réessayer", async () => {
  let n = 0;
  await monter(`/sessions/${SESSION.id}/parcours`, "admin", routes({ "GET /api/inscriptions/11/adaptations": () => (n++ === 0 ? [500, { error: "Erreur serveur." }] : LISTE) }));
  await attendre(() => document.querySelector('button[aria-label="Adaptations de Alice Martin"]'));
  await cliquer(document.querySelector('button[aria-label="Adaptations de Alice Martin"]'));
  await attendre(() => dialogue()?.textContent.includes("Les adaptations n'ont pas pu être chargées."));
  await cliquer(boutonDialogue("Réessayer"));
  await attendre(() => dialogue().textContent.includes("Supports remis en gros caractères"));
});

test("session archivée : lecture seule, aucun bouton d'écriture", async () => {
  await ouvrirAdaptations("Alice Martin", { "GET /api/sessions/1/parcours": { ...PARCOURS, archivee: true }, "GET /api/inscriptions/11/adaptations": { ...LISTE, archivee: true } });
  assert.ok(dialogue().textContent.includes("Session archivée : adaptations en lecture seule."));
  for (const l of ["Ajouter une mesure", "Modifier", "Abandonner la mesure", "Marquer comme mise en œuvre"]) assert.ok(!boutonDialogue(l), l);
});

test("contributeur : mesures opérationnelles visibles et gérables", async () => {
  await ouvrirAdaptations("Alice Martin", {}, "contributeur");
  assert.ok(dialogue().textContent.includes("Supports remis en gros caractères"));
  assert.ok(boutonDialogue("Ajouter une mesure"));
});

// ── Confidentialité des champs historiques (onglet Stagiaires) ──────

const sansReserves = (s) => { const { situation_handicap, besoins_adaptation, ...r } = s; return r; };
async function ouvrirDossier(role, sessionDetail) {
  const appels = await monter(`/sessions/${SESSION.id}/stagiaires`, role, {
    ...(sessionDetail ? { "GET /api/sessions/1": sessionDetail } : {}),
    "PATCH /api/stagiaires/101": (c) => ({ stagiaire: { id: 101, ...c } }),
  });
  await attendre(() => document.querySelector('button[aria-label="Dossier de Alice Martin"]'));
  await cliquer(document.querySelector('button[aria-label="Dossier de Alice Martin"]'));
  await attendre(() => dialogue()?.textContent.includes("Dossier de Alice Martin"));
  return appels;
}

test("contributeur : champs historiques absents du DOM et JAMAIS envoyés (pas d'effacement silencieux)", async () => {
  const { routesParDefaut } = await import("./outils.jsx");
  const detail = routesParDefaut("contributeur")["GET /api/sessions/1"];
  // Le serveur projette déjà la réponse : on simule exactement ce contrat.
  const appels = await ouvrirDossier("contributeur", { ...detail, stagiaires: detail.stagiaires.map(sansReserves) });
  assert.ok(!dialogue().textContent.includes("Situation de handicap") && !dialogue().textContent.includes("Besoins d'adaptation"));
  await saisir(champ("Entreprise"), "Entreprise fictive");
  await cliquer(document.querySelector('button[type="submit"][form="form-dossier"]'));
  await attendre(() => appels.some((a) => a.methode === "PATCH" && a.chemin === "/api/stagiaires/101"));
  const corps = appels.find((a) => a.methode === "PATCH" && a.chemin === "/api/stagiaires/101").corps;
  assert.equal(corps.entreprise, "Entreprise fictive");
  assert.ok(!("situation_handicap" in corps) && !("besoins_adaptation" in corps), "clés réservées jamais envoyées");
});

test("admin : section confidentielle conservée et envoyée comme avant", async () => {
  const appels = await ouvrirDossier("admin");
  assert.ok(dialogue().textContent.includes("Situation de handicap"));
  assert.equal(champ("Besoins d'adaptation").value, "Poste adapté");
  await saisir(champ("Besoins d'adaptation"), RESERVE);
  await cliquer(document.querySelector('button[type="submit"][form="form-dossier"]'));
  await attendre(() => appels.some((a) => a.methode === "PATCH" && a.chemin === "/api/stagiaires/101"));
  const corps = appels.find((a) => a.methode === "PATCH" && a.chemin === "/api/stagiaires/101").corps;
  assert.equal(corps.besoins_adaptation, RESERVE);
  assert.equal(corps.situation_handicap, true);
});
