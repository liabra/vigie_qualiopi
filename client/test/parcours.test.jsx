// Q2-1 / UX-Q2 — Onglet Accompagnement (route /parcours) : synthèse par
// inscription, filtre, dossier d'accompagnement, panneau « Besoins et
// positionnement » (création, modification, non applicable, positionnement),
// erreurs, double enregistrement, session archivée, confidentialité.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, dialogue, monter, saisir, texte } from "./outils.jsx";
import { SESSION } from "./outils.jsx";
import { corpsRecueil, filtrerParcours, recueilAFaire, valeursRecueil } from "../src/sessions/parcours-format.js";

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

const SECRET = "Attentes-confidentielles-Q21";
const POS_ALICE = { id: 31, inscription_id: 11, intitule: "Positionnement initial", date_passage: "2026-09-02", score: "12.00", score_max: "20.00", resultat: "non_determine" };
const PARCOURS = {
  archivee: false,
  inscriptions: [
    { inscription_id: 12, statut_inscription: "abandon", nom: "Bernard", prenom: "Paul", recueil_statut: null, date_recueil: null, conclusion: null, prerequis_verifies: null, positionnement_id: null },
    { inscription_id: 11, statut_inscription: "inscrit", nom: "Martin", prenom: "Alice", recueil_statut: "realise", date_recueil: "2026-09-03", conclusion: "parcours_adapte", prerequis_verifies: "partiel", positionnement_id: 31 },
  ],
  positionnements: [POS_ALICE],
};
const RECUEIL_ALICE = {
  recueil: { inscription_id: 11, statut: "realise", date_recueil: "2026-09-03", attentes: SECRET, objectifs_personnels: "Obtenir le titre",
    prerequis_verifies: "partiel", conclusion: "parcours_adapte", positionnement_id: 31, realise_par_nom: "Tukui" },
  positionnements: [POS_ALICE], archivee: false,
};
const routes = (sur = {}) => ({
  "GET /api/sessions/1/parcours": PARCOURS,
  "GET /api/inscriptions/11/recueil": RECUEIL_ALICE,
  "GET /api/inscriptions/12/recueil": { recueil: null, positionnements: [], archivee: false },
  ...sur,
});
const lignes = () => [...document.querySelectorAll("tbody tr")];
const champ = (libelle) => {
  const racine = dialogue() || document;
  const l = [...racine.querySelectorAll("label")].find((x) => x.textContent.replace(/\s*\(facultatif\)/, "").trim() === libelle);
  return l ? document.getElementById(l.htmlFor) : null;
};
const soumettre = () => cliquer(document.querySelector('button[type="submit"][form="form-recueil"]'));
const titreDialogue = () => dialogue()?.querySelector("h2")?.textContent;
// Ouvre le dossier d'accompagnement puis la section voulue (bouton explicite).
async function ouvrirBesoins(nom, libelle) {
  await attendre(() => document.querySelector(`button[aria-label="Ouvrir le dossier d'accompagnement de ${nom}"]`));
  await cliquer(document.querySelector(`button[aria-label="Ouvrir le dossier d'accompagnement de ${nom}"]`));
  await attendre(() => titreDialogue() === "Dossier d'accompagnement");
  await cliquer(bouton(libelle));
  await attendre(() => titreDialogue() === "Besoins et positionnement");
}
const puts = (appels, id) => appels.filter((a) => a.methode === "PUT" && a.chemin === `/api/inscriptions/${id}/recueil`);
const gets = (appels) => appels.filter((a) => a.methode === "GET" && a.chemin === "/api/sessions/1/parcours").length;

test("pur : recueil à faire = absent ou « à faire » ; corps complet, vides ⇒ null", () => {
  assert.ok(recueilAFaire({ recueil_statut: null }) && recueilAFaire({ recueil_statut: "a_faire" }));
  assert.ok(!recueilAFaire({ recueil_statut: "realise" }) && !recueilAFaire({ recueil_statut: "non_applicable" }));
  assert.deepEqual(filtrerParcours(PARCOURS.inscriptions, { aFaire: true }).map((l) => l.inscription_id), [12]);
  assert.deepEqual(corpsRecueil(valeursRecueil(null)), { statut: "a_faire", date_recueil: null, attentes: null, objectifs_personnels: null, prerequis_verifies: null, conclusion: null, positionnement_id: null });
});

