import { Link } from "react-router-dom";

// En-tête de page : fil d'Ariane (contexte), titre, description, actions.
// Sans `titre`, seul le fil d'Ariane est rendu : c'est le cas des écrans
// existants qui portent encore leur propre titre (UX-1A).
export function PageHeader({ fil = [], titre, description, actions }) {
  return (
    <header className={"ui-page-header" + (titre ? "" : " ui-page-header--contexte")}>
      {fil.length > 0 && (
        <nav aria-label="Fil d'Ariane" className="ui-fil">
          <ol>
            {fil.map((etape, i) => (
              <li key={i}>
                {etape.to && i < fil.length - 1
                  ? <Link to={etape.to}>{etape.libelle}</Link>
                  : <span aria-current={i === fil.length - 1 ? "page" : undefined}>{etape.libelle}</span>}
              </li>
            ))}
          </ol>
        </nav>
      )}
      {titre && (
        <div className="ui-page-header__ligne">
          <div>
            <h1 className="ui-page-header__titre">{titre}</h1>
            {description && <p className="ui-page-header__description">{description}</p>}
          </div>
          {actions && <div className="ui-page-header__actions">{actions}</div>}
        </div>
      )}
    </header>
  );
}
