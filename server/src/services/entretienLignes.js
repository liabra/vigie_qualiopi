// ─────────────────────────────────────────────────────────────
//  DOC-9D3 lot B — Tableaux répétables de l'entretien initial FSE-IA :
//  expériences (rubrique 4) et plan d'action individualisé (rubrique 10).
//  Module PUR : aucune base, aucun réseau.
//
//  Le modèle réel prévoit 5 lignes « vierges » pour le plan d'action, mais
//  l'audit demande explicitement de ne PAS forcer ce nombre : `ordre` est
//  juste un entier stable pour l'affichage, borné (1 à 20), jamais un
//  nombre de lignes imposé.
// ─────────────────────────────────────────────────────────────

export const MAX_LIGNES = 20;
export const ETATS_PLAN_ACTION = Object.freeze(["a_faire", "en_cours", "realise"]);

function texteBorne(v, max) {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return { erreur: true };
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) return { erreur: true };
  return t;
}

// Une expérience peut être partiellement remplie (toutes les colonnes sont
// facultatives indépendamment), mais pas totalement vide — sinon, omettre
// la ligne plutôt que l'envoyer.
export function validerLigneExperience(l) {
  const ordre = Number(l?.ordre);
  if (!Number.isInteger(ordre) || ordre < 1 || ordre > MAX_LIGNES) return { erreur: `Ordre invalide : ${l?.ordre}.` };
  const structure = texteBorne(l?.structure, 500);
  const duree = texteBorne(l?.duree, 100);
  const missions = texteBorne(l?.missions, 2000);
  const retenue = texteBorne(l?.retenue, 2000);
  if (structure?.erreur || duree?.erreur || missions?.erreur || retenue?.erreur) return { erreur: `Ligne ${ordre} : champ trop long.` };
  if (!structure && !duree && !missions && !retenue) return { erreur: `Ligne ${ordre} entièrement vide : omettez-la plutôt.` };
  return { ordre, structure, duree, missions, retenue };
}

export function validerLigneePlanAction(l) {
  const ordre = Number(l?.ordre);
  if (!Number.isInteger(ordre) || ordre < 1 || ordre > MAX_LIGNES) return { erreur: `Ordre invalide : ${l?.ordre}.` };
  const objectif = texteBorne(l?.objectif, 500);
  const action = texteBorne(l?.action, 1000);
  const echeance = texteBorne(l?.echeance, 100);
  if (objectif?.erreur || action?.erreur || echeance?.erreur) return { erreur: `Ligne ${ordre} : champ trop long.` };
  let phase = null;
  if (l?.phase != null && l.phase !== "") {
    phase = Number(l.phase);
    if (!Number.isInteger(phase) || phase < 1 || phase > 6) return { erreur: `Ligne ${ordre} : phase invalide.` };
  }
  let etat = null;
  if (l?.etat != null && l.etat !== "") {
    etat = typeof l.etat === "string" ? l.etat.trim() : "";
    if (!ETATS_PLAN_ACTION.includes(etat)) return { erreur: `Ligne ${ordre} : état invalide.` };
  }
  if (!objectif && !action && !echeance && phase === null && etat === null) return { erreur: `Ligne ${ordre} entièrement vide : omettez-la plutôt.` };
  return { ordre, objectif, phase, action, echeance, etat };
}

const VALIDATEURS = Object.freeze({
  experiences: validerLigneExperience,
  plan_action: validerLigneePlanAction,
});

export const BLOCS_LIGNES = Object.freeze(Object.keys(VALIDATEURS));

// Valide une LISTE de lignes pour un `bloc` donné. Refuse les ordres en
// double (une seule ligne par position d'affichage).
export function validerLignes(bloc, liste) {
  const validateur = VALIDATEURS[bloc];
  if (!validateur) return { erreur: `Tableau inconnu : ${bloc}.` };
  if (!Array.isArray(liste)) return { erreur: "Lignes invalides : liste attendue." };
  if (liste.length > MAX_LIGNES) return { erreur: `Trop de lignes (maximum ${MAX_LIGNES}).` };
  const ordres = new Set();
  const lignes = [];
  for (const l of liste) {
    const v = validateur(l);
    if (v.erreur) return { erreur: v.erreur };
    if (ordres.has(v.ordre)) return { erreur: `Ordre en double : ${v.ordre}.` };
    ordres.add(v.ordre);
    lignes.push(v);
  }
  return { lignes };
}