test("onglet Accompagnement : synthèse par inscription, sans texte libre ; « Aucune mesure » ; statut réel", async () => {
  const appels = await monter(`/sessions/${SESSION.id}/parcours`, "admin", routes());
  await attendre(() => lignes().length === 2);
  assert.ok([...document.querySelectorAll('nav[aria-label="Sections de la session"] a')].some((a) => a.textContent.startsWith("Accompagnement")));
  const [paul, alice] = lignes();
  assert.ok(paul.textContent.includes("Paul Bernard") && paul.textContent.includes("Abandon") && paul.textContent.includes("Non commencé"));
  assert.ok(alice.textContent.includes("Réalisé") && alice.textContent.includes("Positionnement initial (02/09/2026) — 12/20"));
  assert.ok(alice.textContent.includes("Inscrit") && !alice.textContent.includes("En cours"), "statut réel « Inscrit »");
  assert.deepEqual([...alice.querySelectorAll("button")].map((b) => b.textContent), ["Ouvrir le dossier"], "un seul bouton par ligne");
  assert.ok(lignes().every((tr) => tr.textContent.includes("Aucune mesure")), "aucune adaptation : synthèse factuelle");
  assert.ok(!texte().includes(SECRET), "textes libres jamais dans la synthèse");
  assert.equal(gets(appels), 1, "une seule lecture agrégée");
  assert.ok(!appels.some((a) => a.chemin.endsWith("/recueil")), "aucun recueil chargé avant ouverture");
  assert.deepEqual([...alice.querySelectorAll("td")].map((c) => c.getAttribute("data-label")).slice(0, 5),
    ["Stagiaire", "Besoins et positionnement", "Mesures pédagogiques", "Observations et relances", "Situation de l'inscription"], "cartes mobiles libellées");
  assert.deepEqual([...document.querySelectorAll("thead th")].map((th) => th.textContent).slice(0, 5),
    ["Stagiaire", "Besoins et positionnement", "Mesures pédagogiques", "Observations et relances", "Situation de l'inscription"]);
  assert.ok(texte().includes("2 inscriptions, dont 1 abandon ; l'onglet Stagiaires compte 1 inscrit actif."), "populations explicitées");
});

test("dossier d'accompagnement : trois sections expliquées, boutons explicites, retour au dossier après un panneau", async () => {
  await monter(`/sessions/${SESSION.id}/parcours`, "admin", routes());
  await attendre(() => document.querySelector(`button[aria-label="Ouvrir le dossier d'accompagnement de Alice Martin"]`));
  await cliquer(document.querySelector(`button[aria-label="Ouvrir le dossier d'accompagnement de Alice Martin"]`));
  await attendre(() => titreDialogue() === "Dossier d'accompagnement");
  const d = dialogue();
  assert.deepEqual([...d.querySelectorAll("h3")].map((h) => h.textContent), ["1. Besoins et positionnement", "2. Mesures pédagogiques", "3. Observations et relances"]);
  assert.ok(d.textContent.includes("Situation de l'inscription :") && d.textContent.includes("Inscrit"));
  assert.ok(d.textContent.includes("vérification des prérequis") && d.textContent.includes("sans diagnostic") && d.textContent.includes("Faits observés"), "explications courtes");
  const libelles = [...d.querySelectorAll("button")].map((b) => b.textContent);
  assert.deepEqual(libelles.filter((l) => /^(Modifier|Gérer|Renseigner|Consulter)/.test(l)),
    ["Modifier les besoins et le positionnement", "Gérer les mesures pédagogiques", "Gérer les observations et relances"]);
  assert.ok(!libelles.includes("Modifier") && !libelles.includes("Suivi") && !libelles.includes("Adaptations"), "aucun libellé ambigu");
  assert.ok(!d.textContent.includes(SECRET), "aucun texte libre dans le dossier");
  await cliquer(bouton("Modifier les besoins et le positionnement"));
  await attendre(() => titreDialogue() === "Besoins et positionnement");
  await cliquer([...dialogue().querySelectorAll("button")].find((b) => b.textContent === "Annuler"));
  await attendre(() => titreDialogue() === "Dossier d'accompagnement");
});

