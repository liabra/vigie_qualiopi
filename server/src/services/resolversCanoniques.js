// ─────────────────────────────────────────────────────────────
//  DOC-3B — RÉSOLUTION DES VARIABLES CANONIQUES, pilotée par le catalogue
//  (catalogueVariables.js, 162 variables, source de vérité unique).
//
//  resoudreCanoniques(ctx) parcourt VARIABLES et renvoie EXACTEMENT 162
//  clés, chacune un résultat typé à trois états :
//    { statut: "resolu",        valeur }   le resolver existe, donnée disponible
//    { statut: "absent",        valeur: null }  le resolver existe, rien pour CETTE instance
//    { statut: "non_resoluble", valeur: null }  aucun resolver (donnée non modélisée
//                                                 ou règle métier non décidée)
//  0 et false sont des valeurs RÉSOLUES valides (jamais confondues avec absent).
//  Une chaîne vide issue d'une colonne vide/NULL est « absent », jamais
//  aplatie en "" ici — cet aplatissement est réservé à valeursMarqueurs()
//  (marqueurs.js), pour la compatibilité des 23 marqueurs historiques
//  SEULEMENT. Ici, STRICT : "absent" et "non_resoluble" restent null.
//
//  Architecture demandée : SEULES les variables réellement supportées ont
//  une entrée dans RESOLVEURS_CANONIQUES (46 aujourd'hui). Pas de liste
//  manuelle des ~116 autres : leur absence de RESOLVEURS_CANONIQUES suffit,
//  le parcours de VARIABLES fait le reste. Aucun resolver ne doit cibler
//  un nom absent du catalogue (invariant testé).
//
//  Module PUR : aucun appel réseau ni base. `ctx` est entièrement fourni
//  par documents.js (contexteGeneration()/cibles() + stagiaire + assiduite
//  + maintenant), comme pour valeursMarqueurs() aujourd'hui.
// ─────────────────────────────────────────────────────────────
import { VARIABLES } from "./catalogueVariables.js";
import { dureeAttestation, formaterDate } from "./formatageDocuments.js";

const resolu = (valeur) => ({ statut: "resolu", valeur });
const absent = () => ({ statut: "absent", valeur: null });
// Un texte n'est considéré résolu que non vide : un champ NULL/vide en
// base est « absent », jamais une chaîne vide déguisée en valeur réelle.
const texte = (v) => (v ? resolu(v) : absent());
const date = (v) => (v ? resolu(formaterDate(v)) : absent());
const nombre = (v) => (v === null || v === undefined ? absent() : resolu(Number(v)));

