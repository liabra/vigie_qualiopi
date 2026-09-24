import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

// Texte de recherche synchronisé avec un paramètre d'URL (?q=…).
// La valeur affichée vit dans un état LOCAL, mis à jour immédiatement :
// React Router applique la mise à jour de l'URL de façon différée, et un
// champ contrôlé directement par l'URL perd des caractères lors d'une saisie
// rapide (constaté en navigateur réel). L'URL suit, avec les paramètres
// les plus récents ; un changement d'URL externe (précédent, « Effacer les
// filtres ») resynchronise le champ.
export function useTexteUrl(cle) {
  const [params, setParams] = useSearchParams();
  const depuisUrl = params.get(cle) || "";
  const [valeur, setValeur] = useState(depuisUrl);
  const dernier = useRef(depuisUrl);

  useEffect(() => {
    if (depuisUrl !== dernier.current) { dernier.current = depuisUrl; setValeur(depuisUrl); }
  }, [depuisUrl]);

  function changer(v) {
    setValeur(v);
    dernier.current = v;
    setParams((courants) => {
      const p = new URLSearchParams(courants);
      if (v) p.set(cle, v); else p.delete(cle);
      return p;
    }, { replace: true });
  }
  return [valeur, changer];
}
