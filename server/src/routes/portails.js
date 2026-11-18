// ─────────────────────────────────────────────────────────────
//  Portails stagiaire et formateur (CDC §40) — accès par lien personnel, sans compte Google.
//  - L'administrateur crée un accès (durée limitée) ; le lien n'est affiché qu'une fois ; seule l'empreinte
//    SHA-256 du jeton est conservée ; l'accès se révoque à tout moment.
//  - Le lien ouvre une session portail (cookie signé distinct de la session des salariés, 8 h).
//  - Séparation stricte : chaque requête ne lit que les données de LA personne de l'accès (stagiaire : ses
//    inscriptions ; formateur : les sessions et groupes où il intervient). Jamais de donnée de santé.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import crypto from "node:crypto";
import { getPool, query } from "../db.js";
import { requireAdmin, decode, encode, readCookie } from "../session.js";
import { config } from "../config.js";
import { parseIdPositif } from "../services/ids.js";
import { journaliser } from "../services/journal.js";
import { appelGoogle, getDrive } from "../services/google.js";
import { calculerAssiduite } from "../services/assiduite.js";
import { competencesDeSession, lireCompetences } from "../services/competencesStagiaire.js";
import { datePlusJoursOuvres, prefixeReference } from "../services/qualite.js";
import { referenceSuivante } from "./qualite.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const COOKIE_PORTAIL = "vq_portail";
const DUREE_SESSION_MS = 8 * 3600 * 1000;
const empreinte = (jeton) => crypto.createHash("sha256").update(String(jeton)).digest("hex");
const JETON = /^[A-Za-z0-9_-]{32,64}$/;
const INTERDIT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

// ── Gestion des accès (administrateur) ───────────────────────
router.get("/acces-portail", requireAdmin, wrap(async (req, res) => {
  const s = req.query.stagiaire_id ? parseIdPositif(req.query.stagiaire_id) : null;
  const i = req.query.intervenant_id ? parseIdPositif(req.query.intervenant_id) : null;
  const { rows } = await query(
    `SELECT a.id, a.type, a.stagiaire_id, a.intervenant_id, a.expire_le, a.cree_le, a.derniere_utilisation, a.revoque_le,
            (a.revoque_le IS NULL AND a.expire_le >= CURRENT_DATE) AS actif,
            COALESCE(st.prenom || ' ' || st.nom, iv.prenom || ' ' || iv.nom) AS personne
     FROM acces_portail a LEFT JOIN stagiaires st ON st.id = a.stagiaire_id LEFT JOIN intervenants iv ON iv.id = a.intervenant_id
     WHERE ($1::int IS NULL OR a.stagiaire_id = $1) AND ($2::int IS NULL OR a.intervenant_id = $2)
     ORDER BY a.cree_le DESC LIMIT 200`, [s, i]);
  res.json({ acces: rows });
}));

router.post("/acces-portail", requireAdmin, wrap(async (req, res) => {
  const { type } = req.body || {};
  if (!["stagiaire", "formateur"].includes(type)) return res.status(400).json({ error: "Type d'accès inconnu." });
  const cible = parseIdPositif(type === "stagiaire" ? req.body.stagiaire_id : req.body.intervenant_id);
  if (!cible) return res.status(400).json({ error: "Personne invalide." });
  const jours = req.body.duree_jours === undefined ? 90 : Number(req.body.duree_jours);
  if (!Number.isInteger(jours) || jours < 1 || jours > 365) return res.status(400).json({ error: "Durée d'accès : de 1 à 365 jours." });
  const table = type === "stagiaire" ? "stagiaires" : "intervenants";
  const { rows: [p] } = await query(`SELECT id FROM ${table} WHERE id = $1${type === "stagiaire" ? " AND anonymise_le IS NULL" : " AND actif"}`, [cible]);
  if (!p) return res.status(404).json({ error: "Personne introuvable." });
  const jeton = crypto.randomBytes(32).toString("base64url");
  const { rows: [a] } = await query(
    `INSERT INTO acces_portail (type, stagiaire_id, intervenant_id, jeton_hash, expire_le, cree_par)
     VALUES ($1, $2, $3, $4, CURRENT_DATE + $5::int, $6) RETURNING id, expire_le`,
    [type, type === "stagiaire" ? cible : null, type === "formateur" ? cible : null, empreinte(jeton), jours, req.user.id]);
  await journaliser("acces_portail_cree", { detail: `${type}, ${jours} jours`, cibleType: type === "stagiaire" ? "stagiaire" : "intervenant", cibleId: cible, par: req.user.id });
  // Le lien n'est renvoyé qu'ici : il n'est stocké nulle part en clair.
  res.status(201).json({ acces: { id: a.id, expire_le: a.expire_le }, chemin: `/portail/${jeton}` });
}));

