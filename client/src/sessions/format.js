// Sessions : libellés, formats et calculs d'affichage. Module PUR (aucun
// React, aucun appel réseau) : testable seul. Aucune règle métier n'est
// décidée ici — les statuts, taux et bornes viennent du serveur.

export const STATUTS_SESSION = {
  planifiee: { libelle: "Planifiée", ton: "neutral" },
  en_cours: { libelle: "En cours", ton: "info" },
  terminee: { libelle: "Terminée", ton: "success" },
  annulee: { libelle: "Annulée", ton: "neutral" },
};

// Vues de la liste : fondées sur le STATUT déclaré (jamais déduit des dates,
// règle L4 — le statut n'est pas changé automatiquement).
export const VUES_SESSIONS = [
  { id: "toutes", libelle: "Toutes", statuts: null },
  { id: "a_venir", libelle: "À venir", statuts: ["planifiee"] },
  { id: "en_cours", libelle: "En cours", statuts: ["en_cours"] },
  { id: "terminees", libelle: "Terminées", statuts: ["terminee"] },
  { id: "annulees", libelle: "Annulées", statuts: ["annulee"] },
];

export const MODALITES = { presentiel: "Présentiel", distanciel: "Distanciel", mixte: "Mixte" };
// Valeurs admises en base (migration 008) ; vide = non renseignée.
export const CIVILITES = ["M.", "Mme"];
// Valeurs admises par la contrainte SQL sur absences.demi_journee.
export const DEMI_JOURNEES = { matin: "Matin", apres_midi: "Après-midi", journee: "Journée" };
// Libellés humains de la portée d'un modèle (plutôt que « portée stagiaire »).
export const PORTEES = {
  formation: "Un document pour la formation",
  session: "Un document pour la session",
  groupe: "Un document par groupe",
  stagiaire: "Un document par stagiaire",
};
// Types suggérés pour un document externe (EduSign / Drive) ; libellé libre.
export const TYPES_EDUSIGN = ["Feuille d'émargement EduSign", "Feuille de présence", "Justificatif EduSign"];

// « 2026-09-28 » → « 28/09/2026 ». Les valeurs ENVOYÉES au serveur restent ISO.
export function formaterDate(iso) {
  const t = String(iso || "").slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

export function formaterDateHeure(horodatage) {
  const d = new Date(horodatage);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formaterPeriode(debut, fin) {
  const a = formaterDate(debut);
  const b = formaterDate(fin);
  if (a && b) return `du ${a} au ${b}`;
  return a || b || "";
}

// « 210.00 » → « 210 h », « 7.5 » → « 7,5 h ». null / vide → "".
export function formaterHeures(valeur) {
  if (valeur === null || valeur === undefined || valeur === "") return "";
  const n = Number(valeur);
  if (!Number.isFinite(n)) return "";
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h`;
}

// Durée prévue : celle de la session, à défaut celle de la formation.
export function dureePrevue(session) {
  if (session?.duree_heures_reelle !== null && session?.duree_heures_reelle !== undefined && session.duree_heures_reelle !== "") {
    return { heures: session.duree_heures_reelle, source: "session" };
  }
  if (session?.duree_heures_defaut !== null && session?.duree_heures_defaut !== undefined) {
    return { heures: session.duree_heures_defaut, source: "formation" };
  }
  return { heures: null, source: null };
}

export const titreSession = (s) => s?.reference || s?.formation || "Session";

// Libellé d'un prescripteur à partir de son code, y compris désactivé.
export const libellePrescripteur = (code, prescripteurs) =>
  prescripteurs?.find((p) => p.code === code)?.nom || code || "";

const normaliser = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Filtre de la liste : vue (statut) + recherche sur les champs chargés par
// la liste (référence, formation, lieu). Le formateur n'est pas renvoyé par
// GET /api/sessions : il n'est donc pas cherchable sans évolution backend.
export function filtrerSessions(sessions, { vue = "toutes", q = "" } = {}) {
  const statuts = VUES_SESSIONS.find((v) => v.id === vue)?.statuts || null;
  const aiguille = normaliser(q.trim());
  return (sessions || []).filter((s) => {
    if (statuts && !statuts.includes(s.statut)) return false;
    if (!aiguille) return true;
    return [s.reference, s.formation, s.lieu, s.formateur].some((c) => normaliser(c).includes(aiguille));
  });
}

export function compterParVue(sessions) {
  return Object.fromEntries(VUES_SESSIONS.map((v) => [v.id, filtrerSessions(sessions, { vue: v.id }).length]));
}

// Incohérences statut / dates : AVERTISSEMENT seulement, jamais corrigé.
export function incoherencesStatut(session, aujourdhui = new Date().toISOString().slice(0, 10)) {
  const liste = [];
  if (session.statut === "planifiee" && session.date_fin < aujourdhui) liste.push("session « planifiée » dont la date de fin est passée");
  if (session.statut === "terminee" && session.date_debut > aujourdhui) liste.push("session « terminée » dont la date de début est future");
  return liste;
}

// Synthèse des stagiaires d'une session (données du détail).
export function syntheseStagiaires(stagiaires) {
  const actifs = (stagiaires || []).filter((s) => s.statut !== "abandon");
  return {
    total: (stagiaires || []).length,
    actifs: actifs.length,
    abandons: (stagiaires || []).length - actifs.length,
    dossiersIncomplets: actifs.filter((s) => !s.dossier_complet).length,
  };
}

// Synthèse d'assiduité : on ne compte que les taux que le SERVEUR juge
// fiables ; seuil d'affichage 80 % (celui déjà utilisé à l'écran).
export const SEUIL_ASSIDUITE = 80;
export function syntheseAssiduite(absences) {
  const fiches = absences?.stagiaires || [];
  const fiables = fiches.filter((f) => f.assiduite?.fiable);
  return {
    totalHeures: absences?.total_heures_absence ?? 0,
    nbAbsences: fiches.reduce((n, f) => n + (f.absences?.length || 0), 0),
    fiables: fiables.length,
    sousSeuil: fiables.filter((f) => f.assiduite.taux < SEUIL_ASSIDUITE).length,
    nonCalcules: fiches.length - fiables.length,
    depassements: fiches.filter((f) => f.assiduite?.depassement).length,
  };
}
