import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { formaterDate } from "../pilotage/RegistrePage.jsx";
import { LienPdf } from "../pilotage/PreuvesPdf.jsx";

const TON = { prevue: "info", realisee: "success", annulee: "neutral" };

// Plan de développement des compétences des intervenants (indicateurs 21 et 22).
export function DeveloppementPage() {
  useTitrePage("Développement des intervenants");
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [ouvert, setOuvert] = useState(null);
  const charger = useCallback(() => api("/api/developpement").then((r) => { setD(r); setErreur(null); }).catch((e) => setErreur(e.message)), []);
  useEffect(() => { charger(); }, [charger]);
  return (
    <>
      <PageHeader fil={[{ libelle: "Équipe" }, { libelle: "Développement des intervenants" }]} titre="Développement des compétences des intervenants"
        description="Indicateurs 21 et 22 : compétences, entretiens, formations suivies ou prévues et efficacité. Un entretien de plus d'un an est signalé."
        actions={<LienPdf href="/api/pdf/developpement">PDF du plan de développement</LienPdf>} />
      {erreur && <Alert ton="error">{erreur}</Alert>}
      {!d && !erreur && <LoadingState texte="Chargement…" />}
      {d?.intervenants.length === 0 && <EmptyState titre="Aucun intervenant actif">Ajoutez les intervenants dans Formation → Intervenants.</EmptyState>}
      {d?.intervenants.length > 0 && (
        <table className="sess-table">
          <caption className="visually-hidden">Intervenants</caption>
          <thead><tr><th scope="col">Intervenant</th><th scope="col">Dernier entretien</th><th scope="col">Actions</th><th scope="col">Besoins identifiés</th><th scope="col"><span className="visually-hidden">Ouvrir</span></th></tr></thead>
          <tbody>{d.intervenants.map((i) => (
            <tr key={i.id}>
              <td data-label="Intervenant" className="sess-table__principal">{i.prenom} {i.nom}</td>
              <td data-label="Dernier entretien">{formaterDate(i.date_dernier_entretien) || "—"}{i.entretien_a_faire && <> <Badge ton="warning">À planifier</Badge></>}</td>
              <td data-label="Actions">{i.realisees} réalisée(s), {i.prevues} prévue(s)</td>
              <td data-label="Besoins identifiés">{i.besoins_developpement ? i.besoins_developpement.slice(0, 90) : "—"}</td>
              <td className="sess-table__actions"><Button compact onClick={() => setOuvert(i.id)} aria-label={`Ouvrir le dossier de ${i.prenom} ${i.nom}`}>Ouvrir</Button></td>
            </tr>))}
          </tbody>
        </table>
      )}
      {ouvert && <DossierDeveloppement id={ouvert} onFermer={() => { setOuvert(null); charger(); }} />}
    </>
  );
}

const ACTION_VIDE = { intitule: "", type: "formation", organisme: "", competence_visee: "", date_debut: "", date_fin: "", duree_heures: "", statut: "prevue", evaluation_efficacite: "", lien_preuve: "" };

