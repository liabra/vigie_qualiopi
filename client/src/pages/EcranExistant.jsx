import { useLocation } from "react-router-dom";
import { contexteDe } from "../navigation.js";
import { PageHeader } from "../ui/index.js";
import { useTitrePage } from "./titre.js";

// Enveloppe d'un écran EXISTANT dans la nouvelle coque (UX-1A) : fil
// d'Ariane et titre d'onglet, sans second titre — l'écran garde le sien
// tant qu'il n'est pas refondu.
export function EcranExistant({ children }) {
  const { pathname } = useLocation();
  const ctx = contexteDe(pathname);
  useTitrePage(ctx?.page);
  const fil = ctx ? [...(ctx.groupe ? [{ libelle: ctx.groupe }] : []), { libelle: ctx.page, to: ctx.to }] : [];
  return (
    <div className="ecran-existant">
      <PageHeader fil={fil} />
      {children}
    </div>
  );
}
