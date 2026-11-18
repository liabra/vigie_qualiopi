// ─────────────────────────────────────────────────────────────
//  Enquêtes en ligne (CDC §34) : création depuis un modèle, questions modifiables tant qu'aucune réponse
//  n'est arrivée, lien public à jeton (sans compte), synthèse explicable, exploitation tracée (analyse) et
//  passage à l'action. Une réponse = une ligne `satisfactions` (exploitée par la synthèse existante).
//  Route publique : jeton aléatoire non devinable, réponses strictement validées, débit limité par adresse.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import crypto from "node:crypto";
import { getPool, query } from "../db.js";
import { requireAdmin } from "../session.js";
import { parseIdPositif } from "../services/ids.js";
import { estDateValide } from "../services/dates.js";
import { MODELES_ENQUETE, TYPES_ENQUETE, TYPES_QUESTION, syntheseQuestion, validerQuestions, validerReponses } from "../services/enquetes.js";
import { csv } from "../services/zip.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const JETON = /^[A-Za-z0-9_-]{24,64}$/;
const aujourdhui = () => new Date().toISOString().slice(0, 10);

const COLONNES = `e.id, e.titre, e.type, e.session_id, e.introduction, e.jeton, e.ouverte, e.date_fin, e.analyse_resultats AS analyse, e.analysee_le, e.cree_le,
  s.reference AS session_reference, s.date_debut, s.date_fin AS session_fin, f.intitule AS formation, ua.nom AS analysee_par_nom,
  (SELECT count(*)::int FROM satisfactions x WHERE x.enquete_id = e.id) AS reponses,
  (SELECT count(*)::int FROM inscriptions i WHERE i.session_id = e.session_id AND i.statut <> 'abandon') AS inscrits`;
const FROM = "FROM enquetes e JOIN sessions s ON s.id = e.session_id LEFT JOIN formations f ON f.id = s.formation_id LEFT JOIN utilisateurs ua ON ua.id = e.analysee_par";
const ouverte = (e) => e.ouverte && (!e.date_fin || String(e.date_fin).slice(0, 10) >= aujourdhui());
const enrichir = (e) => ({ ...e, active: ouverte(e), taux_reponse: e.inscrits && ["a_chaud", "a_froid"].includes(e.type) ? Math.round((e.reponses / e.inscrits) * 100) : null });

