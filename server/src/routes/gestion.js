// ─────────────────────────────────────────────────────────────
//  Phase 2 — saisie des formations, sessions, groupes, stagiaires,
//  modèles de documents, et lancement des générations.
//  Tout est réservé à l'admin : l'interface contributeur viendra plus tard.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { getPool, query } from "../db.js";
import { requireAdmin, requireAuth, requireRedacteur } from "../session.js";
import { genererDocuments } from "../services/documents.js";
import { MARQUEURS } from "../services/marqueurs.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const manque = (res, champ) => res.status(400).json({ error: `Champ obligatoire : ${champ}.` });

const PORTEES = ["formation", "session", "groupe", "stagiaire"];
const PRESCRIPTEURS = ["pole_emploi", "mission_locale", "of", "autre"];
const MODALITES = ["presentiel", "distanciel", "mixte"];
// Valeurs admises par la contrainte de la migration 008.
const CIVILITES = ["M.", "Mme"];
const STATUTS_INSCRIPTION = ["inscrit", "en_cours", "termine", "abandon"];

// Champs de contenu d'une version de formation : une modification en crée
// une nouvelle, les sessions déjà créées gardent la leur.
const CHAMPS_VERSION = [
  "objectifs", "prerequis", "public_vise", "duree_heures_defaut", "modalite",
  "certifiante", "code_rncp_rs", "tarif_ht", "accessibilite_handicap",
];

// Horaire d'une session : texte libre, facultatif. La MÊME règle sert à la
// création et à la correction — sinon un horaire saisi puis corrigé ne
// s'imprimerait pas de la même façon selon le chemin emprunté. Une chaîne
// vide, faite d'espaces, ou une valeur absente valent NULL : le marqueur
// {{horaire}} devient alors du vide, jamais le texte du marqueur.
export function normaliserHoraire(valeur) {
  if (valeur === undefined || valeur === null) return null;
  return String(valeur).trim() || null;
}

// ── Absences ─────────────────────────────────────────────────
// Principe métier : un stagiaire est PRÉSENT par défaut, on n'enregistre que
// ses ABSENCES. Elles sont portées par l'INSCRIPTION et non par la personne :
// un même stagiaire peut suivre deux sessions avec des absences différentes.
const DEMI_JOURNEES = ["matin", "apres_midi", "journee"];
const MAX_MOTIF = 500;
// Une absence ne peut pas dépasser une journée entière : au-delà, c'est une
// erreur de saisie, pas une donnée.
const DUREE_MAX = 24;

