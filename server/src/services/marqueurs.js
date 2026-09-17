// ─────────────────────────────────────────────────────────────
//  CONVENTION DE MARQUEURS — source unique de vérité.
//
//  Un modèle de document est un Google Doc ou Sheet ordinaire, dans
//  lequel on écrit ces marqueurs à la place des valeurs. La génération
//  les remplace, à l'identique, dans la copie.
//
//    {{nom_stagiaire}}       NOM du stagiaire (portée stagiaire seulement)
//    {{prenom_stagiaire}}    Prénom du stagiaire (idem)
//    {{date_debut}}          Date de début de session, jj/mm/aaaa
//    {{date_fin}}            Date de fin de session, jj/mm/aaaa
//    {{duree}}               Durée en heures : la durée réelle de la
//                            session si elle est renseignée, sinon celle
//                            de la version de formation
//    {{intitule_formation}}  Intitulé de la formation
//    {{lieu}}                Lieu du groupe, à défaut celui de la session
//    {{formateur}}           Formateur du groupe, à défaut celui de la session
//    {{nom_organisme}}       Nom de l'organisme (variable ORGANISME_NOM)
//
//  N'AJOUTEZ PAS de marqueur sans l'inscrire dans cette liste ET dans le
//  README : un marqueur inconnu n'est pas remplacé et reste visible tel
//  quel dans le document produit.
//
//  Module PUR : aucun appel réseau, entièrement testable hors ligne.
// ─────────────────────────────────────────────────────────────

export const MARQUEURS = [
  "nom_stagiaire",
  "prenom_stagiaire",
  "date_debut",
  "date_fin",
  "duree",
  "intitule_formation",
  "lieu",
  "formateur",
  "nom_organisme",
];

export const baliser = (nom) => `{{${nom}}}`;

// Les dates arrivent en « AAAA-MM-JJ » (voir db.js, qui garde les
// colonnes DATE en texte) et repartent en « JJ/MM/AAAA ».
export function formaterDate(valeur) {
  if (!valeur) return "";
  const texte = typeof valeur === "string" ? valeur : valeur.toISOString().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texte);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : texte;
}

// « 14 » et « 14.00 » s'écrivent tous les deux « 14 h ».
export function formaterDuree(heures) {
  if (heures === null || heures === undefined || heures === "") return "";
  const n = Number(heures);
  if (Number.isNaN(n)) return String(heures);
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} h`;
}

// Valeurs de chaque marqueur pour un document donné. Un marqueur sans
// valeur devient une chaîne vide : mieux vaut un blanc qu'un
// « {{prenom_stagiaire}} » imprimé sur une convocation.
export function valeursMarqueurs({ formation, version, session, groupe, stagiaire, organisme } = {}) {
  const duree = session?.duree_heures_reelle ?? version?.duree_heures_defaut ?? null;
  return {
    nom_stagiaire: stagiaire?.nom ?? "",
    prenom_stagiaire: stagiaire?.prenom ?? "",
    date_debut: formaterDate(session?.date_debut),
    date_fin: formaterDate(session?.date_fin),
    duree: formaterDuree(duree),
    intitule_formation: formation?.intitule ?? "",
    lieu: groupe?.lieu || session?.lieu || "",
    formateur: groupe?.formateur || session?.formateur || "",
    nom_organisme: organisme ?? "",
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
