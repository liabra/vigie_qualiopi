import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Button, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "./titre.js";
import { formaterDate } from "../pilotage/RegistrePage.jsx";

// Qualiopi (ADMIN) : les indicateurs, et pour celui choisi « ce qui est
// attendu / ce que vous avez / ce qui manque ». Lecture du référentiel actif
// et des preuves existantes : aucune donnée nouvelle, aucun calcul de statut
// côté écran (le statut vient du serveur, comme dans le référentiel détaillé).

const ETATS = {
  maitrise: { ton: "ok", libelle: "Maîtrisé" },
  a_consolider: { ton: "attention", libelle: "À consolider" },
  a_risque: { ton: "attention", libelle: "À compléter" },
  non_applicable: { ton: "neutre", libelle: "Non concerné" },
};
const etatDe = (i) => (i.non_applicable_force ? ETATS.non_applicable : ETATS[i.statut] || ETATS.a_risque);
const aCompleter = (i) => !i.non_applicable_force && i.statut !== "maitrise" && i.statut !== "non_applicable";
const pl = (n, s, p) => `${n} ${n > 1 ? p : s}`;

// Ce qui manque, déduit des preuves reçues du serveur. PUR.
export function manquesIndicateur(i, preuves) {
  if (i.non_applicable_force || i.statut === "non_applicable") return [];
  const m = [];
  if (!preuves.length) m.push("Aucune preuve enregistrée pour cet indicateur.");
  const perimees = preuves.filter((p) => p.alerte_statut === "perime").length;
  const aConfirmer = preuves.filter((p) => p.a_confirmer).length;
  const incompletes = preuves.filter((p) => p.incomplet).length;
  const aRisque = preuves.filter((p) => p.statut_effectif === "a_risque").length;
  const aConsolider = preuves.filter((p) => p.statut_effectif === "a_consolider").length;
  if (perimees) m.push(`${pl(perimees, "preuve périmée", "preuves périmées")} à renouveler.`);
  if (aConfirmer) m.push(`${pl(aConfirmer, "preuve", "preuves")} à confirmer.`);
  if (incompletes) m.push(`${pl(incompletes, "preuve", "preuves")} sans tous ses fichiers.`);
  if (aRisque) m.push(`${pl(aRisque, "preuve jugée", "preuves jugées")} « à risque ».`);
  if (aConsolider) m.push(`${pl(aConsolider, "preuve", "preuves")} à consolider.`);
  return m;
}

