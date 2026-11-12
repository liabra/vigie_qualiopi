// Service central des documents partagés (spec §2 à §7).
//
// Toute écriture de documents, de versions, de liens preuve ↔ document et de
// statut de preuve passe par ce module. Chaque opération reçoit un client
// (cx) déjà ouvert dans une transaction : utiliser `transaction(fn)`.
//
// Ordre des verrous (déterministe, sans cycle) :
//   1. verrou consultatif global du graphe (pg_advisory_xact_lock) ;
//   2. documents, par id croissant ;
//   3. preuves, par id croissant ;
//   4. preuve_documents, document_versions, preuve_fichiers (écritures).
// Toute écriture du graphe prend le verrou 1 avant de lire le graphe ; il est
// donc figé pendant la transaction et les lectures sont stables.
// Les appels Drive précèdent tout verrou (aucun verrou n'est tenu pendant le réseau).
//
// Créations de preuves hors de ce service, volontairement exemptées de
// changerStatut : elles insèrent une preuve neuve, avec statut_avant_remplacement
// à NULL, et leur ON CONFLICT ne modifie jamais le statut :
//   - api.js : POST /preuves (INSERT INTO preuves)
//   - import.js : premier import d'une preuve du classeur
//   - documents.js : preuvePourModele (génération)

import { getPool } from "../db.js";

const STATUTS = ["maitrise", "a_consolider", "a_risque", "non_applicable"];
const SOURCE_DOCUMENT = { manuel: "manuel", import: "import_drive", generation: "generation" };
const SOURCE_LEGACY = { manuel: "manuel", import: "import_drive", generation: "generation" };
const LIMITE_MOTIF = 500;
const VERROU_GRAPHE = 7406001;
export const PROFONDEUR_MAX = 10;

export class ErreurDocument extends Error {
  constructor(statut, code, message, details = null) {
    super(message);
    this.name = "ErreurDocument";
    this.statut = statut;
    this.code = code;
    this.details = details;
  }
}

export async function transaction(fn) {
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const resultat = await fn(cx);
    await cx.query("COMMIT");
    return resultat;
  } catch (e) {
    await cx.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    cx.release();
  }
}

// ── Contrôles Drive (D-R, D-P) ───────────────────────────────

