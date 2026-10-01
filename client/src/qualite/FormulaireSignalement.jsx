import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Alert, Button, Checkbox, Drawer, Field, FormSection, LoadingState } from "../ui/index.js";
import { SelecteurIndicateurs } from "../veille/SelecteurIndicateurs.jsx";
import {
  CANAUX_SIGNALEMENT, CAUSES_SIGNALEMENT, SIGNALEMENT_VIDE, TYPES_SIGNALEMENT,
  corpsSignalement, erreursSignalement, libelleInscription, optionsInscriptions, valeursDepuisSignalement,
} from "./signalements-format.js";

const libelleUtilisateur = (u) => u.nom || u.email;

// Création / modification d'un signalement (admin), dans un panneau.
// `signalement = null` → création. Le type n'est plus modifiable après
// création ; `date_resolution` n'est jamais saisie ici (action « Résoudre »).
// Contexte : SESSION → INSCRIPTION éventuelle (jamais de liste globale).
export function FormulaireSignalement({ signalement = null, onFermer, onEnregistre }) {
  const modification = signalement !== null;
  const [valeurs, setValeurs] = useState(() => (modification ? valeursDepuisSignalement(signalement) : { ...SIGNALEMENT_VIDE }));
  const [utilisateurs, setUtilisateurs] = useState(null);
  const [formations, setFormations] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [sessionsChargees, setSessionsChargees] = useState(false);
  const [criteres, setCriteres] = useState(null);
  const [inscriptions, setInscriptions] = useState(null); // options minimales de la session choisie
  const [erreurInscriptions, setErreurInscriptions] = useState(false);
  const cacheInscriptions = useRef(new Map());
  const [erreurs, setErreurs] = useState({});
  const [erreurServeur, setErreurServeur] = useState(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    api("/api/utilisateurs").then((r) => setUtilisateurs(r.utilisateurs || [])).catch(() => setUtilisateurs([]));
    api("/api/formations").then((r) => setFormations(r.formations || [])).catch(() => setFormations([]));
    Promise.all([api("/api/sessions"), api("/api/sessions?etat=archivees")])
      .then(([a, b]) => setSessions([...(a.sessions || []), ...(b.sessions || [])]))
      .catch(() => setSessions([]))
      .finally(() => setSessionsChargees(true));
    api("/api/referentiel").then((r) => setCriteres(r.criteres || [])).catch(() => setCriteres([]));
  }, []);

  // Inscriptions de la session choisie : UN appel par session, mis en cache ;
  // seuls id / nom / prénom / statut sont conservés (jamais e-mail, téléphone,
  // handicap ni besoins d'adaptation).
  const sessionId = valeurs.session_id;
  useEffect(() => {
    setErreurInscriptions(false);
    if (!sessionId) { setInscriptions(null); return undefined; }
    const cle = Number(sessionId);
    if (cacheInscriptions.current.has(cle)) { setInscriptions(cacheInscriptions.current.get(cle)); return undefined; }
    let actif = true;
    setInscriptions(null);
    api(`/api/sessions/${cle}`)
      .then((r) => { const o = optionsInscriptions(r.stagiaires); cacheInscriptions.current.set(cle, o); if (actif) setInscriptions(o); })
      // fix : un échec n'est jamais présenté comme « aucun stagiaire » (et n'est
      // pas mis en cache : rechoisir la session relance le chargement).
      .catch(() => { if (actif) { setInscriptions([]); setErreurInscriptions(true); } });
    return () => { actif = false; };
  }, [sessionId]);

  const champ = (cle) => (e) => setValeurs((v) => ({ ...v, [cle]: e.target.value }));
  // Changer ou retirer la session remet l'inscription à zéro immédiatement.
  const changerSession = (e) => setValeurs((v) => ({ ...v, session_id: e.target.value, inscription_id: "" }));
  const basculerCause = (cause) => setValeurs((v) => {
    const causes = v.causes.includes(cause) ? v.causes.filter((c) => c !== cause) : [...v.causes, cause];
    // « Autre » retiré : son texte disparaît avec lui.
    return { ...v, causes, cause_autre_libelle: causes.includes("autre") ? v.cause_autre_libelle : "" };
  });

  const reclamation = valeurs.type === "reclamation";
  const sessionChoisie = sessions.find((s) => s.id === Number(valeurs.session_id)) || null;
  // Session liée absente des listes (une fois chargées) : la liaison est
  // CONSERVÉE, jamais supprimée en silence.
  const sessionIndisponible = !!valeurs.session_id && sessionsChargees && !sessionChoisie;
  const inscriptionConnue = !valeurs.inscription_id || (inscriptions || []).some((o) => String(o.inscription_id) === String(valeurs.inscription_id));
  // Échéance existante + date de réception modifiée : le serveur ne recalcule
  // pas l'échéance en modification ; on invite à la vérifier (sans la changer).
  const dateReceptionChangee = modification && reclamation && !!signalement.date_echeance_cible
    && valeurs.date_constat !== (signalement.date_constat || "").slice(0, 10);

  async function enregistrer(e) {
    e.preventDefault();
    const trouvees = erreursSignalement(valeurs);
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    setEnCours(true);
    setErreurServeur(null);
    try {
      const corps = corpsSignalement(valeurs, { creation: !modification, initial: signalement });
      const r = modification
        ? await api(`/api/signalements/${signalement.id}`, { method: "PATCH", body: JSON.stringify(corps) })
        : await api("/api/signalements", { method: "POST", body: JSON.stringify(corps) });
      onEnregistre(r.signalement);
    } catch (err) {
      setErreurServeur(err.message);
      setEnCours(false);
    }
  }

  return (
    <Drawer
      ouvert onFermer={onFermer} fermable={!enCours} taille="large"
      titre={modification ? "Modifier le signalement" : "Nouveau signalement"}
      description={modification ? `${signalement.reference} · ${TYPES_SIGNALEMENT[signalement.type]?.libelle || signalement.type}` : "Réclamation, incident ou non-conformité à suivre."}
      pied={
        <>
          <Button onClick={onFermer} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-signalement" disabled={enCours}>
            {enCours ? "Enregistrement…" : modification ? "Enregistrer" : "Créer le signalement"}
          </Button>
        </>
      }
    >
      <form id="form-signalement" onSubmit={enregistrer} noValidate>
        {erreurServeur && <Alert ton="error" titre="Le signalement n'a pas été enregistré.">{erreurServeur}</Alert>}

        <FormSection titre="Signalement" colonnes={2}>
          {modification ? (
            <p className="sess-secondaire ui-field--large">Type : <strong>{TYPES_SIGNALEMENT[valeurs.type]?.libelle}</strong> (non modifiable après création)</p>
          ) : (
            <Field label="Type">
              <select value={valeurs.type} onChange={champ("type")}>
                {Object.entries(TYPES_SIGNALEMENT).map(([k, t]) => <option key={k} value={k}>{t.libelle}</option>)}
              </select>
            </Field>
          )}
          <Field label={reclamation ? "Date de réception" : "Date de constat"} facultatif>
            <input type="date" value={valeurs.date_constat} onChange={champ("date_constat")} />
          </Field>
          <Field label="Objet" erreur={erreurs.objet} className="ui-field--large">
            <input value={valeurs.objet} onChange={champ("objet")} required placeholder="Ex. Convocation reçue tardivement" />
          </Field>
          <Field label="Description" facultatif className="ui-field--large">
            <textarea rows={3} value={valeurs.description} onChange={champ("description")} />
          </Field>
          {utilisateurs === null ? <LoadingState texte="Chargement des responsables…" /> : (
            <Field label="Responsable" facultatif>
              <select value={valeurs.responsable_id} onChange={champ("responsable_id")}>
                <option value="">Non assigné</option>
                {utilisateurs.map((u) => <option key={u.id} value={u.id}>{libelleUtilisateur(u)}</option>)}
                {modification && signalement.responsable_id && !utilisateurs.some((u) => u.id === signalement.responsable_id) && (
                  <option value={signalement.responsable_id}>{signalement.responsable_nom || "Utilisateur indisponible"} (inactif)</option>
                )}
              </select>
            </Field>
          )}
        </FormSection>

        <FormSection titre="Contexte" colonnes={2}>
          <Field label="Session" facultatif className="ui-field--large"
            aide="Une session archivée peut être choisie : un signalement peut être postérieur à la formation.">
            <select value={valeurs.session_id} onChange={changerSession}>
              <option value="">Aucune session</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>{s.reference} — {s.formation}{s.archivee_le ? " (archivée)" : ""}</option>
              ))}
              {sessionIndisponible && <option value={valeurs.session_id}>Session liée (indisponible dans la liste actuelle)</option>}
            </select>
          </Field>
          {valeurs.session_id ? (
            <>
              {sessionChoisie
                ? <p className="sess-secondaire ui-field--large">Formation de la session : <strong>{sessionChoisie.formation}</strong></p>
                : sessionIndisponible && (
                  <div className="ui-field--large">
                    <Alert ton="warning" titre="Session liée indisponible dans la liste actuelle.">La liaison existante est conservée.</Alert>
                  </div>
                )}
              {inscriptions === null ? <LoadingState texte="Chargement des inscriptions…" /> : erreurInscriptions ? (
                <div className="ui-field--large">
                  <Alert ton="error" titre="Impossible de charger les inscriptions de cette session.">
                    {valeurs.inscription_id ? "L'inscription actuellement liée est conservée." : "Vous pourrez rattacher un stagiaire plus tard."}
                  </Alert>
                </div>
              ) : (
                <Field label="Stagiaire concerné" facultatif className="ui-field--large">
                  <select value={valeurs.inscription_id} onChange={champ("inscription_id")}>
                    <option value="">Aucun stagiaire de cette session</option>
                    {inscriptions.map((o) => <option key={o.inscription_id} value={o.inscription_id}>{libelleInscription(o)}</option>)}
                    {!inscriptionConnue && <option value={valeurs.inscription_id}>Inscription actuellement liée (conservée)</option>}
                  </select>
                </Field>
              )}
            </>
          ) : (
            <Field label="Formation" facultatif className="ui-field--large">
              <select value={valeurs.formation_id} onChange={champ("formation_id")}>
                <option value="">Aucune formation</option>
                {formations.map((f) => <option key={f.id} value={f.id}>{f.intitule}</option>)}
              </select>
            </Field>
          )}
          {!valeurs.inscription_id && (
            <Field label="Personne concernée (si elle n'est pas liée à une inscription)" facultatif className="ui-field--large">
              <input value={valeurs.personne_concernee_libelle} onChange={champ("personne_concernee_libelle")} />
            </Field>
          )}
        </FormSection>

        {reclamation && (
          <FormSection titre="Réclamant" colonnes={2}>
            <Field label="Nom du réclamant" facultatif><input value={valeurs.reclamant_nom} onChange={champ("reclamant_nom")} /></Field>
            <Field label="Entreprise / organisme" facultatif><input value={valeurs.reclamant_entreprise} onChange={champ("reclamant_entreprise")} /></Field>
            <Field label="E-mail" facultatif><input type="email" value={valeurs.reclamant_email} onChange={champ("reclamant_email")} /></Field>
            <Field label="Canal" facultatif>
              <select value={valeurs.canal} onChange={champ("canal")}>
                <option value="">Non renseigné</option>
                {Object.entries(CANAUX_SIGNALEMENT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="Délai cible (jours ouvrés)" facultatif erreur={erreurs.delai_cible_jours_ouvres}
              aide="15 jours ouvrés par défaut — calcul indicatif du lundi au vendredi.">
              <input type="number" min="1" step="1" inputMode="numeric" value={valeurs.delai_cible_jours_ouvres} onChange={champ("delai_cible_jours_ouvres")} />
            </Field>
            <Field label="Échéance cible" facultatif aide={modification ? undefined : "Laissée vide, elle est calculée à partir de la date de réception."}>
              <input type="date" value={valeurs.date_echeance_cible} onChange={champ("date_echeance_cible")} />
            </Field>
            {dateReceptionChangee && (
              // fix : jamais de recalcul silencieux ; l'utilisateur garde la main.
              <div className="ui-field--large">
                <Alert ton="warning">La date de réception a changé. Vérifiez l'échéance cible.</Alert>
              </div>
            )}
          </FormSection>
        )}

        <fieldset className="ui-form-section">
          <legend className="ui-form-section__titre">Causes</legend>
          <div className="signalement-causes">
            {Object.entries(CAUSES_SIGNALEMENT).map(([k, l]) => (
              <Checkbox key={k} label={l} checked={valeurs.causes.includes(k)} onChange={() => basculerCause(k)} />
            ))}
          </div>
          {valeurs.causes.includes("autre") && (
            <Field label="Précisez la cause" erreur={erreurs.cause_autre_libelle}>
              <input value={valeurs.cause_autre_libelle} onChange={champ("cause_autre_libelle")} required />
            </Field>
          )}
        </fieldset>

        <FormSection titre="Indicateurs Qualiopi" colonnes={1}>
          {criteres === null
            ? <LoadingState texte="Chargement des indicateurs…" />
            : <SelecteurIndicateurs criteres={criteres} valeur={valeurs.indicateur_ids}
                dejaLies={(signalement?.indicateurs || []).map((i) => ({ id: i.id, numero: i.numero, libelle: i.libelle }))}
                onChange={(ids) => setValeurs((v) => ({ ...v, indicateur_ids: ids }))} />}
          <p className="sess-secondaire">Facultatifs pendant le traitement ; au moins un indicateur sera nécessaire avant la clôture.</p>
        </FormSection>

        {modification && (
          <FormSection titre="Réponse / traitement" colonnes={2}>
            <Field label="Synthèse de la réponse" facultatif className="ui-field--large">
              <textarea rows={3} value={valeurs.synthese_reponse} onChange={champ("synthese_reponse")} />
            </Field>
            <Field label="Date de réponse" facultatif>
              <input type="date" value={valeurs.date_reponse} onChange={champ("date_reponse")} />
            </Field>
          </FormSection>
        )}
      </form>
    </Drawer>
  );
}
