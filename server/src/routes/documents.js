import { Router } from "express";
import { getPool, query } from "../db.js";
import { requireAdmin, requireAuth } from "../session.js";
import { parseIdPositif } from "../services/ids.js";
import { estAdmin, preuveVisibleContributeur } from "../services/confidentialite.js";
import {
  attacherDocument, detacherDocument, rattacherFichier, remplacerDocument, revaliderLien,
  predicatVisibleContributeur, verrouillerGraphe,
} from "../services/documentsPreuves.js";
import { precontroleFichier } from "../services/controleDrive.js";
import { getDrive } from "../services/google.js";
import { abandonnerOperation, relancerOperation, reprendreCorbeilles, tenterCorbeille } from "../services/corbeille.js";
import {
  archiverDocument, detacherFormation, rattacherFormation,
  restaurerDocument, validerFormation,
} from "../services/documentsPreuves.js";
import { ETAT_APRES } from "./api.js";
import { repondreErreurDocument } from "./documentsErreurs.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const lienDrive = (fichier) => `https://drive.google.com/file/d/${fichier}/view`;

// Une transaction par opération : verrou global d'abord, puis le service central.
async function transaction(fn) {
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    await verrouillerGraphe(cx);
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

async function etatPreuve(id) {
  const { rows: [etat] } = await query(ETAT_APRES, [id]);
  return etat || {};
}

function fichierDepuisCorps(corps) {
  const id = String(corps.drive_file_id).trim();
  return {
    drive_file_id: id,
    drive_url: corps.drive_url || lienDrive(id),
    drive_nom: corps.drive_nom || null,
    drive_mime: corps.drive_mime || null,
  };
}

function stagiaireDepuisCorps(valeur) {
  if (valeur === undefined || valeur === null || valeur === "") return { valeur: null };
  const id = parseIdPositif(valeur);
  return id ? { valeur: id } : { erreur: "Stagiaire invalide." };
}

// Rattacher un document existant (document_id) ou un fichier Drive (drive_file_id).
router.post("/preuves/:id/documents", requireAdmin, wrap(async (req, res) => {
  const preuveId = parseIdPositif(req.params.id);
  if (!preuveId) return res.status(400).json({ error: "Identifiant de preuve invalide." });
  const corps = req.body || {};
  const stagiaire = stagiaireDepuisCorps(corps.stagiaire_id);
  if (stagiaire.erreur) return res.status(400).json({ error: stagiaire.erreur });
  try {
    let resultat;
    if (corps.document_id !== undefined) {
      const documentId = parseIdPositif(corps.document_id);
      if (!documentId) return res.status(400).json({ error: "Identifiant de document invalide." });
      resultat = await transaction((cx) => attacherDocument(cx, {
        preuveId, documentId, origine: "manuel", stagiaireId: stagiaire.valeur, utilisateurId: req.user.id,
      }));
    } else {
      if (!corps.drive_file_id || !String(corps.drive_file_id).trim()) {
        return res.status(400).json({ error: "Document ou fichier Drive à rattacher obligatoire." });
      }
      const controle = await precontroleFichier(String(corps.drive_file_id));
      resultat = await transaction((cx) => rattacherFichier(cx, {
        preuveId, fichier: fichierDepuisCorps(corps), origine: "manuel",
        stagiaireId: stagiaire.valeur, utilisateurId: req.user.id, controle,
      }));
    }
    res.json({ ok: true, ...resultat, ...(await etatPreuve(preuveId)) });
  } catch (e) {
    if (repondreErreurDocument(res, e)) return;
    throw e;
  }
}));

// Détacher un document : le lien seulement, jamais le document ni ses versions.
router.delete("/preuves/:id/documents/:docId", requireAdmin, wrap(async (req, res) => {
  const preuveId = parseIdPositif(req.params.id);
  const documentId = parseIdPositif(req.params.docId);
  if (!preuveId || !documentId) return res.status(400).json({ error: "Identifiant invalide." });
  try {
    const resultat = await transaction((cx) => detacherDocument(cx, { preuveId, documentId }));
    res.json({ ok: true, ...resultat, ...(await etatPreuve(preuveId)) });
  } catch (e) {
    if (repondreErreurDocument(res, e)) return;
    throw e;
  }
}));

// Revalider un lien : la preuve a examiné la version courante du document.
router.post("/preuves/:id/documents/:docId/revalider", requireAdmin, wrap(async (req, res) => {
  const preuveId = parseIdPositif(req.params.id);
  const documentId = parseIdPositif(req.params.docId);
  if (!preuveId || !documentId) return res.status(400).json({ error: "Identifiant invalide." });
  try {
    const resultat = await transaction((cx) => revaliderLien(cx, { preuveId, documentId, utilisateurId: req.user.id }));
    res.json({ ok: true, ...resultat, ...(await etatPreuve(preuveId)) });
  } catch (e) {
    if (repondreErreurDocument(res, e)) return;
    throw e;
  }
}));

// Remplacement manuel d'un document : nouvelle version, contrôle Drive du nouveau fichier.
router.post("/documents/:id/remplacer", requireAdmin, wrap(async (req, res) => {
  const documentId = parseIdPositif(req.params.id);
  if (!documentId) return res.status(400).json({ error: "Identifiant de document invalide." });
  const corps = req.body || {};
  if (!corps.drive_file_id || !String(corps.drive_file_id).trim()) {
    return res.status(400).json({ error: "Fichier Drive obligatoire." });
  }
  const versionAttendue = Number(corps.version_attendue);
  if (!Number.isSafeInteger(versionAttendue) || versionAttendue < 1) {
    return res.status(400).json({ error: "Version attendue invalide." });
  }
  const motif = corps.motif === undefined || corps.motif === null || corps.motif === "" ? null : String(corps.motif).trim() || null;
  try {
    const controle = await precontroleFichier(String(corps.drive_file_id));
    const fichier = fichierDepuisCorps(corps);
    const resultat = await transaction(async (cx) => {
      const r = await remplacerDocument(cx, {
        documentId, fichier, versionAttendue, motif, utilisateurId: req.user.id, controle, origine: "manuel",
      });
      // Les copies de génération affichées dans la session suivent la version courante.
      await cx.query(
        "UPDATE documents_generes SET drive_file_id = $2, drive_url = $3, nom = COALESCE($4, nom) WHERE document_id = $1",
        [documentId, fichier.drive_file_id, fichier.drive_url, fichier.drive_nom]
      );
      return r;
    });
    res.json({ ok: true, ...resultat });
  } catch (e) {
    if (repondreErreurDocument(res, e)) return;
    throw e;
  }
}));

// Liste des documents visibles selon le rôle (règle C2 pour les contributeurs).
router.get("/documents", requireAuth, wrap(async (req, res) => {
  const admin = estAdmin(req.user);
  const { rows } = await query(
    `SELECT d.id, d.drive_nom, d.drive_mime, d.drive_url, d.source, d.confidentiel, d.version_courante, d.archive_le,
            (SELECT count(*)::int FROM preuve_documents pd WHERE pd.document_id = d.id) AS nb_liens
       FROM documents d
      WHERE ${admin ? "TRUE" : predicatVisibleContributeur("d")}
      ORDER BY d.id DESC
      LIMIT 500`
  );
  res.json({ documents: rows });
}));

// Détail d'un document. Un contributeur sans droit reçoit 404 (et non 403).
router.get("/documents/:id", requireAuth, wrap(async (req, res) => {
  const documentId = parseIdPositif(req.params.id);
  if (!documentId) return res.status(400).json({ error: "Identifiant de document invalide." });
  const admin = estAdmin(req.user);
  const { rows: [doc] } = await query(
    `SELECT d.id, d.drive_nom, d.drive_mime, d.drive_url, d.source, d.confidentiel, d.version_courante, d.archive_le
       FROM documents d
      WHERE d.id = $1 AND (${admin ? "TRUE" : predicatVisibleContributeur("d")})`,
    [documentId]
  );
  if (!doc) return res.status(404).json({ error: "Document introuvable." });

  const { rows: liens } = await query(
    `SELECT pd.preuve_id, pd.origine, p.titre, p.statut, i.numero AS indicateur,
            (pd.version_validee < $2) AS en_attente_revalidation
       FROM preuve_documents pd
       JOIN preuves p ON p.id = pd.preuve_id
       JOIN indicateurs i ON i.id = p.indicateur_id
      WHERE pd.document_id = $1${admin ? "" : ` AND ${preuveVisibleContributeur("p")}`}
      ORDER BY pd.preuve_id`,
    [documentId, doc.version_courante]
  );

  const { rows: formations } = await query(
    `SELECT df.formation_id, f.intitule, df.origine, df.valide_le IS NOT NULL AS valide
       FROM document_formations df JOIN formations f ON f.id = df.formation_id
      WHERE df.document_id = $1 ORDER BY df.formation_id`,
    [documentId]
  );
  const corps = { document: doc, liens, formations };
  if (admin) {
    const { rows: versions } = await query(
      `SELECT numero, drive_file_id, drive_url, drive_nom, introduite_le, introduite_par,
              remplacee_le, remplacee_par, motif, corbeille_le
         FROM document_versions WHERE document_id = $1 ORDER BY numero`,
      [documentId]
    );
    corps.versions = versions;
  }
  res.json(corps);
}));

// Archivage (R9) : refusé tant qu'un lien existe. Réversible.
router.post("/documents/:id/archiver", requireAdmin, wrap(async (req, res) => {
  const documentId = parseIdPositif(req.params.id);
  if (!documentId) return res.status(400).json({ error: "Identifiant de document invalide." });
  try {
    res.json({ ok: true, ...(await transaction((cx) => archiverDocument(cx, { documentId }))) });
  } catch (e) {
    if (repondreErreurDocument(res, e)) return;
    throw e;
  }
}));

router.post("/documents/:id/restaurer", requireAdmin, wrap(async (req, res) => {
  const documentId = parseIdPositif(req.params.id);
  if (!documentId) return res.status(400).json({ error: "Identifiant de document invalide." });
  try {
    res.json({ ok: true, ...(await transaction((cx) => restaurerDocument(cx, { documentId }))) });
  } catch (e) {
    if (repondreErreurDocument(res, e)) return;
    throw e;
  }
}));

// Corbeille d'une ancienne version (R5), avec journal : voir services/corbeille.js.
router.post("/documents/:id/versions/:numero/corbeille", requireAdmin, wrap(async (req, res) => {
  const documentId = parseIdPositif(req.params.id);
  const numero = parseIdPositif(req.params.numero);
  if (!documentId || !numero) return res.status(400).json({ error: "Identifiant invalide." });
  if (req.body?.confirmer !== true) {
    return res.status(400).json({ error: "Confirmation explicite requise.", code: "confirmation_requise" });
  }
  try {
    const d = await getDrive();
    const r = await tenterCorbeille({ drive: d?.drive ?? null, documentId, numero, utilisateurId: req.user.id });
    if (r.statut === "confirmee") return res.json({ ok: true, ...r });
    if (r.statut === "en_attente_confirmation") {
      return res.status(202).json({ ok: false, ...r, code: "corbeille_confirmation_en_attente",
        error: "Le fichier est à la corbeille Drive, mais l'enregistrement a échoué : la reprise le terminera." });
    }
    return res.status(503).json({ ok: false, ...r, code: "corbeille_echec",
      error: "La mise à la corbeille Drive n'a pas abouti : rien n'a été modifié, la reprise pourra la relancer." });
  } catch (e) {
    if (repondreErreurDocument(res, e)) return;
    throw e;
  }
}));

// Reprise des opérations de corbeille restées en attente (administrateur).
router.post("/corbeille/reprise", requireAdmin, wrap(async (req, res) => {
  try {
    const d = await getDrive();
    res.json({ ok: true, ...(await reprendreCorbeilles({ drive: d?.drive ?? null })) });
  } catch (e) {
    if (repondreErreurDocument(res, e)) return;
    throw e;
  }
}));

// Opérations non terminées : en attente (reprise automatique) et bloquées (décision requise).
router.get("/corbeille/en-attente", requireAdmin, wrap(async (_req, res) => {
  const { rows } = await query(
    `SELECT id, document_id, numero, drive_file_id, statut, tentatives, motif, derniere_erreur, cree_le, bloquee_le
       FROM corbeille_operations WHERE statut IN ('en_attente', 'bloquee') ORDER BY id`
  );
  res.json({ operations: rows });
}));

// Décisions sur une opération bloquée : relancer (remise en attente) ou abandonner (motif obligatoire).
router.post("/corbeille/operations/:id/relancer", requireAdmin, wrap(async (req, res) => {
  const operationId = parseIdPositif(req.params.id);
  if (!operationId) return res.status(400).json({ error: "Identifiant d'opération invalide." });
  try {
    res.json({ ok: true, ...(await relancerOperation({ operationId })) });
  } catch (e) {
    if (repondreErreurDocument(res, e)) return;
    throw e;
  }
}));

router.post("/corbeille/operations/:id/abandonner", requireAdmin, wrap(async (req, res) => {
  const operationId = parseIdPositif(req.params.id);
  if (!operationId) return res.status(400).json({ error: "Identifiant d'opération invalide." });
  try {
    res.json({ ok: true, ...(await abandonnerOperation({ operationId, motif: (req.body || {}).motif, utilisateurId: req.user.id })) });
  } catch (e) {
    if (repondreErreurDocument(res, e)) return;
    throw e;
  }
}));

// Rattachements formation : manuel, validation humaine d'un dérivé, détachement.
router.post("/documents/:id/formations", requireAdmin, wrap(async (req, res) => {
  const documentId = parseIdPositif(req.params.id);
  const formationId = parseIdPositif((req.body || {}).formation_id);
  if (!documentId || !formationId) return res.status(400).json({ error: "Identifiant invalide." });
  try {
    res.status(201).json({ ok: true, ...(await transaction((cx) => rattacherFormation(cx, { documentId, formationId, utilisateurId: req.user.id }))) });
  } catch (e) {
    if (repondreErreurDocument(res, e)) return;
    throw e;
  }
}));

router.post("/documents/:id/formations/:formationId/valider", requireAdmin, wrap(async (req, res) => {
  const documentId = parseIdPositif(req.params.id);
  const formationId = parseIdPositif(req.params.formationId);
  if (!documentId || !formationId) return res.status(400).json({ error: "Identifiant invalide." });
  try {
    res.json({ ok: true, ...(await transaction((cx) => validerFormation(cx, { documentId, formationId, utilisateurId: req.user.id }))) });
  } catch (e) {
    if (repondreErreurDocument(res, e)) return;
    throw e;
  }
}));

router.delete("/documents/:id/formations/:formationId", requireAdmin, wrap(async (req, res) => {
  const documentId = parseIdPositif(req.params.id);
  const formationId = parseIdPositif(req.params.formationId);
  if (!documentId || !formationId) return res.status(400).json({ error: "Identifiant invalide." });
  try {
    res.json({ ok: true, ...(await transaction((cx) => detacherFormation(cx, { documentId, formationId }))) });
  } catch (e) {
    if (repondreErreurDocument(res, e)) return;
    throw e;
  }
}));

// Documents d'une formation : rattachements explicites ∪ documents liés aux sessions de la formation.
router.get("/formations/:id/documents", requireAuth, wrap(async (req, res) => {
  const formationId = parseIdPositif(req.params.id);
  if (!formationId) return res.status(400).json({ error: "Identifiant de formation invalide." });
  const admin = estAdmin(req.user);
  const { rows } = await query(
    `SELECT d.id, d.drive_nom, d.drive_url, d.source, d.version_courante, d.archive_le
       FROM documents d
      WHERE (d.id IN (SELECT document_id FROM document_formations WHERE formation_id = $1)
             OR d.id IN (SELECT pd.document_id FROM preuve_documents pd
                           JOIN preuves p ON p.id = pd.preuve_id
                           JOIN sessions s ON s.id = p.session_id
                          WHERE s.formation_id = $1))
        AND (${admin ? "TRUE" : predicatVisibleContributeur("d")})
      ORDER BY d.id`,
    [formationId]
  );
  res.json({ documents: rows });
}));

export default router;