async function questionsDe(id) {
  return (await query("SELECT id, ordre, libelle, type, options, obligatoire, globale FROM enquete_questions WHERE enquete_id = $1 ORDER BY ordre, id", [id])).rows;
}
async function enregistrerQuestions(cx, id, questions) {
  await cx.query("DELETE FROM enquete_questions WHERE enquete_id = $1", [id]);
  for (const [i, q] of questions.entries()) {
    await cx.query("INSERT INTO enquete_questions (enquete_id, ordre, libelle, type, options, obligatoire, globale) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, i + 1, q.libelle, q.type, q.options, q.obligatoire, q.globale]);
  }
}

function lireEnquete(c, { complet }) {
  const v = {};
  if (complet || c.titre !== undefined) {
    const t = typeof c.titre === "string" ? c.titre.trim() : "";
    if (!t || t.length > 200) return { erreur: "Intitulé obligatoire (200 caractères au plus)." };
    v.titre = t;
  }
  if (complet || c.type !== undefined) { if (!Object.hasOwn(TYPES_ENQUETE, c.type)) return { erreur: "Type d'enquête inconnu." }; v.type = c.type; }
  if (c.introduction !== undefined) {
    if (c.introduction !== null && (typeof c.introduction !== "string" || c.introduction.length > 2000)) return { erreur: "Introduction : 2000 caractères au plus." };
    v.introduction = c.introduction?.trim() || null;
  }
  if (c.date_fin !== undefined) {
    const d = c.date_fin === null ? "" : String(c.date_fin);
    if (d && !estDateValide(d)) return { erreur: "Date de clôture invalide." };
    v.date_fin = d || null;
  }
  if (c.ouverte !== undefined) v.ouverte = c.ouverte === true;
  if (c.analyse !== undefined) {
    if (c.analyse !== null && (typeof c.analyse !== "string" || c.analyse.length > 8000)) return { erreur: "Analyse : 8000 caractères au plus." };
    v.analyse = c.analyse?.trim() || null;
  }
  return { valeur: v };
}

router.get("/enquetes/modeles", requireAdmin, (_req, res) => {
  res.json({ modeles: Object.entries(MODELES_ENQUETE).map(([code, m]) => ({ code, ...m })), types: TYPES_ENQUETE, types_question: TYPES_QUESTION });
});

router.get("/enquetes", requireAdmin, wrap(async (req, res) => {
  const session = req.query.session_id ? parseIdPositif(req.query.session_id) : null;
  const { rows } = await query(`SELECT ${COLONNES} ${FROM} ${session ? "WHERE e.session_id = $1" : ""} ORDER BY e.cree_le DESC`, session ? [session] : []);
  res.json({ enquetes: rows.map(enrichir), types: TYPES_ENQUETE });
}));

router.post("/enquetes", requireAdmin, wrap(async (req, res) => {
  const c = req.body || {};
  const modele = c.modele ? MODELES_ENQUETE[c.modele] : null;
  if (c.modele && !modele) return res.status(400).json({ error: "Modèle inconnu." });
  const l = lireEnquete({ ...(modele || {}), ...c, questions: undefined }, { complet: true });
  if (l.erreur) return res.status(400).json({ error: l.erreur });
  const vq = validerQuestions(c.questions ?? modele?.questions);
  if (vq.erreur) return res.status(400).json({ error: vq.erreur });
  const session = parseIdPositif(c.session_id);
  if (!session || !(await query("SELECT 1 FROM sessions WHERE id = $1", [session])).rowCount) return res.status(400).json({ error: "Session introuvable." });
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const v = l.valeur;
    const { rows: [e] } = await cx.query(
      "INSERT INTO enquetes (titre, type, session_id, introduction, date_fin, jeton, cree_par) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [v.titre, v.type, session, v.introduction ?? modele?.introduction ?? null, v.date_fin ?? null, crypto.randomBytes(24).toString("base64url"), req.user.id]);
    await enregistrerQuestions(cx, e.id, vq.questions);
    await cx.query("COMMIT");
    const { rows: [cree] } = await query(`SELECT ${COLONNES} ${FROM} WHERE e.id = $1`, [e.id]);
    res.status(201).json({ enquete: enrichir(cree) });
  } catch (err) { await cx.query("ROLLBACK").catch(() => {}); throw err; } finally { cx.release(); }
}));

router.get("/enquetes/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const { rows: [e] } = await query(`SELECT ${COLONNES} ${FROM} WHERE e.id = $1`, [id]);
  if (!e) return res.status(404).json({ error: "Enquête introuvable." });
  const questions = await questionsDe(id);
  const { rows: lignes } = await query("SELECT reponses, note_globale, date_recueil FROM satisfactions WHERE enquete_id = $1 ORDER BY id", [id]);
  const globale = questions.find((q) => q.globale);
  const synthese = questions.map((q) => syntheseQuestion(q, lignes));
  const sg = globale ? synthese.find((s) => s.question_id === globale.id) : null;
  // Alerte d'exploitation (CDC §28/§49) : résultats insuffisants ou enquête close sans analyse.
  const alertes = [];
  if (sg?.reponses >= 3 && (sg.taux_satisfaits < 70 || sg.moyenne < 3.5)) alertes.push("Satisfaction globale en dessous de 70 % de satisfaits (ou moyenne inférieure à 3,5) : une analyse et une action d'amélioration sont recommandées.");
  if (!ouverte(e) && lignes.length && !e.analyse) alertes.push("Enquête close sans analyse : renseignez la conclusion tirée des résultats.");
  res.json({ enquete: enrichir(e), questions, synthese, alertes, types: TYPES_ENQUETE, types_question: TYPES_QUESTION });
}));

