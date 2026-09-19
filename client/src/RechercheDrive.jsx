import { useState } from "react";
import { api } from "./api.js";

// Recherche d'un fichier sur le Drive, par son nom, puis choix dans les
// résultats. Partagée par l'écran Preuves (rattacher ou ajouter une pièce)
// et l'écran Audits (rattacher un rapport) : une seule implémentation,
// un seul comportement.
//   candidats     — propositions déjà connues, affichées avant toute recherche
//   dejaRattaches — identifiants Drive à ne pas proposer deux fois
//   surChoix      — appelé avec le fichier retenu
//   onErreur      — remonte l'échec de la recherche à l'écran appelant
export function RechercheDrive({ candidats = [], dejaRattaches = [], surChoix, onErreur, placeholder }) {
  const [q, setQ] = useState("");
  const [trouves, setTrouves] = useState(null);
  const [cherche, setCherche] = useState(false);

  async function rechercher(e) {
    e.preventDefault();
    if (q.trim().length < 3) return;
    setCherche(true);
    try {
      const r = await api("/api/drive/recherche?q=" + encodeURIComponent(q.trim()));
      setTrouves(r.fichiers);
    } catch (err) {
      setTrouves([]);
      onErreur?.(err.message);
    } finally {
      setCherche(false);
    }
  }

  const dejaRattache = new Set(dejaRattaches);

  return (
    <div className="rattachement">
      {candidats.length > 0 && (
        <div className="candidats">
          <span className="muted small">Proposés :</span>
          {candidats.map((c) => (
            <button key={c.id} className="btn petit" onClick={() => surChoix(c)} title={c.chemin}>
              {c.nom.slice(0, 48)} <span className="muted">· {c.score}%</span>
            </button>
          ))}
        </div>
      )}
      <form className="recherche-drive" onSubmit={rechercher}>
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder || "Chercher un autre fichier sur le Drive"} aria-label="Chercher sur le Drive"
        />
        <button className="btn petit" disabled={cherche || q.trim().length < 3}>{cherche ? "…" : "Chercher"}</button>
      </form>
      {trouves && (
        trouves.length
          ? <div className="candidats">{trouves.map((f) => (
              <button key={f.id} className="btn petit" onClick={() => surChoix(f)} disabled={dejaRattache.has(f.id)}>
                {f.nom.slice(0, 48)}{dejaRattache.has(f.id) ? " · déjà rattaché" : ""}
              </button>
            ))}</div>
          : <p className="muted small">Aucun fichier trouvé.</p>
      )}
    </div>
  );
}
