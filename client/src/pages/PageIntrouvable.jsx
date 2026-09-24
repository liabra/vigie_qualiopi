import { Button, EmptyState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "./titre.js";

// Adresse inconnue : jamais d'écran blanc.
export function PageIntrouvable() {
  useTitrePage("Page introuvable");
  return (
    <>
      <PageHeader titre="Page introuvable" />
      <EmptyState
        titre="Cette adresse ne correspond à aucune page de Vigie."
        action={<Button variante="primary" to="/accueil">Revenir à l'accueil</Button>}
      >
        Vérifiez le lien, ou utilisez le menu pour retrouver la page recherchée.
      </EmptyState>
    </>
  );
}
