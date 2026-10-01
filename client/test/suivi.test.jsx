// Q2-3 / UX-Q2 — Abandon enrichi (onglet Stagiaires) et « Observations et relances »
// (onglet Accompagnement). API simulée, données fictives ; aucune boîte native.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, cliquer, demonter, dialogue, monter, saisir, texte } from "./outils.jsx";
import { aujourdhuiISO } from "../src/qualite/format.js";
import { corpsAbandon, corpsSuivi, erreursSuivi, resumeSuivi, situationInscription } from "../src/sessions/parcours-format.js";

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

const MOTIF = "Nouvel emploi a temps plein";
const NOTE = "Contact tente le matin";
const ligne = (sur) => ({ statut_inscription: "inscrit", recueil_statut: null, date_recueil: null, conclusion: null, prerequis_verifies: null, positionnement_id: null,
  adaptations_total: 0, adaptations_prevues: 0, adaptations_mises_en_oeuvre: 0, adaptations_abandonnees: 0,
  date_abandon: null, relances_total: 0, signaux_total: 0, dernier_suivi_type: null, dernier_suivi_categorie: null, dernier_suivi_date: null, ...sur });
const PARCOURS = {
  archivee: false, positionnements: [],
  inscriptions: [
    ligne({ inscription_id: 12, nom: "Bernard", prenom: "Paul", statut_inscription: "abandon", date_abandon: "2026-09-20" }),
    ligne({ inscription_id: 11, nom: "Martin", prenom: "Alice", relances_total: 2, signaux_total: 1, dernier_suivi_type: "relance", dernier_suivi_categorie: "sans_reponse", dernier_suivi_date: "2026-09-12" }),
  ],
};
const EVT = (sur) => ({ inscription_id: 11, type: "signal", date_evenement: "2026-09-10", categorie: "absences_repetees", canal: null, note: null,
  cree_par_nom: "Tukui", mis_a_jour_par_nom: "Tukui", cree_le: "t", mis_a_jour_le: "t", ...sur });
const SUIVI_ALICE = { archivee: false, inscription: { inscription_id: 11, statut: "inscrit", date_abandon: null, categorie_abandon: null, motif_abandon: null },
  evenements: [EVT({ id: 2, type: "relance", date_evenement: "2026-09-12", categorie: "sans_reponse", canal: "telephone", note: NOTE }), EVT({ id: 1 })] };
const SUIVI_PAUL = { archivee: false, inscription: { inscription_id: 12, statut: "abandon", date_abandon: "2026-09-20", categorie_abandon: "professionnel", motif_abandon: MOTIF }, evenements: [] };
const routes = (sur = {}) => ({
  "GET /api/sessions/1/parcours": PARCOURS,
  "GET /api/inscriptions/11/suivi": SUIVI_ALICE,
  "GET /api/inscriptions/12/suivi": SUIVI_PAUL,
  ...sur,
});
const champ = (libelle) => {
  const racine = document.querySelector('[role="alertdialog"]') || dialogue() || document;
  const l = [...racine.querySelectorAll("label")].find((x) => x.textContent.replace(/\s*\(facultatif\)/, "").trim() === libelle);
  return l ? document.getElementById(l.htmlFor) : null;
};
const lignes = () => [...document.querySelectorAll("tbody tr")];
const boutonDialogue = (l) => [...dialogue().querySelectorAll("button")].find((b) => b.textContent === l);
const ecritures = (appels) => appels.filter((a) => (a.methode === "POST" || a.methode === "PATCH") && a.chemin.includes("/suivi"));
const soumettre = () => cliquer(document.querySelector('button[type="submit"][form="form-suivi"]'));
const titreDialogue = () => dialogue()?.querySelector("h2")?.textContent;
// UX-Q2 : dossier d'accompagnement puis section « Observations et relances ».
async function ouvrirObservations(nom) {
  await attendre(() => document.querySelector(`button[aria-label="Ouvrir le dossier d'accompagnement de ${nom}"]`));
  await cliquer(document.querySelector(`button[aria-label="Ouvrir le dossier d'accompagnement de ${nom}"]`));
  await attendre(() => titreDialogue() === "Dossier d'accompagnement");
  await cliquer([...dialogue().querySelectorAll("button")].find((b) => /^(Gérer|Consulter) les observations et relances$/.test(b.textContent)));
  await attendre(() => titreDialogue() === "Observations et relances" && !dialogue().querySelector(".ui-loading"));
}
async function ouvrirSuivi(nom, sur = {}, role = "admin") {
  const appels = await monter("/sessions/1/parcours", role, routes(sur));
  await ouvrirObservations(nom);
  return appels;
}

