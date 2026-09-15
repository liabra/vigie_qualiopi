import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

const TOUTES_CATEGORIES = ["OF", "CFA", "CBC", "VAE"];
const TITRES = { OF: "Organisme de formation", CFA: "Centre de formation d'apprentis", CBC: "Bilan de compétences", VAE: "Validation des acquis de l'expérience" };

export default function Referentiel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(() => new Set([1]));
  const [q, setQ] = useState("");

  useEffect(() => {
    api("/api/referentiel").then(setData).catch((e) => setErr(e.message));
  }, []);

  const criteres = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return data.criteres;
    return data.criteres
      .map((c) => ({
        ...c,
        indicateurs: c.indicateurs.filter(
          (i) => String(i.numero) === needle || i.libelle.toLowerCase().includes(needle)
        ),
      }))
      .filter((c) => c.indicateurs.length);
  }, [data, q]);

  if (err) return <p className="flash erreur">Référentiel : {err}</p>;
  if (!data) return <p className="muted">Chargement du référentiel…</p>;

  const toggle = (n) => setOpen((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });
  const nonVerifies = data.criteres.flatMap((c) => c.indicateurs).filter((i) => !i.texte_source_verifie).length;
  const filtering = q.trim() !== "";

  return (
    <section>
      <div className="ref-head">
        <div>
          <h1>Référentiel {data.version.code}</h1>
          <p className="muted">
            {data.version.source && <>{data.version.source} · </>}
            {data.criteres.length} critères · {data.totalIndicateurs} indicateurs
            {data.totalIndicateurs !== 32 && <span className="text-erreur"> · 32 attendus</span>}
          </p>
        </div>
        <input
          className="search" type="search" placeholder="Rechercher (n° ou mot-clé)"
          value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un indicateur"
        />
      </div>
      {data.version.note && <p className="flash info">{data.version.note}</p>}
      {nonVerifies > 0 && (
        <p className="flash info">
          {nonVerifies} libellé(s) provisoire(s), non confronté(s) au guide de lecture officiel.
        </p>
      )}
      {criteres.length === 0 && <p className="muted">Aucun indicateur ne correspond.</p>}
      {criteres.map((c) => {
        const isOpen = filtering || open.has(c.numero);
        return (
          <article key={c.id} className="card critere">
            <button className="critere-head" onClick={() => toggle(c.numero)} aria-expanded={isOpen}>
              <span className="num">Critère {c.numero}</span>
              <span className="critere-libelle">{c.libelle}</span>
              <span className="count">{c.indicateurs.length}</span>
            </button>
            {isOpen && (
              <ol className="indicateurs">
                {c.indicateurs.map((i) => (
                  <li key={i.id}>
                    <span className="ind-num">{i.numero}</span>
                    <div>
                      <p>{i.libelle}</p>
                      <div className="tags">
                        {i.type === "specifique" && <span className="pill spec">Spécifique</span>}
                        {TOUTES_CATEGORIES.every((c) => i.categories.includes(c))
                          ? <span className="pill">Toutes catégories</span>
                          : i.categories.map((c) => <span key={c} className="pill" title={TITRES[c]}>{c}</span>)}
                        {i.gradation === "majeure_uniquement" && <span className="pill off">NC majeure uniquement</span>}
                        {!i.texte_source_verifie && <span className="pill warn">Provisoire</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </article>
        );
      })}
    </section>
  );
}
