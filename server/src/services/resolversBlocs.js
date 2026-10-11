// ─────────────────────────────────────────────────────────────
//  DOC-6A — Champs RÉSOLUBLES des blocs répétables, depuis les VRAIES
//  colonnes de la base. Un champ absent de ce map est « non résoluble »
//  dans son bloc : le précontrôle le refuse (jamais une donnée inventée).
//  Module PUR : aucun appel réseau ni base.
// ─────────────────────────────────────────────────────────────
import { formaterDate, formaterDuree } from "./formatageDocuments.js";

const resolu = (valeur) => ({ statut: "resolu", valeur });
const absent = () => ({ statut: "absent", valeur: null });
const texte = (v) => (v ? resolu(v) : absent());
const date = (v) => (v ? resolu(formaterDate(v)) : absent());
const duree = (v) => (v === null || v === undefined || v === "" ? absent() : resolu(formaterDuree(v)));
// Booléen rendu à l'identique du scalaire abandon_statut : true / false.
const booleen = (v) => resolu(v === true);

// absences : table `absences` (inscription_id, date_absence, duree_heures,
// justifiee, motif). `absence_action` n'a AUCUNE colonne → non résoluble.
export const CHAMPS_BLOC = {
  absences: {
    absence_date: (l) => date(l.date_absence),
    absence_duree_heures: (l) => duree(l.duree_heures),
    absence_justification: (l) => booleen(l.justifiee),
    absence_motif: (l) => texte(l.motif),
  },
};

// Blocs réellement supportés (source de données confirmée).
export const BLOCS_SUPPORTES = Object.freeze(Object.keys(CHAMPS_BLOC));

export const blocSupportable = (nom) => Object.prototype.hasOwnProperty.call(CHAMPS_BLOC, nom);
export const champsResolubles = (nom) => (CHAMPS_BLOC[nom] ? new Set(Object.keys(CHAMPS_BLOC[nom])) : new Set());

// Valeur d'un champ de bloc pour UNE ligne. Renvoie « non_resoluble » si le
// champ n'a pas de resolver (le précontrôle l'aura déjà refusé).
export function champBloc(nomBloc, nomChamp, ligne) {
  const resolveur = CHAMPS_BLOC[nomBloc]?.[nomChamp];
  return resolveur ? resolveur(ligne) : { statut: "non_resoluble", valeur: null };
}
