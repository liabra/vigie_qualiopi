import DriveStatus from "../DriveStatus.jsx";
import { PageHeader } from "../ui/index.js";
import { useTitrePage } from "./titre.js";

// Paramètres › Google Drive : remplace le bandeau qui s'affichait en tête
// de chaque écran administrateur.
export function GoogleDrivePage() {
  useTitrePage("Google Drive");
  return (
    <>
      <PageHeader
        fil={[{ libelle: "Paramètres" }, { libelle: "Google Drive" }]}
        titre="Google Drive"
        description="Compte Drive de l'organisme, utilisé pour les preuves, les modèles et la génération de documents."
      />
      <DriveStatus />
    </>
  );
}