test("pur : corps d'abandon facultatif, corps de suivi, validation, issue et résumé", () => {
  assert.deepEqual(corpsAbandon({}), { statut: "abandon" }, "compatibilité : corps historique inchangé");
  assert.deepEqual(corpsAbandon({ categorie_abandon: "financement", motif_abandon: "  Prise en charge refusée " }), { statut: "abandon", categorie_abandon: "financement", motif_abandon: "Prise en charge refusée" });
  assert.deepEqual(corpsSuivi({ type: "signal", date_evenement: "2026-09-10", categorie: "autre", canal: "email", note: " " }), { type: "signal", date_evenement: "2026-09-10", categorie: "autre", canal: null, note: null });
  assert.ok(!("type" in corpsSuivi({ type: "relance", date_evenement: "2026-09-10", categorie: "autre", canal: "email", note: "" }, { creation: false })));
  assert.deepEqual(Object.keys(erreursSuivi({ type: "relance", date_evenement: "", categorie: "", canal: "", note: "" })).sort(), ["canal", "categorie", "date_evenement"]);
  assert.equal(situationInscription(PARCOURS.inscriptions[0]).libelle, "Abandon le 20/09/2026");
  assert.equal(situationInscription({ statut_inscription: "termine" }).libelle, "Terminé");
  assert.equal(situationInscription({ statut_inscription: "en_cours" }).libelle, "En cours");
  assert.equal(situationInscription({ statut_inscription: "inscrit" }).libelle, "Inscrit", "jamais « En cours » pour un simple inscrit");
  assert.deepEqual(resumeSuivi(PARCOURS.inscriptions[1]), { dernier: "Contact tenté, sans réponse (12/09/2026)", relances: "2 relances" });
});

test("abandon enrichi : aide, catégorie et précision envoyées ; explication du changement de statut", async () => {
  const appels = await monter("/sessions/1/stagiaires", "admin", { "PATCH /api/inscriptions/12": { inscription: {} } });
  await attendre(() => texte().includes("Bernard Paul"));
  await cliquer(document.querySelector('button[aria-label="Déclarer l\'abandon de Paul Bernard"]'));
  await attendre(() => document.querySelector('[role="alertdialog"]'));
  const t = document.querySelector('[role="alertdialog"]').textContent;
  assert.ok(t.includes("Le statut de l'inscription change") && t.includes("suivi d'assiduité"));
  assert.ok(t.includes("Ne saisissez aucune information médicale ni aucune justification intime."));
  assert.equal(document.activeElement.textContent, "Annuler", "focus initial sur Annuler conservé");
  await saisir(champ("Catégorie"), "professionnel");
  await saisir(champ("Précision"), MOTIF);
  await cliquer([...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent === "Déclarer l'abandon"));
  await attendre(() => appels.some((a) => a.methode === "PATCH"));
  assert.deepEqual(appels.find((a) => a.methode === "PATCH").corps, { statut: "abandon", categorie_abandon: "professionnel", motif_abandon: MOTIF });
});

