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
  const appels = { copies: 0, lecturesModele: 0, lecturesCopie: 0, remplacements: 0 };
  return {
    appels,
    drive: { files: { copy: async ({ requestBody }) => {
      appels.copies++;
      return { data: { id: "copie-" + appels.copies, name: requestBody.name, mimeType: mime, webViewLink: "https://d/c" } };
    } } },
    docs: { documents: {
      // Le modèle est lu sur l'ORIGINAL (id "MODELE") ; la copie relue
      // APRÈS remplacement est vide : tous ses marqueurs ont été remplacés.
      get: async ({ documentId }) => {
        if (documentId === "MODELE") { appels.lecturesModele++; return { data: document }; }
        appels.lecturesCopie++;
        return { data: { body: { content: [] }, headers: {}, footers: {} } };
      },
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
  assert.equal(apis.appels.lecturesModele, 1, "le modèle est lu pour y chercher les marqueurs");
  assert.equal(apis.appels.lecturesCopie, 1, "la copie est relue après remplacement");
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
  assert.equal(apis.appels.lecturesModele, 1, "mais une seule lecture du modèle");
  assert.equal(apis.appels.lecturesCopie, 2, "et chaque copie est relue après remplacement");
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
  assert.equal(apis.appels.lecturesModele, 0);
  assert.equal(apis.appels.lecturesCopie, 0, "pas de relecture de copie sur un Sheet");
});

// ── DOC-7E : orchestration du flux à DEUX PHASES pour les tableaux ──
// Doc JSON avec de VRAIS index absolus (startIndex/endIndex) : le plan
// d'écriture des tableaux (blocsTableaux.js) en dépend, contrairement à
// `docAvec` ci-dessus (purement pour la détection de marqueurs scalaires).
let compteurIdx = 0;
function pIdx(texte) {
  const c = texte + "\n";
  const debut = compteurIdx, fin = debut + c.length;
  compteurIdx = fin;
  return { startIndex: debut, endIndex: fin, paragraph: { elements: [{ startIndex: debut, endIndex: fin, textRun: { content: c } }] } };
}
function cIdx(texte) { const p = pIdx(texte); return { startIndex: p.startIndex, endIndex: p.endIndex, content: [p] }; }
function tIdx(lignes) {
  const debut = compteurIdx;
  const tableRows = lignes.map((cellules) => {
    const cs = cellules.map(cIdx);
    return { startIndex: cs[0].startIndex, endIndex: cs[cs.length - 1].endIndex, tableCells: cs };
  });
  const fin = tableRows[tableRows.length - 1].endIndex;
  compteurIdx = fin;
  // DOC-7E : conforme à la vraie API — startIndex/endIndex seulement sur
  // l'élément enveloppant, jamais sur `table` lui-même (vérifié en réel).
  return { startIndex: debut, endIndex: fin, table: { tableRows } };
}
function docAvecTableauBloc(nomBloc, nbColonnesTexte) {
  compteurIdx = 0;
  const entete = nbColonnesTexte.map(() => "Col");
  const modeleLigne = nbColonnesTexte.map((t, i) => (i === 0 ? `{{#${nomBloc}}}${t}` : i === nbColonnesTexte.length - 1 ? `${t}{{/${nomBloc}}}` : t));
  return { body: { content: [{ table: tIdx([entete, modeleLigne]).table }] }, headers: {}, footers: {} };
}
function copieApresPhase1(docModele, nbLignesAjoutees) {
  // Simule ce que Google renvoie APRÈS insertTableRow : les nouvelles
  // lignes sont VIERGES (un paragraphe vide par cellule), reconstruites
  // avec des index ABSOLUS cohérents (nouveau compteur) — jamais dérivées
  // de l'original par un décalage calculé.
  compteurIdx = 0;
  const t = docModele.body.content[0].table;
  const entete = t.tableRows[0].tableCells.map((c) => c.content[0].paragraph.elements[0].textRun.content.replace("\n", ""));
  const ligneModeleTexte = t.tableRows[1].tableCells.map((c) => c.content[0].paragraph.elements[0].textRun.content.replace("\n", ""));
  const vide = t.tableRows[1].tableCells.map(() => "");
  const lignes = [entete, ligneModeleTexte, ...Array.from({ length: nbLignesAjoutees }, () => vide)];
  return { body: { content: [tIdx(lignes)] }, headers: {}, footers: {} };
}

function faussesApisTableau(docModele, { copieApresPhase1Json = null, echecBatchUpdateNo = null } = {}) {
  const appels = { copies: 0, batchUpdates: 0, lecturesModele: 0, lecturesCopie: 0 };
  let appelBatch = 0;
  return {
    appels,
    drive: { files: { copy: async ({ requestBody }) => { appels.copies++; return { data: { id: "copie-1", name: requestBody.name, mimeType: DOC, webViewLink: "https://d/c" } }; } } },
    docs: { documents: {
      get: async ({ documentId }) => {
        if (documentId === "MODELE") { appels.lecturesModele++; return { data: docModele }; }
        appels.lecturesCopie++;
        // 1re relecture (post-phase 1) : état structurel ; relectures
        // suivantes (vérification finale) : plus aucun marqueur.
        if (appels.lecturesCopie === 1 && copieApresPhase1Json) return { data: copieApresPhase1Json };
        return { data: { body: { content: [] }, headers: {}, footers: {} } };
      },
      batchUpdate: async () => {
        appelBatch++;
        appels.batchUpdates++;
        if (echecBatchUpdateNo === appelBatch) throw Object.assign(new Error("Requête invalide"), { response: { status: 400 } });
        return { data: {} };
      },
    } },
    sheets: { spreadsheets: {} },
  };
}

test("DOC-7E : 3 lignes (2 nouvelles) → structure, RELECTURE, contenu — 2 batchUpdate, 1 relecture de structure + 1 vérification finale", async () => {
  const docModele = docAvecTableauBloc("absences", ["{{absence_date}}", "{{absence_motif}}"]);
  const copieApres = copieApresPhase1(docModele, 2); // 2 lignes ajoutées (3 au total)
  const apis = faussesApisTableau(docModele, { copieApresPhase1Json: copieApres });
  const lignesBloc = [
    { date_absence: "2026-01-05", motif: "A" },
    { date_absence: "2026-01-06", motif: "B" },
    { date_absence: "2026-01-07", motif: "C" },
  ];
  const r = await copierEtRemplir(apis, { modele: { ...modele, drive_file_id: "MODELE" }, nom: "Livret", dossierId: "d", valeurs: {}, blocs: { absences: lignesBloc } });
  assert.equal(r.marqueursRemplaces, true);
  assert.equal(apis.appels.batchUpdates, 2, "phase structure puis phase contenu");
  assert.equal(apis.appels.lecturesCopie, 2, "1 relecture pour les vrais index + 1 vérification finale");
});

test("DOC-7E : 1 ligne (aucune nouvelle) → PAS de relecture de structure (index du modèle réutilisés)", async () => {
  const docModele = docAvecTableauBloc("absences", ["{{absence_date}}", "{{absence_motif}}"]);
  const apis = faussesApisTableau(docModele);
  const r = await copierEtRemplir(apis, { modele: { ...modele, drive_file_id: "MODELE" }, nom: "Livret", dossierId: "d", valeurs: {}, blocs: { absences: [{ date_absence: "2026-01-05", motif: "A" }] } });
  assert.equal(r.marqueursRemplaces, true);
  // Toujours 2 batchUpdate (structure, puis contenu) — l'OPTIMISATION porte
  // sur la LECTURE (documents.get), pas sur le nombre d'écritures.
  assert.equal(apis.appels.batchUpdates, 2, "phase structure puis phase contenu, même sans insertion");
  assert.equal(apis.appels.lecturesCopie, 1, "aucune relecture de structure (index du MODÈLE réutilisés), seulement la vérification finale");
});

test("DOC-7E : échec du batchUpdate de CONTENU (2e appel) — l'erreur remonte, aucun document présenté comme réussi", async () => {
  const docModele = docAvecTableauBloc("absences", ["{{absence_date}}", "{{absence_motif}}"]);
  const copieApres = copieApresPhase1(docModele, 2);
  const apis = faussesApisTableau(docModele, { copieApresPhase1Json: copieApres, echecBatchUpdateNo: 2 });
  await assert.rejects(
    copierEtRemplir(apis, {
      modele: { ...modele, drive_file_id: "MODELE" }, nom: "Livret", dossierId: "d", valeurs: {},
      blocs: { absences: [{ date_absence: "2026-01-05", motif: "A" }, { date_absence: "2026-01-06", motif: "B" }, { date_absence: "2026-01-07", motif: "C" }] },
    }),
    /Requête invalide/,
  );
  assert.equal(apis.appels.batchUpdates, 2, "le 1er (structure) a réussi, le 2e (contenu) a échoué — propagé, jamais avalé");
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
