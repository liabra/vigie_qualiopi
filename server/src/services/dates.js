// ─────────────────────────────────────────────────────────────
//  Dates saisies (colonnes DATE) — validation CENTRALE.
//
//  Règle Vigie : « AAAA-MM-JJ » strict, date réelle du calendrier.
//  Jamais de cast PostgreSQL laissé à une valeur non validée : sinon
//  « abc » (22007) ou « 2026-02-31 » (22008) remonteraient en 500.
// ─────────────────────────────────────────────────────────────

// Le 30 février doit être refusé, pas reporté au 2 mars : on relit la date
// telle que JavaScript l'a comprise et on la compare au texte d'origine.
export function estDateValide(valeur) {
  if (typeof valeur !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return false;
  const d = new Date(`${valeur}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valeur;
}

// Champ DATE facultatif, sémantique historique `valeur || null` conservée :
// vide / null / absent ⇒ null (champ effacé ou défaut SQL) ; toute autre
// valeur doit être une date valide.
export function dateOptionnelleInvalide(valeur) {
  return !!valeur && !estDateValide(valeur);
}

// ─────────────────────────────────────────────────────────────
//  Date MÉTIER « aujourd'hui » (TIME-1) : jour civil de l'organisme,
//  fuseau America/Cayenne (UTC−3, sans heure d'été), quel que soit le
//  fuseau de la machine (Railway = UTC). Réservée aux dates métier
//  posées automatiquement (inscription, abandon, résolution / clôture
//  Qualité, révision de preuve…). Les horodatages techniques restent en
//  UTC (now(), toISOString()). Une date saisie par l'utilisateur n'est
//  jamais remplacée : ce défaut ne s'applique qu'en son absence.
// ─────────────────────────────────────────────────────────────
export const FUSEAU_METIER = "America/Cayenne";
const formatJourMetier = new Intl.DateTimeFormat("en-CA", { timeZone: FUSEAU_METIER, year: "numeric", month: "2-digit", day: "2-digit" });

// Horloge injectable pour les tests de frontière (jamais utilisée en production).
let horloge = () => new Date();
export function fixerHorlogeMetier(fn) { horloge = fn || (() => new Date()); }

export function dateMetierAujourdhui(instant = horloge()) {
  const p = Object.fromEntries(formatJourMetier.formatToParts(instant).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
