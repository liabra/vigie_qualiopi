// ─────────────────────────────────────────────────────────────
//  DOC-6A — Moteur PUR de rendu des blocs répétables (texte).
//  Aucun parser de balises réinventé : on travaille sur les marqueurs
//  {{#nom}} … {{/nom}}. Pas d'imbrication (v1). Un bloc vide disparaît ;
//  N lignes → N occurrences ; les marqueurs d'ouverture/fermeture
//  disparaissent toujours. Les variables GLOBALES {{…}} présentes dans le
//  corps sont laissées intactes : le passage scalaire habituel s'en charge.
// ─────────────────────────────────────────────────────────────
import { champBloc } from "./resolversBlocs.js";

// Remplace les variables LOCALES du corps d'un bloc pour UNE ligne.
//   resolu → valeur ; absent → "" ; non résoluble (champ non supporté ou
// variable globale) → laissé tel quel (le passage scalaire s'en charge).
function rendreLigne(corps, nomBloc, ligne) {
  return corps.replace(/\{\{(\w+)\}\}/g, (telQuel, nom) => {
    const r = champBloc(nomBloc, nom, ligne);
    if (r.statut === "resolu") return String(r.valeur);
    if (r.statut === "absent") return "";
    return telQuel;
  });
}

// Découpe `texte` en segments : texte hors bloc et blocs complets.
// Lève une erreur sur syntaxe malformée ou bloc imbriqué (non supporté v1).
export function segmenter(texte) {
  const segments = [];
  let i = 0;
  while (i < texte.length) {
    const ouverture = texte.indexOf("{{#", i);
    if (ouverture === -1) { segments.push({ type: "texte", contenu: texte.slice(i) }); break; }
    if (ouverture > i) segments.push({ type: "texte", contenu: texte.slice(i, ouverture) });
    const finNom = texte.indexOf("}}", ouverture + 3);
    if (finNom === -1) throw new Error("Bloc mal formé : « {{# » sans « }} » de fermeture.");
    const nom = texte.slice(ouverture + 3, finNom);
    const fermeture = texte.indexOf(`{{/${nom}}}`, finNom + 2);
    if (fermeture === -1) throw new Error(`Bloc « ${nom} » ouvert mais jamais fermé par {{/${nom}}}.`);
    const corps = texte.slice(finNom + 2, fermeture);
    if (corps.includes("{{#")) throw new Error(`Bloc imbriqué non supporté (v1) dans « ${nom} ».`);
    segments.push({ type: "bloc", nom, corps, brut: texte.slice(ouverture, fermeture + `{{/${nom}}}`.length) });
    i = fermeture + `{{/${nom}}}`.length;
  }
  return segments;
}

// Remplacements prêts pour l'API : chaque bloc complet → son rendu répété.
// Format neutre ({ find, replacement }) ; l'appelant adapte à Docs/Sheets.
export function remplacementsBlocs(texte, lignesParBloc = {}) {
  return segmenter(texte)
    .filter((s) => s.type === "bloc")
    .map((s) => ({
      find: s.brut,
      replacement: (lignesParBloc[s.nom] || []).map((ligne) => rendreLigne(s.corps, s.nom, ligne)).join(""),
    }));
}

// Rendu intégral (pour les tests purs) : texte final après blocs.
export function renduBlocs(texte, lignesParBloc = {}) {
  let sortie = "";
  for (const s of segmenter(texte)) {
    if (s.type === "texte") { sortie += s.contenu; continue; }
    sortie += (lignesParBloc[s.nom] || []).map((ligne) => rendreLigne(s.corps, s.nom, ligne)).join("");
  }
  return sortie;
}