router.patch("/enquetes/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const l = lireEnquete(req.body || {}, { complet: false });
  if (l.erreur) return res.status(400).json({ error: l.erreur });
  if (l.valeur.type !== undefined) return res.status(400).json({ error: "Le type d'une enquête ne change pas après sa création." });
  const v = l.valeur;
  const cols = Object.keys(v);
  if (!cols.length) return res.status(400).json({ error: "Rien à modifier." });
  // « analyse » est un mot réservé PostgreSQL : la colonne s'appelle analyse_resultats.
  const { rowCount } = await query(`UPDATE enquetes SET ${cols.map((c, i) => `${c === "analyse" ? "analyse_resultats" : c} = $${i + 2}`).join(", ")}, mis_a_jour_le = now() WHERE id = $1`,
    [id, ...cols.map((c) => v[c])]);
  // Exploitation tracée : qui a analysé, et quand (effacée avec l'analyse).
  if (rowCount && v.analyse !== undefined) {
    await query("UPDATE enquetes SET analysee_le = CASE WHEN analyse_resultats IS NULL THEN NULL ELSE now() END, analysee_par = CASE WHEN analyse_resultats IS NULL THEN NULL ELSE $2::int END WHERE id = $1", [id, req.user.id]);
  }
  if (!rowCount) return res.status(404).json({ error: "Enquête introuvable." });
  const { rows: [e] } = await query(`SELECT ${COLONNES} ${FROM} WHERE e.id = $1`, [id]);
  res.json({ enquete: enrichir(e) });
}));

router.put("/enquetes/:id/questions", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const vq = validerQuestions(req.body?.questions);
  if (vq.erreur) return res.status(400).json({ error: vq.erreur });
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [e] } = await cx.query("SELECT id, (SELECT count(*)::int FROM satisfactions WHERE enquete_id = $1) AS n FROM enquetes WHERE id = $1 FOR UPDATE", [id]);
    if (!e) { await cx.query("ROLLBACK"); return res.status(404).json({ error: "Enquête introuvable." }); }
    // fix : jamais de questions modifiées sous des réponses déjà reçues (résultats incohérents).
    if (e.n > 0) { await cx.query("ROLLBACK"); return res.status(409).json({ error: "Des réponses ont déjà été reçues : les questions ne peuvent plus changer. Créez une nouvelle enquête." }); }
    await enregistrerQuestions(cx, id, vq.questions);
    await cx.query("COMMIT");
  } catch (err) { await cx.query("ROLLBACK").catch(() => {}); throw err; } finally { cx.release(); }
  res.json({ questions: await questionsDe(id) });
}));

router.delete("/enquetes/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const { rowCount } = await query("DELETE FROM enquetes e WHERE e.id = $1 AND NOT EXISTS (SELECT 1 FROM satisfactions s WHERE s.enquete_id = e.id)", [id]);
  if (!rowCount) return res.status(409).json({ error: "Une enquête qui a reçu des réponses se ferme, elle ne se supprime pas." });
  res.json({ ok: true });
}));

