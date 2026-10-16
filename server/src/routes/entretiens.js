// ─────────────────────────────────────────────────────────────
//  DOC-9C — Entretiens initiaux FSE-IA : socle de conservation et de
//  reprise AVANT l'inscription d'un stagiaire à une session.
//
//  Droits : lecture pour tout utilisateur connecté (requireAuth),
//  écriture admin + contributeur (requireRedacteur). Aucun entretien n'est
//  rattaché à une session. La validation est EXPLICITE, jamais automatique.
//  Aucune donnée médicale, diagnostic, RQTH ni handicap.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { getPool, query } from "../db.js";
import { requireAuth, requireRedacteur } from "../session.js";
import { parseIdPositif } from "../services/ids.js";
import { validerReponses } from "../services/entretiens.js";
import { validerEvaluations, validerPhases } from "../services/positionnementEntretien.js";
import { validerChoixListe } from "../services/entretienChoix.js";
import { validerLignes, BLOCS_LIGNES } from "../services/entretienLignes.js";
import { chargerEntretienComplet } from "../services/entretienLecture.js";
import { getDrive, etatJeton, DRIVE_FILE } from "../services/google.js";
import { genererFicheEntretienDocument } from "../services/ficheEntretienDocument.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Créer un entretien (brouillon) pour un stagiaire existant. Plusieurs
// entretiens sont possibles pour une même personne.
router.post("/stagiaires/:id/entretiens", requireRedacteur, wrap(async (req, res) => {
  const stagiaireId = parseIdPositif(req.params.id);
  if (!stagiaireId) return res.status(400).json({ error: "Identifiant de stagiaire invalide." });
  const { rows: [s] } = await query("SELECT id FROM stagiaires WHERE id = $1", [stagiaireId]);
  if (!s) return res.status(404).json({ error: "Stagiaire introuvable." });
  const { rows: [entretien] } = await query(
    "INSERT INTO entretiens (stagiaire_id, cree_par) VALUES ($1,$2) RETURNING *",
    [stagiaireId, req.user.id]
  );
  res.status(201).json({ entretien });
}));

// Lister les entretiens d'un stagiaire (état seulement, jamais les textes).
router.get("/stagiaires/:id/entretiens", requireAuth, wrap(async (req, res) => {
  const stagiaireId = parseIdPositif(req.params.id);
  if (!stagiaireId) return res.status(400).json({ error: "Identifiant de stagiaire invalide." });
  const { rows } = await query(
    "SELECT id, stagiaire_id, statut, version, cree_le, mis_a_jour_le, valide_le FROM entretiens WHERE stagiaire_id = $1 ORDER BY id",
    [stagiaireId]
  );
  res.json({ entretiens: rows, total: rows.length });
}));

// Consulter un entretien et ses réponses (reprise d'un brouillon).
router.get("/entretiens/:id", requireAuth, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'entretien invalide." });
  const donnees = await chargerEntretienComplet(id);
  if (!donnees) return res.status(404).json({ error: "Entretien introuvable." });
  res.json(donnees);
}));

