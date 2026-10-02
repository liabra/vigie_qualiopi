// ─────────────────────────────────────────────────────────────
//  Q3-1 — Import des réponses Google Forms de satisfaction : lecture et
//  classement PURS (sans base ni Express), testables isolément.
//
//  Règles validées :
//    - une enquête est toujours rattachée à une session ;
//    - réponses ANONYMES par défaut ; rapprochement d'un stagiaire par
//      e-mail seulement sur demande explicite (option cochée) ;
//    - note sur 5 imposée (0 à 5) ;
//    - l'e-mail et les colonnes d'identité ne sont JAMAIS conservés dans
//      les réponses enregistrées.
//  Google Forms reste l'outil de collecte : aucun moteur de questionnaire.
// ─────────────────────────────────────────────────────────────
import { detecterSeparateur, contientCaractereInvalide, normaliser, normaliserEmail, validerEmail } from "./csvStagiaires.js";
import { dateValideStricte } from "./evaluations.js";

export const NOTE_MAX_SATISFACTION = 5;
export const MAX_LIGNES_IMPORT = 2000;
export const MAX_COLONNES_IMPORT = 80;
export const MAX_TEXTE_REPONSE = 5000;

// CSV complet (RFC 4180) : une cellule entre guillemets peut contenir le
// séparateur, des guillemets doublés ET des retours à la ligne — cas
// courant des commentaires exportés de Google Forms.
export function parserCsvComplet(texte) {
  const source = String(texte ?? "").replace(/^﻿/, "");
  if (!source.trim()) return { erreur: "Le fichier est vide." };
  if (contientCaractereInvalide(source)) {
    return { erreur: "Encodage non reconnu : caractères illisibles détectés. Enregistrez le fichier en UTF-8." };
  }
  const sep = detecterSeparateur(source);
  const lignes = [];
  let ligne = [], cellule = "", guillemets = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (guillemets) {
      if (c === '"') {
        if (source[i + 1] === '"') { cellule += '"'; i++; } else guillemets = false;
      } else cellule += c;
    } else if (c === '"') guillemets = true;
    else if (c === sep) { ligne.push(cellule); cellule = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      ligne.push(cellule); cellule = "";
      lignes.push(ligne); ligne = [];
    } else cellule += c;
  }
  if (guillemets) return { erreur: "Fichier mal formé : un guillemet n'est pas refermé." };
  ligne.push(cellule);
  lignes.push(ligne);
  const nonVides = lignes.filter((l) => l.some((c) => c.trim() !== ""));
  if (!nonVides.length) return { erreur: "Le fichier est vide." };
  const enTetes = nonVides[0].map((c) => c.trim());
  if (enTetes.length > MAX_COLONNES_IMPORT) return { erreur: `Trop de colonnes (${MAX_COLONNES_IMPORT} au plus).` };
  const donnees = nonVides.slice(1).map((l) => l.map((c) => c.trim()));
  if (donnees.length > MAX_LIGNES_IMPORT) return { erreur: `Trop de réponses dans un seul fichier (${MAX_LIGNES_IMPORT} au plus).` };
  return { sep, enTetes, lignes: donnees };
}

// Colonnes reconnues par leur en-tête normalisé (liste FERMÉE).
const HORODATEUR = ["horodateur", "horodatage", "timestamp", "dateetheure", "datedereponse", "date"];
const EMAIL = ["email", "adresseemail", "adressemail", "emailaddress", "courriel", "adressecourriel", "mail"];
// Colonnes d'identité jamais conservées dans les réponses.
const IDENTITE = [...EMAIL, "nom", "prenom", "nomprenom", "prenomnom", "nometprenom", "prenometnom", "votrenom",
  "votreprenom", "nomcomplet", "telephone", "tel", "numerodetelephone", "nomdutilisateur", "username"];

const indexDe = (enTetes, liste) => enTetes.findIndex((t) => liste.includes(normaliser(t)));
export const colonneHorodateur = (enTetes) => indexDe(enTetes, HORODATEUR);
export const colonneEmail = (enTetes) => indexDe(enTetes, EMAIL);
export const estColonneIdentite = (tete) => IDENTITE.includes(normaliser(tete));

// Propositions par défaut (modifiables dans l'écran d'import).
export function devinerColonnes(enTetes) {
  const n = enTetes.map((t) => normaliser(t));
  const note = n.findIndex((t) => /note|globalement|satisfactionglobale|satisfaitdelaformation|appreciationglobale/.test(t));
  const commentaire = n.findIndex((t) => /commentaire|remarque|suggestion|ameliorer|observation/.test(t));
  return { colonne_note: note >= 0 ? note : null, colonne_commentaire: commentaire >= 0 ? commentaire : null };
}

// Horodateur Google Forms → AAAA-MM-JJ. L'heure, déjà locale (fuseau du
// formulaire), est ignorée : aucune conversion de fuseau.
export function dateHorodateur(v) {
  const t = String(v ?? "").trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T].*)?$/);
  if (m) return dateValideStricte(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$/);
  if (m) return dateValideStricte(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  return null;
}

// Note sur 5 : « 4 », « 4,5 », « 4 - Satisfait ». Vide ⇒ null.
export function noteSur5(v) {
  const t = String(v ?? "").trim();
  if (!t) return { valeur: null };
  const m = t.match(/^(\d+(?:[.,]\d+)?)(?:\s*(?:[-–:/].*|\s.*))?$/);
  if (!m) return { erreur: "note illisible" };
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > NOTE_MAX_SATISFACTION) return { erreur: `note hors de l'échelle 0 à ${NOTE_MAX_SATISFACTION}` };
  return { valeur: n };
}