test("abandon : erreur serveur ⇒ dialogue ouvert, saisie conservée ; double clic ⇒ un seul envoi", async () => {
  const v = vanne();
  const appels = await monter("/sessions/1/stagiaires", "contributeur", {
    "PATCH /api/inscriptions/12": async () => { await v.attendre(); return [400, { error: "Catégorie d'abandon inconnue." }]; },
  });
  await attendre(() => texte().includes("Bernard Paul"));
  await cliquer(document.querySelector('button[aria-label="Déclarer l\'abandon de Paul Bernard"]'));
  await attendre(() => document.querySelector('[role="alertdialog"]'));
  await saisir(champ("Catégorie"), "financement");
  await saisir(champ("Précision"), "Prise en charge refusee");
  const b = [...document.querySelectorAll('[role="alertdialog"] button')].find((x) => x.textContent === "Déclarer l'abandon");
  await cliquer(b); await cliquer(b);
  v.ouvrir();
  await attendre(() => document.querySelector('[role="alertdialog"]')?.textContent.includes("L'abandon n'a pas été enregistré."));
  assert.equal(appels.filter((a) => a.methode === "PATCH").length, 1);
  assert.equal(champ("Catégorie").value, "financement");
  assert.equal(champ("Précision").value, "Prise en charge refusee");
});

test("vue Accompagnement : dernier événement, relances, situation réelle ; aucune note ni motif ; aucun suivi chargé avant ouverture", async () => {
  const appels = await monter("/sessions/1/parcours", "admin", routes());
  await attendre(() => lignes().length === 2);
  const [paul, alice] = lignes().map((tr) => tr.textContent);
  assert.ok(alice.includes("Contact tenté, sans réponse (12/09/2026)") && alice.includes("2 relances") && alice.includes("Inscrit") && !alice.includes("En cours"));
  assert.ok(paul.includes("Aucune observation ni relance") && paul.includes("Abandon le 20/09/2026"));
  assert.ok(!texte().includes(NOTE) && !texte().includes(MOTIF) && !texte().includes("Raison professionnelle"));
  assert.ok(!appels.some((a) => a.chemin.endsWith("/suivi")), "aucun suivi individuel chargé dans la vue d'ensemble");
  for (const tr of lignes()) assert.ok([...tr.querySelectorAll("td:not(.sess-table__actions)")].every((td) => td.getAttribute("data-label")), "mobile 390 px : data-label");
});

test("panneau : historique (types, canal, note, auteurs) et abandon détaillé dans l'espace individuel ; états vides", async () => {
  await ouvrirSuivi("Alice Martin");
  const t = dialogue().textContent;
  for (const x of ["Relance effectuée", "le 12/09/2026 · Téléphone", "Contact tenté, sans réponse", NOTE, "Observation", "Absences répétées constatées", "Saisi par Tukui"]) assert.ok(t.includes(x), x);
  await demonter();
  await ouvrirSuivi("Paul Bernard");
  const p = dialogue().textContent;
  assert.ok(p.includes("Abandon le 20/09/2026") && p.includes("Catégorie : Raison professionnelle") && p.includes(`Précision : ${MOTIF}`));
  assert.ok(p.includes("Aucune observation ni relance"));
});

test("signal : catégorie obligatoire, aide factuelle, date du jour, corps exact, compteurs rechargés", async () => {
  const appels = await ouvrirSuivi("Alice Martin", { "POST /api/inscriptions/11/suivi": (c) => [201, { evenement: { id: 9, ...c } }] });
  await cliquer(boutonDialogue("Ajouter une observation"));
  await attendre(() => champ("Catégorie"));
  assert.ok(dialogue().textContent.includes("Ne recopiez pas le contenu des échanges"));
  assert.equal(champ("Date").value, aujourdhuiISO());
  assert.equal(champ("Canal"), null, "pas de canal pour un signal");
  await soumettre();
  await attendre(() => dialogue().textContent.includes("Choisissez une catégorie."));
  assert.equal(ecritures(appels).length, 0);
  await saisir(champ("Catégorie"), "difficulte_pedagogique");
  await saisir(champ("Date"), "2026-09-14");
  const avant = appels.filter((a) => a.chemin === "/api/sessions/1/parcours").length;
  await soumettre();
  await attendre(() => ecritures(appels).length === 1 && !document.querySelector("#form-suivi"));
  assert.deepEqual(ecritures(appels)[0].corps, { type: "signal", date_evenement: "2026-09-14", categorie: "difficulte_pedagogique", canal: null, note: null });
  assert.equal(appels.filter((a) => a.chemin === "/api/sessions/1/parcours").length - avant, 1, "vue d'ensemble rechargée");
});

