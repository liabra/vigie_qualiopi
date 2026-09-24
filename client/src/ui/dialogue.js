import { useEffect, useRef } from "react";

// Comportement commun des dialogues (Drawer, ConfirmDialog) :
//   · focus initial dans le dialogue, rendu au déclencheur à la fermeture ;
//   · Échap ferme, Tab reste piégé dans le dialogue ;
//   · une PILE : seul le dialogue du dessus réagit (une confirmation
//     ouverte depuis un tiroir se ferme seule avec Échap) ;
//   · défilement de la page bloqué tant qu'un dialogue est ouvert.
const pile = [];
const FOCUSABLES = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogue(ref, ouvert, { onFermer, fermable = true, focusInitial = null } = {}) {
  const dernier = useRef({ onFermer, fermable });
  dernier.current = { onFermer, fermable };

  useEffect(() => {
    if (!ouvert) return undefined;
    const noeud = ref.current;
    const jeton = {};
    pile.push(jeton);
    const declencheur = document.activeElement;
    const focusables = () => [...noeud.querySelectorAll(FOCUSABLES)].filter((e) => !e.closest("[hidden]"));
    const cible = (focusInitial && noeud.querySelector(focusInitial)) || focusables()[0] || noeud;
    cible.focus();
    const avant = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function surTouche(e) {
      if (pile[pile.length - 1] !== jeton) return;
      if (e.key === "Escape" && dernier.current.fermable) {
        e.preventDefault();
        dernier.current.onFermer?.();
      } else if (e.key === "Tab") {
        const liste = focusables();
        if (!liste.length) { e.preventDefault(); return; }
        const premier = liste[0];
        const final = liste[liste.length - 1];
        if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); final.focus(); }
        else if (!e.shiftKey && document.activeElement === final) { e.preventDefault(); premier.focus(); }
      }
    }
    document.addEventListener("keydown", surTouche);
    return () => {
      document.removeEventListener("keydown", surTouche);
      pile.splice(pile.indexOf(jeton), 1);
      if (!pile.length) document.body.style.overflow = avant;
      if (declencheur && document.contains(declencheur)) declencheur.focus();
    };
  }, [ouvert]); // eslint-disable-line react-hooks/exhaustive-deps
}
