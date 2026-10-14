// DOC-9D1 — Jeunes hors session : libellés et état d'affichage. Module PUR.
export const ETATS_JEUNES = [
  { id: "tous", libelle: "Tous les dossiers" },
  { id: "entretiens_en_cours", libelle: "Entretiens en cours" },
  { id: "entretiens_valides", libelle: "Entretiens validés" },
  { id: "inscrits", libelle: "Inscrits" },
  { id: "sans_suite", libelle: "Sans suite" },
];

// État principal d'un jeune (badge). La priorité reflète le cycle de vie :
// « Sans suite » d'abord, puis l'inscription, puis l'entretien.
export function etatJeune(j) {
  if (j.sans_suite_le) return { ton: "neutral", libelle: "Sans suite" };
  if (j.nb_inscriptions > 0) return { ton: "success", libelle: "Inscrit" };
  if (j.entretiens_en_cours > 0) return { ton: "info", libelle: "Entretien en cours" };
  if (j.entretiens_valides > 0) return { ton: "success", libelle: "Entretien validé" };
  return { ton: "neutral", libelle: "Nouveau" };
}

export function nomComplet(j) {
  return `${j.civilite ? j.civilite + " " : ""}${j.prenom} ${j.nom}`;
}