test("filtre « Besoins à recueillir » et état vide correspondant", async () => {
  await monter(`/sessions/${SESSION.id}/parcours`, "admin", routes());
  await attendre(() => lignes().length === 2);
  await cliquer([...document.querySelectorAll(".sess-vue")].find((b) => b.textContent.startsWith("Besoins à recueillir")));
  assert.deepEqual(lignes().map((tr) => tr.textContent.includes("Paul Bernard")), [true]);
  await demonter();
  await monter(`/sessions/${SESSION.id}/parcours`, "admin", routes({ "GET /api/sessions/1/parcours": { ...PARCOURS, inscriptions: [PARCOURS.inscriptions[1]] } }));
  await attendre(() => lignes().length === 1);
  await cliquer([...document.querySelectorAll(".sess-vue")].find((b) => b.textContent.startsWith("Besoins à recueillir")));
  await attendre(() => texte().includes("Aucun besoin à recueillir."));
});

test("aucune inscription : état vide", async () => {
  await monter(`/sessions/${SESSION.id}/parcours`, "admin", routes({ "GET /api/sessions/1/parcours": { archivee: false, inscriptions: [], positionnements: [] } }));
  await attendre(() => texte().includes("Aucun stagiaire inscrit"));
});

test("création : date exigée si réalisé, aide RGPD, corps envoyé, panneau fermé, parcours rechargé une fois", async () => {
  let enregistre = false;
  const appels = await monter(`/sessions/${SESSION.id}/parcours`, "admin", routes({
    "GET /api/sessions/1/parcours": () => (enregistre ? { ...PARCOURS, inscriptions: [{ ...PARCOURS.inscriptions[0], recueil_statut: "realise", date_recueil: "2026-09-04", conclusion: "parcours_standard" }, PARCOURS.inscriptions[1]] } : PARCOURS),
    "PUT /api/inscriptions/12/recueil": (corps) => { enregistre = true; return { recueil: { inscription_id: 12, ...corps } }; },
  }));
  await ouvrirBesoins("Paul Bernard", "Renseigner les besoins et le positionnement");
  await attendre(() => champ("Statut"));
  assert.ok(dialogue().textContent.includes("Ne saisissez pas de diagnostic ni d'information médicale."));
  assert.ok(dialogue().textContent.includes("Aucun positionnement saisi pour ce stagiaire"), "renvoi vers l'onglet Évaluations");
  await saisir(champ("Statut"), "realise");
  await soumettre();
  await attendre(() => texte().includes("Indiquez la date du recueil réalisé."));
  assert.equal(puts(appels, 12).length, 0);
  await saisir(champ("Date du recueil"), "2026-09-04");
  await saisir(champ("Attentes"), "Reprendre une activité");
  await saisir(champ("Conclusion"), "parcours_standard");
  await saisir(champ("Prérequis vérifiés"), "oui");
  const avant = gets(appels);
  await soumettre();
  await attendre(() => titreDialogue() === "Dossier d'accompagnement");
  assert.deepEqual(puts(appels, 12)[0].corps, { statut: "realise", date_recueil: "2026-09-04", attentes: "Reprendre une activité", objectifs_personnels: null, prerequis_verifies: "oui", conclusion: "parcours_standard", positionnement_id: null });
  assert.equal(gets(appels) - avant, 1, "rechargement ciblé, une fois");
  await attendre(() => texte().includes("Besoins et positionnement enregistrés pour Paul Bernard."));
  assert.ok(dialogue().textContent.includes("Réalisé") && dialogue().textContent.includes("Parcours standard"), "retour au dossier à jour");
  assert.ok(lignes()[0].textContent.includes("Réalisé"));
});

test("modification : valeurs préremplies, positionnement de CETTE inscription seulement, auteur affiché", async () => {
  const appels = await monter(`/sessions/${SESSION.id}/parcours`, "admin", routes({ "PUT /api/inscriptions/11/recueil": (c) => ({ recueil: c }) }));
  await ouvrirBesoins("Alice Martin", "Modifier les besoins et le positionnement");
  await attendre(() => champ("Attentes")?.value === SECRET);
  assert.equal(champ("Statut").value, "realise");
  assert.equal(champ("Date du recueil").value, "2026-09-03");
  assert.equal(champ("Conclusion").value, "parcours_adapte");
  assert.equal(champ("Positionnement associé").value, "31");
  assert.deepEqual([...champ("Positionnement associé").options].map((o) => o.textContent), ["Aucun", "Positionnement initial (02/09/2026) — 12/20"]);
  assert.ok(dialogue().textContent.includes("Recueil réalisé par Tukui."));
  await saisir(champ("Positionnement associé"), "");
  await saisir(champ("Conclusion"), "a_preciser");
  await soumettre();
  await attendre(() => puts(appels, 11).length === 1);
  const c = puts(appels, 11)[0].corps;
  assert.equal(c.positionnement_id, null);
  assert.equal(c.conclusion, "a_preciser");
  assert.equal(c.attentes, SECRET, "texte conservé tel quel");
  await attendre(() => titreDialogue() === "Dossier d'accompagnement");
  assert.ok(!texte().includes(SECRET), "texte libre non répercuté dans la page");
});