export function DossierDeveloppement({ id, onFermer }) {
  const [d, setD] = useState(null);
  const [fiche, setFiche] = useState(null);
  const [action, setAction] = useState(null); // null | objet en édition
  const [aSupprimer, setASupprimer] = useState(null);
  const [message, setMessage] = useState(null);
  const charger = useCallback(() => api(`/api/intervenants/${id}/developpement`).then((r) => {
    setD(r);
    const i = r.intervenant;
    setFiche({ specialites: i.specialites || "", diplomes_certifications: i.diplomes_certifications || "", besoins_developpement: i.besoins_developpement || "", date_dernier_entretien: i.date_dernier_entretien ? String(i.date_dernier_entretien).slice(0, 10) : "" });
  }).catch((e) => setMessage({ ton: "error", texte: e.message })), [id]);
  useEffect(() => { charger(); }, [charger]);
  const agir = async (fn, texte) => { setMessage(null); try { await fn(); setMessage({ ton: "success", texte }); await charger(); return true; } catch (e) { setMessage({ ton: "error", texte: e.message }); return false; } };
  const f = (k) => (e) => setFiche({ ...fiche, [k]: e.target.value });
  return (
    <Drawer ouvert onFermer={onFermer} taille="large" titre={d ? `${d.intervenant.prenom || ""} ${d.intervenant.nom}` : "Intervenant"} description="Compétences et développement"
      pied={<><LienPdf href={`/api/pdf/intervenants/${id}/developpement`}>PDF de l'intervenant</LienPdf><Button onClick={onFermer}>Fermer</Button></>}>
      {message && <Alert ton={message.ton}>{message.texte}</Alert>}
      {!d && <LoadingState texte="Chargement…" />}
      {d && fiche && (
        <div className="ui-form">
          <FormSection titre="Compétences" colonnes={2}>
            <Field label="Spécialités" facultatif className="ui-field--large"><textarea rows={2} maxLength={2000} value={fiche.specialites} onChange={f("specialites")} /></Field>
            <Field label="Diplômes, certifications, habilitations" facultatif className="ui-field--large"><textarea rows={3} maxLength={4000} value={fiche.diplomes_certifications} onChange={f("diplomes_certifications")} /></Field>
            <Field label="Besoins de développement identifiés" facultatif className="ui-field--large"><textarea rows={3} maxLength={4000} value={fiche.besoins_developpement} onChange={f("besoins_developpement")} /></Field>
            <Field label="Date du dernier entretien professionnel" facultatif><input type="date" value={fiche.date_dernier_entretien} onChange={f("date_dernier_entretien")} /></Field>
          </FormSection>
          <Button variante="primary" onClick={() => agir(() => api(`/api/intervenants/${id}/competences`, { method: "PATCH", body: JSON.stringify({ ...fiche, date_dernier_entretien: fiche.date_dernier_entretien || null }) }), "Compétences enregistrées.")}>Enregistrer les compétences</Button>
          <h3>Actions de développement</h3>
          {d.actions.length === 0 && <p className="sess-secondaire">Aucune action enregistrée.</p>}
          <ul className="pilotage-liste">{d.actions.map((a) => (
            <li key={a.id}>
              <Badge ton={TON[a.statut]}>{d.statuts[a.statut]}</Badge>
              <span><strong>{a.intitule}</strong> — {d.types[a.type]}{a.organisme ? ` (${a.organisme})` : ""} · {[formaterDate(a.date_debut), formaterDate(a.date_fin)].filter(Boolean).join(" → ")}{a.duree_heures ? ` · ${Number(a.duree_heures)} h` : ""}</span>
              <Button compact onClick={() => setAction({ ...ACTION_VIDE, ...Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v === null ? "" : String(v).slice(0, k.startsWith("date_") ? 10 : undefined)])) })}>Modifier</Button>
              <Button compact variante="danger" onClick={() => setASupprimer(a)}>Supprimer</Button>
            </li>))}
          </ul>
          <Button onClick={() => setAction({ ...ACTION_VIDE })}>+ Ajouter une action</Button>
          {action && <FormAction action={action} types={d.types} statuts={d.statuts} onAnnuler={() => setAction(null)}
            onEnregistrer={async (v) => {
              const corps = { ...v, duree_heures: v.duree_heures === "" ? null : Number(v.duree_heures) };
              for (const k of ["date_debut", "date_fin", "organisme", "competence_visee", "evaluation_efficacite", "lien_preuve"]) if (corps[k] === "") corps[k] = null;
              delete corps.id; delete corps.intervenant_id; delete corps.cree_par; delete corps.cree_le; delete corps.mis_a_jour_le;
              const ok = await agir(() => api(action.id ? `/api/developpement/${action.id}` : `/api/intervenants/${id}/developpement`, { method: action.id ? "PATCH" : "POST", body: JSON.stringify(corps) }), "Action enregistrée.");
              if (ok) setAction(null);
            }} />}
        </div>
      )}
      <ConfirmDialog ouvert={!!aSupprimer} titre="Supprimer cette action ?" libelleConfirmer="Supprimer" onAnnuler={() => setASupprimer(null)}
        onConfirmer={async () => { await agir(() => api(`/api/developpement/${aSupprimer.id}`, { method: "DELETE" }), "Action supprimée."); setASupprimer(null); }}>
        <p>Préférez le statut « Annulée » pour garder la trace d'une action prévue non réalisée.</p>
      </ConfirmDialog>
    </Drawer>
  );
}

function FormAction({ action, types, statuts, onAnnuler, onEnregistrer }) {
  const [v, setV] = useState(action);
  const f = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <fieldset className="ui-form-section">
      <legend>{action.id ? "Modifier l'action" : "Nouvelle action"}</legend>
      <div className="ui-form">
        <Field label="Intitulé"><input value={v.intitule} maxLength={200} onChange={f("intitule")} /></Field>
        <Field label="Type"><select value={v.type} onChange={f("type")}>{Object.entries(types).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Statut"><select value={v.statut} onChange={f("statut")}>{Object.entries(statuts).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Organisme" facultatif><input value={v.organisme} maxLength={200} onChange={f("organisme")} /></Field>
        <Field label="Compétence visée" facultatif><input value={v.competence_visee} maxLength={500} onChange={f("competence_visee")} /></Field>
        <Field label="Début" facultatif><input type="date" value={v.date_debut} onChange={f("date_debut")} /></Field>
        <Field label="Fin" facultatif><input type="date" value={v.date_fin} onChange={f("date_fin")} /></Field>
        <Field label="Durée (heures)" facultatif><input type="number" min={0} max={2000} step={0.5} value={v.duree_heures} onChange={f("duree_heures")} /></Field>
        <Field label="Évaluation de l'efficacité" facultatif aide="Ce que l'action a changé dans la pratique (indicateur 22)."><textarea rows={3} maxLength={4000} value={v.evaluation_efficacite} onChange={f("evaluation_efficacite")} /></Field>
        <Field label="Lien vers la preuve (attestation…)" facultatif><input type="url" value={v.lien_preuve} maxLength={500} onChange={f("lien_preuve")} /></Field>
        <div className="sess-actions"><Button onClick={onAnnuler}>Annuler</Button><Button variante="primary" onClick={() => onEnregistrer(v)}>Enregistrer l'action</Button></div>
      </div>
    </fieldset>
  );
}