// Un identifiant d'URL qui n'est pas un entier positif est une erreur
// d'appel : 400 le dit, plutôt que de laisser PostgreSQL répondre 500.
function identifiant(valeur) {
  const n = Number(valeur);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// « AAAA-MM-JJ » strict. Le 30 février doit être refusé, pas reporté au
// 2 mars : on relit la date telle que JavaScript l'a comprise et on la
// compare au texte d'origine.
export function estDateValide(valeur) {
  if (typeof valeur !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return false;
  const d = new Date(`${valeur}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valeur;
}

// undefined : valeur refusée (hors des valeurs admises par la migration 001).
// null : « demi-journée non précisée », que le schéma autorise.
function lireDemiJournee(valeur) {
  if (valeur === undefined || valeur === null || valeur === "") return null;
  return DEMI_JOURNEES.includes(valeur) ? valeur : undefined;
}

// Aucune durée n'est DÉDUITE d'une demi-journée : elle est toujours saisie.
// NaN : refusée. La valeur est arrondie au centième comme la colonne
// numeric(5,2), pour que les totaux restent exacts.
function lireDuree(valeur) {
  if (valeur === undefined || valeur === null || valeur === "") return NaN;
  const n = typeof valeur === "number" ? valeur : Number(String(valeur).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > DUREE_MAX) return NaN;
  return Math.round(n * 100) / 100;
}

// undefined : trop long.
function lireMotif(valeur) {
  if (valeur === undefined || valeur === null) return null;
  const t = String(valeur).trim();
  if (t.length > MAX_MOTIF) return undefined;
  return t || null;
}

// Assiduité d'une inscription. Le taux n'est rendu que lorsqu'il est
// calculable ET non trompeur :
// - abandon : les heures réellement suivies avant l'abandon ne sont pas
//   modélisées, un taux serait un chiffre inventé ;
// - durée prévue inconnue ou nulle : on ne peut rien rapporter ;
// - absences supérieures à la durée prévue : le taux est plafonné à 0 %,
//   et le dépassement est signalé plutôt que masqué.
export function calculerAssiduite({ heuresPrevues, heuresAbsence, statut }) {
  const total = Math.round((Number(heuresAbsence) || 0) * 100) / 100;
  const socle = {
    heures_absence: total, heures_prevues: null, heures_suivies: null,
    taux: null, fiable: false, raison: null, depassement: false,
  };
  if (statut === "abandon") return { ...socle, raison: "abandon" };
  const prevues = Number(heuresPrevues);
  if (!Number.isFinite(prevues) || prevues <= 0) return { ...socle, raison: "duree_inconnue" };
  const suivies = Math.max(0, Math.round((prevues - total) * 100) / 100);
  const taux = Math.min(100, Math.max(0, Math.round((suivies / prevues) * 100)));
  return {
    heures_absence: total,
    heures_prevues: prevues,
    heures_suivies: suivies,
    taux,
    fiable: true,
    raison: null,
    depassement: total > prevues,
  };
}

// ── Formations ───────────────────────────────────────────────

router.get("/formations", requireAuth, wrap(async (_req, res) => {
  const { rows } = await query(
    `SELECT f.id, f.intitule, f.code_interne, f.actif,
            v.id AS version_id, v.numero AS version_numero, v.duree_heures_defaut, v.modalite,
            v.objectifs, v.prerequis, v.public_vise,
            v.certifiante, v.code_rncp_rs, v.tarif_ht, v.accessibilite_handicap,
            (SELECT count(*)::int FROM formation_versions fv WHERE fv.formation_id = f.id) AS nb_versions,
            (SELECT count(*)::int FROM sessions s WHERE s.formation_id = f.id) AS nb_sessions
     FROM formations f
     LEFT JOIN LATERAL (
       SELECT * FROM formation_versions v2 WHERE v2.formation_id = f.id ORDER BY v2.numero DESC LIMIT 1
     ) v ON true
     ORDER BY f.intitule`
  );
  res.json({ formations: rows, total: rows.length });
}));

async function creerVersion(cx, formationId, corps, utilisateurId) {
  const { rows: [{ suivant }] } = await cx.query(
    "SELECT COALESCE(max(numero), 0) + 1 AS suivant FROM formation_versions WHERE formation_id = $1",
    [formationId]
  );
  const valeurs = CHAMPS_VERSION.map((c) => {
    const v = corps[c];
    if (c === "certifiante") return v === true;
    return v === "" || v === undefined ? null : v;
  });
  const { rows: [version] } = await cx.query(
    `INSERT INTO formation_versions (formation_id, numero, ${CHAMPS_VERSION.join(", ")}, cree_par)
     VALUES ($1, $2, ${CHAMPS_VERSION.map((_, i) => "$" + (i + 3)).join(", ")}, $${CHAMPS_VERSION.length + 3})
     RETURNING *`,
    [formationId, suivant, ...valeurs, utilisateurId]
  );
  return version;
}

router.post("/formations", requireAdmin, wrap(async (req, res) => {
  const { intitule, code_interne } = req.body || {};
  if (!intitule?.trim()) return manque(res, "intitule");
  if (req.body.modalite && !MODALITES.includes(req.body.modalite)) return res.status(400).json({ error: "Modalité inconnue." });
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [formation] } = await cx.query(
      "INSERT INTO formations (intitule, code_interne) VALUES ($1, $2) RETURNING *",
      [intitule.trim(), code_interne?.trim() || null]
    );
    const version = await creerVersion(cx, formation.id, req.body, req.user.id);
    await cx.query("COMMIT");
    res.status(201).json({ formation, version });
  } catch (e) {
    await cx.query("ROLLBACK");
    if (e.code === "23505") return res.status(409).json({ error: "Ce code interne est déjà utilisé." });
    throw e;
  } finally { cx.release(); }
}));

// Modifier une formation = créer une NOUVELLE version. Les sessions déjà
// créées continuent de pointer sur la leur.
router.put("/formations/:id", requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (req.body?.modalite && !MODALITES.includes(req.body.modalite)) return res.status(400).json({ error: "Modalité inconnue." });
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [formation] } = await cx.query("SELECT * FROM formations WHERE id = $1 FOR UPDATE", [id]);
    if (!formation) { await cx.query("ROLLBACK"); return res.status(404).json({ error: "Formation introuvable." }); }
    if (req.body?.intitule?.trim() || req.body?.code_interne !== undefined || req.body?.actif !== undefined) {
      await cx.query(
        `UPDATE formations SET intitule = COALESCE($2, intitule), code_interne = COALESCE($3, code_interne),
           actif = COALESCE($4, actif) WHERE id = $1`,
        [id, req.body.intitule?.trim() || null, req.body.code_interne?.trim() || null,
         typeof req.body.actif === "boolean" ? req.body.actif : null]
      );
    }
    const version = await creerVersion(cx, id, req.body || {}, req.user.id);
    await cx.query("COMMIT");
    res.json({ ok: true, version });
  } catch (e) {
    await cx.query("ROLLBACK");
    throw e;
  } finally { cx.release(); }
}));

router.get("/formations/:id/versions", requireAuth, wrap(async (req, res) => {
  const { rows } = await query(
    "SELECT * FROM formation_versions WHERE formation_id = $1 ORDER BY numero DESC",
    [Number(req.params.id)]
  );
  res.json({ versions: rows, total: rows.length });
}));

// ── Sessions et groupes ──────────────────────────────────────

router.post("/sessions", requireAdmin, wrap(async (req, res) => {
  const { formation_id, date_debut, date_fin, reference, lieu, modalite, formateur, duree_heures_reelle, horaire } = req.body || {};
  if (!formation_id) return manque(res, "formation_id");
  if (!date_debut) return manque(res, "date_debut");
  if (!date_fin) return manque(res, "date_fin");
  if (date_fin < date_debut) return res.status(400).json({ error: "La date de fin précède la date de début." });
  if (modalite && !MODALITES.includes(modalite)) return res.status(400).json({ error: "Modalité inconnue." });

  // La session fige la version en vigueur au moment où on la crée.
  const { rows: [version] } = await query(
    "SELECT id FROM formation_versions WHERE formation_id = $1 ORDER BY numero DESC LIMIT 1",
    [formation_id]
  );
  if (!version) return res.status(400).json({ error: "Cette formation n'a aucune version : complétez-la d'abord." });

  const { rows: [session] } = await query(
    `INSERT INTO sessions (formation_id, formation_version_id, reference, date_debut, date_fin,
       lieu, modalite, formateur, duree_heures_reelle, horaire)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [formation_id, version.id, reference?.trim() || null, date_debut, date_fin,
     lieu?.trim() || null, modalite || null, formateur?.trim() || null, duree_heures_reelle || null,
     normaliserHoraire(horaire)]
  );
  res.status(201).json({ session });
}));