test("non applicable : enregistré sans date ni contenu", async () => {
  const appels = await monter(`/sessions/${SESSION.id}/parcours`, "admin", routes({ "PUT /api/inscriptions/12/recueil": (c) => ({ recueil: c }) }));
  await ouvrirBesoins("Paul Bernard", "Renseigner les besoins et le positionnement");
  await attendre(() => champ("Statut"));
  await saisir(champ("Statut"), "non_applicable");
  await soumettre();
  await attendre(() => puts(appels, 12).length === 1);
  assert.equal(puts(appels, 12)[0].corps.statut, "non_applicable");
  assert.equal(puts(appels, 12)[0].corps.date_recueil, null);
});

test("erreur serveur à l'enregistrement : panneau ouvert, saisie conservée ; double clic ⇒ un seul PUT", async () => {
  const v = vanne();
  const appels = await monter(`/sessions/${SESSION.id}/parcours`, "admin", routes({
    "PUT /api/inscriptions/12/recueil": async () => { await v.attendre(); return [400, { error: "Ce positionnement concerne une autre inscription." }]; },
  }));
  await ouvrirBesoins("Paul Bernard", "Renseigner les besoins et le positionnement");
  await attendre(() => champ("Attentes"));
  await saisir(champ("Attentes"), "Texte conservé");
  const b = document.querySelector('button[type="submit"][form="form-recueil"]');
  await cliquer(b); await cliquer(b);
  v.ouvrir();
  await attendre(() => dialogue()?.textContent.includes("Ce positionnement concerne une autre inscription."));
  assert.equal(puts(appels, 12).length, 1);
  assert.equal(champ("Attentes").value, "Texte conservé");
});

test("erreur de chargement de l'accompagnement : message et Réessayer", async () => {
  let n = 0;
  const appels = await monter(`/sessions/${SESSION.id}/parcours`, "admin", routes({ "GET /api/sessions/1/parcours": () => (n++ === 0 ? [500, { error: "Erreur serveur." }] : PARCOURS) }));
  await attendre(() => texte().includes("L'accompagnement n'a pas pu être chargé."));
  await cliquer([...document.querySelectorAll("button")].find((x) => x.textContent === "Réessayer"));
  await attendre(() => lignes().length === 2);
  assert.equal(gets(appels), 2);
});

test("session archivée : consultation seule, aucun enregistrement possible", async () => {
  const archivee = { ...SESSION, archivee_le: "2026-12-20T00:00:00Z" };
  await monter(`/sessions/${SESSION.id}/parcours`, "admin", routes({
    "GET /api/sessions/1": { session: archivee, groupes: [], stagiaires: [], documents: [] },
    "GET /api/sessions/1/parcours": { ...PARCOURS, archivee: true },
    "GET /api/inscriptions/11/recueil": { ...RECUEIL_ALICE, archivee: true },
  }));
  await attendre(() => lignes().length === 2);
  await ouvrirBesoins("Alice Martin", "Consulter les besoins et le positionnement");
  await attendre(() => dialogue()?.textContent.includes("Session archivée : recueil en lecture seule."));
  assert.ok(!document.querySelector('button[type="submit"][form="form-recueil"]'));
  assert.ok(champ("Attentes").closest("fieldset.ui-form-lecture").disabled, "formulaire désactivé");
  assert.ok(champ("Attentes").matches(":disabled"), "champ non modifiable");
});

test("contributeur : saisie ouverte comme pour les inscriptions", async () => {
  await monter(`/sessions/${SESSION.id}/parcours`, "contributeur", routes());
  await ouvrirBesoins("Alice Martin", "Modifier les besoins et le positionnement");
  assert.ok(document.querySelector('button[type="submit"][form="form-recueil"]'));
});
