// ─────────────────────────────────────────────────────────────
//  VALIDATEUR DE MODÈLES — analyse les balises {{…}} d'un texte de modèle
//  contre le catalogue canonique (catalogueVariables.js).
//
//  Classe chaque balise : canonique | alias | historique | champ_bloc |
//  bloc_ouverture | bloc_fermeture | inconnue | invalide.
//  Erreur ⇒ modèle invalide. Avertissement ⇒ modèle valide, mais à revoir
//  (alias, marqueur historique à migrer, donnée sensible).
//
//  Module PUR : n'appelle ni Google ni la base, ne remplace rien.
//  N'est PAS encore branché sur la génération (documents.js).
// ─────────────────────────────────────────────────────────────
import {
  BLOC_DU_CHAMP, DICTIONNAIRE_VERSION, blocCanonique, blocsDuChampLocal, champLocal, marqueurHistorique,
  resoudreAlias, variableCanonique,
} from "./catalogueVariables.js";
import { MARQUEURS, RENDUS_HISTORIQUES } from "./marqueurs.js";

export const TAILLE_MAX_MODELE = 2_000_000; // fix : borne l'analyse d'un texte externe
const NOM_VALIDE = /^[a-z][a-z0-9_]*$/;
const BRUT_MAX = 80; // une balise malformée peut être très longue : on tronque l'écho

const tronquer = (s) => (s.length > BRUT_MAX ? s.slice(0, BRUT_MAX) + "…" : s);