router.get("/sessions/:id", requireAuth, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { rows: [session] } = await query(
    `SELECT s.*, f.intitule AS formation, v.numero AS version_numero, v.duree_heures_defaut
     FROM sessions s JOIN formations f ON f.id = s.formation_id
     LEFT JOIN formation_versions v ON v.id = s.formation_version_id
     WHERE s.id = $1`,
    [id]
  );
  if (!session) return res.status(404).json({ error: "Session introuvable." });
  const { rows: groupes } = await query(
    `SELECT g.*, (SELECT count(*)::int FROM inscriptions i WHERE i.groupe_id = g.id AND i.statut <> 'abandon') AS nb_inscrits
     FROM groupes g WHERE g.session_id = $1 ORDER BY g.nom`,
    [id]
  );
  const { rows: stagiaires } = await query(
    `SELECT i.id AS inscription_id, i.groupe_id, i.statut, i.date_inscription, i.date_abandon,
            i.prescripteur, i.dossier_complet, s.id, s.civilite, s.nom, s.prenom, s.email, s.telephone
     FROM inscriptions i JOIN stagiaires s ON s.id = i.stagiaire_id
     WHERE i.session_id = $1 ORDER BY s.nom, s.prenom`,
    [id]
  );
  const { rows: documents } = await query(
    `SELECT d.*, m.nom AS modele, m.portee FROM documents_generes d
     JOIN modeles_documents m ON m.id = d.modele_id
     WHERE d.session_id = $1 ORDER BY d.genere_le DESC`,
    [id]
  );
  res.json({ session, groupes, stagiaires, documents });
}));

