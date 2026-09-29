import { useState } from "react";
import { Button, Drawer, Field } from "../ui/index.js";
import { aideDe, rechercherGuide } from "./contenu.js";

// Panneau « Aide Vigie » : ouvert depuis le bouton « ? Aide ». Trois accès,
// sans jamais quitter l'écran courant (simple Drawer réutilisé) :
//   · Aide de cette page (contenu adapté à la route) ;
//   · Découvrir Vigie (relance le tutoriel) ;
//   · Guide complet (consultable, avec recherche).
export function AideDrawer({ role, chemin, onFermer, onTutoriel }) {
  const [section, setSection] = useState("page");
  const [recherche, setRecherche] = useState("");
  const page = aideDe(chemin);
  const rubriques = rechercherGuide(role, recherche);

  return (
    <Drawer
      ouvert type="aide" onFermer={onFermer} titre="Aide Vigie"
      description="Une aide courte, au bon endroit, sans quitter la page."
    >
      <nav className="aide-entre" aria-label="Sections de l'aide">
        <button
          type="button" aria-pressed={section === "page"}
          className={"aide-entre__btn" + (section === "page" ? " aide-entre__btn--actif" : "")}
          onClick={() => setSection("page")}
        >
          Aide de cette page
        </button>
        <button type="button" className="aide-entre__btn" onClick={onTutoriel}>
          Découvrir Vigie
        </button>
        <button
          type="button" aria-pressed={section === "guide"}
          className={"aide-entre__btn" + (section === "guide" ? " aide-entre__btn--actif" : "")}
          onClick={() => setSection("guide")}
        >
          Guide complet
        </button>
      </nav>

      {section === "page" ? (
        <div className="aide-corps">
          {page ? (
            <>
              <h3 className="aide-corps__titre">{page.titre}</h3>
              {page.sections.map((s) => (
                <section key={s.titre} className="aide-section" aria-label={s.titre}>
                  <h4 className="aide-section__titre">{s.titre}</h4>
                  <ul className="aide-section__liste">
                    {s.lignes.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                </section>
              ))}
            </>
          ) : (
            <p className="sess-secondaire">Aucune aide spécifique pour cette page.</p>
          )}
        </div>
      ) : (
        <div className="aide-corps">
          <Field label="Rechercher dans le guide">
            <input
              type="search" value={recherche} placeholder="Ex. preuve, archivage, absence…"
              onChange={(e) => setRecherche(e.target.value)}
            />
          </Field>
          {rubriques.length === 0 ? (
            <p className="sess-secondaire">Aucune rubrique ne correspond à cette recherche.</p>
          ) : (
            rubriques.map((r) => (
              <section key={r.id} className="aide-section" aria-label={r.titre}>
                <h4 className="aide-section__titre">{r.titre}</h4>
                {r.sections.map((s) => (
                  <div key={s.titre} className="aide-guide-bloc">
                    <p className="aide-guide-bloc__titre">{s.titre}</p>
                    <ul className="aide-section__liste">
                      {s.lignes.map((l, i) => <li key={i}>{l}</li>)}
                    </ul>
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
      )}

      <div className="aide-pied">
        <Button compact onClick={onFermer}>Fermer</Button>
        <Button compact variante="primary" onClick={onTutoriel}>Découvrir Vigie</Button>
      </div>
    </Drawer>
  );
}
