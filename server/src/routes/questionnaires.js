// ─────────────────────────────────────────────────────────────
//  Q2-4 — Questionnaires personnalisables par formation.
//
//  Administration (sélection d'une formation, questions, ordre) : réservée
//  aux administrateurs, même logique que modèles/prescripteurs/formations
//  (requireAdmin, cf. session.js).
//  Saisie des réponses par inscription : droits de l'accompagnement
//  (lecture authentifiée, écriture admin + contributeur — requireRedacteur),
//  exactement comme recueils_besoin (parcours.js). Session archivée :
//  lecture seule.
//
//  Le questionnaire eSenior (pages 3-4 du document actuel) n'est pas
//  concerné : aucune route ici ne le lit ni ne l'écrit.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { query, getPool } from "../db.js";
import { requireAdmin, requireAuth, requireRedacteur } from "../session.js";
import { parseIdPositif } from "../services/ids.js";
import { MSG_ARCHIVEE } from "../services/archive.js";
import { lireQuestion, lireReponse, reponseAffichage, MAX_QUESTIONS } from "../services/questionnaires.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const COLONNES_QUESTION = "id, questionnaire_id, ordre, libelle, type, options, obligatoire";

// ── Administration : questionnaire d'une formation ──────────────────

async function formationExiste(id) {
  const { rows: [f] } = await query("SELECT id, intitule FROM formations WHERE id = $1", [id]);
  return f || null;
}

router.get("/formations/:id/questionnaire", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de formation invalide." });
  const formation = await formationExiste(id);
  if (!formation) return res.status(404).json({ error: "Formation introuvable." });
  const { rows: [questionnaire] } = await query(
    "SELECT id, formation_id, nom, actif FROM questionnaires WHERE formation_id = $1", [id]);
  const { rows: questions } = questionnaire
    ? await query(`SELECT ${COLONNES_QUESTION}, archivee FROM questionnaire_questions WHERE questionnaire_id = $1 ORDER BY archivee, ordre`, [questionnaire.id])
    : { rows: [] };
  res.json({ questionnaire: questionnaire || null, questions });
}));

// Crée (si absent) ou renomme/active le questionnaire de la formation.
// Pas de suppression : un questionnaire sans question n'affecte rien.
router.put("/formations/:id/questionnaire", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de formation invalide." });
  const formation = await formationExiste(id);
  if (!formation) return res.status(404).json({ error: "Formation introuvable." });
  const nom = String(req.body?.nom ?? "").trim() || `Questionnaire — ${formation.intitule}`;
  if (nom.length > 200) return res.status(400).json({ error: "Nom du questionnaire trop long (200 caractères au plus)." });
  const actif = req.body?.actif !== false;
  const { rows: [questionnaire] } = await query(
    `INSERT INTO questionnaires (formation_id, nom, actif, cree_par)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (formation_id) DO UPDATE SET nom = EXCLUDED.nom, actif = EXCLUDED.actif
     RETURNING id, formation_id, nom, actif`,
    [id, nom, actif, req.user.id]
  );
  res.json({ questionnaire });
}));

async function questionnaireDeLaFormation(formationId) {
  const { rows: [q] } = await query("SELECT id, formation_id, nom, actif FROM questionnaires WHERE formation_id = $1", [formationId]);
  return q || null;
}

// Ajoute une question. Crée le questionnaire de la formation s'il
// n'existe pas encore (une formation « adopte » le système dès sa
// première question, sans étape de création séparée).
router.post("/formations/:id/questionnaire/questions", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de formation invalide." });
  const formation = await formationExiste(id);
  if (!formation) return res.status(404).json({ error: "Formation introuvable." });
  const { champs, erreur } = lireQuestion(req.body || {});
  if (erreur) return res.status(400).json({ error: erreur });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    let { rows: [questionnaire] } = await client.query("SELECT id FROM questionnaires WHERE formation_id = $1", [id]);
    if (!questionnaire) {
      ({ rows: [questionnaire] } = await client.query(
        `INSERT INTO questionnaires (formation_id, nom, cree_par) VALUES ($1, $2, $3) RETURNING id`,
        [id, `Questionnaire — ${formation.intitule}`, req.user.id]
      ));
    }
    const { rows: [{ total }] } = await client.query(
      "SELECT count(*)::int AS total FROM questionnaire_questions WHERE questionnaire_id = $1", [questionnaire.id]);
    if (total >= MAX_QUESTIONS) { await client.query("ROLLBACK"); return res.status(400).json({ error: `${MAX_QUESTIONS} questions au plus par questionnaire.` }); }
    const { rows: [{ max_ordre }] } = await client.query(
      "SELECT COALESCE(max(ordre), 0)::int AS max_ordre FROM questionnaire_questions WHERE questionnaire_id = $1", [questionnaire.id]);
    const { rows: [question] } = await client.query(
      `INSERT INTO questionnaire_questions (questionnaire_id, ordre, libelle, type, options, obligatoire)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLONNES_QUESTION}`,
      [questionnaire.id, max_ordre + 1, champs.libelle, champs.type, champs.options, champs.obligatoire]
    );
    await client.query("COMMIT");
    res.status(201).json({ question });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}));