router.delete("/acces-portail/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const { rowCount } = await query("UPDATE acces_portail SET revoque_le = now() WHERE id = $1 AND revoque_le IS NULL", [id]);
  if (!rowCount) return res.status(404).json({ error: "Accès introuvable ou déjà révoqué." });
  await journaliser("acces_portail_revoque", { cibleType: "acces_portail", cibleId: id, par: req.user.id });
  res.json({ ok: true });
}));

// ── Session portail ──────────────────────────────────────────
async function accesValide(id) {
  const { rows: [a] } = await query(
    "SELECT id, type, stagiaire_id, intervenant_id FROM acces_portail WHERE id = $1 AND revoque_le IS NULL AND expire_le >= CURRENT_DATE", [id]);
  return a || null;
}

router.post("/portail/connexion", wrap(async (req, res) => {
  const jeton = String(req.body?.jeton || "");
  if (!JETON.test(jeton)) return res.status(401).json({ error: "Lien d'accès invalide." });
  const { rows: [a] } = await query(
    "SELECT id, type FROM acces_portail WHERE jeton_hash = $1 AND revoque_le IS NULL AND expire_le >= CURRENT_DATE", [empreinte(jeton)]);
  if (!a) return res.status(401).json({ error: "Ce lien d'accès est invalide, expiré ou a été désactivé. Demandez-en un nouveau à l'organisme." });
  await query("UPDATE acces_portail SET derniere_utilisation = now() WHERE id = $1", [a.id]);
  res.cookie(COOKIE_PORTAIL, encode({ pid: a.id, exp: Date.now() + DUREE_SESSION_MS }), { httpOnly: true, sameSite: "lax", secure: config.isProd, path: "/", maxAge: DUREE_SESSION_MS });
  res.json({ type: a.type });
}));

router.post("/portail/deconnexion", (_req, res) => {
  res.clearCookie(COOKIE_PORTAIL, { httpOnly: true, sameSite: "lax", secure: config.isProd, path: "/" });
  res.json({ ok: true });
});

function requirePortail(type) {
  return wrap(async (req, res, next) => {
    const s = decode(readCookie(req, COOKIE_PORTAIL));
    const a = s?.pid ? await accesValide(s.pid) : null;
    if (!a || (type && a.type !== type)) return res.status(401).json({ error: "Accès expiré : rouvrez le lien qui vous a été transmis." });
    req.portail = a;
    next();
  });
}

router.get("/portail/moi", requirePortail(null), wrap(async (req, res) => {
  const a = req.portail;
  const { rows: [p] } = a.type === "stagiaire"
    ? await query("SELECT prenom, nom FROM stagiaires WHERE id = $1", [a.stagiaire_id])
    : await query("SELECT prenom, nom FROM intervenants WHERE id = $1", [a.intervenant_id]);
  const { rows: [o] } = await query("SELECT nom, email, telephone FROM parametres_organisme WHERE id = 1");
  res.json({ type: a.type, personne: p, organisme: o || {} });
}));

