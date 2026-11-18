// ─────────────────────────────────────────────────────────────
//  « Aujourd'hui » : UNE liste de ce qui est à faire, rassemblée depuis les
//  données existantes (tâches, actions, sessions, réclamations, enquêtes,
//  candidatures, intervenants, preuves, risques, audit, veille, partenaires).
//  Lecture seule, nombre de requêtes CONSTANT, adapté au rôle :
//    - administrateur : tout ;
//    - contributeur   : ses tâches (et celles sans responsable), ses actions
//                       qualité, le suivi des sessions — rien d'autre.
//  Aucune donnée de stagiaire nominative, aucun champ handicap, aucun lien Drive.
// ─────────────────────────────────────────────────────────────
import { query } from "../db.js";
import { alertesJustificatifs } from "./justificatifs.js";

export const HORIZON_JOURS = 60;
const HORIZON_AUDIT_JOURS = 90;
const SEMAINE_JOURS = 7;
const SESSION_COURANTE = "s.archivee_le IS NULL AND s.statut <> 'annulee'";
const ACTION_OUVERTE = "a.statut NOT IN ('cloturee', 'annulee')";
const LIBELLES_JUSTIFICATIF = { cv: "CV", diplome: "Diplôme", attestation: "Attestation", certification: "Certification", contrat: "Contrat", autre: "Justificatif" };

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
export function ajouterJours(jour, n) {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const pl = (n, sing, plur) => `${n} ${n > 1 ? plur : sing}`;
const nomCourt = (i) => [i.prenom, i.nom ? `${String(i.nom).charAt(0)}.` : ""].filter(Boolean).join(" ") || "Intervenant";

// Range chaque élément : « retard » (échéance passée ou forcé), « semaine »
// (dans les 7 jours, ou sans date : à traiter maintenant), « plus_tard ».
// Tri : date croissante (sans date en tête de la semaine), puis titre. PUR.
export function classerElements(elements, jour) {
  const limite = ajouterJours(jour, SEMAINE_JOURS);
  const groupes = { retard: [], semaine: [], plus_tard: [] };
  for (const e of elements) {
    const date = iso(e.date);
    let g = e.groupe;
    if (!g) g = !date ? "semaine" : date < jour ? "retard" : date <= limite ? "semaine" : "plus_tard";
    groupes[g].push({ ...e, date });
  }
  const tri = (a, b) => (a.date || "").localeCompare(b.date || "") || a.titre.localeCompare(b.titre, "fr");
  for (const g of Object.values(groupes)) g.sort(tri);
  return groupes;
}

export async function elementsAujourdhui(user, jour) {
  const admin = user.role === "admin";
  const horizon = ajouterJours(jour, HORIZON_JOURS);
  const elements = [];
  const ajoute = (e) => elements.push(e);

  const [{ rows: taches }, { rows: actions }, { rows: suivi }, { rows: seances }] = await Promise.all([
    // Contributeur : ses tâches et celles sans responsable (jamais celles attribuées à d'autres).
    query(`SELECT t.id, t.titre, t.echeance, t.priorite, u.nom AS responsable
           FROM taches_qualite t LEFT JOIN utilisateurs u ON u.id = t.responsable_id
           WHERE t.statut IN ('a_faire', 'en_cours') AND (t.echeance IS NULL OR t.echeance <= $1)
             AND ($2::boolean OR t.responsable_id = $3 OR t.responsable_id IS NULL)
           ORDER BY t.echeance NULLS LAST, t.id LIMIT 100`, [horizon, admin, user.id]),
    query(`SELECT a.id, a.reference, a.titre, a.echeance, a.statut
           FROM actions_qualite a
           WHERE ${ACTION_OUVERTE} AND (a.echeance IS NULL OR a.echeance <= $1) AND ($2::boolean OR a.responsable_id = $3)
             AND (a.echeance IS NOT NULL OR a.statut = 'efficacite_a_verifier')
           ORDER BY a.echeance NULLS LAST, a.id LIMIT 100`, [horizon, admin, user.id]),
    // Une ligne par session courante ; comptes sur lignes DISTINCTES (même règle que le pilotage).
    query(`SELECT s.id, s.reference, s.date_debut, f.intitule AS formation,
             count(i.id) FILTER (WHERE NOT i.dossier_complet)::int AS dossiers_incomplets,
             count(i.id) FILTER (WHERE r.inscription_id IS NULL OR r.statut = 'a_faire')::int AS recueils_a_faire,
             (SELECT count(*)::int FROM adaptations_parcours ap JOIN inscriptions i2 ON i2.id = ap.inscription_id
               WHERE i2.session_id = s.id AND i2.statut <> 'abandon' AND ap.statut = 'prevue') AS mesures_prevues
           FROM sessions s JOIN formations f ON f.id = s.formation_id
           LEFT JOIN inscriptions i ON i.session_id = s.id AND i.statut <> 'abandon'
           LEFT JOIN recueils_besoin r ON r.inscription_id = i.id
           WHERE ${SESSION_COURANTE} AND s.date_debut <= $1
           GROUP BY s.id, f.intitule ORDER BY s.date_debut, s.id`, [horizon]),
    query(`SELECT se.id, se.session_id, se.date_seance, se.heure_debut, se.heure_fin, se.lieu, f.intitule AS formation, s.reference,
             (SELECT count(*)::int FROM inscriptions i WHERE i.session_id = s.id AND i.statut <> 'abandon'
               AND (se.groupe_id IS NULL OR i.groupe_id = se.groupe_id)) AS inscrits
           FROM seances se JOIN sessions s ON s.id = se.session_id JOIN formations f ON f.id = s.formation_id
           WHERE ${SESSION_COURANTE} AND se.date_seance BETWEEN $1 AND $2
           ORDER BY se.date_seance, se.heure_debut NULLS LAST, se.id LIMIT 6`, [jour, ajouterJours(jour, SEMAINE_JOURS)]),
  ]);

  for (const t of taches) {
    ajoute({ cle: `tache:${t.id}`, type: "tache", categorie: "qualiopi", titre: t.titre, date: t.echeance,
      contexte: ["Tâche", t.priorite === "haute" ? "priorité haute" : null, t.responsable ? `pour ${t.responsable}` : null].filter(Boolean).join(" · "),
      lien: "/taches", action: "Ouvrir", tache_id: t.id });
  }
  for (const a of actions) {
    const efficacite = a.statut === "efficacite_a_verifier";
    ajoute({ cle: `action:${a.id}`, type: "action", categorie: "qualiopi",
      titre: efficacite ? `Vérifier l'efficacité : ${a.titre}` : a.titre, date: a.echeance,
      contexte: `Amélioration ${a.reference}`, lien: `/actions-qualite/${a.id}`, action: "Ouvrir" });
  }
  for (const s of suivi) {
    const ctx = [s.formation, s.reference].filter(Boolean).join(" · ");
    if (s.dossiers_incomplets) ajoute({ cle: `dossiers:${s.id}`, type: "session", categorie: "formations", date: s.date_debut,
      titre: `Compléter ${pl(s.dossiers_incomplets, "dossier stagiaire", "dossiers stagiaires")}`, contexte: ctx, lien: `/sessions/${s.id}/stagiaires`, action: "Compléter" });
    if (s.recueils_a_faire) ajoute({ cle: `recueils:${s.id}`, type: "session", categorie: "formations", date: s.date_debut,
      titre: `Réaliser ${pl(s.recueils_a_faire, "recueil du besoin", "recueils du besoin")}`, contexte: ctx, lien: `/sessions/${s.id}/parcours`, action: "Ouvrir" });
    if (s.mesures_prevues) ajoute({ cle: `mesures:${s.id}`, type: "session", categorie: "formations", date: s.date_debut,
      titre: `Mettre en œuvre ${pl(s.mesures_prevues, "mesure pédagogique", "mesures pédagogiques")}`, contexte: ctx, lien: `/sessions/${s.id}/parcours`, action: "Ouvrir" });
  }

  if (admin) {
    const [{ rows: reclamations }, { rows: enquetes }, { rows: [cand] }, justif, { rows: entretiens }, { rows: [pr] },
      { rows: risques }, { rows: audits }, { rows: [ve] }, { rows: partenaires }] = await Promise.all([
      query(`SELECT s.id, s.reference, s.date_echeance_cible FROM signalements_qualite s
             WHERE s.type = 'reclamation' AND s.statut IN ('ouverte', 'qualifiee', 'en_traitement')
             ORDER BY s.date_echeance_cible NULLS LAST, s.id LIMIT 50`),
      // Fin de session proche ou récente sans enquête « à chaud ».
      query(`SELECT s.id, s.reference, s.date_fin, f.intitule AS formation FROM sessions s JOIN formations f ON f.id = s.formation_id
             WHERE ${SESSION_COURANTE} AND s.date_fin BETWEEN $1 AND $2
               AND NOT EXISTS (SELECT 1 FROM enquetes e WHERE e.session_id = s.id AND e.type = 'a_chaud')
             ORDER BY s.date_fin, s.id LIMIT 20`, [ajouterJours(jour, -30), ajouterJours(jour, 14)]),
      query("SELECT count(*)::int AS n FROM candidatures WHERE statut IN ('nouvelle', 'en_etude')"),
      alertesJustificatifs(),
      query(`SELECT i.id, i.nom, i.prenom, i.date_dernier_entretien FROM intervenants i
             WHERE i.actif AND (i.date_dernier_entretien IS NULL OR i.date_dernier_entretien <= $1)
             ORDER BY i.date_dernier_entretien NULLS FIRST, i.nom, i.id LIMIT 50`, [ajouterJours(horizon, -365)]),
      query(`SELECT count(*) FILTER (WHERE p.alerte_statut = 'perime')::int AS perimees,
                    count(*) FILTER (WHERE p.alerte_statut = 'bientot')::int AS bientot,
                    count(*) FILTER (WHERE p.a_confirmer)::int AS a_confirmer
             FROM preuves_enrichies p`),
      query(`SELECT r.id, r.titre, r.date_reevaluation FROM risques_qualite r
             WHERE r.statut <> 'clos' AND r.date_reevaluation IS NOT NULL AND r.date_reevaluation <= $1
             ORDER BY r.date_reevaluation, r.id LIMIT 50`, [horizon]),
      query(`SELECT c.id, c.titre, c.date_audit FROM campagnes_audit c
             WHERE c.statut IN ('preparation', 'prete') AND c.date_audit IS NOT NULL AND c.date_audit BETWEEN $1 AND $2
             ORDER BY c.date_audit, c.id LIMIT 5`, [jour, ajouterJours(jour, HORIZON_AUDIT_JOURS)]),
      query("SELECT count(*)::int AS n FROM veille WHERE statut_action = 'a_realiser'"),
      query(`SELECT p.id, p.nom, p.convention_fin FROM partenaires p
             WHERE p.statut = 'actif' AND p.convention_fin IS NOT NULL AND p.convention_fin <= $1
             ORDER BY p.convention_fin, p.id LIMIT 20`, [horizon]),
    ]);

    for (const r of reclamations) ajoute({ cle: `reclamation:${r.id}`, type: "reclamation", categorie: "qualiopi", date: r.date_echeance_cible,
      titre: `Traiter la réclamation ${r.reference}`, contexte: "Réclamation · indicateur 31", lien: `/signalements-qualite/${r.id}`, action: "Traiter" });
    for (const s of enquetes) ajoute({ cle: `enquete:${s.id}`, type: "enquete", categorie: "formations", date: s.date_fin,
      titre: "Préparer l'enquête de fin de formation", contexte: [s.formation, s.reference, `fin le ${s.date_fin ? iso(s.date_fin).split("-").reverse().join("/") : "—"}`].filter(Boolean).join(" · "),
      lien: "/enquetes", action: "Préparer" });
    if (cand.n) ajoute({ cle: "candidatures", type: "candidature", categorie: "formations", date: null,
      titre: `Étudier ${pl(cand.n, "candidature", "candidatures")}`, contexte: "Candidatures en ligne", lien: "/candidatures", action: "Étudier" });

    // Justificatifs : un élément par intervenant et par état (jamais le contenu du document).
    const parIntervenant = new Map();
    for (const el of justif.elements) {
      const k = `${el.intervenant.id}:${el.etat}`;
      if (!parIntervenant.has(k)) parIntervenant.set(k, { ...el, categories: [], date: iso(el.document?.date_echeance) });
      const g = parIntervenant.get(k);
      g.categories.push(LIBELLES_JUSTIFICATIF[el.categorie] || "Justificatif");
      const d = iso(el.document?.date_echeance);
      if (d && (!g.date || d < iso(g.date))) g.date = d;
    }
    for (const [k, g] of parIntervenant) {
      const quoi = [...new Set(g.categories)].join(", ");
      const titre = g.etat === "manquant" ? `${quoi} à déposer` : g.etat === "perime" ? `${quoi} périmé(s) à renouveler` : `${quoi} à renouveler bientôt`;
      ajoute({ cle: `justificatif:${k}`, type: "justificatif", categorie: "equipe", titre: `${titre} — ${nomCourt(g.intervenant)}`,
        date: g.etat === "manquant" ? null : g.date, groupe: g.etat === "perime" ? "retard" : undefined,
        contexte: "Équipe · indicateur 21", lien: "/justificatifs-intervenants", action: "Ouvrir" });
    }
    for (const i of entretiens) ajoute({ cle: `entretien:${i.id}`, type: "entretien", categorie: "equipe",
      date: i.date_dernier_entretien ? ajouterJours(iso(i.date_dernier_entretien), 365) : null,
      titre: `Planifier l'entretien annuel — ${nomCourt(i)}`, contexte: "Équipe · indicateur 22", lien: "/developpement-intervenants", action: "Planifier" });

    if (pr.perimees) ajoute({ cle: "preuves_perimees", type: "preuve", categorie: "qualiopi", date: null, groupe: "retard",
      titre: `Renouveler ${pl(pr.perimees, "preuve périmée", "preuves périmées")}`, contexte: "Preuves Qualiopi", lien: "/preuves?alerte=perime", action: "Voir" });
    if (pr.a_confirmer) ajoute({ cle: "preuves_a_confirmer", type: "preuve", categorie: "qualiopi", date: null,
      titre: `Confirmer ${pl(pr.a_confirmer, "preuve", "preuves")}`, contexte: "Preuves Qualiopi", lien: "/preuves?a_confirmer=1", action: "Voir" });
    if (pr.bientot) ajoute({ cle: "preuves_bientot", type: "preuve", categorie: "qualiopi", date: null, groupe: "plus_tard",
      titre: `Revoir ${pl(pr.bientot, "preuve", "preuves")} bientôt périmée(s)`, contexte: "Preuves Qualiopi", lien: "/preuves?alerte=bientot", action: "Voir" });
    for (const r of risques) ajoute({ cle: `risque:${r.id}`, type: "risque", categorie: "qualiopi", date: r.date_reevaluation,
      titre: `Réévaluer le risque : ${r.titre}`, contexte: "Risques", lien: "/risques", action: "Ouvrir" });
    for (const c of audits) ajoute({ cle: `audit:${c.id}`, type: "audit", categorie: "qualiopi", date: c.date_audit,
      titre: `Préparer l'audit : ${c.titre}`, contexte: "Préparation d'audit", lien: `/preparation-audit/${c.id}`, action: "Préparer" });
    if (ve.n) ajoute({ cle: "veille", type: "veille", categorie: "qualiopi", date: null,
      titre: `Réaliser ${pl(ve.n, "action de veille", "actions de veille")}`, contexte: "Veille · indicateurs 23 à 25", lien: "/veille?vue=actions", action: "Voir" });
    for (const p of partenaires) ajoute({ cle: `partenaire:${p.id}`, type: "partenaire", categorie: "qualiopi", date: p.convention_fin,
      titre: `Fin de convention : ${p.nom}`, contexte: "Partenaires", lien: "/partenaires", action: "Ouvrir" });
  }

  const groupes = classerElements(elements, jour);
  return {
    aujourdhui: jour,
    role: admin ? "admin" : "contributeur",
    groupes,
    compteurs: { retard: groupes.retard.length, semaine: groupes.semaine.length, plus_tard: groupes.plus_tard.length },
    seances: seances.map((s) => ({ id: s.id, session_id: s.session_id, date: iso(s.date_seance), heure_debut: s.heure_debut, heure_fin: s.heure_fin,
      lieu: s.lieu, formation: s.formation, reference: s.reference, inscrits: s.inscrits })),
  };
}
