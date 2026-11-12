// Écran Preuves migré vers la couche documentaire : documents liés avec lien vers la fiche,
// actions par rôle, ajout via la couche documents, anciens fichiers sans doublon. API simulée.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, monter, saisir, texte } from "./outils.jsx";

const IND = (id, numero, libelle) => ({
  id, numero, libelle, non_applicable_force: false, statut: "maitrise", nb_preuves: 1, nb_a_confirmer: 0,
  categories: [], texte_source_verifie: true,
});
const REFERENTIEL = {
  version: { id: 1, code: "V9" }, totalIndicateurs: 32,
  score: { maitrise: 1, a_consolider: 0, a_risque: 0, non_applicable: 0, total: 1, preuves: 1, a_confirmer: 0, incomplets: 0 },
  criteres: [{ id: 1, numero: 1, libelle: "Information du public", indicateurs: [IND(101, 1, "Information accessible au public")] }],
};
const DOCUMENT = {
  id: 70, drive_file_id: "F1", nom: "Livret.pdf", url: "https://drive.google.com/file/d/F1/view",
  version_courante: 2, archive_le: null, origine: "manuel", a_revalider: true,
};
const PREUVE = (id, titre, extra = {}) => ({
  id, titre, description: null, indicateur_id: 101, indicateur: 1, critere: 1,
  statut: "maitrise", statut_effectif: "maitrise", a_confirmer: false, source: "manuel",
  mode_fichiers: "multiple", nb_fichiers: 1, fichiers_attendus: null, incomplet: false,
  type_alerte: null, periodicite_mois: null, date_echeance: null, date_derniere_revision: null,
  alerte_statut: null, fichiers: [], documents: [], candidats: [], ...extra,
});
const PREUVES = [PREUVE(1, "Livret d'accueil", { documents: [DOCUMENT], fichiers: [{ id: 1, drive_file_id: "F1", url: "https://drive.google.com/file/d/F1/view", nom: "Livret.pdf", source: "manuel" }] })];
const routes = (extra = {}) => ({
  "GET /api/preuves": { preuves: PREUVES, total: PREUVES.length },
  "GET /api/referentiel": REFERENTIEL,
  "GET /api/preuves/1": { preuve: PREUVES[0] },
  ...extra,
});

let natifs = 0;
beforeEach(() => { natifs = 0; window.confirm = () => { natifs++; return true; }; window.alert = () => { natifs++; }; });
afterEach(async () => { assert.equal(natifs, 0, "aucune boîte native"); await demonter(); });

const ouvrirPanneau = async () => {
  await attendre(() => texte().includes("Critère 1"));
  await cliquer(document.querySelector(".liste-preuves .preuve button"));
  await attendre(() => document.querySelector(".ui-drawer")?.textContent.includes("Livret.pdf"));
  return document.querySelector(".ui-drawer");
};

test("un document lié s'affiche avec son lien vers la fiche documentaire et son état de revalidation", async () => {
  await monter("/preuves", "admin", routes());
  const tiroir = await ouvrirPanneau();
  const lien = tiroir.querySelector('a[href="/documents/70"]');
  assert.ok(lien, "lien vers /documents/70");
  assert.equal(lien.textContent, "Livret.pdf");
  assert.ok(tiroir.textContent.includes("À revalider"));
  // L'ancien fichier legacy du même Drive n'est pas affiché une seconde fois.
  assert.equal(tiroir.querySelectorAll(".liste-fichiers li").length, 1);
});

test("contributeur : lien vers le document, sans action d'écriture", async () => {
  await monter("/preuves", "contributeur", routes());
  await attendre(() => texte().includes("Critère 1"));
  await cliquer(document.querySelector(".liste-preuves .preuve button"));
  await attendre(() => document.querySelector(".ui-drawer"));
  const tiroir = document.querySelector(".ui-drawer");
  assert.ok(tiroir.querySelector('a[href="/documents/70"]'));
  assert.equal(bouton("revalider"), undefined);
  assert.equal(tiroir.querySelector('button[aria-label="Retirer Livret.pdf"]'), null);
});

