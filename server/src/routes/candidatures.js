// ─────────────────────────────────────────────────────────────
//  Candidatures en ligne (CDC §39).
//  - Public : formations ouvertes à la candidature et leurs prochaines sessions ; dépôt d'une candidature
//    (consentement obligatoire, champ piège anti-robot, débit limité, validation stricte).
//  - Administrateur : étude, pièces reçues, décision motivée, affectation à une session (création ou
//    réutilisation de la fiche personne, inscription), réglage de l'ouverture par formation.
//  Les besoins d'aménagement (donnée potentiellement de santé) ne sortent que pour l'administrateur.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { getPool, query } from "../db.js";
import { requireAdmin } from "../session.js";
import { parseIdPositif } from "../services/ids.js";
import { estDateValide } from "../services/dates.js";
import { journaliser } from "../services/journal.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const STATUTS_CANDIDATURE = { nouvelle: "Nouvelle", en_etude: "En étude", acceptee: "Acceptée", refusee: "Refusée", sans_suite: "Sans suite" };
export const SITUATIONS = ["Demandeur d'emploi", "Salarié", "Jeune de moins de 26 ans", "Bénéficiaire du RSA", "Retraité", "Autre"];
const INTERDIT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f<>{}]/;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const aujourdhui = () => new Date().toISOString().slice(0, 10);

// Valide une candidature publique. Renvoie { valeur } ou { erreur } (message affichable au candidat).
export function lireCandidature(c = {}) {
  const v = {};
  const t = (cle, libelle, max, requis = false) => {
    const brut = c[cle];
    if (brut !== undefined && brut !== null && typeof brut !== "string") return `${libelle} : texte attendu.`;
    const s = (brut || "").trim();
    if (requis && !s) return `${libelle} : champ obligatoire.`;
    if (s.length > max || INTERDIT.test(s)) return `${libelle} : ${max} caractères au plus, sans caractères spéciaux.`;
    v[cle] = s || null; return null;
  };
  const erreur = t("nom", "Nom", 100, true) || t("prenom", "Prénom", 100, true) || t("email", "E-mail", 200) || t("telephone", "Téléphone", 30)
    || t("adresse", "Adresse", 300) || t("code_postal", "Code postal", 10) || t("ville", "Ville", 100) || t("prescripteur", "Structure qui vous oriente", 200)
    || t("motivation", "Motivation", 4000) || t("besoins_amenagement", "Besoins d'aménagement", 2000) || t("situation", "Situation", 100);
  if (erreur) return { erreur };
  if (!v.email && !v.telephone) return { erreur: "Indiquez au moins un e-mail ou un téléphone pour que nous puissions vous recontacter." };
  if (v.email && !EMAIL.test(v.email)) return { erreur: "E-mail invalide." };
  if (v.telephone && !/^[0-9 .+()-]{6,30}$/.test(v.telephone)) return { erreur: "Téléphone invalide." };
  if (v.situation && !SITUATIONS.includes(v.situation)) return { erreur: "Situation inconnue." };
  if (c.civilite !== undefined && c.civilite !== null && c.civilite !== "") {
    if (!["M.", "Mme"].includes(c.civilite)) return { erreur: "Civilité inconnue." };
    v.civilite = c.civilite;
  }
  if (c.date_naissance) {
    const d = String(c.date_naissance);
    if (!estDateValide(d) || d > aujourdhui() || d < "1900-01-01") return { erreur: "Date de naissance invalide." };
    v.date_naissance = d;
  }
  if (c.consentement !== true) return { erreur: "Merci d'accepter le traitement de vos données pour l'étude de votre candidature." };
  return { valeur: v };
}

// fix : limite de débit en mémoire par adresse (anti-remplissage automatisé).
const compteurs = new Map();
function limite(cle, max = 10, fenetreMs = 60 * 60 * 1000) {
  const m = Date.now();
  const c = compteurs.get(cle);
  if (!c || c.fin < m) { if (compteurs.size > 10000) compteurs.clear(); compteurs.set(cle, { n: 1, fin: m + fenetreMs }); return true; }
  c.n += 1;
  return c.n <= max;
}

