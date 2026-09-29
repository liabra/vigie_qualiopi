import { useEffect, useId, useRef, useState } from "react";
import { notion } from "./contenu.js";

// Petit « ? » contextuel : un clic ou le focus affiche une courte explication
// d'une notion métier. Ne jamais en poser un à côté de chaque champ — réservé
// aux notions qui le méritent vraiment (non applicable, échéance, rupture…).
export function AideInfobulle({ id }) {
  const n = notion(id);
  const [ouvert, setOuvert] = useState(false);
  const bouton = useRef(null);
  const idPopup = useId();
  if (!n) return null;

  useEffect(() => {
    if (!ouvert) return undefined;
    const surTouche = (e) => { if (e.key === "Escape") { setOuvert(false); bouton.current?.focus(); } };
    const dehors = (e) => { if (bouton.current && !bouton.current.contains(e.target)) setOuvert(false); };
    document.addEventListener("keydown", surTouche);
    document.addEventListener("mousedown", dehors);
    return () => {
      document.removeEventListener("keydown", surTouche);
      document.removeEventListener("mousedown", dehors);
    };
  }, [ouvert]);

  return (
    <span className="aide-info">
      <button
        ref={bouton} type="button" className="aide-info__btn"
        aria-label={`Aide sur « ${n.libelle} »`} aria-expanded={ouvert} aria-controls={idPopup}
        onClick={() => setOuvert((o) => !o)}
      >
        <span aria-hidden="true">?</span>
      </button>
      {ouvert && (
        <span id={idPopup} role="tooltip" className="aide-info__popover">
          <strong>{n.libelle}</strong>
          <span>{n.texte}</span>
        </span>
      )}
    </span>
  );
}