test("administrateur : revalider un lien à revalider envoie la route documentaire", async () => {
  const appels = await monter("/preuves", "admin", routes({ "POST /api/preuves/1/documents/70/revalider": { ok: true } }));
  const tiroir = await ouvrirPanneau();
  await cliquer(tiroir.querySelector('button[aria-label="Revalider Livret.pdf"]'));
  await attendre(() => appels.some((a) => a.methode === "POST" && a.chemin === "/api/preuves/1/documents/70/revalider"));
});

test("administrateur : retirer un document détache seulement le lien (route documentaire)", async () => {
  const appels = await monter("/preuves", "admin", routes({
    "DELETE /api/preuves/1/documents/70": { ok: true },
    "GET /api/preuves/1": { preuve: { ...PREUVES[0], documents: [], fichiers: [] } },
  }));
  const tiroir = await ouvrirPanneau();
  await cliquer(tiroir.querySelector('button[aria-label="Retirer Livret.pdf"]'));
  await attendre(() => appels.some((a) => a.methode === "DELETE" && a.chemin === "/api/preuves/1/documents/70"));
  assert.equal(appels.filter((a) => a.methode === "DELETE" && a.chemin.includes("/fichiers/")).length, 0, "plus de flux /fichiers");
});

test("ajout d'un fichier du Drive : rattachement par la couche documentaire", async () => {
  const appels = await monter("/preuves", "admin", routes({
    "GET /api/drive/recherche?q=rapport": { fichiers: [{ id: "NEW1", nom: "Rapport final.pdf", url: "https://drive.google.com/file/d/NEW1/view", mime: "application/pdf" }] },
    "POST /api/preuves/1/documents": { ok: true },
  }));
  const tiroir = await ouvrirPanneau();
  await saisir(tiroir.querySelector('input[aria-label="Chercher sur le Drive"]'), "rapport");
  await cliquer(bouton("Chercher"));
  await attendre(() => tiroir.textContent.includes("Rapport final.pdf"));
  await cliquer([...tiroir.querySelectorAll(".candidats button")].find((b) => b.textContent.includes("Rapport final.pdf")));
  await attendre(() => appels.some((a) => a.methode === "POST" && a.chemin === "/api/preuves/1/documents"));
  const envoi = appels.find((a) => a.methode === "POST" && a.chemin === "/api/preuves/1/documents");
  assert.equal(envoi.corps.drive_file_id, "NEW1");
  assert.equal(appels.filter((a) => a.chemin === "/api/preuves/1/fichiers").length, 0, "plus de POST /fichiers");
});

test("ancien enregistrement sans document : fichier legacy affiché, sans lien documentaire", async () => {
  const legacy = PREUVE(2, "Ancienne preuve", { documents: [], fichiers: [{ id: 9, drive_file_id: "L9", url: "https://drive.google.com/file/d/L9/view", nom: "Ancien.pdf", source: "manuel" }] });
  await monter("/preuves", "admin", { "GET /api/preuves": { preuves: [legacy], total: 1 }, "GET /api/referentiel": REFERENTIEL, "GET /api/preuves/2": { preuve: legacy } });
  await attendre(() => texte().includes("Critère 1"));
  await cliquer(document.querySelector(".liste-preuves .preuve button"));
  await attendre(() => document.querySelector(".ui-drawer")?.textContent.includes("Ancien.pdf"));
  const tiroir = document.querySelector(".ui-drawer");
  assert.equal(tiroir.querySelector('a[href="/documents/70"]'), null);
  assert.ok(tiroir.querySelector('a[href="https://drive.google.com/file/d/L9/view"]'));
  // Pas de confirmation ouverte : vérifié sans comparer un nœud DOM (un échec d'assertion sur un nœud serait très coûteux à afficher).
  assert.ok(!document.querySelector('[role="alertdialog"]'), "aucune confirmation ouverte");
});
