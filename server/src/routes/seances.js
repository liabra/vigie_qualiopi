// ─────────────────────────────────────────────────────────────
//  DOC-7B — Séances et suivi pédagogique individuel (Livret).
//
//  Droits alignés sur les absences/évaluations : lecture pour tout
//  utilisateur connecté, écriture admin + contributeur (requireRedacteur).
//  Session archivée : lecture seule (409 en écriture).
//  Les champs individuels (accompagnement, difficultés, impressions,
//  observations) sont des TEXTES LIBRES de sensibilité « personnelle » :
//  jamais journalisés, jamais recopiés ailleurs automatiquement.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { query } from "../db.js";
import { requireAuth, requireRedacteur } from "../session.js";
import { parseIdPositif } from "../services/ids.js";
import { estDateValide } from "../services/dates.js";
import { MSG_ARCHIVEE } from "../services/archive.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const manque = (res, champ) => res.status(400).json({ error: `Champ obligatoire : ${champ}.` });

const MAX_TEXTE = 2000;
const HEURE = /^\d{2}:\d{2}(:\d{2})?$/;

// null : facultatif/effacé ; undefined : refusé (hors règles).
function lirePhaseNumero(v) {
  if (v === undefined || v === null || v === "") return null;
  if (!Number.isInteger(v) || v <= 0) return undefined;
  return v;
}

function lireHeure(v) {
  if (v === undefined || v === null || v === "") return null;
  const t = String(v).trim();
  if (!HEURE.test(t)) return undefined;
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  if (h > 23 || m > 59) return undefined;
  return t.slice(0, 5);
}

function lireCompetences(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return undefined;
  const liste = v.map((c) => String(c).trim()).filter(Boolean);
  return liste;
}

function lireTexte(v) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  if (t.length > MAX_TEXTE) return undefined;
  return t || null;
}

function lireTexteCourt(v, max) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  if (t.length > max) return undefined;
  return t || null;
}

// Une séance avec sa session (archivage) et son groupe éventuel.
async function seanceAvecSession(id) {
  const { rows: [s] } = await query(
    `SELECT s.id, s.session_id, s.groupe_id, s.phase_numero, s.date_seance, s.heure_debut, s.heure_fin,
            s.theme, s.competences, s.activites, s.lieu, se.archivee_le, se.id AS session_id
     FROM seances s JOIN sessions se ON se.id = s.session_id
     WHERE s.id = $1`, [id]);
  return s || null;
}

const COLONNES_SEANCE = "s.id, s.groupe_id, g.nom AS groupe_nom, s.phase_numero, s.date_seance, s.heure_debut, s.heure_fin, s.theme, s.competences, s.activites, s.lieu";

// Séances d'une session (éventuellement filtrées par groupe), dans l'ordre :
// date_seance, puis heure_debut, puis id.
router.get("/sessions/:id/seances", requireAuth, wrap(async (req, res) => {
  const sessionId = parseIdPositif(req.params.id);
  if (!sessionId) return res.status(400).json({ error: "Identifiant de session invalide." });
  const groupeId = req.query.groupe_id !== undefined ? parseIdPositif(req.query.groupe_id) : null;
  if (req.query.groupe_id !== undefined && !groupeId) return res.status(400).json({ error: "Identifiant de groupe invalide." });

  const { rows: [session] } = await query("SELECT id, archivee_le FROM sessions WHERE id = $1", [sessionId]);
  if (!session) return res.status(404).json({ error: "Session introuvable." });

  const { rows } = await query(
    `SELECT ${COLONNES_SEANCE}
     FROM seances s LEFT JOIN groupes g ON g.id = s.groupe_id
     WHERE s.session_id = $1
       AND ($2::int IS NULL OR s.groupe_id = $2 OR s.groupe_id IS NULL)
     ORDER BY s.date_seance, s.heure_debut, s.id`,
    [sessionId, groupeId]
  );
  res.json({ seances: rows, archivee: !!session.archivee_le });
}));

