import { Link, useLocation } from "react-router-dom";
import { positionDe } from "../navigation.js";

// Rubriques de l'espace courant, en onglets au-dessus de la page. Les
// rubriques secondaires sont rangées sous « Plus » (élément <details> natif :
// clavier et lecteurs d'écran sans script). Réglages n'a pas d'onglets : un
// lien ramène à la page des réglages.
export function SousNavigation({ role }) {
  const { pathname } = useLocation();
  const position = positionDe(pathname, role);
  if (!position) return null;
  const { espace, page } = position;

  if (espace.retour) {
    if (page.to === espace.to) return null;
    return (
      <nav className="shell-retour" aria-label={`Retour : ${espace.libelle}`}>
        <Link to={espace.to}><span aria-hidden="true">← </span>Tous les réglages</Link>
      </nav>
    );
  }

  const principales = espace.pages.filter((p) => !p.plus);
  const autres = espace.pages.filter((p) => p.plus);
  if (principales.length + autres.length <= 1) return null;
  const autreActive = autres.find((p) => p.to === page.to);
  const lien = (p) => (
    <Link to={p.to} aria-current={p.to === page.to ? "page" : undefined}
      className={"ui-onglets__lien" + (p.to === page.to ? " ui-onglets__lien--actif" : "")}>
      {p.libelle}
    </Link>
  );

  return (
    <div className="shell-sous-nav">
      <nav className="ui-onglets shell-sous-nav__onglets" aria-label={`Rubriques : ${espace.libelle}`}>
        <ul>{principales.map((p) => <li key={p.to}>{lien(p)}</li>)}</ul>
      </nav>
      {autres.length > 0 && (
        // key : le menu se referme à chaque changement de page.
        <details key={pathname} className="shell-plus">
          <summary className={"ui-onglets__lien" + (autreActive ? " ui-onglets__lien--actif" : "")}>
            {autreActive ? autreActive.libelle : "Plus"}<span aria-hidden="true"> ▾</span>
          </summary>
          <nav aria-label={`Autres rubriques : ${espace.libelle}`}>
            <ul className="shell-plus__liste">{autres.map((p) => <li key={p.to}>{lien(p)}</li>)}</ul>
          </nav>
        </details>
      )}
    </div>
  );
}
