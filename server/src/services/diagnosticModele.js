// ─────────────────────────────────────────────────────────────
//  DOC-2 — DIAGNOSTIC D'UN MODÈLE : lit le fichier Drive RÉEL d'un modèle
//  (Google Doc ou Sheet) et l'analyse avec le catalogue canonique
//  (validationModeles.js). Lecture SEULE, aucune écriture Drive, aucune
//  écriture base — le diagnostic n'est JAMAIS persisté (il se périme dès
//  que quelqu'un modifie le fichier sur le Drive, en dehors de Vigie).
//
//  Confidentialité : la réponse ne contient jamais le texte intégral du
//  document — seulement les balises {{…}} trouvées (des jetons choisis
//  par l'auteur du modèle, pas du contenu libre), leurs catégories, les
//  erreurs/avertissements et des métadonnées techniques du fichier.
//
//  N'est PAS branché sur documents.js : la génération reste inchangée,
//  même pour un modèle invalide.
// ─────────────────────────────────────────────────────────────
import { texteDuDocument } from "./documents.js";
import { appelGoogle } from "./google.js";
import { MAX_COLONNES, MAX_LIGNES } from "./classeur.js";
import { analyserModele } from "./validationModeles.js";
import { marqueurHistorique } from "./catalogueVariables.js";

const MIME_DOC = "application/vnd.google-apps.document";
const MIME_SHEET = "application/vnd.google-apps.spreadsheet";
// Au-delà, l'analyse reste bornée : un classeur à 200 onglets ne doit pas
// déclencher 200 appels Sheets. L'analyse devient partielle, pas en erreur.
export const MAX_ONGLETS = 20;

function erreurDiagnostic(statut, code, message) {
  const e = new Error(message);
  e.statut = statut;
  e.code = code;
  return e;
}

// Texte d'un modèle Google Doc : réutilise exactement la lecture déjà
// faite par la génération (texteDuDocument), sans rien y modifier.
async function texteModeleDoc(clients, fileId, jeton) {
  const { data } = await appelGoogle(
    "docs.documents.get",
    () => clients.docs.documents.get({ documentId: fileId }),
    { api: "docs", fichierId: fileId, jeton }
  );
  return texteDuDocument(data);
}

// Texte d'un modèle Google Sheet : un appel de métadonnées (liste des
// onglets, bornes de grille), puis un values.get PAR ONGLET analysé —
// toutes les cellules peuvent porter des balises, pas seulement la
// première feuille. Bornée par MAX_ONGLETS, MAX_LIGNES et MAX_COLONNES.
async function texteModeleSheet(clients, fileId, jeton) {
  const { data: meta } = await appelGoogle(
    "sheets.spreadsheets.get",
    () => clients.sheets.spreadsheets.get({
      spreadsheetId: fileId, fields: "sheets(properties(title,index,gridProperties))",
    }),
    { api: "sheets", fichierId: fileId, jeton }
  );
  const feuilles = [...(meta.sheets || [])].sort((a, b) => (a.properties?.index ?? 0) - (b.properties?.index ?? 0));
  const total = feuilles.length;
  const analysees = feuilles.slice(0, MAX_ONGLETS);

  const morceaux = [];
  for (const f of analysees) {
    const titre = f.properties?.title || "";
    const gp = f.properties?.gridProperties || {};
    // Borne EN AMONT, comme pour le classeur de suivi (classeur.js) : on
    // refuse de lire un onglet démesuré AVANT d'appeler values.get.
    if ((gp.rowCount ?? 0) > MAX_LIGNES) {
      throw erreurDiagnostic(400, "classeur_trop_volumineux", `Onglet « ${titre} » trop volumineux : ${gp.rowCount} lignes (limite ${MAX_LIGNES}).`);
    }
    if ((gp.columnCount ?? 0) > MAX_COLONNES) {
      throw erreurDiagnostic(400, "classeur_trop_volumineux", `Onglet « ${titre} » trop volumineux : ${gp.columnCount} colonnes (limite ${MAX_COLONNES}).`);
    }
    const { data } = await appelGoogle(
      "sheets.spreadsheets.values.get",
      () => clients.sheets.spreadsheets.values.get({
        spreadsheetId: fileId, range: `'${titre.replace(/'/g, "''")}'`,
        valueRenderOption: "FORMATTED_VALUE", majorDimension: "ROWS",
      }),
      { api: "sheets", fichierId: fileId, onglet: titre, jeton }
    );
    const grille = (data.values || []).map((r) => r.map((c) => (c == null ? "" : String(c))));
    morceaux.push(grille.map((r) => r.join(" ")).join("\n"));
  }
  return { texte: morceaux.join("\n"), ongletsTotal: total, ongletsAnalyses: analysees.length };
}

