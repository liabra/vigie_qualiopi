import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Button, EmptyState, LoadingState } from "../ui/index.js";
import { useTitrePage } from "./titre.js";

// « Aujourd'hui » : UNE liste de ce qui est à faire, quelle que soit sa
// source (tâches, actions, sessions, réclamations, équipe…). Le SERVEUR
// choisit ce que le rôle peut voir (GET /api/pilotage/aujourdhui) ; l'écran
// n'affiche que ce qu'il reçoit. Une tâche se coche ici ; le reste s'ouvre
// à l'endroit où il se traite.

const GROUPES = [
  { cle: "retard", titre: "En retard", classe: "retard" },
  { cle: "semaine", titre: "Cette semaine", classe: "semaine" },
  { cle: "plus_tard", titre: "Plus tard", classe: "plus-tard" },
];
const CATEGORIES = { formations: "Formations", qualiopi: "Qualiopi", equipe: "Équipe" };
const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

const dateLongue = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const dateCourte = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const heure = (h) => (h ? String(h).slice(0, 5).replace(":", " h ") : "");
const premiereMajuscule = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// Libellé de l'échéance, relatif au jour métier renvoyé par le serveur.
export function quand(date, jour) {
  if (!date) return "À traiter";
  const ecart = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${jour}T12:00:00Z`)) / 864e5);
  if (ecart < -1) return `Depuis ${-ecart} jours`;
  if (ecart === -1) return "Depuis hier";
  if (ecart === 0) return "Aujourd'hui";
  if (ecart === 1) return "Demain";
  if (ecart < 7) return premiereMajuscule(new Date(`${date}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", timeZone: "UTC" }));
  return `Le ${dateCourte(date)}`;
}

function Element({ e, jour, onFait, enCours }) {
  return (
    <li className="ajd-element">
      {e.tache_id ? (
        <label className="ajd-element__principal">
          <input type="checkbox" className="ajd-element__case" checked={false} disabled={enCours}
            onChange={() => onFait(e)} aria-describedby={`ajd-${e.cle}-ctx`} />
          <span className="ajd-element__textes">
            <span className="ajd-element__titre">{e.titre}</span>
            <span id={`ajd-${e.cle}-ctx`} className="ajd-element__contexte">{e.contexte} · cocher pour marquer comme faite</span>
          </span>
        </label>
      ) : (
        <div className="ajd-element__principal">
          <span className="ajd-element__puce" aria-hidden="true" />
          <span className="ajd-element__textes">
            <span className="ajd-element__titre">{e.titre}</span>
            <span className="ajd-element__contexte">{e.contexte}</span>
          </span>
        </div>
      )}
      <span className="ajd-element__quand">{quand(e.date, jour)}</span>
      <Button compact to={e.lien} aria-label={`${e.action} : ${e.titre}`}>{e.action}</Button>
    </li>
  );
}

