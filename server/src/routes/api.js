import { Router } from "express";
import { config, googleConfigured } from "../config.js";
import { query } from "../db.js";
import { requireAdmin, requireAuth } from "../session.js";
import { disconnectDrive, driveStatus, getDrive } from "../services/google.js";
import { importerClasseur } from "../services/import.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Statut agrégé d'un indicateur, à partir de ses preuves :
//   vert  — toutes maîtrisées
//   orange— au moins une à consolider, aucune à risque
//   rouge — au moins une à risque, ou aucune preuve
//   gris  — toutes non applicables
// Les preuves non applicables sont neutres : elles ne dégradent ni
// n'améliorent un indicateur qui en a d'autres.
const STATUT_SQL = `
  CASE
    WHEN count(p.id) = 0 THEN 'a_risque'
    WHEN count(p.id) FILTER (WHERE p.statut <> 'non_applicable') = 0 THEN 'non_applicable'
    WHEN count(p.id) FILTER (WHERE p.statut = 'a_risque') > 0 THEN 'a_risque'
    WHEN count(p.id) FILTER (WHERE p.statut = 'a_consolider') > 0 THEN 'a_consolider'
    ELSE 'maitrise'
  END`;

router.get("/health", wrap(async (_req, res) => {
  await query("SELECT 1");
  res.json({ ok: true });
}));

router.get("/me", (req, res) => {
  res.json({ user: req.user, googleConfigured: googleConfigured(), driveAccountEmail: config.driveAccountEmail });
});

// Référentiel actif + tableau de bord de conformité.
router.get("/referentiel", requireAuth, wrap(async (_req, res) => {
  const { rows: [version] } = await query(
    "SELECT id, code, libelle, date_publication, date_application, source, note FROM referentiel_versions WHERE est_active"
  );
  if (!version) return res.status(404).json({ error: "Aucun référentiel actif en base." });
  const [{ rows: criteres }, { rows: indicateurs }] = await Promise.all([
    query("SELECT id, numero, libelle FROM criteres WHERE version_id = $1 ORDER BY numero", [version.id]),
    query(
      `SELECT i.id, i.critere_id, i.numero, i.libelle, i.type, i.categories, i.gradation, i.texte_source_verifie,
              count(p.id)::int AS nb_preuves,
              count(p.id) FILTER (WHERE p.a_confirmer)::int AS nb_a_confirmer,
              count(p.id) FILTER (WHERE p.statut = 'maitrise')::int AS nb_maitrise,
              count(p.id) FILTER (WHERE p.statut = 'a_consolider')::int AS nb_a_consolider,
              count(p.id) FILTER (WHERE p.statut = 'a_risque')::int AS nb_a_risque,
              count(p.id) FILTER (WHERE p.statut = 'non_applicable')::int AS nb_non_applicable,
              ${STATUT_SQL} AS statut
       FROM indicateurs i
       LEFT JOIN preuves p ON p.indicateur_id = i.id
       WHERE i.version_id = $1
       GROUP BY i.id ORDER BY i.numero`,
      [version.id]
    ),
  ]);
  const parStatut = indicateurs.reduce((a, i) => ({ ...a, [i.statut]: (a[i.statut] || 0) + 1 }), {});
  res.json({
    version,
    totalIndicateurs: indicateurs.length,
    score: {
      total: indicateurs.length,
      maitrise: parStatut.maitrise || 0,
      a_consolider: parStatut.a_consolider || 0,
      a_risque: parStatut.a_risque || 0,
      non_applicable: parStatut.non_applicable || 0,
      preuves: indicateurs.reduce((n, i) => n + i.nb_preuves, 0),
      a_confirmer: indicateurs.reduce((n, i) => n + i.nb_a_confirmer, 0),
    },
    criteres: criteres.map((c) => ({ ...c, indicateurs: indicateurs.filter((i) => i.critere_id === c.id) })),
  });
}));

// ── Preuves ──────────────────────────────────────────────────
const STATUTS = ["maitrise", "a_consolider", "a_risque", "non_applicable"];

router.get("/preuves", requireAuth, wrap(async (req, res) => {
  const filtres = ["1 = 1"];
  const params = [];
  if (req.query.statut && STATUTS.includes(req.query.statut)) { params.push(req.query.statut); filtres.push(`p.statut = $${params.length}`); }
  if (req.query.indicateur) { params.push(Number(req.query.indicateur)); filtres.push(`i.numero = $${params.length}`); }
  if (req.query.a_confirmer === "1") filtres.push("p.a_confirmer");
  if (req.query.q) { params.push(`%${req.query.q}%`); filtres.push(`p.titre ILIKE $${params.length}`); }
  const { rows } = await query(
    `SELECT p.id, p.titre, p.statut, p.a_confirmer, p.motif_confirmation, p.candidats, p.drive_file_id,
            p.drive_url, p.drive_nom, p.modele_nom, p.tache, p.etat_source, p.occurrences, p.lignes_source,
            p.source, p.validee_le, i.numero AS indicateur, c.numero AS critere
     FROM preuves p
     JOIN indicateurs i ON i.id = p.indicateur_id
     JOIN criteres c ON c.id = i.critere_id
     JOIN referentiel_versions v ON v.id = i.version_id AND v.est_active
     WHERE ${filtres.join(" AND ")}
     ORDER BY p.a_confirmer DESC, i.numero, p.titre
     LIMIT 1000`,
    params
  );
  res.json({ preuves: rows, total: rows.length });
}));

