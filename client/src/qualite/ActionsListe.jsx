import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, EmptyState, Field, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { useTexteUrl } from "../ui/useTexteUrl.js";
import { FormulaireAction } from "./FormulaireAction.jsx";
import {
  ORIGINES, PRIORITES, SEGMENTS, STATUTS_ACTION,
  compteursActions, compterSegments, estEnRetard, filtrerActions,
  indicateursCompacts, indicateursPresents,
} from "./format.js";
import { formaterDate } from "../sessions/format.js";

// /actions-qualite : la LISTE. Segment et filtres vivent dans l'URL, filtrage
// client sur la liste complète (GET ?etat=tous), comme la Veille.
export function ActionsListe({ admin }) {
  useTitrePage(admin ? "Actions qualité" : "Mes actions qualité");
  const [params, setParams] = useSearchParams();
  const segment = SEGMENTS.some((s) => s.id === params.get("etat")) ? params.get("etat") : "actives";
  const [q, setQ] = useTexteUrl("q");
  const filtres = {
    statut: params.get("statut") || "",
    priorite: params.get("priorite") || "",
    origine: params.get("origine") || "",
    indicateur: params.get("ind") || "",
    session: params.get("session") || "",
    responsable: params.get("responsable") || "",
    q,
  };

  const [actions, setActions] = useState(null);
  const [formations, setFormations] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [err, setErr] = useState(null);
  const [creation, setCreation] = useState(false);

  const charger = useCallback(async () => {
    try {
      const [a, f, s1, s2] = await Promise.all([
        api("/api/actions-qualite?etat=tous"),
        api("/api/formations").catch(() => ({ formations: [] })),
        api("/api/sessions").catch(() => ({ sessions: [] })),
        api("/api/sessions?etat=archivees").catch(() => ({ sessions: [] })),
      ]);
      setActions(a.actions);
      setFormations(f.formations || []);
      setSessions([...(s1.sessions || []), ...(s2.sessions || [])]);
      setErr(null);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  function changer(cle, valeur) {
    setParams((courants) => {
      const p = new URLSearchParams(courants);
      if (valeur && !(cle === "etat" && valeur === "actives")) p.set(cle, valeur); else p.delete(cle);
      return p;
    });
  }
  // fix : une seule navigation. `setQ("")` repartait des paramètres du
  // rendu courant et réinjectait les filtres select ; useTexteUrl vide
  // lui-même le champ de recherche quand `q` disparaît de l'URL.
  function reinitialiser() {
    setParams(new URLSearchParams());
  }

  const formationParId = Object.fromEntries(formations.map((f) => [f.id, f.intitule]));
  const sessionParId = Object.fromEntries(sessions.map((s) => [s.id, s]));
  const affichees = actions ? filtrerActions(actions, { segment, ...filtres }) : [];
  const compteurs = actions ? compteursActions(actions) : {};
  const segmentsComptes = actions ? compterSegments(actions) : {};
  const filtresActifs = filtres.statut || filtres.priorite || filtres.origine || filtres.indicateur || filtres.session || filtres.responsable || filtres.q;
  const responsibles = actions ? [...new Map(actions.filter((a) => a.responsable_id).map((a) => [a.responsable_id, a.responsable_nom || "#" + a.responsable_id])).entries()].map(([id, nom]) => ({ id, nom })) : [];
  const sessionsFiltrables = actions ? [...new Set(actions.map((a) => a.session_id).filter(Boolean))] : [];

  const tuiles = admin ? [
    { cle: "ouvertes", n: compteurs.ouvertes || 0, libelle: "Ouvertes" },
    { cle: "en_retard", n: compteurs.en_retard || 0, libelle: "En retard" },
    { cle: "efficacite", n: compteurs.efficacite || 0, libelle: "Efficacité à vérifier" },
    { cle: "cloturees", n: compteurs.cloturees || 0, libelle: "Clôturées" },
  ] : [
    { cle: "ouvertes", n: compteurs.ouvertes || 0, libelle: "Mes actions ouvertes" },
    { cle: "en_retard", n: compteurs.en_retard || 0, libelle: "En retard" },
    { cle: "a_faire", n: compteurs.a_faire || 0, libelle: "À réaliser" },
    { cle: "efficacite", n: compteurs.efficacite || 0, libelle: "Efficacité à vérifier" },
  ];

  const nouvelle = admin && <Button variante="primary" onClick={() => setCreation(true)}>Nouvelle action</Button>;

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Qualité" }, { libelle: admin ? "Actions qualité" : "Mes actions qualité" }]}
        titre={admin ? "Actions qualité" : "Mes actions qualité"}
        description="Suivez les actions d'amélioration, leur réalisation et leur efficacité."
        actions={nouvelle}
      />
      {err && <Alert ton="error" titre="Les actions qualité n'ont pas pu être chargées." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!actions && !err && <LoadingState texte="Chargement des actions qualité…" />}

      {actions && actions.length === 0 && (
        <EmptyState
          titre={admin ? "Aucune action qualité pour le moment." : "Aucune action qualité ne vous est actuellement attribuée."}
          action={nouvelle}
        >
          {admin ? "Créez la première action d'amélioration ou de correction." : "Vos actions assignées apparaîtront ici."}
        </EmptyState>
      )}

      {actions && actions.length > 0 && (
        <section className="qualite-liste" aria-label="Liste des actions qualité">
          <div className="qualite-compteurs" role="group" aria-label="Compteurs">
            {tuiles.map((t) => (
              <div key={t.cle} className="qualite-compteur">
                <span className="qualite-compteur__n">{t.n}</span>
                <span className="qualite-compteur__l">{t.libelle}</span>
              </div>
            ))}
          </div>

          <div className="sess-vues" role="group" aria-label="État des actions">
            {SEGMENTS.map((s) => (
              <button key={s.id} type="button" aria-pressed={segment === s.id}
                className={"sess-vue" + (segment === s.id ? " sess-vue--active" : "")} onClick={() => changer("etat", s.id)}>
                {s.libelle} <span className="sess-vue__compteur">{segmentsComptes[s.id]}</span>
              </button>
            ))}
          </div>

          <div className="veille-filtres">
            <Field label="Rechercher" className="veille-filtres__recherche">
              <input type="search" value={filtres.q} placeholder="Titre, référence ou responsable" onChange={(e) => setQ(e.target.value)} />
            </Field>
            <Field label="Statut">
              <select value={filtres.statut} onChange={(e) => changer("statut", e.target.value)}>
                <option value="">Tous les statuts</option>
                {Object.entries(STATUTS_ACTION).map(([k, s]) => <option key={k} value={k}>{s.libelle}</option>)}
              </select>
            </Field>
            <Field label="Priorité">
              <select value={filtres.priorite} onChange={(e) => changer("priorite", e.target.value)}>
                <option value="">Toutes</option>
                {Object.entries(PRIORITES).map(([k, p]) => <option key={k} value={k}>{p.libelle}</option>)}
              </select>
            </Field>
            <Field label="Origine">
              <select value={filtres.origine} onChange={(e) => changer("origine", e.target.value)}>
                <option value="">Toutes</option>
                {Object.entries(ORIGINES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            {admin && (
              <Field label="Responsable">
                <select value={filtres.responsable} onChange={(e) => changer("responsable", e.target.value)}>
                  <option value="">Tous</option>
                  {responsibles.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
                </select>
              </Field>
            )}
            <Field label="Indicateur">
              <select value={filtres.indicateur} onChange={(e) => changer("ind", e.target.value)}>
                <option value="">Tous les indicateurs</option>
                {indicateursPresents(actions).map((i) => <option key={i.id} value={i.id}>Indicateur {i.numero} — {i.libelle}</option>)}
              </select>
            </Field>
            <Field label="Session">
              <select value={filtres.session} onChange={(e) => changer("session", e.target.value)}>
                <option value="">Toutes les sessions</option>
                {sessionsFiltrables.map((sid) => <option key={sid} value={sid}>{sessionParId[sid]?.reference || `Session ${sid}`}</option>)}
              </select>
            </Field>
          </div>

          {filtresActifs && (
            <div className="qualite-reset">
              <Button compact onClick={reinitialiser}>Réinitialiser les filtres</Button>
            </div>
          )}

          {affichees.length === 0 ? (
            <EmptyState titre="Aucune action ne correspond à ces filtres." action={<Button onClick={reinitialiser}>Effacer les filtres</Button>} />
          ) : (
            <table className="sess-table qualite-table">
              <caption className="visually-hidden">Actions qualité ({affichees.length})</caption>
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Priorité</th>
                  <th scope="col">Responsable</th>
                  <th scope="col">Échéance</th>
                  <th scope="col">Contexte</th>
                  <th scope="col">Indicateurs</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {affichees.map((a) => {
                  const st = STATUTS_ACTION[a.statut] || { libelle: a.statut, ton: "neutral" };
                  const pr = a.priorite ? (PRIORITES[a.priorite] || { libelle: a.priorite, ton: "neutral" }) : null;
                  const ind = indicateursCompacts(a.indicateurs);
                  const retard = estEnRetard(a);
                  const session = a.session_id ? sessionParId[a.session_id] : null;
                  const formation = session?.formation || formationParId[a.formation_id] || null;
                  return (
                    <tr key={a.id}>
                      <td data-label="Action" className="sess-table__principal">
                        <Link to={`/actions-qualite/${a.id}`}>{a.titre}</Link>
                        <span className="sess-secondaire">{a.reference}</span>
                        {a.origine === "signalement" && (
                          <span className="sess-secondaire">Origine : Signalement {a.signalement_reference}</span>
                        )}
                        {retard && <Badge ton="error">En retard</Badge>}
                      </td>
                      <td data-label="Statut"><Badge ton={st.ton}>{st.libelle}</Badge></td>
                      <td data-label="Priorité">{pr ? <Badge ton={pr.ton}>{pr.libelle}</Badge> : <span className="sess-secondaire">—</span>}</td>
                      <td data-label="Responsable">{a.responsable_nom || <span className="sess-secondaire">—</span>}</td>
                      <td data-label="Échéance">{formaterDate(a.echeance) || <span className="sess-secondaire">—</span>}</td>
                      <td data-label="Contexte">
                        {session ? `${session.reference}${session.archivee_le ? " (archivée)" : ""}` : (formation || <span className="sess-secondaire">—</span>)}
                      </td>
                      <td data-label="Indicateurs">
                        {ind.tous.length === 0 ? <span className="sess-secondaire">—</span> : (
                          <span aria-label={`Indicateurs ${ind.tous.join(", ")}`}>Ind. {ind.visibles.join(", ")}{ind.reste > 0 && ` +${ind.reste}`}</span>
                        )}
                      </td>
                      <td className="sess-table__actions">
                        <Button compact to={`/actions-qualite/${a.id}`} aria-label={`Ouvrir l'action ${a.titre}`}>Ouvrir</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {creation && (
        <FormulaireAction
          onFermer={() => setCreation(false)}
          onEnregistre={() => { setCreation(false); charger(); }}
        />
      )}
    </>
  );
}
