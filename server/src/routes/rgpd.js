// ─────────────────────────────────────────────────────────────
//  RGPD (CDC §47) : durée de conservation, personnes arrivées au terme, droit d'accès (export des données
//  d'une personne) et droit à l'effacement (anonymisation irréversible, confirmée). Administrateur seulement ;
//  chaque export et chaque anonymisation sont journalisés. Les données statistiques restent (présences,
//  résultats, satisfaction) mais ne sont plus rattachées à une identité.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { getPool, query } from "../db.js";
import { requireAdmin } from "../session.js";
import { parseIdPositif } from "../services/ids.js";
import { journaliser } from "../services/journal.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const DUREE_DEFAUT = 5;

async function duree() {
  const { rows: [p] } = await query("SELECT duree_conservation_annees FROM parametres_organisme WHERE id = 1");
  return p?.duree_conservation_annees || DUREE_DEFAUT;
}

router.get("/rgpd/synthese", requireAdmin, wrap(async (_req, res) => {
  const annees = await duree();
  // Au terme : toutes les sessions de la personne sont terminées depuis plus de N ans (ou aucune inscription et
  // fiche créée depuis plus de N ans). Jamais une personne encore en parcours.
  const { rows } = await query(
    `SELECT s.id, s.nom, s.prenom, s.created_at, max(se.date_fin) AS derniere_fin, count(i.id)::int AS inscriptions
     FROM stagiaires s LEFT JOIN inscriptions i ON i.stagiaire_id = s.id LEFT JOIN sessions se ON se.id = i.session_id
     WHERE s.anonymise_le IS NULL
     GROUP BY s.id
     HAVING (count(i.id) = 0 AND s.created_at < now() - make_interval(years => $1))
         OR (count(i.id) > 0 AND max(se.date_fin) < CURRENT_DATE - make_interval(years => $1))
     ORDER BY derniere_fin NULLS FIRST, s.id LIMIT 500`, [annees]);
  const { rows: [{ anonymises }] } = await query("SELECT count(*)::int AS anonymises FROM stagiaires WHERE anonymise_le IS NOT NULL");
  res.json({ duree_conservation_annees: annees, au_terme: rows, anonymises });
}));

router.put("/rgpd/duree", requireAdmin, wrap(async (req, res) => {
  const n = Number(req.body?.annees);
  if (!Number.isInteger(n) || n < 1 || n > 50) return res.status(400).json({ error: "Durée de conservation : de 1 à 50 ans." });
  await query("UPDATE parametres_organisme SET duree_conservation_annees = $1, mis_a_jour_le = now(), mis_a_jour_par = $2 WHERE id = 1", [n, req.user.id]);
  await journaliser("rgpd_duree_conservation", { detail: `${n} ans`, par: req.user.id });
  res.json({ duree_conservation_annees: n });
}));