// Enregistrer progressivement les réponses (remplacement complet, verrou
// optimiste via `version`). Refuse toute clé inconnue, toute source hors
// contrat, et tout entretien déjà validé.
router.put("/entretiens/:id/reponses", requireRedacteur, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'entretien invalide." });
  const version = req.body?.version;
  if (!Number.isInteger(version) || version < 1) return res.status(400).json({ error: "Version attendue (entier positif)." });
  const { reponses, erreur } = validerReponses(req.body?.reponses);
  if (erreur) return res.status(400).json({ error: erreur });

  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [entretien] } = await cx.query("SELECT * FROM entretiens WHERE id = $1 FOR UPDATE", [id]);
    if (!entretien) { await cx.query("ROLLBACK"); return res.status(404).json({ error: "Entretien introuvable." }); }
    if (entretien.statut !== "brouillon") { await cx.query("ROLLBACK"); return res.status(409).json({ error: "Entretien déjà validé : lecture seule." }); }
    if (entretien.version !== version) { await cx.query("ROLLBACK"); return res.status(409).json({ error: "L'entretien a été modifié entre-temps : rechargez-le." }); }
    await cx.query("DELETE FROM entretien_reponses WHERE entretien_id = $1", [id]);
    for (const r of reponses) {
      await cx.query(
        "INSERT INTO entretien_reponses (entretien_id, cle, valeur, source) VALUES ($1,$2,$3,$4)",
        [id, r.cle, r.valeur, r.source]
      );
    }
    await cx.query("UPDATE entretiens SET version = version + 1, mis_a_jour_le = now() WHERE id = $1", [id]);
    await cx.query("COMMIT");
    const { rows: [maj] } = await query("SELECT * FROM entretiens WHERE id = $1", [id]);
    res.json({ entretien: maj });
  } catch (e) {
    await cx.query("ROLLBACK");
    throw e;
  } finally { cx.release(); }
}));

// DOC-9D2 lot B — Enregistrer progressivement le questionnaire de
// positionnement (34 compétences au plus, par phase). Même contrat que
// `/reponses` : remplacement complet, verrou optimiste PARTAGÉ sur
// `entretiens.version` (un seul compteur de conflit pour tout l'entretien,
// rubriques classiques et positionnement confondus), refusé si validé.
router.put("/entretiens/:id/positionnement", requireRedacteur, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'entretien invalide." });
  const version = req.body?.version;
  if (!Number.isInteger(version) || version < 1) return res.status(400).json({ error: "Version attendue (entier positif)." });
  const { evaluations, erreur: erreurEval } = validerEvaluations(req.body?.evaluations);
  if (erreurEval) return res.status(400).json({ error: erreurEval });
  const { phases, erreur: erreurPhases } = validerPhases(req.body?.phases);
  if (erreurPhases) return res.status(400).json({ error: erreurPhases });

  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [entretien] } = await cx.query("SELECT * FROM entretiens WHERE id = $1 FOR UPDATE", [id]);
    if (!entretien) { await cx.query("ROLLBACK"); return res.status(404).json({ error: "Entretien introuvable." }); }
    if (entretien.statut !== "brouillon") { await cx.query("ROLLBACK"); return res.status(409).json({ error: "Entretien déjà validé : lecture seule." }); }
    if (entretien.version !== version) { await cx.query("ROLLBACK"); return res.status(409).json({ error: "L'entretien a été modifié entre-temps : rechargez-le." }); }
    await cx.query("DELETE FROM entretien_positionnement_evaluations WHERE entretien_id = $1", [id]);
    for (const e of evaluations) {
      await cx.query(
        "INSERT INTO entretien_positionnement_evaluations (entretien_id, phase, competence_code, niveau) VALUES ($1,$2,$3,$4)",
        [id, e.phase, e.competence_code, e.niveau]
      );
    }
    await cx.query("DELETE FROM entretien_positionnement_phases WHERE entretien_id = $1", [id]);
    for (const p of phases) {
      await cx.query(
        "INSERT INTO entretien_positionnement_phases (entretien_id, phase, priorite, observations) VALUES ($1,$2,$3,$4)",
        [id, p.phase, p.priorite, p.observations]
      );
    }
    await cx.query("UPDATE entretiens SET version = version + 1, mis_a_jour_le = now() WHERE id = $1", [id]);
    await cx.query("COMMIT");
    const { rows: [maj] } = await query("SELECT * FROM entretiens WHERE id = $1", [id]);
    res.json({ entretien: maj });
  } catch (e) {
    await cx.query("ROLLBACK");
    throw e;
  } finally { cx.release(); }
}));

