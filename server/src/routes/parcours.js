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
import { lireAdaptation, lireRecueil, lireSuivi } from "../services/parcours.js";

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
              r.positionnement_id, r.mis_a_jour_le,
              -- Q2-2 : comptages seulement (jamais les textes des mesures).
              COALESCE(a.total, 0) AS adaptations_total, COALESCE(a.prevues, 0) AS adaptations_prevues,
              COALESCE(a.mises_en_oeuvre, 0) AS adaptations_mises_en_oeuvre, COALESCE(a.abandonnees, 0) AS adaptations_abandonnees,
              -- Q2-3 : issue et suivi STRUCTURÉS seulement (jamais catégorie, motif ni note).
              i.date_abandon,
              COALESCE(sv.relances, 0) AS relances_total, COALESCE(sv.signaux, 0) AS signaux_total,
              der.type AS dernier_suivi_type, der.categorie AS dernier_suivi_categorie, der.date_evenement AS dernier_suivi_date
       FROM inscriptions i
       JOIN stagiaires s ON s.id = i.stagiaire_id
       LEFT JOIN recueils_besoin r ON r.inscription_id = i.id
       LEFT JOIN (
         SELECT inscription_id, count(*)::int AS total,
                count(*) FILTER (WHERE statut = 'prevue')::int AS prevues,
                count(*) FILTER (WHERE statut = 'mise_en_oeuvre')::int AS mises_en_oeuvre,
                count(*) FILTER (WHERE statut = 'abandonnee')::int AS abandonnees
         FROM adaptations_parcours GROUP BY inscription_id
       ) a ON a.inscription_id = i.id
       LEFT JOIN (
         SELECT inscription_id, count(*) FILTER (WHERE type = 'relance')::int AS relances,
                count(*) FILTER (WHERE type = 'signal')::int AS signaux
         FROM suivis_inscription GROUP BY inscription_id
       ) sv ON sv.inscription_id = i.id
       LEFT JOIN (
         SELECT DISTINCT ON (inscription_id) inscription_id, type, categorie, date_evenement
         FROM suivis_inscription ORDER BY inscription_id, date_evenement DESC, id DESC
       ) der ON der.inscription_id = i.id
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

// ── Q2-2 : adaptations pédagogiques (mesures opérationnelles) ──────
// Droits = inscriptions : lecture authentifiée, écriture admin + contributeur.
// Réponses : la mesure et son suivi SEULEMENT — jamais situation_handicap,
// besoins_adaptation historique ni autre donnée personnelle. Aucune
// suppression physique ; une écriture refusée n'écrit rien.
const COLONNES_ADAPTATION = `a.id, a.inscription_id, a.categorie, a.mesure, a.statut, a.date_decision,
  a.date_mise_en_oeuvre, a.bilan, a.cree_le, a.mis_a_jour_le, uc.nom AS cree_par_nom, um.nom AS mis_a_jour_par_nom`;
const LIRE_ADAPTATIONS = `SELECT ${COLONNES_ADAPTATION}
  FROM adaptations_parcours a
  LEFT JOIN utilisateurs uc ON uc.id = a.cree_par
  LEFT JOIN utilisateurs um ON um.id = a.mis_a_jour_par`;

router.get("/inscriptions/:id/adaptations", requireAuth, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'inscription invalide." });
  const insc = await inscriptionAvecSession(id);
  if (!insc) return res.status(404).json({ error: "Inscription introuvable." });
  const { rows } = await query(`${LIRE_ADAPTATIONS} WHERE a.inscription_id = $1 ORDER BY a.date_decision, a.id`, [id]);
  res.json({ adaptations: rows, archivee: !!insc.archivee_le });
}));