// Créer une séance. Le groupe, s'il est fourni, doit appartenir à la session.
router.post("/sessions/:id/seances", requireRedacteur, wrap(async (req, res) => {
  const sessionId = parseIdPositif(req.params.id);
  if (!sessionId) return res.status(400).json({ error: "Identifiant de session invalide." });
  const corps = req.body || {};

  const { rows: [session] } = await query("SELECT id, archivee_le FROM sessions WHERE id = $1", [sessionId]);
  if (!session) return res.status(404).json({ error: "Session introuvable." });
  if (session.archivee_le) return res.status(409).json({ error: MSG_ARCHIVEE });

  const groupeId = corps.groupe_id !== undefined && corps.groupe_id !== null ? parseIdPositif(corps.groupe_id) : null;
  if (corps.groupe_id !== undefined && corps.groupe_id !== null && !groupeId) {
    return res.status(400).json({ error: "Identifiant de groupe invalide." });
  }
  if (groupeId) {
    const { rows: [g] } = await query("SELECT id FROM groupes WHERE id = $1 AND session_id = $2", [groupeId, sessionId]);
    if (!g) return res.status(400).json({ error: "Ce groupe n'appartient pas à cette session." });
  }

  const phaseNumero = lirePhaseNumero(corps.phase_numero);
  if (phaseNumero === undefined) return res.status(400).json({ error: "Le numéro de phase doit être un entier positif." });
  if (!corps.date_seance) return manque(res, "date_seance");
  if (!estDateValide(corps.date_seance)) return res.status(400).json({ error: "Date de séance invalide : format attendu AAAA-MM-JJ." });
  const heureDebut = lireHeure(corps.heure_debut);
  if (heureDebut === undefined) return res.status(400).json({ error: "Heure de début invalide : format attendu HH:MM." });
  const heureFin = lireHeure(corps.heure_fin);
  if (heureFin === undefined) return res.status(400).json({ error: "Heure de fin invalide : format attendu HH:MM." });
  if (heureDebut && heureFin && heureFin <= heureDebut) {
    return res.status(400).json({ error: "L'heure de fin doit être postérieure à l'heure de début." });
  }
  const competences = lireCompetences(corps.competences);
  if (competences === undefined) return res.status(400).json({ error: "Les compétences doivent être une liste de textes." });
  const theme = lireTexteCourt(corps.theme, 500);
  if (theme === undefined) return res.status(400).json({ error: "Thème trop long : 500 caractères au maximum." });
  const activites = lireTexte(corps.activites);
  if (activites === undefined) return res.status(400).json({ error: "Activités trop longues : 2000 caractères au maximum." });
  const lieu = lireTexteCourt(corps.lieu, 200);
  if (lieu === undefined) return res.status(400).json({ error: "Lieu trop long : 200 caractères au maximum." });

  const { rows: [seance] } = await query(
    `INSERT INTO seances (session_id, groupe_id, phase_numero, date_seance, heure_debut, heure_fin, theme, competences, activites, lieu)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [sessionId, groupeId, phaseNumero, corps.date_seance, heureDebut, heureFin, theme, competences, activites, lieu]
  );
  res.status(201).json({ seance });
}));

// Corriger une séance. Champs absents du corps : inchangés.
router.patch("/seances/:id", requireRedacteur, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de séance invalide." });
  const corps = req.body || {};

  const actuelle = await seanceAvecSession(id);
  if (!actuelle) return res.status(404).json({ error: "Séance introuvable." });
  if (actuelle.archivee_le) return res.status(409).json({ error: MSG_ARCHIVEE });

  const sets = [];
  const params = [id];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

  let heureDebut = actuelle.heure_debut;
  let heureFin = actuelle.heure_fin;

  if (corps.groupe_id !== undefined) {
    const groupeId = corps.groupe_id === null ? null : parseIdPositif(corps.groupe_id);
    if (corps.groupe_id !== null && !groupeId) return res.status(400).json({ error: "Identifiant de groupe invalide." });
    if (groupeId) {
      const { rows: [g] } = await query("SELECT id FROM groupes WHERE id = $1 AND session_id = $2", [groupeId, actuelle.session_id]);
      if (!g) return res.status(400).json({ error: "Ce groupe n'appartient pas à la session de cette séance." });
    }
    set("groupe_id", groupeId);
  }
  if (corps.phase_numero !== undefined) {
    const phaseNumero = lirePhaseNumero(corps.phase_numero);
    if (phaseNumero === undefined) return res.status(400).json({ error: "Le numéro de phase doit être un entier positif." });
    set("phase_numero", phaseNumero);
  }
  if (corps.date_seance !== undefined) {
    if (!estDateValide(corps.date_seance)) return res.status(400).json({ error: "Date de séance invalide : format attendu AAAA-MM-JJ." });
    set("date_seance", corps.date_seance);
  }
  if (corps.heure_debut !== undefined) {
    const h = lireHeure(corps.heure_debut);
    if (h === undefined) return res.status(400).json({ error: "Heure de début invalide : format attendu HH:MM." });
    heureDebut = h;
    set("heure_debut", h);
  }
  if (corps.heure_fin !== undefined) {
    const h = lireHeure(corps.heure_fin);
    if (h === undefined) return res.status(400).json({ error: "Heure de fin invalide : format attendu HH:MM." });
    heureFin = h;
    set("heure_fin", h);
  }
  if (heureDebut && heureFin && heureFin <= heureDebut) {
    return res.status(400).json({ error: "L'heure de fin doit être postérieure à l'heure de début." });
  }
  if (corps.competences !== undefined) {
    const competences = lireCompetences(corps.competences);
    if (competences === undefined) return res.status(400).json({ error: "Les compétences doivent être une liste de textes." });
    set("competences", competences);
  }
  if (corps.theme !== undefined) {
    const theme = lireTexteCourt(corps.theme, 500);
    if (theme === undefined) return res.status(400).json({ error: "Thème trop long : 500 caractères au maximum." });
    set("theme", theme);
  }
  if (corps.activites !== undefined) {
    const activites = lireTexte(corps.activites);
    if (activites === undefined) return res.status(400).json({ error: "Activités trop longues : 2000 caractères au maximum." });
    set("activites", activites);
  }
  if (corps.lieu !== undefined) {
    const lieu = lireTexteCourt(corps.lieu, 200);
    if (lieu === undefined) return res.status(400).json({ error: "Lieu trop long : 200 caractères au maximum." });
    set("lieu", lieu);
  }
  if (!sets.length) return res.status(400).json({ error: "Rien à modifier." });

  const { rows: [seance] } = await query(`UPDATE seances SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  res.json({ seance });
}));

// Supprimer une séance saisie par erreur (les suivis liés suivent en CASCADE).
router.delete("/seances/:id", requireRedacteur, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de séance invalide." });
  const actuelle = await seanceAvecSession(id);
  if (!actuelle) return res.status(404).json({ error: "Séance introuvable." });
  if (actuelle.archivee_le) return res.status(409).json({ error: MSG_ARCHIVEE });
  const { rowCount } = await query("DELETE FROM seances WHERE id = $1", [id]);
  if (!rowCount) return res.status(404).json({ error: "Séance introuvable." });
  res.json({ ok: true });
}));