// DOC-9D3 lot B — Enregistrer progressivement les cases cochées (groupes
// fermés, ex. objectifs souhaités, loisirs...). Même contrat de
// remplacement complet, même verrou PARTAGÉ sur `entretiens.version`.
router.put("/entretiens/:id/choix", requireRedacteur, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'entretien invalide." });
  const version = req.body?.version;
  if (!Number.isInteger(version) || version < 1) return res.status(400).json({ error: "Version attendue (entier positif)." });
  const { choix, erreur } = validerChoixListe(req.body?.choix);
  if (erreur) return res.status(400).json({ error: erreur });

  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [entretien] } = await cx.query("SELECT * FROM entretiens WHERE id = $1 FOR UPDATE", [id]);
    if (!entretien) { await cx.query("ROLLBACK"); return res.status(404).json({ error: "Entretien introuvable." }); }
    if (entretien.statut !== "brouillon") { await cx.query("ROLLBACK"); return res.status(409).json({ error: "Entretien déjà validé : lecture seule." }); }
    if (entretien.version !== version) { await cx.query("ROLLBACK"); return res.status(409).json({ error: "L'entretien a été modifié entre-temps : rechargez-le." }); }
    await cx.query("DELETE FROM entretien_choix WHERE entretien_id = $1", [id]);
    for (const c of choix) {
      await cx.query("INSERT INTO entretien_choix (entretien_id, groupe, code) VALUES ($1,$2,$3)", [id, c.groupe, c.code]);
    }
    await cx.query("UPDATE entretiens SET version = version + 1, mis_a_jour_le = now() WHERE id = $1", [id]);
    await cx.query("COMMIT");
    const { rows: [maj] } = await query("SELECT * FROM entretiens WHERE id = $1", [id]);
    res.json({ entretien: maj });
  } catch (e) {
    await cx.query("ROLLBACK");
    throw e;
  } finally { cx.release(); }
}));

// DOC-9D3 lot B — Enregistrer progressivement un tableau répétable
// (`bloc` : "experiences" ou "plan_action"). Remplace UNIQUEMENT le bloc
// ciblé (l'autre tableau et toutes les autres données restent intacts),
// même verrou PARTAGÉ sur `entretiens.version`.
router.put("/entretiens/:id/lignes", requireRedacteur, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'entretien invalide." });
  const bloc = typeof req.body?.bloc === "string" ? req.body.bloc.trim() : "";
  if (!BLOCS_LIGNES.includes(bloc)) return res.status(400).json({ error: "Tableau inconnu." });
  const version = req.body?.version;
  if (!Number.isInteger(version) || version < 1) return res.status(400).json({ error: "Version attendue (entier positif)." });
  const { lignes, erreur } = validerLignes(bloc, req.body?.lignes);
  if (erreur) return res.status(400).json({ error: erreur });

  const table = bloc === "experiences" ? "entretien_experiences" : "entretien_plan_action";
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [entretien] } = await cx.query("SELECT * FROM entretiens WHERE id = $1 FOR UPDATE", [id]);
    if (!entretien) { await cx.query("ROLLBACK"); return res.status(404).json({ error: "Entretien introuvable." }); }
    if (entretien.statut !== "brouillon") { await cx.query("ROLLBACK"); return res.status(409).json({ error: "Entretien déjà validé : lecture seule." }); }
    if (entretien.version !== version) { await cx.query("ROLLBACK"); return res.status(409).json({ error: "L'entretien a été modifié entre-temps : rechargez-le." }); }
    await cx.query(`DELETE FROM ${table} WHERE entretien_id = $1`, [id]);
    for (const l of lignes) {
      if (bloc === "experiences") {
        await cx.query(
          "INSERT INTO entretien_experiences (entretien_id, ordre, structure, duree, missions, retenue) VALUES ($1,$2,$3,$4,$5,$6)",
          [id, l.ordre, l.structure, l.duree, l.missions, l.retenue]
        );
      } else {
        await cx.query(
          "INSERT INTO entretien_plan_action (entretien_id, ordre, objectif, phase, action, echeance, etat) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [id, l.ordre, l.objectif, l.phase, l.action, l.echeance, l.etat]
        );
      }
    }
    await cx.query("UPDATE entretiens SET version = version + 1, mis_a_jour_le = now() WHERE id = $1", [id]);
    await cx.query("COMMIT");
    const { rows: [maj] } = await query("SELECT * FROM entretiens WHERE id = $1", [id]);
    res.json({ entretien: maj });
  } catch (e) {
    await cx.query("ROLLBACK");
    throw e;
  } finally { cx.release(); }
}));

