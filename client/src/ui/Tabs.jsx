import { NavLink } from "react-router-dom";

// Onglets de NAVIGATION : chaque onglet est une vraie URL (rafraîchissement,
// précédent/suivant, lien direct). Motif « navigation » plutôt que
// role="tablist" : ce sont des liens, atteints au clavier par Tab ;
// l'onglet courant porte aria-current="page". Défilement horizontal sur
// petit écran, sans défilement global de la page.
export function Tabs({ label, onglets }) {
  return (
    <nav className="ui-onglets" aria-label={label}>
      <ul>
        {onglets.map((o) => (
          <li key={o.to}>
            <NavLink end to={o.to} className={({ isActive }) => "ui-onglets__lien" + (isActive ? " ui-onglets__lien--actif" : "")}>
              {o.libelle}
              {o.compteur !== undefined && o.compteur !== null && (
                <span className="ui-onglets__compteur" aria-label={`(${o.compteur})`}>{o.compteur}</span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