// Construit la vue publique du diagnostic à partir du résultat PUR
// d'analyserModele(). N'ajoute jamais de texte du document, seulement des
// balises (tokens), des codes et des messages.
function construireDiagnostic(r, { typeFichier, onglets = null }) {
  const avertissements = [...r.avertissements];
  // Point 6 : un modèle sans balise n'est pas invalide — un document
  // statique peut être volontaire — mais ce n'est pas silencieux non plus.
  if (r.balises.length === 0) {
    avertissements.push({ code: "AUCUNE_BALISE", message: "Aucune balise documentaire détectée dans ce modèle.", balise: null, position: null });
  }
  if (onglets && onglets.analysees < onglets.total) {
    avertissements.push({
      code: "ANALYSE_PARTIELLE",
      message: `Analyse partielle : seuls les ${onglets.analysees} premiers onglets sur ${onglets.total} ont été analysés (limite ${MAX_ONGLETS}).`,
      balise: null, position: null,
    });
  }
  const erreurs = r.erreurs;
  const etat = erreurs.length ? "invalide" : avertissements.length ? "valide_avec_avertissements" : "valide";

  // Occurrences = chaque {{…}} trouvé (une ouverture et une fermeture de
  // bloc comptent chacune) ; uniques = noms distincts. Les blocs restent,
  // eux, listés une seule fois dans resume.blocs (déjà dédoublonné).
  const nomsUniques = new Set(r.balises.filter((b) => b.nom).map((b) => b.nom));

  const suggestions = [];
  for (const a of r.resume.alias) {
    suggestions.push({ balise: `{{${a.alias}}}`, type: "alias", cible_conseillee: `{{${a.canonique}}}`, cibles_alternatives: [] });
  }
  for (const nom of r.resume.historiques) {
    const h = marqueurHistorique(nom);
    const [cible, ...reste] = h?.cibles_possibles || [];
    suggestions.push({
      balise: `{{${nom}}}`, type: "historique",
      cible_conseillee: cible ? `{{${cible}}}` : null,
      cibles_alternatives: reste.map((c) => `{{${c}}}`),
    });
  }

  return {
    etat,
    version_dictionnaire: r.version,
    type_fichier: typeFichier,
    nombre_occurrences_balises: r.balises.length,
    nombre_balises_uniques: nomsUniques.size,
    canoniques: r.resume.canoniques,
    alias: r.resume.alias,
    historiques: r.resume.historiques,
    blocs: r.resume.blocs,
    champs_bloc: r.resume.champs_bloc,
    inconnues: r.resume.inconnues,
    erreurs, avertissements, suggestions,
    ...(onglets ? { onglets_total: onglets.total, onglets_analyses: onglets.analysees } : {}),
  };
}

// Diagnostic complet d'un modèle : détecte le type RÉEL du fichier Drive
// (jamais modele.drive_mime, qui peut être absent ou périmé), lit son
// contenu selon ce type, puis analyse les balises.
// `clients` : { drive, docs, sheets } — même forme que getDrive().
export async function analyserModeleDrive(modele, clients, jeton = null) {
  // DOC-3C : `trashed` est lu ICI, dans la MÊME requête que le mimeType —
  // c'est la fusion validée avec l'ancien verifierModeleDrive() de
  // documents.js, qui faisait un second drive.files.get redondant. Un seul
  // appel « fichier » pour tout le diagnostic, qu'il serve à l'écran des
  // modèles (DOC-2) ou au précontrôle de génération (DOC-3C).
  const { data: fichier } = await appelGoogle(
    "drive.files.get",
    () => clients.drive.files.get({ fileId: modele.drive_file_id, fields: "id,mimeType,trashed", supportsAllDrives: true }),
    { api: "drive", modele: modele.nom, jeton }
  );
  const mime = fichier.mimeType;
  const trashed = fichier.trashed === true;

  if (mime === MIME_DOC) {
    const texte = await texteModeleDoc(clients, modele.drive_file_id, jeton);
    return { ...construireDiagnostic(analyserModele(texte), { typeFichier: "document" }), trashed };
  }
  if (mime === MIME_SHEET) {
    const { texte, ongletsTotal, ongletsAnalyses } = await texteModeleSheet(clients, modele.drive_file_id, jeton);
    return { ...construireDiagnostic(analyserModele(texte), { typeFichier: "feuille_calcul", onglets: { total: ongletsTotal, analysees: ongletsAnalyses } }), trashed };
  }
  throw erreurDiagnostic(400, "format_non_supporte", "Format de fichier non pris en charge pour l'analyse : seuls les Google Docs et les Google Sheets sont analysés.");
}
