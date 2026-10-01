import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState } from "../ui/index.js";
import { aujourdhuiISO } from "../qualite/format.js";
import {
  AIDE_ABANDON, AIDE_ADAPTATION, AIDE_CONFIDENTIALITE, AIDE_SUIVI, CANAUX_RELANCE, CATEGORIES_ABANDON, CATEGORIES_ADAPTATION, CATEGORIES_SUIVI,
  CONCLUSIONS, EXEMPLES_ADAPTATION, MAX_MESURE, MAX_MOTIF_ABANDON, MAX_NOTE_SUIVI, MAX_TEXTE,
  PREREQUIS, STATUTS_ADAPTATION, STATUTS_INSCRIPTION, STATUTS_RECUEIL, TYPES_SUIVI,
  AIDE_SECTION_BESOINS, AIDE_SECTION_MESURES, AIDE_SECTION_SUIVI, INTRO_ACCOMPAGNEMENT,
  corpsAdaptation, corpsComplementAbandon, corpsRecueil, corpsSuivi, dateFr, erreursAdaptation, erreursRecueil, erreursSuivi, etatRecueil, filtrerParcoursPar,
  libelleCategorieSuivi, libellePositionnement, resumeMesures, resumePopulation, resumeSuivi, situationInscription, valeursAdaptation, valeursRecueil, valeursSuivi,
} from "./parcours-format.js";

