// Q1-B5 — Tableau de bord qualité : présentation PURE (aucun React, aucun
// réseau). Les chiffres viennent du serveur ; rien n'est recalculé ici.

const normaliser = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Fiche source d'un objet qualité.
export const lienObjet = (type, id) => (type === "action" ? `/actions-qualite/${id}` : `/signalements-qualite/${id}`);
export const libelleType = (type) => (type === "action" ? "Action" : "Signalement");

// Événement d'activité lisible (cycle de vie uniquement).
export function libelleActivite(ev) {
  const action = ev.type === "action";
  switch (ev.evenement) {
    case "creation": return action ? "Action créée" : "Signalement créé";
    case "cloturer": return action ? "Action clôturée" : "Signalement clôturé";
    case "annuler": return action ? "Action annulée" : "Signalement annulé";
    case "rouvrir": return action ? "Action réouverte" : "Signalement réouvert";
    case "preuve_rattachee": return "Preuve rattachée";
    case "preuve_detachee": return "Lien avec une preuve retiré";
    default: return action ? "Action mise à jour" : "Signalement mis à jour";
  }
}

// Vue par indicateur : recherche (numéro exact ou mot du libellé) et tri.
export const TRIS_INDICATEURS = {
  numero: "Numéro",
  preuves: "Moins de preuves d'abord",
  activite: "Plus d'actions et signalements actifs d'abord",
};
export function filtrerIndicateurs(liste, { q = "", tri = "numero" } = {}) {
  const aiguille = normaliser(q.trim());
  const numero = /^\d+$/.test(aiguille) ? Number(aiguille) : null;
  const r = (liste || []).filter((i) => !aiguille || (numero !== null ? i.numero === numero : normaliser(i.libelle).includes(aiguille)));
  const parNumero = (a, b) => a.numero - b.numero;
  if (tri === "preuves") return [...r].sort((a, b) => a.preuves - b.preuves || parNumero(a, b));
  if (tri === "activite") return [...r].sort((a, b) => (b.actions_actives + b.signalements_actifs) - (a.actions_actives + a.signalements_actifs) || parNumero(a, b));
  return [...r].sort(parNumero);
}
