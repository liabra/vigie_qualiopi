// Accueil : agrégation en LECTURE SEULE des données déjà fournies par les
// API existantes. Module PUR (aucun React, aucun réseau) : testable seul.
// Aucune règle métier n'est décidée ici — tout est déduit des réponses du
// serveur, jamais recalculé.

// À partir des listes complètes renvoyées par /api/preuves, /api/veille,
// /api/sessions, /api/audits et /api/referentiel, produit les compteurs et
// listes affichés sur l'Accueil. Aucune nouvelle API n'est nécessaire.
export function construireAccueil({ preuves = [], veilles = [], sessions = [], audits = [], referentiel = null }) {
  const aConfirmer = preuves.filter((p) => p.a_confirmer).length;
  const perimees = preuves.filter((p) => p.alerte_statut === "perime").length;
  const bientot = preuves.filter((p) => p.alerte_statut === "bientot").length;
  const veillesAction = veilles.filter((v) => v.statut_action === "a_realiser").length;

  const sessionsEnCours = sessions.filter((s) => s.statut === "en_cours");
  // Prochaines sessions : les planifiées, de la plus proche à la plus lointaine.
  const prochaines = sessions
    .filter((s) => s.statut === "planifiee")
    .slice()
    .sort((a, b) => String(a.date_debut || "").localeCompare(String(b.date_debut || "")));

  const score = referentiel?.score || null;
  const totalApplicable = score ? score.total - score.non_applicable : 0;
  const dernierAudit = audits[0] || null;

  const aTraiterTotal = aConfirmer + perimees + bientot + veillesAction;

  return {
    aConfirmer, perimees, bientot, veillesAction, aTraiterTotal,
    sessionsEnCours, prochaines, score, totalApplicable, dernierAudit,
  };
}