// Corriger l'horaire d'une session — c'est le SEUL champ que cette route
// sait modifier, volontairement. Les autres champs d'une session figent ce
// qui a été déclaré : la durée et les dates, en particulier, sont déjà
// imprimées sur les documents générés. Comme les autres PATCH du projet,
// un corps sans le champ attendu est refusé, et tout champ surnuméraire
// est ignoré plutôt que modifié en silence.
router.patch("/sessions/:id", requireAdmin, wrap(async (req, res) => {
  if (req.body?.horaire === undefined) return res.status(400).json({ error: "Rien à modifier." });
  const { rows } = await query(
    "UPDATE sessions SET horaire = $2 WHERE id = $1 RETURNING *",
    [Number(req.params.id), normaliserHoraire(req.body.horaire)]
  );
  if (!rows.length) return res.status(404).json({ error: "Session introuvable." });
  res.json({ session: rows[0] });
}));

router.post("/sessions/:id/groupes", requireAdmin, wrap(async (req, res) => {
  const sessionId = Number(req.params.id);
  const { nom, lieu, formateur } = req.body || {};
  if (!nom?.trim()) return manque(res, "nom");
  try {
    const { rows: [groupe] } = await query(
      "INSERT INTO groupes (session_id, nom, lieu, formateur) VALUES ($1,$2,$3,$4) RETURNING *",
      [sessionId, nom.trim(), lieu?.trim() || null, formateur?.trim() || null]
    );
    res.status(201).json({ groupe });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Un groupe porte déjà ce nom dans cette session." });
    if (e.code === "23503") return res.status(404).json({ error: "Session introuvable." });
    throw e;
  }
}));

// ── Stagiaires ───────────────────────────────────────────────
// Ajouter un stagiaire à un groupe crée la personne si besoin, puis son
// inscription. C'est l'inscription qui porte le prescripteur, l'état du
// dossier et l'abandon éventuel.
router.post("/sessions/:id/stagiaires", requireRedacteur, wrap(async (req, res) => {
  const sessionId = Number(req.params.id);
  const { civilite, nom, prenom, email, telephone, groupe_id, prescripteur, dossier_complet, date_inscription, stagiaire_id } = req.body || {};
  if (!stagiaire_id && (!nom?.trim() || !prenom?.trim())) return manque(res, "nom et prenom");
  if (prescripteur && !PRESCRIPTEURS.includes(prescripteur)) return res.status(400).json({ error: "Prescripteur inconnu." });
  if (civilite && !CIVILITES.includes(civilite)) return res.status(400).json({ error: "Civilité inconnue." });

  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [session] } = await cx.query("SELECT id FROM sessions WHERE id = $1", [sessionId]);
    if (!session) { await cx.query("ROLLBACK"); return res.status(404).json({ error: "Session introuvable." }); }
    if (groupe_id) {
      const { rowCount } = await cx.query("SELECT 1 FROM groupes WHERE id = $1 AND session_id = $2", [groupe_id, sessionId]);
      if (!rowCount) { await cx.query("ROLLBACK"); return res.status(400).json({ error: "Ce groupe n'appartient pas à la session." }); }
    }
    let personneId = stagiaire_id || null;
    if (!personneId) {
      const { rows: [p] } = await cx.query(
        "INSERT INTO stagiaires (civilite, nom, prenom, email, telephone) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [civilite || null, nom.trim(), prenom.trim(), email?.trim() || null, telephone?.trim() || null]
      );
      personneId = p.id;
    }
    const { rows: [inscription] } = await cx.query(
      `INSERT INTO inscriptions (stagiaire_id, session_id, groupe_id, prescripteur, dossier_complet, date_inscription)
       VALUES ($1,$2,$3,$4,$5, COALESCE($6::date, current_date))
       ON CONFLICT (stagiaire_id, session_id) DO UPDATE SET groupe_id = EXCLUDED.groupe_id,
         prescripteur = EXCLUDED.prescripteur, dossier_complet = EXCLUDED.dossier_complet
       RETURNING *`,
      [personneId, sessionId, groupe_id || null, prescripteur || null, dossier_complet === true, date_inscription || null]
    );
    await cx.query("COMMIT");
    res.status(201).json({ inscription });
  } catch (e) {
    await cx.query("ROLLBACK");
    throw e;
  } finally { cx.release(); }
}));