// Inscrits d'une séance avec leur éventuel suivi — UNE requête, aucun N+1.
router.get("/seances/:id/suivi", requireAuth, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de séance invalide." });
  const { rows: [seance] } = await query(
    `SELECT s.id, s.session_id, s.groupe_id, se.archivee_le
     FROM seances s JOIN sessions se ON se.id = s.session_id WHERE s.id = $1`, [id]);
  if (!seance) return res.status(404).json({ error: "Séance introuvable." });

  const { rows } = await query(
    `SELECT i.id AS inscription_id, i.statut, st.civilite, st.nom, st.prenom,
            su.id AS suivi_id, su.accompagnement, su.difficultes, su.impressions, su.observations,
            su.mis_a_jour_par, su.updated_at
     FROM inscriptions i
     JOIN stagiaires st ON st.id = i.stagiaire_id
     LEFT JOIN suivi_seance su ON su.seance_id = $1 AND su.inscription_id = i.id
     WHERE i.session_id = $2 AND ($3::int IS NULL OR i.groupe_id = $3)
     ORDER BY st.nom, st.prenom, i.id`,
    [id, seance.session_id, seance.groupe_id]
  );
  res.json({ seance, inscrits: rows, archivee: !!seance.archivee_le });
}));

// Saisir/corriger le suivi individuel d'un stagiaire sur une séance.
router.put("/seances/:id/suivi/:inscriptionId", requireRedacteur, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de séance invalide." });
  const inscriptionId = parseIdPositif(req.params.inscriptionId);
  if (!inscriptionId) return res.status(400).json({ error: "Identifiant d'inscription invalide." });
  const corps = req.body || {};

  const { rows: [seance] } = await query(
    `SELECT s.id, s.session_id, s.groupe_id, se.archivee_le
     FROM seances s JOIN sessions se ON se.id = s.session_id WHERE s.id = $1`, [id]);
  if (!seance) return res.status(404).json({ error: "Séance introuvable." });
  if (seance.archivee_le) return res.status(409).json({ error: MSG_ARCHIVEE });

  // Le stagiaire doit être inscrit à la session, et au groupe de la séance
  // si elle est propre à un groupe.
  const { rows: [insc] } = await query(
    `SELECT i.id, i.groupe_id FROM inscriptions i WHERE i.id = $1 AND i.session_id = $2`, [inscriptionId, seance.session_id]);
  if (!insc) return res.status(404).json({ error: "Inscription introuvable pour cette séance." });
  if (seance.groupe_id && insc.groupe_id !== seance.groupe_id) {
    return res.status(400).json({ error: "Ce stagiaire n'appartient pas au groupe de cette séance." });
  }

  const accompagnement = lireTexte(corps.accompagnement);
  if (accompagnement === undefined) return res.status(400).json({ error: "Accompagnement trop long : 2000 caractères au maximum." });
  const difficultes = lireTexte(corps.difficultes);
  if (difficultes === undefined) return res.status(400).json({ error: "Difficultés trop longues : 2000 caractères au maximum." });
  const impressions = lireTexte(corps.impressions);
  if (impressions === undefined) return res.status(400).json({ error: "Impressions trop longues : 2000 caractères au maximum." });
  const observations = lireTexte(corps.observations);
  if (observations === undefined) return res.status(400).json({ error: "Observations trop longues : 2000 caractères au maximum." });

  const { rows: [suivi] } = await query(
    `INSERT INTO suivi_seance (seance_id, inscription_id, accompagnement, difficultes, impressions, observations, cree_par, mis_a_jour_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     ON CONFLICT (seance_id, inscription_id) DO UPDATE SET
       accompagnement = EXCLUDED.accompagnement, difficultes = EXCLUDED.difficultes,
       impressions = EXCLUDED.impressions, observations = EXCLUDED.observations,
       mis_a_jour_par = EXCLUDED.mis_a_jour_par, updated_at = now()
     RETURNING *`,
    [id, inscriptionId, accompagnement, difficultes, impressions, observations, req.user.id]
  );
  res.json({ suivi });
}));

