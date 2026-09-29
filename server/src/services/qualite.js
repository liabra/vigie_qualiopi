// ─────────────────────────────────────────────────────────────
//  Cœur qualité (Q1) — validation et règles PURES, sans base ni
//  réseau, pour être testables seules. Les routes font le SQL.
//
//  Signalements : reclamation / incident / non_conformite.
//  Actions qualité : cycle a_faire → en_cours → realisee →
//  efficacite_a_verifier → cloturee, plus annulee. Aucun hard delete.
// ─────────────────────────────────────────────────────────────
import { parseIdPositif } from "./ids.js";
import { dateOptionnelleInvalide, estDateValide } from "./dates.js";

export const TYPES_SIGNALEMENT = ["reclamation", "incident", "non_conformite"];
export const STATUTS_SIGNALEMENT = ["ouverte", "qualifiee", "en_traitement", "resolue", "cloturee", "annulee"];
export const CANAUX = ["email", "poste", "autre"];
export const CAUSES = ["organisation", "pedagogie", "communication", "logistique", "autre"];

export const STATUTS_ACTION = ["a_faire", "en_cours", "realisee", "efficacite_a_verifier", "cloturee", "annulee"];
export const PRIORITES = ["basse", "normale", "haute", "urgente"];
export const ORIGINES = ["manuel", "signalement"];

// Préfixe de référence lisible d'un type de signalement.
export function prefixeReference(type) {
  return type === "reclamation" ? "REC" : type === "incident" ? "INC" : "NC";
}

export function referencePour(prefixe, annee, numero) {
  return `${prefixe}-${annee}-${String(numero).padStart(3, "0")}`;
}

// 15 jours ouvrés = lundi → vendredi, jours fériés NON gérés (indication
// explicite, jamais de pseudo-précision). L'échéance est indicative.
// Le jour de réception n'est pas compté : « à compter de la réception ».
export function datePlusJoursOuvres(dateStr, jours) {
  if (!estDateValide(dateStr)) return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  let restant = jours;
  while (restant > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const jour = d.getUTCDay(); // 0 = dimanche, 6 = samedi
    if (jour !== 0 && jour !== 6) restant--;
  }
  return d.toISOString().slice(0, 10);
}

const texte = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
const texteObligatoire = (v) => { const t = texte(v); return t || null; };
const entierPositif = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;   // undefined = refusé
};
const idOuNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  return parseIdPositif(v) || undefined;                  // undefined = refusé
};

// ── Signalements ──────────────────────────────────────────────

// Champs éditables d'un signalement. `creation` : le type est accepté
// (une fois le signalement créé, son type ne change plus).
export function champsSignalement(corps = {}, avant = {}, { creation = false } = {}) {
  const champs = {};
  const present = (k) => Object.prototype.hasOwnProperty.call(corps, k);

  if (creation) {
    if (!TYPES_SIGNALEMENT.includes(corps.type)) return { erreur: "Type de signalement inconnu." };
    champs.type = corps.type;
  }
  if (present("objet")) {
    const o = texteObligatoire(corps.objet);
    if (!o) return { erreur: "Objet obligatoire." };
    champs.objet = o;
  }
  for (const f of ["description", "reclamant_nom", "reclamant_entreprise", "reclamant_email",
                   "personne_concernee_libelle", "cause_autre_libelle", "synthese_reponse"]) {
    if (present(f)) champs[f] = texte(corps[f]);
  }
  if (present("canal")) {
    const c = texte(corps.canal);
    if (c !== null && !CANAUX.includes(c)) return { erreur: "Canal inconnu." };
    champs.canal = c;
  }
  for (const f of ["date_constat", "date_echeance_cible", "date_reponse", "date_resolution"]) {
    if (!present(f)) continue;
    if (corps[f] === null || corps[f] === "") { champs[f] = null; continue; }
    if (!estDateValide(String(corps[f]).trim())) return { erreur: `Date invalide (${f}) : format attendu AAAA-MM-JJ.` };
    champs[f] = String(corps[f]).trim();
  }
  for (const f of ["inscription_id", "responsable_id", "formation_id", "session_id"]) {
    if (!present(f)) continue;
    const v = idOuNull(corps[f]);
    if (v === undefined) return { erreur: `Identifiant invalide (${f}).` };
    champs[f] = v;
  }
  if (present("delai_cible_jours_ouvres")) {
    const d = entierPositif(corps.delai_cible_jours_ouvres);
    if (d === undefined) return { erreur: "Le délai cible doit être un entier positif." };
    champs.delai_cible_jours_ouvres = d;
  }
  return { champs };
}