// Valider explicitement un entretien (brouillon → valide). Jamais automatique.
router.post("/entretiens/:id/valider", requireRedacteur, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'entretien invalide." });
  const { rows: [entretien] } = await query(
    "UPDATE entretiens SET statut = 'valide', valide_le = now(), valide_par = $2, mis_a_jour_le = now() WHERE id = $1 AND statut = 'brouillon' RETURNING *",
    [id, req.user.id]
  );
  if (!entretien) {
    const { rows: [existant] } = await query("SELECT id FROM entretiens WHERE id = $1", [id]);
    if (!existant) return res.status(404).json({ error: "Entretien introuvable." });
    return res.status(409).json({ error: "Entretien déjà validé." });
  }
  res.json({ entretien });
}));

// DOC-9E — Générer la fiche FSE-IA d'un entretien VALIDÉ. Un seul document
// vivant par entretien : régénérer exige `remplacer: true` explicite,
// jamais un écrasement silencieux (même logique que la génération de
// documents de session).
router.post("/entretiens/:id/fiche", requireRedacteur, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'entretien invalide." });
  const donnees = await chargerEntretienComplet(id);
  if (!donnees) return res.status(404).json({ error: "Entretien introuvable." });
  if (donnees.entretien.statut !== "valide") {
    return res.status(400).json({ error: "L'entretien doit être validé avant de générer la fiche." });
  }
  if (donnees.entretien.fiche_drive_file_id && req.body?.remplacer !== true) {
    return res.status(409).json({
      error: "Une fiche a déjà été générée pour cet entretien. Confirmez le remplacement pour la régénérer.",
      fiche_existante: { drive_file_id: donnees.entretien.fiche_drive_file_id, drive_url: donnees.entretien.fiche_drive_url },
    });
  }
  const { rows: [stagiaire] } = await query("SELECT nom, prenom FROM stagiaires WHERE id = $1", [donnees.entretien.stagiaire_id]);
  if (!stagiaire) return res.status(404).json({ error: "Jeune introuvable." });

  const d = await getDrive();
  if (!d) return res.status(503).json({ error: "Google Drive est indisponible ou non connecté. Impossible de générer la fiche." });
  if (!d.row.scopes.split(/\s+/).includes(DRIVE_FILE)) {
    return res.status(400).json({ error: "Le Drive est connecté en lecture seule. Reconnectez-le pour autoriser la création de documents." });
  }
  const jeton = etatJeton(d.row);

  try {
    const fiche = await genererFicheEntretienDocument(d, {
      donneesEntretien: donnees, stagiaire, ancienFicheId: donnees.entretien.fiche_drive_file_id || null,
    }, jeton);
    const { rows: [maj] } = await query(
      `UPDATE entretiens SET fiche_drive_file_id = $2, fiche_drive_url = $3, fiche_generee_le = now(), fiche_generee_par = $4
       WHERE id = $1 RETURNING *`,
      [id, fiche.id, fiche.webViewLink || null, req.user.id]
    );
    res.json({ entretien: maj, fiche });
  } catch (e) {
    if (e.statut) return res.status(e.statut).json({ error: e.message });
    return res.status(400).json({ error: "Impossible de générer la fiche : " + (e.message || "erreur inconnue") });
  }
}));

export default router;