async function questionAvecFormation(id) {
  const { rows: [q] } = await query(
    `SELECT q.id, q.questionnaire_id, q.archivee, qn.formation_id
     FROM questionnaire_questions q JOIN questionnaires qn ON qn.id = q.questionnaire_id
     WHERE q.id = $1`, [id]);
  return q || null;
}

router.patch("/questionnaire-questions/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de question invalide." });
  const avant = await questionAvecFormation(id);
  if (!avant) return res.status(404).json({ error: "Question introuvable." });
  const { champs, erreur } = lireQuestion(req.body || {});
  if (erreur) return res.status(400).json({ error: erreur });
  const { rows: [question] } = await query(
    `UPDATE questionnaire_questions SET libelle = $2, type = $3, options = $4, obligatoire = $5
     WHERE id = $1 RETURNING ${COLONNES_QUESTION}`,
    [id, champs.libelle, champs.type, champs.options, champs.obligatoire]
  );
  res.json({ question });
}));

// « Suppression » = archivage : jamais une ligne physiquement retirée,
// pour ne jamais invalider une réponse déjà recueillie.
router.delete("/questionnaire-questions/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de question invalide." });
  const avant = await questionAvecFormation(id);
  if (!avant) return res.status(404).json({ error: "Question introuvable." });
  await query("UPDATE questionnaire_questions SET archivee = true WHERE id = $1", [id]);
  res.json({ ok: true });
}));

router.post("/questionnaire-questions/:id/reactiver", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de question invalide." });
  const avant = await questionAvecFormation(id);
  if (!avant) return res.status(404).json({ error: "Question introuvable." });
  const { rows: [{ max_ordre }] } = await query(
    "SELECT COALESCE(max(ordre), 0)::int AS max_ordre FROM questionnaire_questions WHERE questionnaire_id = $1", [avant.questionnaire_id]);
  const { rows: [question] } = await query(
    `UPDATE questionnaire_questions SET archivee = false, ordre = $2 WHERE id = $1 RETURNING ${COLONNES_QUESTION}`,
    [id, max_ordre + 1]
  );
  res.json({ question });
}));

// Réordonne les questions ACTIVES du questionnaire : `ordre` est la liste
// complète de leurs identifiants dans le nouvel ordre voulu.
router.put("/formations/:id/questionnaire/questions/ordre", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de formation invalide." });
  const questionnaire = await questionnaireDeLaFormation(id);
  if (!questionnaire) return res.status(404).json({ error: "Cette formation n'a pas encore de questionnaire." });
  const ids = Array.isArray(req.body?.ordre) ? req.body.ordre.map(Number) : null;
  if (!ids || ids.some((n) => !Number.isInteger(n) || n <= 0)) return res.status(400).json({ error: "Ordre invalide." });
  const { rows: actives } = await query(
    "SELECT id FROM questionnaire_questions WHERE questionnaire_id = $1 AND archivee = false", [questionnaire.id]);
  const attendues = new Set(actives.map((q) => q.id));
  if (ids.length !== attendues.size || !ids.every((qid) => attendues.has(qid))) {
    return res.status(400).json({ error: "La liste doit contenir exactement les questions actives de ce questionnaire." });
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Unicité de l'ordre vérifiée au COMMIT (contrainte différée) : les questions actives
    // prennent 1..n, les archivées sont renumérotées à la suite pour ne jamais gêner.
    for (let i = 0; i < ids.length; i++) {
      await client.query("UPDATE questionnaire_questions SET ordre = $2 WHERE id = $1", [ids[i], i + 1]);
    }
    await client.query(
      `UPDATE questionnaire_questions q SET ordre = $2 + r.rang
       FROM (SELECT id, row_number() OVER (ORDER BY ordre, id) AS rang
             FROM questionnaire_questions WHERE questionnaire_id = $1 AND archivee) r
       WHERE q.id = r.id`,
      [questionnaire.id, ids.length]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  res.json({ ok: true });
}));

// ── Contributeur : réponses d'une inscription ────────────────────────

async function inscriptionAvecFormation(id) {
  const { rows: [i] } = await query(
    `SELECT i.id, s.archivee_le, s.formation_id FROM inscriptions i JOIN sessions s ON s.id = i.session_id WHERE i.id = $1`, [id]);
  return i || null;
}

