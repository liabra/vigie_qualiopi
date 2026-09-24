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