async function formationsOuvertes() {
  const { rows } = await query(
    `SELECT f.id, f.intitule, f.pieces_attendues, fv.objectifs, fv.public_vise, fv.prerequis, fv.duree_heures_defaut, fv.modalite,
            COALESCE((SELECT json_agg(json_build_object('id', s.id, 'reference', s.reference, 'date_debut', s.date_debut, 'date_fin', s.date_fin, 'lieu', s.lieu) ORDER BY s.date_debut)
                      FROM sessions s WHERE s.formation_id = f.id AND s.date_debut >= CURRENT_DATE AND s.statut <> 'annulee' AND s.archivee_le IS NULL), '[]') AS sessions
     FROM formations f
     LEFT JOIN LATERAL (SELECT * FROM formation_versions v WHERE v.formation_id = f.id ORDER BY v.numero DESC LIMIT 1) fv ON true
     WHERE f.candidature_ouverte AND f.actif ORDER BY f.intitule`);
  return rows;
}

// ── Public ───────────────────────────────────────────────────
router.get("/public/candidature", wrap(async (_req, res) => {
  const { rows: [o] } = await query("SELECT nom, email, telephone, ville FROM parametres_organisme WHERE id = 1");
  res.setHeader("Cache-Control", "no-store");
  res.json({ organisme: o || {}, formations: await formationsOuvertes(), situations: SITUATIONS });
}));

router.post("/public/candidatures", wrap(async (req, res) => {
  const c = req.body || {};
  // Champ piège invisible pour un humain : rempli = robot. Réponse neutre, rien n'est enregistré.
  if (c.site_web) return res.status(201).json({ ok: true, message: "Merci, votre candidature a bien été reçue." });
  if (!limite(req.ip)) return res.status(429).json({ error: "Trop de candidatures envoyées depuis cet appareil. Réessayez plus tard ou contactez-nous." });
  const formationId = parseIdPositif(c.formation_id);
  if (!formationId) return res.status(400).json({ error: "Choisissez la formation." });
  const formation = (await formationsOuvertes()).find((f) => f.id === formationId);
  if (!formation) return res.status(400).json({ error: "Cette formation n'est pas ouverte à la candidature." });
  let session = null;
  if (c.session_souhaitee_id) {
    session = parseIdPositif(c.session_souhaitee_id);
    if (!session || !formation.sessions.some((s) => s.id === session)) return res.status(400).json({ error: "Session inconnue pour cette formation." });
  }
  const l = lireCandidature(c);
  if (l.erreur) return res.status(400).json({ error: l.erreur });
  const v = l.valeur;
  const cols = Object.keys(v);
  await query(
    `INSERT INTO candidatures (formation_id, session_souhaitee_id, consentement_le, ${cols.join(", ")}) VALUES ($1, $2, now(), ${cols.map((_, i) => "$" + (i + 3)).join(", ")})`,
    [formationId, session, ...cols.map((k) => v[k])]);
  res.status(201).json({ ok: true, message: "Merci, votre candidature a bien été reçue. Nous vous recontacterons rapidement." + (formation.pieces_attendues?.length ? " Préparez les pièces indiquées." : "") });
}));

// ── Administrateur ───────────────────────────────────────────
const COLONNES = `c.*, f.intitule AS formation, f.pieces_attendues, s.reference AS session_souhaitee_reference, s.date_debut AS session_souhaitee_debut,
  ua.nom AS decision_par_nom, i.session_id AS session_affectee_id`;
const FROM = `FROM candidatures c JOIN formations f ON f.id = c.formation_id LEFT JOIN sessions s ON s.id = c.session_souhaitee_id
  LEFT JOIN utilisateurs ua ON ua.id = c.decision_par LEFT JOIN inscriptions i ON i.id = c.inscription_id`;