// Causes 0..N. Accepte une liste de valeurs techniques. `autre` doit être
// accompagné d'un libellé explicatif (`cause_autre_libelle`, validé à part).
export function lireCauses(corps = {}) {
  if (corps.causes === undefined) return { causes: null };
  const liste = Array.isArray(corps.causes) ? corps.causes : [];
  const uniques = [...new Set(liste.map((c) => String(c).trim()).filter(Boolean))];
  for (const c of uniques) {
    if (!CAUSES.includes(c)) return { erreur: `Cause inconnue : ${c}.` };
  }
  if (uniques.includes("autre") && !(corps.cause_autre_libelle || "").trim()) {
    return { erreur: "La cause « autre » doit être explicitée." };
  }
  return { causes: uniques };
}

// Liste des indicateurs visés (identifiants du référentiel versionné).
export function lireIndicateurs(corps = {}) {
  if (corps.indicateur_ids === undefined) return { ids: null };
  const liste = Array.isArray(corps.indicateur_ids) ? corps.indicateur_ids : [];
  const uniques = [...new Set(liste)];
  const ids = [];
  for (const v of uniques) {
    const n = parseIdPositif(v);
    if (!n) return { erreur: "Identifiant d'indicateur invalide." };
    ids.push(n);
  }
  return { ids };
}

// ── Actions qualité ───────────────────────────────────────────

// Champs éditables d'une action. `statut` n'est JAMAIS un champ libre :
// les transitions passent par des endpoints explicites.
export function champsAction(corps = {}, avant = {}) {
  const champs = {};
  const present = (k) => Object.prototype.hasOwnProperty.call(corps, k);

  if (present("titre")) {
    const t = texteObligatoire(corps.titre);
    if (!t) return { erreur: "Titre obligatoire." };
    champs.titre = t;
  }
  for (const f of ["constat", "action_prevue", "resultat", "controle_efficacite"]) {
    if (present(f)) champs[f] = texte(corps[f]);
  }
  for (const f of ["echeance", "date_mise_en_oeuvre", "date_controle_efficacite"]) {
    if (!present(f)) continue;
    if (corps[f] === null || corps[f] === "") { champs[f] = null; continue; }
    if (dateOptionnelleInvalide(String(corps[f]).trim())) return { erreur: `Date invalide (${f}) : format attendu AAAA-MM-JJ.` };
    champs[f] = String(corps[f]).trim();
  }
  if (present("priorite")) {
    const p = texte(corps.priorite);
    if (p !== null && !PRIORITES.includes(p)) return { erreur: "Priorité inconnue." };
    champs.priorite = p;
  }
  for (const f of ["signalement_id", "responsable_id", "formation_id", "session_id"]) {
    if (!present(f)) continue;
    const v = idOuNull(corps[f]);
    if (v === undefined) return { erreur: `Identifiant invalide (${f}).` };
    champs[f] = v;
  }
  // L'origine est dérivée, jamais saisie : signalement ⇒ « signalement ».
  const signalement = champs.signalement_id !== undefined ? champs.signalement_id : avant.signalement_id ?? null;
  if (signalement !== null && present("signalement_id")) champs.origine = "signalement";
  else if (present("signalement_id")) champs.origine = "manuel";
  return { champs };
}

// ── Workflows (transitions explicites) ────────────────────────

export const TRANSITIONS_SIGNALEMENT = {
  qualifier: { de: ["ouverte"], vers: "qualifiee" },
  traiter: { de: ["qualifiee"], vers: "en_traitement" },
  resoudre: { de: ["en_traitement"], vers: "resolue" },
  cloturer: { de: ["resolue"], vers: "cloturee" },
  rouvrir: { de: ["cloturee"], vers: "en_traitement" },
  annuler: { de: ["ouverte", "qualifiee", "en_traitement", "resolue"], vers: "annulee" },
};

export const TRANSITIONS_ACTION = {
  demarrer: { de: ["a_faire"], vers: "en_cours" },
  realiser: { de: ["en_cours"], vers: "realisee" },
  "controle-efficacite": { de: ["realisee"], vers: "efficacite_a_verifier" },
  cloturer: { de: ["efficacite_a_verifier"], vers: "cloturee" },
  rouvrir: { de: ["cloturee"], vers: "en_cours" },
  annuler: { de: ["a_faire", "en_cours", "realisee", "efficacite_a_verifier"], vers: "annulee" },
};

// null = transition acceptée ; sinon message d'erreur français.
export function transitionInvalide(tableau, action, statutActuel) {
  const t = tableau[action];
  if (!t) return "Transition inconnue.";
  if (!t.de.includes(statutActuel)) {
    return `Transition impossible depuis le statut « ${statutActuel} ».`;
  }
  return null;
}
