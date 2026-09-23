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
import { getDrive } from "../services/google.js";
import { parseIdPositif } from "../services/ids.js";
// Évaluations / QCM + satisfaction (lot L7) : validation et parsing purs.
import {
  champsEvaluation, champsSatisfaction,
  construireMappingResultats, dateDeCsv, lireNombreCsv,
  typeEvaluationCsv, resultatCsv,
} from "../services/evaluations.js";
// Assiduité : un seul calcul, partagé avec la génération documentaire (L5).
// Ré-exporté pour ne pas casser les imports existants (tests L2).
import { calculerAssiduite } from "../services/assiduite.js";
export { calculerAssiduite };
import {
  parserCsv, construireMapping, lireBooleen, normaliserEmail, validerEmail,
  normaliserCivilite, trouverPrescripteur, normaliser,
} from "../services/csvStagiaires.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const manque = (res, champ) => res.status(400).json({ error: `Champ obligatoire : ${champ}.` });

const PORTEES = ["formation", "session", "groupe", "stagiaire"];
const MODALITES = ["presentiel", "distanciel", "mixte"];
// Valeurs admises par la contrainte de la migration 001 sur sessions.statut.
const STATUTS_SESSION = ["planifiee", "en_cours", "terminee", "annulee"];
// Valeurs admises par la contrainte de la migration 008.
const CIVILITES = ["M.", "Mme"];

// Un prescripteur est un CODE existant dans la table de référence
// (migration 011). Une valeur vide ou absente vaut « non renseigné » et
// passe ; une valeur inconnue est refusée par l'appelant.
async function prescripteurConnu(code) {
  if (code === undefined || code === null || code === "") return true;
  const { rowCount } = await query("SELECT 1 FROM prescripteurs WHERE code = $1", [code]);
  return rowCount > 0;
}
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
  return parseIdPositif(valeur);
}

// « AAAA-MM-JJ » strict. Le 30 février doit être refusé, pas reporté au
// 2 mars : on relit la date telle que JavaScript l'a comprise et on la
// compare au texte d'origine.
export function estDateValide(valeur) {
  if (typeof valeur !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return false;
  const d = new Date(`${valeur}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valeur;
}

// « AAAA-MM-JJ » → « JJ/MM/AAAA » pour les messages destinés aux humains.
function dateFr(d) {
  const t = String(d || "").slice(0, 10);
  const [a, m, j] = t.split("-");
  return a && m && j ? `${j}/${m}/${a}` : t;
}

// Une évaluation appartient à la période de sa session, bornes INCLUSES.
// (Les satisfactions ne sont PAS concernées : une satisfaction a_froid peut
// légitimement être recueillie après la session.)
function evaluationHorsPeriode(datePassage, session) {
  if (!datePassage || !session?.date_debut || !session?.date_fin) return false;
  return datePassage < session.date_debut || datePassage > session.date_fin;
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

// Champs numériques d'une version de formation : une saisie illisible (ou
// négative) est refusée AVANT l'écriture — sinon PostgreSQL répondrait par
// une erreur de conversion, qu'on refuse de déguiser en 400 global.
function erreurVersion(corps) {
  for (const c of ["duree_heures_defaut", "tarif_ht"]) {
    const v = corps?.[c];
    if (v === undefined || v === null || v === "") continue;
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return `Champ ${c} invalide : nombre positif attendu.`;
  }
  return null;
}

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
  const errV = erreurVersion(req.body);
  if (errV) return res.status(400).json({ error: errV });
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
  const id = identifiant(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de formation invalide." });
  if (req.body?.modalite && !MODALITES.includes(req.body.modalite)) return res.status(400).json({ error: "Modalité inconnue." });
  const errV = erreurVersion(req.body);
  if (errV) return res.status(400).json({ error: errV });
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
  const id = identifiant(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de formation invalide." });
  const { rows } = await query(
    "SELECT * FROM formation_versions WHERE formation_id = $1 ORDER BY numero DESC",
    [id]
  );
  res.json({ versions: rows, total: rows.length });
}));

// ── Sessions et groupes ──────────────────────────────────────

router.post("/sessions", requireAdmin, wrap(async (req, res) => {
  const { formation_id, date_debut, date_fin, reference, lieu, modalite, formateur, duree_heures_reelle, horaire } = req.body || {};
  const fid = identifiant(formation_id);
  if (!fid) return res.status(400).json({ error: "Identifiant de formation invalide." });
  if (!date_debut) return manque(res, "date_debut");
  if (!date_fin) return manque(res, "date_fin");
  if (!estDateValide(date_debut)) return res.status(400).json({ error: "Date de début invalide : format attendu AAAA-MM-JJ." });
  if (!estDateValide(date_fin)) return res.status(400).json({ error: "Date de fin invalide : format attendu AAAA-MM-JJ." });
  if (date_fin < date_debut) return res.status(400).json({ error: "La date de fin précède la date de début." });
  if (modalite && !MODALITES.includes(modalite)) return res.status(400).json({ error: "Modalité inconnue." });

  let duree = null;
  if (duree_heures_reelle !== undefined && duree_heures_reelle !== null && duree_heures_reelle !== "") {
    const n = typeof duree_heures_reelle === "number" ? duree_heures_reelle : Number(String(duree_heures_reelle).replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: "Durée prévue invalide : nombre d'heures positif." });
    duree = n;
  }

  // La session fige la version en vigueur au moment où on la crée.
  const { rows: [version] } = await query(
    "SELECT id FROM formation_versions WHERE formation_id = $1 ORDER BY numero DESC LIMIT 1",
    [fid]
  );
  if (!version) return res.status(400).json({ error: "Cette formation n'a aucune version : complétez-la d'abord." });

  const { rows: [session] } = await query(
    `INSERT INTO sessions (formation_id, formation_version_id, reference, date_debut, date_fin,
       lieu, modalite, formateur, duree_heures_reelle, horaire)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [fid, version.id, reference?.trim() || null, date_debut, date_fin,
     lieu?.trim() || null, modalite || null, formateur?.trim() || null, duree,
     normaliserHoraire(horaire)]
  );
  res.status(201).json({ session });
}));

