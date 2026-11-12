// Inventaire du périmètre documentaire Vigie — LECTURE SEULE.
// Parcourt le dossier racine et ses sous-dossiers (profondeur bornée, cohérente avec le contrôle
// D-R) et liste les Google Docs et Sheets. Seule la méthode files.list est utilisée :
// aucune création, aucune modification, aucune suppression, aucun partage.

import { PROFONDEUR_MAX } from "./documentsPreuves.js";

const MIME_DOSSIER = "application/vnd.google-apps.folder";
const TYPES = {
  "application/vnd.google-apps.document": "document",
  "application/vnd.google-apps.spreadsheet": "feuille",
};
export const LIMITE_INVENTAIRE = 1000;

// Identifiant Drive : caractères sûrs uniquement, avant toute requête.
export const ID_DRIVE_VALIDE = /^[A-Za-z0-9_-]{10,}$/;

export async function inventorierPerimetre({ drive, racineId, nomRacine, limite = LIMITE_INVENTAIRE, profondeur = PROFONDEUR_MAX }) {
  if (!ID_DRIVE_VALIDE.test(String(racineId))) throw new TypeError("Identifiant de racine invalide.");
  const fichiers = [];
  let tronque = false;
  let niveau = [{ id: racineId, chemin: nomRacine }];

  for (let distance = 0; distance < profondeur && niveau.length && !tronque; distance++) {
    const suivants = [];
    for (const dossier of niveau) {
      if (!ID_DRIVE_VALIDE.test(dossier.id)) continue; // identifiant inattendu : jamais injecté dans une requête
      let pageToken;
      do {
        const { data } = await drive.files.list({
          q: `'${dossier.id}' in parents and trashed = false`,
          fields: "nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime)",
          pageSize: 200,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        for (const f of data.files || []) {
          if (f.mimeType === MIME_DOSSIER) {
            suivants.push({ id: f.id, chemin: `${dossier.chemin} / ${f.name}` });
          } else if (TYPES[f.mimeType]) {
            if (fichiers.length >= limite) { tronque = true; break; }
            fichiers.push({
              id: f.id, nom: f.name, mime: f.mimeType, type: TYPES[f.mimeType],
              emplacement: dossier.chemin, modifie_le: f.modifiedTime || null, url: f.webViewLink || null,
            });
          }
        }
        pageToken = data.nextPageToken;
      } while (pageToken && !tronque);
      if (tronque) break;
    }
    niveau = suivants;
  }

  // Dossiers restant au-delà de la profondeur bornée : signalés, jamais lus.
  const dossiersNonParcourus = niveau.length;
  fichiers.sort((a, b) => a.emplacement.localeCompare(b.emplacement, "fr") || a.nom.localeCompare(b.nom, "fr"));
  return { fichiers, tronque: tronque || dossiersNonParcourus > 0, dossiers_non_parcourus: dossiersNonParcourus, limite };
}