router.post("/inscriptions/:id/adaptations", requireRedacteur, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'inscription invalide." });
  const { champs, erreur } = lireAdaptation(req.body || {});
  if (erreur) return res.status(400).json({ error: erreur });
  const insc = await inscriptionAvecSession(id);
  if (!insc) return res.status(404).json({ error: "Inscription introuvable." });
  if (insc.archivee_le) return res.status(409).json({ error: MSG_ARCHIVEE });
  const { rows: [cree] } = await query(
    `INSERT INTO adaptations_parcours (inscription_id, categorie, mesure, statut, date_decision, date_mise_en_oeuvre, bilan, cree_par, mis_a_jour_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
    [id, champs.categorie, champs.mesure, champs.statut, champs.date_decision, champs.date_mise_en_oeuvre, champs.bilan, req.user.id]
  );
  const { rows: [a] } = await query(`${LIRE_ADAPTATIONS} WHERE a.id = $1`, [cree.id]);
  res.status(201).json({ adaptation: a });
}));

// Modification partielle : l'état FINAL (avant + corps) est validé, puis
// écrit en une seule instruction. L'adaptation doit appartenir à CETTE
// inscription (sinon 404, sans rien révéler).
router.patch("/inscriptions/:id/adaptations/:adaptationId", requireRedacteur, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  const adaptationId = parseIdPositif(req.params.adaptationId);
  if (!id || !adaptationId) return res.status(400).json({ error: "Identifiant invalide." });
  const insc = await inscriptionAvecSession(id);
  if (!insc) return res.status(404).json({ error: "Inscription introuvable." });
  if (insc.archivee_le) return res.status(409).json({ error: MSG_ARCHIVEE });
  const { rows: [avant] } = await query(
    "SELECT categorie, mesure, statut, date_decision, date_mise_en_oeuvre, bilan FROM adaptations_parcours WHERE id = $1 AND inscription_id = $2",
    [adaptationId, id]
  );
  if (!avant) return res.status(404).json({ error: "Adaptation introuvable pour cette inscription." });
  const { champs, erreur } = lireAdaptation(req.body || {}, avant);
  if (erreur) return res.status(400).json({ error: erreur });
  await query(
    `UPDATE adaptations_parcours SET categorie = $3, mesure = $4, statut = $5, date_decision = $6,
       date_mise_en_oeuvre = $7, bilan = $8, mis_a_jour_par = $9, mis_a_jour_le = now()
     WHERE id = $1 AND inscription_id = $2`,
    [adaptationId, id, champs.categorie, champs.mesure, champs.statut, champs.date_decision, champs.date_mise_en_oeuvre, champs.bilan, req.user.id]
  );
  const { rows: [a] } = await query(`${LIRE_ADAPTATIONS} WHERE a.id = $1`, [adaptationId]);
  res.json({ adaptation: a });
}));

// ── Q2-3 : suivi factuel du décrochage (signaux et relances) ───────
// Droits = inscriptions : lecture authentifiée, écriture admin + contributeur.
// Espace de suivi INDIVIDUEL : seul endroit où le motif d'abandon et les
// notes sont renvoyés. Jamais situation_handicap ni besoins_adaptation.
// Aucune suppression physique, aucune notification, aucun signalement
// Qualité automatique.
const LIRE_SUIVIS = `SELECT e.id, e.inscription_id, e.type, e.date_evenement, e.categorie, e.canal, e.note,
    e.cree_le, e.mis_a_jour_le, uc.nom AS cree_par_nom, um.nom AS mis_a_jour_par_nom
  FROM suivis_inscription e
  LEFT JOIN utilisateurs uc ON uc.id = e.cree_par
  LEFT JOIN utilisateurs um ON um.id = e.mis_a_jour_par`;

router.get("/inscriptions/:id/suivi", requireAuth, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'inscription invalide." });
  const { rows: [insc] } = await query(
    `SELECT i.id AS inscription_id, i.statut, i.date_abandon, i.categorie_abandon, i.motif_abandon, s.archivee_le
     FROM inscriptions i JOIN sessions s ON s.id = i.session_id WHERE i.id = $1`, [id]);
  if (!insc) return res.status(404).json({ error: "Inscription introuvable." });
  const { rows } = await query(`${LIRE_SUIVIS} WHERE e.inscription_id = $1 ORDER BY e.date_evenement DESC, e.id DESC`, [id]);
  const { archivee_le, ...inscription } = insc;
  res.json({ inscription, evenements: rows, archivee: !!archivee_le });
}));

router.post("/inscriptions/:id/suivi", requireRedacteur, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'inscription invalide." });
  const { champs, erreur } = lireSuivi(req.body || {});
  if (erreur) return res.status(400).json({ error: erreur });
  const insc = await inscriptionAvecSession(id);
  if (!insc) return res.status(404).json({ error: "Inscription introuvable." });
  if (insc.archivee_le) return res.status(409).json({ error: MSG_ARCHIVEE });
  const { rows: [cree] } = await query(
    `INSERT INTO suivis_inscription (inscription_id, type, date_evenement, categorie, canal, note, cree_par, mis_a_jour_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
    [id, champs.type, champs.date_evenement, champs.categorie, champs.canal, champs.note, req.user.id]
  );
  const { rows: [e] } = await query(`${LIRE_SUIVIS} WHERE e.id = $1`, [cree.id]);
  res.status(201).json({ evenement: e });
}));

// Correction d'un événement (rectification) : état final validé, une seule
// écriture ; l'événement doit appartenir à CETTE inscription (sinon 404).
router.patch("/inscriptions/:id/suivi/:evenementId", requireRedacteur, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  const evenementId = parseIdPositif(req.params.evenementId);
  if (!id || !evenementId) return res.status(400).json({ error: "Identifiant invalide." });
  const insc = await inscriptionAvecSession(id);
  if (!insc) return res.status(404).json({ error: "Inscription introuvable." });
  if (insc.archivee_le) return res.status(409).json({ error: MSG_ARCHIVEE });
  const { rows: [avant] } = await query(
    "SELECT type, date_evenement, categorie, canal, note FROM suivis_inscription WHERE id = $1 AND inscription_id = $2",
    [evenementId, id]
  );
  if (!avant) return res.status(404).json({ error: "Événement de suivi introuvable pour cette inscription." });
  const { champs, erreur } = lireSuivi(req.body || {}, avant);
  if (erreur) return res.status(400).json({ error: erreur });
  await query(
    `UPDATE suivis_inscription SET date_evenement = $3, categorie = $4, canal = $5, note = $6,
       mis_a_jour_par = $7, mis_a_jour_le = now()
     WHERE id = $1 AND inscription_id = $2`,
    [evenementId, id, champs.date_evenement, champs.categorie, champs.canal, champs.note, req.user.id]
  );
  const { rows: [e] } = await query(`${LIRE_SUIVIS} WHERE e.id = $1`, [evenementId]);
  res.json({ evenement: e });
}));

export default router;
