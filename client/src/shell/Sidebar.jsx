import { Link, NavLink } from "react-router-dom";
import { navigationPour } from "../navigation.js";
import { Badge } from "../ui/index.js";

// Barre latérale : marque, groupes de navigation filtrés par rôle, compte.
// L'entrée active est signalée par aria-current="page" (posé par NavLink),
// un filet à gauche et une graisse plus forte — pas par la couleur seule.
export function Sidebar({ id, user, ouvert, onFermer, onLogout }) {
  const admin = user.role === "admin";
  const groupes = navigationPour(user.role);
  return (
    <div id={id} className={"shell-sidebar" + (ouvert ? " shell-sidebar--ouvert" : "")}>
      <div className="shell-sidebar__tete">
        <Link to="/accueil" className="shell-logo">
          <span className="shell-logo__marque" aria-hidden="true">V</span>
          <span>Vigie <span className="shell-logo__suite">Qualiopi</span></span>
        </Link>
        <button type="button" className="shell-icone-btn shell-sidebar__fermer" aria-label="Fermer le menu" onClick={onFermer}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <nav className="shell-nav" aria-label="Navigation principale">
        {groupes.map((g) => (
          <div key={g.id} className="shell-nav__groupe">
            {g.titre && <p className="shell-nav__titre" id={`nav-${g.id}`}>{g.titre}</p>}
            <ul aria-labelledby={g.titre ? `nav-${g.id}` : undefined}>
              {g.entrees.map((e) => (
                <li key={e.to}>
                  <NavLink to={e.to} className={({ isActive }) => "shell-nav__lien" + (isActive ? " shell-nav__lien--actif" : "")}>
                    {e.libelle}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shell-sidebar__pied">
        <p className="shell-compte__nom">{user.nom || user.email}</p>
        <Badge ton={admin ? "info" : "neutral"}>{admin ? "Administrateur" : "Contributeur"}</Badge>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--compact shell-deconnexion" onClick={onLogout}>
          Déconnexion
        </button>
      </div>
    </div>
  );
}