// ── Portail stagiaire ────────────────────────────────────────
router.get("/portail/stagiaire", requirePortail("stagiaire"), wrap(async (req, res) => {
  const sid = req.portail.stagiaire_id;
  const { rows: inscriptions } = await query(
    `SELECT i.id AS inscription_id, i.statut, i.session_id, s.reference, s.date_debut, s.date_fin, s.horaire, s.lieu, s.statut AS session_statut,
            s.duree_heures_reelle, f.intitule AS formation, fv.duree_heures_defaut, fv.objectifs, fv.objectifs_operationnels, fv.modalites_evaluation, g.nom AS groupe,
            COALESCE((SELECT sum(a.duree_heures) FROM absences a WHERE a.inscription_id = i.id), 0) AS heures_absence
     FROM inscriptions i JOIN sessions s ON s.id = i.session_id LEFT JOIN formations f ON f.id = s.formation_id
     LEFT JOIN formation_versions fv ON fv.id = s.formation_version_id LEFT JOIN groupes g ON g.id = i.groupe_id
     WHERE i.stagiaire_id = $1 ORDER BY s.date_debut DESC`, [sid]);
  const ids = inscriptions.map((i) => i.inscription_id);
  const sessions = inscriptions.map((i) => i.session_id);
  const [{ rows: documents }, { rows: evaluations }, { rows: competences }, { rows: enquetes }, { rows: seances }] = await Promise.all([
    query("SELECT id, session_id, nom, genere_le FROM documents_generes WHERE stagiaire_id = $1 AND remplace_le IS NULL ORDER BY genere_le DESC", [sid]),
    query("SELECT inscription_id, intitule, date_passage, score, score_max, resultat FROM resultats_qcm WHERE inscription_id = ANY($1::int[]) ORDER BY date_passage", [ids]),
    query("SELECT inscription_id, competence, statut FROM competences_stagiaires WHERE inscription_id = ANY($1::int[]) ORDER BY competence", [ids]),
    query(`SELECT e.session_id, e.titre, e.jeton FROM enquetes e WHERE e.session_id = ANY($1::int[]) AND e.ouverte AND (e.date_fin IS NULL OR e.date_fin >= CURRENT_DATE)
           AND e.type IN ('a_chaud','a_froid') ORDER BY e.cree_le`, [sessions]),
    query(`SELECT s.session_id, s.date_seance, s.heure_debut, s.heure_fin, s.theme, s.lieu FROM seances s JOIN inscriptions i ON i.session_id = s.session_id
           WHERE i.stagiaire_id = $1 AND (s.groupe_id IS NULL OR s.groupe_id = i.groupe_id) AND s.date_seance >= CURRENT_DATE ORDER BY s.date_seance, s.heure_debut LIMIT 30`, [sid]),
  ]);
  res.json({
    inscriptions: inscriptions.map((i) => {
      const a = calculerAssiduite({ heuresPrevues: i.duree_heures_reelle ?? i.duree_heures_defaut, heuresAbsence: i.heures_absence, statut: i.statut });
      return {
        inscription_id: i.inscription_id, session_id: i.session_id, formation: i.formation, reference: i.reference, date_debut: i.date_debut, date_fin: i.date_fin,
        horaire: i.horaire, lieu: i.lieu, groupe: i.groupe, statut: i.statut, objectif: i.objectifs, objectifs_operationnels: i.objectifs_operationnels || [],
        modalites_evaluation: i.modalites_evaluation, assiduite: a.fiable ? a.taux : null,
        documents: documents.filter((d) => d.session_id === i.session_id).map(({ id, nom, genere_le }) => ({ id, nom, genere_le })),
        evaluations: evaluations.filter((e) => e.inscription_id === i.inscription_id).map(({ inscription_id, ...e }) => e),
        competences: competences.filter((c) => c.inscription_id === i.inscription_id).map(({ inscription_id, ...c }) => c),
        enquetes: enquetes.filter((e) => e.session_id === i.session_id).map((e) => ({ titre: e.titre, chemin: `/repondre/${e.jeton}` })),
        prochaines_seances: seances.filter((s) => s.session_id === i.session_id).map(({ session_id, ...s }) => s),
      };
    }),
  });
}));

