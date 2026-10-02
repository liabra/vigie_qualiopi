// Q4-2 — Justificatifs professionnels (section de la fiche, admin), page de
// pilotage, tableau de bord ; contributeur sans accès. API simulée, données
// fictives ; horloge maîtrisée (test/horloge.mjs).
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, dialogue, liensNavigation, monter, saisir, texte } from "./outils.jsx";
import { aujourdhuiISO } from "../src/qualite/format.js";
import { validite } from "../src/intervenants/format.js";

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

const ZOE = { id: 2, civilite: null, nom: "Martin", prenom: "Zoé", email: null, fonction: "formateur", nature: "sous_traitant", domaines: [], formations: [], actif: true };
const J = (sur) => ({ id: 1, categorie: "cv", preuve_id: 50, titre: "CV fictif", date_document: null, type_alerte: null, date_echeance: null, periodicite_mois: null,
  alerte_statut: null, fichiers: [{ id: 9, nom: "cv.pdf", url: "https://drive.google.com/file/d/DRV-50/view" }], ...sur });
const DOSSIER = (sur = {}) => {
  const justificatifs = [J(), J({ id: 2, categorie: "contrat", preuve_id: 51, titre: "Contrat fictif", date_document: "2026-09-01", type_alerte: "echeance_fixe", date_echeance: "2026-10-20", alerte_statut: "bientot" })];
  const lignes = [
    { categorie: "cv", attendue: true, etat: "disponible", justificatifs: [justificatifs[0]] },
    { categorie: "diplome", attendue: true, etat: "manquant", justificatifs: [] },
    { categorie: "attestation", attendue: false, etat: null, justificatifs: [] },
    { categorie: "certification", attendue: false, etat: null, justificatifs: [] },
    { categorie: "contrat", attendue: true, etat: "bientot", justificatifs: [justificatifs[1]] },
    { categorie: "autre", attendue: false, etat: null, justificatifs: [] },
  ];
  return { attendus: ["cv", "diplome", "contrat"], lignes, justificatifs,
    sous_traitance: { contrat_attendu: true, etat: "bientot", contrats: [justificatifs[1]] }, ...sur };
};
const routesFiche = (sur = {}) => ({
  "GET /api/intervenants": { intervenants: [ZOE], total: 1 },
  "GET /api/intervenants/2": { intervenant: ZOE, sessions: [] },
  "GET /api/intervenants/2/justificatifs": DOSSIER(),
  "GET /api/preuves": { preuves: [{ id: 60, titre: "Diplôme fictif", indicateur: 21 }, { id: 61, titre: "Procédure d'accueil", indicateur: 1 }], total: 2 },
  ...sur,
});
const champ = (libelle) => {
  const racine = document.querySelector('[role="alertdialog"]') || dialogue() || document;
  const l = [...racine.querySelectorAll("label")].find((x) => x.textContent.replace(/\s*\(facultatif\)/, "").trim() === libelle);
  return l ? (document.getElementById(l.htmlFor) || l.querySelector("input")) : null;
};
async function ouvrirFiche(sur) {
  const appels = await monter("/intervenants", "admin", routesFiche(sur));
  await attendre(() => document.querySelector('button[aria-label="Modifier la fiche de Zoé Martin"]'));
  await cliquer(document.querySelector('button[aria-label="Modifier la fiche de Zoé Martin"]'));
  await attendre(() => dialogue()?.textContent.includes("Justificatifs professionnels") && dialogue().querySelector('table[class="sess-table"]'));
  return appels;
}
const ecritures = (appels) => appels.filter((a) => a.methode !== "GET" && a.chemin.includes("/justificatifs"));

test("pur : validité d'après la preuve (échéance fixe, révision périodique, sans échéance)", () => {
  assert.equal(validite({ type_alerte: "echeance_fixe", date_echeance: "2026-10-20" }), "jusqu'au 20/10/2026");
  assert.equal(validite({ type_alerte: "revision_periodique", periodicite_mois: 12 }), "révision tous les 12 mois");
  assert.equal(validite({}), "sans échéance");
});

