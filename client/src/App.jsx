import { useEffect, useState } from "react";
import { api } from "./api.js";
import { ERREURS } from "./messages.js";
import Login from "./Login.jsx";
import DriveStatus from "./DriveStatus.jsx";
import Referentiel from "./Referentiel.jsx";
import Preuves from "./Preuves.jsx";

// Lit puis retire ?erreur= / ?drive= de l'URL, pour qu'un rechargement ne réaffiche rien.
function consumeFlash() {
  const params = new URLSearchParams(window.location.search);
  const erreur = params.get("erreur");
  const drive = params.get("drive");
  if (erreur || drive) window.history.replaceState(null, "", window.location.pathname);
  if (erreur) return { type: "erreur", texte: ERREURS[erreur] || "Erreur de connexion." };
  if (drive === "ok") return { type: "ok", texte: "Google Drive connecté en lecture seule." };
  return null;
}

export default function App() {
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);
  const [flash] = useState(consumeFlash);
  const [onglet, setOnglet] = useState("referentiel");
  // Une preuve modifiée change le tableau de bord : on le remonte.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api("/api/me").then(setMe).catch((e) => setError(e.message));
  }, []);

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setMe((m) => ({ ...m, user: null }));
  }

  if (error) return <main className="page"><p className="flash erreur">Serveur injoignable : {error}</p></main>;
  if (!me) return <main className="page"><p className="muted">Chargement…</p></main>;
  if (!me.user) return <Login flash={flash} googleConfigured={me.googleConfigured} />;

  const isAdmin = me.user.role === "admin";
  return (
    <>
      <header className="topbar">
        <div className="brand">Vigie Qualiopi</div>
        <div className="who">
          <span>{me.user.nom || me.user.email}</span>
          <span className={"role " + me.user.role}>{isAdmin ? "Admin" : "Contributeur"}</span>
          <button className="link" onClick={logout}>Déconnexion</button>
        </div>
      </header>
      <main className="page">
        {flash && <p className={"flash " + flash.type}>{flash.texte}</p>}
        {isAdmin && <DriveStatus />}
        <nav className="onglets">
          <button className={onglet === "referentiel" ? "actif" : ""} onClick={() => setOnglet("referentiel")}>
            Tableau de bord
          </button>
          <button className={onglet === "preuves" ? "actif" : ""} onClick={() => setOnglet("preuves")}>
            Preuves
          </button>
        </nav>
        {/* `rafraichir` fait relire les données au tableau de bord, sans le
            remonter : une clé qui change réinitialiserait les critères
            ouverts et renverrait en haut de page. */}
        {onglet === "referentiel"
          ? <Referentiel admin={isAdmin} rafraichir={version} />
          : <Preuves admin={isAdmin} onChange={() => setVersion((v) => v + 1)} />}
      </main>
    </>
  );
}
