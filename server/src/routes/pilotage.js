// ─────────────────────────────────────────────────────────────
//  Q5 — GET /api/pilotage/accueil : poste de pilotage agrégé, adapté au
//  rôle. Comptes uniquement (aucun nom de stagiaire, aucun commentaire,
//  aucun lien Drive, aucun champ handicap, aucun justificatif). Nombre de
//  requêtes CONSTANT (indépendant du nombre de stagiaires ou de preuves).
//  Sessions archivées et annulées exclues des compteurs courants.
//  « Aujourd'hui » = jour civil de Cayenne (dateMetierAujourdhui).
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../session.js";
import { dateMetierAujourdhui } from "../services/dates.js";
import { estAdmin } from "../services/confidentialite.js";
import { alertesJustificatifs } from "../services/justificatifs.js";
import { prioritesPilotage } from "../services/pilotage.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const SESSION_COURANTE = "s.archivee_le IS NULL AND s.statut <> 'annulee'";
const ACTION_OUVERTE = "a.statut NOT IN ('cloturee', 'annulee')";

router.get("/pilotage/accueil", requireAuth, wrap(async (req, res) => {
  const admin = estAdmin(req.user);
  const jour = dateMetierAujourdhui();

  // Sessions et bénéficiaires (communs aux deux rôles : le contributeur
  // accède déjà à toutes les sessions et à leurs inscriptions).
  const [{ rows: enCours }, { rows: aVenir }, { rows: suivi }] = await Promise.all([
    query(`SELECT s.id, s.reference, s.date_debut, s.date_fin, f.intitule AS formation FROM sessions s JOIN formations f ON f.id = s.formation_id
           WHERE ${SESSION_COURANTE} AND s.statut = 'en_cours' ORDER BY s.date_debut, s.id`),
    query(`SELECT s.id, s.reference, s.date_debut, s.date_fin, f.intitule AS formation FROM sessions s JOIN formations f ON f.id = s.formation_id
           WHERE ${SESSION_COURANTE} AND s.statut = 'planifiee' AND s.date_debut >= $1 ORDER BY s.date_debut, s.id LIMIT 5`, [jour]),
    // Une ligne par session courante ; chaque compte porte sur des lignes
    // DISTINCTES (inscription 1-1 recueil ; mesures en sous-requête) :
    // aucun doublon.
    query(`SELECT s.id, s.reference, s.date_debut,
             count(i.id)::int AS inscrits,
             count(i.id) FILTER (WHERE NOT i.dossier_complet)::int AS dossiers_incomplets,
             count(i.id) FILTER (WHERE r.inscription_id IS NULL OR r.statut = 'a_faire')::int AS recueils_a_faire,
             (SELECT count(*)::int FROM adaptations_parcours ap JOIN inscriptions i2 ON i2.id = ap.inscription_id
               WHERE i2.session_id = s.id AND i2.statut <> 'abandon' AND ap.statut = 'prevue') AS mesures_prevues
           FROM sessions s
           LEFT JOIN inscriptions i ON i.session_id = s.id AND i.statut <> 'abandon'
           LEFT JOIN recueils_besoin r ON r.inscription_id = i.id
           WHERE ${SESSION_COURANTE}
           GROUP BY s.id ORDER BY s.date_debut, s.id`),
  ]);
  const total = (k) => suivi.reduce((n, s) => n + s[k], 0);
  const sessions = {
    en_cours: enCours.length, a_venir: aVenir, en_cours_liste: enCours.slice(0, 5),
    inscrits_actifs: total("inscrits"), dossiers_incomplets: total("dossiers_incomplets"),
    recueils_a_faire: total("recueils_a_faire"), mesures_prevues: total("mesures_prevues"),
  };
  const sessionsSuivi = suivi.filter((s) => s.dossiers_incomplets || s.recueils_a_faire || s.mesures_prevues)
    .map(({ id, reference, date_debut, dossiers_incomplets, recueils_a_faire, mesures_prevues }) => ({ id, reference, date_debut, dossiers_incomplets, recueils_a_faire, mesures_prevues }));

  const donnees = { aujourdhui: jour, role: admin ? "admin" : "contributeur", sessions, sessions_suivi: sessionsSuivi };

  if (admin) {
    const [{ rows: [qa] }, { rows: [qs] }, { rows: [pr] }, { rows: [sat] }, { rows: [ve] }, { rows: [au] }, justif] = await Promise.all([
      query(`SELECT count(*) FILTER (WHERE ${ACTION_OUVERTE})::int AS ouvertes,
                    count(*) FILTER (WHERE ${ACTION_OUVERTE} AND a.echeance < $1)::int AS en_retard,
                    count(*) FILTER (WHERE a.statut = 'efficacite_a_verifier')::int AS efficacite_a_verifier
             FROM actions_qualite a`, [jour]),
      query(`SELECT count(*) FILTER (WHERE s.type = 'reclamation' AND s.statut IN ('ouverte', 'qualifiee', 'en_traitement'))::int AS reclamations_en_cours,
                    count(*) FILTER (WHERE s.type = 'reclamation' AND s.statut IN ('ouverte', 'qualifiee', 'en_traitement') AND s.date_echeance_cible < $1)::int AS reclamations_en_retard,
                    count(*) FILTER (WHERE s.statut IN ('ouverte', 'qualifiee', 'en_traitement'))::int AS signalements_a_traiter
             FROM signalements_qualite s`, [jour]),
      query(`SELECT count(*) FILTER (WHERE p.alerte_statut = 'perime')::int AS perimees,
                    count(*) FILTER (WHERE p.alerte_statut = 'bientot')::int AS bientot,
                    count(*) FILTER (WHERE p.a_confirmer)::int AS a_confirmer
             FROM preuves_enrichies p`),
      query("SELECT count(*)::int AS reponses FROM satisfactions f JOIN sessions s ON s.id = f.session_id WHERE s.archivee_le IS NULL"),
      query("SELECT count(*)::int AS n FROM veille WHERE statut_action = 'a_realiser'"),
      query("SELECT type, date_audit, resultat FROM audits_history ORDER BY date_audit DESC, id DESC LIMIT 1"),
      alertesJustificatifs(),
    ]);
    Object.assign(donnees, {
      qualite: { actions_ouvertes: qa.ouvertes, actions_en_retard: qa.en_retard, efficacite_a_verifier: qa.efficacite_a_verifier, ...qs },
      preuves: pr, justificatifs: justif.resume, satisfaction: { reponses: sat.reponses }, veille_actions: ve.n, dernier_audit: au || null,
    });
  } else {
    // Contributeur : SES actions qualité seulement (titre, référence,
    // échéance, statut) — jamais celles des autres, jamais de signalement.
    const { rows: mes } = await query(
      `SELECT a.id, a.reference, a.titre, a.echeance, a.statut, COALESCE(a.echeance < $2, false) AS en_retard,
              count(*) OVER ()::int AS total_ouvertes,
              count(*) FILTER (WHERE a.echeance < $2) OVER ()::int AS total_en_retard
       FROM actions_qualite a WHERE a.responsable_id = $1 AND ${ACTION_OUVERTE}
       ORDER BY a.echeance NULLS LAST, a.id LIMIT 5`, [req.user.id, jour]);
    donnees.mes_actions = {
      ouvertes: mes[0]?.total_ouvertes ?? 0, en_retard: mes[0]?.total_en_retard ?? 0,
      liste: mes.map(({ total_ouvertes, total_en_retard, ...a }) => a),
    };
  }
  donnees.priorites = prioritesPilotage(donnees, admin);
  res.json(donnees);
}));

export default router;
