// ─────────────────────────────────────────────────────────────
//  Assiduité d'une inscription (lot L2), réutilisée telle quelle par la
//  génération documentaire (lot L5). Il n'existe qu'UN seul calcul dans
//  tout le projet : celui-ci.
// ─────────────────────────────────────────────────────────────

// Assiduité d'une inscription. Le taux n'est rendu que lorsqu'il est
// calculable ET non trompeur :
// - abandon : les heures réellement suivies avant l'abandon ne sont pas
//   modélisées, un taux serait un chiffre inventé ;
// - durée prévue inconnue ou nulle : on ne peut rien rapporter ;
// - absences supérieures à la durée prévue : le taux est plafonné à 0 %,
//   et le dépassement est signalé plutôt que masqué.
export function calculerAssiduite({ heuresPrevues, heuresAbsence, statut }) {
  const total = Math.round((Number(heuresAbsence) || 0) * 100) / 100;
  const socle = {
    heures_absence: total, heures_prevues: null, heures_suivies: null,
    taux: null, fiable: false, raison: null, depassement: false,
  };
  if (statut === "abandon") return { ...socle, raison: "abandon" };
  const prevues = Number(heuresPrevues);
  if (!Number.isFinite(prevues) || prevues <= 0) return { ...socle, raison: "duree_inconnue" };
  const suivies = Math.max(0, Math.round((prevues - total) * 100) / 100);
  const taux = Math.min(100, Math.max(0, Math.round((suivies / prevues) * 100)));
  return {
    heures_absence: total,
    heures_prevues: prevues,
    heures_suivies: suivies,
    taux,
    fiable: true,
    raison: null,
    depassement: total > prevues,
  };
}
