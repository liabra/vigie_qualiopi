import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { messageDepassementDuree } from "../messages.js";
import { Alert, Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, LoadingState, PageHeader, Tabs } from "../ui/index.js";
import { useDialogue } from "../ui/dialogue.js";
import { AideInfobulle } from "../aide/index.js";
import { useTitrePage } from "../pages/titre.js";
import { FormulaireSession, erreursSession, valeursDepuisSession } from "./FormulaireSession.jsx";
import {
  STATUTS_SESSION, dureePrevue, formaterHeures, formaterPeriode, incoherencesStatut, syntheseStagiaires, titreSession,
} from "./format.js";
import { VueEnsemble } from "./VueEnsemble.jsx";
import { OngletStagiaires } from "./OngletStagiaires.jsx";
import { OngletAssiduite } from "./OngletAssiduite.jsx";
import { OngletEvaluations } from "./OngletEvaluations.jsx";
import { OngletSatisfaction } from "./OngletSatisfaction.jsx";
import { OngletDocuments } from "./OngletDocuments.jsx";
import { OngletParcours } from "./OngletParcours.jsx";

const ONGLETS = {
  apercu: VueEnsemble,
  stagiaires: OngletStagiaires,
  parcours: OngletParcours,
  assiduite: OngletAssiduite,
  evaluations: OngletEvaluations,
  satisfaction: OngletSatisfaction,
  documents: OngletDocuments,
};

