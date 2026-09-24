import { Link } from "react-router-dom";

// Bouton du design system. Variantes : primary (une seule par zone),
// secondary, ghost, danger. Avec `to`, rend un lien de navigation interne
// (même apparence) : on navigue avec un lien, on agit avec un bouton.
export function Button({ variante = "secondary", compact = false, to, className = "", type = "button", children, ...props }) {
  const classes = ["ui-btn", `ui-btn--${variante}`, compact ? "ui-btn--compact" : "", className].filter(Boolean).join(" ");
  if (to) return <Link to={to} className={classes} {...props}>{children}</Link>;
  return <button type={type} className={classes} {...props}>{children}</button>;
}
