import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { FormulaireAction } from "./FormulaireAction.jsx";
import { PreuvesLiees } from "./PreuvesLiees.jsx";
import { ORIGINES, PRIORITES, STATUTS_ACTION, decrireEvenement, estEnRetard } from "./format.js";
import { formaterDate, formaterDateHeure } from "../sessions/format.js";
import { LIBELLE_ORIGINE_SATISFACTION, libellePublic, libelleProvenanceSynthese } from "./satisfaction-format.js";

const Ligne = ({ libelle, children }) => (
  <div className="qualite-ligne">
    <dt className="qualite-ligne__l">{libelle}</dt>
    <dd className="qualite-ligne__v">{children}</dd>
  </div>
);

// /actions-qualite/:id : la FICHE. Contexte, traitement, efficacité,
// clôture et historique lisible. Les transitions suivent strictement les
// endpoints backend (le statut n'est jamais éditable librement).
export function ActionFiche({ actionId, admin }) {
  useTitrePage("Action qualité");
  const naviguer = useNavigate();
  const [donnees, setDonnees] = useState(null);
  const [introuvable, setIntrouvable] = useState(false);
  const [err, setErr] = useState(null);
  const [erreurAction, setErreurAction] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const [criteres, setCriteres] = useState([]);
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [formations, setFormations] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [dialogue, setDialogue] = useState(null); // modifier|realiser|efficacite|cloturer|rouvrir|annuler

  const charger = useCallback(async () => {
    try { setDonnees(await api(`/api/actions-qualite/${actionId}`)); setErr(null); setIntrouvable(false); setErreurAction(null); }
    catch (e) {
      // 403 d'un contributeur = action existante mais non attribuée : même
      // rendu « introuvable » qu'un 404, sans révéler son existence.
      if (e.status === 404 || e.status === 400 || (e.status === 403 && !admin)) setIntrouvable(true);
      else setErr(e.message);
    }
  }, [actionId, admin]);
  useEffect(() => { charger(); }, [charger]);

  useEffect(() => {
    api("/api/referentiel").then((r) => setCriteres(r.criteres || [])).catch(() => setCriteres([]));
    if (admin) api("/api/utilisateurs").then((r) => setUtilisateurs(r.utilisateurs)).catch(() => setUtilisateurs([]));
    api("/api/formations").then((r) => setFormations(r.formations || [])).catch(() => setFormations([]));
    Promise.all([api("/api/sessions"), api("/api/sessions?etat=archivees")])
      .then(([a, b]) => setSessions([...(a.sessions || []), ...(b.sessions || [])]))
      .catch(() => setSessions([]));
  }, [admin]);

  const action = donnees?.action;
  const historique = donnees?.historique || [];
  const preuves = donnees?.preuves || [];

  async function transition(chemin, corps, libelle) {
    setEnCours(true); setErreurAction(null);
    try {
      await api(chemin, { method: "PATCH", body: JSON.stringify(corps || {}) });
      setDialogue(null);
      await charger();
    } catch (e) {
      setErreurAction(e.message);
    } finally { setEnCours(false); }
  }

  if (introuvable) {
    return (
      <>
        <PageHeader fil={[{ libelle: "Qualité" }, { libelle: "Actions qualité", to: "/actions-qualite" }, { libelle: "Action introuvable" }]} titre="Action introuvable" />
        <EmptyState titre="Cette action n'existe pas ou n'existe plus." action={<Button variante="primary" to="/actions-qualite">Voir les actions qualité</Button>} />
      </>
    );
  }
  if (err && !donnees) return <Alert ton="error" titre="L'action n'a pas pu être chargée." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>;
  if (!donnees) return <LoadingState texte="Chargement de l'action…" />;

  const st = STATUTS_ACTION[action.statut] || { libelle: action.statut, ton: "neutral" };
  const pr = action.priorite ? (PRIORITES[action.priorite] || { libelle: action.priorite, ton: "neutral" }) : null;
  const retard = estEnRetard(action);
  const session = action.session_id ? sessions.find((s) => s.id === action.session_id) : null;
  const formation = session?.formation || formations.find((f) => f.id === action.formation_id)?.intitule || null;
  const tousIndicateurs = criteres.flatMap((c) => (c.indicateurs || []));
  const modifiable = admin && action.statut !== "cloturee" && action.statut !== "annulee";

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Qualité" }, { libelle: "Actions qualité", to: "/actions-qualite" }, { libelle: action.titre }]}
        titre={action.titre}
        actions={modifiable && <Button onClick={() => setDialogue("modifier")}>Modifier</Button>}
      />

      <div className="qualite-badges">
        <Badge ton={st.ton}>{st.libelle}</Badge>
        {pr && <Badge ton={pr.ton}>Priorité {pr.libelle}</Badge>}
        {retard && <Badge ton="error">En retard</Badge>}
        {action.origine === "signalement" && (
          <Badge ton="info">Signalement {action.signalement_reference}</Badge>
        )}
        {action.origine === "satisfaction" && <Badge ton="info">{LIBELLE_ORIGINE_SATISFACTION}</Badge>}
        <span className="sess-secondaire">{action.reference} · {ORIGINES[action.origine] || action.origine}</span>
      </div>
      {/* Provenance détaillée : admin seulement (le serveur ne l'envoie pas au contributeur). */}
      {admin && action.origine === "satisfaction" && (
        <p className="sess-secondaire">
          {action.satisfaction_id
            ? `Provenance : une réponse de satisfaction (${libellePublic(action.satisfaction_public)}) de la session liée — consultable dans son onglet Satisfaction.`
            : `Provenance : ${libelleProvenanceSynthese({ du: action.satisfaction_du, au: action.satisfaction_au, type: action.satisfaction_public })}.`}
        </p>
      )}

      {erreurAction && <Alert ton="error" titre="L'action n'a pas pu être menée à bien.">{erreurAction}</Alert>}

      <div className="qualite-actions">
        {action.statut === "a_faire" && <Button onClick={() => transition(`/api/actions-qualite/${action.id}/demarrer`, {}, "Démarrer")} disabled={enCours}>Démarrer</Button>}
        {action.statut === "en_cours" && (
          <Button variante="primary" onClick={() => setDialogue("realiser")} disabled={enCours}>Marquer comme réalisée</Button>
        )}
        {admin && action.statut === "realisee" && (
          <Button onClick={() => setDialogue("efficacite")} disabled={enCours}>Contrôler l'efficacité</Button>
        )}
        {admin && action.statut === "efficacite_a_verifier" && (
          <Button variante="primary" onClick={() => setDialogue("cloturer")} disabled={enCours}>Clôturer</Button>
        )}
        {admin && action.statut === "cloturee" && <Button onClick={() => setDialogue("rouvrir")} disabled={enCours}>Réouvrir</Button>}
        {admin && action.statut !== "cloturee" && action.statut !== "annulee" && (
          <Button variante="danger" onClick={() => setDialogue("annuler")} disabled={enCours}>Annuler</Button>
        )}
      </div>

      <div className="qualite-grille">
        <dl className="qualite-fiche">
          <Ligne libelle="Référence">{action.reference}</Ligne>
          <Ligne libelle="Statut"><Badge ton={st.ton}>{st.libelle}</Badge></Ligne>
          <Ligne libelle="Priorité">{pr ? pr.libelle : "—"}</Ligne>
          <Ligne libelle="Responsable">{action.responsable_nom || "—"}</Ligne>
          <Ligne libelle="Échéance">{formaterDate(action.echeance) || "—"}{retard ? " (en retard)" : ""}</Ligne>
          <Ligne libelle="Constat">{action.constat || "—"}</Ligne>
          <Ligne libelle="Contexte">
            {session ? `Session ${session.reference}${session.archivee_le ? " (archivée)" : ""}${formation ? ` — ${formation}` : ""}` : (formation || "—")}
          </Ligne>
          <Ligne libelle="Indicateurs">
            {action.indicateurs.length === 0 ? "—" : action.indicateurs.map((i) => `Indicateur ${i.numero} — ${i.libelle}`).join(", ")}
          </Ligne>
        </dl>

        <section className="qualite-section" aria-labelledby="traitement">
          <h2 id="traitement" className="qualite-section__titre">Traitement</h2>
          <dl className="qualite-fiche">
            <Ligne libelle="Action prévue">{action.action_prevue || "—"}</Ligne>
            <Ligne libelle="Mise en œuvre">{formaterDate(action.date_mise_en_oeuvre) || "—"}</Ligne>
            <Ligne libelle="Résultat">{action.resultat || "—"}</Ligne>
          </dl>
        </section>

        <section className="qualite-section" aria-labelledby="efficacite">
          <h2 id="efficacite" className="qualite-section__titre">Efficacité</h2>
          <dl className="qualite-fiche">
            <Ligne libelle="Contrôle">{action.controle_efficacite || "—"}</Ligne>
            <Ligne libelle="Date du contrôle">{formaterDate(action.date_controle_efficacite) || "—"}</Ligne>
          </dl>
        </section>

        <section className="qualite-section" aria-labelledby="cloture">
          <h2 id="cloture" className="qualite-section__titre">Clôture</h2>
          <dl className="qualite-fiche">
            <Ligne libelle="Date de clôture">{formaterDate(action.date_cloture) || "—"}</Ligne>
            <Ligne libelle="Clôturée par">{action.cloture_par_nom || "—"}</Ligne>
            <Ligne libelle="Créée par">{action.cree_par_nom || "—"}</Ligne>
          </dl>
        </section>
      </div>

      {/* Preuves liées : visibles à tout statut (dont efficacité à vérifier et
          clôturée) ; rattacher / retirer : admin, action ni clôturée ni annulée. */}
      <PreuvesLiees base={`/api/actions-qualite/${action.id}`} preuves={preuves} idTitre="action-preuves"
        modifiable={admin && action.statut !== "cloturee" && action.statut !== "annulee"} onChange={charger} />

      <section className="qualite-section" aria-labelledby="historique">
        <h2 id="historique" className="qualite-section__titre">Historique</h2>
        {historique.length === 0 ? (
          <p className="sess-secondaire">Aucun événement.</p>
        ) : (
          <ol className="qualite-historique">
            {historique.map((ev) => {
              const d = decrireEvenement(ev, { indicateurs: tousIndicateurs, utilisateurs, preuves });
              return (
                <li key={ev.id} className="qualite-historique__item">
                  <time className="qualite-historique__date">{formaterDateHeure(ev.cree_le)}</time>
                  <span className="qualite-historique__auteur">{ev.acteur_nom || "—"}</span>
                  <span className="qualite-historique__texte">
                    {d.avant !== undefined && d.apres !== undefined ? (
                      <>{d.titre} : <strong>{d.avant}</strong> → <strong>{d.apres}</strong></>
                    ) : d.apres !== undefined ? (
                      <>{d.titre} : <strong>{d.apres}</strong></>
                    ) : (
                      d.titre
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Dialogues de transition */}
      {dialogue === "modifier" && (
        <FormulaireAction action={action} onFermer={() => setDialogue(null)} onEnregistre={() => { setDialogue(null); charger(); }} />
      )}
      {dialogue === "realiser" && (
        <DialogueRealisation onFermer={() => setDialogue(null)} enCours={enCours}
          onValider={(corps) => transition(`/api/actions-qualite/${action.id}/realiser`, corps)} />
      )}
      {dialogue === "efficacite" && (
        <DialogueEfficacite onFermer={() => setDialogue(null)} enCours={enCours}
          initial={{ controle: action.controle_efficacite || "", date: action.date_controle_efficacite || "" }}
          onValider={(corps) => transition(`/api/actions-qualite/${action.id}/controle-efficacite`, corps)} />
      )}
      <ConfirmDialog ouvert={dialogue === "cloturer"} titre="Clôturer cette action ?"
        libelleConfirmer="Clôturer" enCours={enCours}
        onConfirmer={() => transition(`/api/actions-qualite/${action.id}/cloturer`, {})}
        onAnnuler={() => setDialogue(null)}>
        La clôture exige une action réalisée, un contrôle d'efficacité renseigné et au moins un indicateur lié. L'historique est conservé.
      </ConfirmDialog>
      <ConfirmDialog ouvert={dialogue === "rouvrir"} titre="Réouvrir cette action ?"
        libelleConfirmer="Réouvrir" enCours={enCours}
        onConfirmer={() => transition(`/api/actions-qualite/${action.id}/rouvrir`, {})}
        onAnnuler={() => setDialogue(null)}>
        L'action redeviendra active ; son historique est conservé.
      </ConfirmDialog>
      <ConfirmDialog ouvert={dialogue === "annuler"} titre="Annuler cette action qualité ?"
        libelleConfirmer="Annuler" ton="danger" enCours={enCours}
        onConfirmer={() => transition(`/api/actions-qualite/${action.id}/annuler`, {})}
        onAnnuler={() => setDialogue(null)}>
        L'action sera conservée dans l'historique ; elle ne sera plus suivie.
      </ConfirmDialog>
    </>
  );
}

// Réalisation : le résultat est attendu par le backend. Une action réalisée
// n'est PAS clôturée : son efficacité pourra être vérifiée ensuite.
function DialogueRealisation({ onFermer, enCours, onValider }) {
  const [resultat, setResultat] = useState("");
  const [date, setDate] = useState("");
  const [erreur, setErreur] = useState(null);
  async function valider(e) {
    e.preventDefault();
    if (!resultat.trim()) { setErreur("Indiquez le résultat."); return; }
    await onValider({ resultat: resultat.trim(), date_mise_en_oeuvre: date || null });
  }
  return (
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} titre="Marquer comme réalisée"
      description="La réalisation de l'action ne clôture pas encore son suivi."
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
        <Button variante="primary" type="submit" form="form-realisation" disabled={enCours}>{enCours ? "Enregistrement…" : "Marquer réalisée"}</Button></>}>
      <form id="form-realisation" onSubmit={valider} noValidate>
        {erreur && <Alert ton="error" titre="La réalisation n'a pas été enregistrée.">{erreur}</Alert>}
        <FormSection titre="Réalisation" colonnes={1}>
          <Field label="Résultat" erreur={erreur}><textarea rows={4} value={resultat} onChange={(e) => setResultat(e.target.value)} /></Field>
          <Field label="Date de mise en œuvre" facultatif><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </FormSection>
      </form>
    </Drawer>
  );
}

// Contrôle d'efficacité : évaluation + date. FAIT ≠ EFFICACE ≠ CLÔTURÉ.
function DialogueEfficacite({ onFermer, enCours, initial, onValider }) {
  const [controle, setControle] = useState(initial?.controle || "");
  const [date, setDate] = useState(initial?.date || "");
  const [erreur, setErreur] = useState(null);
  async function valider(e) {
    e.preventDefault();
    if (!controle.trim()) { setErreur("Indiquez le contrôle d'efficacité."); return; }
    if (!date) { setErreur("Indiquez la date du contrôle."); return; }
    await onValider({ controle_efficacite: controle.trim(), date_controle_efficacite: date });
  }
  return (
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} titre="Contrôler l'efficacité"
      description="Vérifiez si l'action a réellement corrigé ou amélioré la situation."
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
        <Button variante="primary" type="submit" form="form-efficacite" disabled={enCours}>{enCours ? "Enregistrement…" : "Enregistrer le contrôle"}</Button></>}>
      <form id="form-efficacite" onSubmit={valider} noValidate>
        {erreur && <Alert ton="error" titre="Le contrôle n'a pas été enregistré.">{erreur}</Alert>}
        <FormSection titre="Efficacité" colonnes={1}>
          <Field label="Contrôle / évaluation" erreur={erreur}><textarea rows={4} value={controle} onChange={(e) => setControle(e.target.value)} /></Field>
          <Field label="Date du contrôle"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </FormSection>
      </form>
    </Drawer>
  );
}
