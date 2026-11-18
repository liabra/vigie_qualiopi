// Faux client Drive / Docs / Sheets pour le pipeline de génération (copie, marqueurs, relecture).
// Aucun réseau. Partagé par les tests de génération simulés et de bout en bout.
import { DRIVE_FILE } from "../../src/services/google.js";

const DOC = "application/vnd.google-apps.document";

export function clientDriveSimule({ depart = 0, modeleGet = null, mimeModele = DOC, trashModele = false, echecGet = null,
  echecCopy = null, echecBatch = null, echecTrash = null, attente = null, journal = null,
  modeleTexte = "{{nom_stagiaire}}", modeleGrille = null, remplacementIgnorer = [] } = {}) {
  const trace = { copies: 0, copiesCreees: [], corbeille: [], relectures: 0, relecturesSheet: 0, remplacements: 0, dossiersCrees: 0, ciblesReplacees: [] };
  const noter = (evt) => { if (journal) journal.push(evt); };
  const contenuCopies = new Map(); // copie-Id → texte (Doc), initialisé à l'identique du modèle
  const grilleCopies = new Map();  // copie-Id → grille (Sheet), idem
  trace.contenuCopies = contenuCopies;
  trace.grilleCopies = grilleCopies;
  let n = 0;
  const client = {
    row: { scopes: DRIVE_FILE, expiry: Date.now() + 60_000, access_token: "x" },
    drive: {
      files: {
        get: async () => {
          if (echecGet) throw Object.assign(new Error(echecGet.message), { response: { status: echecGet.statut } });
          return { data: { id: "MODELE", name: "Attestation", mimeType: modeleGet || mimeModele, trashed: trashModele } };
        },
        list: async () => ({ data: { files: [] } }),
        create: async () => { trace.dossiersCrees++; return { data: { id: "dossier-" + ++n } }; },
        copy: async ({ requestBody }) => {
          if (attente) await attente;
          if (echecCopy) throw Object.assign(new Error(echecCopy.message), { response: { status: echecCopy.statut } });
          trace.copies++;
          const id = "copie-" + (depart + trace.copies);
          trace.copiesCreees.push(id);
          contenuCopies.set(id, modeleTexte);
          grilleCopies.set(id, (modeleGrille || []).map((r) => [...r]));
          noter("Drive:copy:" + id);
          return { data: { id, name: requestBody.name, webViewLink: "https://d/" + id, mimeType: mimeModele } };
        },
        update: async ({ fileId, requestBody }) => {
          if (requestBody?.trashed) {
            if (echecTrash) throw Object.assign(new Error(echecTrash.message), { response: { status: echecTrash.statut } });
            trace.corbeille.push(fileId);
            noter("Drive:trash:" + fileId);
          }
          return { data: {} };
        },
      },
    },
    docs: {
      documents: {
        get: async ({ documentId }) => {
          if (documentId !== "MODELE") {
            trace.relectures++;
            const texte = contenuCopies.get(documentId) ?? "";
            return { data: { body: { content: [{ paragraph: { elements: [{ textRun: { content: texte } }] } }] }, headers: {}, footers: {} } };
          }
          return { data: { body: { content: [{ paragraph: { elements: [{ textRun: { content: modeleTexte } }] } }] }, headers: {}, footers: {} } };
        },
        batchUpdate: async ({ documentId, requestBody }) => {
          if (echecBatch) throw Object.assign(new Error(echecBatch.message), { response: { status: echecBatch.statut } });
          trace.remplacements++;
          let resultat = contenuCopies.get(documentId) ?? modeleTexte;
          for (const r of requestBody?.requests || []) {
            const cible = r.replaceAllText?.containsText?.text;
            if (!cible || remplacementIgnorer.includes(cible)) continue;
            trace.ciblesReplacees.push({ cible, remplacement: r.replaceAllText?.replaceText ?? "" });
            resultat = resultat.split(cible).join(r.replaceAllText?.replaceText ?? "");
          }
          contenuCopies.set(documentId, resultat);
          return { data: {} };
        },
      },
    },
    sheets: { spreadsheets: {
      get: async ({ spreadsheetId }) => {
        if (spreadsheetId !== "MODELE") trace.relecturesSheet++;
        return { data: { sheets: [{ properties: { title: "Feuille 1", index: 0, gridProperties: { rowCount: 5, columnCount: 5 } } }] } };
      },
      values: { get: async ({ spreadsheetId }) => {
        const grille = spreadsheetId === "MODELE" ? (modeleGrille || []) : (grilleCopies.get(spreadsheetId) || []);
        return { data: { values: grille } };
      } },
      batchUpdate: async ({ spreadsheetId, requestBody }) => {
        if (echecBatch) throw Object.assign(new Error(echecBatch.message), { response: { status: echecBatch.statut } });
        trace.remplacements++;
        const grille = (grilleCopies.get(spreadsheetId) || []).map((r) => [...r]);
        for (const req of requestBody?.requests || []) {
          const fr = req.findReplace;
          if (!fr || remplacementIgnorer.includes(fr.find)) continue;
          trace.ciblesReplacees.push({ cible: fr.find, remplacement: fr.replacement ?? "" });
          for (const ligne of grille) for (let i = 0; i < ligne.length; i++) {
            if (typeof ligne[i] === "string") ligne[i] = ligne[i].split(fr.find).join(fr.replacement ?? "");
          }
        }
        grilleCopies.set(spreadsheetId, grille);
        return { data: {} };
      },
    } },
  };
  return { trace, client };
}