// Document généré → PDF (export Google Drive), seulement s'il appartient à CE stagiaire.
router.get("/portail/stagiaire/documents/:id/pdf", requirePortail("stagiaire"), wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Document invalide." });
  const { rows: [d] } = await query("SELECT drive_file_id, nom FROM documents_generes WHERE id = $1 AND stagiaire_id = $2 AND remplace_le IS NULL", [id, req.portail.stagiaire_id]);
  if (!d) return res.status(404).json({ error: "Document introuvable." });
  const g = await getDrive();
  if (!g) return res.status(503).json({ error: "Le document n'est pas disponible pour le moment. Réessayez plus tard ou contactez l'organisme." });
  try {
    const r = await appelGoogle("drive.files.export", () => g.drive.files.export({ fileId: d.drive_file_id, mimeType: "application/pdf" }, { responseType: "arraybuffer" }), { api: "drive" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="document-${id}.pdf"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(r.data));
  } catch {
    res.status(503).json({ error: "Le document n'a pas pu être préparé. Contactez l'organisme." });
  }
}));

// Signalement d'une difficulté ou réclamation : enregistré comme signalement qualité (traité par l'organisme).
async function creerSignalement(client, { type, objet, description, inscriptionId, sessionId, formationId, auteur }) {
  const jour = new Date().toISOString().slice(0, 10);
  const reference = await referenceSuivante(client, prefixeReference(type));
  const reclamation = type === "reclamation";
  const { rows: [s] } = await client.query(
    `INSERT INTO signalements_qualite (reference, type, date_constat, canal, objet, description, reclamant_nom, inscription_id, session_id, formation_id,
       delai_cible_jours_ouvres, date_echeance_cible)
     VALUES ($1,$2,$3,'autre',$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, reference`,
    [reference, type, jour, objet, description, auteur, inscriptionId, sessionId, formationId, reclamation ? 15 : null, reclamation ? datePlusJoursOuvres(jour, 15) : null]);
  await client.query("INSERT INTO historique_qualite (entite_type, entite_id, evenement, nouvelle_valeur) VALUES ('signalement', $1, 'creation', 'portail')", [s.id]);
  return s;
}
function lireSignalement(c = {}) {
  const objet = typeof c.objet === "string" ? c.objet.trim() : "";
  const description = typeof c.description === "string" ? c.description.trim() : "";
  if (!objet || objet.length > 200 || INTERDIT.test(objet)) return { erreur: "Objet obligatoire (200 caractères au plus)." };
  if (description.length > 4000 || INTERDIT.test(description)) return { erreur: "Description : 4000 caractères au plus." };
  return { objet, description: description || null };
}

router.post("/portail/stagiaire/signalement", requirePortail("stagiaire"), wrap(async (req, res) => {
  const l = lireSignalement(req.body);
  if (l.erreur) return res.status(400).json({ error: l.erreur });
  const type = req.body?.type === "reclamation" ? "reclamation" : "incident";
  const inscriptionId = parseIdPositif(req.body?.inscription_id);
  const { rows: [i] } = inscriptionId
    ? await query("SELECT i.id, i.session_id, s.formation_id FROM inscriptions i JOIN sessions s ON s.id = i.session_id WHERE i.id = $1 AND i.stagiaire_id = $2", [inscriptionId, req.portail.stagiaire_id])
    : { rows: [] };
  if (inscriptionId && !i) return res.status(400).json({ error: "Formation inconnue." });
  const { rows: [p] } = await query("SELECT prenom, nom FROM stagiaires WHERE id = $1", [req.portail.stagiaire_id]);
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const s = await creerSignalement(cx, { type, ...l, inscriptionId: i?.id ?? null, sessionId: i?.session_id ?? null, formationId: i?.formation_id ?? null, auteur: `${p.prenom} ${p.nom}`.slice(0, 200) });
    await cx.query("COMMIT");
    res.status(201).json({ reference: s.reference, message: "Votre message a bien été transmis à l'organisme, qui reviendra vers vous." });
  } catch (e) { await cx.query("ROLLBACK").catch(() => {}); throw e; } finally { cx.release(); }
}));