export function Qualiopi() {
  useTitrePage("Qualiopi");
  const [ref, setRef] = useState(null);
  const [err, setErr] = useState(null);
  const [params, setParams] = useSearchParams();
  const [seulementManques, setSeulementManques] = useState(false);
  const [preuves, setPreuves] = useState(null);
  const [errPreuves, setErrPreuves] = useState(null);

  const charger = useCallback(() => api("/api/referentiel").then((r) => { setRef(r); setErr(null); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { charger(); }, [charger]);

  const tous = ref ? ref.criteres.flatMap((c) => c.indicateurs.map((i) => ({ ...i, critere: c }))) : [];
  const numero = Number(params.get("indicateur"));
  const choisi = tous.find((i) => i.numero === numero) || tous.find(aCompleter) || tous[0] || null;
  const choisir = (n) => setParams({ indicateur: String(n) }, { replace: true });

  useEffect(() => {
    if (!choisi) return;
    setPreuves(null); setErrPreuves(null);
    api(`/api/preuves?indicateur=${choisi.numero}`).then((r) => setPreuves(r.preuves)).catch((e) => setErrPreuves(e.message));
  }, [choisi?.numero]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = ref?.score;
  const applicables = s ? s.total - s.non_applicable : 0;
  const nbManques = tous.filter(aCompleter).length;
  const manques = choisi && preuves ? manquesIndicateur(choisi, preuves) : [];

  return (
    <>
      <PageHeader titre="Qualiopi"
        description={s ? `${s.maitrise} indicateurs maîtrisés sur ${applicables}${s.non_applicable ? ` · ${s.non_applicable} non concernés` : ""}.` : undefined}
        actions={<>
          <a className="ui-btn ui-btn--secondary" href="/api/pdf/indicateurs" download>Tableau des preuves (PDF)</a>
          <Button variante="primary" to="/preparation-audit">Préparer l'audit</Button>
        </>} />
      {s && <span className="ajd-jauge qualiopi-jauge" aria-hidden="true"><span style={{ width: `${applicables ? Math.round((100 * s.maitrise) / applicables) : 0}%` }} /></span>}
      {err && <Alert ton="error" titre="Le référentiel n'a pas pu être chargé." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!ref && !err && <LoadingState texte="Chargement des indicateurs…" />}

      {ref && choisi && (
        <div className="qualiopi">
          <div className="qualiopi-liste">
            <label className="ui-case qualiopi-filtre">
              <input type="checkbox" checked={seulementManques} onChange={(e) => setSeulementManques(e.target.checked)} />
              <span>Afficher seulement ce qui reste à compléter ({nbManques})</span>
            </label>
            {ref.criteres.map((c) => {
              const liste = c.indicateurs.filter((i) => !seulementManques || aCompleter(i));
              if (!liste.length) return null;
              return (
                <section key={c.id} aria-labelledby={`critere-${c.id}`}>
                  <h2 id={`critere-${c.id}`} className="qualiopi-critere" title={c.libelle}><span className="qualiopi-critere__num">Critère {c.numero}</span> {c.libelle}</h2>
                  <ul className="qualiopi-indicateurs">
                    {liste.map((i) => {
                      const etat = etatDe(i);
                      const actif = i.numero === choisi.numero;
                      return (
                        <li key={i.id}>
                          <button type="button" aria-current={actif ? "true" : undefined} onClick={() => choisir(i.numero)}
                            className={"qualiopi-indicateur" + (actif ? " qualiopi-indicateur--actif" : "") + (etat === ETATS.non_applicable ? " qualiopi-indicateur--nc" : "")}>
                            <span className={`qualiopi-num qualiopi-num--${etat.ton}`} aria-hidden="true">{i.numero}</span>
                            <span className="qualiopi-indicateur__libelle"><span className="sr-only">Indicateur {i.numero} : </span>{i.libelle}</span>
                            <span className={`vq-pastille vq-pastille--${etat.ton}`}>{etat.libelle}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>

          <article className="vq-carte qualiopi-detail" aria-labelledby="qualiopi-titre" aria-live="polite">
            <div>
              <p className="ajd-element__contexte">Indicateur {choisi.numero} · critère {choisi.critere.numero}</p>
              <h2 id="qualiopi-titre" className="qualiopi-detail__titre">{etatDe(choisi).libelle}</h2>
            </div>
            <section>
              <h3 className="qualiopi-detail__sous-titre">Ce qui est attendu</h3>
              <p className="qualiopi-detail__texte">{choisi.libelle}</p>
            </section>
            {choisi.non_applicable_force ? (
              <section className="qualiopi-nc">
                <strong>Non concerné</strong>
                {choisi.non_applicable_motif && <p className="qualiopi-detail__texte">{choisi.non_applicable_motif}</p>}
                <Button compact variante="ghost" to="/indicateurs/non-applicables">Modifier</Button>
              </section>
            ) : (
              <>
                <section>
                  <h3 className="qualiopi-detail__sous-titre">Ce que vous avez</h3>
                  {errPreuves && <Alert ton="error">{errPreuves}</Alert>}
                  {!preuves && !errPreuves && <LoadingState texte="Chargement des preuves…" />}
                  {preuves && preuves.length === 0 && <p className="ajd-element__contexte">Rien pour l'instant.</p>}
                  {preuves && preuves.length > 0 && (
                    <ul className="qualiopi-preuves">
                      {preuves.map((p) => (
                        <li key={p.id}>
                          <span className="qualiopi-preuves__titre">{p.titre}</span>
                          <span className="ajd-element__contexte">
                            {[p.session_reference && `Session ${p.session_reference}`, p.nb_fichiers ? pl(p.nb_fichiers, "fichier", "fichiers") : null,
                              p.date_echeance && `à revoir le ${formaterDate(p.date_echeance)}`].filter(Boolean).join(" · ")}
                          </span>
                          {p.alerte_statut === "perime" && <span className="vq-pastille vq-pastille--attention">Périmée</span>}
                          {p.a_confirmer && <span className="vq-pastille vq-pastille--attention">À confirmer</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                {manques.length > 0 && (
                  <section className="qualiopi-manque">
                    <h3 className="qualiopi-detail__sous-titre">Ce qui manque</h3>
                    <ul>{manques.map((m) => <li key={m}>{m}</li>)}</ul>
                  </section>
                )}
                <div className="reglages-liens">
                  <Button variante={manques.length ? "primary" : "secondary"} compact to={`/preuves?indicateur=${choisi.numero}`}>
                    {preuves && preuves.length ? "Gérer les preuves" : "Ajouter une preuve"}
                  </Button>
                  <Button compact variante="ghost" to="/taches">Créer une tâche</Button>
                </div>
              </>
            )}
          </article>
        </div>
      )}
    </>
  );
}
