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
const nombre = (v) => (v === null || v === undefined ? absent() : resolu(Number(v)));
// Booléen rendu à l'identique du scalaire abandon_statut : true / false.
const booleen = (v) => resolu(v === true);

export const CHAMPS_BLOC = {
  // absences : table `absences`. `absence_action` n'a AUCUNE colonne → non résoluble.
  absences: {
    absence_date: (l) => date(l.date_absence),
    absence_duree_heures: (l) => duree(l.duree_heures),
    absence_justification: (l) => booleen(l.justifiee),
    absence_motif: (l) => texte(l.motif),
  },
  // evaluations : table `resultats_qcm` (intitule, date_passage, score,
  // score_max). Pourcentage = score / score_max × 100 (dénominateur > 0).
  // moment/methode/resultat_validation/niveau/commentaire/objectif_associe :
  // AUCUNE colonne ni règle officielle → non résolubles.
  evaluations: {
    evaluation_intitule: (l) => texte(l.intitule),
    evaluation_date: (l) => date(l.date_passage),
    evaluation_score_obtenu: (l) => nombre(l.score),
    evaluation_score_max: (l) => nombre(l.score_max),
    evaluation_pourcentage: (l) => {
      const s = Number(l.score);
      const m = Number(l.score_max);
      if (!Number.isFinite(s) || !Number.isFinite(m) || m <= 0) return absent();
      return resolu(Number((s / m * 100).toFixed(1)));
    },
  },
  // intervenants : `intervenants` (civilite, nom, prenom, email, fonction).
  // telephone (aucune colonne), phase_numero et groupe_nom : non résolubles.
  intervenants: {
    intervenant_civilite: (l) => texte(l.civilite),
    intervenant_nom: (l) => texte(l.nom),
    intervenant_prenom: (l) => texte(l.prenom),
    intervenant_nom_complet: (l) => (l.prenom || l.nom ? resolu(`${l.prenom || ""} ${l.nom || ""}`.trim()) : absent()),
    intervenant_fonction: (l) => texte(l.fonction),
    intervenant_email: (l) => texte(l.email),
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