// /sessions/:id[/onglet] : page de détail. Les données sont chargées une
// fois, en parallèle, et partagées par les onglets ; chaque onglet a sa
// propre URL. Les avertissements métier (documents peut-être obsolètes,
// absences au-delà de la durée…) s'affichent en bandeaux dans la page.
export function SessionDetail({ sessionId, onglet = "apercu", admin, peutSaisir, onChange }) {
  const [donnees, setDonnees] = useState(null);
  const [introuvable, setIntrouvable] = useState(false);
  const [err, setErr] = useState(null);
  const [annexes, setAnnexes] = useState({ modeles: [], prescripteurs: [], indicateurs: [] });
  const [bandeaux, setBandeaux] = useState([]);
  const [edition, setEdition] = useState(false);
  // Cycle de vie (Après VF) : archivage / restauration / suppression.
  const [archivage, setArchivage] = useState(false);
  const [restauration, setRestauration] = useState(false);
  const [suppression, setSuppression] = useState(false);
  const [cycleEnCours, setCycleEnCours] = useState(false);
  const [erreurCycle, setErreurCycle] = useState(null);
  const naviguer = useNavigate();

  const charger = useCallback(async () => {
    try {
      const [detail, absences, preuves, evaluations, satisfactions] = await Promise.all([
        api(`/api/sessions/${sessionId}`),
        api(`/api/sessions/${sessionId}/absences`),
        api(`/api/preuves?session=${sessionId}`),
        api(`/api/sessions/${sessionId}/evaluations`),
        api(`/api/sessions/${sessionId}/satisfactions`),
      ]);
      setDonnees({
        ...detail, absences, evaluations, satisfactions,
        // Documents externes (EduSign / Drive) : preuves de la session qui
        // ne viennent pas d'une génération Vigie.
        externes: (preuves.preuves || []).filter((p) => p.source !== "generation"),
      });
      setIntrouvable(false);
      setErr(null);
    } catch (e) {
      if (e.status === 404 || e.status === 400) setIntrouvable(true);
      else setErr(e.message);
    }
  }, [sessionId]);

  useEffect(() => { setDonnees(null); setBandeaux([]); charger(); }, [charger]);
  useEffect(() => {
    Promise.all([
      api("/api/modeles").catch(() => ({ modeles: [] })),
      api("/api/prescripteurs").catch(() => ({ prescripteurs: [] })),
      api("/api/indicateurs").catch(() => ({ indicateurs: [] })),
    ]).then(([m, p, i]) => setAnnexes({ modeles: m.modeles || [], prescripteurs: p.prescripteurs || [], indicateurs: i.indicateurs || [] }));
  }, []);

  const session = donnees?.session;
  useTitrePage(session ? titreSession(session) : "Session");

  // Bandeau de page : { id, ton, titre, texte }. Un succès remplace le
  // précédent succès ; les avertissements s'empilent jusqu'à fermeture.
  const notifier = useCallback((b) => {
    setBandeaux((l) => [...l.filter((x) => !(b.ton === "success" && x.ton === "success")), { id: Date.now() + Math.random(), ...b }]);
  }, []);
  const fermerBandeau = (id) => setBandeaux((l) => l.filter((x) => x.id !== id));

  async function recharger() {
    await charger();
    onChange?.();
  }

  // Archivage / restauration : PATCH, puis rechargement. La suppression a
  // son propre chemin (DELETE + retour à la liste).
  async function actionCycle(action, succes) {
    setCycleEnCours(true); setErreurCycle(null);
    try {
      await api(`/api/sessions/${session.id}/${action}`, { method: "PATCH" });
      notifier({ ton: "success", titre: succes });
      setArchivage(false); setRestauration(false);
      await recharger();
    } catch (e) {
      setErreurCycle(e.message);
    } finally {
      setCycleEnCours(false);
    }
  }

  async function supprimerDefinitivement() {
    setCycleEnCours(true); setErreurCycle(null);
    try {
      await api(`/api/sessions/${session.id}`, { method: "DELETE" });
      onChange?.();
      naviguer("/sessions");
    } catch (e) {
      setErreurCycle(e.message);
      setCycleEnCours(false);
    }
  }

  if (introuvable) {
    return (
      <>
        <PageHeader fil={[{ libelle: "Formation" }, { libelle: "Sessions", to: "/sessions" }, { libelle: "Session introuvable" }]} titre="Session introuvable" />
        <EmptyState titre="Cette session n'existe pas ou n'existe plus." action={<Button variante="primary" to="/sessions">Voir toutes les sessions</Button>}>
          Vérifiez le lien utilisé.
        </EmptyState>
      </>
    );
  }
  if (err && !donnees) {
    return <Alert ton="error" titre="La session n'a pas pu être chargée." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>;
  }
  if (!donnees) return <LoadingState texte="Chargement de la session…" />;

  const st = STATUTS_SESSION[session.statut] || { libelle: session.statut, ton: "neutral" };
  const duree = dureePrevue(session);
  const synthese = syntheseStagiaires(donnees.stagiaires);
  const base = `/sessions/${session.id}`;
  const incoherences = incoherencesStatut(session);
  const Contenu = ONGLETS[onglet] || VueEnsemble;
  const archivee = !!session.archivee_le;
  const ctx = { donnees, annexes, admin, peutSaisir, recharger, notifier, base, archivee };

  return (
    <div className="sess-detail">
      <PageHeader
        fil={[{ libelle: "Formation" }, { libelle: "Sessions", to: "/sessions" }, { libelle: titreSession(session) }]}
        titre={session.formation}
        actions={admin && (
          <>
            {archivee ? (
              <>
                <Button variante="primary" onClick={() => setRestauration(true)}>Restaurer la session</Button>
                <Button variante="danger" onClick={() => setSuppression(true)}>Supprimer définitivement</Button>
              </>
            ) : (
              <>
                <Button variante="primary" onClick={() => setEdition(true)}>Modifier la session</Button>
                <Button onClick={() => setArchivage(true)}>Archiver la session</Button>
              </>
            )}
          </>
        )}
      />
      <div className="sess-entete">
        <div className="sess-entete__ligne">
          {session.reference && <span className="sess-entete__ref">{session.reference}</span>}
          <Badge ton={st.ton}>{st.libelle}</Badge>
          {archivee && <Badge ton="warning">Session archivée</Badge>}
        </div>
        <dl className="sess-meta">
          <div><dt>Dates</dt><dd>{formaterPeriode(session.date_debut, session.date_fin)}</dd></div>
          <div><dt>Durée prévue <AideInfobulle id="duree_prevue" /></dt><dd>{formaterHeures(duree.heures) || "Non renseignée"}{duree.source === "formation" && <span className="sess-secondaire"> (durée de la formation)</span>}</dd></div>
          <div><dt>Horaire</dt><dd>{session.horaire || "—"}</dd></div>
          <div><dt>Lieu</dt><dd>{session.lieu || "—"}</dd></div>
          <div><dt>Formateur</dt><dd>{session.formateur || "—"}</dd></div>
          <div><dt>Formation</dt><dd>version {session.version_numero || "—"}</dd></div>
        </dl>
      </div>

      {archivee && (
        <Alert ton="info" titre="Session archivée">
          Cette session est en lecture seule : elle reste consultable, mais ne peut plus être modifiée tant qu'elle n'est pas restaurée.
        </Alert>
      )}
      {incoherences.length > 0 && (
        <Alert ton="warning" titre="Statut à vérifier">
          {incoherences.join(" ; ")}. Les dates peuvent être indicatives ou corrigées après coup — le statut n'est pas modifié automatiquement.
        </Alert>
      )}
      {err && <Alert ton="error" titre="Rechargement impossible.">{err}</Alert>}
      {bandeaux.map((b) => (
        <Alert key={b.id} ton={b.ton} titre={b.titre} action={<Button variante="ghost" compact onClick={() => fermerBandeau(b.id)} aria-label="Fermer ce message">Fermer</Button>}>
          {b.texte}
        </Alert>
      ))}

      <Tabs
        label="Sections de la session"
        onglets={[
          { to: base, libelle: "Vue d'ensemble" },
          { to: `${base}/stagiaires`, libelle: "Stagiaires", compteur: synthese.actifs, titreCompteur: `${synthese.actifs} inscrit(s) actif(s), abandons exclus` },
          { to: `${base}/parcours`, libelle: "Accompagnement" },
          { to: `${base}/assiduite`, libelle: "Assiduité" },
          { to: `${base}/evaluations`, libelle: "Évaluations", compteur: donnees.evaluations?.agregation?.total ?? 0 },
          { to: `${base}/satisfaction`, libelle: "Satisfaction", compteur: donnees.satisfactions?.agregation?.insuffisant ? null : (donnees.satisfactions?.agregation?.reponses ?? 0) },
          { to: `${base}/documents`, libelle: "Documents", compteur: donnees.documents.length + donnees.externes.length },
        ]}
      />

      <div className="sess-onglet">
        <Contenu {...ctx} />
      </div>

      {admin && (
        <ModificationSession
          ouvert={edition} session={session} nbDocuments={donnees.documents.length}
          onFermer={() => setEdition(false)}
          onEnregistree={async (r) => {
            setEdition(false);
            notifier({ ton: "success", titre: "Session enregistrée." });
            // Avertissements rendus par le serveur : jamais de régénération
            // ni de correction silencieuse, on informe seulement.
            if (r.absencesDepassentDuree) {
              notifier({
                ton: "warning", titre: "Absences supérieures à la durée prévue",
                texte: messageDepassementDuree({ total_heures_absence: r.total_heures_absence, duree_prevue: r.session.duree_heures_reelle }),
              });
            }
            if (r.documentsObsoletes && donnees.documents.length > 0) {
              notifier({
                ton: "warning", titre: "Documents peut-être obsolètes",
                texte: `${donnees.documents.length} document(s) généré(s) peuvent être obsolètes après cette modification : régénérez-les si nécessaire (onglet Documents).`,
              });
            }
            await recharger();
          }}
        />
      )}

      <ConfirmDialog
        ouvert={archivage} titre="Archiver la session ?" libelleConfirmer="Archiver la session"
        ton="primary" enCours={cycleEnCours}
        onAnnuler={() => { if (!cycleEnCours) { setArchivage(false); setErreurCycle(null); } }}
        onConfirmer={() => actionCycle("archive", "Session archivée.")}
      >
        Cette session ne sera pas supprimée. Elle restera consultable mais deviendra en lecture seule.
        {erreurCycle && <Alert ton="error">{erreurCycle}</Alert>}
      </ConfirmDialog>

      <ConfirmDialog
        ouvert={restauration} titre="Restaurer la session ?" libelleConfirmer="Restaurer la session"
        ton="primary" enCours={cycleEnCours}
        onAnnuler={() => { if (!cycleEnCours) { setRestauration(false); setErreurCycle(null); } }}
        onConfirmer={() => actionCycle("restaure", "Session restaurée.")}
      >
        La session redeviendra modifiable et réapparaîtra dans les sessions actives.
        {erreurCycle && <Alert ton="error">{erreurCycle}</Alert>}
      </ConfirmDialog>

      <SuppressionSession
        ouvert={suppression} enCours={cycleEnCours} erreur={erreurCycle}
        onAnnuler={() => { if (!cycleEnCours) { setSuppression(false); setErreurCycle(null); } }}
        onConfirmer={supprimerDefinitivement}
      />
    </div>
  );
}

