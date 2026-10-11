// ─────────────────────────────────────────────────────────────
//  CONVENTION DE MARQUEURS — source unique de vérité.
//
//  Un modèle de document est un Google Doc ou Sheet ordinaire, dans
//  lequel on écrit ces marqueurs à la place des valeurs. La génération
//  les remplace, à l'identique, dans la copie.
//
//    {{civilite}}            « M. » ou « Mme » (portée stagiaire seulement,
//                            vide si la civilité n est pas renseignée)
//    {{nom_stagiaire}}       NOM du stagiaire (portée stagiaire seulement)
//    {{prenom_stagiaire}}    Prénom du stagiaire (idem)
//    {{date_debut}}          Date de début de session, jj/mm/aaaa
//    {{date_fin}}            Date de fin de session, jj/mm/aaaa
//    {{date_attestation}}    Date portée sur l attestation : la date de
//                            fin de session, même donnée et même format
//                            que {{date_fin}}
//    {{horaire}}             Horaire indiqué sur la session, texte libre
//                            (« 8h30–12h00 / 13h00–16h30 »), vide s il
//                            n est pas renseigné
//    {{duree}}               Durée en heures : la durée prévue (déclarée)
//                            de la session (sessions.duree_heures_reelle)
//                            si elle est renseignée, sinon celle de la
//                            version de formation (duree_heures_defaut)
//    {{intitule_formation}}  Intitulé de la formation
//    {{lieu}}                Lieu du groupe, à défaut celui de la session
//    {{formateur}}           Formateur(s) du groupe, à défaut de la session :
//                            intervenants de fonction « formateur »
//                            RATTACHÉS (annuaire, Q4-1) en priorité, sinon
//                            le texte historique saisi — une session ou un
//                            groupe jamais rattaché garde son rendu exact.
//                            Plusieurs noms : « A, B et C » (triés par nom).
//    {{nom_organisme}}       Nom de l'organisme (variable ORGANISME_NOM)
//
//  N'AJOUTEZ PAS de marqueur sans l'inscrire dans cette liste ET dans le
//  README : un marqueur inconnu n'est pas remplacé et reste visible tel
//  quel dans le document produit.
//
//  Module PUR : aucun appel réseau, entièrement testable hors ligne.
// ─────────────────────────────────────────────────────────────

import { nomsFormateurs } from "./intervenants.js";
import { formaterDate, formaterDuree } from "./formatageDocuments.js";
import { resoudreCanoniques } from "./resolversCanoniques.js";

// Ré-exportées telles quelles : marqueurs.test.js et d'éventuels appelants
// externes continuent de les importer d'ici (compatibilité).
export { formaterDate, formaterDuree };

export const MARQUEURS = [
  "civilite",
  "nom_stagiaire",
  "prenom_stagiaire",
  "date_debut",
  "date_fin",
  "date_attestation",
  "horaire",
  "duree",
  "intitule_formation",
  "lieu",
  "formateur",
  "nom_organisme",
  // Ajouts lot L5 (assiduité / EduSign) : uniquement des marqueurs
  // nouveaux, jamais de doublon d'un ancien sous un autre nom.
  "session_reference",
  "session_statut",
  "email",
  "telephone",
  "entreprise",
  "financeur",
  "prescripteur",
  "groupe",
  "heures_absence",
  "heures_suivies",
  "taux_assiduite",
];

export const baliser = (nom) => `{{${nom}}}`;

// Libellé français du statut d'une session pour les documents. Inconnu ⇒
// chaîne vide : jamais de valeur inventée.
const LIBELLE_STATUT = { planifiee: "Planifiée", en_cours: "En cours", terminee: "Terminée", annulee: "Annulée" };

