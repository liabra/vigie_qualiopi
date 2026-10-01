// ─────────────────────────────────────────────────────────────
//  Q2-1 — Parcours bénéficiaire : recueil du besoin et positionnement.
//
//  Droits = ceux de la gestion des inscriptions : lecture pour tout
//  utilisateur connecté, écriture admin + contributeur (requireRedacteur).
//  Session archivée : lecture seule (409 en écriture).
//  Les textes libres ne sont jamais journalisés ni recopiés ailleurs
//  (aucun historique, aucun marqueur documentaire).
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRedacteur } from "../session.js";
import { parseIdPositif } from "../services/ids.js";
import { MSG_ARCHIVEE } from "../services/archive.js";
import { lireRecueil } from "../services/parcours.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const COLONNES_POSITIONNEMENT = "e.id, e.inscription_id, e.intitule, e.date_passage, e.score, e.score_max, e.resultat";

// Vue agrégée d'une session : une ligne par inscription, ÉTAT du recueil
// seulement (jamais les textes libres). Trois requêtes, aucun N+1.
router.get("/sessions/:id/parcours", requireAuth, wrap(async (req, res) => {
  const sessionId = parseIdPositif(req.params.id);
  if (!sessionId) return res.status(400).json({ error: "Identifiant de session invalide." });
  const { rows: [session] } = await query("SELECT id, archivee_le FROM sessions WHERE id = $1", [sessionId]);
  if (!session) return res.status(404).json({ error: "Session introuvable." });
  const [{ rows: inscriptions }, { rows: positionnements }] = await Promise.all([
    query(
      `SELECT i.id AS inscription_id, i.statut AS statut_inscription, s.nom, s.prenom,
              r.statut AS recueil_statut, r.date_recueil, r.conclusion, r.prerequis_verifies,
              r.positionnement_id, r.mis_a_jour_le
       FROM inscriptions i
       JOIN stagiaires s ON s.id = i.stagiaire_id
       LEFT JOIN recueils_besoin r ON r.inscription_id = i.id
       WHERE i.session_id = $1
       ORDER BY s.nom, s.prenom, i.id`, [sessionId]),
    query(
      `SELECT ${COLONNES_POSITIONNEMENT}
       FROM resultats_qcm e JOIN inscriptions i ON i.id = e.inscription_id AND i.session_id = $1
       WHERE e.type = 'positionnement'
       ORDER BY e.date_passage DESC, e.id DESC`, [sessionId]),
  ]);
  res.json({ archivee: !!session.archivee_le, inscriptions, positionnements });
}));

async function inscriptionAvecSession(id) {
  const { rows: [i] } = await query(
    `SELECT i.id, s.archivee_le FROM inscriptions i JOIN sessions s ON s.id = i.session_id WHERE i.id = $1`, [id]);
  return i || null;
}

// Recueil d'une inscription (avec ses textes) + positionnements
// sélectionnables : UNIQUEMENT ceux de cette inscription.
router.get("/inscriptions/:id/recueil", requireAuth, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'inscription invalide." });
  const insc = await inscriptionAvecSession(id);
  if (!insc) return res.status(404).json({ error: "Inscription introuvable." });
  const [{ rows: [recueil] }, { rows: positionnements }] = await Promise.all([
    query(
      `SELECT inscription_id, statut, date_recueil, attentes, objectifs_personnels, prerequis_verifies, conclusion,
              positionnement_id, mis_a_jour_le, u.nom AS realise_par_nom
       FROM recueils_besoin r LEFT JOIN utilisateurs u ON u.id = r.realise_par WHERE r.inscription_id = $1`, [id]),
    query(`SELECT ${COLONNES_POSITIONNEMENT} FROM resultats_qcm e WHERE e.inscription_id = $1 AND e.type = 'positionnement'
           ORDER BY e.date_passage DESC, e.id DESC`, [id]),
  ]);
  res.json({ recueil: recueil || null, positionnements, archivee: !!insc.archivee_le });
}));

// Création / mise à jour (état complet voulu). Le positionnement doit
// exister, être de type « positionnement » et appartenir à CETTE inscription.
router.put("/inscriptions/:id/recueil", requireRedacteur, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'inscription invalide." });
  const { champs, erreur } = lireRecueil(req.body || {});
  if (erreur) return res.status(400).json({ error: erreur });
  const insc = await inscriptionAvecSession(id);
  if (!insc) return res.status(404).json({ error: "Inscription introuvable." });
  if (insc.archivee_le) return res.status(409).json({ error: MSG_ARCHIVEE });
  if (champs.positionnement_id !== null) {
    const { rows: [p] } = await query("SELECT inscription_id, type FROM resultats_qcm WHERE id = $1", [champs.positionnement_id]);
    if (!p) return res.status(400).json({ error: "Positionnement introuvable." });
    if (p.type !== "positionnement") return res.status(400).json({ error: "Ce résultat n'est pas un positionnement." });
    if (p.inscription_id !== id) return res.status(400).json({ error: "Ce positionnement concerne une autre inscription." });
  }
  const realisePar = champs.statut === "realise" ? req.user.id : null;
  const { rows: [r] } = await query(
    `INSERT INTO recueils_besoin (inscription_id, statut, date_recueil, attentes, objectifs_personnels,
                                  prerequis_verifies, conclusion, positionnement_id, realise_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (inscription_id) DO UPDATE SET
       statut = EXCLUDED.statut, date_recueil = EXCLUDED.date_recueil, attentes = EXCLUDED.attentes,
       objectifs_personnels = EXCLUDED.objectifs_personnels, prerequis_verifies = EXCLUDED.prerequis_verifies,
       conclusion = EXCLUDED.conclusion, positionnement_id = EXCLUDED.positionnement_id,
       realise_par = CASE WHEN EXCLUDED.statut = 'realise' THEN COALESCE(recueils_besoin.realise_par, EXCLUDED.realise_par) ELSE NULL END,
       mis_a_jour_le = now()
     RETURNING inscription_id, statut, date_recueil, attentes, objectifs_personnels, prerequis_verifies, conclusion,
               positionnement_id, mis_a_jour_le`,
    [id, champs.statut, champs.date_recueil, champs.attentes, champs.objectifs_personnels,
     champs.prerequis_verifies, champs.conclusion, champs.positionnement_id, realisePar]
  );
  res.json({ recueil: r });
}));

export default router;