// Droit d'accès : toutes les données détenues sur une personne, en un fichier JSON lisible.
router.get("/rgpd/personnes/:id/export", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  const { rows: [personne] } = await query("SELECT * FROM stagiaires WHERE id = $1", [id]);
  if (!personne) return res.status(404).json({ error: "Personne introuvable." });
  const parInscription = (sql) => query(sql + " WHERE x.inscription_id IN (SELECT id FROM inscriptions WHERE stagiaire_id = $1)", [id]).then((r) => r.rows);
  const [inscriptions, recueils, adaptations, absences, evaluations, competences, questionnaires, suivis, entretiens] = await Promise.all([
    query(`SELECT i.id, i.statut, i.date_inscription, i.date_abandon, i.motif_abandon, i.prescripteur, i.dossier_complet, s.reference AS session, s.date_debut, s.date_fin, f.intitule AS formation
           FROM inscriptions i JOIN sessions s ON s.id = i.session_id LEFT JOIN formations f ON f.id = s.formation_id WHERE i.stagiaire_id = $1`, [id]).then((r) => r.rows),
    parInscription("SELECT x.* FROM recueils_besoin x"),
    parInscription("SELECT x.* FROM adaptations_parcours x"),
    parInscription("SELECT x.* FROM absences x"),
    parInscription("SELECT x.* FROM resultats_qcm x"),
    parInscription("SELECT x.competence, x.statut, x.mis_a_jour_le FROM competences_stagiaires x"),
    parInscription("SELECT x.question_libelle, x.valeur_texte, x.valeurs_choisies, x.cree_le FROM questionnaire_reponses x"),
    parInscription("SELECT x.type, x.date_evenement, x.categorie, x.canal, x.note FROM suivis_inscription x"),
    query("SELECT id, statut, cree_le, valide_le FROM entretiens WHERE stagiaire_id = $1", [id]).then((r) => r.rows),
  ]);
  await journaliser("rgpd_export_personne", { cibleType: "stagiaire", cibleId: id, par: req.user.id });
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="donnees-personne-${id}.json"`);
  res.send(JSON.stringify({ exporte_le: new Date().toISOString(), personne, inscriptions, recueils, adaptations, absences, evaluations, competences, questionnaires, suivis, entretiens,
    remarque: "Les documents générés dans Google Drive (convocations, attestations…) ne sont pas inclus : ils sont listés dans le dossier Drive de chaque session." }, null, 2));
}));

// Droit à l'effacement : anonymisation IRRÉVERSIBLE, confirmée par la saisie du mot ANONYMISER.
router.post("/rgpd/personnes/:id/anonymiser", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant invalide." });
  if (req.body?.confirmation !== "ANONYMISER") return res.status(400).json({ error: "Confirmation manquante : saisissez ANONYMISER." });
  const cx = await getPool().connect();
  try {
    await cx.query("BEGIN");
    const { rows: [p] } = await cx.query("SELECT id, anonymise_le FROM stagiaires WHERE id = $1 FOR UPDATE", [id]);
    if (!p) { await cx.query("ROLLBACK"); return res.status(404).json({ error: "Personne introuvable." }); }
    if (p.anonymise_le) { await cx.query("ROLLBACK"); return res.status(409).json({ error: "Personne déjà anonymisée." }); }
    const { rowCount: actives } = await cx.query(
      "SELECT 1 FROM inscriptions i JOIN sessions s ON s.id = i.session_id WHERE i.stagiaire_id = $1 AND i.statut IN ('inscrit','en_cours') AND s.date_fin >= CURRENT_DATE", [id]);
    if (actives) { await cx.query("ROLLBACK"); return res.status(409).json({ error: "Cette personne suit une session en cours : terminez ou clôturez son inscription avant de l'anonymiser." }); }
    await cx.query(
      `UPDATE stagiaires SET nom = 'Anonyme', prenom = 'Personne ' || id, civilite = NULL, email = NULL, telephone = NULL, entreprise = NULL, financeur = NULL,
         situation_handicap = false, besoins_adaptation = NULL, domaines_handicap = '{}', date_naissance = NULL, adresse = NULL, code_postal = NULL, ville = NULL,
         profession = NULL, entreprise_adresse = NULL, entreprise_siret = NULL, entreprise_ape = NULL, entreprise_effectifs = NULL, entreprise_responsable = NULL,
         entreprise_opca = NULL, anonymise_le = now() WHERE id = $1`, [id]);
    const ins = "(SELECT id FROM inscriptions WHERE stagiaire_id = $1)";
    await cx.query(`UPDATE inscriptions SET motif_abandon = NULL WHERE stagiaire_id = $1`, [id]);
    await cx.query(`UPDATE recueils_besoin SET attentes = NULL, objectifs_personnels = NULL WHERE inscription_id IN ${ins}`, [id]);
    await cx.query(`UPDATE adaptations_parcours SET mesure = 'Mesure anonymisée', bilan = NULL WHERE inscription_id IN ${ins}`, [id]);
    await cx.query(`UPDATE absences SET motif = NULL WHERE inscription_id IN ${ins}`, [id]);
    await cx.query(`UPDATE resultats_qcm SET commentaire = NULL WHERE inscription_id IN ${ins}`, [id]);
    await cx.query(`UPDATE suivis_inscription SET note = NULL WHERE inscription_id IN ${ins}`, [id]);
    await cx.query(`UPDATE suivi_seance SET accompagnement = NULL, difficultes = NULL, impressions = NULL, observations = NULL WHERE inscription_id IN ${ins}`, [id]);
    await cx.query(`UPDATE questionnaire_reponses SET valeur_texte = NULL WHERE inscription_id IN ${ins}`, [id]);
    await cx.query("DELETE FROM entretiens WHERE stagiaire_id = $1", [id]);
    await cx.query("COMMIT");
  } catch (e) { await cx.query("ROLLBACK").catch(() => {}); throw e; } finally { cx.release(); }
  await journaliser("rgpd_anonymisation", { cibleType: "stagiaire", cibleId: id, par: req.user.id });
  res.json({ ok: true, message: "Personne anonymisée. Pensez aux documents déjà générés dans Google Drive, qui ne sont pas modifiés." });
}));

export default router;