// Le questionnaire de LA formation du stagiaire, avec, pour chacune de ses
// questions actives, la réponse déjà enregistrée pour CETTE inscription
// (instantané inclus). `questionnaire: null` si la formation n'en a pas
// (ou n'en a pas encore adopté un) — c'est le cas d'eSenior aujourd'hui.
router.get("/inscriptions/:id/questionnaire", requireAuth, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'inscription invalide." });
  const insc = await inscriptionAvecFormation(id);
  if (!insc) return res.status(404).json({ error: "Inscription introuvable." });
  const { rows: [questionnaire] } = await query(
    "SELECT id, nom FROM questionnaires WHERE formation_id = $1 AND actif = true", [insc.formation_id]);
  let questions = [];
  if (questionnaire) {
    const { rows } = await query(
      `SELECT q.id, q.ordre, q.libelle, q.type, q.options, q.obligatoire,
              r.valeur_texte, r.valeurs_choisies, r.mis_a_jour_le AS reponse_mise_a_jour_le,
              r.question_libelle AS reponse_question_libelle, r.question_type AS reponse_question_type,
              r.question_options AS reponse_question_options
       FROM questionnaire_questions q
       LEFT JOIN questionnaire_reponses r ON r.question_id = q.id AND r.inscription_id = $2
       WHERE q.questionnaire_id = $1 AND q.archivee = false
       ORDER BY q.ordre`,
      [questionnaire.id, id]
    );
    // `reponse.question_*` : l'INSTANTANÉ de la question au moment de CE
    // recueil — jamais le libelle/type/options en vigueur (q.libelle etc.,
    // renvoyés séparément pour permettre une nouvelle saisie). Une
    // consultation doit toujours lire l'instantané, jamais la question
    // actuelle, qui peut avoir changé depuis.
    questions = rows.map((r) => ({
      id: r.id, ordre: r.ordre, libelle: r.libelle, type: r.type, options: r.options, obligatoire: r.obligatoire,
      reponse: r.valeur_texte !== null || (r.valeurs_choisies && r.valeurs_choisies.length)
        ? {
            valeur_texte: r.valeur_texte, valeurs_choisies: r.valeurs_choisies,
            question_libelle: r.reponse_question_libelle, question_type: r.reponse_question_type, question_options: r.reponse_question_options,
          }
        : null,
    }));
  }
  res.json({ questionnaire: questionnaire || null, questions, archivee: !!insc.archivee_le });
}));

// Enregistre l'état complet des réponses soumises (une par question
// présente dans `reponses`) — jamais une réponse à une question d'une
// AUTRE formation, jamais une réponse à une question archivée.
router.put("/inscriptions/:id/questionnaire/reponses", requireRedacteur, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'inscription invalide." });
  const insc = await inscriptionAvecFormation(id);
  if (!insc) return res.status(404).json({ error: "Inscription introuvable." });
  if (insc.archivee_le) return res.status(409).json({ error: MSG_ARCHIVEE });

  const { rows: [questionnaire] } = await query(
    "SELECT id FROM questionnaires WHERE formation_id = $1 AND actif = true", [insc.formation_id]);
  if (!questionnaire) return res.status(400).json({ error: "Cette formation n'a pas de questionnaire actif." });

  const soumises = Array.isArray(req.body?.reponses) ? req.body.reponses : [];
  const idsDemandes = soumises.map((r) => parseIdPositif(r?.question_id)).filter(Boolean);
  if (idsDemandes.length !== soumises.length) return res.status(400).json({ error: "Identifiant de question invalide." });

  const { rows: questions } = idsDemandes.length
    ? await query(
        `SELECT ${COLONNES_QUESTION} FROM questionnaire_questions
         WHERE questionnaire_id = $1 AND archivee = false AND id = ANY($2::int[])`,
        [questionnaire.id, idsDemandes])
    : { rows: [] };
  const questionParId = new Map(questions.map((q) => [q.id, q]));

  const aEcrire = [];
  for (const r of soumises) {
    const question = questionParId.get(parseIdPositif(r.question_id));
    if (!question) return res.status(400).json({ error: "Cette question n'appartient pas au questionnaire de cette formation." });
    const { champs, erreur } = lireReponse(question, r);
    if (erreur) return res.status(400).json({ error: erreur });
    aEcrire.push({ question, champs });
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const { question, champs } of aEcrire) {
      await client.query(
        `INSERT INTO questionnaire_reponses
           (question_id, inscription_id, question_libelle, question_type, question_options,
            valeur_texte, valeurs_choisies, renseigne_par)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (question_id, inscription_id) DO UPDATE SET
           question_libelle = EXCLUDED.question_libelle, question_type = EXCLUDED.question_type,
           question_options = EXCLUDED.question_options, valeur_texte = EXCLUDED.valeur_texte,
           valeurs_choisies = EXCLUDED.valeurs_choisies, renseigne_par = EXCLUDED.renseigne_par,
           mis_a_jour_le = now()`,
        [question.id, id, question.libelle, question.type, question.options,
         champs.valeur_texte, champs.valeurs_choisies, req.user.id]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  res.json({ ok: true });
}));

export { reponseAffichage };
export default router;
