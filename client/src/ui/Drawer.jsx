import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useDialogue } from "./dialogue.js";

// Panneau latéral (création / édition sans quitter la page). Plein écran
// sous 768 px. `pied` : actions fixes en bas (Annuler / Enregistrer).
// `fermable` à false pendant une opération en cours (Échap, voile et croix
// sont alors sans effet).
export function Drawer({ ouvert, titre, description, onFermer, pied, taille = "moyen", fermable = true, children }) {
  const ref = useRef(null);
  const idTitre = useId();
  const idDescription = useId();
  useDialogue(ref, ouvert, { onFermer, fermable, focusInitial: ".ui-drawer__corps input, .ui-drawer__corps select, .ui-drawer__corps textarea, .ui-drawer__corps button" });
  if (!ouvert) return null;
  return createPortal(
    <div className="ui-drawer-racine">
      <div className="ui-drawer-voile" aria-hidden="true" onClick={() => fermable && onFermer?.()} />
      <div
        ref={ref} role="dialog" aria-modal="true" aria-labelledby={idTitre}
        aria-describedby={description ? idDescription : undefined}
        className={`ui-drawer ui-drawer--${taille}`} tabIndex={-1}
      >
        <header className="ui-drawer__tete">
          <div>
            <h2 id={idTitre} className="ui-drawer__titre">{titre}</h2>
            {description && <p id={idDescription} className="ui-drawer__description">{description}</p>}
          </div>
          <button type="button" className="ui-icone-btn" aria-label="Fermer le panneau" onClick={onFermer} disabled={!fermable}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="ui-drawer__corps">{children}</div>
        {pied && <footer className="ui-drawer__pied">{pied}</footer>}
      </div>
    </div>,
    document.body
  );
}
