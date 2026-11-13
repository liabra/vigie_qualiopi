// Périmètre documentaire Vigie sur Google Drive — LECTURE SEULE.
// Résout le dossier racine (sans jamais le créer) et vérifie qu'un fichier s'y trouve.
// Aucune méthode d'écriture Drive n'est utilisée ici.
import { config } from "../config.js";

// Profondeur maximale explorée sous la racine (inventaire et contrôle d'appartenance).
export const PROFONDEUR_MAX = 10;
const MIME_DOSSIER = "application/vnd.google-apps.folder";

export class ErreurPerimetre extends Error {
  constructor(statut, code, message) {
    super(message);
    this.statut = statut;
    this.code = code;
  }
}

const echappe = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

// Racine : identifiant configuré, sinon dossier unique de ce nom à la racine du Drive.
export async function resoudreRacine(drive, { driveRacineId = config.driveRacineId, driveRacine = config.driveRacine } = {}) {
  if (driveRacineId) return driveRacineId;
  const { data } = await drive.files.list({
    q: `name = '${echappe(driveRacine)}' and mimeType = '${MIME_DOSSIER}' and 'root' in parents and trashed = false`,
    fields: "files(id,name)",
    pageSize: 2,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const dossiers = data.files || [];
  if (dossiers.length !== 1) {
    throw new ErreurPerimetre(409, "racine_introuvable", "Dossier racine Vigie introuvable ou ambigu : configurez DRIVE_RACINE_ID.");
  }
  return dossiers[0].id;
}

// Le fichier doit être sous la racine (profondeur bornée) et hors de la corbeille.
export async function verifierDansPerimetre(drive, fileId, racineId) {
  const { data: fichier } = await drive.files.get({ fileId, fields: "id,parents,trashed", supportsAllDrives: true });
  if (fichier.trashed) throw new ErreurPerimetre(409, "fichier_corbeille", "Ce fichier est à la corbeille Drive.");
  let niveau = [...(fichier.parents || [])];
  const vus = new Set();
  for (let distance = 1; distance <= PROFONDEUR_MAX && niveau.length; distance++) {
    if (niveau.includes(racineId)) return;
    const suivants = [];
    for (const parent of niveau) {
      if (vus.has(parent)) continue;
      vus.add(parent);
      const { data } = await drive.files.get({ fileId: parent, fields: "id,parents", supportsAllDrives: true });
      suivants.push(...(data.parents || []));
    }
    niveau = suivants;
  }
  throw new ErreurPerimetre(409, "fichier_hors_racine", "Ce fichier n'est pas dans le dossier Vigie (ou trop profondément imbriqué).");
}