// Séances applicables à UN stagiaire avec son suivi (vue Livret).
router.get("/inscriptions/:id/suivi-pedagogique", requireAuth, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'inscription invalide." });
  const { rows: [insc] } = await query(
    `SELECT i.id, i.session_id, i.groupe_id, s.archivee_le
     FROM inscriptions i JOIN sessions s ON s.id = i.session_id WHERE i.id = $1`, [id]);
  if (!insc) return res.status(404).json({ error: "Inscription introuvable." });

  const { rows } = await query(
    `SELECT s.id AS seance_id, s.date_seance, s.heure_debut, s.heure_fin, s.theme, s.competences,
            s.activites, s.lieu, s.phase_numero, g.nom AS groupe_nom,
            su.accompagnement, su.difficultes, su.impressions, su.observations
     FROM seances s
     LEFT JOIN groupes g ON g.id = s.groupe_id
     LEFT JOIN suivi_seance su ON su.seance_id = s.id AND su.inscription_id = $1
     WHERE s.session_id = $2 AND (s.groupe_id IS NULL OR s.groupe_id = $3)
     ORDER BY s.date_seance, s.heure_debut, s.id`,
    [id, insc.session_id, insc.groupe_id]
  );
  res.json({ seances: rows, archivee: !!insc.archivee_le });
}));

export default router;
