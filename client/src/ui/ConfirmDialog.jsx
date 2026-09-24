import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useDialogue } from "./dialogue.js";
import { Button } from "./Button.jsx";

// Confirmation (remplace window.confirm). Le focus initial va sur
// « Annuler » : une action destructive ne se valide jamais par un simple
// Entrée réflexe.
export function ConfirmDialog({ ouvert, titre, children, libelleConfirmer, ton = "danger", enCours = false, onConfirmer, onAnnuler }) {
  const ref = useRef(null);
  const idTitre = useId();
  const idTexte = useId();
  useDialogue(ref, ouvert, { onFermer: onAnnuler, fermable: !enCours, focusInitial: "[data-annuler]" });
  if (!ouvert) return null;
  return createPortal(
    <div className="ui-modale-racine">
      <div className="ui-drawer-voile" aria-hidden="true" />
      <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby={idTitre} aria-describedby={idTexte} className="ui-modale" tabIndex={-1}>
        <h2 id={idTitre} className="ui-modale__titre">{titre}</h2>
        <div id={idTexte} className="ui-modale__texte">{children}</div>
        <div className="ui-modale__actions">
          <Button data-annuler onClick={onAnnuler} disabled={enCours}>Annuler</Button>
          <Button variante={ton === "danger" ? "danger" : "primary"} onClick={onConfirmer} disabled={enCours}>
            {enCours ? "En cours…" : libelleConfirmer}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