export function analyserModele(texte) {
  if (typeof texte !== "string") throw new TypeError("Le texte du modèle doit être une chaîne.");
  if (texte.length > TAILLE_MAX_MODELE) throw new RangeError("Texte du modèle trop volumineux pour être analysé.");

  const balises = [];
  const erreurs = [];
  const avertissements = [];
  const pile = []; // blocs ouverts : { nom, position }
  const erreur = (code, message, b) => erreurs.push({ code, message, balise: b?.brut ?? null, position: b?.position ?? null });
  const avertir = (code, message, b) => avertissements.push({ code, message, balise: b?.brut ?? null, position: b?.position ?? null });
  const signalerSensible = (nom, sensibilite, b) => {
    if (sensibilite === "restreinte") avertir("DONNEE_SENSIBLE", `{{${nom}}} est une donnée sensible à accès restreint : réservez-la aux modèles autorisés.`, b);
  };

  let i = 0;
  let resteTexte = "";
  while (i < texte.length) {
    const debut = texte.indexOf("{{", i);
    if (debut === -1) { resteTexte += texte.slice(i); break; }
    resteTexte += texte.slice(i, debut);
    const fin = texte.indexOf("}}", debut + 2);
    if (fin === -1) {
      // Confidentialité : sans « }} », la fin de la balise est indéterminée
      // — le reste du texte pourrait être n'importe quel contenu du
      // document. On ne renvoie et on ne journalise JAMAIS ce texte brut.
      const b = { brut: "{{…}}", position: debut, statut: "invalide" };
      balises.push(b);
      erreur("BALISE_NON_FERMEE", "Balise ouverte par « {{ » sans « }} » de fermeture. Contenu masqué : cette balise peut contenir du texte libre.", b);
      break;
    }
    const interieur = texte.slice(debut + 2, fin);
    const b = { brut: tronquer(texte.slice(debut, fin + 2)), position: debut };
    balises.push(b);
    i = fin + 2;

    const marque = interieur[0] === "#" || interieur[0] === "/" ? interieur[0] : "";
    const nom = marque ? interieur.slice(1) : interieur;
    if (!NOM_VALIDE.test(nom)) {
      b.statut = "invalide";
      // Confidentialité : l'intérieur de { { } } peut être du texte libre
      // arbitraire, potentiellement sensible — jamais renvoyé ni journalisé
      // tel quel. Seuls un espacement ou une casse incidents autour d'un
      // identifiant par ailleurs sûr (a-z, 0-9, _) sont montrés, et
      // RECONSTRUITS (jamais recopiés depuis le texte d'origine).
      const propre = nom.trim().toLowerCase();
      const quasiValide = NOM_VALIDE.test(propre);
      if (quasiValide) {
        b.brut = tronquer(`{{${marque}${propre}}}`);
        const connue = variableCanonique(propre) || resoudreAlias(propre) || blocCanonique(propre);
        const suggestion = connue ? ` Vouliez-vous écrire « {{${marque}${propre}}} » ?` : "";
        erreur("SYNTAXE_INVALIDE", `Syntaxe invalide : un nom de variable s'écrit en minuscules, sans accent, espace ni tiret (a-z, 0-9, _).${suggestion}`, b);
      } else {
        b.brut = "{{…}}";
        erreur("SYNTAXE_INVALIDE", "Syntaxe invalide : un nom de variable s'écrit en minuscules, sans accent, espace ni tiret (a-z, 0-9, _). Contenu masqué : cette balise peut contenir du texte libre.", b);
      }
      continue;
    }
    b.nom = nom;

    // ── Blocs ──
    if (marque === "#") {
      if (!blocCanonique(nom)) { b.statut = "inconnue"; erreur("BLOC_INCONNU", `Bloc inconnu : « ${nom} » n'est pas un bloc répétable du catalogue.`, b); continue; }
      b.statut = "bloc_ouverture";
      if (pile.some((p) => p.nom === nom)) erreur("BLOC_IMBRIQUE_SUR_LUI_MEME", `Le bloc « ${nom} » est ouvert à l'intérieur de lui-même.`, b);
      signalerSensible(nom, blocCanonique(nom).sensibilite, b);
      pile.push({ nom, position: debut, brut: b.brut });
      continue;
    }
    if (marque === "/") {
      if (!blocCanonique(nom)) { b.statut = "inconnue"; erreur("BLOC_INCONNU", `Bloc inconnu : « ${nom} » n'est pas un bloc répétable du catalogue.`, b); continue; }
      b.statut = "bloc_fermeture";
      const ouvert = pile[pile.length - 1];
      if (!ouvert) { erreur("FERMETURE_ORPHELINE", `« {{/${nom}}} » ferme un bloc qui n'a pas été ouvert.`, b); continue; }
      if (ouvert.nom !== nom) {
        erreur("FERMETURE_DISCORDANTE", `« {{/${nom}}} » rencontré alors que le bloc « ${ouvert.nom} » est encore ouvert.`, b);
        // Si le bloc fermé est plus bas dans la pile, on le dépile avec ceux au-dessus.
        const k = pile.map((p) => p.nom).lastIndexOf(nom);
        if (k !== -1) pile.length = k;
        continue;
      }
      pile.pop();
      continue;
    }

    // ── Variables simples ──
    const canonique = variableCanonique(nom);
    if (canonique) {
      // DOC-6B/7B : une variable canonique qui est aussi un CHAMP de bloc (ref)
      // est un champ_bloc lorsqu'elle est écrite À L'INTÉRIEUR de l'un de ses
      // blocs. Un REF peut appartenir à plusieurs blocs (ex. seance_date) :
      // on retient le bloc englobant RÉEL, pas un nom unique.
      const blocsDuChamp = BLOC_DU_CHAMP[nom];
      const englobant = blocsDuChamp ? [...pile].reverse().find((p) => blocsDuChamp.includes(p.nom)) : null;
      b.statut = englobant ? "champ_bloc" : "canonique";
      if (englobant) b.bloc = englobant.nom;
      signalerSensible(nom, canonique.sensibilite, b);
      continue;
    }
    const cible = resoudreAlias(nom);
    if (cible) {
      b.statut = "alias"; b.canonique = cible;
      avertir("ALIAS", `{{${nom}}} est un alias historique de {{${cible}}} : utilisez le nom canonique.`, b);
      signalerSensible(cible, variableCanonique(cible).sensibilite, b);
      continue;
    }
    const historique = marqueurHistorique(nom);
    if (historique) {
      b.statut = "historique";
      const cibles = historique.cibles_possibles.length ? ` Cible(s) possible(s) : ${historique.cibles_possibles.join(", ")}.` : "";
      avertir("HISTORIQUE", `{{${nom}}} est un marqueur historique sans équivalent canonique certain : à migrer. ${historique.raison}${cibles}`, b);
      continue;
    }
    if (blocCanonique(nom)) {
      b.statut = "invalide";
      erreur("BLOC_SANS_SYNTAXE", `« ${nom} » est un bloc répétable : écrivez {{#${nom}}} … {{/${nom}}}.`, b);
      continue;
    }
    const blocsLocaux = blocsDuChampLocal(nom);
    if (blocsLocaux.length) {
      const englobant = [...pile].reverse().find((p) => champLocal(p.nom, nom));
      if (englobant) {
        b.statut = "champ_bloc"; b.bloc = englobant.nom;
        signalerSensible(nom, champLocal(englobant.nom, nom).sensibilite, b);
      } else {
        b.statut = "invalide";
        erreur("CHAMP_HORS_BLOC", `{{${nom}}} n'est valide qu'à l'intérieur du bloc ${blocsLocaux.map((n) => `{{#${n}}}`).join(" ou ")}.`, b);
      }
      continue;
    }
    b.statut = "inconnue";
    erreur("VARIABLE_INCONNUE", `Variable inconnue : {{${nom}}} n'existe pas dans le dictionnaire Vigie v${DICTIONNAIRE_VERSION}.`, b);
  }

  for (const p of pile) erreur("BLOC_NON_FERME", `Le bloc « ${p.nom} » est ouvert mais jamais fermé par {{/${p.nom}}}.`, { brut: p.brut, position: p.position });
  if (resteTexte.includes("}}")) avertir("ACCOLADES_ORPHELINES", "« }} » présent sans « {{ » d'ouverture : balise probablement mal saisie.");

  const uniques = (statut) => [...new Set(balises.filter((b) => b.statut === statut).map((b) => b.nom))];
  // DOC-6A : champs (locaux) utilisés À L'INTÉRIEUR de chaque bloc — pour le
  // contrôle précis champ par champ du précontrôle.
  const champsParBloc = {};
  for (const b of balises) if (b.bloc) (champsParBloc[b.bloc] ||= []).push(b.nom);
  for (const k of Object.keys(champsParBloc)) champsParBloc[k] = [...new Set(champsParBloc[k])];
  return {
    version: DICTIONNAIRE_VERSION,
    valide: erreurs.length === 0,
    balises,
    resume: {
      canoniques: uniques("canonique"),
      alias: [...new Map(balises.filter((b) => b.statut === "alias").map((b) => [b.nom, { alias: b.nom, canonique: b.canonique }])).values()],
      historiques: uniques("historique"),
      blocs: uniques("bloc_ouverture"),
      champs_bloc: uniques("champ_bloc"),
      champs_par_bloc: champsParBloc,
      inconnues: uniques("inconnue"),
    },
    erreurs,
    avertissements,
  };
}

// DOC-3D : balises « censées être rendues » encore présentes APRÈS
// remplacement : canoniques, alias, marqueurs historiques rendus par le moteur
// (les 23 MARQUEURS + les rendus historiques de compatibilité). Réutilise
// analyserModele() : aucun parser supplémentaire. Un historique NON rendu n'est
// PAS remonté. Les accolades sans rapport (inconnues, syntaxe invalide) non plus.
export function balisesResiduelles(texte) {
  const r = analyserModele(texte);
  const rendus = new Set([...MARQUEURS, ...Object.keys(RENDUS_HISTORIQUES)]);
  const historiquesRendus = r.resume.historiques.filter((n) => rendus.has(n));
  return [...new Set([...r.resume.canoniques, ...r.resume.alias.map((a) => a.alias), ...historiquesRendus, ...r.resume.blocs, ...r.resume.champs_bloc])];
}