// Racine Vigie : identifiant configuré ; sinon dossier unique de ce nom à la racine du Drive.
export async function resoudreRacine(drive, { driveRacineId = "", driveRacine }) {
  if (driveRacineId) return driveRacineId;
  const nom = String(driveRacine).replace(/'/g, "\\'");
  const { data } = await drive.files.list({
    q: `name = '${nom}' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false`,
    fields: "files(id)", pageSize: 2, supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  if (!data.files || data.files.length !== 1) {
    throw new ErreurDocument(500, "racine_introuvable", "Dossier racine Vigie introuvable ou ambigu.");
  }
  return data.files[0].id;
}

// Contrôle D-R (sous la racine, profondeur ≤ 10), corbeille, propriétaire, D-P (permissions).
// `emailsAutorises` : compte Vigie et administrateurs. Les détails d'erreur ne contiennent
// jamais d'adresse e-mail.
export async function controleDriveFichier(drive, fileId, { racineId, compteVigie, emailsAutorises }) {
  const id = String(fileId);
  const { data: f } = await drive.files.get({ fileId: id, fields: "id,parents,trashed,owners(emailAddress)", supportsAllDrives: true });
  if (f.trashed) throw new ErreurDocument(409, "fichier_corbeille", "Ce fichier est à la corbeille Drive.");

  const proprietaires = (f.owners || []).map((o) => String(o.emailAddress || "").toLowerCase());
  if (!proprietaires.length || proprietaires.some((e) => e !== String(compteVigie).toLowerCase())) {
    throw new ErreurDocument(409, "proprietaire_non_conforme", "Le fichier doit appartenir au compte Vigie.");
  }

  await verifierSousRacine(drive, f.parents || [], racineId);
  await verifierPermissions(drive, id, emailsAutorises);
  return { ok: true };
}

async function verifierSousRacine(drive, parentsInitiaux, racineId) {
  let niveau = [...parentsInitiaux];
  const vus = new Set();
  for (let distance = 1; distance <= PROFONDEUR_MAX && niveau.length; distance++) {
    if (niveau.includes(racineId)) return;
    const suivants = [];
    for (const pid of niveau) {
      if (vus.has(pid)) continue;
      vus.add(pid);
      const { data } = await drive.files.get({ fileId: pid, fields: "id,parents", supportsAllDrives: true });
      suivants.push(...(data.parents || []));
    }
    niveau = suivants;
  }
  throw new ErreurDocument(409, "fichier_hors_racine",
    "Ce fichier n'est pas dans le dossier Vigie (ou trop profondément imbriqué).");
}

async function verifierPermissions(drive, fileId, emailsAutorises) {
  const permissions = [];
  let pageToken;
  do {
    const { data } = await drive.permissions.list({
      fileId, fields: "nextPageToken,permissions(id,type,role,emailAddress)", supportsAllDrives: true, pageToken,
    });
    permissions.push(...(data.permissions || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  const refus = permissions.filter((p) => !(
    p.type === "user" && p.emailAddress && emailsAutorises.has(String(p.emailAddress).toLowerCase())
  ));
  if (refus.length) {
    throw new ErreurDocument(409, "permissions_non_conformes",
      "Ce fichier est partagé avec des personnes ou des groupes non autorisés.",
      { principaux: refus.map((p) => ({ type: p.type, role: p.role })) });
  }
}

// Les créations de documents manuels ou importés exigent un contrôle Drive.
function exigeControle(source) {
  return source === "manuel" || source === "import_drive";
}

async function appelerControle(controle, fileId, source) {
  if (exigeControle(source) && typeof controle !== "function") {
    throw new Error(`Contrôle Drive requis pour une création de source « ${source} ».`);
  }
  if (typeof controle === "function") await controle(fileId);
}

// ── Verrous ─────────────────────────────────────────────────

export async function verrouillerGraphe(cx) {
  await cx.query("SELECT pg_advisory_xact_lock($1)", [VERROU_GRAPHE]);
}

async function verrouillerDocuments(cx, documentIds, mode = "SHARE") {
  const uniques = [...new Set(documentIds)].sort((a, b) => a - b);
  if (uniques.length) {
    await cx.query(`SELECT id FROM documents WHERE id = ANY($1::int[]) ORDER BY id FOR ${mode}`, [uniques]);
  }
}

// Graphe d'un document : lu après le verrou global, donc stable.
async function verrouillerGrapheDe(cx, documentId) {
  await verrouillerGraphe(cx);
  const { rows: preuves } = await cx.query(
    "SELECT preuve_id FROM preuve_documents WHERE document_id = $1 ORDER BY preuve_id", [documentId]
  );
  const preuveIds = preuves.map((r) => r.preuve_id);
  let documentIds = [documentId];
  if (preuveIds.length) {
    const { rows } = await cx.query(
      "SELECT DISTINCT document_id FROM preuve_documents WHERE preuve_id = ANY($1::int[])", [preuveIds]
    );
    documentIds = [documentId, ...rows.map((r) => r.document_id)];
  }
  await verrouillerDocuments(cx, documentIds, "UPDATE");
  if (preuveIds.length) {
    await cx.query("SELECT id FROM preuves WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE", [preuveIds]);
  }
  return preuveIds;
}

async function documentsDePreuve(cx, preuveId) {
  const { rows } = await cx.query("SELECT document_id FROM preuve_documents WHERE preuve_id = $1", [preuveId]);
  return rows.map((r) => r.document_id);
}

async function documentCourant(cx, documentId) {
  const { rows: [d] } = await cx.query("SELECT * FROM documents WHERE id = $1", [documentId]);
  if (!d) throw new ErreurDocument(404, "document_introuvable", "Document introuvable.");
  return d;
}

async function verrouillerPreuve(cx, preuveId) {
  const { rows: [p] } = await cx.query(
    "SELECT id, statut, statut_avant_remplacement FROM preuves WHERE id = $1 FOR UPDATE",
    [preuveId]
  );
  if (!p) throw new ErreurDocument(404, "preuve_introuvable", "Preuve introuvable.");
  return p;
}

async function revalidationsEnAttente(cx, preuveId) {
  const { rows } = await cx.query(
    `SELECT pd.document_id, pd.version_validee, d.version_courante
       FROM preuve_documents pd JOIN documents d ON d.id = pd.document_id
      WHERE pd.preuve_id = $1 AND pd.version_validee < d.version_courante
      ORDER BY pd.document_id`,
    [preuveId]
  );
  return rows;
}

// Point d'écriture unique du statut (spec §3).
export async function changerStatut(cx, preuveId, evenement, { statut, statutImport } = {}) {
  await verrouillerGraphe(cx);
  await verrouillerDocuments(cx, await documentsDePreuve(cx, preuveId), "SHARE");
  const p = await verrouillerPreuve(cx, preuveId);
  const attente = await revalidationsEnAttente(cx, preuveId);

  const ecrire = async (nouveau, avant) => {
    if (nouveau !== p.statut || avant !== p.statut_avant_remplacement) {
      await cx.query("UPDATE preuves SET statut = $2, statut_avant_remplacement = $3 WHERE id = $1", [preuveId, nouveau, avant]);
    }
    return { statut: nouveau, statut_avant_remplacement: avant, en_attente: attente.map((a) => a.document_id) };
  };
  const inchange = () => ecrire(p.statut, p.statut_avant_remplacement);

  const exigerStatut = (valeur) => {
    if (!STATUTS.includes(valeur)) throw new ErreurDocument(400, "statut_inconnu", "Statut inconnu.");
  };
  const statutAdmin = (valeur) => {
    exigerStatut(valeur);
    if (valeur === "maitrise" && attente.length) {
      throw new ErreurDocument(409, "revalidations_en_attente",
        "Des documents liés doivent être revalidés avant de passer la preuve à maîtrisé.",
        { documents: attente.map((a) => a.document_id) });
    }
    // Présence du champ statut = décision explicite : efface la restauration (R6).
    return ecrire(valeur, null);
  };
  const restaurer = () => {
    if (attente.length === 0 && p.statut === "a_consolider" && p.statut_avant_remplacement === "maitrise") {
      return ecrire("maitrise", null);
    }
    return inchange();
  };

  switch (evenement) {
    case "admin_statut":
    case "bulk_admin":
      return statutAdmin(statut);
    case "admin_confirmer":
      return p.statut === "a_risque" ? statutAdmin("maitrise") : inchange();
    case "remplacement":
      return p.statut === "maitrise" ? ecrire("a_consolider", "maitrise") : inchange();
    case "revalidation":
    case "detachement":
      return restaurer();
    case "import":
      if (attente.length) return inchange();
      if (statutImport === undefined) return restaurer();
      exigerStatut(statutImport);
      return ecrire(statutImport, null);
    default:
      throw new Error(`Événement de statut inconnu : ${evenement}`);
  }
}

// ── Visibilité (spec §3, règle C2) ──────────────────────────

// Prédicat SQL « document visible par un contributeur » (alias de la table documents).
export function predicatVisibleContributeur(alias = "d") {
  return `${alias}.confidentiel = false
    AND ${alias}.archive_le IS NULL
    AND EXISTS (SELECT 1 FROM preuve_documents pd_v WHERE pd_v.document_id = ${alias}.id)
    AND NOT EXISTS (SELECT 1 FROM preuve_documents pd_c
                    JOIN preuves_confidentielles pc ON pc.preuve_id = pd_c.preuve_id
                    WHERE pd_c.document_id = ${alias}.id)`;
}

// Documents liés à une preuve, pour l'écran Preuves : lecture seule, filtrée par rôle
// (un contributeur ne reçoit que les documents visibles, jamais un document confidentiel).
export function clauseDocumentsDePreuve(admin, alias = "p") {
  return `COALESCE(
              (SELECT json_agg(json_build_object(
                        'id', d.id, 'drive_file_id', d.drive_file_id, 'nom', d.drive_nom, 'url', d.drive_url,
                        'version_courante', d.version_courante, 'archive_le', d.archive_le,
                        'origine', pd.origine, 'a_revalider', pd.version_validee < d.version_courante)
                      ORDER BY d.id)
               FROM preuve_documents pd JOIN documents d ON d.id = pd.document_id
              WHERE pd.preuve_id = ${alias}.id${admin ? "" : ` AND ${predicatVisibleContributeur("d")}`}),
              '[]'::json) AS documents`;
}

// Filtre à appliquer à une sous-requête de fichiers legacy (alias f) :
// vide pour un administrateur, sinon le fichier doit appartenir à un document visible.
export function clauseFichiersVisibles(admin, alias = "f") {
  if (admin) return "";
  return ` AND EXISTS (SELECT 1 FROM documents dv WHERE dv.drive_file_id = ${alias}.drive_file_id AND ${predicatVisibleContributeur("dv")})`;
}

// Filtre pour les documents générés (documents_generes, alias g) : sans document lié, rien pour un contributeur.
export function clauseDocumentsGeneresVisibles(admin, alias = "g") {
  if (admin) return "";
  return ` AND EXISTS (SELECT 1 FROM documents dg WHERE dg.id = ${alias}.document_id AND ${predicatVisibleContributeur("dg")})`;
}

// ── Documents ───────────────────────────────────────────────

function fichierNormalise(fichier) {
  const id = String(fichier?.drive_file_id ?? "").trim();
  if (!id) throw new ErreurDocument(400, "fichier_invalide", "Identifiant de fichier Drive obligatoire.");
  return {
    drive_file_id: id,
    drive_url: fichier.drive_url || null,
    drive_nom: fichier.drive_nom || null,
    drive_mime: fichier.drive_mime || null,
  };
}

function erreurIdentifie(documentId) {
  return new ErreurDocument(409, "fichier_deja_identifie",
    "Ce fichier Drive est déjà un document Vigie. Rattachez le document existant au lieu d'en créer un autre.",
    { document_id: documentId });
}

// Insertion sous verrou global. Les insertions utilisent ON CONFLICT DO NOTHING :
// un conflit n'est JAMAIS une réussite silencieuse, il est transformé en 409.
async function insererDocument(cx, f, source, utilisateurId) {
  await verrouillerGraphe(cx);
  await verifierReservation(cx, f.drive_file_id);
  const { rows: [existant] } = await cx.query(
    "SELECT document_id FROM document_versions WHERE drive_file_id = $1", [f.drive_file_id]
  );
  if (existant) throw erreurIdentifie(existant.document_id);

  const { rows: [doc] } = await cx.query(
    `INSERT INTO documents (drive_file_id, drive_url, drive_nom, drive_mime, source, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (drive_file_id) DO NOTHING
     RETURNING id`,
    [f.drive_file_id, f.drive_url, f.drive_nom, f.drive_mime, source, utilisateurId]
  );
  if (!doc) {
    const { rows: [d] } = await cx.query("SELECT id FROM documents WHERE drive_file_id = $1", [f.drive_file_id]);
    throw erreurIdentifie(d?.id ?? null);
  }

  const { rows: [version] } = await cx.query(
    `INSERT INTO document_versions (document_id, numero, drive_file_id, drive_url, drive_nom, drive_mime, introduite_par)
     VALUES ($1, 1, $2, $3, $4, $5, $6)
     ON CONFLICT (drive_file_id) DO NOTHING
     RETURNING id`,
    [doc.id, f.drive_file_id, f.drive_url, f.drive_nom, f.drive_mime, utilisateurId]
  );
  if (!version) throw erreurIdentifie(doc.id);
  return { documentId: doc.id };
}

// Crée un document et sa version 1. Contrôle Drive AVANT tout verrou (manuel et import).
export async function creerDocument(cx, { fichier, source = "manuel", utilisateurId = null, controle = null }) {
  const f = fichierNormalise(fichier);
  await appelerControle(controle, f.drive_file_id, source);
  return insererDocument(cx, f, source, utilisateurId);
}

// Rattache un document à une preuve. Soit `documentId` (document existant, sans
// contrôle Drive), soit `fichier` (création préalable, avec contrôle).
// Sans effet sur le statut. Un lien déjà existant est un no-op : deja_rattache: true.
export async function attacherDocument(cx, { preuveId, documentId = null, fichier = null, origine = "manuel", stagiaireId = null, utilisateurId = null, controle = null }) {
  if (!SOURCE_LEGACY[origine]) throw new ErreurDocument(400, "origine_inconnue", "Origine de rattachement inconnue.");
  let docId = documentId;
  if (!docId) {
    if (!fichier) throw new ErreurDocument(400, "fichier_manquant", "Document ou fichier à rattacher obligatoire.");
    ({ documentId: docId } = await creerDocument(cx, { fichier, source: SOURCE_DOCUMENT[origine], utilisateurId, controle }));
  }
  await verrouillerGraphe(cx);
  await verrouillerDocuments(cx, [...await documentsDePreuve(cx, preuveId), docId], "SHARE");
  const d = await documentCourant(cx, docId);
  if (d.archive_le) throw new ErreurDocument(409, "document_archive", "Document archivé : restaurez-le avant de le rattacher.");
  await verrouillerPreuve(cx, preuveId);

  const { rowCount } = await cx.query(
    `INSERT INTO preuve_documents (preuve_id, document_id, origine, stagiaire_id, version_validee, ajoute_par)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (preuve_id, document_id) DO NOTHING`,
    [preuveId, docId, origine, stagiaireId, d.version_courante, utilisateurId]
  );
  if (rowCount === 0) return { documentId: docId, deja_rattache: true };

  await cx.query(
    `INSERT INTO preuve_fichiers (preuve_id, drive_file_id, drive_url, drive_nom, drive_mime, source, stagiaire_id, ajoute_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (preuve_id, drive_file_id) DO NOTHING`,
    [preuveId, d.drive_file_id, d.drive_url, d.drive_nom, d.drive_mime, SOURCE_LEGACY[origine], stagiaireId, utilisateurId]
  );
  return { documentId: docId, deja_rattache: false };
}

// Rattache un fichier à une preuve sans jamais créer une seconde identité :
//  - fichier déjà courant d'un document → rattachement de CE document (aucun contrôle Drive) ;
//  - fichier ancienne version d'un document → 409 fichier_deja_identifie ;
//  - fichier inconnu → création du document (contrôle Drive) puis rattachement.
export async function rattacherFichier(cx, { preuveId, fichier, origine = "manuel", stagiaireId = null, utilisateurId = null, controle = null }) {
  const f = fichierNormalise(fichier);
  await verrouillerGraphe(cx);
  await verifierReservation(cx, f.drive_file_id);
  const { rows: [v] } = await cx.query(
    "SELECT document_id, remplacee_le FROM document_versions WHERE drive_file_id = $1", [f.drive_file_id]
  );
  if (v && v.remplacee_le !== null) throw erreurIdentifie(v.document_id);
  if (v) {
    return attacherDocument(cx, { preuveId, documentId: v.document_id, origine, stagiaireId, utilisateurId });
  }
  return attacherDocument(cx, { preuveId, fichier: f, origine, stagiaireId, utilisateurId, controle });
}

// Supprime le lien seulement : ni le document, ni ses versions, ni Drive.
export async function detacherDocument(cx, { preuveId, documentId }) {
  await verrouillerGraphe(cx);
  await verrouillerDocuments(cx, [...await documentsDePreuve(cx, preuveId), documentId], "SHARE");
  const d = await documentCourant(cx, documentId);
  await verrouillerPreuve(cx, preuveId);

  const { rowCount } = await cx.query(
    "DELETE FROM preuve_documents WHERE preuve_id = $1 AND document_id = $2",
    [preuveId, documentId]
  );
  if (rowCount === 0) throw new ErreurDocument(404, "lien_introuvable", "Ce document n'est pas rattaché à cette preuve.");

  await cx.query("DELETE FROM preuve_fichiers WHERE preuve_id = $1 AND drive_file_id = $2", [preuveId, d.drive_file_id]);
  return changerStatut(cx, preuveId, "detachement");
}

// Remplacement versionné (R4, R6). Le fichier Drive précédent n'est jamais touché.
// Contrôle Drive du NOUVEAU fichier avant tout verrou.
export async function remplacerDocument(cx, { documentId, fichier, versionAttendue, motif = null, utilisateurId = null, controle = null, origine = "manuel" }) {
  const f = fichierNormalise(fichier);
  if (motif !== null && String(motif).length > LIMITE_MOTIF) {
    throw new ErreurDocument(400, "motif_trop_long", `Motif : ${LIMITE_MOTIF} caractères maximum.`);
  }
  if (origine === "manuel") await appelerControle(controle, f.drive_file_id, "manuel");

  const preuveIds = await verrouillerGrapheDe(cx, documentId);
  const d = await documentCourant(cx, documentId);
  if (d.archive_le) throw new ErreurDocument(409, "document_archive", "Document archivé : restaurez-le avant de le remplacer.");
  if (Number(versionAttendue) !== d.version_courante) {
    throw new ErreurDocument(409, "version_obsolete", "Le document a été remplacé entre-temps. Rechargez-le.",
      { version_courante: d.version_courante });
  }

  await verifierReservation(cx, f.drive_file_id);
  const { rows: [existant] } = await cx.query(
    "SELECT document_id, remplacee_le FROM document_versions WHERE drive_file_id = $1", [f.drive_file_id]
  );
  if (existant) {
    if (existant.document_id === documentId && existant.remplacee_le === null) {
      throw new ErreurDocument(409, "version_deja_courante", "Ce fichier est déjà la version courante du document.");
    }
    throw new ErreurDocument(409, "fichier_deja_identifie",
      "Ce fichier Drive est déjà un document Vigie. Aucune fusion n'est faite.",
      { document_id: existant.document_id });
  }

  const cloture = await cx.query(
    `UPDATE document_versions SET remplacee_le = now(), remplacee_par = $2, motif = $3
      WHERE document_id = $1 AND remplacee_le IS NULL`,
    [documentId, utilisateurId, motif]
  );
  if (cloture.rowCount !== 1) throw new Error(`Intégrité : ${cloture.rowCount} version(s) courante(s) pour le document ${documentId}`);

  const nouvelle = d.version_courante + 1;
  const { rows: [version] } = await cx.query(
    `INSERT INTO document_versions (document_id, numero, drive_file_id, drive_url, drive_nom, drive_mime, introduite_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (drive_file_id) DO NOTHING
     RETURNING id`,
    [documentId, nouvelle, f.drive_file_id, f.drive_url, f.drive_nom, f.drive_mime, utilisateurId]
  );
  if (!version) throw new ErreurDocument(409, "fichier_deja_identifie", "Ce fichier Drive est déjà identifié.");

  await cx.query(
    `UPDATE documents SET drive_file_id = $2, drive_url = $3, drive_nom = $4, drive_mime = $5, version_courante = $6
      WHERE id = $1`,
    [documentId, f.drive_file_id, f.drive_url, f.drive_nom, f.drive_mime, nouvelle]
  );

  if (preuveIds.length) {
    const miroir = await cx.query(
      `UPDATE preuve_fichiers SET drive_file_id = $2, drive_url = $3, drive_nom = $4, drive_mime = $5
        WHERE drive_file_id = $1 AND preuve_id = ANY($6::int[])`,
      [d.drive_file_id, f.drive_file_id, f.drive_url, f.drive_nom, f.drive_mime, preuveIds]
    );
    if (miroir.rowCount !== preuveIds.length) {
      throw new ErreurDocument(500, "miroir_incoherent",
        `Miroir legacy incohérent : ${miroir.rowCount} ligne(s) mise(s) à jour sur ${preuveIds.length} preuve(s).`);
    }
  }

  for (const preuveId of preuveIds) {
    await changerStatut(cx, preuveId, "remplacement");
  }
  return { version: nouvelle, preuves_a_revalider: preuveIds };
}

// Détache tous les documents d'une preuve (jamais de suppression de document).
export async function detacherTousLesDocuments(cx, preuveId) {
  let etat = null;
  for (const documentId of await documentsDePreuve(cx, preuveId)) {
    etat = await detacherDocument(cx, { preuveId, documentId });
  }
  return etat;
}

// Revalide un lien : la preuve a examiné la version courante du document.
// Idempotent : une seconde revalidation ne change rien.
export async function revaliderLien(cx, { preuveId, documentId, utilisateurId = null }) {
  await verrouillerGraphe(cx);
  await verrouillerDocuments(cx, [...await documentsDePreuve(cx, preuveId), documentId], "SHARE");
  await verrouillerPreuve(cx, preuveId);
  const { rowCount: existe } = await cx.query(
    "SELECT 1 FROM preuve_documents WHERE preuve_id = $1 AND document_id = $2", [preuveId, documentId]
  );
  if (existe === 0) throw new ErreurDocument(404, "lien_introuvable", "Ce document n'est pas rattaché à cette preuve.");
  const { rowCount } = await cx.query(
    `UPDATE preuve_documents pd SET version_validee = d.version_courante, revalide_le = now(), revalide_par = $3
       FROM documents d
      WHERE d.id = pd.document_id AND pd.preuve_id = $1 AND pd.document_id = $2
        AND pd.version_validee < d.version_courante`,
    [preuveId, documentId, utilisateurId]
  );
  const etat = await changerStatut(cx, preuveId, "revalidation");
  return { revalide: rowCount === 1, ...etat };
}

// Réimport d'une preuve issue du classeur. Contrôle Drive des seuls fichiers
// NOUVEAUX, faits AVANT tout verrou. Détache seulement les liens d'origine
// « import » absents de la liste ; ne supprime aucun document. Un fichier déjà
// identifié comme version d'un autre document est signalé, jamais réaffecté.
export async function synchroniserImport(cx, { preuveId, fichiers, statutImport = undefined, utilisateurId = null, controle = null }) {
  const aControler = [];
  for (const brut of fichiers) {
    const f = fichierNormalise(brut);
    const { rows: [v] } = await cx.query(
      "SELECT document_id, remplacee_le FROM document_versions WHERE drive_file_id = $1", [f.drive_file_id]
    );
    if (!v) aControler.push(f);
  }
  for (const f of aControler) await appelerControle(controle, f.drive_file_id, "import_drive");

  await verrouillerGraphe(cx);
  const conflits = [];
  const resolus = [];
  for (const brut of fichiers) {
    const f = fichierNormalise(brut);
    const { rows: [v] } = await cx.query(
      "SELECT document_id, remplacee_le FROM document_versions WHERE drive_file_id = $1", [f.drive_file_id]
    );
    if (v && v.remplacee_le === null) {
      resolus.push(v.document_id);
    } else if (v) {
      conflits.push({ drive_file_id: f.drive_file_id, document_id: v.document_id });
    } else {
      const { documentId } = await insererDocument(cx, f, "import_drive", utilisateurId);
      resolus.push(documentId);
    }
  }

  await verrouillerDocuments(cx, [...await documentsDePreuve(cx, preuveId), ...resolus], "SHARE");
  await verrouillerPreuve(cx, preuveId);

  const { rows: anciens } = await cx.query(
    `SELECT pd.document_id, d.drive_file_id FROM preuve_documents pd JOIN documents d ON d.id = pd.document_id
      WHERE pd.preuve_id = $1 AND pd.origine = 'import'`,
    [preuveId]
  );
  const detaches = [];
  // Un document en conflit d'identité garde son lien : le détacher restaurerait la maîtrise
  // sans revalidation (R6). Le conflit est seulement signalé.
  const gardes = new Set([...resolus, ...conflits.map((c) => c.document_id)]);
  for (const a of anciens) {
    if (gardes.has(a.document_id)) continue;
    await cx.query("DELETE FROM preuve_documents WHERE preuve_id = $1 AND document_id = $2", [preuveId, a.document_id]);
    await cx.query(
      "DELETE FROM preuve_fichiers WHERE preuve_id = $1 AND drive_file_id = $2 AND source = 'import_drive'",
      [preuveId, a.drive_file_id]
    );
    detaches.push(a.document_id);
  }

  const ajoutes = [];
  for (const documentId of new Set(resolus)) {
    const d = await documentCourant(cx, documentId);
    const { rowCount } = await cx.query(
      `INSERT INTO preuve_documents (preuve_id, document_id, origine, version_validee, ajoute_par)
       VALUES ($1, $2, 'import', $3, $4) ON CONFLICT (preuve_id, document_id) DO NOTHING`,
      [preuveId, documentId, d.version_courante, utilisateurId]
    );
    if (rowCount) {
      await cx.query(
        `INSERT INTO preuve_fichiers (preuve_id, drive_file_id, drive_url, drive_nom, drive_mime, source, ajoute_par)
         VALUES ($1, $2, $3, $4, $5, 'import_drive', $6) ON CONFLICT (preuve_id, drive_file_id) DO NOTHING`,
        [preuveId, d.drive_file_id, d.drive_url, d.drive_nom, d.drive_mime, utilisateurId]
      );
      ajoutes.push(documentId);
    }
  }

  const etat = await changerStatut(cx, preuveId, "import", { statutImport });
  return { ajoutes, detaches, conflits, ...etat };
}

// ── Cycle de vie : archivage, restauration (R9) ─────────────

export async function archiverDocument(cx, { documentId }) {
  await verrouillerGraphe(cx);
  await verrouillerDocuments(cx, [documentId], "UPDATE");
  const d = await documentCourant(cx, documentId);
  if (d.archive_le) throw new ErreurDocument(409, "document_deja_archive", "Ce document est déjà archivé.");
  const { rows: liens } = await cx.query(
    "SELECT preuve_id FROM preuve_documents WHERE document_id = $1 ORDER BY preuve_id", [documentId]
  );
  if (liens.length) {
    throw new ErreurDocument(409, "liens_actifs",
      "Ce document est encore rattaché à des preuves. Détachez-le d'abord.",
      { preuves: liens.map((l) => l.preuve_id) });
  }
  await cx.query("UPDATE documents SET archive_le = now() WHERE id = $1", [documentId]);
  return { archive: true };
}

export async function restaurerDocument(cx, { documentId }) {
  await verrouillerGraphe(cx);
  await verrouillerDocuments(cx, [documentId], "UPDATE");
  const d = await documentCourant(cx, documentId);
  if (!d.archive_le) throw new ErreurDocument(409, "document_non_archive", "Ce document n'est pas archivé.");
  await cx.query("UPDATE documents SET archive_le = NULL WHERE id = $1", [documentId]);
  return { archive: false };
}

// ── Mise à la corbeille explicite d'une ancienne version (R5) ─

// Vérifications communes à la mise à la corbeille (lecture sous verrou, aucune écriture).
export async function verifierCorbeille(cx, { documentId, numero }) {
  await verrouillerGraphe(cx);
  await verrouillerDocuments(cx, [documentId], "UPDATE");
  const d = await documentCourant(cx, documentId);
  if (Number(numero) === d.version_courante) {
    throw new ErreurDocument(409, "version_courante", "La version courante ne peut pas être mise à la corbeille.");
  }
  const { rows: [v] } = await cx.query(
    "SELECT id, drive_file_id, remplacee_le, corbeille_le FROM document_versions WHERE document_id = $1 AND numero = $2",
    [documentId, numero]
  );
  if (!v) throw new ErreurDocument(404, "version_introuvable", "Version introuvable.");
  if (v.corbeille_le) throw new ErreurDocument(409, "deja_a_la_corbeille", "Cette version est déjà à la corbeille.");
  await verifierFichierLibre(cx, v.drive_file_id);
  return { driveFileId: v.drive_file_id, versionId: v.id };
}

// Une version dont la mise à la corbeille n'est pas terminée (en attente ou bloquée) est réservée :
// aucun écrivain ne peut la référencer. Levée uniquement à la confirmation ou à l'abandon.
export async function verifierReservation(cx, driveFileId) {
  const { rows: [r] } = await cx.query(
    "SELECT id FROM corbeille_operations WHERE drive_file_id = $1 AND statut IN ('en_attente', 'bloquee')", [driveFileId]
  );
  if (r) throw new ErreurDocument(409, "version_reservee_corbeille",
    "Cette version est en cours de mise à la corbeille : elle ne peut plus être utilisée.");
}

// Phase 1 (transaction) : vérifie puis ouvre l'opération au journal, avec bail pour le demandeur.
// Aucune écriture Drive ici.
export async function preparerCorbeille(cx, { documentId, numero, utilisateurId = null, jeton, bailSecondes }) {
  const { driveFileId } = await verifierCorbeille(cx, { documentId, numero });
  const { rows: [op] } = await cx.query(
    `INSERT INTO corbeille_operations (document_id, numero, drive_file_id, statut, cree_par, bail_jusqu_au, bail_jeton)
     VALUES ($1, $2, $3, 'en_attente', $4, now() + make_interval(secs => $5), $6)
     ON CONFLICT (document_id, numero) WHERE statut IN ('en_attente', 'bloquee') DO NOTHING
     RETURNING id`,
    [documentId, numero, driveFileId, utilisateurId, bailSecondes, jeton]
  );
  if (!op) {
    const { rows: [existante] } = await cx.query(
      "SELECT statut FROM corbeille_operations WHERE document_id = $1 AND numero = $2 AND statut IN ('en_attente', 'bloquee')",
      [documentId, numero]
    );
    if (existante?.statut === "bloquee") {
      throw new ErreurDocument(409, "corbeille_bloquee", "Une mise à la corbeille de cette version est bloquée : une décision administrateur est requise.");
    }
    throw new ErreurDocument(409, "corbeille_en_attente", "Une mise à la corbeille de cette version est déjà en cours.");
  }
  return { driveFileId, operationId: op.id };
}

// Un fichier encore utilisé (preuve ou copie de génération) ne peut pas être mis à la corbeille.
async function verifierFichierLibre(cx, driveFileId) {
  const { rows: [u] } = await cx.query(
    `SELECT (SELECT count(*)::int FROM preuve_fichiers WHERE drive_file_id = $1) AS preuves,
            (SELECT count(*)::int FROM documents_generes WHERE drive_file_id = $1) AS generes,
            (SELECT count(*)::int FROM documents WHERE drive_file_id = $1) AS courants`,
    [driveFileId]
  );
  if (u.preuves || u.generes || u.courants) {
    throw new ErreurDocument(409, "fichier_encore_utilise", "Ce fichier est encore utilisé : il ne peut pas être mis à la corbeille.");
  }
}

// Phase 3 (transaction, après la corbeille Drive) : revérifie puis marque la version et clôt l'opération.
export async function confirmerCorbeille(cx, { documentId, numero, operationId }) {
  await verrouillerGraphe(cx);
  await verrouillerDocuments(cx, [documentId], "UPDATE");
  const { rows: [v] } = await cx.query(
    "SELECT id, drive_file_id, corbeille_le FROM document_versions WHERE document_id = $1 AND numero = $2 AND remplacee_le IS NOT NULL",
    [documentId, numero]
  );
  if (!v) throw new ErreurDocument(409, "version_obsolete", "La version n'est plus une ancienne version.");
  if (!v.corbeille_le) {
    await verifierFichierLibre(cx, v.drive_file_id);
    await cx.query("UPDATE document_versions SET corbeille_le = now() WHERE id = $1", [v.id]);
  }
  await cx.query(
    "UPDATE corbeille_operations SET statut = 'confirmee', confirmee_le = now(), bail_jusqu_au = NULL, bail_jeton = NULL WHERE id = $1 AND statut = 'en_attente'",
    [operationId]
  );
  return { corbeille: true, driveFileId: v.drive_file_id };
}

// ── Rattachements document ↔ formation ───────────────────────

export async function rattacherFormation(cx, { documentId, formationId, utilisateurId = null }) {
  await verrouillerGraphe(cx);
  await verrouillerDocuments(cx, [documentId], "SHARE");
  await documentCourant(cx, documentId);
  const { rows: [f] } = await cx.query("SELECT id FROM formations WHERE id = $1", [formationId]);
  if (!f) throw new ErreurDocument(404, "formation_introuvable", "Formation introuvable.");
  const { rowCount } = await cx.query(
    `INSERT INTO document_formations (document_id, formation_id, origine, ajoute_par, valide_par, valide_le)
     VALUES ($1, $2, 'manuel', $3, $3, now())
     ON CONFLICT (document_id, formation_id) DO NOTHING`,
    [documentId, formationId, utilisateurId]
  );
  if (rowCount === 0) throw new ErreurDocument(409, "deja_rattache", "Ce document est déjà rattaché à cette formation.");
  return { rattache: true };
}

// Validation humaine d'un rattachement dérivé (session ou inscription).
export async function validerFormation(cx, { documentId, formationId, utilisateurId = null }) {
  await verrouillerGraphe(cx);
  await verrouillerDocuments(cx, [documentId], "SHARE");
  const { rowCount } = await cx.query(
    `UPDATE document_formations SET valide_par = $3, valide_le = now()
      WHERE document_id = $1 AND formation_id = $2 AND valide_le IS NULL AND origine <> 'manuel'`,
    [documentId, formationId, utilisateurId]
  );
  if (rowCount === 0) throw new ErreurDocument(404, "rattachement_a_valider_introuvable", "Aucun rattachement dérivé à valider.");
  return { valide: true };
}

export async function detacherFormation(cx, { documentId, formationId }) {
  await verrouillerGraphe(cx);
  await verrouillerDocuments(cx, [documentId], "SHARE");
  const { rowCount } = await cx.query(
    "DELETE FROM document_formations WHERE document_id = $1 AND formation_id = $2", [documentId, formationId]
  );
  if (rowCount === 0) throw new ErreurDocument(404, "rattachement_introuvable", "Ce document n'est pas rattaché à cette formation.");
  return { detache: true };
}
