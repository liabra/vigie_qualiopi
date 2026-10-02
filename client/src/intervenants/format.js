// Q4-1 — Annuaire des intervenants : libellés et règles PURES.
export const FONCTIONS_INTERVENANT = {
  formateur: "Formateur",
  referent_handicap: "Référent handicap",
  appui: "Personnel d'appui",
  autre: "Autre",
};
// Nature de la relation professionnelle (≠ fonction exercée).
export const NATURES_INTERVENANT = {
  salarie: "Salarié",
  exterieur: "Intervenant extérieur",
  sous_traitant: "Sous-traitant",
  porte: "Salarié porté",
};
export const nomComplet = (i) => `${i.prenom} ${i.nom}`;
const normaliser = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Filtres de l'annuaire, appliqués localement (une seule lecture de l'API).
export function filtrerIntervenants(liste, { q = "", fonction = "", nature = "", statut = "actifs" } = {}) {
  const aiguille = normaliser(q);
  return (liste || []).filter((i) =>
    (!aiguille || [i.nom, i.prenom, `${i.prenom} ${i.nom}`, i.email, ...(i.domaines || [])].some((c) => normaliser(c).includes(aiguille)))
    && (!fonction || i.fonction === fonction)
    && (!nature || i.nature === nature)
    && (statut === "tous" || (statut === "actifs" ? i.actif : !i.actif)));
}

// « Bureautique, Accueil » ⇄ ["Bureautique", "Accueil"].
export const domainesDepuisTexte = (t) => [...new Set(String(t || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean))];
export const domainesEnTexte = (l) => (l || []).join(", ");

export const FICHE_VIDE = { civilite: "", nom: "", prenom: "", email: "", fonction: "formateur", nature: "", domaines: "", formation_ids: [] };
export function valeursFiche(i) {
  if (!i) return { ...FICHE_VIDE };
  return { civilite: i.civilite || "", nom: i.nom, prenom: i.prenom, email: i.email || "", fonction: i.fonction, nature: i.nature,
    domaines: domainesEnTexte(i.domaines), formation_ids: (i.formations || []).map((f) => f.id) };
}
export function erreursFiche(v) {
  const e = {};
  if (!String(v.nom).trim()) e.nom = "Indiquez le nom.";
  if (!String(v.prenom).trim()) e.prenom = "Indiquez le prénom.";
  if (!v.nature) e.nature = "Choisissez la nature de l'intervention.";
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v.email).trim())) e.email = "Adresse e-mail invalide.";
  return e;
}
export function corpsFiche(v) {
  return {
    civilite: v.civilite || null, nom: String(v.nom).trim(), prenom: String(v.prenom).trim(),
    email: String(v.email).trim() || null, fonction: v.fonction, nature: v.nature,
    domaines: domainesDepuisTexte(v.domaines), formation_ids: v.formation_ids,
  };
}