// 46 variables réellement supportées. Classement dans les commentaires
// pour traçabilité (voir DOC-3A/DOC-3B pour le détail de chaque décision).
const RESOLVEURS_CANONIQUES = {
  // ── Organisme (1) ──
  organisme_nom: (ctx) => texte(ctx.organisme),

  // ── Formation (10) ──
  formation_id: (ctx) => nombre(ctx.formation?.id),
  formation_intitule: (ctx) => texte(ctx.formation?.intitule),
  formation_code: (ctx) => texte(ctx.formation?.code_interne),
  formation_duree_heures: (ctx) => nombre(ctx.version?.duree_heures_defaut),
  formation_public_vise: (ctx) => texte(ctx.version?.public_vise),
  formation_prerequis: (ctx) => texte(ctx.version?.prerequis),
  formation_objectif_general: (ctx) => texte(ctx.version?.objectifs),
  formation_modalite: (ctx) => texte(ctx.version?.modalite),
  formation_accessibilite: (ctx) => texte(ctx.version?.accessibilite_handicap),
  // (formation_objectifs_operationnels, formation_methodes_pedagogiques,
  // formation_modalites_evaluation, formation_nombre_phases : hors catalogue
  // supporté, cf. DOC-3A — pas d'entrée ici, donc non_resoluble.)

  // ── Session (11) ──
  session_id: (ctx) => nombre(ctx.session?.id),
  // (session_libelle : NON résolue. Le catalogue le distingue explicitement
  // de session_reference — « Libellé de session ; ne pas confondre avec le
  // groupe » (SES-02) contre « Référence interne unique… ex. ADVF-2026-01 »
  // (SES-12) : un nom descriptif face à un code. Vigie n'a qu'une colonne
  // `reference` ; l'utiliser pour les deux confondrait deux concepts que
  // le catalogue distingue volontairement. Pas de resolver tant qu'aucun
  // champ « libellé » propre n'existe.)
  session_date_debut: (ctx) => date(ctx.session?.date_debut),
  session_date_fin: (ctx) => date(ctx.session?.date_fin),
  session_horaires: (ctx) => texte(ctx.session?.horaire),
  session_lieu: (ctx) => texte(ctx.session?.lieu),
  session_duree_heures: (ctx) => nombre(ctx.session?.duree_heures_reelle),
  // Valeur métier BRUTE (planifiee/en_cours/terminee/annulee) : le libellé
  // affiché reste dans valeursMarqueurs()/LIBELLE_STATUT pour l'historique.
  // v1.2 : renommée session_statut_code (l'ancien nom est un marqueur historique).
  session_statut_code: (ctx) => texte(ctx.session?.statut),
  session_reference: (ctx) => texte(ctx.session?.reference),
  session_nombre_inscrits: (ctx) => nombre(ctx.session?.nombre_inscrits),
  session_nombre_termines: (ctx) => nombre(ctx.session?.nombre_termines),

  // ── Groupe (2) ──
  groupe_id: (ctx) => nombre(ctx.groupe?.id),
  groupe_nom: (ctx) => texte(ctx.groupe?.nom),

  // ── Stagiaire (10) ──
  stagiaire_id: (ctx) => nombre(ctx.stagiaire?.id),
  stagiaire_civilite: (ctx) => texte(ctx.stagiaire?.civilite),
  stagiaire_nom: (ctx) => texte(ctx.stagiaire?.nom),
  stagiaire_prenom: (ctx) => texte(ctx.stagiaire?.prenom),
  stagiaire_nom_complet: (ctx) => (ctx.stagiaire ? resolu(`${ctx.stagiaire.prenom} ${ctx.stagiaire.nom}`) : absent()),
  stagiaire_email: (ctx) => texte(ctx.stagiaire?.email),
  stagiaire_telephone: (ctx) => texte(ctx.stagiaire?.telephone),
  stagiaire_date_inscription: (ctx) => date(ctx.stagiaire?.date_inscription),
  stagiaire_statut_parcours: (ctx) => texte(ctx.stagiaire?.statut),
  stagiaire_groupe_nom: (ctx) => texte(ctx.stagiaire?.groupe_nom),
  // (stagiaire_besoins_specifiques, stagiaire_amenagements : NON résolues —
  // la première pour une raison d'AUTORISATION (besoins_adaptation est
  // réservé admin, cf. confidentialite.js, alors que la génération est
  // ouverte aux contributeurs — sujet d'une étape de sécurité documentaire
  // distincte), la seconde en attente d'une règle de rendu du bloc
  // adaptations. stagiaire_date_naissance/age/adresse/code_postal/ville :
  // aucune colonne, cf. DOC-3A.)

  // ── Suivi (6) ──
  abandon_statut: (ctx) => (ctx.stagiaire ? resolu(ctx.stagiaire.statut === "abandon") : absent()),
  abandon_date: (ctx) => date(ctx.stagiaire?.date_abandon),
  abandon_motif: (ctx) => texte(ctx.stagiaire?.motif_abandon),
  presence_heures_prevues: (ctx) => nombre(ctx.assiduite?.heures_prevues),
  presence_heures_realisees: (ctx) => (ctx.assiduite?.fiable ? nombre(ctx.assiduite.heures_suivies) : absent()),
  absence_heures_total: (ctx) => nombre(ctx.assiduite?.heures_absence),
  presence_taux: (ctx) => (ctx.assiduite?.fiable ? resolu(ctx.assiduite.taux) : absent()),
  absence_taux: (ctx) => (ctx.assiduite?.fiable ? resolu(100 - ctx.assiduite.taux) : absent()),
  relance_derniere_date: (ctx) => date(ctx.stagiaire?.relance_derniere_date),
  // (relance_derniere_action : NON résolue — ni « canal » (le moyen) ni
  // « categorie » (une classification fermée du résultat) ne correspondent
  // précisément à une « action » au sens du dictionnaire ; les concaténer
  // serait une interprétation, pas une relecture directe.)
  // (indicateur_taux_assiduite, indicateur_taux_abandon : NON résolues —
  // aucune formule officielle et testée au niveau SESSION n'existe dans
  // Vigie aujourd'hui (seulement par inscription, calculerAssiduite) ;
  // en inventer une serait une formule par déduction, explicitement exclue.)

  // ── Partenaire (1) ──
  prescripteur_nom: (ctx) => texte(ctx.stagiaire?.prescripteur_nom),

  // ── Document (4) ──
  // document_date et document_date_convocation partagent EXPLICITEMENT le
  // même instant (ctx.maintenant), calculé UNE SEULE FOIS par document
  // généré dans documents.js — jamais deux `new Date()` distincts.
  document_date: (ctx) => (ctx.maintenant ? resolu(formaterDate(ctx.maintenant)) : absent()),
  // fix : règle de compatibilité PROVISOIRE — « date d'établissement de la
  // convocation » n'a aujourd'hui aucune donnée propre dans Vigie (ni date
  // d'envoi, ni date choisie explicitement : voir DOC-3A). Tant qu'aucune
  // vraie donnée n'existe, elle vaut la date de génération du document,
  // PAS une date d'envoi réelle.
  document_date_convocation: (ctx) => (ctx.maintenant ? resolu(formaterDate(ctx.maintenant)) : absent()),
  // fix : règle de compatibilité PROVISOIRE — préserve exactement le rendu
  // actuel du marqueur historique {{date_attestation}} (session.date_fin).
  // Ce n'est PAS une date de clôture réelle, distincte de la fin planifiée
  // de la session : aucun événement « clôture » n'est enregistré en base.
  // Ne pas lever cette approximation sans décision explicite.
  document_date_attestation: (ctx) => date(ctx.session?.date_fin),
  // v1.3 : durée affichée sur l'attestation — source unique partagée avec
  // le marqueur historique duree (jamais deux calculs divergents).
  document_duree_attestation: (ctx) => texte(dureeAttestation(ctx)),
};

// Invariant exploité par les tests : aucun nom hors catalogue.
export const NOMS_RESOLUS = Object.freeze(Object.keys(RESOLVEURS_CANONIQUES));

export function resoudreCanoniques(ctx = {}) {
  const sortie = {};
  for (const v of VARIABLES) {
    const resolveur = RESOLVEURS_CANONIQUES[v.nom];
    sortie[v.nom] = resolveur ? resolveur(ctx) : { statut: "non_resoluble", valeur: null };
  }
  return sortie;
}
