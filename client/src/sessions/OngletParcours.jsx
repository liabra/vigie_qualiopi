import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState } from "../ui/index.js";
import { aujourdhuiISO } from "../qualite/format.js";
import {
  AIDE_ADAPTATION, AIDE_CONFIDENTIALITE, AIDE_SUIVI, CANAUX_RELANCE, CATEGORIES_ABANDON, CATEGORIES_ADAPTATION, CATEGORIES_SUIVI,
  CONCLUSIONS, EXEMPLES_ADAPTATION, MAX_MESURE, MAX_NOTE_SUIVI, MAX_TEXTE,
  PREREQUIS, STATUTS_ADAPTATION, STATUTS_INSCRIPTION, STATUTS_RECUEIL, TYPES_SUIVI,
  corpsAdaptation, corpsRecueil, corpsSuivi, dateFr, erreursAdaptation, erreursRecueil, erreursSuivi, etatRecueil, filtrerParcoursPar,
  issueInscription, libelleCategorieSuivi, libellePositionnement, resumeAdaptations, resumeSuivi, valeursAdaptation, valeursRecueil, valeursSuivi,
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
  const [filtre, setFiltre] = useState("tous"); // tous | recueil | adaptations
  const [ouvert, setOuvert] = useState(null); // ligne dont le recueil est ouvert
  const [adaptations, setAdaptations] = useState(null); // ligne dont les adaptations sont ouvertes
  const [suivi, setSuivi] = useState(null); // ligne dont le suivi et les relances sont ouverts

  const charger = useCallback(async () => {
    try { setParcours(await api(`/api/sessions/${sessionId}/parcours`)); setErr(null); }
    catch (e) { setErr(e.message); }
  }, [sessionId]);
  useEffect(() => { charger(); }, [charger]);

  if (err && !parcours) return <Alert ton="error" titre="Le parcours n'a pas pu être chargé." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>;
  if (!parcours) return <LoadingState texte="Chargement du parcours…" />;

  const positionnementParId = new Map(parcours.positionnements.map((p) => [p.id, p]));
  const lignes = filtrerParcoursPar(parcours.inscriptions, filtre);
  const vues = [
    { id: "tous", libelle: "Tous" },
    { id: "recueil", libelle: "Recueil à faire" },
    { id: "adaptations", libelle: "Adaptations à mettre en œuvre" },
  ];
  const modifiable = peutSaisir && !archivee && !parcours.archivee;

  return (
    <section className="sess-liste" aria-label="Parcours des stagiaires">
      {parcours.inscriptions.length === 0 ? (
        <EmptyState titre="Aucun stagiaire inscrit">Le parcours de chaque stagiaire apparaîtra ici dès son inscription.</EmptyState>
      ) : (
        <>
          <div className="sess-vues" role="group" aria-label="Filtrer le parcours">
            {vues.map((v) => (
              <button key={v.id} type="button" aria-pressed={filtre === v.id} className={"sess-vue" + (filtre === v.id ? " sess-vue--active" : "")} onClick={() => setFiltre(v.id)}>
                {v.libelle} <span className="sess-vue__compteur">{filtrerParcoursPar(parcours.inscriptions, v.id).length}</span>
              </button>
            ))}
          </div>
          {lignes.length === 0 ? (
            filtre === "adaptations"
              ? <EmptyState titre="Aucune adaptation à mettre en œuvre.">Toutes les mesures prévues sont mises en œuvre ou abandonnées.</EmptyState>
              : <EmptyState titre="Aucun recueil à faire.">Tous les recueils du besoin sont réalisés ou non applicables.</EmptyState>
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
                  <th scope="col">Suivi</th>
                  <th scope="col">Issue</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => {
                  const etat = etatRecueil(l);
                  const insc = STATUTS_INSCRIPTION[l.statut_inscription] || { libelle: l.statut_inscription, ton: "neutral" };
                  const pos = l.positionnement_id ? positionnementParId.get(l.positionnement_id) : null;
                  const nom = `${l.prenom} ${l.nom}`;
                  const issue = issueInscription(l);
                  const rs = resumeSuivi(l);
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
                      <td data-label="Adaptations">
                        {l.adaptations_total ? resumeAdaptations(l) : <span className="sess-secondaire">Aucune mesure</span>}
                      </td>
                      <td data-label="Suivi">
                        {rs.dernier ? <>{rs.dernier}<span className="sess-secondaire">{rs.relances}</span></> : <span className="sess-secondaire">Aucun suivi</span>}
                      </td>
                      <td data-label="Issue"><Badge ton={issue.ton}>{issue.libelle}</Badge></td>
                      <td className="sess-table__actions">
                        <Button compact onClick={() => setSuivi(l)} aria-label={`Suivi et relances de ${nom}`}>Suivi</Button>
                        <Button compact onClick={() => setAdaptations(l)} aria-label={`Adaptations de ${nom}`}>Adaptations</Button>
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

      {suivi && (
        <PanneauSuivi ligne={suivi} modifiable={modifiable} onFermer={() => setSuivi(null)} onChange={charger} />
      )}

      {adaptations && (
        <PanneauAdaptations ligne={adaptations} modifiable={modifiable} onFermer={() => setAdaptations(null)} onChange={charger} />
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

// Panneau « Adaptations » d'une inscription (Q2-2) : mesures pédagogiques
// OPÉRATIONNELLES seulement (jamais de diagnostic). Liste, ajout,
// modification, mise en œuvre, bilan, abandon de la mesure (sans
// suppression). Le formulaire ne se ferme qu'après succès.
function PanneauAdaptations({ ligne, modifiable, onFermer, onChange }) {
  const [donnees, setDonnees] = useState(null);
  const [errChargement, setErrChargement] = useState(null);
  const [edition, setEdition] = useState(null); // { id|null, valeurs }
  const [erreurs, setErreurs] = useState({});
  const [erreurServeur, setErreurServeur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const [aAbandonner, setAAbandonner] = useState(null);
  const verrou = useRef(false);
  const base = `/api/inscriptions/${ligne.inscription_id}/adaptations`;

  const charger = useCallback(async () => {
    try { setDonnees(await api(base)); setErrChargement(null); }
    catch (e) { setErrChargement(e.message); }
  }, [base]);
  useEffect(() => { charger(); }, [charger]);

  const lecture = !modifiable || donnees?.archivee;
  const ouvrir = (a, sur = {}) => {
    setErreurs({}); setErreurServeur(null);
    setEdition({ id: a?.id ?? null, valeurs: { ...valeursAdaptation(a), ...(a ? {} : { date_decision: aujourdhuiISO() }), ...sur } });
  };
  const champ = (cle) => (e) => setEdition((ed) => ({ ...ed, valeurs: { ...ed.valeurs, [cle]: e.target.value } }));

  async function envoyer(id, corps) {
    if (verrou.current) return false; // fix : jamais de double soumission
    verrou.current = true;
    setEnCours(true);
    setErreurServeur(null);
    try {
      if (id) await api(`${base}/${id}`, { method: "PATCH", body: JSON.stringify(corps) });
      else await api(base, { method: "POST", body: JSON.stringify(corps) });
      await Promise.all([charger(), onChange?.()]);
      return true;
    } catch (err) {
      setErreurServeur(err.message);
      return false;
    } finally {
      verrou.current = false;
      setEnCours(false);
    }
  }

  async function enregistrer(e) {
    e.preventDefault();
    if (lecture) return;
    const trouvees = erreursAdaptation(edition.valeurs);
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    if (await envoyer(edition.id, corpsAdaptation(edition.valeurs))) setEdition(null);
  }

  async function abandonner() {
    if (await envoyer(aAbandonner.id, { statut: "abandonnee" })) setAAbandonner(null);
    else setAAbandonner(null);
  }

  const liste = donnees?.adaptations || [];
  return (
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} taille="large" titre="Adaptations pédagogiques"
      description={`${ligne.prenom} ${ligne.nom}`}
      pied={edition && !lecture ? (
        <>
          <Button onClick={() => setEdition(null)} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-adaptation" disabled={enCours}>{enCours ? "Enregistrement…" : edition.id ? "Enregistrer la mesure" : "Ajouter la mesure"}</Button>
        </>
      ) : <Button onClick={onFermer} disabled={enCours}>Fermer</Button>}>
      {errChargement && <Alert ton="error" titre="Les adaptations n'ont pas pu être chargées." action={<Button compact onClick={charger}>Réessayer</Button>}>{errChargement}</Alert>}
      {!donnees && !errChargement && <LoadingState texte="Chargement des adaptations…" />}
      {donnees && (
        <div className="ui-form">
          {lecture && <Alert ton="info">{donnees.archivee ? "Session archivée : adaptations en lecture seule." : "Consultation seule."}</Alert>}
          {erreurServeur && <Alert ton="error" titre="La mesure n'a pas été enregistrée.">{erreurServeur}</Alert>}

          {edition && !lecture ? (
            <form id="form-adaptation" onSubmit={enregistrer} noValidate className="ui-form">
              <Alert ton="info" titre="Mesures pédagogiques uniquement">
                <p>{AIDE_ADAPTATION}</p>
                <p className="sess-secondaire">Exemples : {EXEMPLES_ADAPTATION.join(" ")}</p>
              </Alert>
              <FormSection titre={edition.id ? "Modifier la mesure" : "Nouvelle mesure"} colonnes={2}>
                <Field label="Catégorie" erreur={erreurs.categorie}>
                  <select value={edition.valeurs.categorie} onChange={champ("categorie")} required>
                    <option value="">Choisir une catégorie</option>
                    {Object.entries(CATEGORIES_ADAPTATION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Statut">
                  <select value={edition.valeurs.statut} onChange={champ("statut")}>
                    {Object.entries(STATUTS_ADAPTATION).map(([k, st]) => <option key={k} value={k}>{st.libelle}</option>)}
                  </select>
                </Field>
                <Field label="Mesure mise en place" erreur={erreurs.mesure} aide={AIDE_ADAPTATION} className="ui-field--large">
                  <textarea rows={3} maxLength={MAX_MESURE} value={edition.valeurs.mesure} onChange={champ("mesure")} required />
                </Field>
                <Field label="Date de décision" erreur={erreurs.date_decision}>
                  <input type="date" value={edition.valeurs.date_decision} onChange={champ("date_decision")} required />
                </Field>
                <Field label="Date de mise en œuvre" facultatif={edition.valeurs.statut !== "mise_en_oeuvre"} erreur={erreurs.date_mise_en_oeuvre}>
                  <input type="date" value={edition.valeurs.date_mise_en_oeuvre} onChange={champ("date_mise_en_oeuvre")} />
                </Field>
                <Field label="Bilan" facultatif erreur={erreurs.bilan} aide="Ce que la mesure a apporté (opérationnel)." className="ui-field--large">
                  <textarea rows={2} maxLength={MAX_MESURE} value={edition.valeurs.bilan} onChange={champ("bilan")} />
                </Field>
              </FormSection>
            </form>
          ) : (
            <>
              {!lecture && <div><Button variante="primary" compact onClick={() => ouvrir(null)}>Ajouter une mesure</Button></div>}
              {liste.length === 0 ? (
                <EmptyState titre="Aucune adaptation">Aucune mesure pédagogique n'a été décidée pour ce stagiaire.</EmptyState>
              ) : (
                <ul className="adaptations-liste" aria-label="Mesures pédagogiques">
                  {liste.map((a) => {
                    const st = STATUTS_ADAPTATION[a.statut] || { libelle: a.statut, ton: "neutral" };
                    const date = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : null);
                    return (
                      <li key={a.id} className="adaptation">
                        <div className="adaptation__tete">
                          <Badge ton={st.ton}>{st.libelle}</Badge>
                          <span className="sess-secondaire">{CATEGORIES_ADAPTATION[a.categorie] || a.categorie}</span>
                        </div>
                        <p className="adaptation__mesure">{a.mesure}</p>
                        <span className="sess-secondaire">
                          Décidée le {date(a.date_decision)}{a.date_mise_en_oeuvre ? ` · mise en œuvre le ${date(a.date_mise_en_oeuvre)}` : ""}
                        </span>
                        {a.bilan && <p className="adaptation__bilan"><strong>Bilan :</strong> {a.bilan}</p>}
                        <span className="sess-secondaire">
                          {a.cree_par_nom ? `Saisie par ${a.cree_par_nom}` : ""}{a.mis_a_jour_par_nom ? ` · dernière modification par ${a.mis_a_jour_par_nom}` : ""}
                        </span>
                        {!lecture && a.statut !== "abandonnee" && (
                          <div className="sess-actions">
                            <Button compact onClick={() => ouvrir(a)}>Modifier</Button>
                            {a.statut === "prevue" && (
                              <Button compact onClick={() => ouvrir(a, { statut: "mise_en_oeuvre", date_mise_en_oeuvre: aujourdhuiISO() })}>Marquer comme mise en œuvre</Button>
                            )}
                            {a.statut === "mise_en_oeuvre" && !a.bilan && <Button compact onClick={() => ouvrir(a)}>Renseigner le bilan</Button>}
                            <Button compact variante="danger" onClick={() => setAAbandonner(a)}>Abandonner la mesure</Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      )}
      <ConfirmDialog ouvert={!!aAbandonner} titre="Abandonner cette mesure ?" libelleConfirmer="Abandonner la mesure"
        ton="danger" enCours={enCours} onConfirmer={abandonner} onAnnuler={() => setAAbandonner(null)}>
        La mesure restera dans le suivi avec le statut « Mesure abandonnée ». Cela ne concerne pas l'inscription du stagiaire à la formation.
      </ConfirmDialog>
    </Drawer>
  );
}

// Panneau « Suivi et relances » d'une inscription (Q2-3) : espace de suivi
// INDIVIDUEL — seul endroit où la catégorie et la précision d'abandon, et
// les notes, sont affichées. Événements FACTUELS seulement ; aucune
// suppression, aucune notification automatique.
function PanneauSuivi({ ligne, modifiable, onFermer, onChange }) {
  const [donnees, setDonnees] = useState(null);
  const [errChargement, setErrChargement] = useState(null);
  const [edition, setEdition] = useState(null); // { id|null, valeurs }
  const [erreurs, setErreurs] = useState({});
  const [erreurServeur, setErreurServeur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const verrou = useRef(false);
  const base = `/api/inscriptions/${ligne.inscription_id}/suivi`;

  const charger = useCallback(async () => {
    try { setDonnees(await api(base)); setErrChargement(null); }
    catch (e) { setErrChargement(e.message); }
  }, [base]);
  useEffect(() => { charger(); }, [charger]);

  const lecture = !modifiable || donnees?.archivee;
  const ouvrir = (e, sur = {}) => {
    setErreurs({}); setErreurServeur(null);
    setEdition({ id: e?.id ?? null, valeurs: { ...valeursSuivi(e), ...(e ? {} : { date_evenement: aujourdhuiISO() }), ...sur } });
  };
  const champ = (cle) => (ev) => setEdition((ed) => ({ ...ed, valeurs: { ...ed.valeurs, [cle]: ev.target.value } }));

  async function enregistrer(ev) {
    ev.preventDefault();
    if (lecture || verrou.current) return; // fix : jamais de double soumission
    const trouvees = erreursSuivi(edition.valeurs);
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    verrou.current = true;
    setEnCours(true);
    setErreurServeur(null);
    try {
      const corps = corpsSuivi(edition.valeurs, { creation: !edition.id });
      if (edition.id) await api(`${base}/${edition.id}`, { method: "PATCH", body: JSON.stringify(corps) });
      else await api(base, { method: "POST", body: JSON.stringify(corps) });
      await Promise.all([charger(), onChange?.()]);
      setEdition(null);
    } catch (err) {
      setErreurServeur(err.message); // la saisie reste dans le formulaire
    } finally {
      verrou.current = false;
      setEnCours(false);
    }
  }

  const insc = donnees?.inscription;
  const evenements = donnees?.evenements || [];
  const statut = insc ? (STATUTS_INSCRIPTION[insc.statut] || { libelle: insc.statut, ton: "neutral" }) : null;
  const v = edition?.valeurs;
  return (
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} taille="large" titre="Suivi et relances"
      description={`${ligne.prenom} ${ligne.nom}`}
      pied={edition && !lecture ? (
        <>
          <Button onClick={() => setEdition(null)} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-suivi" disabled={enCours}>{enCours ? "Enregistrement…" : edition.id ? "Enregistrer la correction" : "Enregistrer"}</Button>
        </>
      ) : <Button onClick={onFermer} disabled={enCours}>Fermer</Button>}>
      {errChargement && <Alert ton="error" titre="Le suivi n'a pas pu être chargé." action={<Button compact onClick={charger}>Réessayer</Button>}>{errChargement}</Alert>}
      {!donnees && !errChargement && <LoadingState texte="Chargement du suivi…" />}
      {donnees && (
        <div className="ui-form">
          {lecture && <Alert ton="info">{donnees.archivee ? "Session archivée : suivi en lecture seule." : "Consultation seule."}</Alert>}
          {erreurServeur && <Alert ton="error" titre="L'événement n'a pas été enregistré.">{erreurServeur}</Alert>}

          <div className="suivi-inscription" aria-label="Inscription">
            <Badge ton={statut.ton}>{statut.libelle}</Badge>
            {insc.statut === "abandon" && (
              <span className="sess-secondaire">
                {insc.date_abandon ? `Abandon le ${dateFr(insc.date_abandon)}` : "Abandon"}
                {` · Catégorie : ${CATEGORIES_ABANDON[insc.categorie_abandon] || "non précisée"}`}
                {insc.motif_abandon ? ` · Précision : ${insc.motif_abandon}` : ""}
              </span>
            )}
          </div>

          {edition && !lecture ? (
            <form id="form-suivi" onSubmit={enregistrer} noValidate className="ui-form">
              <Alert ton="info" titre="Faits observés uniquement"><p>{AIDE_SUIVI}</p></Alert>
              <FormSection titre={edition.id ? `Corriger : ${TYPES_SUIVI[v.type].libelle.toLowerCase()}` : TYPES_SUIVI[v.type].libelle} colonnes={2}>
                <Field label="Date" erreur={erreurs.date_evenement}>
                  <input type="date" value={v.date_evenement} onChange={champ("date_evenement")} required />
                </Field>
                <Field label="Catégorie" erreur={erreurs.categorie}>
                  <select value={v.categorie} onChange={champ("categorie")} required>
                    <option value="">Choisir une catégorie</option>
                    {Object.entries(CATEGORIES_SUIVI[v.type]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </Field>
                {v.type === "relance" && (
                  <Field label="Canal" erreur={erreurs.canal}>
                    <select value={v.canal} onChange={champ("canal")} required>
                      <option value="">Choisir un canal</option>
                      {Object.entries(CANAUX_RELANCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Note" facultatif erreur={erreurs.note} aide={AIDE_SUIVI} className="ui-field--large">
                  <textarea rows={2} maxLength={MAX_NOTE_SUIVI} value={v.note} onChange={champ("note")} />
                </Field>
              </FormSection>
            </form>
          ) : (
            <>
              {!lecture && (
                <div className="sess-actions">
                  <Button variante="primary" compact onClick={() => ouvrir(null, { type: "signal" })}>Ajouter un signal</Button>
                  <Button compact onClick={() => ouvrir(null, { type: "relance" })}>Ajouter une relance</Button>
                </div>
              )}
              {evenements.length === 0 ? (
                <EmptyState titre="Aucun suivi">Aucun signal ni aucune relance n'a été enregistré pour ce stagiaire.</EmptyState>
              ) : (
                <ul className="adaptations-liste" aria-label="Événements de suivi">
                  {evenements.map((e) => (
                    <li key={e.id} className="adaptation">
                      <div className="adaptation__tete">
                        <Badge ton={TYPES_SUIVI[e.type]?.ton || "neutral"}>{TYPES_SUIVI[e.type]?.libelle || e.type}</Badge>
                        <span className="sess-secondaire">le {dateFr(e.date_evenement)}{e.canal ? ` · ${CANAUX_RELANCE[e.canal] || e.canal}` : ""}</span>
                      </div>
                      <p className="adaptation__mesure">{libelleCategorieSuivi(e.type, e.categorie)}</p>
                      {e.note && <p className="adaptation__bilan">{e.note}</p>}
                      <span className="sess-secondaire">
                        {e.cree_par_nom ? `Saisi par ${e.cree_par_nom}` : ""}{e.mis_a_jour_par_nom && e.mis_a_jour_le !== e.cree_le ? ` · corrigé par ${e.mis_a_jour_par_nom}` : ""}
                      </span>
                      {!lecture && <div className="sess-actions"><Button compact onClick={() => ouvrir(e)} aria-label={`Corriger l'événement du ${dateFr(e.date_evenement)}`}>Corriger</Button></div>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
