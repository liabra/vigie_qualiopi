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
import { marqueursInconnus, requetesDocs, requetesSheets, valeursDeRemplacement, valeursMarqueurs } from "./marqueurs.js";
import { calculerAssiduite } from "./assiduite.js";
import { precontrolerGeneration } from "./precontroleGeneration.js";
import { balisesResiduelles } from "./validationModeles.js";
import { texteModeleSheet } from "./diagnosticModele.js";
import { remplacementsBlocs } from "./renduBlocs.js";

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

// Lecture du MODÈLE (original) : texte complet (pour les blocs) + marqueurs
// inconnus. Mis en cache par modèle : une génération « un par stagiaire »
// produit N copies du MÊME modèle. null = contrôle impossible, [] = aucun
// marqueur inconnu. Garde-fou, pas un préalable.
async function lireModele(clients, modele, jeton, cache) {
  if (cache?.has(modele.drive_file_id)) return cache.get(modele.drive_file_id);
  let resultat = { texte: null, inconnus: null };
  try {
    const { data } = await appelGoogle(
      "docs.documents.get",
      () => clients.docs.documents.get({ documentId: modele.drive_file_id }),
      { api: "docs", fichierId: modele.drive_file_id, modele: modele.nom, jeton }
    );
    const texte = texteDuDocument(data);
    resultat = { texte, inconnus: marqueursInconnus(texte) };
  } catch (e) {
    console.error("Modèle « " + modele.nom + " » : lecture impossible — " + (e.message || "erreur inconnue"));
  }
  cache?.set(modele.drive_file_id, resultat);
  return resultat;
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
export async function copierEtRemplir(clients, { modele, nom, dossierId, valeurs, cacheMarqueurs = null, verifierCopieSheet = false, blocs = null }, jeton) {
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
      // DOC-3D : vérification post-rendu Sheet — UNE seule copie par
      // génération (verifierCopieSheet), indépendante du nombre de
      // stagiaires. Relit la copie avec le lecteur borné existant et
      // détecte les balises reconnues restées non rendues.
      let marqueursNonResolus = [];
      let verificationMarqueurs = false;
      if (verifierCopieSheet) {
        try {
          const { texte } = await texteModeleSheet(clients, copie.id, jeton);
          marqueursNonResolus = balisesResiduelles(texte);
          verificationMarqueurs = true;
        } catch (e) {
          console.error("Génération — relecture de la copie Sheet impossible : " + (e.message || "erreur inconnue"));
        }
      }
      // La détection des marqueurs INCONNUS n'est pas faite sur Sheet
      // (seule la vérification post-rendu des balises reconnues l'est).
      return { ...copie, marqueursRemplaces: true, marqueursInconnusTrouves: [], detectionMarqueurs: false, marqueursNonResolus, verificationMarqueurs };
    }
    if (mime === DOC) {
      // Le modèle est lu AVANT le remplacement (sur l'original, pas sur la
      // copie déjà nettoyée) : c'est le seul moment où les marqueurs non
      // reconnus sont encore visibles, et où les blocs sont encore lisibles.
      const { texte: texteModele, inconnus } = await lireModele(clients, modele, jeton, cacheMarqueurs);
      // DOC-6A : remplacement des blocs répétables AVANT les scalaires — les
      // variables globales du corps de bloc sont ensuite remplacées par le
      // passage scalaire (même batchUpdate, requêtes ordonnées).
      const requetesBlocs = blocs && texteModele
        ? remplacementsBlocs(texteModele, blocs).map((b) => ({
            replaceAllText: { containsText: { text: b.find, matchCase: true }, replaceText: b.replacement },
          }))
        : [];
      await appelGoogle(
        "docs.documents.batchUpdate",
        () => clients.docs.documents.batchUpdate({
          documentId: copie.id, requestBody: { requests: [...requetesBlocs, ...requetesDocs(valeurs)] },
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
        // DOC-3D : seules les balises RECONNUES restées après remplacement
        // sont remontées (canonique/alias/historique/champ_bloc), jamais de
        // simples accolades de texte métier.
        marqueursNonResolus = balisesResiduelles(texteDuDocument(relu));
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
    // DOC-3B : date_inscription/date_abandon/motif_abandon (déjà sur
    // `inscriptions`, zéro requête de plus) et la DERNIÈRE relance par
    // LEFT JOIN LATERAL — une seule requête pour TOUS les stagiaires
    // ciblés, jamais une par stagiaire (pas de N+1).
    `SELECT s.id, i.id AS inscription_id, s.civilite, s.nom, s.prenom, s.email, s.telephone, s.entreprise, s.financeur,
            i.prescripteur, pr.nom AS prescripteur_nom, g.nom AS groupe_nom, i.statut,
            i.date_inscription, i.date_abandon, i.motif_abandon,
            r.date_evenement AS relance_derniere_date,
            COALESCE((SELECT sum(a.duree_heures) FROM absences a WHERE a.inscription_id = i.id), 0) AS heures_absence
     FROM inscriptions i
     JOIN stagiaires s ON s.id = i.stagiaire_id
     LEFT JOIN prescripteurs pr ON pr.code = i.prescripteur
     LEFT JOIN groupes g ON g.id = i.groupe_id
     LEFT JOIN LATERAL (
       SELECT si.date_evenement FROM suivis_inscription si
       WHERE si.inscription_id = i.id AND si.type = 'relance'
       ORDER BY si.date_evenement DESC, si.id DESC LIMIT 1
     ) r ON true
     WHERE i.statut <> 'abandon'
       AND ($2::int IS NULL AND i.session_id = $1 OR i.groupe_id = $2)
     ORDER BY s.nom, s.prenom`,
    [session.id, groupe?.id ?? null]
  );
  return rows.map((stagiaire) => ({ stagiaire }));
}

// DOC-6A/6B — Lignes des blocs répétables, récupérées en UNE requête par bloc
// pour TOUTES les cibles (jamais une par stagiaire : pas de N+1). Seuls les
// blocs réellement demandés par le modèle sont chargés.
async function chargerLignesBlocs(aProduire, blocs = []) {
  const ids = aProduire.map((c) => c.stagiaire?.inscription_id).filter((x) => x != null);
  const resultat = {};
  if (ids.length && blocs.includes("absences")) {
    const absences = new Map();
    const { rows } = await query(
      `SELECT inscription_id, date_absence, duree_heures, justifiee, motif
       FROM absences WHERE inscription_id = ANY($1::int[])
       ORDER BY inscription_id, date_absence, id`,
      [ids]
    );
    for (const r of rows) {
      if (!absences.has(r.inscription_id)) absences.set(r.inscription_id, []);
      absences.get(r.inscription_id).push(r);
    }
    resultat.absences = absences;
  }
  if (ids.length && blocs.includes("evaluations")) {
    const evaluations = new Map();
    const { rows } = await query(
      `SELECT inscription_id, intitule, date_passage, score, score_max
       FROM resultats_qcm WHERE inscription_id = ANY($1::int[])
       ORDER BY inscription_id, date_passage, id`,
      [ids]
    );
    for (const r of rows) {
      if (!evaluations.has(r.inscription_id)) evaluations.set(r.inscription_id, []);
      evaluations.get(r.inscription_id).push(r);
    }
    resultat.evaluations = evaluations;
  }
  return resultat;
}

export async function contexteGeneration(sessionId, groupeId) {
  // DOC-3B : colonnes formation/version supplémentaires, TOUTES alias
  // explicitement (jamais `v.modalite` nu : la session a sa PROPRE colonne
  // `modalite`, un alias sans préfixe l'écraserait silencieusement dans
  // la ligne résultat).
  const { rows: [session] } = await query(
    `SELECT s.*, f.id AS formation_id, f.intitule, f.code_interne AS formation_code_interne,
            v.duree_heures_defaut, v.public_vise AS version_public_vise, v.prerequis AS version_prerequis,
            v.objectifs AS version_objectifs, v.modalite AS version_modalite,
            v.accessibilite_handicap AS version_accessibilite_handicap
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
  // Q4-1 : intervenants rattachés (annuaire), une requête chacun, triés.
  const formateurs = async (table, cle, id) => (id ? (await query(
    `SELECT i.id, i.civilite, i.nom, i.prenom, i.email, i.fonction FROM ${table} l JOIN intervenants i ON i.id = l.intervenant_id
     WHERE l.${cle} = $1 ORDER BY i.nom, i.prenom, i.id`, [id])).rows : []);
  const formateursSession = await formateurs("intervenants_sessions", "session_id", session.id);
  const formateursGroupe = await formateurs("intervenants_groupes", "groupe_id", groupe?.id);
  // DOC-3B : comptage de la session — UNE requête, indépendante du nombre
  // de documents produits. « Inscrits » exclut l'abandon, comme partout
  // ailleurs dans Vigie (pilotage.js, api.js, gestion.js) : pas une
  // formule inventée pour l'occasion.
  const { rows: [compte] } = await query(
    `SELECT count(*) FILTER (WHERE statut <> 'abandon')::int AS inscrits,
            count(*) FILTER (WHERE statut = 'termine')::int AS termines
     FROM inscriptions WHERE session_id = $1`,
    [sessionId]
  );
  session.nombre_inscrits = compte.inscrits;
  session.nombre_termines = compte.termines;
  return {
    session, groupe, formateursSession, formateursGroupe,
    formation: { intitule: session.intitule, id: session.formation_id, code_interne: session.formation_code_interne },
    version: {
      duree_heures_defaut: session.duree_heures_defaut, public_vise: session.version_public_vise,
      prerequis: session.version_prerequis, objectifs: session.version_objectifs,
      modalite: session.version_modalite, accessibilite_handicap: session.version_accessibilite_handicap,
    },
    // Durée prévue réellement déclarée, à défaut celle de la version
    // figée : la source unique du calcul d'assiduité (lot L2).
    heuresPrevues: session.duree_heures_reelle ?? session.duree_heures_defaut ?? null,
  };
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

// DOC-3C : l'ancienne vérification séparée (verifierModeleDrive, un
// drive.files.get dédié) est retirée — fusionnée dans analyserModeleDrive()
// (diagnosticModele.js), appelée par precontrolerGeneration() ci-dessous.
// Un format non supporté ou un fichier introuvable/inaccessible continue
// de bloquer AVANT toute copie : ces erreurs sont désormais levées par
// analyserModeleDrive() lui-même (propagées telles quelles, traduites par
// erreurGoogle() dans le catch global ci-dessous) ; un fichier à la
// corbeille est signalé par le précontrôle (code MODELE_CORBEILLE). Un
// seul drive.files.get pour tout le flux, au lieu de deux.

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
// DOC-3C : `admin` (booléen, estAdmin(req.user) calculé par la route) sert
// au précontrôle pour les variables/blocs `sensibilite: "restreinte"`.
export async function genererDocuments({ modeleId, sessionId, groupeId = null, remplacer = false, utilisateurId = null, admin = false, client: clientGoogle = null } = {}) {
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
    // DOC-3C — PRÉCONTRÔLE : « ce modèle peut-il être généré, par cet
    // utilisateur, avec ces données, pour TOUTES les cibles ? » AVANT tout
    // effet de bord Drive (copie, création de dossier). Une seule lecture
    // du fichier (fusionnée avec l'ex-verifierModeleDrive) ; tout ou rien
    // pour le lot — une seule cible bloquante empêche TOUTE copie.
    const precontrole = await precontrolerGeneration(modele, ctx, aProduire, { admin, clients: d, jeton });
    if (!precontrole.autorise) {
      const e = new Error("La génération a été refusée par le précontrôle de sécurité documentaire.");
      e.statut = 400;
      e.precontrole = precontrole;
      throw e;
    }

    const dejaParCle = new Map(existants.map((x) => [x.stagiaire_id ?? 0, x]));
    const dossierId = await dossierCible(d.drive, ctx, jeton);
    const produits = [];
    let remplaces = 0;
    // DOC-6A/6B : lignes des blocs pour toutes les cibles, une requête par bloc
    // (seulement pour les blocs effectivement demandés par le modèle).
    const blocsDemandes = precontrole.blocs || [];
    const lignesBlocs = blocsDemandes.length ? await chargerLignesBlocs(aProduire, blocsDemandes) : null;
    // DOC-6B : intervenants = même sémantique que le marqueur historique
    // `formateur` : groupe prioritaire, à défaut session. Ordre déjà trié.
    const lignesIntervenants = blocsDemandes.includes("intervenants")
      ? (ctx.formateursGroupe?.length ? ctx.formateursGroupe : (ctx.formateursSession || []))
      : null;
    // Anciens fichiers à archiver : mis à la corbeille SEULEMENT APRÈS le
    // succès de l'écriture en base (sinon la DB pointerait vers un fichier
    // déjà trashé). Collectés ici, exécutés après COMMIT.
    const anciensATrasher = [];
    // Un seul modèle par génération : le cache évite de le relire à chaque copie.
    const cacheMarqueurs = new Map();
    // DOC-3D : relecture post-rendu Sheet limitée à la première copie —
    // le nombre de relectures ne dépend jamais du nombre de cibles.
    let premiereCopie = true;

    for (const { stagiaire } of aProduire) {
      // Assiduité par stagiaire : le MÊME calcul que le lot L2, pas une copie.
      const assiduite = stagiaire
        ? calculerAssiduite({ heuresPrevues: ctx.heuresPrevues, heuresAbsence: stagiaire.heures_absence, statut: stagiaire.statut })
        : null;
      // DOC-3B : UN seul instant par document, réutilisé par document_date
      // ET document_date_convocation (resolversCanoniques.js) — jamais deux
      // `new Date()` distincts pour un même document.
      const maintenant = new Date();
      const valeurs = valeursMarqueurs({ ...ctx, stagiaire, assiduite, organisme: config.organismeNom, maintenant });
      // DOC-3D : map plat de remplacement — 23 historiques + les canoniques
      // réellement présents dans le modèle (précontrôle), jamais les 45.
      const remplacements = valeursDeRemplacement(valeurs, precontrole.canoniques);
      // Nom de fichier sûr : jamais de séparateur de chemin ni de nom vide.
      const brut = stagiaire
        ? `${modele.nom} - ${stagiaire.nom} ${stagiaire.prenom}`
        : `${modele.nom} - ${ctx.groupe?.nom || ctx.session.reference || ctx.session.date_debut}`;
      const nom = nomSain(brut);

      const ancien = dejaParCle.get(stagiaire?.id ?? 0);
      // DOC-6A/6B : lignes de blocs de CE stagiaire (absences, évaluations) et
      // intervenants (niveau génération, identiques pour toutes les copies).
      const blocsStagiaire = lignesBlocs
        ? {
            absences: (stagiaire?.inscription_id != null ? lignesBlocs.absences?.get(stagiaire.inscription_id) : null) || [],
            evaluations: (stagiaire?.inscription_id != null ? lignesBlocs.evaluations?.get(stagiaire.inscription_id) : null) || [],
            intervenants: lignesIntervenants || [],
          }
        : null;
      const copie = await copierEtRemplir(d, { modele, nom, dossierId, valeurs: remplacements, cacheMarqueurs, verifierCopieSheet: premiereCopie, blocs: blocsStagiaire }, jeton);
      premiereCopie = false;
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
