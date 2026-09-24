// Bandeau d'information contextuel. Tons : info, success, warning, error.
// Une erreur est annoncée aux lecteurs d'écran (role="alert") ; les autres
// tons restent polis (role="status").
const ICONES = { info: "i", success: "✓", warning: "!", error: "!" };

export function Alert({ ton = "info", titre, children, action }) {
  return (
    <div className={`ui-alert ui-alert--${ton}`} role={ton === "error" ? "alert" : "status"}>
      <span className="ui-alert__icone" aria-hidden="true">{ICONES[ton]}</span>
      <div className="ui-alert__corps">
        {titre && <p className="ui-alert__titre">{titre}</p>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className="ui-alert__action">{action}</div>}
    </div>
  );
}