router.get("/sessions/:id", requireAuth, wrap(async (req, res) => {
  const id = identifiant(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de session invalide." });
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
            i.prescripteur, i.dossier_complet, s.id, s.civilite, s.nom, s.prenom, s.email, s.telephone,
            s.entreprise, s.financeur, s.situation_handicap, s.besoins_adaptation
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

// Corriger une session. L'admin reprend la référence, les dates, le lieu, le
// formateur, la durée prévue, l'horaire et le statut. La modification ne touche
// JAMAIS les documents déjà générés : on signale seulement qu'ils peuvent être
// devenus obsolètes — pas de moteur de version documentaire ici, et aucune
// régénération silencieuse.
const CHAMPS_DOCUMENT = ["reference", "date_debut", "date_fin", "lieu", "formateur", "duree_heures_reelle", "horaire"];

router.patch("/sessions/:id", requireAdmin, wrap(async (req, res) => {
  const id = identifiant(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de session invalide." });
  const corps = req.body || {};

  const { rows: [actuelle] } = await query("SELECT * FROM sessions WHERE id = $1", [id]);
  if (!actuelle) return res.status(404).json({ error: "Session introuvable." });

  // Valeurs retenues pour chaque champ (l'ancienne par défaut), pour comparer
  // ce qui change réellement — sans quoi un PATCH ne modifiant rien serait
  // annoncé comme « documents obsolètes ».
  const nouvelles = {
    reference: actuelle.reference, date_debut: actuelle.date_debut, date_fin: actuelle.date_fin,
    lieu: actuelle.lieu, formateur: actuelle.formateur, duree_heures_reelle: actuelle.duree_heures_reelle,
    horaire: actuelle.horaire,
  };
  const sets = [];
  const params = [id];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

  if (corps.reference !== undefined) {
    // Même normalisation qu'à la création : vide ou espaces ⇒ NULL. La
    // référence est FACULTATIVE et unique uniquement lorsqu'elle est
    // renseignée — corriger une session sans référence ne doit pas l'exiger.
    const r = corps.reference === null ? null : (String(corps.reference).trim() || null);
    nouvelles.reference = r; set("reference", r);
  }

  let debut = actuelle.date_debut;
  let fin = actuelle.date_fin;
  if (corps.date_debut !== undefined) {
    if (!estDateValide(corps.date_debut)) return res.status(400).json({ error: "Date de début invalide." });
    debut = corps.date_debut; nouvelles.date_debut = debut; set("date_debut", debut);
  }
  if (corps.date_fin !== undefined) {
    if (!estDateValide(corps.date_fin)) return res.status(400).json({ error: "Date de fin invalide." });
    fin = corps.date_fin; nouvelles.date_fin = fin; set("date_fin", fin);
  }
  if (fin < debut) return res.status(400).json({ error: "La date de fin précède la date de début." });

  // Une correction de dates ne doit jamais laisser une absence OU une
  // évaluation existante hors période : les routes de saisie bornent à la
  // période, une telle donnée deviendrait incohérente et non modifiable.
  // Les deux vérifications se font AVANT toute écriture.
  const datesModifiees = debut !== actuelle.date_debut || fin !== actuelle.date_fin;
  if (datesModifiees) {
    const [abs, ev] = await Promise.all([
      query(
        `SELECT count(*)::int AS n FROM absences a JOIN inscriptions i ON i.id = a.inscription_id
         WHERE i.session_id = $1 AND (a.date_absence < $2 OR a.date_absence > $3)`,
        [id, debut, fin]
      ),
      query(
        `SELECT count(*)::int AS n FROM resultats_qcm e JOIN inscriptions i ON i.id = e.inscription_id
         WHERE i.session_id = $1 AND (e.date_passage < $2 OR e.date_passage > $3)`,
        [id, debut, fin]
      ),
    ]);
    const nbAbsences = abs.rows[0].n;
    const nbEvaluations = ev.rows[0].n;
    if (nbAbsences > 0 || nbEvaluations > 0) {
      const parties = [];
      if (nbAbsences > 0) parties.push(`${nbAbsences} absence${nbAbsences > 1 ? "s" : ""}`);
      if (nbEvaluations > 0) parties.push(`${nbEvaluations} évaluation${nbEvaluations > 1 ? "s" : ""}`);
      const verbe = (nbAbsences + nbEvaluations) > 1 ? "tomberaient" : "tomberait";
      return res.status(400).json({
        error: `Impossible : ${parties.join(" et ")} ${verbe} hors des nouvelles dates de la session. Corrigez d'abord leurs dates.`,
      });
    }
  }

  if (corps.duree_heures_reelle !== undefined) {
    if (corps.duree_heures_reelle === null || corps.duree_heures_reelle === "") {
      nouvelles.duree_heures_reelle = null; set("duree_heures_reelle", null);
    } else {
      const d = Number(corps.duree_heures_reelle);
      if (!Number.isFinite(d) || d <= 0) return res.status(400).json({ error: "Durée prévue invalide : nombre d'heures positif." });
      nouvelles.duree_heures_reelle = d; set("duree_heures_reelle", d);
    }
  }

  // Réduire la durée prévue reste possible : le calcul d'assiduité borne déjà
  // le taux à 0 %. On signale seulement si les absences dépassent la nouvelle
  // durée, pour que l'admin le sache au moment d'enregistrer.
  let avertissementAbsences = null;
  if (corps.duree_heures_reelle !== undefined && nouvelles.duree_heures_reelle !== null) {
    const prevues = Number(nouvelles.duree_heures_reelle);
    if (Number.isFinite(prevues) && prevues > 0) {
      const { rows: [tot] } = await query(
        `SELECT COALESCE(sum(a.duree_heures), 0)::float8 AS total
         FROM absences a JOIN inscriptions i ON i.id = a.inscription_id
         WHERE i.session_id = $1`,
        [id]
      );
      const totalHeures = Math.round((Number(tot.total) || 0) * 100) / 100;
      if (totalHeures > prevues) {
        avertissementAbsences = { absencesDepassentDuree: true, total_heures_absence: totalHeures };
      }
    }
  }

  for (const champ of ["lieu", "formateur"]) {
    if (corps[champ] !== undefined) {
      const v = corps[champ] === null ? null : (String(corps[champ]).trim() || null);
      nouvelles[champ] = v; set(champ, v);
    }
  }

  if (corps.horaire !== undefined) {
    const h = normaliserHoraire(corps.horaire);
    nouvelles.horaire = h; set("horaire", h);
  }

  if (corps.statut !== undefined) {
    if (!STATUTS_SESSION.includes(corps.statut)) return res.status(400).json({ error: "Statut de session inconnu." });
    set("statut", corps.statut);
  }

  if (!sets.length) return res.status(400).json({ error: "Rien à modifier." });

  // Un champ « document » a-t-il réellement changé ? Les textes sont comparés
  // tels quels, la durée est comparée numériquement (« 28 » = « 28.00 »).
  const documentsObsoletes = CHAMPS_DOCUMENT.some((c) => {
    if (c === "duree_heures_reelle") return Number(nouvelles[c] ?? 0) !== Number(actuelle[c] ?? 0);
    return String(nouvelles[c] ?? "") !== String(actuelle[c] ?? "");
  });

  try {
    const { rows } = await query(`UPDATE sessions SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
    if (!rows.length) return res.status(404).json({ error: "Session introuvable." });
    res.json({ session: rows[0], documentsObsoletes, ...(avertissementAbsences || {}) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Cette référence est déjà utilisée par une autre session." });
    throw e;
  }
}));

router.post("/sessions/:id/groupes", requireAdmin, wrap(async (req, res) => {
  const sessionId = identifiant(req.params.id);
  if (!sessionId) return res.status(400).json({ error: "Identifiant de session invalide." });
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
  const sessionId = identifiant(req.params.id);
  if (!sessionId) return res.status(400).json({ error: "Identifiant de session invalide." });
  const { civilite, nom, prenom, email, telephone, groupe_id, prescripteur, dossier_complet, date_inscription, stagiaire_id } = req.body || {};
  if (!stagiaire_id && (!nom?.trim() || !prenom?.trim())) return manque(res, "nom et prenom");
  if (!(await prescripteurConnu(prescripteur))) return res.status(400).json({ error: "Prescripteur inconnu." });
  if (civilite && !CIVILITES.includes(civilite)) return res.status(400).json({ error: "Civilité inconnue." });

  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [session] } = await cx.query("SELECT id FROM sessions WHERE id = $1", [sessionId]);
    if (!session) { await cx.query("ROLLBACK"); return res.status(404).json({ error: "Session introuvable." }); }
    let gid = null;
    if (groupe_id !== undefined && groupe_id !== null && groupe_id !== "") {
      gid = identifiant(groupe_id);
      if (!gid) { await cx.query("ROLLBACK"); return res.status(400).json({ error: "Groupe invalide." }); }
    }
    if (gid) {
      const { rowCount } = await cx.query("SELECT 1 FROM groupes WHERE id = $1 AND session_id = $2", [gid, sessionId]);
      if (!rowCount) { await cx.query("ROLLBACK"); return res.status(400).json({ error: "Ce groupe n'appartient pas à la session." }); }
    }
    let personneId = null;
    if (stagiaire_id) {
      personneId = identifiant(stagiaire_id);
      if (!personneId) { await cx.query("ROLLBACK"); return res.status(400).json({ error: "Stagiaire invalide." }); }
      const { rowCount } = await cx.query("SELECT 1 FROM stagiaires WHERE id = $1", [personneId]);
      if (!rowCount) { await cx.query("ROLLBACK"); return res.status(400).json({ error: "Stagiaire introuvable." }); }
    }
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
      [personneId, sessionId, gid, prescripteur || null, dossier_complet === true, date_inscription || null]
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
  const id = identifiant(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'inscription invalide." });
  const { statut, date_abandon, motif_abandon, groupe_id, prescripteur, dossier_complet } = req.body || {};
  if (statut && !STATUTS_INSCRIPTION.includes(statut)) return res.status(400).json({ error: "Statut d'inscription inconnu." });
  if (!(await prescripteurConnu(prescripteur))) return res.status(400).json({ error: "Prescripteur inconnu." });

  // Un groupe ne se rattache qu'à SA session : le corps ne doit pas pouvoir
  // déplacer une inscription vers un groupe d'une autre session.
  // `groupe_id` doit être un entier strictement positif (parseIdPositif) :
  // `null` efface le groupe, `undefined` le laisse inchangé, toute autre
  // valeur ("1.5", "1e0", "abc", 0, -1, "", espaces) est refusée (400).
  let gid;
  if (groupe_id === undefined) {
    gid = undefined;
  } else if (groupe_id === null) {
    gid = null;
  } else {
    gid = identifiant(groupe_id);
    if (!gid) return res.status(400).json({ error: "Groupe invalide." });
  }
  if (gid) {
    const { rowCount } = await query(
      "SELECT 1 FROM groupes g JOIN inscriptions i ON i.session_id = g.session_id WHERE g.id = $1 AND i.id = $2",
      [gid, id]
    );
    if (!rowCount) return res.status(400).json({ error: "Ce groupe n'appartient pas à la session." });
  }

  const sets = [];
  const params = [id];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (statut !== undefined) {
    set("statut", statut);
    // Un abandon sans date reçoit celle du jour : le décompte doit savoir quand.
    if (statut === "abandon") set("date_abandon", date_abandon || new Date().toISOString().slice(0, 10));
  } else if (date_abandon !== undefined) set("date_abandon", date_abandon || null);
  if (motif_abandon !== undefined) set("motif_abandon", motif_abandon || null);
  if (groupe_id !== undefined) set("groupe_id", gid);
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

// Modifier une personne déjà saisie. Ouvert aux admins ET aux contributeurs :
// corriger une fiche stagiaire est de la saisie courante, pas de
// l'administration. `situation_handicap` et `besoins_adaptation` sont gérés
// ici sans jamais être journalisés ni insérés dans un message d'erreur.
router.patch("/stagiaires/:id", requireRedacteur, wrap(async (req, res) => {
  const id = identifiant(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de stagiaire invalide." });
  const { civilite, nom, prenom, email, telephone, entreprise, financeur, situation_handicap, besoins_adaptation } = req.body || {};
  if (civilite !== undefined && civilite !== null && !CIVILITES.includes(civilite)) {
    return res.status(400).json({ error: "Civilité inconnue." });
  }
  if (email !== undefined && email !== null && email.trim() !== "" && !validerEmail(normaliserEmail(email))) {
    return res.status(400).json({ error: "Email invalide." });
  }
  const sets = [];
  const params = [id];
  const set = (col, val) => { params.push(val); sets.push(col + ' = $' + params.length); };
  // Une chaîne vide vaut effacement : le formulaire envoie "" pour
  // « Non renseignée ».
  if (civilite !== undefined) set("civilite", civilite || null);
  if (nom !== undefined && nom.trim()) set("nom", nom.trim());
  if (prenom !== undefined && prenom.trim()) set("prenom", prenom.trim());
  if (email !== undefined) set("email", normaliserEmail(email) || null);
  if (telephone !== undefined) set("telephone", telephone?.trim() || null);
  if (entreprise !== undefined) set("entreprise", entreprise?.trim() || null);
  if (financeur !== undefined) set("financeur", financeur?.trim() || null);
  if (situation_handicap !== undefined) set("situation_handicap", situation_handicap === true);
  if (besoins_adaptation !== undefined) set("besoins_adaptation", besoins_adaptation?.trim() || null);
  if (!sets.length) return res.status(400).json({ error: "Rien à modifier." });
  const { rows } = await query("UPDATE stagiaires SET " + sets.join(", ") + " WHERE id = $1 RETURNING *", params);
  if (!rows.length) return res.status(404).json({ error: "Stagiaire introuvable." });
  res.json({ stagiaire: rows[0] });
}));

// ── Import CSV de stagiaires ─────────────────────────────────
// Parcours en deux temps : APERÇU (aucune écriture) puis CONFIRMATION
// (transactionnelle). Un stagiaire n'est jamais rapproché d'un autre sur la
// seule foi du nom/prénom ; seul un email unique, normalisé, autorise la
// réutilisation. `situation_handicap` et `besoins_adaptation` circulent ici
// uniquement entre le CSV et la base : jamais dans un log ni un message.

function extraireValeurs(cellules, colonnes) {
  const v = {};
  for (const [idx, cle] of Object.entries(colonnes)) v[cle] = (cellules[Number(idx)] ?? "").trim();
  return v;
}

// req : fonction de requête (query() pour l'aperçu, cx.query dans la
// transaction de confirmation). Renvoie { erreur } ou le détail classifié.
async function classerStagiaires({ req, sessionId, texte }) {
  const analyse = parserCsv(texte);
  if (analyse.erreur) return { erreur: analyse.erreur };
  const { colonnes, inconnus, ambigus } = construireMapping(analyse.enTetes);
  if (ambigus.length) {
    return {
      erreur: "Colonnes ambiguës : " +
        ambigus.map((a) => `${a.cle} (${a.noms.join(", ")})`).join(" ; ") + ".",
    };
  }
  if (!Object.values(colonnes).includes("nom") || !Object.values(colonnes).includes("prenom")) {
    return { erreur: "Colonnes obligatoires absentes : « nom » et « prénom »." };
  }

  const { rows: groupes } = await req("SELECT id, nom FROM groupes WHERE session_id = $1", [sessionId]);
  const { rows: prescripteurs } = await req("SELECT code, nom, actif FROM prescripteurs");
  const emailsVus = new Set();
  const nomsVus = new Set();
  const resultats = [];
  const resume = { nouveaux: 0, existants: 0, invalides: 0, doublons: 0, dejaInscrits: 0, vides: 0 };

  for (let i = 0; i < analyse.lignes.length; i++) {
    const cellules = analyse.lignes[i];
    if (cellules.every((c) => !c)) {
      resultats.push({ index: i, statut: "vide", motif: "ligne vide" });
      resume.vides++;
      continue;
    }
    const v = extraireValeurs(cellules, colonnes);
    const nom = v.nom || "";
    const prenom = v.prenom || "";
    const email = normaliserEmail(v.email);

    const ligne = { index: i, nom, prenom, email, statut: "pret", motif: null };
    if (!nom || !prenom) {
      ligne.statut = "invalide"; ligne.motif = "nom et prénom obligatoires";
    } else if (v.email && !validerEmail(email)) {
      ligne.statut = "invalide"; ligne.motif = "email invalide";
    } else {
      const dossier = lireBooleen(v.dossier_complet);
      const handicap = lireBooleen(v.situation_handicap);
      if (dossier === undefined) {
        ligne.statut = "invalide"; ligne.motif = "« dossier complet » attendu en oui/non";
      } else if (handicap === undefined) {
        ligne.statut = "invalide"; ligne.motif = "« situation de handicap » attendue en oui/non";
      } else {
        let prescripteur = null;
        if (v.prescripteur) {
          const p = trouverPrescripteur(v.prescripteur, prescripteurs);
          if (!p) {
            ligne.statut = "invalide"; ligne.motif = `prescripteur inconnu : ${v.prescripteur}`;
          } else if (!p.actif) {
            ligne.statut = "invalide"; ligne.motif = `prescripteur inactif : ${v.prescripteur}`;
          } else {
            prescripteur = p.code;
          }
        }
        if (ligne.statut === "pret") {
          let groupeId = null;
          if (v.groupe) {
            const g = groupes.find((x) => normaliser(x.nom) === normaliser(v.groupe));
            if (!g) { ligne.statut = "invalide"; ligne.motif = `groupe inconnu : ${v.groupe}`; }
            else groupeId = g.id;
          }
          ligne.groupeId = groupeId;
          ligne.prescripteur = prescripteur;
          ligne.dossier_complet = dossier === true;

          if (ligne.statut === "pret") {
            const valeursFiche = {
              nom, prenom, email, civilite: normaliserCivilite(v.civilite),
              telephone: v.telephone || null, entreprise: v.entreprise || null,
              financeur: v.financeur || null,
              situation_handicap: handicap === true,
              besoins_adaptation: v.besoins_adaptation || null,
            };
            if (email) {
              if (emailsVus.has(email)) {
                ligne.statut = "invalide"; ligne.motif = "doublon dans le fichier (email déjà présent)";
              } else {
                emailsVus.add(email);
                const { rows } = await req("SELECT id FROM stagiaires WHERE lower(trim(email)) = $1", [email]);
                if (rows.length > 1) {
                  ligne.statut = "a_verifier"; ligne.motif = "plusieurs stagiaires partagent cet email";
                } else if (rows.length === 1) {
                  const { rows: ins } = await req("SELECT 1 FROM inscriptions WHERE stagiaire_id = $1 AND session_id = $2", [rows[0].id, sessionId]);
                  if (ins.length) { ligne.statut = "deja_inscrit"; ligne.motif = "déjà inscrit dans cette session"; }
                  else { ligne.statut = "existant"; ligne.stagiaireId = rows[0].id; }
                }
              }
            } else {
              const cle = normaliser(nom) + "|" + normaliser(prenom);
              if (nomsVus.has(cle)) {
                ligne.statut = "doublon_possible"; ligne.motif = "même nom/prénom déjà présent dans le fichier";
              } else {
                nomsVus.add(cle);
                // `lower(trim(...))` en base : on compare des minuscules des
                // deux côtés, sans toucher aux accents.
                const { rows } = await req("SELECT id FROM stagiaires WHERE lower(trim(nom)) = $1 AND lower(trim(prenom)) = $2", [nom.toLowerCase(), prenom.toLowerCase()]);
                if (rows.length) { ligne.statut = "doublon_possible"; ligne.motif = "nom/prénom déjà connu"; }
              }
            }
            if (ligne.statut === "pret") ligne.valeurs = valeursFiche;
          }
        }
      }
    }

    if (ligne.statut === "pret") resume.nouveaux++;
    else if (ligne.statut === "existant") resume.existants++;
    else if (ligne.statut === "deja_inscrit") resume.dejaInscrits++;
    else if (ligne.statut === "invalide") resume.invalides++;
    else if (ligne.statut === "doublon_possible" || ligne.statut === "a_verifier") resume.doublons++;
    else if (ligne.statut === "vide") resume.vides++;
    resultats.push(ligne);
  }

  return { sep: analyse.sep, enTetes: analyse.enTetes, inconnus, resultats, resume };
}

// Vue « légère » pour l'aperçu : on n'expose ni la situation de handicap ni
// les besoins d'adaptation, qui ne concernent que la fiche une fois créée.
function vueApercu(r) {
  return {
    sep: r.sep,
    enTetes: r.enTetes,
    colonnesInconnues: r.inconnus,
    resume: r.resume,
    lignes: r.resultats.map((l) => ({
      index: l.index, statut: l.statut, motif: l.motif, nom: l.nom, prenom: l.prenom, email: l.email,
      groupe: l.groupeId !== undefined ? l.groupeId : null,
      prescripteur: l.prescripteur ?? null,
      dossier_complet: l.dossier_complet === true,
    })),
  };
}

router.post("/sessions/:id/stagiaires/import-apercu", requireRedacteur, wrap(async (req, res) => {
  const sessionId = identifiant(req.params.id);
  if (!sessionId) return res.status(400).json({ error: "Identifiant de session invalide." });
  const texte = req.body?.texte;
  if (!texte || !String(texte).trim()) return res.status(400).json({ error: "Le fichier est vide." });
  const { rows: [session] } = await query("SELECT id FROM sessions WHERE id = $1", [sessionId]);
  if (!session) return res.status(404).json({ error: "Session introuvable." });
  const r = await classerStagiaires({ req: query, sessionId, texte });
  if (r.erreur) return res.status(400).json({ error: r.erreur });
  res.json(vueApercu(r));
}));

// Confirmer : relit le CSV et écrit DANS UNE TRANSACTION. Toute erreur
// annule tout — pas de demi-import silencieux.
router.post("/sessions/:id/stagiaires/import", requireRedacteur, wrap(async (req, res) => {
  const sessionId = identifiant(req.params.id);
  if (!sessionId) return res.status(400).json({ error: "Identifiant de session invalide." });
  const texte = req.body?.texte;
  if (!texte || !String(texte).trim()) return res.status(400).json({ error: "Le fichier est vide." });

  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [session] } = await cx.query("SELECT id FROM sessions WHERE id = $1", [sessionId]);
    if (!session) { await cx.query("ROLLBACK"); return res.status(404).json({ error: "Session introuvable." }); }

    const r = await classerStagiaires({ req: (sql, params) => cx.query(sql, params), sessionId, texte });
    if (r.erreur) { await cx.query("ROLLBACK"); return res.status(400).json({ error: r.erreur }); }

    const bilan = { crees: 0, reutilises: 0, inscrits: 0, dejaInscrits: 0, ignores: [] };
    const inscrire = (stagiaireId, ligne) => cx.query(
      `INSERT INTO inscriptions (stagiaire_id, session_id, groupe_id, prescripteur, dossier_complet)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (stagiaire_id, session_id) DO NOTHING`,
      [stagiaireId, sessionId, ligne.groupeId ?? null, ligne.prescripteur ?? null, ligne.dossier_complet === true]
    );

    for (const ligne of r.resultats) {
      if (ligne.statut === "pret") {
        const f = ligne.valeurs;
        const { rows: [nouveau] } = await cx.query(
          `INSERT INTO stagiaires (civilite, nom, prenom, email, telephone, entreprise, financeur, situation_handicap, besoins_adaptation)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [f.civilite, f.nom, f.prenom, f.email, f.telephone, f.entreprise, f.financeur,
           f.situation_handicap, f.besoins_adaptation]
        );
        await inscrire(nouveau.id, ligne);
        bilan.crees++;
        bilan.inscrits++;
      } else if (ligne.statut === "existant") {
        const { rowCount } = await inscrire(ligne.stagiaireId, ligne);
        bilan.reutilises++;
        if (rowCount) bilan.inscrits++;
        else bilan.dejaInscrits++;
      } else if (ligne.statut === "deja_inscrit") {
        // Déjà détecté à la classification : rien à écrire, à compter tel quel.
        bilan.dejaInscrits++;
      } else {
        bilan.ignores.push({ index: ligne.index, statut: ligne.statut, motif: ligne.motif });
      }
    }

    await cx.query("COMMIT");
    res.json({ bilan });
  } catch (e) {
    await cx.query("ROLLBACK");
    throw e;
  } finally {
    cx.release();
  }
}));

// ── Prescripteurs (liste configurable) ───────────────────────
// Un prescripteur est FACULTATIF. La liste vit en base (migration 011) :
// `code` est ce que stocke `inscriptions.prescripteur`, `nom` est affiché.
// Désactiver (actif=false) ne touche jamais les inscriptions passées.

router.get("/prescripteurs", requireAuth, wrap(async (_req, res) => {
  const { rows } = await query("SELECT id, code, nom, actif FROM prescripteurs ORDER BY nom");
  res.json({ prescripteurs: rows, total: rows.length });
}));

router.post("/prescripteurs", requireAdmin, wrap(async (req, res) => {
  const nom = req.body?.nom;
  if (!nom?.trim()) return manque(res, "nom");
  const base = normaliser(nom);
  if (!base) return res.status(400).json({ error: "Nom illisible." });
  // Le code est l'identifiant stable : on ne le renomme jamais une fois créé.
  let code = base;
  let suffixe = 2;
  while ((await query("SELECT 1 FROM prescripteurs WHERE code = $1", [code])).rows.length) {
    code = `${base}-${suffixe++}`;
  }
  const { rows: [prescripteur] } = await query(
    "INSERT INTO prescripteurs (code, nom) VALUES ($1, $2) RETURNING *",
    [code, nom.trim()]
  );
  res.status(201).json({ prescripteur });
}));

// Renommer le libellé, ou réactiver/désactiver. Le `code` ne bouge pas : il est
// référencé tel quel par les inscriptions.
router.patch("/prescripteurs/:id", requireAdmin, wrap(async (req, res) => {
  const id = identifiant(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de prescripteur invalide." });
  const { nom, actif } = req.body || {};
  if (nom !== undefined && !nom.trim()) return res.status(400).json({ error: "Le nom ne peut pas être vide." });
  const sets = [];
  const params = [id];
  if (nom !== undefined) { params.push(nom.trim()); sets.push(`nom = $${params.length}`); }
  if (actif !== undefined) { params.push(actif === true); sets.push(`actif = $${params.length}`); }
  if (!sets.length) return res.status(400).json({ error: "Rien à modifier." });
  const { rows } = await query(`UPDATE prescripteurs SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  if (!rows.length) return res.status(404).json({ error: "Prescripteur introuvable." });
  res.json({ prescripteur: rows[0] });
}));

// Désactiver plutôt que supprimer : les inscriptions passées gardent leur code.
router.delete("/prescripteurs/:id", requireAdmin, wrap(async (req, res) => {
  const id = identifiant(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de prescripteur invalide." });
  const { rowCount } = await query("UPDATE prescripteurs SET actif = false WHERE id = $1", [id]);
  if (!rowCount) return res.status(404).json({ error: "Prescripteur introuvable." });
  res.json({ ok: true });
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
  // Un numéro d'indicateur doit être un entier positif : une valeur
  // illisible est refusée ici, jamais laissée à PostgreSQL (conversion 500).
  const bruts = Array.isArray(indicateurs) ? indicateurs : [];
  if (bruts.some((v) => !parseIdPositif(v))) {
    return res.status(400).json({ error: "Indicateur(s) invalide(s) : numéro entier positif attendu." });
  }
  const numeros = bruts.map((v) => parseIdPositif(v));
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
  const id = identifiant(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de modèle invalide." });
  const { rowCount } = await query("UPDATE modeles_documents SET actif = false WHERE id = $1", [id]);
  if (!rowCount) return res.status(404).json({ error: "Modèle introuvable." });
  res.json({ ok: true });
}));

// ── Génération ───────────────────────────────────────────────
router.post("/generations", requireRedacteur, wrap(async (req, res) => {
  const { modele_id, session_id, groupe_id = null, remplacer = false } = req.body || {};
  const modeleId = identifiant(modele_id);
  const sessionId = identifiant(session_id);
  if (!modeleId) return res.status(400).json({ error: "Identifiant de modèle invalide." });
  if (!sessionId) return res.status(400).json({ error: "Identifiant de session invalide." });
  let groupeId = null;
  if (groupe_id !== undefined && groupe_id !== null && groupe_id !== "") {
    groupeId = identifiant(groupe_id);
    if (!groupeId) return res.status(400).json({ error: "Identifiant de groupe invalide." });
  }
  try {
    const r = await genererDocuments({
      modeleId, sessionId, groupeId,
      remplacer: remplacer === true, utilisateurId: req.user.id,
    });
    res.json(r);
  } catch (e) {
    // Une erreur SQL (code PostgreSQL, 5 caractères) n'est JAMAIS une
    // erreur métier : elle remonte au handler global (500 générique) sans
    // exposer de détail.
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) throw e;
    // 409 : des documents existent déjà, ou une génération est en cours.
    if (e.dejaGeneres) return res.status(409).json({ error: e.message, dejaGeneres: e.dejaGeneres });
    if (e.genEnCours) return res.status(409).json({ error: e.message });
    // 503 : Google indisponible. 400 : erreur métier exploitable. Le
    // diagnostic Google complet reste dans les logs serveur uniquement.
    if (e.statut) return res.status(e.statut).json({ error: e.message });
    return res.status(400).json({ error: e.message });
  }
}));

// ── Évaluations / QCM + satisfaction (lot L7) ────────────────
// Vigie ne construit PAS de questionnaire : on centralise qu'une évaluation
// a eu lieu, pour qui, quand, avec quel résultat, et la satisfaction.
// Les fichiers Drive sont VÉRIFIÉS (jamais d'ID saisi à la main), aucun
// binaire en base.

// Fichier Drive facultatif : existence vérifiée AVANT toute écriture.
// Drive indisponible ⇒ 503, fichier inconnu ⇒ 400.
async function verifierFichierDrive(drive_file_id) {
  const d = await getDrive();
  if (!d) return { erreur: 503, message: "Google Drive est indisponible ou non connecté. Impossible de vérifier le fichier." };
  try {
    const { data } = await d.drive.files.get({
      fileId: String(drive_file_id).trim(), fields: "id,name,mimeType,webViewLink", supportsAllDrives: true,
    });
    return { data };
  } catch (e) {
    if (e?.response?.status === 404 || e?.code === 404) return { erreur: 400, message: "Fichier Drive introuvable ou inaccessible." };
    return { erreur: 400, message: "Impossible de vérifier ce fichier Drive : " + (e.message || "erreur inconnue") };
  }
}

// Une inscription doit exister ET appartenir à la session indiquée.
async function inscriptionDeSession(req, inscriptionId, sessionId) {
  if (inscriptionId === null || inscriptionId === undefined) return { ok: true };
  const { rows: [ins] } = await req("SELECT id, session_id FROM inscriptions WHERE id = $1", [inscriptionId]);
  if (!ins) return { erreur: 404, message: "Inscription introuvable." };
  if (ins.session_id !== sessionId) return { erreur: 400, message: "Cette inscription n'appartient pas à la session indiquée." };
  return { ok: true };
}

// ── Évaluations ─────────────────────────────────────────────

const COLONNES_EVALUATION = `e.id, e.inscription_id, e.type, e.intitule, e.date_passage,
  e.score, e.score_max, e.seuil_reussite, e.resultat, e.commentaire, e.drive_file_id,
  s.id AS stagiaire_id, s.nom, s.prenom, s.email`;

function agregerEvaluations(rows) {
  const agg = { total: rows.length, valide: 0, non_valide: 0, non_determine: 0, non_applicable: 0 };
  for (const r of rows) if (agg[r.resultat] !== undefined) agg[r.resultat]++;
  return agg;
}

router.get("/sessions/:id/evaluations", requireAuth, wrap(async (req, res) => {
  const sessionId = identifiant(req.params.id);
  if (!sessionId) return res.status(400).json({ error: "Identifiant de session invalide." });
  const { rows: [session] } = await query("SELECT id FROM sessions WHERE id = $1", [sessionId]);
  if (!session) return res.status(404).json({ error: "Session introuvable." });
  const { rows } = await query(
    `SELECT ${COLONNES_EVALUATION}
     FROM resultats_qcm e
     JOIN inscriptions i ON i.id = e.inscription_id AND i.session_id = $1
     JOIN stagiaires s ON s.id = i.stagiaire_id
     ORDER BY e.date_passage DESC, e.id DESC`,
    [sessionId]
  );
  res.json({ evaluations: rows, total: rows.length, agregation: agregerEvaluations(rows) });
}));

router.post("/sessions/:id/evaluations", requireRedacteur, wrap(async (req, res) => {
  const sessionId = identifiant(req.params.id);
  if (!sessionId) return res.status(400).json({ error: "Identifiant de session invalide." });
  const corps = req.body || {};
  const inscriptionId = identifiant(corps.inscription_id);
  if (!inscriptionId) return res.status(400).json({ error: "Inscription obligatoire." });
  if (!corps.type) return res.status(400).json({ error: "Type d'évaluation obligatoire." });
  if (!corps.date_passage) return res.status(400).json({ error: "Date de passage obligatoire." });

  const { rows: [session] } = await query("SELECT id, date_debut, date_fin FROM sessions WHERE id = $1", [sessionId]);
  if (!session) return res.status(404).json({ error: "Session introuvable." });
  const ins = await inscriptionDeSession(query, inscriptionId, sessionId);
  if (ins.erreur) return res.status(ins.erreur).json({ error: ins.message });

  const { champs, erreur } = champsEvaluation(corps);
  if (erreur) return res.status(400).json({ error: erreur });

  // Date de passage bornée à la période de la session (bornes incluses).
  // Les satisfactions ne sont pas concernées (a_froid possible après).
  if (evaluationHorsPeriode(champs.date_passage, session)) {
    return res.status(400).json({
      error: `La date de l'évaluation doit être comprise entre le ${dateFr(session.date_debut)} et le ${dateFr(session.date_fin)} pour cette session.`,
    });
  }

  // Rattachement Drive réservé à l'admin : la recherche Drive étant globale
  // et admin-only, un contributeur ne doit pas pouvoir y rattacher un fichier.
  if (corps.drive_file_id && req.user.role !== "admin") {
    return res.status(403).json({ error: "Le rattachement d'un fichier Drive est réservé aux administrateurs." });
  }

  if (corps.drive_file_id) {
    const v = await verifierFichierDrive(corps.drive_file_id);
    if (v.erreur) return res.status(v.erreur).json({ error: v.message });
  }

  const colonnes = ["inscription_id", ...Object.keys(champs)];
  const valeurs = [inscriptionId, ...Object.values(champs)];
  const { rows: [e] } = await query(
    `INSERT INTO resultats_qcm (${colonnes.join(", ")})
     VALUES (${colonnes.map((_, i) => "$" + (i + 1)).join(", ")}) RETURNING *`,
    valeurs
  );
  res.status(201).json({ evaluation: e });
}));

router.patch("/evaluations/:id", requireRedacteur, wrap(async (req, res) => {
  const id = identifiant(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'évaluation invalide." });
  const { rows: [avant] } = await query(
    `SELECT e.*, i.session_id, s.date_debut, s.date_fin
     FROM resultats_qcm e
     JOIN inscriptions i ON i.id = e.inscription_id
     JOIN sessions s ON s.id = i.session_id
     WHERE e.id = $1`,
    [id]
  );
  if (!avant) return res.status(404).json({ error: "Évaluation introuvable." });

  const corps = req.body || {};
  if (corps.inscription_id !== undefined) {
    const inscriptionId = identifiant(corps.inscription_id);
    if (!inscriptionId) return res.status(400).json({ error: "Inscription invalide." });
    const ins = await inscriptionDeSession(query, inscriptionId, avant.session_id);
    if (ins.erreur) return res.status(ins.erreur).json({ error: ins.message });
  }

  const { champs, erreur } = champsEvaluation(corps, avant);
  if (erreur) return res.status(400).json({ error: erreur });
  if (!Object.keys(champs).length) return res.status(400).json({ error: "Rien à modifier." });

  // Date effective (nouvelle date si fournie, sinon la date actuelle) bornée
  // à la période de la session. Une ancienne ligne déjà hors période reste
  // corrigeable : fournir une nouvelle date valide suffit.
  const dateEffective = champs.date_passage !== undefined ? champs.date_passage : avant.date_passage;
  if (evaluationHorsPeriode(dateEffective, avant)) {
    return res.status(400).json({
      error: `La date de l'évaluation doit être comprise entre le ${dateFr(avant.date_debut)} et le ${dateFr(avant.date_fin)} pour cette session.`,
    });
  }

  if (corps.drive_file_id && req.user.role !== "admin") {
    return res.status(403).json({ error: "Le rattachement d'un fichier Drive est réservé aux administrateurs." });
  }

  if (corps.drive_file_id) {
    const v = await verifierFichierDrive(corps.drive_file_id);
    if (v.erreur) return res.status(v.erreur).json({ error: v.message });
  }

  const params = [id];
  const sets = Object.keys(champs).map((c) => { params.push(champs[c]); return `${c} = $${params.length}`; });
  const { rows: [e] } = await query(
    `UPDATE resultats_qcm SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params
  );
  res.json({ evaluation: e });
}));

// ── Import CSV de résultats d'évaluation ────────────────────

async function classerResultats({ req, sessionId, texte }) {
  const analyse = parserCsv(texte);
  if (analyse.erreur) return { erreur: analyse.erreur };
  const { colonnes, inconnus, ambigus } = construireMappingResultats(analyse.enTetes);
  if (ambigus.length) {
    return { erreur: "Colonnes ambiguës : " + ambigus.map((a) => `${a.cle} (${a.noms.join(", ")})`).join(" ; ") + "." };
  }
  if (!Object.values(colonnes).includes("email")) return { erreur: "Colonne obligatoire absente : « email »." };

  // Période de la session, pour borner les dates d'évaluation (bornes incluses).
  const { rows: [session] } = await req("SELECT date_debut, date_fin FROM sessions WHERE id = $1", [sessionId]);
  const periode = session ? { debut: session.date_debut, fin: session.date_fin } : null;

  const { rows: inscriptions } = await req(
    `SELECT i.id AS inscription_id, s.id AS stagiaire_id, s.email, s.nom, s.prenom
     FROM inscriptions i JOIN stagiaires s ON s.id = i.stagiaire_id
     WHERE i.session_id = $1`,
    [sessionId]
  );
  const parEmail = new Map();
  for (const ins of inscriptions) {
    const em = normaliserEmail(ins.email);
    if (!em) continue;
    if (!parEmail.has(em)) parEmail.set(em, []);
    parEmail.get(em).push(ins);
  }

  const resultats = [];
  const resume = { importables: 0, invalides: 0, aVerifier: 0, doublons: 0 };
  const vusExacts = new Set();

  for (let i = 0; i < analyse.lignes.length; i++) {
    const cellules = analyse.lignes[i];
    if (cellules.every((c) => !c)) continue;
    const v = extraireValeurs(cellules, colonnes);
    const email = normaliserEmail(v.email);
    const ligne = { index: i, statut: "pret", motif: null };

    if (!email || !validerEmail(email)) {
      ligne.statut = "invalide"; ligne.motif = "email absent ou invalide";
    } else {
      const candidats = parEmail.get(email) || [];
      if (candidats.length === 0) { ligne.statut = "invalide"; ligne.motif = "email inconnu dans cette session"; }
      else if (candidats.length > 1) { ligne.statut = "a_verifier"; ligne.motif = "plusieurs stagiaires partagent cet email"; }
      else {
        ligne.inscriptionId = candidats[0].inscription_id;
        ligne.stagiaire = { nom: candidats[0].nom, prenom: candidats[0].prenom };
      }
    }

    if (ligne.statut === "pret") {
      const type = typeEvaluationCsv(v.type);
      const date = dateDeCsv(v.date);
      const resultat = resultatCsv(v.resultat);
      const scoreR = lireNombreCsv(v.score);
      const maxR = lireNombreCsv(v.score_max);
      const pctR = lireNombreCsv(v.pourcentage);
      const seuilR = lireNombreCsv(v.seuil);

      if (!type) { ligne.statut = "invalide"; ligne.motif = "type d'évaluation inconnu ou absent"; }
      else if (!date) { ligne.statut = "invalide"; ligne.motif = "date absente ou illisible"; }
      else if (periode && (date < periode.debut || date > periode.fin)) {
        ligne.statut = "invalide";
        ligne.motif = `Hors période de session : date attendue entre le ${dateFr(periode.debut)} et le ${dateFr(periode.fin)}.`;
      }
      else if (resultat === null) { ligne.statut = "invalide"; ligne.motif = `résultat illisible : ${v.resultat}`; }
      else if (scoreR.erreur || maxR.erreur || pctR.erreur || seuilR.erreur) {
        ligne.statut = "invalide"; ligne.motif = scoreR.erreur || maxR.erreur || pctR.erreur || seuilR.erreur;
      } else {
        let score = scoreR.valeur, scoreMax = maxR.valeur, normalisePourcentage = false;
        if (pctR.valeur !== null && score === null) { score = pctR.valeur; scoreMax = 100; normalisePourcentage = true; }
        if ((score === null) !== (scoreMax === null)) {
          ligne.statut = "invalide"; ligne.motif = "score et score maximum doivent aller ensemble";
        } else if (score !== null && (score < 0 || scoreMax <= 0 || score > scoreMax)) {
          ligne.statut = "invalide"; ligne.motif = "score incohérent (négatif, maximum invalide ou score > maximum)";
        } else {
          ligne.type = type; ligne.date = date; ligne.resultat = resultat;
          ligne.score = score; ligne.score_max = scoreMax; ligne.seuil = seuilR.valeur;
          ligne.intitule = v.intitule || null; ligne.commentaire = v.commentaire || null;
          ligne.normalisePourcentage = normalisePourcentage;
          const cle = `${ligne.inscriptionId}|${type}|${ligne.intitule || ""}|${date}`;
          if (vusExacts.has(cle)) { ligne.statut = "doublon"; ligne.motif = "doublon exact dans le fichier (même inscription, type, intitulé, date)"; }
          else vusExacts.add(cle);
        }
      }
    }

    if (ligne.statut === "pret") resume.importables++;
    else if (ligne.statut === "invalide") resume.invalides++;
    else if (ligne.statut === "a_verifier") resume.aVerifier++;
    else if (ligne.statut === "doublon") resume.doublons++;
    resultats.push(ligne);
  }

  return { sep: analyse.sep, enTetes: analyse.enTetes, inconnus, resultats, resume };
}

function vueApercuResultats(r) {
  return {
    sep: r.sep, enTetes: r.enTetes, colonnesInconnues: r.inconnus, resume: r.resume,
    lignes: r.resultats.map((l) => ({
      index: l.index, statut: l.statut, motif: l.motif,
      stagiaire: l.stagiaire ?? null,
      type: l.type ?? null, intitule: l.intitule ?? null, date: l.date ?? null,
      score: l.score ?? null, score_max: l.score_max ?? null, seuil: l.seuil ?? null,
      resultat: l.resultat ?? null, commentaire: l.commentaire ?? null,
      normalisePourcentage: l.normalisePourcentage === true,
    })),
  };
}

router.post("/sessions/:id/evaluations/import-apercu", requireRedacteur, wrap(async (req, res) => {
  const sessionId = identifiant(req.params.id);
  if (!sessionId) return res.status(400).json({ error: "Identifiant de session invalide." });
  const texte = req.body?.texte;
  if (!texte || !String(texte).trim()) return res.status(400).json({ error: "Le fichier est vide." });
  const { rows: [session] } = await query("SELECT id FROM sessions WHERE id = $1", [sessionId]);
  if (!session) return res.status(404).json({ error: "Session introuvable." });
  const r = await classerResultats({ req: query, sessionId, texte });
  if (r.erreur) return res.status(400).json({ error: r.erreur });
  res.json(vueApercuResultats(r));
}));

router.post("/sessions/:id/evaluations/import", requireRedacteur, wrap(async (req, res) => {
  const sessionId = identifiant(req.params.id);
  if (!sessionId) return res.status(400).json({ error: "Identifiant de session invalide." });
  const texte = req.body?.texte;
  if (!texte || !String(texte).trim()) return res.status(400).json({ error: "Le fichier est vide." });

  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [session] } = await cx.query("SELECT id FROM sessions WHERE id = $1", [sessionId]);
    if (!session) { await cx.query("ROLLBACK"); return res.status(404).json({ error: "Session introuvable." }); }
    const r = await classerResultats({ req: (sql, params) => cx.query(sql, params), sessionId, texte });
    if (r.erreur) { await cx.query("ROLLBACK"); return res.status(400).json({ error: r.erreur }); }

    const bilan = { importes: 0, ignores: [] };
    for (const l of r.resultats) {
      if (l.statut !== "pret") { bilan.ignores.push({ index: l.index, statut: l.statut, motif: l.motif }); continue; }
      await cx.query(
        `INSERT INTO resultats_qcm (inscription_id, type, intitule, date_passage, score, score_max, seuil_reussite, resultat, commentaire)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [l.inscriptionId, l.type, l.intitule, l.date, l.score, l.score_max, l.seuil, l.resultat, l.commentaire]
      );
      bilan.importes++;
    }
    await cx.query("COMMIT");
    res.json({ bilan });
  } catch (e) {
    await cx.query("ROLLBACK");
    throw e;
  } finally { cx.release(); }
}));

// ── Satisfaction ────────────────────────────────────────────

function agregerSatisfactions(rows) {
  const reponses = rows.length;
  const anonymes = rows.filter((r) => !r.inscription_id).length;
  const notes = rows.filter((r) => r.note_globale !== null);
  const echelles = [...new Set(notes.map((r) => Number(r.note_max)))];
  let moyenne = null, echelleHomogene = null;
  if (echelles.length === 1 && notes.length) {
    echelleHomogene = echelles[0];
    const somme = notes.reduce((a, r) => a + Number(r.note_globale), 0);
    moyenne = Math.round((somme / notes.length) * 100) / 100;
  }
  return { reponses, anonymes, nominatives: reponses - anonymes, moyenne, echelleHomogene, echelles };
}

router.get("/sessions/:id/satisfactions", requireAuth, wrap(async (req, res) => {
  const sessionId = identifiant(req.params.id);
  if (!sessionId) return res.status(400).json({ error: "Identifiant de session invalide." });
  const { rows: [session] } = await query("SELECT id FROM sessions WHERE id = $1", [sessionId]);
  if (!session) return res.status(404).json({ error: "Session introuvable." });
  const { rows } = await query(
    `SELECT f.id, f.session_id, f.inscription_id, f.type, f.date_recueil,
            f.note_globale, f.note_max, f.commentaires, f.reponses, f.drive_file_id,
            s.nom, s.prenom
     FROM satisfactions f
     LEFT JOIN inscriptions i ON i.id = f.inscription_id
     LEFT JOIN stagiaires s ON s.id = i.stagiaire_id
     WHERE f.session_id = $1
     ORDER BY f.date_recueil DESC, f.id DESC`,
    [sessionId]
  );
  res.json({ satisfactions: rows, total: rows.length, agregation: agregerSatisfactions(rows) });
}));

router.post("/sessions/:id/satisfactions", requireRedacteur, wrap(async (req, res) => {
  const sessionId = identifiant(req.params.id);
  if (!sessionId) return res.status(400).json({ error: "Identifiant de session invalide." });
  const corps = req.body || {};
  if (!corps.type) return res.status(400).json({ error: "Type de satisfaction obligatoire." });
  if (!corps.date_recueil) return res.status(400).json({ error: "Date de recueil obligatoire." });

  const { rows: [session] } = await query("SELECT id FROM sessions WHERE id = $1", [sessionId]);
  if (!session) return res.status(404).json({ error: "Session introuvable." });
  const inscriptionId = corps.inscription_id === null || corps.inscription_id === undefined
    ? null : identifiant(corps.inscription_id);
  if (corps.inscription_id !== undefined && corps.inscription_id !== null && !inscriptionId) {
    return res.status(400).json({ error: "Inscription invalide." });
  }
  if (inscriptionId !== null) {
    const ins = await inscriptionDeSession(query, inscriptionId, sessionId);
    if (ins.erreur) return res.status(ins.erreur).json({ error: ins.message });
  }

  const { champs, erreur } = champsSatisfaction(corps);
  if (erreur) return res.status(400).json({ error: erreur });

  if (corps.drive_file_id && req.user.role !== "admin") {
    return res.status(403).json({ error: "Le rattachement d'un fichier Drive est réservé aux administrateurs." });
  }

  if (corps.drive_file_id) {
    const v = await verifierFichierDrive(corps.drive_file_id);
    if (v.erreur) return res.status(v.erreur).json({ error: v.message });
  }

  const colonnes = ["session_id", "inscription_id", ...Object.keys(champs)];
  const valeurs = [sessionId, inscriptionId, ...Object.values(champs)];
  const { rows: [f] } = await query(
    `INSERT INTO satisfactions (${colonnes.join(", ")})
     VALUES (${colonnes.map((_, i) => "$" + (i + 1)).join(", ")}) RETURNING *`,
    valeurs
  );
  res.status(201).json({ satisfaction: f });
}));

router.patch("/satisfactions/:id", requireRedacteur, wrap(async (req, res) => {
  const id = identifiant(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de satisfaction invalide." });
  const { rows: [avant] } = await query("SELECT * FROM satisfactions WHERE id = $1", [id]);
  if (!avant) return res.status(404).json({ error: "Satisfaction introuvable." });

  const corps = req.body || {};
  if (corps.inscription_id !== undefined) {
    const inscriptionId = corps.inscription_id === null ? null : identifiant(corps.inscription_id);
    if (corps.inscription_id !== null && !inscriptionId) return res.status(400).json({ error: "Inscription invalide." });
    if (inscriptionId !== null) {
      const ins = await inscriptionDeSession(query, inscriptionId, avant.session_id);
      if (ins.erreur) return res.status(ins.erreur).json({ error: ins.message });
    }
  }

  const { champs, erreur } = champsSatisfaction(corps, avant);
  if (erreur) return res.status(400).json({ error: erreur });
  if (!Object.keys(champs).length) return res.status(400).json({ error: "Rien à modifier." });

  if (corps.drive_file_id && req.user.role !== "admin") {
    return res.status(403).json({ error: "Le rattachement d'un fichier Drive est réservé aux administrateurs." });
  }

  if (corps.drive_file_id) {
    const v = await verifierFichierDrive(corps.drive_file_id);
    if (v.erreur) return res.status(v.erreur).json({ error: v.message });
  }

  const params = [id];
  const sets = Object.keys(champs).map((c) => { params.push(champs[c]); return `${c} = $${params.length}`; });
  const { rows: [f] } = await query(
    `UPDATE satisfactions SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params
  );
  res.json({ satisfaction: f });
}));

export default router;