// Abandon, changement de groupe, dossier complet… Un abandon sort
// automatiquement le stagiaire du décompte « par stagiaire » des preuves,
// logique déjà en place.
router.patch("/inscriptions/:id", requireRedacteur, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { statut, date_abandon, motif_abandon, groupe_id, prescripteur, dossier_complet } = req.body || {};
  if (statut && !STATUTS_INSCRIPTION.includes(statut)) return res.status(400).json({ error: "Statut d'inscription inconnu." });
  if (prescripteur && !PRESCRIPTEURS.includes(prescripteur)) return res.status(400).json({ error: "Prescripteur inconnu." });
  const sets = [];
  const params = [id];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (statut !== undefined) {
    set("statut", statut);
    // Un abandon sans date reçoit celle du jour : le décompte doit savoir quand.
    if (statut === "abandon") set("date_abandon", date_abandon || new Date().toISOString().slice(0, 10));
  } else if (date_abandon !== undefined) set("date_abandon", date_abandon || null);
  if (motif_abandon !== undefined) set("motif_abandon", motif_abandon || null);
  if (groupe_id !== undefined) set("groupe_id", groupe_id || null);
  if (prescripteur !== undefined) set("prescripteur", prescripteur || null);
  if (dossier_complet !== undefined) set("dossier_complet", dossier_complet === true);
  if (!sets.length) return res.status(400).json({ error: "Rien à modifier." });
  const { rows } = await query(`UPDATE inscriptions SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  if (!rows.length) return res.status(404).json({ error: "Inscription introuvable." });
  res.json({ inscription: rows[0] });
}));

// ── Absences d'un stagiaire ──────────────────────────────────
// Saisie courante : ouverte aux admins ET aux contributeurs, comme l'ajout
// d'un stagiaire. Aucun autre droit n'est élargi par ces routes.
// Toute durée est SAISIE : la déduire d'une « demi-journée » inventerait une
// donnée que personne n'a déclarée.

router.get("/sessions/:id/absences", requireAuth, wrap(async (req, res) => {
  const sessionId = identifiant(req.params.id);
  if (!sessionId) return res.status(400).json({ error: "Identifiant de session invalide." });

  const { rows: [session] } = await query(
    `SELECT s.id, s.date_debut, s.date_fin, s.duree_heures_reelle, v.duree_heures_defaut
     FROM sessions s LEFT JOIN formation_versions v ON v.id = s.formation_version_id
     WHERE s.id = $1`,
    [sessionId]
  );
  if (!session) return res.status(404).json({ error: "Session introuvable." });

  // La durée prévue est celle que la session a réellement déclarée ; à
  // défaut, celle de la version de formation qu'elle a figée. Le schéma
  // n'a pas de colonne `sessions.duree_heures` : ces deux sources la
  // remplacent.
  const prevues = session.duree_heures_reelle ?? session.duree_heures_defaut ?? null;

  const { rows: stagiaires } = await query(
    `SELECT i.id AS inscription_id, i.statut, s.id AS stagiaire_id, s.civilite, s.nom, s.prenom
     FROM inscriptions i JOIN stagiaires s ON s.id = i.stagiaire_id
     WHERE i.session_id = $1 ORDER BY s.nom, s.prenom`,
    [sessionId]
  );
  const { rows: absences } = await query(
    `SELECT a.id, a.inscription_id, a.date_absence, a.demi_journee, a.duree_heures, a.justifiee, a.motif
     FROM absences a JOIN inscriptions i ON i.id = a.inscription_id
     WHERE i.session_id = $1
     ORDER BY a.date_absence,
              CASE a.demi_journee WHEN 'matin' THEN 1 WHEN 'apres_midi' THEN 2 WHEN 'journee' THEN 3 ELSE 0 END,
              a.id`,
    [sessionId]
  );

  const parInscription = new Map();
  for (const a of absences) {
    if (!parInscription.has(a.inscription_id)) parInscription.set(a.inscription_id, []);
    parInscription.get(a.inscription_id).push(a);
  }

  let total = 0;
  const fiches = stagiaires.map((st) => {
    const listes = parInscription.get(st.inscription_id) || [];
    const heures = listes.reduce((n, a) => n + (Number(a.duree_heures) || 0), 0);
    total += heures;
    return {
      ...st,
      absences: listes,
      total_heures_absence: Math.round(heures * 100) / 100,
      assiduite: calculerAssiduite({ heuresPrevues: prevues, heuresAbsence: heures, statut: st.statut }),
    };
  });

  res.json({
    session: {
      id: session.id,
      date_debut: session.date_debut,
      date_fin: session.date_fin,
      heures_prevues: prevues === null ? null : Number(prevues),
      source_heures_prevues: session.duree_heures_reelle !== null && session.duree_heures_reelle !== undefined
        ? "duree_heures_reelle"
        : (prevues === null ? null : "duree_heures_defaut"),
    },
    stagiaires: fiches,
    total_heures_absence: Math.round(total * 100) / 100,
  });
}));

router.post("/inscriptions/:id/absences", requireRedacteur, wrap(async (req, res) => {
  const inscriptionId = identifiant(req.params.id);
  if (!inscriptionId) return res.status(400).json({ error: "Identifiant d'inscription invalide." });
  const corps = req.body || {};

  if (!corps.date_absence) return manque(res, "date_absence");
  if (!estDateValide(corps.date_absence)) {
    return res.status(400).json({ error: "Date d'absence invalide : format attendu AAAA-MM-JJ." });
  }
  const demi = lireDemiJournee(corps.demi_journee);
  if (demi === undefined) return res.status(400).json({ error: "Demi-journée inconnue." });
  const duree = lireDuree(corps.duree_heures);
  if (Number.isNaN(duree)) {
    return res.status(400).json({
      error: `Durée d'absence invalide : indiquez un nombre d'heures supérieur à 0 et inférieur ou égal à ${DUREE_MAX}.`,
    });
  }
  const motif = lireMotif(corps.motif);
  if (motif === undefined) return res.status(400).json({ error: `Motif trop long : ${MAX_MOTIF} caractères au maximum.` });

  // C'est l'inscription qui porte la session, donc les dates de référence.
  const { rows: [cible] } = await query(
    `SELECT i.id, s.date_debut, s.date_fin
     FROM inscriptions i JOIN sessions s ON s.id = i.session_id
     WHERE i.id = $1`,
    [inscriptionId]
  );
  if (!cible) return res.status(404).json({ error: "Inscription introuvable." });
  if (corps.date_absence < cible.date_debut || corps.date_absence > cible.date_fin) {
    return res.status(400).json({
      error: `La date doit tomber dans les dates de la session (du ${cible.date_debut} au ${cible.date_fin}).`,
    });
  }

  // Doublon : même inscription, même date, même demi-journée. Le schéma ne
  // peut pas le garantir — `demi_journee` est nullable, et deux NULL ne sont
  // jamais égaux dans un index unique. « IS NOT DISTINCT FROM » les compare
  // ici sans cette ambiguïté. Le contrôle laisse une fenêtre de concurrence
  // résiduelle : elle est acceptable pour une saisie manuelle à un seul
  // poste, et la signaler vaut mieux que d'ajouter une migration.
  const { rowCount } = await query(
    `SELECT 1 FROM absences
     WHERE inscription_id = $1 AND date_absence = $2 AND demi_journee IS NOT DISTINCT FROM $3`,
    [inscriptionId, corps.date_absence, demi]
  );
  if (rowCount) {
    return res.status(409).json({ error: "Une absence est déjà enregistrée pour cette date et cette demi-journée." });
  }

  const { rows: [absence] } = await query(
    `INSERT INTO absences (inscription_id, date_absence, demi_journee, duree_heures, justifiee, motif)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [inscriptionId, corps.date_absence, demi, duree, corps.justifiee === true, motif]
  );
  res.status(201).json({ absence });
}));

