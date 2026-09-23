// ─────────────────────────────────────────────────────────────
//  Génération de documents à partir des modèles Drive.
//
//  Une génération = pour un modèle et une session (ou un groupe) :
//    · copier le modèle autant de fois que la portée l'exige,
//    · y remplacer les marqueurs (voir marqueurs.js),
//    · déposer les copies dans /<racine>/<formation>/<dates>/<groupe>/,
//    · créer ou retrouver la preuve correspondante et y rattacher les
//      fichiers, en réutilisant le comptage de la Phase 1bis.
//
//  Rejouable : un document déjà produit pour le même couple
//  (modèle, groupe, stagiaire) est REMPLACÉ, jamais empilé.
// ─────────────────────────────────────────────────────────────
import { config } from "../config.js";
import { getPool, query } from "../db.js";
import { appelGoogle, etatJeton, getDrive, DRIVE_FILE } from "./google.js";
import { marqueursInconnus, marqueursRestants, requetesDocs, requetesSheets, valeursMarqueurs } from "./marqueurs.js";
import { calculerAssiduite } from "./assiduite.js";

const DOSSIER = "application/vnd.google-apps.folder";
const DOC = "application/vnd.google-apps.document";
const SHEET = "application/vnd.google-apps.spreadsheet";

const echappe = (s) => String(s).replace(/'/g, "\\'");
// Un nom de dossier Drive ne doit pas contenir de séparateur de chemin.
const nomSain = (s) => String(s || "").replace(/[\/\\]/g, "-").trim() || "Sans nom";

// Texte brut d'un Google Doc, TOUT compris : corps, tableaux (marqueurs
// souvent placés dans des cellules), en-têtes et pieds de page. Sans
// cela, un marqueur logé dans un tableau passerait inaperçu.
export function texteDuDocument(doc) {
  const morceaux = [];
  const parcourirElements = (elements = []) => {
    for (const el of elements) {
      if (el.paragraph) {
        for (const e of el.paragraph.elements || []) if (e.textRun?.content) morceaux.push(e.textRun.content);
      }
      if (el.table) {
        for (const ligne of el.table.tableRows || []) {
          for (const cellule of ligne.tableCells || []) parcourirElements(cellule.content);
        }
      }
      if (el.tableOfContents) parcourirElements(el.tableOfContents.content);
    }
  };
  parcourirElements(doc?.body?.content);
  for (const partie of [...Object.values(doc?.headers || {}), ...Object.values(doc?.footers || {}),
                        ...Object.values(doc?.footnotes || {})]) {
    parcourirElements(partie.content);
  }
  return morceaux.join("");
}

// Marqueurs écrits dans un modèle mais absents de la convention. Le
// résultat est mis en cache par modèle : une génération « un par
// stagiaire » produit N copies du MÊME modèle, inutile de le relire N fois.
// null = contrôle impossible, à distinguer de [] = aucun marqueur inconnu.
// Ce contrôle est un garde-fou, pas un préalable : s'il échoue (droits,
// quota, format inattendu), on produit quand même les documents et on dit
// que la vérification n'a pas pu être faite.
async function marqueursNonReconnus(clients, modele, jeton, cache) {
  if (cache?.has(modele.drive_file_id)) return cache.get(modele.drive_file_id);
  let trouves = null;
  try {
    const { data } = await appelGoogle(
      "docs.documents.get",
      () => clients.docs.documents.get({ documentId: modele.drive_file_id }),
      { api: "docs", fichierId: modele.drive_file_id, modele: modele.nom, jeton }
    );
    trouves = marqueursInconnus(texteDuDocument(data));
  } catch (e) {
    console.error("Modèle « " + modele.nom + " » : contrôle des marqueurs impossible — " + (e.message || "erreur inconnue"));
  }
  cache?.set(modele.drive_file_id, trouves);
  return trouves;
}

// Retrouve un sous-dossier par son nom, ou le crée. Le dossier créé est
// « créé par l'application », donc accessible avec le seul scope
// drive.file pour la suite.
async function dossier(drive, nom, parentId, jeton) {
  const propre = nomSain(nom);
  const { data } = await appelGoogle(
    "drive.files.list",
    () => drive.files.list({
      q: `name = '${echappe(propre)}' and mimeType = '${DOSSIER}' and trashed = false` +
         (parentId ? ` and '${echappe(parentId)}' in parents` : ""),
      fields: "files(id,name)", pageSize: 10,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    }),
    { api: "drive", dossier: propre, jeton }
  );
  if (data.files?.length) return data.files[0].id;

  const { data: cree } = await appelGoogle(
    "drive.files.create",
    () => drive.files.create({
      requestBody: { name: propre, mimeType: DOSSIER, ...(parentId ? { parents: [parentId] } : {}) },
      fields: "id", supportsAllDrives: true,
    }),
    { api: "drive", dossier: propre, jeton }
  );
  return cree.id;
}

// /<racine>/<formation>/<dates de session>/<groupe>/
export async function dossierCible(drive, { formation, session, groupe }, jeton) {
  const racine = await dossier(drive, config.driveRacine, config.driveRacineId || null, jeton);
  const fFormation = await dossier(drive, formation.intitule, racine, jeton);
  const dates = `${session.date_debut} au ${session.date_fin}`;
  const fSession = await dossier(drive, session.reference ? `${session.reference} (${dates})` : dates, fFormation, jeton);
  return groupe ? dossier(drive, groupe.nom, fSession, jeton) : fSession;
}

// Copie le modèle puis remplace les marqueurs DANS LA COPIE. Le modèle
// d'origine n'est jamais modifié.
export async function copierEtRemplir(clients, { modele, nom, dossierId, valeurs, cacheMarqueurs = null }, jeton) {
  const { data: copie } = await appelGoogle(
    "drive.files.copy",
    () => clients.drive.files.copy({
      fileId: modele.drive_file_id,
      requestBody: { name: nom, parents: [dossierId] },
      fields: "id,name,webViewLink,mimeType", supportsAllDrives: true,
    }),
    { api: "drive", modele: modele.nom, jeton }
  );

  try {
    const mime = copie.mimeType || modele.drive_mime;
    if (mime === SHEET) {
      await appelGoogle(
        "sheets.spreadsheets.batchUpdate",
        () => clients.sheets.spreadsheets.batchUpdate({
          spreadsheetId: copie.id, requestBody: { requests: requetesSheets(valeurs) },
        }),
        { api: "sheets", fichierId: copie.id, jeton }
      );
      // Sheet : le remplacement a bien lieu, mais la détection des marqueurs
      // inconnus n'est pas faite (il faudrait parcourir toutes les cellules).
      return { ...copie, marqueursRemplaces: true, marqueursInconnusTrouves: [], detectionMarqueurs: false };
    }
    if (mime === DOC) {
      // Le modèle est lu AVANT le remplacement (sur l'original, pas sur la
      // copie déjà nettoyée) : c'est le seul moment où les marqueurs non
      // reconnus sont encore visibles.
      const inconnus = await marqueursNonReconnus(clients, modele, jeton, cacheMarqueurs);
      await appelGoogle(
        "docs.documents.batchUpdate",
        () => clients.docs.documents.batchUpdate({
          documentId: copie.id, requestBody: { requests: requetesDocs(valeurs) },
        }),
        { api: "docs", fichierId: copie.id, jeton }
      );
      // Relit la COPIE pour vérifier qu'aucun marqueur {{...}} ne subsiste :
      // un marqueur éclaté sur plusieurs éléments texte n'aurait pas été
      // remplacé par replaceAllText. Un échec de relecture n'annule pas la
      // copie : on le signale seulement (verificationMarqueurs: false).
      let marqueursNonResolus = [];
      let verificationMarqueurs = false;
      try {
        const { data: relu } = await appelGoogle(
          "docs.documents.get",
          () => clients.docs.documents.get({ documentId: copie.id }),
          { api: "docs", fichierId: copie.id, jeton }
        );
        marqueursNonResolus = marqueursRestants(texteDuDocument(relu));
        verificationMarqueurs = true;
      } catch (e) {
        console.error("Génération — relecture de la copie impossible : " + (e.message || "erreur inconnue"));
      }
      return {
        ...copie, marqueursRemplaces: true,
        marqueursInconnusTrouves: inconnus || [],
        detectionMarqueurs: inconnus !== null,
        marqueursNonResolus, verificationMarqueurs,
      };
    }
    // Ni Doc ni Sheet : la copie existe, mais aucun marqueur n'a pu être
    // remplacé. On le dit plutôt que de laisser croire au remplacement.
    return { ...copie, marqueursRemplaces: false, marqueursInconnusTrouves: [], detectionMarqueurs: false };
  } catch (e) {
    // La copie a été créée mais la suite (remplacement) a échoué : on la
    // met à la corbeille (au mieux) et on ne masque pas l'erreur d'origine.
    await nettoyerCopies(clients, [copie.id], jeton);
    throw e;
  }
}

// Preuve d'un document généré : une par (modèle, indicateur, session,
// groupe). En portée stagiaire elle est en mode « par stagiaire », donc
// son nombre attendu vient des inscriptions — le comptage existant fait
// le reste, on n'en réécrit aucun.
async function preuvePourModele(client, { modele, indicateurId, session, groupe, utilisateurId }) {
  const mode = modele.portee === "stagiaire" ? "par_stagiaire" : "unique";
  const ou = [session?.reference || null, groupe?.nom || null].filter(Boolean).join(" / ");
  const titre = ou ? `${modele.nom} — ${ou}` : modele.nom;
  const { rows: [preuve] } = await client.query(
    `INSERT INTO preuves (indicateur_id, titre, statut, source, mode_fichiers, session_id, groupe_id, modele_id, created_by)
     VALUES ($1, $2, 'maitrise', 'generation', $3, $4, $5, $6, $7)
     ON CONFLICT (modele_id, indicateur_id, COALESCE(session_id, 0), COALESCE(groupe_id, 0))
       WHERE modele_id IS NOT NULL
     DO UPDATE SET titre = EXCLUDED.titre, mode_fichiers = EXCLUDED.mode_fichiers
     RETURNING id`,
    [indicateurId, titre, mode, session?.id || null, groupe?.id || null, modele.id, utilisateurId]
  );
  return preuve.id;
}

// Ce qu'il faut produire, selon la portée du modèle.
async function cibles(modele, { session, groupe }) {
  if (modele.portee !== "stagiaire") return [{ stagiaire: null }];
  const { rows } = await query(
    // Toute colonne oubliée ici ressort en marqueur vide dans les
    // documents, sans erreur : c'est exactement ainsi que {{civilite}}
    // est passé inaperçu. Ajouter un marqueur lié au stagiaire impose
    // d'ajouter sa colonne à ce SELECT.
    `SELECT s.id, s.civilite, s.nom, s.prenom, s.email, s.telephone, s.entreprise, s.financeur,
            i.prescripteur, pr.nom AS prescripteur_nom, g.nom AS groupe_nom, i.statut,
            COALESCE((SELECT sum(a.duree_heures) FROM absences a WHERE a.inscription_id = i.id), 0) AS heures_absence
     FROM inscriptions i
     JOIN stagiaires s ON s.id = i.stagiaire_id
     LEFT JOIN prescripteurs pr ON pr.code = i.prescripteur
     LEFT JOIN groupes g ON g.id = i.groupe_id
     WHERE i.statut <> 'abandon'
       AND ($2::int IS NULL AND i.session_id = $1 OR i.groupe_id = $2)
     ORDER BY s.nom, s.prenom`,
    [session.id, groupe?.id ?? null]
  );
  return rows.map((stagiaire) => ({ stagiaire }));
}

export async function contexteGeneration(sessionId, groupeId) {
  const { rows: [session] } = await query(
    `SELECT s.*, f.id AS formation_id, f.intitule, v.duree_heures_defaut
     FROM sessions s
     JOIN formations f ON f.id = s.formation_id
     LEFT JOIN formation_versions v ON v.id = s.formation_version_id
     WHERE s.id = $1`,
    [sessionId]
  );
  if (!session) throw new Error("Session introuvable.");
  let groupe = null;
  if (groupeId) {
    const { rows } = await query("SELECT * FROM groupes WHERE id = $1 AND session_id = $2", [groupeId, sessionId]);
    groupe = rows[0] || null;
    if (!groupe) throw new Error("Groupe introuvable dans cette session.");
  }
  return { session, groupe, formation: { intitule: session.intitule }, version: { duree_heures_defaut: session.duree_heures_defaut },
           // Durée prévue réellement déclarée, à défaut celle de la version
           // figée : la source unique du calcul d'assiduité (lot L2).
           heuresPrevues: session.duree_heures_reelle ?? session.duree_heures_defaut ?? null };
}

// ── Robustesse du flux de génération (lot L9) ────────────────

// Une erreur Google (gaxios/googleapis) → message métier sûr, sans token
// ni détail technique. `appelGoogle` a déjà journalisé le diagnostic
// complet (champs sensibles masqués) côté serveur.
function erreurGoogle(e) {
  const statut = e?.status ?? e?.response?.status ?? null;
  if (statut === 401) return { statut: 400, message: "La connexion Google a expiré. Reconnectez le Drive depuis les réglages." };
  if (statut === 403) return { statut: 400, message: "Google refuse l'accès à ce fichier. Vérifiez les autorisations du modèle." };
  if (statut === 404) return { statut: 400, message: "Le fichier Google demandé est introuvable ou a été supprimé." };
  if (statut && statut >= 500) return { statut: 503, message: "Google est momentanément indisponible. Réessayez dans un instant." };
  return { statut: 503, message: "Google est indisponible ou la requête a échoué. Réessayez." };
}

// Vérifie le fichier MODÈLE sur Drive AVANT de copier : absent, en
// corbeille, inaccessible ou d'un type non remplaçable ⇒ erreur claire
// AVANT toute création de copie.
async function verifierModeleDrive(d, modele, jeton) {
  let infos;
  try {
    ({ data: infos } = await appelGoogle(
      "drive.files.get",
      () => d.drive.files.get({
        fileId: modele.drive_file_id,
        fields: "id,name,mimeType,trashed",
        supportsAllDrives: true,
      }),
      { api: "drive", modele: modele.nom, jeton }
    ));
  } catch (e) {
    const { statut } = erreurGoogle(e);
    const propre = new Error(
      e?.response?.status === 404
        ? `Le fichier du modèle « ${modele.nom} » est introuvable ou a été supprimé du Drive.`
        : e?.response?.status === 403
          ? `Le modèle « ${modele.nom} » n'est pas accessible : vérifiez son partage sur Drive.`
          : "Impossible de vérifier le modèle sur Drive."
    );
    propre.statut = statut;
    throw propre;
  }
  if (!infos || infos.trashed) {
    const e = new Error(`Le fichier du modèle « ${modele.nom} » est introuvable ou a été supprimé du Drive.`);
    e.statut = 400;
    throw e;
  }
  if (infos.mimeType !== DOC && infos.mimeType !== SHEET) {
    const e = new Error(`Le modèle « ${modele.nom} » n'est ni un Google Doc ni un Google Sheet : ses marqueurs ne peuvent pas être remplacés.`);
    e.statut = 400;
    throw e;
  }
  return infos;
}

// Met à la corbeille, au mieux, les copies déjà créées : on ne masque
// jamais l'erreur d'origine, et un fichier orphelin vaut mieux qu'une
// génération annoncée réussie à tort.
async function nettoyerCopies(d, ids, jeton) {
  for (const id of ids) {
    await appelGoogle(
      "drive.files.update",
      () => d.drive.files.update({ fileId: id, requestBody: { trashed: true }, supportsAllDrives: true }),
      { api: "drive", fichierId: id, jeton }
    ).catch((e) => console.error("Génération — nettoyage de la copie " + id + " impossible : " + (e.message || "erreur inconnue")));
  }
}

// Archive les ANCIENS fichiers après un remplacement réussi en base.
// Un échec d'archivage ne remet JAMAIS en cause la génération : il est
// journalisé et la liste des fichiers non archivés est renvoyée.
async function archiverAnciens(d, ids, jeton) {
  const echoues = [];
  for (const id of ids) {
    const ok = await appelGoogle(
      "drive.files.update",
      () => d.drive.files.update({ fileId: id, requestBody: { trashed: true }, supportsAllDrives: true }),
      { api: "drive", fichierId: id, jeton }
    ).then(() => true).catch((e) => {
      console.error("Génération — archive de l'ancien fichier " + id + " impossible : " + (e.message || "erreur inconnue"));
      return false;
    });
    if (!ok) echoues.push(id);
  }
  return echoues;
}

// Garde anti double clic : une seule génération à la fois pour un même
// (modèle, session, groupe). Portée du PROCESSUS (une seule instance en
// production) — documenté comme limite, pas une infrastructure distribuée.
const generationsEnCours = new Map();

// `client` n'est passé que par les tests ; en production il vient de getDrive().
export async function genererDocuments({ modeleId, sessionId, groupeId = null, remplacer = false, utilisateurId = null, client: clientGoogle = null } = {}) {
  const d = clientGoogle || (await getDrive());
  if (!d) {
    const e = new Error("Google Drive est indisponible ou non connecté. Impossible de générer des documents.");
    e.statut = 503;
    throw e;
  }
  if (!d.row.scopes.split(/\s+/).includes(DRIVE_FILE)) {
    throw new Error("Le Drive est connecté en lecture seule. Reconnectez-le pour autoriser la création de documents.");
  }
  const jeton = etatJeton(d.row);

  const { rows: [modele] } = await query("SELECT * FROM modeles_documents WHERE id = $1 AND actif", [modeleId]);
  if (!modele) throw new Error("Modèle introuvable ou désactivé.");
  const { rows: indicateurs } = await query("SELECT indicateur_id FROM modele_indicateurs WHERE modele_id = $1", [modeleId]);

  const ctx = await contexteGeneration(sessionId, groupeId);
  const aProduire = await cibles(modele, ctx);
  if (!aProduire.length) {
    throw new Error("Aucun stagiaire inscrit (hors abandons) : rien à générer pour ce modèle.");
  }

  // Déjà produits pour ce couple : on ne double jamais sans consigne.
  const { rows: existants } = await query(
    `SELECT * FROM documents_generes
     WHERE modele_id = $1 AND COALESCE(session_id, 0) = $2 AND COALESCE(groupe_id, 0) = $3`,
    [modeleId, sessionId || 0, groupeId || 0]
  );
  if (existants.length && !remplacer) {
    const e = new Error(
      `${existants.length} document(s) ont déjà été générés pour ce modèle sur cette session. ` +
      "Relancez en confirmant le remplacement pour les refaire."
    );
    e.dejaGeneres = existants.length;
    throw e;
  }

  // Garde anti double clic : une seule génération à la fois pour ce couple.
  const cle = `${modeleId}:${sessionId}:${groupeId ?? ""}`;
  if (generationsEnCours.has(cle)) {
    const e = new Error("Une génération est déjà en cours pour ce modèle et cette session.");
    e.genEnCours = true;
    throw e;
  }
  generationsEnCours.set(cle, true);

  // Copies Drive créées au fil de l'eau : en cas d'échec, on les met à la
  // corbeille (au mieux) pour ne pas laisser d'orphelin.
  const copiesCreees = [];
  try {
    // Le modèle doit exister, être accessible et remplaçable AVANT toute copie.
    await verifierModeleDrive(d, modele, jeton);

    const dejaParCle = new Map(existants.map((x) => [x.stagiaire_id ?? 0, x]));
    const dossierId = await dossierCible(d.drive, ctx, jeton);
    const produits = [];
    let remplaces = 0;
    // Anciens fichiers à archiver : mis à la corbeille SEULEMENT APRÈS le
    // succès de l'écriture en base (sinon la DB pointerait vers un fichier
    // déjà trashé). Collectés ici, exécutés après COMMIT.
    const anciensATrasher = [];
    // Un seul modèle par génération : le cache évite de le relire à chaque copie.
    const cacheMarqueurs = new Map();

    for (const { stagiaire } of aProduire) {
      // Assiduité par stagiaire : le MÊME calcul que le lot L2, pas une copie.
      const assiduite = stagiaire
        ? calculerAssiduite({ heuresPrevues: ctx.heuresPrevues, heuresAbsence: stagiaire.heures_absence, statut: stagiaire.statut })
        : null;
      const valeurs = valeursMarqueurs({ ...ctx, stagiaire, assiduite, organisme: config.organismeNom });
      // Nom de fichier sûr : jamais de séparateur de chemin ni de nom vide.
      const brut = stagiaire
        ? `${modele.nom} - ${stagiaire.nom} ${stagiaire.prenom}`
        : `${modele.nom} - ${ctx.groupe?.nom || ctx.session.reference || ctx.session.date_debut}`;
      const nom = nomSain(brut);

      const ancien = dejaParCle.get(stagiaire?.id ?? 0);
      const copie = await copierEtRemplir(d, { modele, nom, dossierId, valeurs, cacheMarqueurs }, jeton);
      copiesCreees.push(copie.id);

      if (ancien) {
        // Rien n'est trashé ici : on garde l'ancien fichier intact tant que
        // la base n'a pas confirmé le remplacement.
        anciensATrasher.push(ancien.drive_file_id);
        remplaces++;
      }
      produits.push({ stagiaire, copie, nom });
    }

  // Écriture en base : tout ou rien.
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [gen] } = await cx.query(
      `INSERT INTO generations (modele_id, session_id, groupe_id, nb_documents, nb_remplaces, lancee_par)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [modeleId, sessionId, groupeId, produits.length, remplaces, utilisateurId]
    );

    const preuves = [];
    for (const indicateurId of indicateurs.map((i) => i.indicateur_id)) {
      const preuveId = await preuvePourModele(cx, { modele, indicateurId, session: ctx.session, groupe: ctx.groupe, utilisateurId });
      preuves.push(preuveId);
      // Les pièces jointes de cette preuve sont refaites à neuf : les
      // anciens fichiers viennent d'être mis à la corbeille.
      await cx.query(
        "DELETE FROM preuve_fichiers WHERE preuve_id = $1 AND drive_file_id = ANY($2::text[])",
        [preuveId, existants.map((x) => x.drive_file_id)]
      );
      for (const p of produits) {
        await cx.query(
          `INSERT INTO preuve_fichiers (preuve_id, drive_file_id, drive_url, drive_nom, drive_mime, source, stagiaire_id, ajoute_par)
           VALUES ($1, $2, $3, $4, $5, 'generation', $6, $7)
           ON CONFLICT (preuve_id, drive_file_id) DO UPDATE SET drive_nom = EXCLUDED.drive_nom, source = 'generation'`,
          [preuveId, p.copie.id, p.copie.webViewLink || null, p.nom, p.copie.mimeType || null, p.stagiaire?.id || null, utilisateurId]
        );
      }
    }

    for (const p of produits) {
      await cx.query(
        `INSERT INTO documents_generes (modele_id, session_id, groupe_id, stagiaire_id, generation_id,
           drive_file_id, drive_url, nom, preuve_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (modele_id, COALESCE(session_id, 0), COALESCE(groupe_id, 0), COALESCE(stagiaire_id, 0))
         DO UPDATE SET drive_file_id = EXCLUDED.drive_file_id, drive_url = EXCLUDED.drive_url,
           nom = EXCLUDED.nom, generation_id = EXCLUDED.generation_id, preuve_id = EXCLUDED.preuve_id,
           genere_le = now(), remplace_le = now()`,
        [modeleId, sessionId, groupeId, p.stagiaire?.id || null, gen.id,
         p.copie.id, p.copie.webViewLink || null, p.nom, preuves[0] || null]
      );
    }
    await cx.query("COMMIT");

    // Seulement APRÈS le succès DB : archive l'ancien fichier. Un échec
    // d'archivage ne remet JAMAIS en cause la génération déjà enregistrée —
    // il est journalisé et signalé (anciensNonArchives), sans rollback.
    const anciensNonArchives = await archiverAnciens(d, anciensATrasher, jeton);

    return {
      generationId: gen.id, modele: modele.nom, portee: modele.portee,
      documents: produits.length, remplaces, preuves: preuves.length,
      dossierId,
      anciensNonArchives,
      marqueursNonRemplaces: produits.filter((p) => !p.copie.marqueursRemplaces).length,
      // Marqueurs écrits dans le modèle mais absents de la convention :
      // ils restent tels quels dans les documents produits.
      marqueursInconnus: [...new Set(produits.flatMap((p) => p.copie.marqueursInconnusTrouves || []))],
      // Marqueurs {{...}} encore présents dans une copie après remplacement :
      // la génération n'est pas silencieusement présentée comme parfaite.
      marqueursNonResolus: [...new Set(produits.flatMap((p) => p.copie.marqueursNonResolus || []))],
      // false quand aucune copie n'a pu être analysée (Sheet, ou format
      // non géré) : l'absence d'avertissement ne prouve alors rien.
      detectionMarqueurs: produits.some((p) => p.copie.detectionMarqueurs),
      // false quand la relecture post-remplacement n'a pas pu être faite.
      verificationMarqueurs: produits.some((p) => p.copie.verificationMarqueurs),
    };
  } catch (e) {
    await cx.query("ROLLBACK");
    throw e;
  } finally {
    cx.release();
  }
  } catch (e) {
    // Des copies Drive ont pu être créées avant l'échec : on les met à la
    // corbeille (au mieux), sans jamais masquer l'erreur d'origine.
    if (copiesCreees.length) await nettoyerCopies(d, copiesCreees, jeton);
    // Une erreur Google brute ne doit pas fuir : message métier sûr, le
    // diagnostic complet (champs sensibles masqués) est déjà journalisé.
    if (!e.statut && !e.dejaGeneres && !e.genEnCours && e.diagnostic) {
      const { statut, message } = erreurGoogle(e);
      const propre = new Error(message);
      propre.statut = statut;
      throw propre;
    }
    throw e;
  } finally {
    generationsEnCours.delete(cle);
  }
}
