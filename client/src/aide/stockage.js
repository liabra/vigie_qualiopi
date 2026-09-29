// Après VF — aide intégrée : stockage local du tutoriel, SANS dépendance et
// SANS blocage. Si localStorage est indisponible (navigation privée, stockage
// bloqué), l'application continue normalement : le tutoriel n'est simplement
// pas re-proposé automatiquement (relançable depuis ? Aide).

export const CLE_TUTORIEL = "vigie_tutoriel_termine";

export function tutorielTermine() {
  try { return window.localStorage.getItem(CLE_TUTORIEL) === "true"; }
  catch { return true; } // indisponible → ne jamais gêner l'usage
}

export function marquerTutorielTermine() {
  try { window.localStorage.setItem(CLE_TUTORIEL, "true"); }
  catch { /* stockage indisponible : ignoré, l'application continue */ }
}
