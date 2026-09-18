// La détection des marqueurs inconnus doit VRAIMENT tourner pendant la
// génération : un modèle contenant {{civilite}} avant que ce marqueur
// n'existe devait alerter, pas produire un succès silencieux.
// copierEtRemplir n'a besoin d'aucune base : on lui passe de faux
// clients Google.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copierEtRemplir, texteDuDocument } from "../src/services/documents.js";

const DOC = "application/vnd.google-apps.document";
const SHEET = "application/vnd.google-apps.spreadsheet";

// Document Google tel que l'API le renvoie : paragraphes, tableau,
// en-tête et pied de page.
const docAvec = (textes) => ({
  body: { content: [
    { paragraph: { elements: [{ textRun: { content: textes.corps || "" } }] } },
    { table: { tableRows: [{ tableCells: [
      { content: [{ paragraph: { elements: [{ textRun: { content: textes.tableau || "" } }] } }] },
    ] }] } },
  ] },
  headers: textes.entete ? { h1: { content: [{ paragraph: { elements: [{ textRun: { content: textes.entete } }] } }] } } : {},
  footers: textes.pied ? { f1: { content: [{ paragraph: { elements: [{ textRun: { content: textes.pied } }] } }] } } : {},
});

function faussesApis(document, mime = DOC) {
  const appels = { copies: 0, lectures: 0, remplacements: 0 };
  return {
    appels,
    drive: { files: { copy: async ({ requestBody }) => {
      appels.copies++;
      return { data: { id: "copie-" + appels.copies, name: requestBody.name, mimeType: mime, webViewLink: "https://d/c" } };
    } } },
    docs: { documents: {
      get: async () => { appels.lectures++; return { data: document }; },
      batchUpdate: async () => { appels.remplacements++; return { data: {} }; },
    } },
    sheets: { spreadsheets: { batchUpdate: async () => { appels.remplacements++; return { data: {} }; } } },
  };
}

const modele = { id: 1, nom: "Attestation", drive_file_id: "MODELE", drive_mime: DOC, portee: "stagiaire" };
const copier = (clients, extra = {}) =>
  copierEtRemplir(clients, { modele, nom: "Attestation - Dupont", dossierId: "dossier", valeurs: {}, ...extra });

test("le texte est extrait du corps, des tableaux, de l'en-tête et du pied de page", () => {
  const t = texteDuDocument(docAvec({ corps: "Bonjour {{nom_stagiaire}}", tableau: "{{duree}}", entete: "{{nom_organisme}}", pied: "{{lieu}}" }));
  for (const attendu of ["{{nom_stagiaire}}", "{{duree}}", "{{nom_organisme}}", "{{lieu}}"]) {
    assert.ok(t.includes(attendu), "manquant : " + attendu);
  }
  assert.equal(texteDuDocument(null), "");
});

test("un marqueur non reconnu dans le modèle est remonté par la génération", async () => {
  const apis = faussesApis(docAvec({ corps: "{{civilite}} {{nom_stagiaire}}, née le {{date_naissance}}" }));
  const r = await copier(apis);
  assert.equal(r.marqueursRemplaces, true);
  assert.equal(r.detectionMarqueurs, true);
  // civilite existe désormais dans la convention, date_naissance non
  assert.deepEqual(r.marqueursInconnusTrouves, ["date_naissance"]);
  assert.equal(apis.appels.lectures, 1, "le modèle est lu pour y chercher les marqueurs");
  assert.equal(apis.appels.remplacements, 1);
});

test("un modèle propre ne remonte aucun avertissement", async () => {
  const apis = faussesApis(docAvec({ corps: "{{civilite}} {{nom_stagiaire}} {{prenom_stagiaire}}", tableau: "{{date_debut}}" }));
  const r = await copier(apis);
  assert.deepEqual(r.marqueursInconnusTrouves, []);
  assert.equal(r.detectionMarqueurs, true);
});

test("un marqueur caché dans un tableau ou un pied de page est vu aussi", async () => {
  const apis = faussesApis(docAvec({ corps: "{{nom_stagiaire}}", tableau: "{{signature_formateur}}", pied: "{{tampon}}" }));
  const r = await copier(apis);
  assert.deepEqual(r.marqueursInconnusTrouves.sort(), ["signature_formateur", "tampon"]);
});

test("le modèle n'est lu qu'une fois pour plusieurs copies", async () => {
  const apis = faussesApis(docAvec({ corps: "{{inconnu_x}}" }));
  const cacheMarqueurs = new Map();
  const r1 = await copier(apis, { cacheMarqueurs });
  const r2 = await copier(apis, { cacheMarqueurs });
  assert.equal(apis.appels.copies, 2, "deux copies produites");
  assert.equal(apis.appels.lectures, 1, "mais une seule lecture du modèle");
  assert.deepEqual(r1.marqueursInconnusTrouves, ["inconnu_x"]);
  assert.deepEqual(r2.marqueursInconnusTrouves, ["inconnu_x"]);
});

test("sur un Sheet, la détection est annoncée comme non faite plutôt que silencieuse", async () => {
  const apis = faussesApis(docAvec({ corps: "peu importe" }), SHEET);
  const r = await copierEtRemplir(apis, {
    modele: { ...modele, drive_mime: SHEET }, nom: "Émargement", dossierId: "d", valeurs: {},
  });
  assert.equal(r.marqueursRemplaces, true, "les marqueurs sont bien remplacés");
  assert.equal(r.detectionMarqueurs, false, "mais aucun contrôle des marqueurs inconnus");
  assert.deepEqual(r.marqueursInconnusTrouves, []);
  assert.equal(apis.appels.lectures, 0);
});

test("si le modèle ne peut pas être lu, la génération se fait quand même", async () => {
  const apis = faussesApis(docAvec({ corps: "peu importe" }));
  apis.docs.documents.get = async () => { throw Object.assign(new Error("Permission refusée"), { code: 403 }); };
  const vraiErr = console.error;
  console.error = () => {};
  try {
    const r = await copier(apis);
    assert.equal(r.marqueursRemplaces, true, "le document est bien produit");
    assert.equal(r.detectionMarqueurs, false, "mais le contrôle n'a pas pu être fait");
    assert.deepEqual(r.marqueursInconnusTrouves, []);
  } finally { console.error = vraiErr; }
});
