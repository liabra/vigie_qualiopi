// Requête Drive de recherche par nom. La saisie est un LITTÉRAL : antislashs et apostrophes
// sont échappés, sinon une saisie pourrait modifier la requête envoyée à Drive.
export function requeteRechercheParNom(texte) {
  const litteral = String(texte).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `name contains '${litteral}' and trashed = false`;
}
