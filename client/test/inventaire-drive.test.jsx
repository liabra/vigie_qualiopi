// Inventaire Drive des modèles — lecture seule : liste, déclarations, analyse, propositions non
// enregistrées, export CSV, erreurs. API simulée ; aucune écriture de modèle attendue.
import "./dom.mjs";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, monter, texte } from "./outils.jsx";

const FICHIERS = [
  { id: "FICHIER_CONVOC_01", nom: "Convocation session.docx", type: "document", emplacement: "A2C / Modèles",
    modifie_le: "2026-10-05T09:00:00Z", url: "https://docs.google.com/document/d/FICHIER_CONVOC_01/edit",
    declarations: [{ id: 7, nom: "Convocation", portee: "session", actif: true }] },
  { id: "FICHIER_EMARG_01", nom: "=Émargement.xlsx", type: "feuille", emplacement: "A2C / Modèles",
    modifie_le: null, url: "https://docs.google.com/spreadsheets/d/FICHIER_EMARG_01/edit", declarations: [] },
];
const ANALYSE = {
  fichier: { id: "FICHIER_CONVOC_01", nom: "Convocation session.docx" },
  diagnostic: {}, enregistre: false,
  marqueurs: { reconnus: ["stagiaire_nom"], historiques: ["nom_stagiaire"], inconnus: ["zz"] },
  classement: { statut: "correction", motifs: ["balise(s) inconnue(s) : 1"] },
  proposition: { type_document: "convocation", portee: "session", mode_generation: "manuel", indicateurs: [9], motifs: ["type déduit du mot « convocation » dans le nom"], statut: "proposition_non_enregistree" },
};
const INVENTAIRE = { racine: "A2C", fichiers: FICHIERS, tronque: false, dossiers_non_parcourus: 0, limite: 1000, lecture_seule: true };

let natifs = 0;
afterEach(async () => { assert.equal(natifs, 0, "aucune boîte native"); await demonter(); });

test("inventaire : fichiers listés, déclarations visibles, fichier non déclaré signalé", async () => {
  await monter("/parametres/inventaire-drive", "admin", { "GET /api/inventaire-drive": INVENTAIRE });
  await cliquer(bouton("Lancer l'inventaire"));
  await attendre(() => texte().includes("Convocation session.docx"));
  assert.ok(texte().includes("Actif"), "déclaration active visible");
  assert.ok(texte().includes("Non déclaré"), "fichier non déclaré signalé");
  assert.ok(texte().includes("Lecture seule"), "rappel de lecture seule");
});

test("filtre « non déclarés seulement » et recherche par nom", async () => {
  await monter("/parametres/inventaire-drive", "admin", { "GET /api/inventaire-drive": INVENTAIRE });
  await cliquer(bouton("Lancer l'inventaire"));
  await attendre(() => texte().includes("Convocation session.docx"));
  await cliquer(document.querySelector('input[type="checkbox"]'));
  await attendre(() => !texte().includes("Convocation session.docx"));
  assert.ok(texte().includes("1 fichier(s) affiché(s) sur 2"));
});

test("analyse : marqueurs par famille, classement, proposition affichée comme non enregistrée", async () => {
  const appels = await monter("/parametres/inventaire-drive", "admin", {
    "GET /api/inventaire-drive": INVENTAIRE,
    "POST /api/inventaire-drive/diagnostic": ANALYSE,
  });
  await cliquer(bouton("Lancer l'inventaire"));
  await attendre(() => texte().includes("Convocation session.docx"));
  await cliquer(document.querySelector('button[aria-label="Analyser le fichier Convocation session.docx"]'));
  await attendre(() => texte().includes("Proposition (non enregistrée)"));
  assert.ok(texte().includes("Correction requise"));
  assert.ok(texte().includes("Reconnus"));
  assert.ok(texte().includes("Indicateur(s) 9"), "indicateur suggéré visible, non attribué");
  const envoi = appels.find((a) => a.methode === "POST" && a.chemin === "/api/inventaire-drive/diagnostic");
  assert.deepEqual(envoi.corps, { drive_file_id: "FICHIER_CONVOC_01" });
  assert.equal(appels.some((a) => a.methode !== "GET" && a.methode !== "POST" || a.chemin === "/api/modeles" && a.methode === "POST"), false, "aucune création de modèle");
});

test("export CSV : séparateur ;, neutralisation des formules, lignes des fichiers affichés", async () => {
  let contenu = null;
  const creer = URL.createObjectURL;
  URL.createObjectURL = (blob) => { contenu = blob; return "blob:test"; };
  URL.revokeObjectURL = () => {};
  try {
    await monter("/parametres/inventaire-drive", "admin", { "GET /api/inventaire-drive": INVENTAIRE, "POST /api/inventaire-drive/diagnostic": ANALYSE });
    await cliquer(bouton("Lancer l'inventaire"));
    await attendre(() => texte().includes("Convocation session.docx"));
    await cliquer(bouton("Exporter en CSV"));
    await attendre(() => contenu !== null);
    const octets = new Uint8Array(await contenu.arrayBuffer());
    assert.deepEqual([...octets.slice(0, 3)], [0xef, 0xbb, 0xbf], "marque d'ordre des octets UTF-8");
    const texteCsv = await contenu.text();
    assert.ok(texteCsv.startsWith("Nom;Identifiant Drive;"), "en-têtes");
    assert.ok(texteCsv.includes("Convocation session.docx;FICHIER_CONVOC_01"), "ligne du fichier");
    assert.ok(texteCsv.includes("'=Émargement.xlsx"), "formule neutralisée");
  } finally {
    URL.createObjectURL = creer;
  }
});

test("Drive indisponible : message clair, aucune liste affichée", async () => {
  await monter("/parametres/inventaire-drive", "admin", {
    "GET /api/inventaire-drive": [503, { error: "Google Drive est indisponible : l'inventaire n'a pas pu être lu.", code: "drive_indisponible" }],
  });
  await cliquer(bouton("Lancer l'inventaire"));
  await attendre(() => texte().includes("n'a pas pu être lu"));
  assert.equal(texte().includes("Convocation session.docx"), false);
});