test("relance : canal obligatoire, note courte, corps exact ; correction d'un événement (PATCH sans type)", async () => {
  const appels = await ouvrirSuivi("Alice Martin", {
    "POST /api/inscriptions/11/suivi": (c) => [201, { evenement: { id: 9, ...c } }],
    "PATCH /api/inscriptions/11/suivi/2": (c) => ({ evenement: EVT({ id: 2, type: "relance", ...c }) }),
  });
  await cliquer(boutonDialogue("Ajouter une relance"));
  await attendre(() => champ("Canal"));
  await saisir(champ("Catégorie"), "entretien_realise");
  await soumettre();
  await attendre(() => dialogue().textContent.includes("Choisissez le canal de la relance."));
  assert.equal(ecritures(appels).length, 0);
  await saisir(champ("Canal"), "presentiel");
  await saisir(champ("Note"), "Entretien en fin de seance");
  await saisir(champ("Date"), "2026-09-16");
  await soumettre();
  await attendre(() => ecritures(appels).length === 1 && !document.querySelector("#form-suivi"));
  assert.deepEqual(ecritures(appels)[0].corps, { type: "relance", date_evenement: "2026-09-16", categorie: "entretien_realise", canal: "presentiel", note: "Entretien en fin de seance" });
  await cliquer(dialogue().querySelector('button[aria-label="Corriger l\'événement du 12/09/2026"]'));
  await attendre(() => champ("Canal")?.value === "telephone");
  await saisir(champ("Canal"), "email");
  await soumettre();
  await attendre(() => ecritures(appels).length === 2);
  assert.deepEqual(ecritures(appels)[1], { methode: "PATCH", chemin: "/api/inscriptions/11/suivi/2",
    corps: { date_evenement: "2026-09-12", categorie: "sans_reponse", canal: "email", note: NOTE } });
});

test("suivi : erreur serveur ⇒ saisie conservée ; double clic ⇒ un seul envoi", async () => {
  const v = vanne();
  const appels = await ouvrirSuivi("Alice Martin", {
    "POST /api/inscriptions/11/suivi": async () => { await v.attendre(); return [400, { error: "Indiquez la date de l'événement." }]; },
  });
  await cliquer(boutonDialogue("Ajouter une observation"));
  await attendre(() => champ("Catégorie"));
  await saisir(champ("Catégorie"), "retards_repetes");
  await saisir(champ("Note"), "Trois retards cette semaine");
  const b = document.querySelector('button[type="submit"][form="form-suivi"]');
  await cliquer(b); await cliquer(b);
  v.ouvrir();
  await attendre(() => dialogue()?.textContent.includes("L'événement n'a pas été enregistré."));
  assert.equal(ecritures(appels).length, 1);
  assert.equal(champ("Note").value, "Trois retards cette semaine");
  assert.equal(champ("Catégorie").value, "retards_repetes");
});

test("chargement en échec : message et Réessayer", async () => {
  let n = 0;
  await monter("/sessions/1/parcours", "admin", routes({ "GET /api/inscriptions/11/suivi": () => (n++ === 0 ? [500, { error: "Erreur serveur." }] : SUIVI_ALICE) }));
  await attendre(() => document.querySelector(`button[aria-label="Ouvrir le dossier d'accompagnement de Alice Martin"]`));
  await cliquer(document.querySelector(`button[aria-label="Ouvrir le dossier d'accompagnement de Alice Martin"]`));
  await attendre(() => titreDialogue() === "Dossier d'accompagnement");
  await cliquer([...dialogue().querySelectorAll("button")].find((b) => b.textContent === "Gérer les observations et relances"));
  await attendre(() => dialogue()?.textContent.includes("Les observations et relances n'ont pas pu être chargées."));
  await cliquer(boutonDialogue("Réessayer"));
  await attendre(() => dialogue().textContent.includes(NOTE));
});

