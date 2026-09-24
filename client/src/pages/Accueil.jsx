import { Link } from "react-router-dom";
import { navigationPour } from "../navigation.js";
import { PageHeader } from "../ui/index.js";
import DriveStatus from "../DriveStatus.jsx";
import { useTitrePage } from "./titre.js";

// Accueil (UX-1A) : squelette et raccourcis selon les droits. Le tableau
// de bord « À traiter » viendra en UX-4.
const DESCRIPTIONS = {
  "/sessions": "Sessions, stagiaires, absences, évaluations et documents",
  "/formations": "Catalogue des formations et de leurs versions",
  "/indicateurs": "Conformité au référentiel, indicateur par indicateur",
  "/preuves": "Documents rattachés aux indicateurs Qualiopi",
  "/veille": "Veille réglementaire, analyse d'impact et actions",
  "/audits": "Historique des audits et non-conformités",
  "/modeles": "Modèles Google Docs / Sheets pour la génération",
  "/prescripteurs": "Liste proposée lors des inscriptions",
  "/versions": "Versions du référentiel (active, futures, historiques)",
  "/parametres/google": "Connexion au Google Drive de l'organisme",
};

export function Accueil({ user }) {
  useTitrePage("Accueil");
  const admin = user.role === "admin";
  const prenom = (user.nom || "").trim();
  const groupes = navigationPour(user.role).filter((g) => g.id !== "accueil");
  return (
    <>
      <PageHeader
        titre="Accueil"
        description={prenom ? `Bonjour ${prenom}. Que souhaitez-vous faire ?` : "Bonjour. Que souhaitez-vous faire ?"}
      />
      {groupes.map((g) => (
        <section key={g.id} className="accueil-groupe" aria-labelledby={`accueil-${g.id}`}>
          <h2 id={`accueil-${g.id}`} className="accueil-groupe__titre">{g.titre}</h2>
          <ul className="accueil-raccourcis">
            {g.entrees.map((e) => (
              <li key={e.to}>
                <Link to={e.to} className="accueil-raccourci">
                  <span className="accueil-raccourci__titre">{e.libelle}</span>
                  <span className="accueil-raccourci__texte">{DESCRIPTIONS[e.to]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {admin && (
        <section className="accueil-groupe" aria-labelledby="accueil-drive">
          <h2 id="accueil-drive" className="accueil-groupe__titre">Google Drive</h2>
          <DriveStatus />
        </section>
      )}
    </>
  );
}
