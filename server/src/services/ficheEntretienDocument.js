// ─────────────────────────────────────────────────────────────
//  DOC-9E — Génération réelle du document Google Docs de la fiche
//  d'entretien FSE-IA, depuis les données structurées d'un entretien
//  VALIDÉ. Seul module de ce chantier qui appelle Google.
//
//  Le modèle Drive officiel reste inaccessible dans cet environnement :
//  ce document est créé DIRECTEMENT par Vigie (`drive.files.create` dans
//  le dossier habituel des documents générés, puis un seul `batchUpdate`
//  d'insertion de texte), pas une copie du modèle —
//  voir `VIGIE_AGENT_LOG.md` (DOC-9E) et la migration 031 pour le détail
//  de cette décision et ce qui reste à faire pour converger vers le
//  modèle réel dès que son accès sera rétabli.
// ─────────────────────────────────────────────────────────────
import { appelGoogle } from "./google.js";
import { nettoyerCopies, dossier } from "./documents.js";
import { construireTexteFiche } from "./ficheEntretien.js";
import { config } from "../config.js";

const MIME_DOC = "application/vnd.google-apps.document";

function nomFicheSain(stagiaire, entretienId) {
  const brut = `Fiche entretien FSE-IA - ${stagiaire.nom} ${stagiaire.prenom} - ${entretienId}`;
  // Jamais de séparateur de chemin ni de nom vide (même règle que les
  // autres documents générés par Vigie).
  return brut.replace(/[\\/]/g, "-").trim() || `Fiche entretien FSE-IA ${entretienId}`;
}

// `donneesEntretien` : le résultat de `chargerEntretienComplet()`.
// `ancienFicheId` : fiche précédemment générée pour CE MÊME entretien, mise
// à la corbeille UNIQUEMENT après le succès de la nouvelle (jamais avant,
// pour ne jamais se retrouver sans aucune fiche en cas d'échec).
export async function genererFicheEntretienDocument(d, { donneesEntretien, stagiaire, ancienFicheId = null }, jeton) {
  const texte = construireTexteFiche({ stagiaire, ...donneesEntretien });
  const nom = nomFicheSain(stagiaire, donneesEntretien.entretien.id);

  let documentId = null;
  try {
    // Rangé au même endroit que tous les autres documents générés par
    // Vigie (racine configurée), jamais à la racine brute du compte Drive
    // connecté — sans quoi les fiches deviendraient introuvables pour
    // l'équipe (DOC-9E, audit de rentrée).
    const racine = await dossier(d.drive, config.driveRacine, config.driveRacineId || null, jeton);
    const dossierEntretiens = await dossier(d.drive, "Entretiens FSE-IA", racine, jeton);

    const { data: cree } = await appelGoogle(
      "drive.files.create",
      () => d.drive.files.create({
        requestBody: { name: nom, mimeType: MIME_DOC, parents: [dossierEntretiens] },
        fields: "id", supportsAllDrives: true,
      }),
      { api: "drive", jeton }
    );
    documentId = cree.id;

    await appelGoogle(
      "docs.documents.batchUpdate",
      () => d.docs.documents.batchUpdate({
        documentId, requestBody: { requests: [{ insertText: { location: { index: 1 }, text: texte } }] },
      }),
      { api: "docs", fichierId: documentId, jeton }
    );

    const { data: meta } = await appelGoogle(
      "drive.files.get",
      () => d.drive.files.get({ fileId: documentId, fields: "id,webViewLink,name", supportsAllDrives: true }),
      { api: "drive", fichierId: documentId, jeton }
    );

    if (ancienFicheId) {
      await nettoyerCopies(d, [ancienFicheId], jeton).catch(() => {
        // Best-effort : un échec d'archivage ne remet jamais en cause la
        // nouvelle fiche, déjà créée avec succès.
      });
    }

    return { id: meta.id, webViewLink: meta.webViewLink, nom: meta.name };
  } catch (e) {
    // Échec en cours de création : jamais de fiche orpheline présentée
    // comme réussie — même philosophie « tout ou rien » que les autres
    // générations de Vigie.
    if (documentId) await nettoyerCopies(d, [documentId], jeton).catch(() => {});
    throw e;
  }
}