router.get("/candidatures", requireAdmin, wrap(async (req, res) => {
  const statut = Object.hasOwn(STATUTS_CANDIDATURE, req.query.statut || "") ? req.query.statut : null;
  const { rows } = await query(`SELECT ${COLONNES} ${FROM} ${statut ? "WHERE c.statut = $1" : ""} ORDER BY (c.statut IN ('nouvelle','en_etude')) DESC, c.cree_le DESC`, statut ? [statut] : []);
  const { rows: formations } = await query("SELECT id, intitule, candidature_ouverte, pieces_attendues FROM formations WHERE actif ORDER BY intitule");
  res.json({ candidatures: rows, statuts: STATUTS_CANDIDATURE, formations });
}));

router.patch("/candidatures/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const c = req.body || {};
  const v = {};
  if (c.statut !== undefined) {
    if (!Object.hasOwn(STATUTS_CANDIDATURE, c.statut)) return res.status(400).json({ error: "Statut inconnu." });
    if (c.statut === "acceptee") return res.status(400).json({ error: "Une candidature est acceptée en l'affectant à une session." });
    v.statut = c.statut;
  }
  for (const [cle, max] of [["notes", 4000], ["motif_decision", 1000]]) {
    if (c[cle] === undefined) continue;
    if (c[cle] !== null && (typeof c[cle] !== "string" || c[cle].length > max)) return res.status(400).json({ error: `${cle === "notes" ? "Notes" : "Motif"} : ${max} caractères au plus.` });
    v[cle] = c[cle]?.trim() || null;
  }
  if (c.pieces_recues !== undefined) {
    if (!Array.isArray(c.pieces_recues) || c.pieces_recues.length > 30 || c.pieces_recues.some((p) => typeof p !== "string" || p.length > 150)) return res.status(400).json({ error: "Pièces reçues invalides." });
    v.pieces_recues = [...new Set(c.pieces_recues.map((p) => p.trim()).filter(Boolean))];
  }
  const cols = Object.keys(v);
  if (!cols.length) return res.status(400).json({ error: "Rien à modifier." });
  const decision = ["refusee", "sans_suite"].includes(v.statut) ? ", decision_le = now(), decision_par = $" + (cols.length + 2) : "";
  const params = [id, ...cols.map((k) => v[k]), ...(decision ? [req.user.id] : [])];
  const { rows: [r] } = await query(`UPDATE candidatures SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}${decision}, mis_a_jour_le = now() WHERE id = $1 AND statut <> 'acceptee' RETURNING id`, params);
  if (!r) return res.status(409).json({ error: "Candidature introuvable ou déjà acceptée (elle ne se modifie plus)." });
  const { rows: [cand] } = await query(`SELECT ${COLONNES} ${FROM} WHERE c.id = $1`, [id]);
  res.json({ candidature: cand });
}));

