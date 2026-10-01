import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, Drawer, EmptyState, Field, FormSection, LoadingState } from "../ui/index.js";
import {
  AIDE_CONFIDENTIALITE, CONCLUSIONS, MAX_TEXTE, PREREQUIS, STATUTS_INSCRIPTION, STATUTS_RECUEIL,
  corpsRecueil, erreursRecueil, etatRecueil, filtrerParcours, libellePositionnement, valeursRecueil,
} from "./parcours-format.js";

// Onglet « Parcours » (Q2-1) : une ligne par inscription — état du recueil du
// besoin, positionnement associé, conclusion, statut de l'inscription.
// Lecture AGRÉGÉE (un appel) ; les textes libres ne sont chargés qu'à
// l'ouverture du recueil d'une inscription. Le recueil ne bloque rien
// (assiduité, documents, évaluations, clôture).
export function OngletParcours({ donnees, peutSaisir, archivee, notifier }) {
  const sessionId = donnees.session.id;
  const [parcours, setParcours] = useState(null);
  const [err, setErr] = useState(null);
  const [aFaire, setAFaire] = useState(false);
  const [ouvert, setOuvert] = useState(null); // ligne dont le recueil est ouvert

  const charger = useCallback(async () => {
    try { setParcours(await api(`/api/sessions/${sessionId}/parcours`)); setErr(null); }
    catch (e) { setErr(e.message); }
  }, [sessionId]);
  useEffect(() => { charger(); }, [charger]);

  if (err && !parcours) return <Alert ton="error" titre="Le parcours n'a pas pu être chargé." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>;
  if (!parcours) return <LoadingState texte="Chargement du parcours…" />;

  const positionnementParId = new Map(parcours.positionnements.map((p) => [p.id, p]));
  const lignes = filtrerParcours(parcours.inscriptions, { aFaire });
  const modifiable = peutSaisir && !archivee && !parcours.archivee;

  return (
    <section className="sess-liste" aria-label="Parcours des stagiaires">
      {parcours.inscriptions.length === 0 ? (
        <EmptyState titre="Aucun stagiaire inscrit">Le parcours de chaque stagiaire apparaîtra ici dès son inscription.</EmptyState>
      ) : (
        <>
          <div className="sess-vues" role="group" aria-label="Filtrer le parcours">
            <button type="button" aria-pressed={!aFaire} className={"sess-vue" + (!aFaire ? " sess-vue--active" : "")} onClick={() => setAFaire(false)}>
              Tous <span className="sess-vue__compteur">{parcours.inscriptions.length}</span>
            </button>
            <button type="button" aria-pressed={aFaire} className={"sess-vue" + (aFaire ? " sess-vue--active" : "")} onClick={() => setAFaire(true)}>
              Recueil à faire <span className="sess-vue__compteur">{filtrerParcours(parcours.inscriptions, { aFaire: true }).length}</span>
            </button>
          </div>
          {lignes.length === 0 ? (
            <EmptyState titre="Aucun recueil à faire.">Tous les recueils du besoin sont réalisés ou non applicables.</EmptyState>
          ) : (
            <table className="sess-table">
              <caption className="visually-hidden">Parcours ({lignes.length})</caption>
              <thead>
                <tr>
                  <th scope="col">Stagiaire</th>
                  <th scope="col">Recueil du besoin</th>
                  <th scope="col">Positionnement</th>
                  <th scope="col">Conclusion</th>
                  <th scope="col">Adaptations</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => {
                  const etat = etatRecueil(l);
                  const insc = STATUTS_INSCRIPTION[l.statut_inscription] || { libelle: l.statut_inscription, ton: "neutral" };
                  const pos = l.positionnement_id ? positionnementParId.get(l.positionnement_id) : null;
                  const nom = `${l.prenom} ${l.nom}`;
                  return (
                    <tr key={l.inscription_id}>
                      <td data-label="Stagiaire" className="sess-table__principal">
                        {nom}
                        <span className="sess-secondaire"><Badge ton={insc.ton}>{insc.libelle}</Badge></span>
                      </td>
                      <td data-label="Recueil du besoin">
                        <Badge ton={etat.ton}>{etat.libelle}</Badge>
                        {l.date_recueil && <span className="sess-secondaire">le {String(l.date_recueil).slice(0, 10).split("-").reverse().join("/")}</span>}
                      </td>
                      <td data-label="Positionnement">{pos ? libellePositionnement(pos) : <span className="sess-secondaire">—</span>}</td>
                      <td data-label="Conclusion">{CONCLUSIONS[l.conclusion] || <span className="sess-secondaire">—</span>}</td>
                      <td data-label="Adaptations"><span className="sess-secondaire">Suivi à venir</span></td>
                      <td className="sess-table__actions">
                        <Button compact onClick={() => setOuvert(l)} aria-label={`${modifiable ? (l.recueil_statut ? "Modifier" : "Renseigner") : "Consulter"} le recueil de ${nom}`}>
                          {modifiable ? (l.recueil_statut ? "Modifier" : "Renseigner") : "Consulter"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}

      {ouvert && (
        <PanneauRecueil ligne={ouvert} modifiable={modifiable} onFermer={() => setOuvert(null)}
          onEnregistre={async () => {
            setOuvert(null);
            notifier?.({ ton: "success", titre: `Recueil du besoin enregistré pour ${ouvert.prenom} ${ouvert.nom}.` });
            await charger();
          }} />
      )}
    </section>
  );
}

// Panneau « Recueil du besoin » d'une inscription. Lecture seule si la
// session est archivée ou sans droit de saisie.
function PanneauRecueil({ ligne, modifiable, onFermer, onEnregistre }) {
  const [donnees, setDonnees] = useState(null);
  const [valeurs, setValeurs] = useState(null);
  const [errChargement, setErrChargement] = useState(null);
  const [erreurs, setErreurs] = useState({});
  const [erreurServeur, setErreurServeur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const verrou = useRef(false);

  useEffect(() => {
    let actif = true;
    api(`/api/inscriptions/${ligne.inscription_id}/recueil`)
      .then((r) => { if (actif) { setDonnees(r); setValeurs(valeursRecueil(r.recueil)); } })
      .catch((e) => { if (actif) setErrChargement(e.message); });
    return () => { actif = false; };
  }, [ligne.inscription_id]);

  const champ = (cle) => (e) => setValeurs((v) => ({ ...v, [cle]: e.target.value }));
  const lecture = !modifiable || donnees?.archivee;

  async function enregistrer(e) {
    e.preventDefault();
    if (lecture || verrou.current) return; // fix : jamais de double enregistrement
    const trouvees = erreursRecueil(valeurs);
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    verrou.current = true;
    setEnCours(true);
    setErreurServeur(null);
    try {
      await api(`/api/inscriptions/${ligne.inscription_id}/recueil`, { method: "PUT", body: JSON.stringify(corpsRecueil(valeurs)) });
      await onEnregistre();
    } catch (err) {
      setErreurServeur(err.message);
      setEnCours(false);
      verrou.current = false;
    }
  }

  return (
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} taille="large" titre="Recueil du besoin"
      description={`${ligne.prenom} ${ligne.nom}`}
      pied={lecture ? <Button onClick={onFermer}>Fermer</Button> : (
        <>
          <Button onClick={onFermer} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-recueil" disabled={enCours || !valeurs}>{enCours ? "Enregistrement…" : "Enregistrer"}</Button>
        </>
      )}>
      {errChargement && <Alert ton="error" titre="Le recueil n'a pas pu être chargé.">{errChargement}</Alert>}
      {!valeurs && !errChargement && <LoadingState texte="Chargement du recueil…" />}
      {valeurs && (
        <form id="form-recueil" onSubmit={enregistrer} noValidate>
          {lecture && <Alert ton="info">{donnees.archivee ? "Session archivée : recueil en lecture seule." : "Consultation seule."}</Alert>}
          {erreurServeur && <Alert ton="error" titre="Le recueil n'a pas été enregistré.">{erreurServeur}</Alert>}
          <fieldset className="ui-form-lecture" disabled={lecture}>
            <FormSection titre="Recueil" colonnes={2}>
              <Field label="Statut">
                <select value={valeurs.statut} onChange={champ("statut")}>
                  {Object.entries(STATUTS_RECUEIL).map(([k, s]) => <option key={k} value={k}>{s.libelle}</option>)}
                </select>
              </Field>
              <Field label="Date du recueil" facultatif={valeurs.statut !== "realise"} erreur={erreurs.date_recueil}>
                <input type="date" value={valeurs.date_recueil} onChange={champ("date_recueil")} />
              </Field>
            </FormSection>
            <FormSection titre="Besoins de formation" colonnes={1}>
              <Field label="Attentes" facultatif aide={AIDE_CONFIDENTIALITE} erreur={erreurs.attentes}>
                <textarea rows={4} maxLength={MAX_TEXTE} value={valeurs.attentes} onChange={champ("attentes")} />
              </Field>
              <Field label="Objectifs personnels" facultatif aide={AIDE_CONFIDENTIALITE} erreur={erreurs.objectifs_personnels}>
                <textarea rows={3} maxLength={MAX_TEXTE} value={valeurs.objectifs_personnels} onChange={champ("objectifs_personnels")} />
              </Field>
            </FormSection>
            <FormSection titre="Positionnement et conclusion" colonnes={2}>
              <Field label="Prérequis vérifiés" facultatif>
                <select value={valeurs.prerequis_verifies} onChange={champ("prerequis_verifies")}>
                  <option value="">Non renseigné</option>
                  {Object.entries(PREREQUIS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
              <Field label="Conclusion" facultatif>
                <select value={valeurs.conclusion} onChange={champ("conclusion")}>
                  <option value="">Non renseignée</option>
                  {Object.entries(CONCLUSIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
              <Field label="Positionnement associé" facultatif className="ui-field--large"
                aide={donnees.positionnements.length === 0 ? "Aucun positionnement saisi pour ce stagiaire : ajoutez-le dans l'onglet Évaluations (type « Positionnement »)." : "Résultats de positionnement déjà saisis pour ce stagiaire."}>
                <select value={valeurs.positionnement_id} onChange={champ("positionnement_id")}>
                  <option value="">Aucun</option>
                  {donnees.positionnements.map((p) => <option key={p.id} value={p.id}>{libellePositionnement(p)}</option>)}
                </select>
              </Field>
            </FormSection>
          </fieldset>
          {donnees.recueil?.realise_par_nom && <p className="sess-secondaire">Recueil réalisé par {donnees.recueil.realise_par_nom}.</p>}
        </form>
      )}
    </Drawer>
  );
}