// ── Portail formateur ────────────────────────────────────────
// Sessions du formateur : rattaché à la session (toute la session) ou à un groupe (ce groupe seulement).
async function perimetreFormateur(intervenantId) {
  const { rows } = await query(
    `SELECT s.id AS session_id, NULL::int AS groupe_id FROM intervenants_sessions l JOIN sessions s ON s.id = l.session_id WHERE l.intervenant_id = $1
     UNION SELECT g.session_id, g.id FROM intervenants_groupes l JOIN groupes g ON g.id = l.groupe_id WHERE l.intervenant_id = $1`, [intervenantId]);
  const sessions = new Map();
  for (const r of rows) {
    if (!sessions.has(r.session_id)) sessions.set(r.session_id, { toute: false, groupes: new Set() });
    if (r.groupe_id === null) sessions.get(r.session_id).toute = true; else sessions.get(r.session_id).groupes.add(r.groupe_id);
  }
  return sessions;
}
const visible = (p, sessionId, groupeId) => { const s = p.get(sessionId); return !!s && (s.toute || (groupeId != null && s.groupes.has(groupeId))); };

router.get("/portail/formateur", requirePortail("formateur"), wrap(async (req, res) => {
  const iid = req.portail.intervenant_id;
  const p = await perimetreFormateur(iid);
  const ids = [...p.keys()];
  const [{ rows: sessions }, { rows: stagiaires }, { rows: seances }, { rows: ressources }, { rows: justificatifs }] = await Promise.all([
    query(`SELECT s.id, s.reference, s.date_debut, s.date_fin, s.horaire, s.lieu, s.statut, s.archivee_le, f.intitule AS formation, f.id AS formation_id
           FROM sessions s LEFT JOIN formations f ON f.id = s.formation_id WHERE s.id = ANY($1::int[]) ORDER BY s.date_debut DESC`, [ids]),
    query(`SELECT i.id AS inscription_id, i.session_id, i.groupe_id, i.statut, st.prenom, st.nom, g.nom AS groupe
           FROM inscriptions i JOIN stagiaires st ON st.id = i.stagiaire_id LEFT JOIN groupes g ON g.id = i.groupe_id
           WHERE i.session_id = ANY($1::int[]) AND i.statut <> 'abandon' ORDER BY st.nom, st.prenom`, [ids]),
    query(`SELECT s.id, s.session_id, s.groupe_id, s.date_seance, s.heure_debut, s.heure_fin, s.theme, s.lieu, s.competences, g.nom AS groupe
           FROM seances s LEFT JOIN groupes g ON g.id = s.groupe_id WHERE s.session_id = ANY($1::int[]) ORDER BY s.date_seance, s.heure_debut`, [ids]),
    query(`SELECT r.titre, r.categorie, r.version, r.lien, r.formation_id FROM ressources r JOIN sessions s ON s.formation_id = r.formation_id
           WHERE s.id = ANY($1::int[]) AND r.statut <> 'retire' GROUP BY r.id ORDER BY r.titre`, [ids]),
    query(`SELECT j.categorie, p.titre, p.date_echeance FROM intervenants_justificatifs j JOIN preuves p ON p.id = j.preuve_id WHERE j.intervenant_id = $1 ORDER BY j.categorie`, [iid]),
  ]);
  res.json({
    sessions: sessions.map((s) => ({
      ...s, archivee: !!s.archivee_le,
      stagiaires: stagiaires.filter((x) => x.session_id === s.id && visible(p, s.id, x.groupe_id)).map(({ inscription_id, prenom, nom, groupe, statut }) => ({ inscription_id, prenom, nom, groupe, statut })),
      seances: seances.filter((x) => x.session_id === s.id && (x.groupe_id === null || visible(p, s.id, x.groupe_id))),
      ressources: ressources.filter((r) => r.formation_id === s.formation_id).map(({ formation_id, ...r }) => r),
    })),
    justificatifs,
  });
}));

