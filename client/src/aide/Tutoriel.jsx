import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, Drawer } from "../ui/index.js";
import { etapesTutoriel } from "./contenu.js";

// Tutoriel de démarrage : 5 à 7 étapes, quittable à tout moment (croix,
// Échap ou voile), jamais bloquant, relançable depuis l'aide. Le contenu
// respecte le rôle (jamais d'action admin expliquée à un contributeur).
// Chaque étape porte sa route : la page réelle défile DERRIÈRE le panneau
// (remplacement d'entrée d'historique : le parcours ne laisse pas 7 entrées).
export function Tutoriel({ role, onTerminer }) {
  const etapes = etapesTutoriel(role);
  const [index, setIndex] = useState(0);
  const etape = etapes[index];
  const derniere = index === etapes.length - 1;
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Suit l'étape courante sans fermer le panneau (même position dans
  // l'arbre React : l'index et le focus sont conservés).
  useEffect(() => {
    if (etape.route && pathname !== etape.route) navigate(etape.route, { replace: true });
  }, [etape.route]); // eslint-disable-line react-hooks/exhaustive-deps

  const suivant = () => { if (derniere) onTerminer(); else setIndex((i) => i + 1); };
  const precedent = () => setIndex((i) => Math.max(0, i - 1));

  return (
    <Drawer
      ouvert type="aide" onFermer={onTerminer}
      titre={`Découvrir Vigie (${index + 1}/${etapes.length})`}
      description={etape.titre}
      pied={
        <>
          <Button onClick={precedent} disabled={index === 0}>Précédent</Button>
          <Button variante="primary" onClick={suivant}>{derniere ? "Terminer" : "Suivant"}</Button>
        </>
      }
    >
      <p className="aide-tutoriel__texte">{etape.texte}</p>
      <ol className="aide-tutoriel__points" aria-label="Étapes du tutoriel">
        {etapes.map((e, i) => (
          <li
            key={e.id}
            className={i === index ? "aide-tutoriel__point aide-tutoriel__point--actif" : "aide-tutoriel__point"}
            aria-current={i === index ? "step" : undefined}
          >
            {e.titre}
          </li>
        ))}
      </ol>
    </Drawer>
  );
}