// Acceptation = affectation à une session : fiche personne réutilisée si elle existe déjà (même e-mail, ou mêmes
// nom, prénom et date de naissance), sinon créée ; inscription créée. Tout ou rien.
router.post("/candidatures/:id/affecter", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  const sessionId = parseIdPositif(req.body?.session_id);
  if (!id || !sessionId) return res.status(400).json({ error: "Candidature ou session invalide." });
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [c] } = await cx.query("SELECT * FROM candidatures WHERE id = $1 FOR UPDATE", [id]);
    if (!c) { await cx.query("ROLLBACK"); return res.status(404).json({ error: "Candidature introuvable." }); }
    if (c.statut === "acceptee") { await cx.query("ROLLBACK"); return res.status(409).json({ error: "Candidature déjà acceptée." }); }
    const { rows: [s] } = await cx.query("SELECT id, formation_id, archivee_le FROM sessions WHERE id = $1", [sessionId]);
    if (!s || s.archivee_le) { await cx.query("ROLLBACK"); return res.status(400).json({ error: "Session introuvable ou archivée." }); }
    if (s.formation_id !== c.formation_id) { await cx.query("ROLLBACK"); return res.status(400).json({ error: "Cette session ne relève pas de la formation demandée." }); }
    let stagiaire = null;
    if (c.email) stagiaire = (await cx.query("SELECT id FROM stagiaires WHERE lower(email) = lower($1) AND anonymise_le IS NULL ORDER BY id LIMIT 1", [c.email])).rows[0];
    if (!stagiaire && c.date_naissance) {
      stagiaire = (await cx.query("SELECT id FROM stagiaires WHERE lower(nom) = lower($1) AND lower(prenom) = lower($2) AND date_naissance = $3 AND anonymise_le IS NULL ORDER BY id LIMIT 1",
        [c.nom, c.prenom, c.date_naissance])).rows[0];
    }
    const reutilise = !!stagiaire;
    if (!stagiaire) {
      ({ rows: [stagiaire] } = await cx.query(
        `INSERT INTO stagiaires (civilite, nom, prenom, email, telephone, date_naissance, adresse, code_postal, ville)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [c.civilite, c.nom, c.prenom, c.email, c.telephone, c.date_naissance, c.adresse, c.code_postal, c.ville]));
    }
    const { rowCount: deja } = await cx.query("SELECT 1 FROM inscriptions WHERE stagiaire_id = $1 AND session_id = $2", [stagiaire.id, sessionId]);
    if (deja) { await cx.query("ROLLBACK"); return res.status(409).json({ error: "Cette personne est déjà inscrite à cette session." }); }
    const { rows: [insc] } = await cx.query(
      "INSERT INTO inscriptions (stagiaire_id, session_id, statut, date_inscription) VALUES ($1, $2, 'inscrit', CURRENT_DATE) RETURNING id", [stagiaire.id, sessionId]);
    // Besoins d'aménagement déclarés : repris dans la fiche (réservée à l'administrateur), jamais écrasés.
    if (c.besoins_amenagement) {
      await cx.query("UPDATE stagiaires SET besoins_adaptation = COALESCE(besoins_adaptation, $2) WHERE id = $1", [stagiaire.id, c.besoins_amenagement]);
    }
    await cx.query("UPDATE candidatures SET statut = 'acceptee', stagiaire_id = $2, inscription_id = $3, decision_le = now(), decision_par = $4, mis_a_jour_le = now() WHERE id = $1",
      [id, stagiaire.id, insc.id, req.user.id]);
    await cx.query("COMMIT");
    res.json({ ok: true, stagiaire_id: stagiaire.id, inscription_id: insc.id, fiche_existante: reutilise });
  } catch (e) { await cx.query("ROLLBACK").catch(() => {}); throw e; } finally { cx.release(); }
}));

router.delete("/candidatures/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const { rowCount } = await query("DELETE FROM candidatures WHERE id = $1 AND statut <> 'acceptee'", [id]);
  if (!rowCount) return res.status(409).json({ error: "Une candidature acceptée ne se supprime pas (la personne est inscrite)." });
  await journaliser("candidature_supprimee", { cibleType: "candidature", cibleId: id, par: req.user.id });
  res.json({ ok: true });
}));

router.patch("/formations/:id/candidature", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const c = req.body || {};
  const v = {};
  if (c.candidature_ouverte !== undefined) v.candidature_ouverte = c.candidature_ouverte === true;
  if (c.pieces_attendues !== undefined) {
    if (!Array.isArray(c.pieces_attendues) || c.pieces_attendues.length > 30) return res.status(400).json({ error: "Pièces attendues : 30 au plus." });
    const pieces = [...new Set(c.pieces_attendues.map((p) => String(p ?? "").trim()).filter(Boolean))];
    if (pieces.some((p) => p.length > 150 || INTERDIT.test(p))) return res.status(400).json({ error: "Pièce attendue : 150 caractères au plus." });
    v.pieces_attendues = pieces;
  }
  const cols = Object.keys(v);
  if (!cols.length) return res.status(400).json({ error: "Rien à modifier." });
  const { rows: [f] } = await query(`UPDATE formations SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1 RETURNING id, intitule, candidature_ouverte, pieces_attendues`,
    [id, ...cols.map((k) => v[k])]);
  if (!f) return res.status(404).json({ error: "Formation introuvable." });
  res.json({ formation: f });
}));

export default router;