test("fiche (admin) : catégories, pièce attendue, document ou manquant, validité, état ; ouvrir ; sous-traitance", async () => {
  await ouvrirFiche();
  const t = dialogue().textContent;
  for (const x of ["Réservé à l'administrateur", "n'est pas, en soi, une non-conformité", "CV fictif", "Disponible", "Manquant", "Facultative",
    "Contrat fictif (document du 01/09/2026)", "jusqu'au 20/10/2026", "Bientôt à renouveler", "Suivi de la sous-traitance", "Contrat attendu", "contrat du 01/09/2026"]) assert.ok(t.includes(x), x);
  const lien = dialogue().querySelector('a[aria-label="Ouvrir le document CV fictif (nouvel onglet)"]');
  assert.equal(lien.getAttribute("href"), "https://drive.google.com/file/d/DRV-50/view");
  assert.equal(lien.getAttribute("target"), "_blank");
  for (const td of dialogue().querySelectorAll("tbody td")) assert.ok(td.getAttribute("data-label"), "390 px : data-label");
});

test("définir les pièces attendues : PUT de la liste choisie", async () => {
  const appels = await ouvrirFiche({ "PUT /api/intervenants/2/justificatifs/attendus": (c) => DOSSIER({ attendus: c.categories }) });
  await cliquer(bouton("Définir les pièces attendues"));
  await attendre(() => champ("Certification"));
  await cliquer(champ("Certification"));
  await cliquer(champ("Diplôme"));
  await cliquer(bouton("Enregistrer les pièces attendues"));
  await attendre(() => ecritures(appels).length === 1);
  assert.deepEqual(ecritures(appels)[0], { methode: "PUT", chemin: "/api/intervenants/2/justificatifs/attendus", corps: { categories: ["cv", "contrat", "certification"] } });
});

test("rattacher une preuve : avertissement de confidentialité, catégorie obligatoire, corps exact ; erreur ⇒ panneau ouvert ; double clic ⇒ un seul POST", async () => {
  const v = vanne();
  const appels = await ouvrirFiche({ "POST /api/intervenants/2/justificatifs": async () => { await v.attendre(); return [409, { error: "Cette preuve est déjà rattachée à cet intervenant." }]; } });
  await cliquer(bouton("Rattacher une preuve"));
  await attendre(() => dialogue().querySelector('button[aria-label="Rattacher la preuve Diplôme fictif"]'));
  assert.ok(dialogue().textContent.includes("devient définitivement réservée à l'administrateur"));
  assert.equal(dialogue().querySelector('button[aria-label="Rattacher la preuve Diplôme fictif"]').disabled, true, "catégorie d'abord");
  await saisir(champ("Catégorie du justificatif"), "diplome");
  await saisir(champ("Date du document"), "2015-06-30");
  await saisir(champ("Rechercher une preuve"), "dipl");
  assert.ok(!dialogue().textContent.includes("Procédure d'accueil"), "recherche locale");
  const b = dialogue().querySelector('button[aria-label="Rattacher la preuve Diplôme fictif"]');
  await cliquer(b); await cliquer(b);
  v.ouvrir();
  await attendre(() => dialogue()?.textContent.includes("déjà rattachée à cet intervenant"));
  assert.equal(ecritures(appels).length, 1);
  assert.deepEqual(ecritures(appels)[0].corps, { preuve_id: 60, categorie: "diplome", date_document: "2015-06-30" });
  assert.equal(champ("Catégorie du justificatif").value, "diplome", "saisie conservée");
  assert.ok(!dialogue().querySelector('button[aria-label="Rattacher la preuve CV fictif"]'), "preuve déjà liée non proposée");
});

test("retirer le lien : confirmation explicite, DELETE du rattachement seulement", async () => {
  const appels = await ouvrirFiche({ "DELETE /api/intervenants/2/justificatifs/1": () => DOSSIER({ justificatifs: [] }) });
  await cliquer(dialogue().querySelector('button[aria-label="Retirer le lien vers CV fictif"]'));
  await attendre(() => document.querySelector('[role="alertdialog"]'));
  assert.ok(document.querySelector('[role="alertdialog"]').textContent.includes("la preuve et ses fichiers Drive sont conservés"));
  await cliquer([...document.querySelectorAll('[role="alertdialog"] button')].find((x) => x.textContent === "Retirer le lien"));
  await attendre(() => ecritures(appels).length === 1);
  assert.deepEqual(ecritures(appels)[0], { methode: "DELETE", chemin: "/api/intervenants/2/justificatifs/1", corps: undefined });
});

