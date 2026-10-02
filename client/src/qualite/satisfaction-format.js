// Q3 — Satisfaction : libellés et règles PURES partagés (onglet de session,
// synthèse multi-sessions, actions qualité, tableau de bord).

// « Public interrogé » : le modèle historique mélange des moments (à chaud,
// à froid) et des publics ; libellés conservés tels quels.
export const PUBLICS_SATISFACTION = {
  a_chaud: "À chaud", a_froid: "À froid", financeur: "Financeur", entreprise: "Entreprise",
  formateur: "Formateur", prescripteur: "Prescripteur", partenaire: "Partenaire",
};
export const libellePublic = (t) => PUBLICS_SATISFACTION[t] || t;
export const MSG_TAUX_INDISPONIBLE = "Taux de réponse non disponible";
export const LIBELLE_ORIGINE_SATISFACTION = "Action issue d'un retour de satisfaction";

// Une moyenne n'a de sens que sur UNE échelle : « 3,6 / 5 ».
export const moyenneSurEchelle = (moyenne, echelle) => `${String(moyenne).replace(".", ",")} / ${echelle}`;

// Résumé lisible d'une provenance de synthèse (aucune donnée individuelle).
export function libelleProvenanceSynthese({ du, au, type } = {}) {
  const d = (x) => (x ? String(x).slice(0, 10).split("-").reverse().join("/") : "…");
  return `Synthèse du ${d(du)} au ${d(au)} — ${type ? libellePublic(type) : "tous publics"}`;
}

// Paramètres de requête de la synthèse (champs vides ignorés).
export function requeteSynthese(f = {}) {
  const p = new URLSearchParams();
  for (const k of ["du", "au", "formation_id", "type", "session_id"]) if (f[k]) p.set(k, f[k]);
  const s = p.toString();
  return s ? `?${s}` : "";
}