// Corriger une absence. Comme les autres PATCH du projet : un champ absent du
// corps reste inchangé, un corps vide est refusé.
router.patch("/absences/:id", requireRedacteur, wrap(async (req, res) => {
  const id = identifiant(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'absence invalide." });
  const corps = req.body || {};

  const { rows: [actuelle] } = await query(
    `SELECT a.id, a.inscription_id, a.date_absence, a.demi_journee, a.duree_heures, a.justifiee, a.motif,
            s.date_debut, s.date_fin
     FROM absences a
     JOIN inscriptions i ON i.id = a.inscription_id
     JOIN sessions s ON s.id = i.session_id
     WHERE a.id = $1`,
    [id]
  );
  if (!actuelle) return res.status(404).json({ error: "Absence introuvable." });

  const sets = [];
  const params = [id];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

  let date = actuelle.date_absence;
  if (corps.date_absence !== undefined) {
    if (!estDateValide(corps.date_absence)) {
      return res.status(400).json({ error: "Date d'absence invalide : format attendu AAAA-MM-JJ." });
    }
    date = corps.date_absence;
    set("date_absence", date);
  }
  if (date < actuelle.date_debut || date > actuelle.date_fin) {
    return res.status(400).json({
      error: `La date doit tomber dans les dates de la session (du ${actuelle.date_debut} au ${actuelle.date_fin}).`,
    });
  }

  let demi = actuelle.demi_journee;
  if (corps.demi_journee !== undefined) {
    const lue = lireDemiJournee(corps.demi_journee);
    if (lue === undefined) return res.status(400).json({ error: "Demi-journée inconnue." });
    demi = lue;
    set("demi_journee", demi);
  }

  if (corps.duree_heures !== undefined) {
    const duree = lireDuree(corps.duree_heures);
    if (Number.isNaN(duree)) {
      return res.status(400).json({
        error: `Durée d'absence invalide : indiquez un nombre d'heures supérieur à 0 et inférieur ou égal à ${DUREE_MAX}.`,
      });
    }
    set("duree_heures", duree);
  }

  if (corps.justifiee !== undefined) set("justifiee", corps.justifiee === true);

  if (corps.motif !== undefined) {
    const motif = lireMotif(corps.motif);
    if (motif === undefined) return res.status(400).json({ error: `Motif trop long : ${MAX_MOTIF} caractères au maximum.` });
    set("motif", motif);
  }

  if (!sets.length) return res.status(400).json({ error: "Rien à modifier." });

  // Le doublon est contrôlé sur ce que l'absence VA DEVENIR : déplacer une
  // absence d'un jour peut la faire tomber sur une autre.
  const { rowCount } = await query(
    `SELECT 1 FROM absences
     WHERE inscription_id = $1 AND date_absence = $2 AND demi_journee IS NOT DISTINCT FROM $3 AND id <> $4`,
    [actuelle.inscription_id, date, demi, id]
  );
  if (rowCount) {
    return res.status(409).json({ error: "Une absence est déjà enregistrée pour cette date et cette demi-journée." });
  }

  const { rows: [absence] } = await query(
    `UPDATE absences SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
    params
  );
  res.json({ absence });
}));

// Supprimer une absence saisie par erreur.
router.delete("/absences/:id", requireRedacteur, wrap(async (req, res) => {
  const id = identifiant(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'absence invalide." });
  const { rowCount } = await query("DELETE FROM absences WHERE id = $1", [id]);
  if (!rowCount) return res.status(404).json({ error: "Absence introuvable." });
  res.json({ ok: true });
}));

// Modifier une personne déjà saisie. Indispensable pour la civilité :
// les stagiaires enregistrés avant la migration 008 n'en ont aucune, et
// rien d'autre ne permettait jusqu'ici de corriger une fiche.
router.patch("/stagiaires/:id", requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { civilite, nom, prenom, email, telephone } = req.body || {};
  if (civilite !== undefined && civilite !== null && !CIVILITES.includes(civilite)) {
    return res.status(400).json({ error: "Civilité inconnue." });
  }
  const sets = [];
  const params = [id];
  const set = (col, val) => { params.push(val); sets.push(col + ' = $' + params.length); };
  // Une chaîne vide vaut effacement : le formulaire envoie "" pour
  // « Non renseignée ».
  if (civilite !== undefined) set("civilite", civilite || null);
  if (nom !== undefined && nom.trim()) set("nom", nom.trim());
  if (prenom !== undefined && prenom.trim()) set("prenom", prenom.trim());
  if (email !== undefined) set("email", email?.trim() || null);
  if (telephone !== undefined) set("telephone", telephone?.trim() || null);
  if (!sets.length) return res.status(400).json({ error: "Rien à modifier." });
  const { rows } = await query("UPDATE stagiaires SET " + sets.join(", ") + " WHERE id = $1 RETURNING *", params);
  if (!rows.length) return res.status(404).json({ error: "Stagiaire introuvable." });
  res.json({ stagiaire: rows[0] });
}));

// ── Modèles de documents ─────────────────────────────────────

// Accepte une URL Drive complète ou un identifiant nu.
export function extraireFileId(saisie) {
  const t = String(saisie || "").trim();
  if (!t) return null;
  const m = /\/d\/([A-Za-z0-9_-]{10,})/.exec(t) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(t);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(t) ? t : null;
}

router.get("/modeles", requireAuth, wrap(async (req, res) => {
  const portee = req.query.portee;
  const params = [];
  let filtre = "m.actif";
  if (portee && PORTEES.includes(portee)) { params.push(portee); filtre += ` AND m.portee = $${params.length}`; }
  const { rows } = await query(
    `SELECT m.*,
            COALESCE((SELECT json_agg(json_build_object('id', i.id, 'numero', i.numero) ORDER BY i.numero)
                      FROM modele_indicateurs mi JOIN indicateurs i ON i.id = mi.indicateur_id
                      WHERE mi.modele_id = m.id), '[]'::json) AS indicateurs
     FROM modeles_documents m WHERE ${filtre} ORDER BY m.portee, m.nom`,
    params
  );
  res.json({ modeles: rows, marqueurs: MARQUEURS, total: rows.length });
}));

router.post("/modeles", requireAdmin, wrap(async (req, res) => {
  const { nom, lien, portee, description, indicateurs, drive_mime } = req.body || {};
  if (!nom?.trim()) return manque(res, "nom");
  if (!PORTEES.includes(portee)) return res.status(400).json({ error: "Portée inconnue." });
  const fileId = extraireFileId(lien);
  if (!fileId) return res.status(400).json({ error: "Lien ou identifiant Drive non reconnu." });
  const numeros = Array.isArray(indicateurs) ? indicateurs.map(Number).filter((n) => n > 0) : [];
  if (!numeros.length) return res.status(400).json({ error: "Indiquez au moins un indicateur." });

  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [modele] } = await cx.query(
      `INSERT INTO modeles_documents (nom, drive_file_id, drive_url, drive_mime, portee, description, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [nom.trim(), fileId, `https://drive.google.com/open?id=${fileId}`, drive_mime || null,
       portee, description?.trim() || null, req.user.id]
    );
    const { rows: trouves } = await cx.query(
      `SELECT i.id, i.numero FROM indicateurs i
       JOIN referentiel_versions v ON v.id = i.version_id AND v.est_active
       WHERE i.numero = ANY($1::int[])`,
      [numeros]
    );
    if (trouves.length !== numeros.length) {
      await cx.query("ROLLBACK");
      const manquants = numeros.filter((n) => !trouves.some((t) => t.numero === n));
      return res.status(400).json({ error: `Indicateur(s) inconnu(s) : ${manquants.join(", ")}.` });
    }
    for (const t of trouves) {
      await cx.query("INSERT INTO modele_indicateurs (modele_id, indicateur_id) VALUES ($1,$2)", [modele.id, t.id]);
    }
    await cx.query("COMMIT");
    res.status(201).json({ modele: { ...modele, indicateurs: trouves } });
  } catch (e) {
    await cx.query("ROLLBACK");
    if (e.code === "23505") return res.status(409).json({ error: "Ce fichier est déjà enregistré comme modèle pour cette portée." });
    throw e;
  } finally { cx.release(); }
}));

router.delete("/modeles/:id", requireAdmin, wrap(async (req, res) => {
  const { rowCount } = await query("UPDATE modeles_documents SET actif = false WHERE id = $1", [Number(req.params.id)]);
  if (!rowCount) return res.status(404).json({ error: "Modèle introuvable." });
  res.json({ ok: true });
}));

// ── Génération ───────────────────────────────────────────────
router.post("/generations", requireRedacteur, wrap(async (req, res) => {
  const { modele_id, session_id, groupe_id = null, remplacer = false } = req.body || {};
  if (!modele_id) return manque(res, "modele_id");
  if (!session_id) return manque(res, "session_id");
  try {
    const r = await genererDocuments({
      modeleId: Number(modele_id), sessionId: Number(session_id),
      groupeId: groupe_id ? Number(groupe_id) : null,
      remplacer: remplacer === true, utilisateurId: req.user.id,
    });
    res.json(r);
  } catch (e) {
    // 409 : des documents existent déjà, l'écran doit proposer de remplacer.
    const code = e.dejaGeneres ? 409 : 400;
    res.status(code).json({ error: e.message, dejaGeneres: e.dejaGeneres, diagnostic: e.diagnostic || null });
  }
}));

export default router;