// Suppression définitive : action destructive, confirmée en TAPANT
// « SUPPRIMER ». Le serveur refuse de toute façon une session qui contient
// des données de suivi (409) — cette confirmation ne remplace pas la garde
// backend, elle l'accompagne.
function SuppressionSession({ ouvert, enCours, erreur, onAnnuler, onConfirmer }) {
  const ref = useRef(null);
  const idTitre = useId();
  const [saisie, setSaisie] = useState("");
  useDialogue(ref, ouvert, { onFermer: onAnnuler, fermable: !enCours, focusInitial: "input" });
  useEffect(() => { if (ouvert) setSaisie(""); }, [ouvert]);
  if (!ouvert) return null;
  return createPortal(
    <div className="ui-modale-racine">
      <div className="ui-drawer-voile" aria-hidden="true" />
      <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby={idTitre} className="ui-modale" tabIndex={-1}>
        <h2 id={idTitre} className="ui-modale__titre">Supprimer définitivement cette session ?</h2>
        <div className="ui-modale__texte">
          <p>Cette action est irréversible. Elle n'est possible que si la session ne contient aucune donnée de suivi.</p>
          <Field label={<>Tapez <strong>SUPPRIMER</strong> pour confirmer</>}>
            <input value={saisie} onChange={(e) => setSaisie(e.target.value)} disabled={enCours} />
          </Field>
          {erreur && <Alert ton="error">{erreur}</Alert>}
        </div>
        <div className="ui-modale__actions">
          <Button data-annuler onClick={onAnnuler} disabled={enCours}>Annuler</Button>
          <Button variante="danger" onClick={onConfirmer} disabled={enCours || saisie !== "SUPPRIMER"}>
            {enCours ? "Suppression…" : "Supprimer définitivement"}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// « Modifier la session » (admin) : mêmes contrôles serveur qu'avant (dates,
// absences et évaluations hors des nouvelles bornes, durée, horaire).
function ModificationSession({ ouvert, session, onFermer, onEnregistree }) {
  const [valeurs, setValeurs] = useState(() => valeursDepuisSession(session));
  const [erreurs, setErreurs] = useState({});
  const [erreurServeur, setErreurServeur] = useState(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (ouvert) { setValeurs(valeursDepuisSession(session)); setErreurs({}); setErreurServeur(null); }
  }, [ouvert]); // eslint-disable-line react-hooks/exhaustive-deps

  async function enregistrer(e) {
    e.preventDefault();
    const trouvees = erreursSession(valeurs, "modification");
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    setEnCours(true);
    setErreurServeur(null);
    try {
      const r = await api(`/api/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          reference: valeurs.reference, date_debut: valeurs.date_debut, date_fin: valeurs.date_fin,
          lieu: valeurs.lieu, formateur: valeurs.formateur,
          duree_heures_reelle: valeurs.duree_heures_reelle === "" ? null : valeurs.duree_heures_reelle,
          horaire: valeurs.horaire, statut: valeurs.statut,
        }),
      });
      await onEnregistree(r);
    } catch (err) {
      setErreurServeur(err.message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Drawer
      ouvert={ouvert} onFermer={onFermer} fermable={!enCours} titre="Modifier la session"
      description="Les documents déjà générés ne sont jamais modifiés : vous serez prévenu s'ils peuvent être devenus obsolètes."
      pied={
        <>
          <Button onClick={onFermer} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-modification-session" disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer la session"}
          </Button>
        </>
      }
    >
      <form id="form-modification-session" onSubmit={enregistrer} noValidate>
        {erreurServeur && <Alert ton="error" titre="La session n'a pas été modifiée.">{erreurServeur}</Alert>}
        <FormulaireSession mode="modification" valeurs={valeurs} onChange={setValeurs} erreurs={erreurs} />
      </form>
    </Drawer>
  );
}
