// Contexte de contrôle Drive (spec §5.3, §5.4) construit depuis la configuration réelle :
// client Drive connecté, racine Vigie (driveRacineId, sinon driveRacine), compte
// DRIVE_ACCOUNT_EMAIL et administrateurs actifs.
//
// `precontroleFichier` s'exécute AVANT la transaction : les appels réseau ne tiennent
// aucun verrou. Il renvoie une fonction de contrôle déjà satisfaite, passée au service.

import { config } from "../config.js";
import { query } from "../db.js";
import { getDrive } from "./google.js";
import { controleDriveFichier, resoudreRacine, ErreurDocument } from "./documentsPreuves.js";

let racineMemo = null;

// Une panne Drive pendant un contrôle n'est jamais une erreur serveur : 404 ⇒ fichier
// introuvable (400), le reste ⇒ Drive indisponible (503).
function erreurDrive(e) {
  if (e instanceof ErreurDocument) return e;
  const statut = e?.status ?? e?.response?.status ?? e?.code;
  if (statut === 404) return new ErreurDocument(400, "fichier_introuvable", "Fichier Drive introuvable ou inaccessible.");
  return new ErreurDocument(503, "drive_indisponible", "Google Drive est momentanément indisponible. Réessayez.");
}

async function protegerDrive(fn) {
  try {
    return await fn();
  } catch (e) {
    throw erreurDrive(e);
  }
}

async function racineVigie(drive) {
  if (config.driveRacineId) return config.driveRacineId;
  if (!racineMemo) {
    racineMemo = protegerDrive(() => resoudreRacine(drive, { driveRacineId: "", driveRacine: config.driveRacine }))
      .catch((e) => { racineMemo = null; throw e; });
  }
  return racineMemo;
}

export async function contexteControleDrive() {
  const d = await getDrive();
  if (!d) throw new ErreurDocument(503, "drive_indisponible", "Google Drive est indisponible ou non connecté. Impossible de vérifier le fichier.");
  const racineId = await racineVigie(d.drive);
  const { rows } = await query("SELECT email FROM utilisateurs WHERE role = 'admin' AND actif");
  const emailsAutorises = new Set([config.driveAccountEmail, ...rows.map((r) => String(r.email).toLowerCase())]);
  return (fileId) => protegerDrive(() => controleDriveFichier(d.drive, fileId, {
    racineId, compteVigie: config.driveAccountEmail, emailsAutorises,
  }));
}

const DEJA_CONTROLE = async () => ({ ok: true });

// Identité déjà connue : aucun contrôle Drive (le service rattache le document existant
// ou refuse). Sinon : contrôle complet, avant toute transaction.
export async function precontroleFichier(fileId) {
  const { rows } = await query("SELECT 1 FROM document_versions WHERE drive_file_id = $1", [String(fileId).trim()]);
  if (rows.length) return DEJA_CONTROLE;
  const controle = await contexteControleDrive();
  await controle(String(fileId).trim());
  return DEJA_CONTROLE;
}

// Liste des fichiers d'un import : contrôle des seuls fichiers inconnus, avant la transaction.
// Renvoie la liste des identifiants contrôlés, à passer au service sous forme de fonction.
export async function precontroleFichiers(fileIds) {
  const uniques = [...new Set(fileIds.map((f) => String(f).trim()).filter(Boolean))];
  if (!uniques.length) return { controle: DEJA_CONTROLE };
  const { rows } = await query("SELECT drive_file_id FROM document_versions WHERE drive_file_id = ANY($1::text[])", [uniques]);
  const connus = new Set(rows.map((r) => r.drive_file_id));
  const inconnus = uniques.filter((f) => !connus.has(f));
  const verifies = new Set();
  if (inconnus.length) {
    const controle = await contexteControleDrive();
    for (const f of inconnus) {
      await controle(f);
      verifies.add(f);
    }
  }
  return {
    controle: async (fileId) => {
      if (connus.has(fileId) || verifies.has(fileId)) return { ok: true };
      throw new ErreurDocument(409, "controle_drive_absent", "Ce fichier n'a pas été contrôlé avant l'écriture.");
    },
  };
}

export { DEJA_CONTROLE };
