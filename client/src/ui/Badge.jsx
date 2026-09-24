// Badge de STATUT : pastille + texte. La couleur n'est jamais le seul
// porteur d'information (le libellé est toujours présent).
// Tons : success, warning, error, info, neutral.
export function Badge({ ton = "neutral", children }) {
  return (
    <span className={`ui-badge ui-badge--${ton}`}>
      <span className="ui-badge__point" aria-hidden="true" />
      {children}
    </span>
  );
}
