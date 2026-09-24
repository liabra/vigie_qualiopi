// État vide ou « rien à afficher » : une phrase utile et, si possible,
// l'action qui permet d'en sortir. Jamais une zone blanche.
export function EmptyState({ titre, children, action }) {
  return (
    <div className="ui-empty">
      <p className="ui-empty__titre">{titre}</p>
      {children && <div className="ui-empty__texte">{children}</div>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}
