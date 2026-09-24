import { useEffect, useState } from "react";
import { Alert } from "./ui/index.js";
import { useTitrePage } from "./pages/titre.js";

// Écran de connexion : sobre, sans information technique. Le retour vers la
// page demandée est géré par App (chemin interne uniquement, mémorisé avant
// le départ vers Google) ; cet écran ne manipule aucune URL de retour.
export default function Login({ flash, googleConfigured }) {
  useTitrePage("Connexion");
  const [depart, setDepart] = useState(false);
  // Retour arrière depuis Google (page restaurée du cache) : bouton réactivé.
  useEffect(() => {
    const surRetour = () => setDepart(false);
    window.addEventListener("pageshow", surRetour);
    return () => window.removeEventListener("pageshow", surRetour);
  }, []);
  return (
    <main className="login">
      <div className="login-carte">
        <div className="login-marque">
          <span className="shell-logo__marque" aria-hidden="true">V</span>
          <h1 className="login-titre">Vigie Qualiopi</h1>
        </div>
        <p className="login-texte">Suivez vos sessions, vos preuves et votre démarche qualité.</p>

        {flash?.type === "erreur" && <Alert ton="error" titre="La connexion n'a pas abouti.">{flash.texte}</Alert>}

        {googleConfigured ? (
          <a
            className="ui-btn ui-btn--primary login-bouton" href="/auth/google/login"
            aria-disabled={depart || undefined} onClick={() => setDepart(true)}
          >
            {depart ? "Connexion…" : "Se connecter avec Google"}
          </a>
        ) : (
          <Alert ton="warning" titre="La connexion n'est pas encore disponible.">
            Contactez l'administrateur de Vigie.
          </Alert>
        )}

        <p className="login-note">Accès réservé aux utilisateurs autorisés.</p>
      </div>
    </main>
  );
}