export function Aujourdhui({ user }) {
  useTitrePage("Aujourd'hui");
  const admin = user.role === "admin";
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [filtre, setFiltre] = useState("tout");
  const [enCours, setEnCours] = useState(null);
  const [message, setMessage] = useState(null);
  const [drive, setDrive] = useState(null);
  const [score, setScore] = useState(null);

  const charger = useCallback(async () => {
    try { setD(await api("/api/pilotage/aujourdhui")); setErr(null); }
    catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => {
    if (!admin) return;
    api("/api/drive/status").then(setDrive).catch(() => {});
    api("/api/referentiel").then((r) => setScore(r.score)).catch(() => {});
  }, [admin]);
  const driveActionRequise = admin && drive && (!drive.connected || drive.reconnexionRequise || drive.erreur);

  async function marquerFaite(e) {
    if (enCours) return;
    setEnCours(e.cle); setMessage(null);
    try {
      await api(`/api/registres/taches/${e.tache_id}`, { method: "PATCH", body: JSON.stringify({ statut: "faite" }) });
      setMessage({ ton: "success", texte: `« ${e.titre} » est marquée comme faite.` });
      await charger();
    } catch (x) { setMessage({ ton: "error", texte: x.message }); }
    finally { setEnCours(null); }
  }

  const categoriesPresentes = d ? [...new Set(GROUPES.flatMap((g) => d.groupes[g.cle].map((e) => e.categorie)))] : [];
  const filtres = ["tout", ...Object.keys(CATEGORIES).filter((c) => categoriesPresentes.includes(c))];
  const filtreActif = filtres.includes(filtre) ? filtre : "tout";
  const visibles = (g) => d.groupes[g].filter((e) => filtreActif === "tout" || e.categorie === filtreActif);
  const applicables = score ? score.total - score.non_applicable : 0;

  return (
    <div className="ajd">
      <header className="ajd-entete">
        <div>
          {d && <p className="ajd-entete__date">{premiereMajuscule(dateLongue(d.aujourdhui))}</p>}
          <h1 className="ui-page-header__titre">Aujourd'hui</h1>
        </div>
      </header>

      {driveActionRequise && (
        <Alert ton={drive.erreur ? "error" : "warning"} titre="Google Drive" action={<Button compact to="/parametres/google">Réglages Drive</Button>}>
          {drive.erreur ? drive.erreur : !drive.connected ? "Le Google Drive n'est pas connecté." : "Une reconnexion du Drive est requise."}
        </Alert>
      )}
      {err && <Alert ton="error" titre="La liste n'a pas pu être chargée." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {message && <Alert ton={message.ton}>{message.texte}</Alert>}
      {!d && !err && <LoadingState texte="Chargement de votre journée…" />}

      {d && (
        <>
          <section className="ajd-tuiles" aria-label="En résumé">
            <div className="ajd-tuile">
              <span className="ajd-tuile__libelle">En retard</span>
              <span className="ajd-tuile__n ajd-tuile__n--retard">{d.compteurs.retard}</span>
            </div>
            <div className="ajd-tuile">
              <span className="ajd-tuile__libelle">Cette semaine</span>
              <span className="ajd-tuile__n">{d.compteurs.semaine}</span>
            </div>
            {admin && score ? (
              <Link to="/qualiopi" className="ajd-tuile ajd-tuile--lien">
                <span className="ajd-tuile__libelle">Qualiopi</span>
                <span className="ajd-tuile__n">{score.maitrise} <span className="ajd-tuile__sur">/ {applicables} indicateurs maîtrisés</span></span>
                <span className="ajd-jauge" aria-hidden="true"><span style={{ width: `${applicables ? Math.round((100 * score.maitrise) / applicables) : 0}%` }} /></span>
              </Link>
            ) : (
              <div className="ajd-tuile">
                <span className="ajd-tuile__libelle">Plus tard</span>
                <span className="ajd-tuile__n">{d.compteurs.plus_tard}</span>
              </div>
            )}
          </section>

          <div className="ajd-colonnes">
            <section className="ajd-liste" aria-labelledby="ajd-titre-liste">
              <div className="ajd-liste__tete">
                <h2 id="ajd-titre-liste" className="ajd-liste__titre">À faire</h2>
                {filtres.length > 2 && (
                  <div className="ajd-filtres" role="group" aria-label="Filtrer la liste">
                    {filtres.map((f) => (
                      <button key={f} type="button" aria-pressed={filtreActif === f}
                        className={"ajd-filtre" + (filtreActif === f ? " ajd-filtre--actif" : "")} onClick={() => setFiltre(f)}>
                        {f === "tout" ? "Tout" : CATEGORIES[f]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {GROUPES.every((g) => visibles(g.cle).length === 0) ? (
                <EmptyState titre="Rien à faire pour le moment.">Tout est à jour. Les nouvelles échéances apparaîtront ici.</EmptyState>
              ) : GROUPES.map((g) => {
                const liste = visibles(g.cle);
                if (!liste.length) return null;
                return (
                  <div key={g.cle} className="ajd-groupe">
                    <h3 className={`ajd-groupe__titre ajd-groupe__titre--${g.classe}`}>{g.titre} · {liste.length}</h3>
                    <ul className="ajd-elements">
                      {liste.map((e) => <Element key={e.cle} e={e} jour={d.aujourdhui} onFait={marquerFaite} enCours={enCours !== null} />)}
                    </ul>
                  </div>
                );
              })}
            </section>

            <aside className="ajd-cote">
              <section className="ajd-carte" aria-labelledby="ajd-seances">
                <h2 id="ajd-seances" className="ajd-carte__titre">Prochaines séances</h2>
                {d.seances.length === 0 ? <p className="muted">Aucune séance dans les 7 prochains jours.</p> : (
                  <ul className="ajd-seances">
                    {d.seances.map((s) => {
                      const date = new Date(`${s.date}T12:00:00Z`);
                      return (
                        <li key={s.id}>
                          <Link to={`/sessions/${s.session_id}`} className="ajd-seance">
                            <span className="ajd-seance__date" aria-hidden="true">
                              <span>{JOURS[date.getUTCDay()]}</span><strong>{date.getUTCDate()}</strong>
                            </span>
                            <span className="ajd-element__textes">
                              <span className="ajd-element__titre">{s.formation}</span>
                              <span className="ajd-element__contexte">
                                <span className="sr-only">{dateLongue(s.date)} · </span>
                                {[s.heure_debut && `${heure(s.heure_debut)}${s.heure_fin ? ` – ${heure(s.heure_fin)}` : ""}`, s.lieu, `${s.inscrits} inscrit${s.inscrits > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              <section className="ajd-carte" aria-labelledby="ajd-raccourcis">
                <h2 id="ajd-raccourcis" className="ajd-carte__titre">Raccourcis</h2>
                <Button variante="primary" to="/sessions">Ouvrir les formations</Button>
                <Button to="/taches">Ajouter une tâche</Button>
                {admin && <Button to="/candidatures">Candidatures</Button>}
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
