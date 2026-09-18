// ─────────────────────────────────────────────────────────────
//  Phase 2 — saisie des formations, sessions, groupes, stagiaires,
//  modèles de documents, et lancement des générations.
//  Tout est réservé à l'admin : l'interface contributeur viendra plus tard.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { getPool, query } from "../db.js";
import { requireAdmin, requireAuth } from "../session.js";
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
  const { formation_id, date_debut, date_fin, reference, lieu, modalite, formateur, duree_heures_reelle } = req.body || {};
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
       lieu, modalite, formateur, duree_heures_reelle)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [formation_id, version.id, reference?.trim() || null, date_debut, date_fin,
     lieu?.trim() || null, modalite || null, formateur?.trim() || null, duree_heures_reelle || null]
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
router.post("/sessions/:id/stagiaires", requireAdmin, wrap(async (req, res) => {
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
router.patch("/inscriptions/:id", requireAdmin, wrap(async (req, res) => {
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
router.post("/generations", requireAdmin, wrap(async (req, res) => {
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
