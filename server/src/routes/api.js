import { Router } from "express";
import { config, googleConfigured } from "../config.js";
import { query } from "../db.js";
import { requireAdmin, requireAuth } from "../session.js";
import { disconnectDrive, driveStatus } from "../services/google.js";

const router = Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/health", wrap(async (_req, res) => {
  await query("SELECT 1");
  res.json({ ok: true });
}));

router.get("/me", (req, res) => {
  res.json({ user: req.user, googleConfigured: googleConfigured(), driveAccountEmail: config.driveAccountEmail });
});

// Référentiel actif, regroupé par critère.
router.get("/referentiel", requireAuth, wrap(async (_req, res) => {
  const { rows: [version] } = await query(
    "SELECT id, code, libelle, date_publication, date_application, source, note FROM referentiel_versions WHERE est_active"
  );
  if (!version) return res.status(404).json({ error: "Aucun référentiel actif en base." });
  const [{ rows: criteres }, { rows: indicateurs }] = await Promise.all([
    query("SELECT id, numero, libelle FROM criteres WHERE version_id = $1 ORDER BY numero", [version.id]),
    query(
      `SELECT id, critere_id, numero, libelle, type, categories, gradation, texte_source_verifie
       FROM indicateurs WHERE version_id = $1 ORDER BY numero`,
      [version.id]
    ),
  ]);
  res.json({
    version,
    totalIndicateurs: indicateurs.length,
    criteres: criteres.map((c) => ({ ...c, indicateurs: indicateurs.filter((i) => i.critere_id === c.id) })),
  });
}));

router.get("/drive/status", requireAdmin, wrap(async (_req, res) => res.json(await driveStatus())));

router.post("/drive/disconnect", requireAdmin, wrap(async (_req, res) => {
  await disconnectDrive();
  res.json({ ok: true });
}));

router.use((_req, res) => res.status(404).json({ error: "Route inconnue." }));

export default router;
