// Inventaire Drive des modèles (administrateur, LECTURE SEULE). Aucune écriture en base, aucune
// écriture sur Drive, aucune génération. Les propositions renvoyées ne sont jamais enregistrées.
import { Router } from "express";
import { config } from "../config.js";
import { query } from "../db.js";
import { requireAdmin } from "../session.js";
import { contexteControleDrive } from "../services/controleDrive.js";
import { ErreurDocument, resoudreRacine } from "../services/documentsPreuves.js";
import { analyserModeleDrive } from "../services/diagnosticModele.js";
import { etatJeton, getDrive } from "../services/google.js";
import { ID_DRIVE_VALIDE, inventorierPerimetre } from "../services/inventaireDrive.js";
import { classer, marqueursDe, proposer } from "../services/inventaireModeles.js";
import { repondreErreurDocument } from "./documentsErreurs.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const DRIVE_INDISPONIBLE = { error: "Google Drive est indisponible : l'inventaire n'a pas pu être lu.", code: "drive_indisponible" };

// Inventaire du périmètre : fichiers Docs et Sheets, avec leurs déclarations existantes dans Vigie.
router.get("/inventaire-drive", requireAdmin, wrap(async (_req, res) => {
  const d = await getDrive();
  if (!d) return res.status(503).json(DRIVE_INDISPONIBLE);
  let inventaire;
  try {
    const racineId = await resoudreRacine(d.drive, { driveRacineId: config.driveRacineId, driveRacine: config.driveRacine });
    inventaire = await inventorierPerimetre({ drive: d.drive, racineId, nomRacine: config.driveRacine });
  } catch (e) {
    if (e instanceof ErreurDocument) return repondreErreurDocument(res, e) || res.status(503).json(DRIVE_INDISPONIBLE);
    console.error("Inventaire Drive : " + (e?.code || e?.status || "erreur"));
    return res.status(503).json(DRIVE_INDISPONIBLE);
  }

  const ids = inventaire.fichiers.map((f) => f.id);
  const { rows } = ids.length
    ? await query("SELECT id, nom, drive_file_id, portee, actif FROM modeles_documents WHERE drive_file_id = ANY($1::text[]) ORDER BY id", [ids])
    : { rows: [] };
  const declarations = new Map();
  for (const m of rows) {
    if (!declarations.has(m.drive_file_id)) declarations.set(m.drive_file_id, []);
    declarations.get(m.drive_file_id).push({ id: m.id, nom: m.nom, portee: m.portee, actif: m.actif });
  }
  res.json({
    racine: config.driveRacine,
    fichiers: inventaire.fichiers.map((f) => ({ ...f, declarations: declarations.get(f.id) || [] })),
    tronque: inventaire.tronque,
    dossiers_non_parcourus: inventaire.dossiers_non_parcourus,
    limite: inventaire.limite,
    lecture_seule: true,
  });
}));

// Diagnostic d'un fichier candidat : refusé hors périmètre (même contrôle que pour une création),
// analysé par le diagnostic existant. Renvoie aussi un classement et une proposition, non enregistrés.
router.post("/inventaire-drive/diagnostic", requireAdmin, wrap(async (req, res) => {
  const fileId = String(req.body?.drive_file_id || "").trim();
  if (!ID_DRIVE_VALIDE.test(fileId)) return res.status(400).json({ error: "Identifiant Drive invalide." });
  const d = await getDrive();
  if (!d) return res.status(503).json(DRIVE_INDISPONIBLE);
  try {
    const controle = await contexteControleDrive();
    await controle(fileId);
    const { data: fichier } = await d.drive.files.get({
      fileId, fields: "id,name,mimeType,webViewLink,modifiedTime", supportsAllDrives: true,
    });
    const diagnostic = await analyserModeleDrive({ drive_file_id: fileId, nom: fichier.name }, d, etatJeton(d.row));
    res.json({
      fichier: { id: fichier.id, nom: fichier.name, mime: fichier.mimeType, url: fichier.webViewLink || null, modifie_le: fichier.modifiedTime || null },
      diagnostic,
      marqueurs: marqueursDe(diagnostic),
      classement: classer(diagnostic),
      proposition: proposer({ nom: fichier.name }),
      enregistre: false,
    });
  } catch (e) {
    if (repondreErreurDocument(res, e)) return;
    if (e?.statut && e?.code) return res.status(e.statut).json({ error: e.message, code: e.code });
    console.error("Diagnostic inventaire : " + (e?.code || e?.status || "erreur"));
    return res.status(400).json({ error: "Impossible d'analyser ce fichier." });
  }
}));

export default router;
