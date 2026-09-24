import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, Drawer, EmptyState, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { FormulaireSession, SESSION_VIDE, erreursSession } from "./FormulaireSession.jsx";
import { STATUTS_SESSION, VUES_SESSIONS, compterParVue, filtrerSessions, formaterPeriode, titreSession } from "./format.js";

// /sessions : la LISTE seule. Vue et recherche vivent dans l'URL
// (?vue=en_cours&q=lyon) : précédent, rafraîchissement et lien direct les
// conservent. La création s'ouvre dans un panneau, jamais en permanence.
export function SessionsListe({ admin }) {
  useTitrePage("Sessions");
  const naviguer = useNavigate();
  const [params, setParams] = useSearchParams();
  const vue = VUES_SESSIONS.some((v) => v.id === params.get("vue")) ? params.get("vue") : "toutes";
  const q = params.get("q") || "";
  const [sessions, setSessions] = useState(null);
  const [err, setErr] = useState(null);

  const charger = useCallback(async () => {
    try { setSessions((await api("/api/sessions")).sessions); setErr(null); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  function changerFiltre(cle, valeur) {
    const p = new URLSearchParams(params);
    if (valeur && valeur !== "toutes") p.set(cle, valeur); else p.delete(cle);
    setParams(p, { replace: cle === "q" });
  }

  const [creation, setCreation] = useState(false);
  const affichees = sessions ? filtrerSessions(sessions, { vue, q }) : [];
  const compteurs = sessions ? compterParVue(sessions) : {};

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Formation" }, { libelle: "Sessions" }]}
        titre="Sessions"
        description="Gestion des sessions de formation"
        actions={admin && <Button variante="primary" onClick={() => setCreation(true)}>+ Nouvelle session</Button>}
      />
      {err && <Alert ton="error" titre="Les sessions n'ont pas pu être chargées." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!sessions && !err && <LoadingState texte="Chargement des sessions…" />}

      {sessions && sessions.length === 0 && (
        <EmptyState
          titre="Aucune session"
          action={admin && <Button variante="primary" onClick={() => setCreation(true)}>+ Nouvelle session</Button>}
        >
          {admin ? "Créez la première session à partir d'une formation du catalogue." : "Aucune session n'a encore été créée."}
        </EmptyState>
      )}

      {sessions && sessions.length > 0 && (
        <section className="sess-liste" aria-label="Liste des sessions">
          <div className="sess-filtres">
            <div className="sess-vues" role="group" aria-label="Filtrer par statut">
              {VUES_SESSIONS.map((v) => (
                <button
                  key={v.id} type="button" aria-pressed={vue === v.id}
                  className={"sess-vue" + (vue === v.id ? " sess-vue--active" : "")}
                  onClick={() => changerFiltre("vue", v.id)}
                >
                  {v.libelle} <span className="sess-vue__compteur">{compteurs[v.id]}</span>
                </button>
              ))}
            </div>
            <label className="sess-recherche">
              <span className="visually-hidden">Rechercher une session</span>
              <input
                type="search" value={q} placeholder="Rechercher (référence, formation, lieu)"
                onChange={(e) => changerFiltre("q", e.target.value)}
              />
            </label>
          </div>

          {affichees.length === 0 ? (
            <EmptyState
              titre="Aucune session ne correspond à ces filtres."
              action={<Button onClick={() => setParams(new URLSearchParams())}>Effacer les filtres</Button>}
            />
          ) : (
            <table className="sess-table">
              <caption className="visually-hidden">Sessions ({affichees.length})</caption>
              <thead>
                <tr>
                  <th scope="col">Session</th>
                  <th scope="col">Formation</th>
                  <th scope="col">Dates</th>
                  <th scope="col">Lieu</th>
                  <th scope="col">Statut</th>
                  <th scope="col" className="sess-num">Inscrits</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {affichees.map((s) => {
                  const st = STATUTS_SESSION[s.statut] || { libelle: s.statut, ton: "neutral" };
                  return (
                    <tr key={s.id}>
                      <td data-label="Session" className="sess-table__principal">
                        <Link to={`/sessions/${s.id}`}>{titreSession(s)}</Link>
                        {s.horaire && <span className="sess-secondaire">{s.horaire}</span>}
                      </td>
                      <td data-label="Formation">{s.formation}</td>
                      <td data-label="Dates">{formaterPeriode(s.date_debut, s.date_fin)}</td>
                      <td data-label="Lieu">{s.lieu || "—"}</td>
                      <td data-label="Statut"><Badge ton={st.ton}>{st.libelle}</Badge></td>
                      <td data-label="Inscrits" className="sess-num">{s.nb_inscrits}</td>
                      <td className="sess-table__actions">
                        <Button compact to={`/sessions/${s.id}`} aria-label={`Ouvrir la session ${titreSession(s)}`}>Ouvrir</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {admin && (
        <CreationSession
          ouvert={creation}
          onFermer={() => setCreation(false)}
          onCreee={(id) => { setCreation(false); naviguer(`/sessions/${id}`); }}
        />
      )}
    </>
  );
}

// Panneau « Nouvelle session » : mêmes champs et mêmes contrôles qu'avant.
function CreationSession({ ouvert, onFermer, onCreee }) {
  const [valeurs, setValeurs] = useState(SESSION_VIDE);
  const [erreurs, setErreurs] = useState({});
  const [erreurServeur, setErreurServeur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const [formations, setFormations] = useState(null);

  useEffect(() => {
    if (!ouvert) return;
    setValeurs(SESSION_VIDE); setErreurs({}); setErreurServeur(null);
    api("/api/formations").then((r) => setFormations(r.formations)).catch((e) => setErreurServeur(e.message));
  }, [ouvert]);

  async function creer(e) {
    e.preventDefault();
    const trouvees = erreursSession(valeurs, "creation");
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    setEnCours(true);
    setErreurServeur(null);
    try {
      const r = await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ ...valeurs, formation_id: Number(valeurs.formation_id), duree_heures_reelle: valeurs.duree_heures_reelle || null }),
      });
      onCreee(r.session.id);
    } catch (err) {
      setErreurServeur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Drawer
      ouvert={ouvert} onFermer={onFermer} fermable={!enCours}
      titre="Nouvelle session"
      description="La session reprend la version en cours de la formation choisie."
      pied={
        <>
          <Button onClick={onFermer} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-creation-session" disabled={enCours}>
            {enCours ? "Création…" : "Créer la session"}
          </Button>
        </>
      }
    >
      <form id="form-creation-session" onSubmit={creer} noValidate>
        {erreurServeur && <Alert ton="error" titre="La session n'a pas été créée.">{erreurServeur}</Alert>}
        {formations && formations.length === 0 && (
          <Alert ton="warning" titre="Aucune formation au catalogue.">
            Créez d'abord une formation (menu Formation › Formations).
          </Alert>
        )}
        <FormulaireSession mode="creation" valeurs={valeurs} onChange={setValeurs} formations={formations || []} erreurs={erreurs} />
      </form>
    </Drawer>
  );
}