const ALERTES = { resume: { manquants: 1, bientot: 1, perimes: 1, intervenants: 1 }, elements: [
  { intervenant: { id: 2, nom: "Martin", prenom: "Zoé" }, categorie: "diplome", etat: "manquant", document: null },
  { intervenant: { id: 2, nom: "Martin", prenom: "Zoé" }, categorie: "contrat", etat: "bientot", document: { preuve_id: 51, titre: "Contrat fictif", date_echeance: "2026-10-20" } },
  { intervenant: { id: 2, nom: "Martin", prenom: "Zoé" }, categorie: "attestation", etat: "perime", document: { preuve_id: 52, titre: "Attestation fictive", date_echeance: "2020-01-01" } },
] };

test("pilotage : résumé, filtre par état, ouverture de la fiche concernée", async () => {
  await monter("/justificatifs-intervenants", "admin", { "GET /api/justificatifs-intervenants": ALERTES, ...routesFiche() });
  await attendre(() => texte().includes("Pièces attendues manquantes"));
  const t = texte();
  for (const x of ["Aucun document rattaché", "Contrat fictif — échéance 20/10/2026", "Périmé", "n'est pas, en soi, une non-conformité"]) assert.ok(t.includes(x), x);
  await saisir(champ("État"), "perime");
  assert.equal(document.querySelectorAll("tbody tr").length, 1);
  assert.equal(document.querySelector('a[aria-label="Ouvrir la fiche de Zoé Martin"]').getAttribute("href"), "/intervenants?fiche=2");
  await cliquer(document.querySelector('a[aria-label="Ouvrir la fiche de Zoé Martin"]'));
  await attendre(() => dialogue()?.textContent.includes("Justificatifs professionnels"));
});

test("contributeur : ni entrée de menu, ni page de pilotage (bloquée sans appel), ni section dans l'annuaire", async () => {
  await monter("/accueil", "contributeur");
  await attendre(() => liensNavigation().length > 0);
  assert.ok(!liensNavigation().includes("Justificatifs des intervenants"));
  await demonter();
  const appels = await monter("/justificatifs-intervenants", "contributeur", { "GET /api/justificatifs-intervenants": ALERTES });
  await attendre(() => texte().includes("Cette page est réservée aux administrateurs."));
  assert.ok(!appels.some((a) => a.chemin.includes("justificatifs")));
  await demonter();
  const a2 = await monter("/intervenants?fiche=2", "contributeur", { "GET /api/intervenants": { intervenants: [{ id: 2, nom: "Martin", prenom: "Zoé", civilite: null, fonction: "formateur", domaines: [], actif: true }], total: 1 } });
  await attendre(() => texte().includes("Zoé Martin"));
  assert.ok(!dialogue() && !texte().includes("Justificatifs professionnels"));
  assert.ok(!a2.some((a) => a.chemin.includes("justificatifs")), "aucun appel documentaire");
});

test("tableau de bord : section compacte et lien vers la synthèse", async () => {
  const base = {
    aujourdhui: "2026-10-01",
    kpis: { actions: { ouvertes: 0, en_retard: 0, efficacite_a_verifier: 0, cloturees: 0, ouvertes_avec_preuve: 0, ouvertes_sans_preuve: 0 },
      signalements: { a_traiter: 0, reclamations_en_retard: 0, resolus_a_cloturer: 0, clotures: 0, actifs_avec_preuve: 0, actifs_sans_preuve: 0 }, preuves: { total: 0 } },
    priorites: [], indicateurs: [], activite_recente: [], justificatifs_intervenants: ALERTES.resume,
  };
  await monter("/tableau-de-bord-qualite", "admin", { [`GET /api/qualite/tableau-de-bord?aujourdhui=${aujourdhuiISO()}`]: base });
  await attendre(() => texte().includes("Justificatifs des intervenants"));
  assert.ok(texte().includes("Pièces attendues manquantes") && texte().includes("Repère de suivi, pas une non-conformité."));
  assert.ok([...document.querySelectorAll('a[href="/justificatifs-intervenants"]')].some((a) => a.textContent === "Voir les justificatifs des intervenants"));
});