const indexOuNull = (v, nb) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n < nb ? n : undefined;
};

// Classe chaque ligne : pret | invalide | a_verifier | doublon.
//   options : { colonne_note, colonne_commentaire, rapprocher_email, date_defaut }
//   inscriptionsParEmail : Map(emailNormalisé → [{ inscription_id, nom, prenom }])
//   existantes : Set des empreintes déjà enregistrées pour ce type dans la session
export function classerReponses({ enTetes, lignes, options = {}, inscriptionsParEmail = new Map(), existantes = new Set() }) {
  const nb = enTetes.length;
  const iNote = indexOuNull(options.colonne_note, nb);
  const iCom = indexOuNull(options.colonne_commentaire, nb);
  if (iNote === undefined) return { erreur: "Colonne de note inconnue." };
  if (iCom === undefined) return { erreur: "Colonne de commentaire inconnue." };
  if (iNote !== null && estColonneIdentite(enTetes[iNote])) return { erreur: "La colonne de note ne peut pas être une colonne d'identité." };
  if (iCom !== null && estColonneIdentite(enTetes[iCom])) return { erreur: "La colonne de commentaire ne peut pas être une colonne d'identité." };
  const iDate = colonneHorodateur(enTetes);
  const iEmail = colonneEmail(enTetes);
  const rapprocher = options.rapprocher_email === true;
  if (rapprocher && iEmail < 0) return { erreur: "Rapprochement demandé, mais le fichier n'a pas de colonne e-mail." };
  let dateDefaut = null;
  if (iDate < 0) {
    dateDefaut = options.date_defaut ? dateValideStricte(options.date_defaut) : null;
    if (!dateDefaut) return { erreur: "Le fichier n'a pas d'horodateur : indiquez la date du recueil." };
  }
  const conservees = enTetes.map((t, i) => ({ t, i })).filter(({ t }) => t && !estColonneIdentite(t));
  const ecartees = enTetes.filter((t) => t && estColonneIdentite(t));

  const resultats = [];
  const resume = { importables: 0, invalides: 0, aVerifier: 0, doublons: 0 };
  const vues = new Set();
  lignes.forEach((cellules, index) => {
    if (cellules.every((c) => !c)) return;
    const ligne = { index, statut: "pret", motif: null };
    const valeur = (i) => (i === null || i < 0 ? "" : cellules[i] ?? "");
    const date = iDate >= 0 ? dateHorodateur(valeur(iDate)) : dateDefaut;
    const note = iNote === null ? { valeur: null } : noteSur5(valeur(iNote));
    const commentaire = iCom === null ? null : (valeur(iCom) || null);
    const reponses = Object.create(null); // fix : un en-tête « __proto__ » reste une simple clé
    for (const { t, i } of conservees) if ((cellules[i] ?? "") !== "") reponses[t] = cellules[i];
    const trop = Object.values(reponses).some((x) => x.length > MAX_TEXTE_REPONSE);

    if (!date) { ligne.statut = "invalide"; ligne.motif = "horodateur absent ou illisible"; }
    else if (note.erreur) { ligne.statut = "invalide"; ligne.motif = note.erreur; }
    else if (trop) { ligne.statut = "invalide"; ligne.motif = `réponse trop longue (${MAX_TEXTE_REPONSE} caractères au plus)`; }
    else if (rapprocher) {
      const email = normaliserEmail(valeur(iEmail));
      const candidats = email && validerEmail(email) ? (inscriptionsParEmail.get(email) || []) : null;
      if (!candidats) { ligne.statut = "invalide"; ligne.motif = "e-mail absent ou invalide"; }
      else if (candidats.length === 0) { ligne.statut = "invalide"; ligne.motif = "e-mail inconnu dans cette session"; }
      else if (candidats.length > 1) { ligne.statut = "a_verifier"; ligne.motif = "plusieurs stagiaires partagent cet e-mail"; }
      else { ligne.inscriptionId = candidats[0].inscription_id; ligne.stagiaire = { nom: candidats[0].nom, prenom: candidats[0].prenom }; }
    }
    if (ligne.statut === "pret") {
      Object.assign(ligne, { date, note: note.valeur, commentaire, reponses });
      // Doublon : seulement si un horodateur distingue les réponses (deux
      // réponses identiques sans horodateur peuvent être légitimes).
      if (iDate >= 0) {
        const emp = empreinteReponse(reponses);
        if (existantes.has(emp)) { ligne.statut = "doublon"; ligne.motif = "réponse déjà importée"; }
        else if (vues.has(emp)) { ligne.statut = "doublon"; ligne.motif = "réponse en double dans le fichier"; }
        else vues.add(emp);
      }
    }
    resume[{ pret: "importables", invalide: "invalides", a_verifier: "aVerifier", doublon: "doublons" }[ligne.statut]]++;
    resultats.push(ligne);
  });
  return {
    resultats, resume, horodateur: iDate >= 0, rapprochement: rapprocher,
    colonnesEcartees: ecartees, colonneEmailPresente: iEmail >= 0,
  };
}

// Empreinte stable d'une réponse (clés triées), comparable entre le
// fichier et les réponses déjà enregistrées (colonne jsonb `reponses`).
export function empreinteReponse(reponses) {
  const obj = reponses || {};
  return JSON.stringify(Object.keys(obj).sort().map((k) => [k, String(obj[k])]));
}
