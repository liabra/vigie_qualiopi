import { Button, EmptyState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "./titre.js";

// Page réservée aux administrateurs, ouverte par un contributeur (lien
// copié, adresse saisie). Le serveur refuse de toute façon ces actions :
// l'interface se contente de ne rien proposer d'interdit.
export function AccesReserve() {
  useTitrePage("Accès réservé");
  return (
    <>
      <PageHeader titre="Accès réservé" />
      <EmptyState
        titre="Cette page est réservée aux administrateurs."
        action={<Button variante="primary" to="/accueil">Revenir à l'accueil</Button>}
      >
        Si vous pensez devoir y accéder, adressez-vous à un administrateur de Vigie.
      </EmptyState>
    </>
  );
}

export function RequireAdmin({ user, children }) {
  return user.role === "admin" ? children : <AccesReserve />;
}
