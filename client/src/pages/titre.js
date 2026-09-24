import { useEffect } from "react";

// Titre de l'onglet du navigateur, par page (« Sessions — Vigie Qualiopi »).
export function useTitrePage(titre) {
  useEffect(() => {
    document.title = titre ? `${titre} — Vigie Qualiopi` : "Vigie Qualiopi";
  }, [titre]);
}
