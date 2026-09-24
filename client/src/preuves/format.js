// Preuves : sources, échéances, groupement par indicateur et filtrage.
// Module PUR (aucun React, aucun réseau) : testable seul. Aucune règle
// métier n'est décidée ici — statuts, seuils et comptages viennent du
// serveur ; ces fonctions ne font que METTRE EN FORME les données reçues.

export const SOURCES = {
  manuel: "Manuelle",
  import_drive: "Import Drive",
  generation: "Génération",
};
export const ALERTES = { perime: "Périmée", bientot: "Bientôt à revoir" };

// Regroupe les preuves sous leur indicateur, lui-même sous son critère.
// Les indicateurs SANS preuve restent présents (preuves = []) : c'est ce
// qui permet de repérer immédiatement les trous. Les indicateurs marqués
// non applicables restent visibles, simplement signalés comme tels.
export function grouperParIndicateur(referentiel, preuves) {
  const parIndicateur = new Map();
  for (const p of preuves || []) {
    const liste = parIndicateur.get(p.indicateur_id) || [];
    liste.push(p);
    parIndicateur.set(p.indicateur_id, liste);
  }
  return (referentiel?.criteres || []).map((c) => ({
    ...c,
    indicateurs: c.indicateurs.map((i) => ({
      ...i,
      preuves: parIndicateur.get(i.id) || [],
    })),
  }));
}

// Filtre CLIENT sur la liste complète déjà chargée. `q` porte sur le titre ;
// les autres filtres sur des champs déjà calculés par le serveur (statut,
// échéance, à confirmer) ou sur l'origine de la preuve (source).
export function filtrerPreuves(preuves, f = {}) {
  const q = (f.q || "").trim().toLowerCase();
  return (preuves || []).filter((p) => {
    if (f.a_confirmer && !p.a_confirmer) return false;
    if (f.statut && p.statut !== f.statut) return false;
    if (f.alerte && p.alerte_statut !== f.alerte) return false;
    if (f.source && p.source !== f.source) return false;
    // Deep-link « indicateur » : `p.indicateur` est le NUMÉRO renvoyé par le
    // serveur (et non l'identifiant interne).
    if (f.indicateur && String(p.indicateur) !== String(f.indicateur)) return false;
    if (q && !(p.titre || "").toLowerCase().includes(q)) return false;
    return true;
  });
}

export function filtresActifs(f = {}) {
  return !!(f.q?.trim() || f.statut || f.alerte || f.source || f.a_confirmer);
}

// Un indicateur du référentiel : nombre de preuves rattachées (sert aux
// compteurs de la vue « par indicateur »).
export function compterParIndicateur(referentiel, preuves) {
  const compte = new Map();
  for (const p of preuves || []) compte.set(p.indicateur_id, (compte.get(p.indicateur_id) || 0) + 1);
  return (referentiel?.criteres || []).flatMap((c) =>
    c.indicateurs.map((i) => [i.id, compte.get(i.id) || 0])
  );
}
