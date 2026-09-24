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

// `rafraichir` change quand une preuve a été modifiée ailleurs : le
// tableau de bord relit ses données, sans jamais être remonté — les
// critères dépliés et la position de défilement restent en place.
// `vue` / `surVue` : vue pilotée par l'URL (/indicateurs,
// /indicateurs/non-applicables, /versions). Sans eux, état local.
export default function Referentiel({ admin, rafraichir = 0, vue: vueImposee, surVue }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(() => new Set([1]));
  const [q, setQ] = useState("");
  // Marquage en cours, pour désactiver le bouton le temps de la réponse
  // et ne jamais envoyer deux fois la même bascule.
  const [enCours, setEnCours] = useState(null);
  // Écran séparé listant les indicateurs marqués non applicables : ils
  // n'apparaissent plus dans le référentiel courant, seul cet écran
  // permet de les retrouver pour les réactiver.
  const [vueLocale, setVueLocale] = useState("referentiel");
  const vue = vueImposee ?? vueLocale;
  const setVue = surVue ?? setVueLocale;
  // Gestion des VERSIONS du référentiel (admin) : coexistence de plusieurs
  // versions, activation explicite, préparation d'une future coquille.
  const [versions, setVersions] = useState(null);
  const [versionErr, setVersionErr] = useState(null);
  const [nouvelle, setNouvelle] = useState(null);

  useEffect(() => {
    api("/api/referentiel").then(setData).catch((e) => setErr(e.message));
  }, [rafraichir]);

  // Les versions se chargent à l'arrivée sur leur vue — y compris par un
  // lien direct ou un rechargement de /versions.
  useEffect(() => {
    if (vue === "versions") chargerVersions();
    else setVersions(null);
  }, [vue]); // eslint-disable-line react-hooks/exhaustive-deps

  async function chargerVersions() {
    try {
      setVersions(await api("/api/referentiel/versions"));
      setVersionErr(null);
    } catch (e) {
      setVersionErr(e.message);
    }
  }

  async function activerVersion(id) {
    setVersionErr(null);
    try {
      const r = await api(`/api/referentiel/versions/${id}/activer`, { method: "POST" });
      setVersions(await api("/api/referentiel/versions"));
      if (r.avertissement) setVersionErr(r.avertissement);
      setData(await api("/api/referentiel"));
    } catch (e) {
      setVersionErr(e.message);
    }
  }

  async function creerVersion() {
    if (!nouvelle?.code?.trim() || !nouvelle?.libelle?.trim()) {
      return setVersionErr("Code et libellé sont obligatoires.");
    }
    setVersionErr(null);
    try {
      await api("/api/referentiel/versions", { method: "POST", body: JSON.stringify(nouvelle) });
      setNouvelle(null);
      setVersions(await api("/api/referentiel/versions"));
    } catch (e) {
      setVersionErr(e.message);
    }
  }

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
      // On remplace les données en place : les critères dépliés, la
      // recherche en cours et le défilement ne bougent pas.
      setData(await api("/api/referentiel"));
    } catch (e) {
      setErr(e.message);
    } finally {
      setEnCours(null);
    }
  }

  // Indicateurs réellement utilisés par la structure. Un critère dont
  // tous les indicateurs sont marqués non applicables disparaît aussi.
  const criteresApplicables = useMemo(() => {
    if (!data) return [];
    return data.criteres
      .map((c) => ({ ...c, indicateurs: c.indicateurs.filter((i) => !i.non_applicable_force) }))
      .filter((c) => c.indicateurs.length > 0);
  }, [data]);

  const criteres = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return criteresApplicables;
    return criteresApplicables
      .map((c) => ({
        ...c,
        indicateurs: c.indicateurs.filter(
          (i) => String(i.numero) === needle || i.libelle.toLowerCase().includes(needle)
        ),
      }))
      .filter((c) => c.indicateurs.length);
  }, [criteresApplicables, q]);

  // Tous critères confondus, pour l'écran dédié aux non applicables.
  const nonApplicables = useMemo(() => {
    if (!data) return [];
    return data.criteres.flatMap((c) =>
      c.indicateurs.filter((i) => i.non_applicable_force).map((i) => ({ ...i, critereNumero: c.numero }))
    );
  }, [data]);

  // Une erreur avant tout chargement efface l'écran ; une fois le tableau
  // de bord affiché, une erreur d'action (ex. bascule non applicable) ne
  // doit pas faire disparaître tout ce qui fonctionne déjà.
  if (err && !data) return <p className="flash erreur">Référentiel : {err}</p>;
  if (!data) return <p className="muted">Chargement du référentiel…</p>;

  const toggle = (n) => setOpen((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });
  const nonVerifies = criteresApplicables.flatMap((c) => c.indicateurs).filter((i) => !i.texte_source_verifie).length;
  const filtering = q.trim() !== "";

  if (vue === "non_applicables") {
    return (
      <section>
        <div className="ref-head">
          <div>
            <h1>Indicateurs non applicables</h1>
            <p className="muted">{nonApplicables.length} indicateur(s) écarté(s) du référentiel courant</p>
          </div>
          <button className="btn petit" onClick={() => setVue("referentiel")}>← Retour au référentiel</button>
        </div>
        {err && <p className="flash erreur">{err}</p>}
        {nonApplicables.length === 0
          ? <p className="muted">Aucun indicateur marqué non applicable.</p>
          : (
            <ol className="indicateurs">
              {nonApplicables.map((i) => (
                <li key={i.id}>
                  <span className="ind-num statut-non_applicable" title="Non applicable">{i.numero}</span>
                  <div>
                    <p>{i.libelle}</p>
                    <div className="tags">
                      <span className="pill">Critère {i.critereNumero}</span>
                      {i.non_applicable_motif && <span className="pill">{i.non_applicable_motif}</span>}
                    </div>
                  </div>
                  {admin && (
                    <button
                      className="btn petit" onClick={() => basculerNonApplicable(i)} disabled={enCours === i.id}
                    >
                      {enCours === i.id ? "…" : "Réactiver"}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
      </section>
    );
  }

  if (vue === "versions") {
    return (
      <section>
        <div className="ref-head">
          <div>
            <h1>Versions du référentiel</h1>
            <p className="muted">Plusieurs versions coexistent : une active, des futures, des historiques.</p>
          </div>
          <button className="btn petit" onClick={() => setVue("referentiel")}>← Retour au référentiel</button>
        </div>
        {versionErr && <p className="flash erreur">{versionErr}</p>}
        {!versions && <p className="muted">Chargement des versions…</p>}
        {versions && (
          <ol className="indicateurs">
            {versions.versions.map((v) => (
              <li key={v.id}>
                <span className={"ind-num " + (v.type === "active" ? "statut-maitrise" : v.type === "future" ? "statut-a_consolider" : "statut-a_risque")}>
                  {v.type === "active" ? "A" : v.type === "future" ? "F" : "H"}
                </span>
                <div>
                  <p><strong>{v.code}</strong> — {v.libelle}</p>
                  <div className="tags">
                    <span className="pill">{v.type}</span>
                    {v.date_application && <span className="pill">Application : {String(v.date_application).slice(0, 10)}</span>}
                    {v.note && <span className="pill">{v.note}</span>}
                  </div>
                </div>
                {admin && !v.est_active && (
                  <button className="btn petit" onClick={() => activerVersion(v.id)}>Activer</button>
                )}
              </li>
            ))}
          </ol>
        )}
        {admin && !nouvelle && (
          <button className="btn" onClick={() => setNouvelle({ code: "", libelle: "", date_publication: "", date_application: "", source: "", note: "" })}>
            Préparer une nouvelle version
          </button>
        )}
        {admin && nouvelle && (
          <article className="card formulaire">
            <h2>Nouvelle version (coquille)</h2>
            <p className="muted small">Seules les métadonnées sont créées ici : le contenu officiel des critères et indicateurs viendra d'un import ultérieur.</p>
            <label>Code
              <input value={nouvelle.code} onChange={(e) => setNouvelle({ ...nouvelle, code: e.target.value })} placeholder="V10" />
            </label>
            <label>Libellé
              <input value={nouvelle.libelle} onChange={(e) => setNouvelle({ ...nouvelle, libelle: e.target.value })} />
            </label>
            <label>Date de publication
              <input type="date" value={nouvelle.date_publication} onChange={(e) => setNouvelle({ ...nouvelle, date_publication: e.target.value })} />
            </label>
            <label>Date d'application
              <input type="date" value={nouvelle.date_application} onChange={(e) => setNouvelle({ ...nouvelle, date_application: e.target.value })} />
            </label>
            <label>Source
              <input value={nouvelle.source} onChange={(e) => setNouvelle({ ...nouvelle, source: e.target.value })} />
            </label>
            <label>Note
              <input value={nouvelle.note} onChange={(e) => setNouvelle({ ...nouvelle, note: e.target.value })} />
            </label>
            <div className="actions">
              <button className="btn" onClick={creerVersion}>Créer</button>
              <button className="link" onClick={() => setNouvelle(null)}>Annuler</button>
            </div>
          </article>
        )}
      </section>
    );
  }

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
        {admin && (
          <button className="btn petit" onClick={() => setVue("versions")}>
            Versions
          </button>
        )}
      </div>
      <div className="score">
        <div className="score-chiffre">
          <strong>{data.score.maitrise}</strong> indicateur(s) au vert sur {data.score.total - data.score.non_applicable}
        </div>
        <div className="jauge" role="img" aria-label={resumeScore(data.score)}>
          {["maitrise", "a_consolider", "a_risque"].map((s) =>
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
          {data.score.non_applicable > 0 && (
            <> · <button className="btn petit" onClick={() => setVue("non_applicables")}>
              {data.score.non_applicable} non applicable(s)
            </button></>
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
                      </div>
                    </div>
                    {admin && (
                      <button
                        className="btn petit non-applicable"
                        onClick={() => basculerNonApplicable(i)}
                        disabled={enCours === i.id}
                      >
                        {enCours === i.id ? "…" : "Marquer non applicable"}
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