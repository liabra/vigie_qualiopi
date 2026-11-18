// Paramètres de l'organisme et signataires : validation pure + résolution du signataire d'un document.
//
// Aucune valeur réelle ici : coordonnées et noms se saisissent dans l'application. Les variables
// documentaires {{organisme_*}} et {{signataire_nom}} / {{signataire_fonction}} les relisent.

export const CHAMPS_ORGANISME = ["nom", "adresse_ligne1", "adresse_ligne2", "code_postal", "ville", "telephone", "mobile", "email"];
export const MODES_SIGNATAIRE = ["aucun", "fixe", "formateur"];
export const LIBELLES_MODE_SIGNATAIRE = {
  aucun: "Aucun signataire",
  fixe: "Signataire fixe",
  formateur: "Formateur concerné",
};

const LONGUEUR_MAX = { nom: 200, adresse_ligne1: 200, adresse_ligne2: 200, code_postal: 20, ville: 100, telephone: 30, mobile: 30, email: 200 };
const LIBELLES = {
  nom: "Nom de l'organisme", adresse_ligne1: "Adresse – ligne 1", adresse_ligne2: "Adresse – ligne 2", code_postal: "Code postal",
  ville: "Ville", telephone: "Téléphone fixe", mobile: "Téléphone mobile", email: "E-mail",
};
const TELEPHONE = /^[0-9 .+()-]{6,30}$/;
const EMAIL = /^[^\s@<>{}]+@[^\s@<>{}]+\.[^\s@<>{}]+$/;
// fix : ni balise, ni chevron, ni caractère de contrôle dans une valeur injectée dans un document.
const INTERDIT = /[{}<>\u0000-\u001f]/;

// Un champ vide efface la valeur (null). Renvoie { valeur } ou { erreur }.
export function validerOrganisme(corps) {
  const src = corps && typeof corps === "object" ? corps : {};
  const valeur = {};
  for (const champ of CHAMPS_ORGANISME) {
    if (src[champ] === undefined) continue;
    if (src[champ] !== null && typeof src[champ] !== "string") return { erreur: `${LIBELLES[champ]} : texte attendu.` };
    const t = (src[champ] ?? "").trim();
    if (t.length > LONGUEUR_MAX[champ]) return { erreur: `${LIBELLES[champ]} : ${LONGUEUR_MAX[champ]} caractères au plus.` };
    if (INTERDIT.test(t)) return { erreur: `${LIBELLES[champ]} : caractères non autorisés ({ } < > ou contrôle).` };
    if (t && (champ === "telephone" || champ === "mobile") && !TELEPHONE.test(t)) return { erreur: `${LIBELLES[champ]} : numéro invalide.` };
    if (t && champ === "email" && !EMAIL.test(t)) return { erreur: "E-mail : adresse invalide." };
    valeur[champ] = t || null;
  }
  if (!Object.keys(valeur).length) return { erreur: "Aucune modification transmise." };
  return { valeur };
}

export function validerSignataire(corps, { complet }) {
  const src = corps && typeof corps === "object" ? corps : {};
  const valeur = {};
  for (const [champ, libelle] of [["nom", "Nom"], ["fonction", "Fonction"]]) {
    if (!complet && src[champ] === undefined) continue;
    const t = typeof src[champ] === "string" ? src[champ].trim() : "";
    if (!t) return { erreur: `${libelle} obligatoire.` };
    if (t.length > 120) return { erreur: `${libelle} : 120 caractères au plus.` };
    if (INTERDIT.test(t)) return { erreur: `${libelle} : caractères non autorisés ({ } < > ou contrôle).` };
    valeur[champ] = t;
  }
  if (src.actif !== undefined) {
    if (typeof src.actif !== "boolean") return { erreur: "Actif : vrai ou faux attendu." };
    valeur.actif = src.actif;
  }
  if (!Object.keys(valeur).length) return { erreur: "Aucune modification transmise." };
  return { valeur };
}

// Cohérence mode / signataire d'un modèle (état final). `signataireActif` : le signataire existe et est actif.
export function verifierSignataireModele({ signataire_mode: mode, signataire_id: id }, signataireActif = true) {
  if (!MODES_SIGNATAIRE.includes(mode)) return { erreur: "Mode de signataire inconnu." };
  if (mode === "fixe") {
    if (!id) return { erreur: "Signataire fixe : choisissez un signataire." };
    if (!signataireActif) return { erreur: "Ce signataire n'existe pas ou est désactivé." };
  }
  if (mode !== "fixe" && id) return { erreur: "Un signataire n'est admis que pour le mode « signataire fixe »." };
  return { ok: true };
}

// Fonctions de la table intervenants (023) → libellé affiché.
const FONCTIONS = { formateur: "Formateur", referent_handicap: "Référent handicap", appui: "Appui", autre: "Intervenant" };
export const libelleFonction = (code) => FONCTIONS[code] || "Intervenant";

// Signataire d'un document pour une cible (stagiaire éventuel). Pur : tout vient du contexte.
//  · fixe       → le signataire du modèle ;
//  · formateur  → formateur du groupe du stagiaire, à défaut du groupe visé, à défaut de la session ;
//                 s'il y en a plusieurs, le premier par ordre alphabétique (déjà trié par la requête).
export function signatairePour(modele, ctx = {}, stagiaire = null) {
  if (!modele || !modele.signataire_mode || modele.signataire_mode === "aucun") return null;
  if (modele.signataire_mode === "fixe") return ctx.signataireFixe || null;
  const duGroupe = stagiaire?.groupe_id != null ? ctx.formateursParGroupe?.get(stagiaire.groupe_id) : null;
  const choix = (duGroupe?.length ? duGroupe : null) || (ctx.formateursGroupe?.length ? ctx.formateursGroupe : null) || ctx.formateursSession || [];
  const f = choix[0];
  if (!f) return null;
  const nom = [f.civilite, f.prenom, f.nom].filter(Boolean).join(" ").trim();
  return nom ? { nom, fonction: libelleFonction(f.fonction) } : null;
}
