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
import { marqueursInconnus, requetesDocs, requetesSheets, valeursMarqueurs } from "./marqueurs.js";

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

  const mime = copie.mimeType || modele.drive_mime;
  if (mime === SHEET) {
    await appelGoogle(
      "sheets.spreadsheets.batchUpdate",
      () => clients.sheets.spreadsheets.batchUpdate({
        spreadsheetId: copie.id, requestBody: { requests: requetesSheets(valeurs) },
      }),
      { api: "sheets", fichierId: copie.id, jeton }
    );
  } else if (mime === DOC) {
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
    return {
      ...copie, marqueursRemplaces: true,
      marqueursInconnusTrouves: inconnus || [],
      detectionMarqueurs: inconnus !== null,
    };
  } else {
    // Ni Doc ni Sheet : la copie existe, mais aucun marqueur n'a pu être
    // remplacé. On le dit plutôt que de laisser croire au remplacement.
    return { ...copie, marqueursRemplaces: false, marqueursInconnusTrouves: [], detectionMarqueurs: false };
  }
  // Sheet : le remplacement a bien lieu, mais la détection des marqueurs
  // inconnus n'est pas faite — elle demanderait de parcourir toutes les
  // cellules de tous les onglets. `detectionMarqueurs: false` dit que
  // l'absence d'avertissement ne prouve rien pour ce document.
  return { ...copie, marqueursRemplaces: true, marqueursInconnusTrouves: [], detectionMarqueurs: false };
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
    `SELECT s.id, s.civilite, s.nom, s.prenom
     FROM inscriptions i JOIN stagiaires s ON s.id = i.stagiaire_id
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
  return { session, groupe, formation: { intitule: session.intitule }, version: { duree_heures_defaut: session.duree_heures_defaut } };
}

// `client` n'est passé que par les tests ; en production il vient de getDrive().
export async function genererDocuments({ modeleId, sessionId, groupeId = null, remplacer = false, utilisateurId = null, client: clientGoogle = null } = {}) {
  const d = clientGoogle || (await getDrive());
  if (!d) throw new Error("Drive non connecté : connectez le compte de l'organisme avant de générer.");
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

  const dejaParCle = new Map(existants.map((x) => [x.stagiaire_id ?? 0, x]));
  const dossierId = await dossierCible(d.drive, ctx, jeton);
  const produits = [];
  let remplaces = 0;
  // Un seul modèle par génération : le cache évite de le relire à chaque copie.
  const cacheMarqueurs = new Map();

  for (const { stagiaire } of aProduire) {
    const valeurs = valeursMarqueurs({ ...ctx, stagiaire, organisme: config.organismeNom });
    const nom = stagiaire
      ? `${modele.nom} - ${stagiaire.nom} ${stagiaire.prenom}`
      : `${modele.nom} - ${ctx.groupe?.nom || ctx.session.reference || ctx.session.date_debut}`;

    const ancien = dejaParCle.get(stagiaire?.id ?? 0);
    const copie = await copierEtRemplir(d, { modele, nom, dossierId, valeurs, cacheMarqueurs }, jeton);

    // L'ancien fichier part à la corbeille : il a été créé par
    // l'application, drive.file suffit donc pour l'y mettre.
    if (ancien) {
      await appelGoogle(
        "drive.files.update",
        () => d.drive.files.update({ fileId: ancien.drive_file_id, requestBody: { trashed: true }, supportsAllDrives: true }),
        { api: "drive", fichierId: ancien.drive_file_id, jeton }
      ).catch(() => {});   // déjà supprimé à la main : sans conséquence
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
    return {
      generationId: gen.id, modele: modele.nom, portee: modele.portee,
      documents: produits.length, remplaces, preuves: preuves.length,
      dossierId,
      marqueursNonRemplaces: produits.filter((p) => !p.copie.marqueursRemplaces).length,
      // Marqueurs écrits dans le modèle mais absents de la convention :
      // ils restent tels quels dans les documents produits.
      marqueursInconnus: [...new Set(produits.flatMap((p) => p.copie.marqueursInconnusTrouves || []))],
      // false quand aucune copie n'a pu être analysée (Sheet, ou format
      // non géré) : l'absence d'avertissement ne prouve alors rien.
      detectionMarqueurs: produits.some((p) => p.copie.detectionMarqueurs),
    };
  } catch (e) {
    await cx.query("ROLLBACK");
    throw e;
  } finally {
    cx.release();
  }
}
