// ─────────────────────────────────────────────────────────────
//  Identifiants PostgreSQL Vigie — validation CENTRALE.
//
//  Un identifiant valide est :
//    - un entier ;
//    - strictement positif ;
//    - sans décimale ni caractère supplémentaire.
//
//  `abc`, `1abc`, `1.5`, `0`, `-1`, vide ⇒ null (l'appelant répond 400).
//  Un identifiant valide mais inexistant ⇒ l'appelant répond 404.
//  Jamais de cast PostgreSQL laissé à la charge d'une valeur non validée.
// ─────────────────────────────────────────────────────────────

export function parseIdPositif(valeur) {
  if (typeof valeur === "number") {
    return Number.isSafeInteger(valeur) && valeur > 0 ? valeur : null;
  }
  if (typeof valeur !== "string") return null;
  if (!/^\d+$/.test(valeur)) return null;   // chiffres uniquement : pas de signe, pas de décimales
  const n = Number(valeur);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
