import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Alert, Button, Drawer, Field, FormSection, LoadingState } from "../ui/index.js";
import { SelecteurIndicateurs } from "../veille/SelecteurIndicateurs.jsx";
import { PRIORITES } from "./format.js";

// Libellé d'un utilisateur assignable ; l'e-mail n'est affiché QUE pour
// distinguer deux homonymes.
function libelleUtilisateur(u, tous = []) {
  const base = u.nom || u.email;
  const homonyme = tous.some((x) => x.id !== u.id && (x.nom || x.email) === base);
  return homonyme ? `${base} (${u.email})` : base;
}

// Formulaire de création / modification d'une action qualité, dans un Drawer.
// `action = null` → création ; sinon modification. `signalementSource`
// (création depuis la fiche d'un signalement) : signalement_id envoyé et
// non modifiable — le serveur en déduit l'origine « signalement » ; session
// / formation reprises du signalement, responsable seulement s'il est actif.
export function FormulaireAction({ action = null, signalementSource = null, onFermer, onEnregistre }) {
  const modification = action !== null;
  const source = modification ? null : signalementSource;
  const [valeurs, setValeurs] = useState(() => action ? {
    titre: action.titre || "",
    constat: action.constat || "",
    priorite: action.priorite || "",
    responsable_id: action.responsable_id || "",
    echeance: action.echeance || "",
    action_prevue: action.action_prevue || "",
    formation_id: action.formation_id || "",
    session_id: action.session_id || "",
    indicateur_ids: (action.indicateurs || []).map((i) => i.id),
  } : {
    titre: "", constat: "", priorite: "", responsable_id: "", echeance: "",
    action_prevue: "", indicateur_ids: [],
    session_id: source?.session_id ? String(source.session_id) : "",
    formation_id: !source?.session_id && source?.formation_id ? String(source.formation_id) : "",
  });

  const [utilisateurs, setUtilisateurs] = useState(null);
  const [formations, setFormations] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [criteres, setCriteres] = useState(null);
  const [erreurs, setErreurs] = useState({});
  const [erreurServeur, setErreurServeur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const envoiEnCours = useRef(false); // verrou synchrone (double clic, Entrée répétée)

  useEffect(() => {
    api("/api/utilisateurs").then((r) => {
      setUtilisateurs(r.utilisateurs);
      // Responsable du signalement repris UNIQUEMENT s'il est encore actif
      // (présent dans la liste des utilisateurs assignables).
      const resp = source?.responsable_id;
      if (resp && (r.utilisateurs || []).some((u) => u.id === resp)) {
        setValeurs((v) => (v.responsable_id === "" ? { ...v, responsable_id: String(resp) } : v));
      }
    }).catch(() => setUtilisateurs([]));
    api("/api/formations").then((r) => setFormations(r.formations || [])).catch(() => setFormations([]));
    Promise.all([api("/api/sessions"), api("/api/sessions?etat=archivees")])
      .then(([a, b]) => setSessions([...(a.sessions || []), ...(b.sessions || [])]))
      .catch(() => setSessions([]));
    api("/api/referentiel").then((r) => setCriteres(r.criteres || [])).catch(() => setCriteres([]));
  }, []);

  const champ = (cle) => (e) => setValeurs((v) => ({ ...v, [cle]: e.target.value }));
  const sessionChoisie = sessions.find((s) => s.id === Number(valeurs.session_id)) || null;

  async function enregistrer(e) {
    e.preventDefault();
    if (envoiEnCours.current) return; // fix : jamais de double soumission
    const trouvees = {};
    if (!String(valeurs.titre).trim()) trouvees.titre = "Indiquez un titre.";
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    envoiEnCours.current = true;
    setEnCours(true);
    setErreurServeur(null);
    try {
      const corps = {
        titre: String(valeurs.titre).trim(),
        constat: String(valeurs.constat).trim() || null,
        priorite: valeurs.priorite || null,
        responsable_id: valeurs.responsable_id ? Number(valeurs.responsable_id) : null,
        echeance: valeurs.echeance || null,
        action_prevue: String(valeurs.action_prevue).trim() || null,
        indicateur_ids: valeurs.indicateur_ids,
        session_id: valeurs.session_id ? Number(valeurs.session_id) : null,
        // Session choisie ⇒ la formation est dérivée côté serveur.
        formation_id: valeurs.session_id ? null : (valeurs.formation_id ? Number(valeurs.formation_id) : null),
      };
      if (source) corps.signalement_id = source.id;
      const r = modification
        ? await api(`/api/actions-qualite/${action.id}`, { method: "PATCH", body: JSON.stringify(corps) })
        : await api("/api/actions-qualite", { method: "POST", body: JSON.stringify(corps) });
      onEnregistre(r.action);
    } catch (err) {
      setErreurServeur(err.message);
      setEnCours(false);
      envoiEnCours.current = false;
    }
  }

  return (
    <Drawer
      ouvert onFermer={onFermer} fermable={!enCours}
      titre={modification ? "Modifier l'action" : source ? "Action qualité liée" : "Nouvelle action qualité"}
      description={modification ? action.reference : source ? `Signalement lié : ${source.reference}` : "Une action à mener pour améliorer ou corriger la situation."}
      pied={
        <>
          <Button onClick={onFermer} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-action-qualite" disabled={enCours}>
            {enCours ? "Enregistrement…" : modification ? "Enregistrer" : "Créer l'action"}
          </Button>
        </>
      }
    >
      <form id="form-action-qualite" onSubmit={enregistrer} noValidate>
        {erreurServeur && <Alert ton="error" titre="L'action n'a pas été enregistrée.">{erreurServeur}</Alert>}
        {source && (
          <p className="sess-secondaire">Signalement lié : <strong>{source.reference}</strong>{source.objet ? ` — ${source.objet}` : ""} (non modifiable ici)</p>
        )}
        <FormSection titre="Définition" colonnes={2}>
          <Field label="Titre" erreur={erreurs.titre} className="ui-field--large">
            <input value={valeurs.titre} onChange={champ("titre")} required placeholder="Ex. Relancer les convocations" />
          </Field>
          <Field label="Priorité">
            <select value={valeurs.priorite} onChange={champ("priorite")}>
              <option value="">Non définie</option>
              {Object.entries(PRIORITES).map(([k, p]) => <option key={k} value={k}>{p.libelle}</option>)}
            </select>
          </Field>
          {utilisateurs && (
            <Field label="Responsable">
              <select value={valeurs.responsable_id} onChange={champ("responsable_id")}>
                <option value="">Non assignée</option>
                {utilisateurs.map((u) => <option key={u.id} value={u.id}>{libelleUtilisateur(u, utilisateurs)}</option>)}
              </select>
            </Field>
          )}
          <Field label="Échéance" facultatif>
            <input type="date" value={valeurs.echeance} onChange={champ("echeance")} />
          </Field>
          <Field label="Constat" facultatif className="ui-field--large" aide="Le dysfonctionnement ou l'amélioration constaté(e).">
            <textarea rows={3} value={valeurs.constat} onChange={champ("constat")} />
          </Field>
        </FormSection>

        <FormSection titre="Planification" colonnes={1}>
          <Field label="Action prévue" facultatif aide="Ce qui va être fait, par qui, comment.">
            <textarea rows={3} value={valeurs.action_prevue} onChange={champ("action_prevue")} />
          </Field>
          <Field label="Session" facultatif aide="Une session archivée peut être choisie : une action qualité peut être postérieure à la formation.">
            <select value={valeurs.session_id} onChange={champ("session_id")}>
              <option value="">Aucune session</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>{s.reference} — {s.formation}{s.archivee_le ? " (archivée)" : ""}</option>
              ))}
            </select>
          </Field>
          {sessionChoisie ? (
            <p className="sess-secondaire">Formation dérivée de la session : <strong>{sessionChoisie.formation}</strong></p>
          ) : (
            <Field label="Formation" facultatif>
              <select value={valeurs.formation_id} onChange={champ("formation_id")}>
                <option value="">Aucune formation</option>
                {formations.map((f) => <option key={f.id} value={f.id}>{f.intitule}</option>)}
              </select>
            </Field>
          )}
        </FormSection>

        <FormSection titre="Indicateurs Qualiopi" colonnes={1}>
          {criteres === null
            ? <LoadingState texte="Chargement des indicateurs…" />
            : <SelecteurIndicateurs criteres={criteres} valeur={valeurs.indicateur_ids}
                dejaLies={(action?.indicateurs || []).map((i) => ({ id: i.id, numero: i.numero, libelle: i.libelle }))}
                onChange={(ids) => setValeurs((v) => ({ ...v, indicateur_ids: ids }))} />}
          <p className="sess-secondaire">Au moins un indicateur sera nécessaire avant la clôture.</p>
        </FormSection>
      </form>
    </Drawer>
  );
}