router.get("/enquetes/:id/export", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const questions = await questionsDe(id);
  if (!questions.length) return res.status(404).json({ error: "Enquête introuvable." });
  const { rows } = await query("SELECT date_recueil, reponses FROM satisfactions WHERE enquete_id = $1 ORDER BY id", [id]);
  const valeur = (v) => (Array.isArray(v) ? v.join(", ") : v);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="enquete-${id}.csv"`);
  res.send(csv(["Date", ...questions.map((q) => q.libelle)], rows.map((r) => [r.date_recueil, ...questions.map((q) => valeur(r.reponses?.[q.id]?.valeur))])));
}));

// Insatisfaction → analyse → action (CDC §49) : tâche d'analyse rattachée à l'enquête, sans doublon.
router.post("/enquetes/:id/tache", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const { rows: [e] } = await query("SELECT titre FROM enquetes WHERE id = $1", [id]);
  if (!e) return res.status(404).json({ error: "Enquête introuvable." });
  const titre = `Analyser les résultats de l'enquête « ${e.titre} » et décider des actions`.slice(0, 200);
  const { rowCount } = await query("SELECT 1 FROM taches_qualite WHERE titre = $1 AND statut IN ('a_faire','en_cours')", [titre]);
  if (rowCount) return res.status(409).json({ error: "Une tâche d'analyse est déjà ouverte pour cette enquête." });
  const { rows: ind } = await query("SELECT i.id FROM indicateurs i JOIN referentiel_versions v ON v.id = i.version_id AND v.est_active WHERE i.numero IN (30, 32)");
  const { rows: [t] } = await query(
    "INSERT INTO taches_qualite (titre, priorite, origine, indicateur_ids, echeance, cree_par) VALUES ($1,'haute','enquete',$2, CURRENT_DATE + 15, $3) RETURNING id",
    [titre, ind.map((r) => r.id), req.user.id]);
  await query("INSERT INTO historique_qualite (entite_type, entite_id, evenement, par) VALUES ('tache', $1, 'creation', $2)", [t.id, req.user.id]);
  res.status(201).json({ tache_id: t.id });
}));

// ── Réponse publique (sans compte) ───────────────────────────
// fix : limite de débit en mémoire par adresse et par enquête (anti-remplissage automatisé).
const compteurs = new Map();
function limite(cle, max = 20, fenetreMs = 10 * 60 * 1000) {
  const maintenant = Date.now();
  const c = compteurs.get(cle);
  if (!c || c.fin < maintenant) { compteurs.set(cle, { n: 1, fin: maintenant + fenetreMs }); return true; }
  if (compteurs.size > 10000) compteurs.clear();
  c.n += 1;
  return c.n <= max;
}

async function enquetePublique(jeton) {
  if (!JETON.test(String(jeton || ""))) return null;
  const { rows: [e] } = await query(
    `SELECT e.id, e.titre, e.type, e.introduction, e.ouverte, e.date_fin, e.session_id, f.intitule AS formation, po.nom AS organisme
     FROM enquetes e JOIN sessions s ON s.id = e.session_id LEFT JOIN formations f ON f.id = s.formation_id
     LEFT JOIN parametres_organisme po ON po.id = 1 WHERE e.jeton = $1`, [jeton]);
  return e || null;
}

router.get("/public/enquetes/:jeton", wrap(async (req, res) => {
  const e = await enquetePublique(req.params.jeton);
  if (!e) return res.status(404).json({ error: "Ce questionnaire est introuvable." });
  if (!ouverte(e)) return res.status(410).json({ error: "Ce questionnaire est clos. Merci de votre participation." });
  const questions = (await questionsDe(e.id)).map(({ id, libelle, type, options, obligatoire }) => ({ id, libelle, type, options, obligatoire }));
  res.setHeader("Cache-Control", "no-store");
  res.json({ enquete: { titre: e.titre, introduction: e.introduction, formation: e.formation, organisme: e.organisme }, questions });
}));

router.post("/public/enquetes/:jeton/reponses", wrap(async (req, res) => {
  const e = await enquetePublique(req.params.jeton);
  if (!e) return res.status(404).json({ error: "Ce questionnaire est introuvable." });
  if (!ouverte(e)) return res.status(410).json({ error: "Ce questionnaire est clos." });
  if (!limite(`${req.ip}:${e.id}`)) return res.status(429).json({ error: "Trop de réponses envoyées depuis cet appareil. Réessayez plus tard." });
  const v = validerReponses(await questionsDe(e.id), req.body);
  if (v.erreur) return res.status(400).json({ error: v.erreur });
  await query(
    "INSERT INTO satisfactions (session_id, type, date_recueil, note_globale, note_max, commentaires, reponses, enquete_id) VALUES ($1,$2,CURRENT_DATE,$3,5,$4,$5,$6)",
    [e.session_id, e.type, v.noteGlobale, v.commentaires, JSON.stringify(v.reponses), e.id]);
  res.status(201).json({ ok: true, message: "Merci ! Votre réponse a bien été enregistrée." });
}));

export default router;