// Une séance et le suivi de chaque stagiaire concerné (pour la saisie).
async function seanceDuFormateur(intervenantId, seanceId) {
  const { rows: [s] } = await query("SELECT s.id, s.session_id, s.groupe_id, s.date_seance, s.theme, se.archivee_le FROM seances s JOIN sessions se ON se.id = s.session_id WHERE s.id = $1", [seanceId]);
  if (!s) return null;
  const p = await perimetreFormateur(intervenantId);
  if (!p.has(s.session_id) || (s.groupe_id !== null && !visible(p, s.session_id, s.groupe_id))) return null;
  return { seance: s, perimetre: p };
}

router.get("/portail/formateur/seances/:id", requirePortail("formateur"), wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  const r = id ? await seanceDuFormateur(req.portail.intervenant_id, id) : null;
  if (!r) return res.status(404).json({ error: "Séance introuvable." });
  const { rows } = await query(
    `SELECT i.id AS inscription_id, i.groupe_id, st.prenom, st.nom, su.accompagnement, su.difficultes, su.impressions, su.observations
     FROM inscriptions i JOIN stagiaires st ON st.id = i.stagiaire_id LEFT JOIN suivi_seance su ON su.seance_id = $1 AND su.inscription_id = i.id
     WHERE i.session_id = $2 AND i.statut <> 'abandon' AND ($3::int IS NULL OR i.groupe_id = $3) ORDER BY st.nom, st.prenom`, [id, r.seance.session_id, r.seance.groupe_id]);
  res.json({ seance: r.seance, archivee: !!r.seance.archivee_le, suivis: rows.filter((x) => visible(r.perimetre, r.seance.session_id, x.groupe_id)).map(({ groupe_id, ...x }) => x) });
}));

router.put("/portail/formateur/seances/:id/suivi/:inscriptionId", requirePortail("formateur"), wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id); const ins = parseIdPositif(req.params.inscriptionId);
  const r = id && ins ? await seanceDuFormateur(req.portail.intervenant_id, id) : null;
  if (!r) return res.status(404).json({ error: "Séance introuvable." });
  if (r.seance.archivee_le) return res.status(409).json({ error: "Session archivée : consultation seule." });
  const { rows: [i] } = await query("SELECT id, groupe_id FROM inscriptions WHERE id = $1 AND session_id = $2 AND statut <> 'abandon'", [ins, r.seance.session_id]);
  if (!i || (r.seance.groupe_id !== null && i.groupe_id !== r.seance.groupe_id) || !visible(r.perimetre, r.seance.session_id, i.groupe_id)) return res.status(404).json({ error: "Stagiaire introuvable pour cette séance." });
  const champs = {};
  for (const k of ["accompagnement", "difficultes", "impressions", "observations"]) {
    const v = req.body?.[k];
    if (v !== undefined && v !== null && (typeof v !== "string" || v.length > 2000 || INTERDIT.test(v))) return res.status(400).json({ error: "Texte trop long : 2000 caractères au maximum." });
    champs[k] = typeof v === "string" ? v.trim() || null : null;
  }
  await query(
    `INSERT INTO suivi_seance (seance_id, inscription_id, accompagnement, difficultes, impressions, observations)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (seance_id, inscription_id) DO UPDATE SET accompagnement = EXCLUDED.accompagnement, difficultes = EXCLUDED.difficultes,
       impressions = EXCLUDED.impressions, observations = EXCLUDED.observations, updated_at = now()`,
    [id, ins, champs.accompagnement, champs.difficultes, champs.impressions, champs.observations]);
  res.json({ ok: true });
}));

