// Chargement : message annoncé poliment aux lecteurs d'écran. `plein`
// occupe tout l'écran (démarrage de l'application).
export function LoadingState({ texte = "Chargement…", plein = false }) {
  return (
    <div className={"ui-loading" + (plein ? " ui-loading--plein" : "")} role="status" aria-live="polite">
      <span className="ui-loading__barre" aria-hidden="true" />
      <span>{texte}</span>
    </div>
  );
}
