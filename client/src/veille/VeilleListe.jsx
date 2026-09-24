import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, EmptyState, Field, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { useTexteUrl } from "../ui/useTexteUrl.js";
import {
  SEGMENTS, STATUTS_ACTION, STATUTS_VEILLE, TYPES_VEILLE,
  compterSegments, filtrerVeilles, formaterDate, indicateursCompacts, indicateursPresents,
} from "./format.js";

const MESSAGES_VIDES = {
  a_analyser: "Aucune veille à analyser",
  actions: "Aucune action à réaliser",
  traitees: "Aucune veille traitée",
  toutes: "Aucune entrée de veille",
};

// /veille : la LISTE. Segment et filtres vivent dans l'URL (?vue=…&type=…
// &ind=…&q=…) : précédent, rafraîchissement et lien direct les conservent.
// Filtrage client sur la liste complète déjà renvoyée par l'API.
export function VeilleListe({ admin }) {
  useTitrePage("Veille");
  const [params, setParams] = useSearchParams();
  const segment = SEGMENTS.some((s) => s.id === params.get("vue")) ? params.get("vue") : "toutes";
  const [q, setQ] = useTexteUrl("q");
  const filtres = { type: params.get("type") || "", indicateur: params.get("ind") || "", q };
  const [veilles, setVeilles] = useState(null);
  const [err, setErr] = useState(null);

  const charger = useCallback(async () => {
    try { setVeilles((await api("/api/veille")).veilles); setErr(null); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  // Forme fonctionnelle : part toujours des paramètres les plus récents
  // (une recherche en cours de synchronisation n'est jamais écrasée).
  function changer(cle, valeur) {
    setParams((courants) => {
      const p = new URLSearchParams(courants);
      if (valeur && !(cle === "vue" && valeur === "toutes")) p.set(cle, valeur); else p.delete(cle);
      return p;
    });
  }

  const affichees = veilles ? filtrerVeilles(veilles, { segment, ...filtres }) : [];
  const compteurs = veilles ? compterSegments(veilles) : {};
  const filtresActifs = filtres.type || filtres.indicateur || filtres.q;
  const nouvelle = admin && <Button variante="primary" to="/veille/nouvelle">+ Nouvelle veille</Button>;

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Qualité" }, { libelle: "Veille" }]}
        titre="Veille"
        description="Suivi réglementaire, pédagogique et qualité"
        actions={nouvelle}
      />
      {err && <Alert ton="error" titre="La veille n'a pas pu être chargée." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!veilles && !err && <LoadingState texte="Chargement de la veille…" />}

      {veilles && veilles.length === 0 && (
        <EmptyState titre="Aucune entrée de veille" action={nouvelle}>
          {admin ? "Consignez la première information réglementaire, métier ou pédagogique à suivre." : "Aucune information de veille n'a encore été consignée."}
        </EmptyState>
      )}

      {veilles && veilles.length > 0 && (
        <section className="veille-liste" aria-label="Liste de la veille">
          <div className="sess-vues" role="group" aria-label="Vues de la veille">
            {SEGMENTS.map((s) => (
              <button key={s.id} type="button" aria-pressed={segment === s.id}
                className={"sess-vue" + (segment === s.id ? " sess-vue--active" : "")} onClick={() => changer("vue", s.id)}>
                {s.libelle} <span className="sess-vue__compteur">{compteurs[s.id]}</span>
              </button>
            ))}
          </div>

          <div className="veille-filtres">
            <Field label="Rechercher" className="veille-filtres__recherche">
              <input type="search" value={filtres.q} placeholder="Titre, source ou résumé" onChange={(e) => setQ(e.target.value)} />
            </Field>
            <Field label="Type">
              <select value={filtres.type} onChange={(e) => changer("type", e.target.value)}>
                <option value="">Tous les types</option>
                {Object.entries(TYPES_VEILLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="Indicateur">
              <select value={filtres.indicateur} onChange={(e) => changer("ind", e.target.value)}>
                <option value="">Tous les indicateurs</option>
                {indicateursPresents(veilles).map((n) => <option key={n} value={n}>Indicateur {n}</option>)}
              </select>
            </Field>
          </div>

          {affichees.length === 0 ? (
            <EmptyState
              titre={filtresActifs ? "Aucune veille ne correspond à ces filtres." : MESSAGES_VIDES[segment]}
              action={filtresActifs
                ? <Button onClick={() => setParams(segment === "toutes" ? new URLSearchParams() : new URLSearchParams({ vue: segment }))}>Effacer les filtres</Button>
                : segment === "a_analyser" && nouvelle}
            />
          ) : (
            <table className="sess-table veille-table">
              <caption className="visually-hidden">Veille ({affichees.length})</caption>
              <thead>
                <tr>
                  <th scope="col">Veille</th>
                  <th scope="col">Type</th>
                  <th scope="col">Publiée le</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Action</th>
                  <th scope="col">Indicateurs</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {affichees.map((v) => {
                  const st = STATUTS_VEILLE[v.statut] || { libelle: v.statut, ton: "neutral" };
                  const ac = STATUTS_ACTION[v.statut_action] || { libelle: v.statut_action, ton: "neutral" };
                  const ind = indicateursCompacts(v.indicateurs);
                  return (
                    <tr key={v.id}>
                      <td data-label="Veille" className="sess-table__principal">
                        <Link to={`/veille/${v.id}`}>{v.titre}</Link>
                        {v.source && <span className="sess-secondaire">{v.source}</span>}
                        {v.rupture_reglementaire && <span className="veille-rupture">Rupture réglementaire</span>}
                      </td>
                      <td data-label="Type">{TYPES_VEILLE[v.type] || v.type}</td>
                      <td data-label="Publiée le">{formaterDate(v.date_publication) || "—"}</td>
                      <td data-label="Statut"><Badge ton={st.ton}>{st.libelle}</Badge></td>
                      <td data-label="Action">
                        {v.statut_action === "aucune" ? <span className="sess-secondaire">Aucune</span> : <Badge ton={ac.ton}>{ac.libelle}</Badge>}
                      </td>
                      <td data-label="Indicateurs">
                        {ind.tous.length === 0 ? <span className="sess-secondaire">—</span> : (
                          <span aria-label={`Indicateurs ${ind.tous.join(", ")}`} title={`Indicateurs ${ind.tous.join(", ")}`}>
                            Ind. {ind.visibles.join(", ")}{ind.reste > 0 && <span className="veille-reste"> +{ind.reste}</span>}
                          </span>
                        )}
                      </td>
                      <td className="sess-table__actions">
                        <Button compact to={`/veille/${v.id}`} aria-label={`Ouvrir la veille ${v.titre}`}>Ouvrir</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}
