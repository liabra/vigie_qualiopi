import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { formaterDate, formaterDateHeure } from "../sessions/format.js";
import { FormulaireSignalement } from "./FormulaireSignalement.jsx";
import { FormulaireAction } from "./FormulaireAction.jsx";
import { STATUTS_ACTION, aujourdhuiISO } from "./format.js";
import {
  CANAUX_SIGNALEMENT, CAUSES_SIGNALEMENT, STATUTS_SIGNALEMENT, TYPES_SIGNALEMENT,
  decrireEvenementSignalement, estEnRetardReclamation, libelleInscription, nomsConnus,
  optionsInscriptions, transitionsSignalement,
} from "./signalements-format.js";

const Ligne = ({ libelle, children }) => (
  <div className="qualite-ligne">
    <dt className="qualite-ligne__l">{libelle}</dt>
    <dd className="qualite-ligne__v">{children}</dd>
  </div>
);
const vide = <span className="sess-secondaire">—</span>;

// /signalements-qualite/:id (admin) : la FICHE. Les transitions suivent
// strictement les routes backend ; le statut n'est jamais éditable
// librement. Les données du réclamant n'apparaissent QUE pour une
// réclamation, dans leur propre section.
export function SignalementFiche({ signalementId }) {
  useTitrePage("Signalement");
  const [donnees, setDonnees] = useState(null);
  const [introuvable, setIntrouvable] = useState(false);
  const [err, setErr] = useState(null);
  const [erreurAction, setErreurAction] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const [dialogue, setDialogue] = useState(null); // modifier|resoudre|cloturer|rouvrir|annuler|action
  const [erreurResolution, setErreurResolution] = useState(null);
  const [criteres, setCriteres] = useState([]);
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [formations, setFormations] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [stagiaire, setStagiaire] = useState(null);

  const charger = useCallback(async () => {
    try { setDonnees(await api(`/api/signalements/${signalementId}`)); setErr(null); setIntrouvable(false); }
    catch (e) {
      if (e.status === 404 || e.status === 400) setIntrouvable(true);
      else setErr(e.message);
    }
  }, [signalementId]);
  useEffect(() => { charger(); }, [charger]);

  useEffect(() => {
    api("/api/referentiel").then((r) => setCriteres(r.criteres || [])).catch(() => setCriteres([]));
    api("/api/utilisateurs").then((r) => setUtilisateurs(r.utilisateurs || [])).catch(() => setUtilisateurs([]));
    api("/api/formations").then((r) => setFormations(r.formations || [])).catch(() => setFormations([]));
    Promise.all([api("/api/sessions"), api("/api/sessions?etat=archivees")])
      .then(([a, b]) => setSessions([...(a.sessions || []), ...(b.sessions || [])]))
      .catch(() => setSessions([]));
  }, []);

  // Stagiaire lié : un seul appel ; seuls nom / prénom sont conservés.
  const s = donnees?.signalement;
  const inscriptionId = s?.inscription_id;
  const sessionDuStagiaire = s?.session_id;
  useEffect(() => {
    if (!inscriptionId || !sessionDuStagiaire) { setStagiaire(null); return undefined; }
    let actif = true;
    api(`/api/sessions/${sessionDuStagiaire}`)
      .then((r) => { if (actif) setStagiaire(optionsInscriptions(r.stagiaires).find((o) => o.inscription_id === inscriptionId) || null); })
      .catch(() => { if (actif) setStagiaire(null); });
    return () => { actif = false; };
  }, [inscriptionId, sessionDuStagiaire]);

  async function transition(action, corps) {
    setEnCours(true); setErreurAction(null); setErreurResolution(null);
    try {
      await api(`/api/signalements/${s.id}/${action}`, { method: "PATCH", body: JSON.stringify(corps || {}) });
      setDialogue(null);
      await charger();
    } catch (e) {
      // fix : « Résoudre » contient une saisie — le panneau reste ouvert, avec
      // l'erreur, pour corriger et réessayer. Les confirmations se ferment.
      if (action === "resoudre") setErreurResolution(e.message);
      else { setErreurAction(e.message); setDialogue(null); }
    } finally { setEnCours(false); }
  }

  const fil = (dernier) => [{ libelle: "Qualité" }, { libelle: "Signalements", to: "/signalements-qualite" }, { libelle: dernier }];
  if (introuvable) {
    return (
      <>
        <PageHeader fil={fil("Signalement introuvable")} titre="Signalement introuvable" />
        <EmptyState titre="Ce signalement n'existe pas ou n'existe plus." action={<Button variante="primary" to="/signalements-qualite">Voir les signalements</Button>} />
      </>
    );
  }
  if (err && !donnees) return <Alert ton="error" titre="Le signalement n'a pas pu être chargé." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>;
  if (!donnees) return <LoadingState texte="Chargement du signalement…" />;

  const { actions = [], historique = [] } = donnees;
  const ty = TYPES_SIGNALEMENT[s.type] || { libelle: s.type, ton: "neutral" };
  const st = STATUTS_SIGNALEMENT[s.statut] || { libelle: s.statut, ton: "neutral" };
  const reclamation = s.type === "reclamation";
  const retard = estEnRetardReclamation(s);
  const session = s.session_id ? sessions.find((x) => x.id === s.session_id) : null;
  const formation = session?.formation || formations.find((f) => f.id === s.formation_id)?.intitule || null;
  const indicateursConnus = [...criteres.flatMap((c) => c.indicateurs || []), ...(s.indicateurs || [])];
  const noms = nomsConnus(utilisateurs, s, historique);
  const boutons = transitionsSignalement(s.statut);
  const sansIndicateur = (s.indicateurs || []).length === 0;

  return (
    <>
      <PageHeader fil={fil(s.reference)} titre={s.objet} />

      <div className="qualite-badges">
        <Badge ton={ty.ton}>{ty.libelle}</Badge>
        <Badge ton={st.ton}>{st.libelle}</Badge>
        {retard && <Badge ton="error">En retard</Badge>}
        <span className="sess-secondaire">{s.reference}{s.date_constat ? ` · ${reclamation ? "reçue le" : "constaté le"} ${formaterDate(s.date_constat)}` : ""}</span>
      </div>

      {erreurAction && <Alert ton="error" titre="L'opération n'a pas abouti.">{erreurAction}</Alert>}

      {boutons.length > 0 && (
        <div className="qualite-actions" role="group" aria-label="Actions sur le signalement">
          {boutons.map((b) => {
            if (b.id === "modifier") return <Button key={b.id} onClick={() => setDialogue("modifier")} disabled={enCours}>Modifier</Button>;
            if (b.id === "qualifier" || b.id === "traiter") {
              return <Button key={b.id} variante="primary" onClick={() => transition(b.id)} disabled={enCours}>{enCours ? "En cours…" : b.libelle}</Button>;
            }
            if (b.id === "annuler") return <Button key={b.id} variante="danger" onClick={() => setDialogue("annuler")} disabled={enCours}>Annuler</Button>;
            if (b.id === "cloturer") {
              return <Button key={b.id} variante="primary" onClick={() => setDialogue("cloturer")} disabled={enCours || sansIndicateur}
                aria-describedby={sansIndicateur ? "cloture-aide" : undefined}>Clôturer</Button>;
            }
            return <Button key={b.id} variante={b.id === "resoudre" ? "primary" : "secondary"} onClick={() => { setErreurResolution(null); setDialogue(b.id); }} disabled={enCours}>{b.libelle}</Button>;
          })}
        </div>
      )}
      {s.statut === "resolue" && sansIndicateur && (
        <p id="cloture-aide" className="sess-secondaire">Au moins un indicateur Qualiopi doit être associé avant la clôture.</p>
      )}
      {s.statut === "annulee" && <p className="sess-secondaire">Signalement annulé : aucune action n'est plus possible. Son historique est conservé.</p>}

      <div className="qualite-grille">
        <section className="qualite-section" aria-labelledby="sig-objet">
          <h2 id="sig-objet" className="qualite-section__titre">Signalement</h2>
          <dl className="qualite-fiche">
            <Ligne libelle="Objet">{s.objet}</Ligne>
            <Ligne libelle="Description">{s.description || vide}</Ligne>
            <Ligne libelle={reclamation ? "Date de réception" : "Date de constat"}>{formaterDate(s.date_constat) || vide}</Ligne>
            <Ligne libelle="Créé par">{s.cree_par_nom || vide}</Ligne>
          </dl>
        </section>

        <section className="qualite-section" aria-labelledby="sig-contexte">
          <h2 id="sig-contexte" className="qualite-section__titre">Contexte</h2>
          <dl className="qualite-fiche">
            <Ligne libelle="Formation">{formation || vide}</Ligne>
            <Ligne libelle="Session">{session ? `${session.reference}${session.archivee_le ? " (archivée)" : ""}` : (s.session_id ? "Session indisponible" : vide)}</Ligne>
            <Ligne libelle="Stagiaire">{s.inscription_id ? (stagiaire ? libelleInscription(stagiaire) : "Inscription liée") : vide}</Ligne>
            {!s.inscription_id && <Ligne libelle="Personne concernée">{s.personne_concernee_libelle || vide}</Ligne>}
            <Ligne libelle="Responsable">{s.responsable_nom || vide}</Ligne>
          </dl>
        </section>

        {reclamation && (
          <section className="qualite-section" aria-labelledby="sig-reclamant">
            <h2 id="sig-reclamant" className="qualite-section__titre">Réclamant</h2>
            <dl className="qualite-fiche">
              <Ligne libelle="Nom">{s.reclamant_nom || vide}</Ligne>
              <Ligne libelle="Entreprise / organisme">{s.reclamant_entreprise || vide}</Ligne>
              <Ligne libelle="E-mail">{s.reclamant_email || vide}</Ligne>
              <Ligne libelle="Canal">{CANAUX_SIGNALEMENT[s.canal] || vide}</Ligne>
            </dl>
          </section>
        )}

        <section className="qualite-section" aria-labelledby="sig-causes">
          <h2 id="sig-causes" className="qualite-section__titre">Causes</h2>
          <div className="qualite-fiche">
            {(s.causes || []).length === 0 ? <p className="sess-secondaire">Aucune cause renseignée.</p> : (
              <ul className="signalement-liste">
                {s.causes.map((c) => (
                  <li key={c}>{CAUSES_SIGNALEMENT[c] || c}{c === "autre" && s.cause_autre_libelle ? ` — ${s.cause_autre_libelle}` : ""}</li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="qualite-section" aria-labelledby="sig-traitement">
          <h2 id="sig-traitement" className="qualite-section__titre">Réponse / traitement</h2>
          <dl className="qualite-fiche">
            <Ligne libelle="Synthèse de la réponse">{s.synthese_reponse || vide}</Ligne>
            <Ligne libelle="Date de réponse">{formaterDate(s.date_reponse) || vide}</Ligne>
            <Ligne libelle="Date de résolution">{formaterDate(s.date_resolution) || vide}</Ligne>
            {reclamation && (
              <Ligne libelle="Échéance cible">
                {formaterDate(s.date_echeance_cible) || vide}
                {s.delai_cible_jours_ouvres ? <span className="sess-secondaire"> ({s.delai_cible_jours_ouvres} jours ouvrés, indicatif)</span> : null}
                {retard && <> <Badge ton="error">En retard</Badge></>}
              </Ligne>
            )}
            <Ligne libelle="Clôture">{s.date_cloture ? `${formaterDate(s.date_cloture)}${s.cloture_par_nom ? ` par ${s.cloture_par_nom}` : ""}` : vide}</Ligne>
            {s.statut === "annulee" && <Ligne libelle="Annulé par">{s.annulee_par_nom || "Utilisateur indisponible"}</Ligne>}
          </dl>
        </section>

        <section className="qualite-section" aria-labelledby="sig-indicateurs">
          <h2 id="sig-indicateurs" className="qualite-section__titre">Indicateurs Qualiopi</h2>
          <div className="qualite-fiche">
            {(s.indicateurs || []).length === 0 ? <p className="sess-secondaire">Aucun indicateur associé.</p> : (
              <ul className="signalement-liste">
                {s.indicateurs.map((i) => <li key={i.id}>Indicateur {i.numero} — {i.libelle}</li>)}
              </ul>
            )}
          </div>
        </section>

        <section className="qualite-section" aria-labelledby="sig-actions">
          <h2 id="sig-actions" className="qualite-section__titre">Actions qualité liées</h2>
          <div className="qualite-fiche">
            {s.statut !== "annulee" && (
              <div><Button compact onClick={() => setDialogue("action")}>Créer une action qualité liée</Button></div>
            )}
            {actions.length === 0 ? <p className="sess-secondaire">Aucune action qualité liée.</p> : (
              <ul className="signalement-liste">
                {actions.map((a) => {
                  const sa = STATUTS_ACTION[a.statut] || { libelle: a.statut, ton: "neutral" };
                  return (
                    <li key={a.id} className="signalement-action">
                      <Link to={`/actions-qualite/${a.id}`}>{a.titre}</Link>
                      <span className="sess-secondaire">{a.reference}</span>
                      <Badge ton={sa.ton}>{sa.libelle}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className="qualite-section" aria-labelledby="sig-historique">
        <h2 id="sig-historique" className="qualite-section__titre">Historique</h2>
        {historique.length === 0 ? <p className="sess-secondaire">Aucun événement.</p> : (
          <ol className="qualite-historique">
            {historique.map((ev) => {
              const d = decrireEvenementSignalement(ev, { indicateurs: indicateursConnus, noms });
              return (
                <li key={ev.id} className="qualite-historique__item">
                  <time className="qualite-historique__date" dateTime={ev.cree_le}>{formaterDateHeure(ev.cree_le)}</time>
                  <span className="qualite-historique__auteur">{ev.acteur_nom || "Utilisateur indisponible"}</span>
                  <span className="qualite-historique__texte">
                    {d.avant !== undefined && d.apres !== undefined ? <>{d.titre} : <strong>{d.avant}</strong> → <strong>{d.apres}</strong></>
                      : d.apres !== undefined ? <>{d.titre} : <strong>{d.apres}</strong></> : d.titre}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {dialogue === "modifier" && (
        <FormulaireSignalement signalement={s} onFermer={() => setDialogue(null)}
          onEnregistre={() => { setDialogue(null); setErreurAction(null); charger(); }} />
      )}
      {dialogue === "action" && (
        <FormulaireAction signalementSource={s} onFermer={() => setDialogue(null)}
          onEnregistre={() => { setDialogue(null); charger(); }} />
      )}
      {dialogue === "resoudre" && (
        <DialogueResolution signalement={s} enCours={enCours} erreurServeur={erreurResolution} onFermer={() => setDialogue(null)}
          onValider={(corps) => transition("resoudre", corps)} />
      )}
      <ConfirmDialog ouvert={dialogue === "cloturer"} titre="Clôturer ce signalement ?" libelleConfirmer="Clôturer"
        ton="primary" enCours={enCours} onConfirmer={() => transition("cloturer")} onAnnuler={() => setDialogue(null)}>
        Le signalement sera clôturé ; il pourra être réouvert si nécessaire. Son historique est conservé.
      </ConfirmDialog>
      <ConfirmDialog ouvert={dialogue === "rouvrir"} titre="Réouvrir ce signalement ?" libelleConfirmer="Réouvrir"
        ton="primary" enCours={enCours} onConfirmer={() => transition("rouvrir")} onAnnuler={() => setDialogue(null)}>
        Le signalement repassera « En traitement ». Son historique est conservé.
      </ConfirmDialog>
      <ConfirmDialog ouvert={dialogue === "annuler"} titre="Annuler ce signalement ?" libelleConfirmer="Annuler le signalement"
        ton="danger" enCours={enCours} onConfirmer={() => transition("annuler")} onAnnuler={() => setDialogue(null)}>
        L'annulation est définitive pour ce signalement. Il restera consultable avec son historique.
      </ConfirmDialog>
    </>
  );
}

// Résolution : réponse et date de réponse préremplies ; date de résolution
// préremplie avec la date LOCALE du jour, visible et modifiable.
function DialogueResolution({ signalement, enCours, erreurServeur, onFermer, onValider }) {
  const [synthese, setSynthese] = useState(signalement.synthese_reponse || "");
  const [dateReponse, setDateReponse] = useState((signalement.date_reponse || "").slice(0, 10));
  const [dateResolution, setDateResolution] = useState(aujourdhuiISO());
  const [erreur, setErreur] = useState(null);
  function valider(e) {
    e.preventDefault();
    if (!dateResolution) { setErreur("Indiquez la date de résolution."); return; }
    onValider({ synthese_reponse: synthese.trim() || null, date_reponse: dateReponse || null, date_resolution: dateResolution });
  }
  return (
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} titre="Résoudre le signalement"
      description="La résolution ne clôture pas encore le signalement."
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
        <Button variante="primary" type="submit" form="form-resolution" disabled={enCours}>{enCours ? "Enregistrement…" : "Résoudre"}</Button></>}>
      <form id="form-resolution" onSubmit={valider} noValidate>
        {erreurServeur && <Alert ton="error" titre="Le signalement n'a pas été résolu.">{erreurServeur}</Alert>}
        <FormSection titre="Résolution" colonnes={1}>
          <Field label="Synthèse de la réponse" facultatif><textarea rows={4} value={synthese} onChange={(e) => setSynthese(e.target.value)} /></Field>
          <Field label="Date de réponse" facultatif><input type="date" value={dateReponse} onChange={(e) => setDateReponse(e.target.value)} /></Field>
          <Field label="Date de résolution" erreur={erreur}><input type="date" value={dateResolution} onChange={(e) => setDateResolution(e.target.value)} required /></Field>
        </FormSection>
      </form>
    </Drawer>
  );
}
