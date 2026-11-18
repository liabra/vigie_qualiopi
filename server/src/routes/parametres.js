// Paramètres de l'organisme et signataires (administrateur uniquement).
// Les valeurs alimentent les variables {{organisme_*}} et {{signataire_*}} des documents générés.
import { Router } from "express";
import { query } from "../db.js";
import { requireAdmin } from "../session.js";
import { parseIdPositif } from "../services/ids.js";
import { CHAMPS_ORGANISME, validerOrganisme, validerSignataire } from "../services/parametresOrganisme.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const COLONNES_ORGANISME = CHAMPS_ORGANISME.join(", ");

router.get("/parametres/organisme", requireAdmin, wrap(async (_req, res) => {
  const { rows: [p] } = await query(`SELECT ${COLONNES_ORGANISME}, mis_a_jour_le FROM parametres_organisme WHERE id = 1`);
  res.json({ organisme: p || {} });
}));

router.put("/parametres/organisme", requireAdmin, wrap(async (req, res) => {
  const v = validerOrganisme(req.body);
  if (v.erreur) return res.status(400).json({ error: v.erreur });
  const colonnes = Object.keys(v.valeur);
  const affectations = colonnes.map((c, i) => `${c} = $${i + 2}`).join(", ");
  const { rows: [p] } = await query(
    `UPDATE parametres_organisme SET ${affectations}, mis_a_jour_le = now(), mis_a_jour_par = $1 WHERE id = 1
     RETURNING ${COLONNES_ORGANISME}, mis_a_jour_le`,
    [req.user.id, ...colonnes.map((c) => v.valeur[c])]
  );
  res.json({ ok: true, organisme: p });
}));

router.get("/signataires", requireAdmin, wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT id, nom, fonction, actif FROM signataires ${req.query.inactifs === "1" ? "" : "WHERE actif"} ORDER BY actif DESC, nom, id`
  );
  res.json({ signataires: rows, total: rows.length });
}));

router.post("/signataires", requireAdmin, wrap(async (req, res) => {
  const v = validerSignataire(req.body, { complet: true });
  if (v.erreur) return res.status(400).json({ error: v.erreur });
  try {
    const { rows: [s] } = await query(
      "INSERT INTO signataires (nom, fonction) VALUES ($1, $2) RETURNING id, nom, fonction, actif", [v.valeur.nom, v.valeur.fonction]
    );
    res.status(201).json({ signataire: s });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Ce signataire existe déjà avec cette fonction." });
    throw e;
  }
}));

router.patch("/signataires/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de signataire invalide." });
  const v = validerSignataire(req.body, { complet: false });
  if (v.erreur) return res.status(400).json({ error: v.erreur });
  // Désactiver un signataire encore choisi par un modèle actif laisserait des documents sans signataire.
  if (v.valeur.actif === false) {
    const { rows: utilises } = await query(
      "SELECT nom FROM modeles_documents WHERE signataire_id = $1 AND actif ORDER BY nom", [id]
    );
    if (utilises.length) {
      return res.status(409).json({
        error: `Ce signataire est utilisé par : ${utilises.map((m) => m.nom).join(", ")}. Changez leur signataire d'abord.`,
        code: "signataire_utilise",
      });
    }
  }
  const colonnes = Object.keys(v.valeur);
  const affectations = colonnes.map((c, i) => `${c} = $${i + 2}`).join(", ");
  try {
    const { rows: [s] } = await query(
      `UPDATE signataires SET ${affectations}, updated_at = now() WHERE id = $1 RETURNING id, nom, fonction, actif`,
      [id, ...colonnes.map((c) => v.valeur[c])]
    );
    if (!s) return res.status(404).json({ error: "Signataire introuvable." });
    res.json({ ok: true, signataire: s });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Un signataire actif porte déjà ce nom et cette fonction." });
    throw e;
  }
}));

export default router;
