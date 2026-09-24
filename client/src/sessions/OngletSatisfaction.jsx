import { useEffect, useState } from "react";
import { api } from "../api.js";
import { RechercheDrive } from "../RechercheDrive.jsx";
import { Alert, Badge, Button, Drawer, EmptyState, Field, FormSection } from "../ui/index.js";
import { formaterDate } from "./format.js";

export const TYPES_SATISFACTION = { a_chaud: "À chaud", a_froid: "À froid", financeur: "Financeur", entreprise: "Entreprise", formateur: "Formateur" };
const lienDrive = (id) => `https://drive.google.com/file/d/${id}/view`;
const vide = () => ({ type: "a_chaud", inscription_id: "", date_recueil: "", note_globale: "", note_max: "5", commentaires: "", fichier: null });

// Onglet Satisfaction : réponses anonymes ou nominatives. Aucune borne de
// date côté écran (un recueil à froid peut suivre la session) — règles
// inchangées, le serveur tranche.
export function OngletSatisfaction({ donnees, admin, peutSaisir, recharger, notifier }) {
  const { session, stagiaires } = donnees;
  const sa = donnees.satisfactions;
  const [formulaire, setFormulaire] = useState(null);

  return (
    <div className="sess-sections">
      <section className="sess-section" aria-labelledby="titre-satisfaction">
        <div className="sess-section__tete">
          <h2 id="titre-satisfaction" className="sess-section__titre">Satisfaction</h2>
          {peutSaisir && <Button compact variante="primary" onClick={() => setFormulaire(vide())}>Ajouter un recueil</Button>}
        </div>
        {sa.agregation.reponses > 0 && (
          <dl className="sess-chiffres">
            <div><dt>Réponses</dt><dd>{sa.agregation.reponses}</dd></div>
            <div><dt>Anonymes / nominatives</dt><dd>{sa.agregation.anonymes} / {sa.agregation.nominatives}</dd></div>
            <div>
              <dt>Moyenne</dt>
              <dd>{sa.agregation.moyenne !== null ? `${sa.agregation.moyenne} / ${sa.agregation.echelleHomogene}` : "Non calculable (échelles différentes)"}</dd>
            </div>
          </dl>
        )}
        {sa.satisfactions.length === 0 ? (
          <EmptyState titre="Aucune réponse recueillie" action={peutSaisir && <Button variante="primary" onClick={() => setFormulaire(vide())}>Ajouter un recueil</Button>}>
            Enregistrez les questionnaires à chaud, à froid, financeur, entreprise ou formateur.
          </EmptyState>
        ) : (
          <table className="sess-table">
            <caption className="visually-hidden">Réponses de satisfaction</caption>
            <thead>
              <tr>
                <th scope="col">Répondant</th><th scope="col">Type</th><th scope="col">Date</th>
                <th scope="col" className="sess-num">Note</th><th scope="col">Commentaire</th><th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {sa.satisfactions.map((f) => (
                <tr key={f.id}>
                  <td data-label="Répondant" className="sess-table__principal">{f.nom ? `${f.nom} ${f.prenom}` : "Anonyme"}</td>
                  <td data-label="Type"><Badge ton="neutral">{TYPES_SATISFACTION[f.type] || f.type}</Badge></td>
                  <td data-label="Date">{formaterDate(f.date_recueil)}</td>
                  <td data-label="Note" className="sess-num">{f.note_globale !== null && f.note_globale !== undefined ? `${f.note_globale} / ${f.note_max}` : "—"}</td>
                  <td data-label="Commentaire" className="sess-table__texte">{f.commentaires || "—"}</td>
                  <td className="sess-table__actions">
                    {f.drive_file_id && <a className="ui-btn ui-btn--ghost ui-btn--compact" href={lienDrive(f.drive_file_id)} target="_blank" rel="noreferrer">Pièce<span className="visually-hidden"> (nouvel onglet)</span></a>}
                    {peutSaisir && (
                      <Button compact onClick={() => setFormulaire({
                        id: f.id, type: f.type, inscription_id: f.inscription_id ? String(f.inscription_id) : "",
                        date_recueil: String(f.date_recueil || "").slice(0, 10), note_globale: f.note_globale ?? "",
                        note_max: String(f.note_max), commentaires: f.commentaires || "", fichier: null,
                      })}>Modifier</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {peutSaisir && (
        <DrawerSatisfaction valeurInitiale={formulaire} sessionId={session.id} stagiaires={stagiaires} admin={admin}
          onFermer={() => setFormulaire(null)}
          onFait={async (m) => { setFormulaire(null); notifier({ ton: "success", titre: m }); await recharger(); }} />
      )}
    </div>
  );
}

function DrawerSatisfaction({ valeurInitiale, sessionId, stagiaires, admin, onFermer, onFait }) {
  const [v, setV] = useState(null);
  const [erreurs, setErreurs] = useState({});
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => { setV(valeurInitiale); setErreurs({}); setErreur(null); }, [valeurInitiale]);

  async function valider(e) {
    e.preventDefault();
    if (!v.date_recueil) { setErreurs({ date_recueil: "Indiquez la date." }); return; }
    setErreurs({}); setEnCours(true); setErreur(null);
    try {
      const corps = {
        type: v.type, date_recueil: v.date_recueil, commentaires: v.commentaires,
        inscription_id: v.inscription_id === "" ? null : Number(v.inscription_id),
        note_globale: v.note_globale === "" ? null : Number(v.note_globale),
        note_max: Number(v.note_max || 5),
        ...(v.fichier ? { drive_file_id: v.fichier.id } : {}),
      };
      if (v.id) await api(`/api/satisfactions/${v.id}`, { method: "PATCH", body: JSON.stringify(corps) });
      else await api(`/api/sessions/${sessionId}/satisfactions`, { method: "POST", body: JSON.stringify(corps) });
      await onFait(v.id ? "Réponse modifiée." : "Réponse enregistrée.");
    } catch (err) { setErreur(err.message); } finally { setEnCours(false); }
  }

  const ouvert = !!v;
  const c = (cle) => (e) => setV({ ...v, [cle]: e.target.value });
  return (
    <Drawer ouvert={ouvert} onFermer={onFermer} fermable={!enCours}
      titre={v?.id ? "Modifier la réponse" : "Ajouter un recueil"}
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
        <Button variante="primary" type="submit" form="form-satisfaction" disabled={enCours}>{enCours ? "Enregistrement…" : "Enregistrer la réponse"}</Button></>}>
      {ouvert && (
        <form id="form-satisfaction" onSubmit={valider} noValidate className="ui-form">
          {erreur && <Alert ton="error" titre="La réponse n'a pas été enregistrée.">{erreur}</Alert>}
          <FormSection titre="Recueil">
            <Field label="Type">
              <select value={v.type} onChange={c("type")}>
                {Object.entries(TYPES_SATISFACTION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="Répondant" aide="Laisser « Anonyme » pour une réponse non nominative.">
              <select value={v.inscription_id} onChange={c("inscription_id")}>
                <option value="">Anonyme</option>
                {stagiaires.map((s) => <option key={s.inscription_id} value={String(s.inscription_id)}>{s.nom} {s.prenom}</option>)}
              </select>
            </Field>
            <Field label="Date du recueil" erreur={erreurs.date_recueil}>
              <input type="date" value={v.date_recueil} onChange={c("date_recueil")} />
            </Field>
          </FormSection>
          <FormSection titre="Note">
            <Field label="Note" facultatif><input type="number" min="0" step="0.1" inputMode="decimal" value={v.note_globale} onChange={c("note_globale")} /></Field>
            <Field label="Note maximale"><input type="number" min="1" step="0.1" inputMode="decimal" value={v.note_max} onChange={c("note_max")} /></Field>
          </FormSection>
          <FormSection titre="Commentaires" colonnes={1}>
            <Field label="Commentaires" facultatif><textarea rows={4} value={v.commentaires} onChange={c("commentaires")} /></Field>
          </FormSection>
          {admin && (
            <FormSection titre="Pièce justificative (Drive)" colonnes={1}>
              {v.fichier
                ? <p>Fichier : <strong>{v.fichier.nom}</strong> <Button compact variante="ghost" onClick={() => setV({ ...v, fichier: null })}>Retirer</Button></p>
                : <RechercheDrive surChoix={(f) => setV({ ...v, fichier: f })} onErreur={setErreur} placeholder="Rechercher la pièce sur le Drive (facultatif)" />}
            </FormSection>
          )}
        </form>
      )}
    </Drawer>
  );
}