test("permissions : contributeur saisit ; session archivée en lecture seule (aucun bouton d'écriture)", async () => {
  await ouvrirSuivi("Alice Martin", {}, "contributeur");
  assert.ok(boutonDialogue("Ajouter une observation") && boutonDialogue("Ajouter une relance"));
  await demonter();
  await ouvrirSuivi("Alice Martin", { "GET /api/sessions/1/parcours": { ...PARCOURS, archivee: true }, "GET /api/inscriptions/11/suivi": { ...SUIVI_ALICE, archivee: true } });
  assert.ok(dialogue().textContent.includes("Session archivée : observations et relances en lecture seule."));
  for (const l of ["Ajouter une observation", "Ajouter une relance", "Corriger l'événement"]) assert.ok(!boutonDialogue(l), l);
  assert.ok(dialogue().textContent.includes(NOTE), "lecture conservée");
});

test("compléter / corriger un abandon existant : PATCH sans statut ni date, liste rechargée ; absent pour une inscription active", async () => {
  let complete = false;
  const appels = await ouvrirSuivi("Paul Bernard", {
    "PATCH /api/inscriptions/12": (c) => { complete = true; return { inscription: { id: 12, statut: "abandon", ...c } }; },
    "GET /api/inscriptions/12/suivi": () => (complete
      ? { ...SUIVI_PAUL, inscription: { ...SUIVI_PAUL.inscription, categorie_abandon: "financement", motif_abandon: null } }
      : SUIVI_PAUL),
  });
  await cliquer(boutonDialogue("Corriger l'abandon"));
  await attendre(() => champ("Catégorie"));
  assert.ok(dialogue().textContent.includes("La date d'abandon et le statut ne changent pas."));
  assert.equal(champ("Catégorie").value, "professionnel", "valeurs actuelles préremplies");
  assert.equal(champ("Précision").value, MOTIF);
  await saisir(champ("Catégorie"), "financement");
  await saisir(champ("Précision"), "   ");
  await cliquer(document.querySelector('button[type="submit"][form="form-abandon"]'));
  await attendre(() => dialogue()?.textContent.includes("Catégorie : Financement") && !document.querySelector("#form-abandon"));
  const patch = appels.filter((a) => a.methode === "PATCH");
  assert.equal(patch.length, 1);
  assert.deepEqual(patch[0], { methode: "PATCH", chemin: "/api/inscriptions/12", corps: { categorie_abandon: "financement", motif_abandon: null } });
  await demonter();
  await ouvrirSuivi("Alice Martin");
  assert.ok(!boutonDialogue("Compléter l'abandon") && !boutonDialogue("Corriger l'abandon"), "inscription active : aucun complément");
});

test("complément d'abandon : erreur serveur ⇒ saisie conservée ; double clic ⇒ un seul envoi ; archivée ⇒ lecture seule", async () => {
  const v = vanne();
  const appels = await ouvrirSuivi("Paul Bernard", {
    "PATCH /api/inscriptions/12": async () => { await v.attendre(); return [400, { error: "La catégorie d'abandon ne s'applique qu'à une inscription en abandon." }]; },
  });
  await cliquer(boutonDialogue("Corriger l'abandon"));
  await attendre(() => champ("Précision"));
  await saisir(champ("Précision"), "Changement de region");
  const b = document.querySelector('button[type="submit"][form="form-abandon"]');
  await cliquer(b); await cliquer(b);
  v.ouvrir();
  await attendre(() => dialogue()?.textContent.includes("L'abandon n'a pas été complété."));
  assert.equal(appels.filter((a) => a.methode === "PATCH").length, 1);
  assert.equal(champ("Précision").value, "Changement de region");
  await demonter();
  await ouvrirSuivi("Paul Bernard", { "GET /api/inscriptions/12/suivi": { ...SUIVI_PAUL, archivee: true } });
  assert.ok(!boutonDialogue("Corriger l'abandon") && !boutonDialogue("Compléter l'abandon"));
  assert.ok(dialogue().textContent.includes(`Précision : ${MOTIF}`), "lecture conservée");
});
