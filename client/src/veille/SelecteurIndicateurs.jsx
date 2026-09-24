import { useId, useState } from "react";
import { groupesIndicateurs } from "./format.js";

// Sélection d'indicateurs à cocher, groupés PAR CRITÈRE (remplace le
// <select multiple> natif, Ctrl+clic). Recherche, compteur, puces
// retirables, groupes repliables dans une zone de hauteur bornée.
// Valeur : liste d'identifiants d'indicateurs (inchangée pour l'API).
export function SelecteurIndicateurs({ criteres, valeur, onChange, dejaLies = [], label = "Indicateurs Qualiopi concernés" }) {
  const id = useId();
  const [recherche, setRecherche] = useState("");
  const [ouverts, setOuverts] = useState(() => new Set());
  const choisis = new Set(valeur.map(Number));
  const groupes = groupesIndicateurs(criteres, recherche, dejaLies);
  const tous = [...(criteres || []).flatMap((c) => c.indicateurs || []), ...dejaLies];
  const selection = [...choisis].map((n) => tous.find((i) => i.id === n)).filter(Boolean).sort((a, b) => a.numero - b.numero);
  const filtrant = recherche.trim() !== "";

  const basculer = (indId) => {
    const n = new Set(choisis);
    n.has(indId) ? n.delete(indId) : n.add(indId);
    onChange([...n]);
  };
  const basculerGroupe = (gid) => setOuverts((o) => { const n = new Set(o); n.has(gid) ? n.delete(gid) : n.add(gid); return n; });

  return (
    <div className="indic-selecteur" role="group" aria-labelledby={`${id}-titre`}>
      <div className="indic-selecteur__tete">
        <p id={`${id}-titre`} className="ui-field__label">{label}</p>
        <p className="indic-selecteur__compteur" aria-live="polite">
          {selection.length === 0 ? "Aucun indicateur sélectionné" : `${selection.length} indicateur(s) sélectionné(s)`}
        </p>
      </div>

      {selection.length > 0 && (
        <div className="indic-selecteur__puces">
          <ul aria-label="Indicateurs sélectionnés">
            {selection.map((i) => (
              <li key={i.id}>
                <button type="button" className="indic-puce" onClick={() => basculer(i.id)} aria-label={`Retirer l'indicateur ${i.numero}`}>
                  {i.numero}<span aria-hidden="true"> ×</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--compact" onClick={() => onChange([])}>Tout désélectionner</button>
        </div>
      )}

      <div className="ui-field">
        <label htmlFor={`${id}-recherche`} className="visually-hidden">Rechercher un indicateur</label>
        <input id={`${id}-recherche`} type="search" value={recherche} placeholder="Rechercher un indicateur (numéro ou mot-clé)"
          onChange={(e) => setRecherche(e.target.value)} />
      </div>

      <div className="indic-selecteur__zone">
        {groupes.length === 0 && <p className="sess-secondaire indic-selecteur__vide">Aucun indicateur ne correspond à « {recherche} ».</p>}
        {groupes.map((g) => {
          // Pendant une recherche, tous les groupes trouvés sont dépliés.
          const ouvert = filtrant || ouverts.has(g.id);
          const nbChoisis = g.indicateurs.filter((i) => choisis.has(i.id)).length;
          const idListe = `${id}-${g.id}`;
          return (
            <fieldset key={g.id} className="indic-groupe">
              <legend className="visually-hidden">{g.titre} — {g.sousTitre}</legend>
              <button type="button" className="indic-groupe__tete" aria-expanded={ouvert} aria-controls={idListe} onClick={() => basculerGroupe(g.id)}>
                <span className="indic-groupe__chevron" aria-hidden="true">{ouvert ? "▾" : "▸"}</span>
                <span className="indic-groupe__titre">{g.titre}</span>
                <span className="indic-groupe__sous">{g.sousTitre}</span>
                {nbChoisis > 0 && <span className="indic-groupe__compte">{nbChoisis} choisi(s)</span>}
              </button>
              {ouvert && (
                <ul id={idListe} className="indic-groupe__liste">
                  {g.indicateurs.map((i) => (
                    <li key={i.id}>
                      <label className="ui-case indic-case">
                        <input type="checkbox" checked={choisis.has(i.id)} onChange={() => basculer(i.id)} />
                        <span><strong>Indicateur {i.numero}</strong> — {i.libelle}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