// Valeurs de chaque marqueur pour un document donné. Un marqueur sans
// valeur devient une chaîne vide : mieux vaut un blanc qu'un
// « {{prenom_stagiaire}} » imprimé sur une convocation.
// `assiduite` vient de calculerAssiduite (lot L2) : on ne RECALCULE rien ici.
//
// DOC-3B : les 11 alias VÉRIFIÉS (resolver canonique strictement
// équivalent) relisent désormais `resoudreCanoniques(ctx)` au lieu de
// recalculer — UNE seule source de calcul. Les 12 AUTRES marqueurs
// historiques (duree, date_attestation, lieu, formateur, entreprise,
// financeur, prescripteur, groupe, heures_suivies, taux_assiduite,
// session_reference, session_statut) gardent leur calcul PROPRE,
// strictement inchangé : ce ne sont pas des alias (DOC-1), et
// date_attestation n'est pas touché ici (sa variable canonique
// document_date_attestation, elle, relit session_date_fin — cf.
// resolversCanoniques.js — sans que ce marqueur historique soit modifié).
// L'aplatissement d'un statut « absent »/« non_resoluble » en "" n'est
// autorisé QUE pour ces 11 alias : c'est la compatibilité historique,
// pas la couche canonique (stricte, voir resolversCanoniques.js).
export function valeursMarqueurs(ctx = {}) {
  const { formation, version, session, groupe, stagiaire, organisme, assiduite, formateursGroupe = [], formateursSession = [] } = ctx;
  const canoniques = resoudreCanoniques(ctx);
  // Relecture d'un alias : la valeur canonique si résolue, "" sinon —
  // le format canonique (dates déjà JJ/MM/AAAA, textes déjà en l'état)
  // correspond déjà au rendu historique attendu pour ces 10 alias.
  const relire = (nomCanonique) => { const r = canoniques[nomCanonique]; return r.statut === "resolu" ? String(r.valeur) : ""; };
  const duree = session?.duree_heures_reelle ?? version?.duree_heures_defaut ?? null;
  return {
    civilite: relire("stagiaire_civilite"),
    nom_stagiaire: relire("stagiaire_nom"),
    prenom_stagiaire: relire("stagiaire_prenom"),
    date_debut: relire("session_date_debut"),
    date_fin: relire("session_date_fin"),
    date_attestation: formaterDate(session?.date_fin),
    horaire: relire("session_horaires"),
    duree: formaterDuree(duree),
    intitule_formation: relire("formation_intitule"),
    lieu: groupe?.lieu || session?.lieu || "",
    formateur: nomsFormateurs(formateursGroupe) || groupe?.formateur || nomsFormateurs(formateursSession) || session?.formateur || "",
    nom_organisme: relire("organisme_nom"),
    session_reference: session?.reference ?? "",
    session_statut: session?.statut ? (LIBELLE_STATUT[session.statut] ?? "") : "",
    email: relire("stagiaire_email"),
    telephone: relire("stagiaire_telephone"),
    entreprise: stagiaire?.entreprise ?? "",
    financeur: stagiaire?.financeur ?? "",
    prescripteur: stagiaire?.prescripteur_nom || stagiaire?.prescripteur || "",
    // Pour un document par stagiaire, le groupe est CELUI du stagiaire ;
    // sinon, celui visé par la génération.
    groupe: stagiaire?.groupe_nom || groupe?.nom || "",
    // 11e alias : même donnée que absence_heures_total, reformatée « N h »
    // pour préserver exactement le rendu historique (la valeur canonique
    // est un nombre brut, pas un texte déjà mis en forme).
    heures_absence: canoniques.absence_heures_total.statut === "resolu" ? formaterDuree(canoniques.absence_heures_total.valeur) : "",
    // L'assiduité n'est fiable que calculée par le lot L2 : en dehors,
    // les marqueurs restent VIDES plutôt que d'imprimer un faux chiffre.
    heures_suivies: assiduite?.fiable ? formaterDuree(assiduite.heures_suivies) : "",
    taux_assiduite: assiduite?.fiable ? `${assiduite.taux} %` : "",
    // Couche canonique DOC-3B, exposée séparément — jamais aplatie ni
    // mélangée aux 23 marqueurs historiques ci-dessus (certains partagent
    // un même NOM avec une variable canonique — ex. session_statut — mais
    // une sémantique différente : libellé affiché ici, valeur métier brute
    // côté canonique). Pas encore branchée sur requetesDocs/requetesSheets
    // (qui itèrent toujours sur MARQUEURS seulement, inchangé) : disponible
    // pour les tests et un futur branchement, sans changer le comportement
    // actuel de la génération.
    canoniques,
  };
}

// Remplacement dans une chaîne — sert aux noms de fichiers et de dossiers.
export function remplacer(texte, valeurs) {
  if (!texte) return texte;
  return texte.replace(/\{\{(\w+)\}\}/g, (tel_quel, nom) =>
    Object.prototype.hasOwnProperty.call(valeurs, nom) ? String(valeurs[nom] ?? "") : tel_quel
  );
}

// Marqueurs présents dans un texte mais absents de la convention : sert à
// prévenir plutôt qu'à produire un document troué en silence.
export function marqueursInconnus(texte) {
  const trouves = [...String(texte || "").matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  return [...new Set(trouves.filter((n) => !MARQUEURS.includes(n)))];
}

// TOUS les marqueurs {{...}} encore présents dans un texte, connus ou non.
// Sert à vérifier, APRÈS remplacement, qu'aucun marqueur n'a été oublié
// (ex. un marqueur éclaté sur plusieurs éléments texte, que replaceAllText
// n'aurait pas pu recoller).
export function marqueursRestants(texte) {
  return [...new Set([...String(texte || "").matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
}

// Requêtes de remplacement pour l'API Google Docs.
export function requetesDocs(valeurs) {
  return MARQUEURS.map((nom) => ({
    replaceAllText: {
      containsText: { text: baliser(nom), matchCase: true },
      replaceText: String(valeurs[nom] ?? ""),
    },
  }));
}

// Équivalent pour l'API Google Sheets.
export function requetesSheets(valeurs) {
  return MARQUEURS.map((nom) => ({
    findReplace: { find: baliser(nom), replacement: String(valeurs[nom] ?? ""), allSheets: true, matchCase: true },
  }));
}
