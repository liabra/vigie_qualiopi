import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState } from "../ui/index.js";
import { formaterDate } from "./format.js";
import { corpsSeance, creneauxSeance, erreursSeance, formaterHeureSeance, libelleGroupe, seanceCorrespond, seanceVide, suiviRenseigne } from "./seances-format.js";

// Onglet « Planning / séances » (route /planning ; DOC-7C) : liste des séances
// de la session, filtre par groupe, création/modification/suppression, et
// ouverture du suivi pédagogique individuel d'une séance. Aucun Livret généré
// ici, aucun accès aux données handicap/adaptation.
export function OngletSeances({ donnees, peutSaisir, recharger, notifier, archivee }) {
  const { session, groupes } = donnees;
  const [seances, setSeances] = useState(null);
  const [err, setErr] = useState(null);
  const [filtreGroupe, setFiltreGroupe] = useState("");
  const [formulaire, setFormulaire] = useState(null);
  const [aSupprimer, setASupprimer] = useState(null);
  const [suiviDe, setSuiviDe] = useState(null); // séance dont le suivi est ouvert

  const charger = useCallback(async () => {
    try { setSeances(await api(`/api/sessions/${session.id}/seances`)); setErr(null); }
    catch (e) { setErr(e.message); }
  }, [session.id]);
  useEffect(() => { charger(); }, [charger]);

  if (err && !seances) return <Alert ton="error" titre="Le planning n'a pas pu être chargé." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>;
  if (!seances) return <LoadingState texte="Chargement du planning…" />;

  const modifiable = peutSaisir && !archivee;
  const lignes = (seances.seances || []).filter((s) => seanceCorrespond(s, filtreGroupe));

  return (
    <section className="sess-section" aria-labelledby="titre-planning">
      <div className="sess-section__tete">
        <h2 id="titre-planning" className="sess-section__titre">Planning / séances</h2>
        {modifiable && (
          <div className="sess-actions">
            <Button compact variante="primary" onClick={() => setFormulaire(seanceVide())}>Ajouter une séance</Button>
          </div>
        )}
      </div>

      {groupes.length > 1 && (
        <div className="sess-vues" role="group" aria-label="Filtrer par groupe">
          <button type="button" aria-pressed={filtreGroupe === ""} className={"sess-vue" + (filtreGroupe === "" ? " sess-vue--active" : "")} onClick={() => setFiltreGroupe("")}>
            Tous les groupes
          </button>
          {groupes.map((g) => (
            <button key={g.id} type="button" aria-pressed={String(filtreGroupe) === String(g.id)} className={"sess-vue" + (String(filtreGroupe) === String(g.id) ? " sess-vue--active" : "")} onClick={() => setFiltreGroupe(String(g.id))}>
              {g.nom}
            </button>
          ))}
        </div>
      )}

      {lignes.length === 0 ? (
        <EmptyState titre="Aucune séance planifiée pour cette session." action={modifiable && <Button variante="primary" onClick={() => setFormulaire(seanceVide())}>Ajouter une séance</Button>}>
          {filtreGroupe ? "Aucune séance pour ce groupe (les séances communes à la session restent affichées)." : "Planifiez les moments pédagogiques de la session : dates, horaires, compétences et activités."}
        </EmptyState>
      ) : (
        <table className="sess-table">
          <caption className="visually-hidden">Séances ({lignes.length})</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Horaires</th>
              <th scope="col">Groupe</th>
              <th scope="col">Phase</th>
              <th scope="col">Thème</th>
              <th scope="col">Lieu</th>
              <th scope="col"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((s) => (
              <tr key={s.id}>
                <td data-label="Date" className="sess-table__principal">{formaterDate(s.date_seance)}</td>
                <td data-label="Horaires">{creneauxSeance(s) || <span className="sess-secondaire">—</span>}</td>
                <td data-label="Groupe">{libelleGroupe(s)}</td>
                <td data-label="Phase">{s.phase_numero ? `Phase ${s.phase_numero}` : <span className="sess-secondaire">—</span>}</td>
                <td data-label="Thème">{s.theme || <span className="sess-secondaire">—</span>}</td>
                <td data-label="Lieu">{s.lieu || <span className="sess-secondaire">—</span>}</td>
                <td className="sess-table__actions">
                  <Button compact onClick={() => setSuiviDe(s)} aria-label={`Ouvrir le suivi pédagogique de la séance du ${formaterDate(s.date_seance)}`}>Suivi pédagogique</Button>
                  {modifiable && (
                    <>
                      <Button compact onClick={() => setFormulaire({ id: s.id, date_seance: String(s.date_seance || "").slice(0, 10), groupe_id: s.groupe_id == null ? "" : String(s.groupe_id), phase_numero: s.phase_numero == null ? "" : String(s.phase_numero), heure_debut: formaterHeureSeance(s.heure_debut), heure_fin: formaterHeureSeance(s.heure_fin), theme: s.theme || "", competences: s.competences || [], activites: s.activites || "", lieu: s.lieu || "" })}>Modifier</Button>
                      <Button compact variante="danger" onClick={() => setASupprimer(s)}>Supprimer</Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modifiable && (
        <>
          <DrawerSeance valeurInitiale={formulaire} groupes={groupes} sessionId={session.id}
            onFermer={() => setFormulaire(null)}
            onFait={async (m) => { setFormulaire(null); notifier({ ton: "success", titre: m }); await charger(); recharger?.(); }} />
          <ConfirmDialog
            ouvert={!!aSupprimer} titre="Supprimer cette séance ?" libelleConfirmer="Supprimer la séance"
            onAnnuler={() => setASupprimer(null)}
            onConfirmer={async () => {
              const s = aSupprimer;
              setASupprimer(null);
              try { await api(`/api/seances/${s.id}`, { method: "DELETE" }); notifier({ ton: "success", titre: "Séance supprimée." }); await charger(); recharger?.(); }
              catch (e) { notifier({ ton: "error", titre: "Suppression impossible.", texte: e.message }); }
            }}
          >
            Le suivi individuel lié à cette séance sera également supprimé. Cette action est définitive.
          </ConfirmDialog>
        </>
      )}

      {suiviDe && <PanneauSuivi seance={suiviDe} peutSaisir={modifiable} onFermer={() => setSuiviDe(null)} onFait={(m) => notifier({ ton: "success", titre: m })} />}
    </section>
  );
}

// ── Formulaire de séance (création / modification) ───────────
function DrawerSeance({ valeurInitiale, groupes, sessionId, onFermer, onFait }) {
  const [v, setV] = useState(null);
  const [erreurs, setErreurs] = useState({});
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const [nouvelleCompetence, setNouvelleCompetence] = useState("");
  useEffect(() => { setV(valeurInitiale); setErreurs({}); setErreur(null); }, [valeurInitiale]);

  if (!v) return null;
  const set = (champ) => (ev) => setV((p) => ({ ...p, [champ]: ev.target.value }));

  function ajouterCompetence() {
    const t = nouvelleCompetence.trim();
    if (!t) return;
    if (!v.competences.includes(t)) setV((p) => ({ ...p, competences: [...p.competences, t] }));
    setNouvelleCompetence("");
  }

  async function valider(e) {
    e.preventDefault();
    const trouvees = erreursSeance(v);
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    setEnCours(true); setErreur(null);
    try {
      const corps = corpsSeance(v);
      if (v.id) await api(`/api/seances/${v.id}`, { method: "PATCH", body: JSON.stringify(corps) });
      else await api(`/api/sessions/${sessionId}/seances`, { method: "POST", body: JSON.stringify(corps) });
      await onFait(v.id ? "Séance modifiée." : "Séance enregistrée.");
    } catch (err) { setErreur(err.message); } finally { setEnCours(false); }
  }

  return (
    <Drawer ouvert titre={v.id ? "Modifier la séance" : "Nouvelle séance"} description="Les champs vides restent non renseignés ; rien n'est inventé." onFermer={onFermer} fermable={!enCours}
      pied={
        <>
          <Button onClick={onFermer} disabled={enCours}>Annuler</Button>
          <Button variante="primary" onClick={valider} disabled={enCours}>{enCours ? "En cours…" : v.id ? "Enregistrer" : "Créer la séance"}</Button>
        </>
      }>
      <form onSubmit={valider} id="form-seance" className="ui-drawer__form">
        {erreur && <Alert ton="error">{erreur}</Alert>}
        <FormSection titre="Moment" colonnes={2}>
          <Field label="Date" erreur={erreurs.date_seance}>
            <input type="date" value={v.date_seance} onChange={set("date_seance")} />
          </Field>
          <Field label="Groupe" facultatif>
            <select value={v.groupe_id} onChange={set("groupe_id")}>
              <option value="">Session entière</option>
              {groupes.map((g) => <option key={g.id} value={String(g.id)}>{g.nom}</option>)}
            </select>
          </Field>
          <Field label="Heure de début" facultatif>
            <input type="time" value={v.heure_debut} onChange={set("heure_debut")} />
          </Field>
          <Field label="Heure de fin" facultatif erreur={erreurs.heure_fin}>
            <input type="time" value={v.heure_fin} onChange={set("heure_fin")} />
          </Field>
          <Field label="Phase" facultatif aide="Numéro de phase pédagogique (entier positif), facultatif." erreur={erreurs.phase_numero}>
            <input type="number" min="1" step="1" value={v.phase_numero} onChange={set("phase_numero")} />
          </Field>
          <Field label="Lieu" facultatif>
            <input type="text" value={v.lieu} onChange={set("lieu")} placeholder="Salle, site…" />
          </Field>
        </FormSection>
        <FormSection titre="Contenu" colonnes={1}>
          <Field label="Thème" facultatif>
            <input type="text" value={v.theme} onChange={set("theme")} placeholder="Objet de la séance" />
          </Field>
          <Field label="Compétences" facultatif aide="Une ou plusieurs compétences travaillées, saisies librement.">
            <div className="seance-champs">
              {v.competences.map((c) => (
                <span key={c} className="seance-puce">
                  {c}
                  <button type="button" className="seance-puce__retirer" aria-label={`Retirer ${c}`} onClick={() => setV((p) => ({ ...p, competences: p.competences.filter((x) => x !== c) }))}>×</button>
                </span>
              ))}
              <input type="text" value={nouvelleCompetence} onChange={(ev) => setNouvelleCompetence(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); ajouterCompetence(); } }} placeholder="Ajouter une compétence…" />
              <Button compact onClick={ajouterCompetence} type="button">Ajouter</Button>
            </div>
          </Field>
          <Field label="Activités / exercices" facultatif>
            <textarea rows={3} value={v.activites} onChange={set("activites")} placeholder="Exercices, ateliers en groupes…" />
          </Field>
        </FormSection>
      </form>
    </Drawer>
  );
}

// ── Suivi pédagogique d'une séance ───────────────────────────
// Liste compacte des stagiaires concernés, accordéon par stagiaire, enregistrement
// individuel. Aucune donnée handicap/besoins spécifiques n'est affichée.
function PanneauSuivi({ seance, peutSaisir, onFermer, onFait }) {
  const [donnees, setDonnees] = useState(null);
  const [err, setErr] = useState(null);
  const [ouvert, setOuvert] = useState(null); // inscription_id dont l'accordéon est ouvert

  const charger = useCallback(async () => {
    try { setDonnees(await api(`/api/seances/${seance.id}/suivi`)); setErr(null); }
    catch (e) { setErr(e.message); }
  }, [seance.id]);
  useEffect(() => { charger(); }, [charger]);

  return (
    <Drawer ouvert titre="Suivi pédagogique" description={`${formaterDate(seance.date_seance)} · ${libelleGroupe(seance)}`} onFermer={onFermer} taille="large">
      {err && !donnees && <Alert ton="error" titre="Le suivi n'a pas pu être chargé." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!donnees && !err && <LoadingState texte="Chargement du suivi…" />}
      {donnees && donnees.inscrits.length === 0 && <EmptyState titre="Aucun stagiaire concerné par cette séance." />}
      {donnees && donnees.inscrits.length > 0 && (
        <ul className="suivi-liste">
          {donnees.inscrits.map((s) => {
            const nom = `${s.prenom} ${s.nom}`;
            const renseigne = suiviRenseigne(s);
            return (
              <li key={s.inscription_id} className="suivi-item">
                <div className="suivi-item__tete">
                  <span className="suivi-item__nom">{nom}</span>
                  {renseigne && <Badge ton="success">Suivi renseigné</Badge>}
                  <Button compact onClick={() => setOuvert(ouvert === s.inscription_id ? null : s.inscription_id)} aria-expanded={ouvert === s.inscription_id}>
                    {ouvert === s.inscription_id ? "Fermer" : renseigne ? "Consulter / modifier" : "Renseigner"}
                  </Button>
                </div>
                {ouvert === s.inscription_id && (
                  <SuiviStagiaire inscriptionId={s.inscription_id} seanceId={seance.id} initial={s} modifiable={peutSaisir} onFait={(m) => { onFait(m); charger(); }} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}

function SuiviStagiaire({ seanceId, inscriptionId, initial, modifiable, onFait }) {
  const [v, setV] = useState({ accompagnement: initial.accompagnement || "", difficultes: initial.difficultes || "", impressions: initial.impressions || "", observations: initial.observations || "" });
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const set = (champ) => (ev) => setV((p) => ({ ...p, [champ]: ev.target.value }));

  async function enregistrer() {
    if (!modifiable) return;
    setEnCours(true); setErreur(null);
    try {
      const corps = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, String(val).trim() || null]));
      await api(`/api/seances/${seanceId}/suivi/${inscriptionId}`, { method: "PUT", body: JSON.stringify(corps) });
      onFait("Suivi enregistré.");
    } catch (e) { setErreur(e.message); } finally { setEnCours(false); }
  }

  return (
    <div className="suivi-item__corps">
      {erreur && <Alert ton="error">{erreur}</Alert>}
      <Field label="Accompagnement mis en place" facultatif>
        <textarea rows={2} value={v.accompagnement} onChange={set("accompagnement")} disabled={!modifiable} />
      </Field>
      <Field label="Difficultés" facultatif>
        <textarea rows={2} value={v.difficultes} onChange={set("difficultes")} disabled={!modifiable} />
      </Field>
      <Field label="Impressions" facultatif>
        <textarea rows={2} value={v.impressions} onChange={set("impressions")} disabled={!modifiable} />
      </Field>
      <Field label="Observations" facultatif>
        <textarea rows={2} value={v.observations} onChange={set("observations")} disabled={!modifiable} />
      </Field>
      {modifiable && (
        <div className="sess-actions">
          <Button variante="primary" compact onClick={enregistrer} disabled={enCours}>{enCours ? "En cours…" : "Enregistrer le suivi"}</Button>
        </div>
      )}
    </div>
  );
}