// Onglet « Accompagnement » (route /parcours ; Q2-1 → Q2-3, UX-Q2) : une
// ligne par inscription — besoins et positionnement, mesures pédagogiques,
// observations et relances, situation de l'inscription — et UN seul bouton
// « Ouvrir le dossier ». Lecture AGRÉGÉE (un appel, sans texte libre) ; les
// textes ne sont chargés qu'à l'ouverture d'un panneau. Rien ne bloque
// l'assiduité, les documents, les évaluations ni la clôture.
export function OngletParcours({ donnees, peutSaisir, archivee, notifier }) {
  const sessionId = donnees.session.id;
  const [parcours, setParcours] = useState(null);
  const [err, setErr] = useState(null);
  const [filtre, setFiltre] = useState("tous"); // tous | recueil | adaptations
  const [dossier, setDossier] = useState(null); // ligne dont le dossier d'accompagnement est ouvert
  const [vue, setVue] = useState(null); // null (dossier) | "recueil" | "mesures" | "suivi"

  const charger = useCallback(async () => {
    try { setParcours(await api(`/api/sessions/${sessionId}/parcours`)); setErr(null); }
    catch (e) { setErr(e.message); }
  }, [sessionId]);
  useEffect(() => { charger(); }, [charger]);

  if (err && !parcours) return <Alert ton="error" titre="L'accompagnement n'a pas pu être chargé." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>;
  if (!parcours) return <LoadingState texte="Chargement de l'accompagnement…" />;

  const positionnementParId = new Map(parcours.positionnements.map((p) => [p.id, p]));
  const lignes = filtrerParcoursPar(parcours.inscriptions, filtre);
  const vues = [
    { id: "tous", libelle: "Toutes les inscriptions" },
    { id: "recueil", libelle: "Besoins à recueillir" },
    { id: "adaptations", libelle: "Mesures à mettre en œuvre" },
  ];
  const modifiable = peutSaisir && !archivee && !parcours.archivee;
  // Ligne à jour (après rechargement) pour le dossier ouvert.
  const ligneDossier = dossier ? (parcours.inscriptions.find((l) => l.inscription_id === dossier.inscription_id) || dossier) : null;
  const total = parcours.inscriptions.length;
  const abandons = parcours.inscriptions.filter((l) => l.statut_inscription === "abandon").length;

  return (
    <section className="sess-liste" aria-label="Accompagnement des stagiaires">
      <p className="sess-secondaire">{INTRO_ACCOMPAGNEMENT}</p>
      {total === 0 ? (
        <EmptyState titre="Aucun stagiaire inscrit">L'accompagnement de chaque stagiaire apparaîtra ici dès son inscription.</EmptyState>
      ) : (
        <>
          <div className="sess-vues" role="group" aria-label="Filtrer l'accompagnement">
            {vues.map((v) => (
              <button key={v.id} type="button" aria-pressed={filtre === v.id} className={"sess-vue" + (filtre === v.id ? " sess-vue--active" : "")} onClick={() => setFiltre(v.id)}>
                {v.libelle} <span className="sess-vue__compteur">{filtrerParcoursPar(parcours.inscriptions, v.id).length}</span>
              </button>
            ))}
          </div>
          <p className="sess-secondaire">{resumePopulation(total, abandons)}</p>
          {lignes.length === 0 ? (
            filtre === "adaptations"
              ? <EmptyState titre="Aucune mesure à mettre en œuvre.">Toutes les mesures prévues sont mises en œuvre ou abandonnées.</EmptyState>
              : <EmptyState titre="Aucun besoin à recueillir.">Tous les recueils du besoin sont réalisés ou non applicables.</EmptyState>
          ) : (
            <table className="sess-table">
              <caption className="visually-hidden">Accompagnement ({lignes.length})</caption>
              <thead>
                <tr>
                  <th scope="col">Stagiaire</th>
                  <th scope="col">Besoins et positionnement</th>
                  <th scope="col">Mesures pédagogiques</th>
                  <th scope="col">Observations et relances</th>
                  <th scope="col">Situation de l'inscription</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l) => {
                  const etat = etatRecueil(l);
                  const situation = situationInscription(l);
                  const pos = l.positionnement_id ? positionnementParId.get(l.positionnement_id) : null;
                  const rs = resumeSuivi(l);
                  const nom = `${l.prenom} ${l.nom}`;
                  return (
                    <tr key={l.inscription_id}>
                      <td data-label="Stagiaire" className="sess-table__principal">{nom}</td>
                      <td data-label="Besoins et positionnement">
                        <Badge ton={etat.ton}>{etat.libelle}</Badge>
                        <span className="sess-secondaire">{pos ? libellePositionnement(pos) : "Aucun positionnement associé"}</span>
                      </td>
                      <td data-label="Mesures pédagogiques">{resumeMesures(l)}</td>
                      <td data-label="Observations et relances">
                        {rs.dernier ? <>{rs.dernier}<span className="sess-secondaire">{rs.relances}</span></> : <span className="sess-secondaire">Aucune observation ni relance</span>}
                      </td>
                      <td data-label="Situation de l'inscription"><Badge ton={situation.ton}>{situation.libelle}</Badge></td>
                      <td className="sess-table__actions">
                        <Button compact onClick={() => { setVue(null); setDossier(l); }} aria-label={`Ouvrir le dossier d'accompagnement de ${nom}`}>Ouvrir le dossier</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}

      {ligneDossier && vue === null && (
        <DossierAccompagnement ligne={ligneDossier} positionnement={ligneDossier.positionnement_id ? positionnementParId.get(ligneDossier.positionnement_id) : null}
          modifiable={modifiable} onOuvrir={setVue} onFermer={() => setDossier(null)} />
      )}
      {/* Panneaux existants (Q2-1, Q2-2, Q2-3) réutilisés tels quels : ils
          remplacent le dossier le temps de la saisie, puis on y revient. */}
      {ligneDossier && vue === "recueil" && (
        <PanneauRecueil ligne={ligneDossier} modifiable={modifiable} onFermer={() => setVue(null)}
          onEnregistre={async () => {
            setVue(null);
            notifier?.({ ton: "success", titre: `Besoins et positionnement enregistrés pour ${ligneDossier.prenom} ${ligneDossier.nom}.` });
            await charger();
          }} />
      )}
      {ligneDossier && vue === "mesures" && (
        <PanneauAdaptations ligne={ligneDossier} modifiable={modifiable} onFermer={() => setVue(null)} onChange={charger} />
      )}
      {ligneDossier && vue === "suivi" && (
        <PanneauSuivi ligne={ligneDossier} modifiable={modifiable} onFermer={() => setVue(null)} onChange={charger} />
      )}
    </section>
  );
}

// Dossier d'accompagnement : trois sections, chacune avec une explication
// courte, l'état synthétique (aucun texte libre) et l'accès au panneau
// existant correspondant.
function DossierAccompagnement({ ligne, positionnement, modifiable, onOuvrir, onFermer }) {
  const nom = `${ligne.prenom} ${ligne.nom}`;
  const etat = etatRecueil(ligne);
  const situation = situationInscription(ligne);
  const rs = resumeSuivi(ligne);
  const action = (consulter, gerer) => (modifiable ? gerer : consulter);
  const sections = [
    {
      id: "recueil", titre: "Besoins et positionnement", aide: AIDE_SECTION_BESOINS,
      etat: <><Badge ton={etat.ton}>{etat.libelle}</Badge> <span className="sess-secondaire">{positionnement ? libellePositionnement(positionnement) : "Aucun positionnement associé"}{ligne.conclusion ? ` · ${CONCLUSIONS[ligne.conclusion]}` : ""}</span></>,
      bouton: action("Consulter les besoins et le positionnement", ligne.recueil_statut ? "Modifier les besoins et le positionnement" : "Renseigner les besoins et le positionnement"),
    },
    {
      id: "mesures", titre: "Mesures pédagogiques", aide: AIDE_SECTION_MESURES,
      etat: <span>{resumeMesures(ligne)}</span>,
      bouton: action("Consulter les mesures pédagogiques", "Gérer les mesures pédagogiques"),
    },
    {
      id: "suivi", titre: "Observations et relances", aide: AIDE_SECTION_SUIVI,
      etat: <span>{rs.dernier ? `Dernier événement : ${rs.dernier} · ${rs.relances}` : "Aucune observation ni relance"}</span>,
      bouton: action("Consulter les observations et relances", "Gérer les observations et relances"),
    },
  ];
  return (
    <Drawer ouvert onFermer={onFermer} taille="large" titre="Dossier d'accompagnement" description={nom}
      pied={<Button onClick={onFermer}>Fermer</Button>}>
      <div className="ui-form">
        <div className="suivi-inscription">
          <span>Situation de l'inscription :</span> <Badge ton={situation.ton}>{situation.libelle}</Badge>
        </div>
        {!modifiable && <Alert ton="info">Consultation seule.</Alert>}
        <ol className="accompagnement-sections">
          {sections.map((sec, i) => (
            <li key={sec.id} className="adaptation">
              <h3 className="accompagnement-sections__titre">{i + 1}. {sec.titre}</h3>
              <p className="sess-secondaire">{sec.aide}</p>
              <div>{sec.etat}</div>
              <div className="sess-actions"><Button compact onClick={() => onOuvrir(sec.id)}>{sec.bouton}</Button></div>
            </li>
          ))}
        </ol>
      </div>
    </Drawer>
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
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} taille="large" titre="Besoins et positionnement"
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
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} taille="large" titre="Mesures pédagogiques"
      description={`${ligne.prenom} ${ligne.nom}`}
      pied={edition && !lecture ? (
        <>
          <Button onClick={() => setEdition(null)} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-adaptation" disabled={enCours}>{enCours ? "Enregistrement…" : edition.id ? "Enregistrer la mesure" : "Ajouter la mesure"}</Button>
        </>
      ) : <Button onClick={onFermer} disabled={enCours}>Fermer</Button>}>
      {errChargement && <Alert ton="error" titre="Les mesures pédagogiques n'ont pas pu être chargées." action={<Button compact onClick={charger}>Réessayer</Button>}>{errChargement}</Alert>}
      {!donnees && !errChargement && <LoadingState texte="Chargement des mesures pédagogiques…" />}
      {donnees && (
        <div className="ui-form">
          {lecture && <Alert ton="info">{donnees.archivee ? "Session archivée : mesures pédagogiques en lecture seule." : "Consultation seule."}</Alert>}
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
                <EmptyState titre="Aucune mesure pédagogique">Aucune mesure pédagogique n'a été décidée pour ce stagiaire.</EmptyState>
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
                            <Button compact onClick={() => ouvrir(a)}>Modifier la mesure</Button>
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
  const [complement, setComplement] = useState(null); // { categorie_abandon, motif_abandon }
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
  const ouvrirComplement = () => {
    setErreurServeur(null);
    setComplement({ categorie_abandon: donnees.inscription.categorie_abandon || "", motif_abandon: donnees.inscription.motif_abandon || "" });
  };

  // Complète / corrige un abandon EXISTANT : ni statut ni date envoyés
  // (aucune nouvelle transition, effectifs et assiduité inchangés).
  async function enregistrerComplement(ev) {
    ev.preventDefault();
    if (lecture || verrou.current) return; // fix : jamais de double soumission
    verrou.current = true;
    setEnCours(true);
    setErreurServeur(null);
    try {
      await api(`/api/inscriptions/${ligne.inscription_id}`, { method: "PATCH", body: JSON.stringify(corpsComplementAbandon(complement)) });
      await Promise.all([charger(), onChange?.()]);
      setComplement(null);
    } catch (err) {
      setErreurServeur(err.message); // la saisie reste dans le formulaire
    } finally {
      verrou.current = false;
      setEnCours(false);
    }
  }

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
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} taille="large" titre="Observations et relances"
      description={`${ligne.prenom} ${ligne.nom}`}
      pied={edition && !lecture ? (
        <>
          <Button onClick={() => setEdition(null)} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-suivi" disabled={enCours}>{enCours ? "Enregistrement…" : edition.id ? "Enregistrer la correction" : "Enregistrer"}</Button>
        </>
      ) : complement && !lecture ? (
        <>
          <Button onClick={() => setComplement(null)} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-abandon" disabled={enCours}>{enCours ? "Enregistrement…" : "Enregistrer l'abandon"}</Button>
        </>
      ) : <Button onClick={onFermer} disabled={enCours}>Fermer</Button>}>
      {errChargement && <Alert ton="error" titre="Les observations et relances n'ont pas pu être chargées." action={<Button compact onClick={charger}>Réessayer</Button>}>{errChargement}</Alert>}
      {!donnees && !errChargement && <LoadingState texte="Chargement des observations et relances…" />}
      {donnees && (
        <div className="ui-form">
          {lecture && <Alert ton="info">{donnees.archivee ? "Session archivée : observations et relances en lecture seule." : "Consultation seule."}</Alert>}
          {erreurServeur && <Alert ton="error" titre={complement ? "L'abandon n'a pas été complété." : "L'événement n'a pas été enregistré."}>{erreurServeur}</Alert>}

          <div className="suivi-inscription" aria-label="Inscription">
            <Badge ton={statut.ton}>{statut.libelle}</Badge>
            {insc.statut === "abandon" && (
              <span className="sess-secondaire">
                {insc.date_abandon ? `Abandon le ${dateFr(insc.date_abandon)}` : "Abandon"}
                {` · Catégorie : ${CATEGORIES_ABANDON[insc.categorie_abandon] || "non précisée"}`}
                {insc.motif_abandon ? ` · Précision : ${insc.motif_abandon}` : ""}
              </span>
            )}
            {insc.statut === "abandon" && !lecture && !edition && !complement && (
              <Button compact onClick={ouvrirComplement}>{insc.categorie_abandon || insc.motif_abandon ? "Corriger l'abandon" : "Compléter l'abandon"}</Button>
            )}
          </div>

          {complement && !lecture ? (
            <form id="form-abandon" onSubmit={enregistrerComplement} noValidate className="ui-form">
              <Alert ton="info">La date d'abandon et le statut ne changent pas.</Alert>
              <FormSection titre="Abandon" colonnes={2}>
                <Field label="Catégorie" facultatif>
                  <select value={complement.categorie_abandon} onChange={(ev) => setComplement((c) => ({ ...c, categorie_abandon: ev.target.value }))}>
                    <option value="">Non précisée</option>
                    {Object.entries(CATEGORIES_ABANDON).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Précision" facultatif aide={AIDE_ABANDON} className="ui-field--large">
                  <textarea rows={2} maxLength={MAX_MOTIF_ABANDON} value={complement.motif_abandon} onChange={(ev) => setComplement((c) => ({ ...c, motif_abandon: ev.target.value }))} />
                </Field>
              </FormSection>
            </form>
          ) : edition && !lecture ? (
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
                  <Button variante="primary" compact onClick={() => ouvrir(null, { type: "signal" })}>Ajouter une observation</Button>
                  <Button compact onClick={() => ouvrir(null, { type: "relance" })}>Ajouter une relance</Button>
                </div>
              )}
              {evenements.length === 0 ? (
                <EmptyState titre="Aucune observation ni relance">Aucune observation ni aucune relance n'a été enregistrée pour ce stagiaire.</EmptyState>
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
                      {!lecture && <div className="sess-actions"><Button compact onClick={() => ouvrir(e)} aria-label={`Corriger l'événement du ${dateFr(e.date_evenement)}`}>Corriger l'événement</Button></div>}
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
