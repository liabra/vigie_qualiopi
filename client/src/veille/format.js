// Veille : libellés, segments, filtres et affichage. Module PUR (aucun
// React, aucun réseau). Les valeurs viennent du serveur et ne sont jamais
// modifiées ici ; les règles de cohérence restent celles du serveur (L6).
export { formaterDate } from "../sessions/format.js";

export const TYPES_VEILLE = {
  legale_reglementaire: "Légale / réglementaire",
  metiers_competences: "Métiers / compétences",
  innovations_pedagogiques: "Innovations pédagogiques",
  handicap: "Handicap",
  autre: "Autre",
};

// Couleur + texte, toujours. Deux états différents ne partagent jamais le
// même libellé ; la couleur seule ne porte aucune information.
export const STATUTS_VEILLE = {
  a_analyser: { libelle: "À analyser", ton: "warning" },
  analysee: { libelle: "Analysée", ton: "info" },
  integree: { libelle: "Intégrée", ton: "success" },
  sans_impact: { libelle: "Sans impact", ton: "neutral" },
};
export const STATUTS_ACTION = {
  aucune: { libelle: "Aucune action", ton: "neutral" },
  a_realiser: { libelle: "Action à réaliser", ton: "warning" },
  realisee: { libelle: "Action réalisée", ton: "success" },
};

// Segments de la liste (mapping EXACT, valeurs serveur inchangées) :
//   À analyser          statut = a_analyser
//   Actions à réaliser  statut_action = a_realiser, QUEL QUE SOIT le statut :
//                       une action décidée n'est jamais masquée
//   Traitées            statut ∈ {analysee, integree, sans_impact}
//                       ET statut_action ≠ a_realiser
//   Toutes              tout
// Toute entrée appartient à au moins un des trois premiers segments ; seule
// une entrée « à analyser » avec une action déjà « à réaliser » figure dans
// les deux premiers.
export const SEGMENTS = [
  { id: "a_analyser", libelle: "À analyser", test: (v) => v.statut === "a_analyser" },
  { id: "actions", libelle: "Actions à réaliser", test: (v) => v.statut_action === "a_realiser" },
  { id: "traitees", libelle: "Traitées", test: (v) => v.statut !== "a_analyser" && v.statut_action !== "a_realiser" },
  { id: "toutes", libelle: "Toutes", test: () => true },
];

const normaliser = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Filtre client sur la liste déjà chargée (GET /api/veille renvoie tout,
// 500 entrées au plus) : segment, type, indicateur (numéro), texte (titre,
// source, résumé).
export function filtrerVeilles(veilles, { segment = "toutes", type = "", indicateur = "", q = "" } = {}) {
  const seg = SEGMENTS.find((s) => s.id === segment) || SEGMENTS[3];
  const aiguille = normaliser(q.trim());
  const num = indicateur === "" ? null : Number(indicateur);
  return (veilles || []).filter((v) =>
    seg.test(v)
    && (!type || v.type === type)
    && (num === null || (v.indicateurs || []).some((i) => i.numero === num))
    && (!aiguille || [v.titre, v.source, v.resume].some((c) => normaliser(c).includes(aiguille))));
}

export function compterSegments(veilles) {
  return Object.fromEntries(SEGMENTS.map((s) => [s.id, (veilles || []).filter(s.test).length]));
}

// « Ind. 11, 23, 24 +3 » : trois numéros au plus, le reste compté.
export function indicateursCompacts(indicateurs, max = 3) {
  const nums = (indicateurs || []).map((i) => i.numero).sort((a, b) => a - b);
  return { visibles: nums.slice(0, max), reste: Math.max(0, nums.length - max), tous: nums };
}

// Numéros d'indicateurs présents dans la liste (pour le filtre).
export function indicateursPresents(veilles) {
  return [...new Set((veilles || []).flatMap((v) => (v.indicateurs || []).map((i) => i.numero)))].sort((a, b) => a - b);
}

// Groupes de la sélection : critères du référentiel ACTIF, filtrés par une
// recherche (numéro exact ou texte du libellé). Les indicateurs déjà liés
// mais absents du référentiel actif restent visibles dans un groupe à part,
// pour ne jamais retirer un lien sans le montrer.
export function groupesIndicateurs(criteres, recherche = "", dejaLies = []) {
  const aiguille = normaliser(recherche.trim());
  // Recherche purement numérique ⇒ numéro exact (« 1 » ne trouve pas le 11).
  const numero = /^\d+$/.test(aiguille) ? Number(aiguille) : null;
  const correspond = (i) => !aiguille || (numero !== null ? i.numero === numero : normaliser(i.libelle).includes(aiguille));
  const groupes = (criteres || []).map((c) => ({
    id: `critere-${c.id}`, titre: `Critère ${c.numero}`, sousTitre: c.libelle,
    indicateurs: (c.indicateurs || []).filter(correspond).map((i) => ({ id: i.id, numero: i.numero, libelle: i.libelle })),
  })).filter((g) => g.indicateurs.length > 0);
  const connus = new Set((criteres || []).flatMap((c) => (c.indicateurs || []).map((i) => i.id)));
  const autres = (dejaLies || []).filter((i) => !connus.has(i.id) && correspond(i));
  if (autres.length) groupes.push({ id: "autres", titre: "Hors référentiel actif", sousTitre: "Indicateurs déjà liés à cette veille", indicateurs: autres });
  return groupes;
}

// Corps envoyé à l'API — mêmes champs qu'avant UX-3. Seule différence : la
// date de réalisation n'est envoyée que pour une action « réalisée »
// (sinon null), conformément à la règle serveur L6.
export function corpsVeille(v) {
  return {
    type: v.type, titre: v.titre, source: v.source, url: v.url,
    date_publication: v.date_publication || null, date_effet: v.date_effet || null,
    resume: v.resume, analyse_impact: v.analyse_impact,
    rupture_reglementaire: v.rupture_reglementaire === true, statut: v.statut,
    action: v.action, statut_action: v.statut_action,
    action_realisee_le: v.statut_action === "realisee" ? (v.action_realisee_le || null) : null,
    date_consultation: v.date_consultation || null,
    indicateur_ids: (v.indicateur_ids || []).map(Number),
  };
}

export const VEILLE_VIDE = {
  type: "autre", titre: "", source: "", url: "", date_publication: "", date_effet: "",
  resume: "", analyse_impact: "", rupture_reglementaire: false, statut: "a_analyser",
  action: "", statut_action: "aucune", action_realisee_le: "", date_consultation: "", indicateur_ids: [],
};

const texte = (v) => (v === null || v === undefined ? "" : v);
const date = (d) => (d ? String(d).slice(0, 10) : "");
export const valeursDepuisVeille = (v) => ({
  type: v.type, titre: v.titre, source: texte(v.source), url: texte(v.url),
  date_publication: date(v.date_publication), date_effet: date(v.date_effet),
  resume: texte(v.resume), analyse_impact: texte(v.analyse_impact),
  rupture_reglementaire: !!v.rupture_reglementaire, statut: v.statut,
  action: texte(v.action), statut_action: v.statut_action,
  action_realisee_le: date(v.action_realisee_le), date_consultation: date(v.date_consultation),
  indicateur_ids: (v.indicateurs || []).map((i) => i.id),
});

// Lien externe affichable : seulement http(s) (jamais javascript: & co).
export function lienExterneSur(url) {
  try {
    const u = new URL(String(url || "").trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch { return null; }
}
