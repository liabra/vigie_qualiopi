import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar.jsx";
import { Alert } from "../ui/index.js";

// Coque de l'application : barre latérale (fixe sur ordinateur, tiroir sur
// tablette et mobile), zone principale, lien d'évitement. Les pages sont
// rendues dans <Outlet />.
export function AppShell({ user, onLogout, flash, onFlashVu }) {
  const [menuOuvert, setMenuOuvert] = useState(false);
  const boutonMenu = useRef(null);
  const principal = useRef(null);
  const { pathname } = useLocation();
  const premierChemin = useRef(pathname);

  // Changer de page referme le tiroir ; le message de retour OAuth
  // (?erreur= / ?drive=) ne concerne que la page d'arrivée.
  useEffect(() => {
    setMenuOuvert(false);
    if (pathname !== premierChemin.current) onFlashVu?.();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tiroir ouvert : focus sur le premier lien, Échap referme et rend le
  // focus au bouton qui l'a ouvert.
  useEffect(() => {
    if (!menuOuvert) return undefined;
    document.querySelector("#navigation-principale .shell-nav__lien")?.focus();
    const surTouche = (e) => {
      if (e.key === "Escape") { setMenuOuvert(false); boutonMenu.current?.focus(); }
    };
    document.addEventListener("keydown", surTouche);
    return () => document.removeEventListener("keydown", surTouche);
  }, [menuOuvert]);

  function allerAuContenu(e) {
    e.preventDefault();
    principal.current?.focus();
  }

  return (
    <div className="shell">
      <a className="shell-evitement" href="#contenu" onClick={allerAuContenu}>Aller au contenu</a>

      <header className="shell-topbar">
        <button
          ref={boutonMenu} type="button" className="shell-icone-btn"
          aria-label="Ouvrir le menu" aria-expanded={menuOuvert} aria-controls="navigation-principale"
          onClick={() => setMenuOuvert(true)}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
            <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <span className="shell-topbar__nom">Vigie Qualiopi</span>
      </header>

      <Sidebar
        id="navigation-principale" user={user} ouvert={menuOuvert}
        onFermer={() => { setMenuOuvert(false); boutonMenu.current?.focus(); }}
        onLogout={onLogout}
      />
      {menuOuvert && <div className="shell-voile" aria-hidden="true" onClick={() => setMenuOuvert(false)} />}

      <main id="contenu" ref={principal} className="shell-principal" tabIndex={-1}>
        <div className="shell-contenu">
          {flash && <Alert ton={flash.type === "erreur" ? "error" : "success"}>{flash.texte}</Alert>}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