async function inscriptionDuFormateur(intervenantId, inscriptionId) {
  const { rows: [i] } = await query("SELECT i.id, i.session_id, i.groupe_id, s.archivee_le FROM inscriptions i JOIN sessions s ON s.id = i.session_id WHERE i.id = $1 AND i.statut <> 'abandon'", [inscriptionId]);
  if (!i) return null;
  return visible(await perimetreFormateur(intervenantId), i.session_id, i.groupe_id) ? i : null;
}

router.get("/portail/formateur/competences/:inscriptionId", requirePortail("formateur"), wrap(async (req, res) => {
  const id = parseIdPositif(req.params.inscriptionId);
  const i = id ? await inscriptionDuFormateur(req.portail.intervenant_id, id) : null;
  if (!i) return res.status(404).json({ error: "Stagiaire introuvable." });
  const [liste, { rows }] = await Promise.all([competencesDeSession(i.session_id), query("SELECT competence, statut FROM competences_stagiaires WHERE inscription_id = $1", [id])]);
  const m = new Map(rows.map((r) => [r.competence, r.statut]));
  res.json({ competences: liste.map((c) => ({ competence: c, statut: m.get(c) || null })), archivee: !!i.archivee_le });
}));

router.put("/portail/formateur/competences/:inscriptionId", requirePortail("formateur"), wrap(async (req, res) => {
  const id = parseIdPositif(req.params.inscriptionId);
  const i = id ? await inscriptionDuFormateur(req.portail.intervenant_id, id) : null;
  if (!i) return res.status(404).json({ error: "Stagiaire introuvable." });
  if (i.archivee_le) return res.status(409).json({ error: "Session archivée : consultation seule." });
  const { lignes, erreur } = lireCompetences(req.body || {}, await competencesDeSession(i.session_id));
  if (erreur) return res.status(400).json({ error: erreur });
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    await cx.query("DELETE FROM competences_stagiaires WHERE inscription_id = $1 AND competence = ANY($2::text[])", [id, req.body.competences.map((l) => l.competence.trim())]);
    for (const l of lignes) await cx.query("INSERT INTO competences_stagiaires (inscription_id, competence, statut) VALUES ($1,$2,$3)", [id, l.competence, l.statut]);
    await cx.query("COMMIT");
  } catch (e) { await cx.query("ROLLBACK").catch(() => {}); throw e; } finally { cx.release(); }
  res.json({ ok: true });
}));

router.post("/portail/formateur/incident", requirePortail("formateur"), wrap(async (req, res) => {
  const l = lireSignalement(req.body);
  if (l.erreur) return res.status(400).json({ error: l.erreur });
  const sessionId = parseIdPositif(req.body?.session_id);
  const p = await perimetreFormateur(req.portail.intervenant_id);
  if (sessionId && !p.has(sessionId)) return res.status(400).json({ error: "Session inconnue." });
  const { rows: [s] } = sessionId ? await query("SELECT formation_id FROM sessions WHERE id = $1", [sessionId]) : { rows: [] };
  const { rows: [f] } = await query("SELECT prenom, nom FROM intervenants WHERE id = $1", [req.portail.intervenant_id]);
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const sig = await creerSignalement(cx, { type: "incident", ...l, inscriptionId: null, sessionId: sessionId || null, formationId: s?.formation_id ?? null, auteur: `${f.prenom || ""} ${f.nom}`.trim().slice(0, 200) });
    await cx.query("COMMIT");
    res.status(201).json({ reference: sig.reference, message: "Incident transmis à l'organisme." });
  } catch (e) { await cx.query("ROLLBACK").catch(() => {}); throw e; } finally { cx.release(); }
}));

export default router;
