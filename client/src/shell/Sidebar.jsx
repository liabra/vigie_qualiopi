import { Link, useLocation } from "react-router-dom";
import { espacesPour, positionDe } from "../navigation.js";
import { Badge } from "../ui/index.js";

// Icônes des espaces : traits simples, décoratives (le libellé est toujours écrit).
const TRACES = {
  aujourdhui: <><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>,
  formations: <><path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z" /><path d="M4 17a3 3 0 0 1 3-3h11" /></>,
  qualiopi: <><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  equipe: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14.5c2.4 0 4 1.6 4.5 4.5" /></>,
  reglages: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  audit: <><path d="M6 3h9l3 3v15H6z" /><path d="M9 12h6M9 16h6" /></>,
};
const Icone = ({ id }) => (
  <svg className="shell-nav__icone" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {TRACES[id]}
  </svg>
);

// Barre latérale : marque, 5 espaces filtrés par rôle, compte. L'espace actif
// est signalé par aria-current="page", un filet à gauche et une graisse plus
// forte — pas par la couleur seule.
export function Sidebar({ id, user, ouvert, onFermer, onLogout, onAide }) {
  const admin = user.role === "admin";
  const espaces = espacesPour(user.role);
  const { pathname } = useLocation();
  const actif = positionDe(pathname, user.role)?.espace.id;
  return (
    <div id={id} className={"shell-sidebar" + (ouvert ? " shell-sidebar--ouvert" : "")}>
      <div className="shell-sidebar__tete">
        <Link to={espaces[0]?.to || "/"} className="shell-logo">
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
        <ul>
          {espaces.map((e) => (
            <li key={e.id}>
              <Link to={e.to} aria-current={actif === e.id ? "page" : undefined}
                className={"shell-nav__lien shell-nav__lien--espace" + (actif === e.id ? " shell-nav__lien--actif" : "")}>
                <Icone id={e.id} />
                <span>{e.libelle}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="shell-sidebar__pied">
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--compact shell-aide" onClick={onAide}>
          <span aria-hidden="true">?</span>&nbsp; Aide
        </button>
        <p className="shell-compte__nom">{user.nom || user.email}</p>
        <Badge ton={admin ? "info" : "neutral"}>{admin ? "Administrateur" : user.role === "auditeur" ? "Auditeur (lecture seule)" : "Contributeur"}</Badge>
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--compact shell-deconnexion" onClick={onLogout}>
          Déconnexion
        </button>
      </div>
    </div>
  );
}
