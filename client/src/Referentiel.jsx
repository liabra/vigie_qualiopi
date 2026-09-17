import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";

const STATUTS = {
  maitrise: "Maîtrisé",
  a_consolider: "À consolider",
  a_risque: "À risque",
  non_applicable: "Non applicable",
};
const resumeScore = (s) =>
  Object.entries(STATUTS).map(([clef, libelle]) => s[clef] + " " + libelle).join(", ");
const TOUTES_CATEGORIES = ["OF", "CFA", "CBC", "VAE"];
const TITRES = { OF: "Organisme de formation", CFA: "Centre de formation d'apprentis", CBC: "Bilan de compétences", VAE: "Validation des acquis de l'expérience" };

export default function Referentiel({ admin, onChange }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(() => new Set([1]));
  const [q, setQ] = useState("");
  // Marquage en cours, pour désactiver le bouton le temps de la réponse
  // et ne jamais envoyer deux fois la même bascule.
  const [enCours, setEnCours] = useState(null);

  useEffect(() => {
    api("/api/referentiel").then(setData).catch((e) => setErr(e.message));
  }, []);

  // Marque ou réactive un indicateur, indépendamment de ses preuves. La
  // réactivation peut faire réapparaître n'importe quel statut selon les
  // preuves existantes : plutôt que de le deviner côté client, on relit
  // le tableau de bord une fois le serveur à jour.
  async function basculerNonApplicable(i) {
    if (enCours) return;
    setEnCours(i.id);
    try {
      await api(`/api/indicateurs/${i.id}/non-applicable`, {
        method: "PATCH",
        body: JSON.stringify({ non_applicable: !i.non_applicable_force }),
      });
      setData(await api("/api/referentiel"));
      onChange?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setEnCours(null);
    }
  }

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

  // Une erreur avant tout chargement efface l'écran ; une fois le tableau
  // de bord affiché, une erreur d'action (ex. bascule non applicable) ne
  // doit pas faire disparaître tout ce qui fonctionne déjà.
  if (err && !data) return <p className="flash erreur">Référentiel : {err}</p>;
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
      <div className="score">
        <div className="score-chiffre">
          <strong>{data.score.maitrise}</strong> indicateur(s) au vert sur {data.score.total}
        </div>
        <div className="jauge" role="img" aria-label={resumeScore(data.score)}>
          {["maitrise", "a_consolider", "a_risque", "non_applicable"].map((s) =>
            data.score[s] > 0 ? (
              <span key={s} className={"part statut-" + s} style={{ flexGrow: data.score[s] }}>
                {data.score[s]}
              </span>
            ) : null
          )}
        </div>
        <div className="muted small">
          {data.score.preuves} preuve(s) rattachée(s)
          {data.score.a_confirmer > 0 && (
            <span className="text-erreur"> · {data.score.a_confirmer} à confirmer</span>
          )}
        </div>
      </div>
      {err && <p className="flash erreur">{err}</p>}
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
              <span className="count">
                {c.indicateurs.filter((i) => i.statut === "maitrise").length}/{c.indicateurs.length}
              </span>
            </button>
            {isOpen && (
              <ol className="indicateurs">
                {c.indicateurs.map((i) => (
                  <li key={i.id}>
                    <span className={"ind-num statut-" + i.statut} title={STATUTS[i.statut]}>{i.numero}</span>
                    <div>
                      <p>{i.libelle}</p>
                      <div className="tags">
                        <span className={"pill statut-" + i.statut}>{STATUTS[i.statut]}</span>
                        <span className="pill">{i.nb_preuves} preuve(s)</span>
                        {i.nb_a_confirmer > 0 && <span className="pill warn">{i.nb_a_confirmer} à confirmer</span>}
                        {i.type === "specifique" && <span className="pill spec">Spécifique</span>}
                        {TOUTES_CATEGORIES.every((c) => i.categories.includes(c))
                          ? <span className="pill">Toutes catégories</span>
                          : i.categories.map((c) => <span key={c} className="pill" title={TITRES[c]}>{c}</span>)}
                        {i.gradation === "majeure_uniquement" && <span className="pill off">NC majeure uniquement</span>}
                        {!i.texte_source_verifie && <span className="pill warn">Provisoire</span>}
                        {i.non_applicable_force && <span className="pill">Marqué non applicable</span>}
                      </div>
                    </div>
                    {admin && (
                      <button
                        className={"btn petit" + (i.non_applicable_force ? "" : " non-applicable")}
                        onClick={() => basculerNonApplicable(i)}
                        disabled={enCours === i.id}
                      >
                        {enCours === i.id ? "…" : i.non_applicable_force ? "Réactiver" : "Marquer non applicable"}
                      </button>
                    )}
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