// Correction du rattachement, en un appel : l'admin choisit un candidat
// (ou colle un identifiant Drive), ajuste le statut, ou déclare la preuve
// confirmée telle quelle.
router.patch("/preuves/:id", requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { statut, drive_file_id, drive_url, drive_nom, confirmer } = req.body || {};
  if (statut !== undefined && !STATUTS.includes(statut)) return res.status(400).json({ error: "Statut inconnu." });
  const sets = [];
  const params = [id];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (statut !== undefined) {
    set("statut", statut);
  } else if (confirmer) {
    // Confirmer une preuve « à risque » la fait passer à « maîtrisé ». Si
    // l'admin a lui-même choisi un statut dans ce même appel, la branche
    // du dessus s'applique à la place ; un changement manuel ultérieur est
    // un appel séparé et l'emporte toujours de la même façon.
    sets.push("statut = CASE WHEN statut = 'a_risque' THEN 'maitrise' ELSE statut END");
  }
  if (drive_file_id !== undefined) {
    set("drive_file_id", drive_file_id || null);
    set("drive_url", drive_url || (drive_file_id ? `https://drive.google.com/file/d/${drive_file_id}/view` : null));
    set("drive_nom", drive_nom || null);
  }
  if (confirmer) {
    sets.push("a_confirmer = false", "motif_confirmation = NULL", "validee_le = now()");
    params.push(req.user.id); sets.push(`validee_par = $${params.length}`);
  }
  if (!sets.length) return res.status(400).json({ error: "Rien à modifier." });
  const { rows } = await query(`UPDATE preuves SET ${sets.join(", ")} WHERE id = $1 RETURNING id, statut`, params);
  if (!rows.length) return res.status(404).json({ error: "Preuve introuvable." });
  res.json({ ok: true, statut: rows[0].statut });
}));

// Changement de statut groupé : une sélection de preuves, un seul appel.
router.patch("/preuves", requireAdmin, wrap(async (req, res) => {
  const { ids, statut } = req.body || {};
  if (!STATUTS.includes(statut)) return res.status(400).json({ error: "Statut inconnu." });
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "Aucune preuve sélectionnée." });
  const propres = [...new Set(ids.map(Number))].filter((n) => Number.isInteger(n) && n > 0);
  if (!propres.length) return res.status(400).json({ error: "Identifiants de preuve invalides." });
  if (propres.length > 500) return res.status(400).json({ error: "500 preuves au maximum par changement groupé." });
  const { rowCount } = await query("UPDATE preuves SET statut = $1 WHERE id = ANY($2::int[])", [statut, propres]);
  res.json({ ok: true, misAJour: rowCount });
}));

router.delete("/preuves/:id", requireAdmin, wrap(async (req, res) => {
  const { rowCount } = await query("DELETE FROM preuves WHERE id = $1", [Number(req.params.id)]);
  if (!rowCount) return res.status(404).json({ error: "Preuve introuvable." });
  res.json({ ok: true });
}));

// ── Import du classeur ───────────────────────────────────────
router.post("/import/classeur", requireAdmin, wrap(async (req, res) => {
  const { fichierId = null, onglet = null, apercu = false } = req.body || {};
  try {
    const r = await importerClasseur({ fichierId, onglet, apercu: apercu === true, utilisateurId: req.user.id });
    res.json(r);
  } catch (e) {
    // `error` est le message lisible ; `diagnostic` porte la réponse brute de
    // Google (code, statut, corps JSON), lisible directement dans l'onglet
    // Réseau du navigateur. Les jetons en sont retirés.
    res.status(400).json({ error: e.message, entetes: e.entetes, diagnostic: e.diagnostic || null });
  }
}));

router.get("/import/dernier", requireAdmin, wrap(async (_req, res) => {
  const { rows } = await query(
    `SELECT i.*, u.email AS lance_par_email FROM imports_drive i
     LEFT JOIN utilisateurs u ON u.id = i.lance_par
     ORDER BY i.demarre_le DESC LIMIT 1`
  );
  res.json({ import: rows[0] || null });
}));

// Recherche Drive pour rattacher une preuve à la main.
router.get("/drive/recherche", requireAdmin, wrap(async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 3) return res.status(400).json({ error: "Recherche trop courte." });
  const d = await getDrive();
  if (!d) return res.status(400).json({ error: "Drive non connecté." });
  const { data } = await d.drive.files.list({
    q: `name contains '${q.replace(/'/g, "\\'")}' and trashed = false`,
    fields: "files(id,name,mimeType,webViewLink,modifiedTime)", pageSize: 20, orderBy: "modifiedTime desc",
    supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  res.json({ fichiers: (data.files || []).map((f) => ({ id: f.id, nom: f.name, url: f.webViewLink, mime: f.mimeType })) });
}));

router.get("/drive/status", requireAdmin, wrap(async (_req, res) => res.json(await driveStatus())));

router.post("/drive/disconnect", requireAdmin, wrap(async (_req, res) => {
  await disconnectDrive();
  res.json({ ok: true });
}));

router.use((_req, res) => res.status(404).json({ error: "Route inconnue." }));

export default router;
