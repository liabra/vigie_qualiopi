import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";

// /questionnaires (admin) : un questionnaire par formation, pour la
// partie B de la fiche d'analyse des besoins et de positionnement.
// Le questionnaire eSenior (pages 3-4 du document actuel) n'est pas ici :
// cette page ne concerne que les formations qui adoptent ce système.
const TYPES = {
  texte_libre: "Texte libre",
  oui_non: "Oui / Non",
  choix_unique: "Choix unique",
  choix_multiple: "Choix multiple",
};
const AVEC_OPTIONS = ["choix_unique", "choix_multiple"];

export function QuestionnairesPage() {
  useTitrePage("Questionnaires de formation");
  const [formations, setFormations] = useState(null);
  const [err, setErr] = useState(null);
  const [formationId, setFormationId] = useState(null);
  const [donnees, setDonnees] = useState(null); // { questionnaire, questions }
  const [errDonnees, setErrDonnees] = useState(null);
  const [panneau, setPanneau] = useState(null); // { mode: "creation" | "modification", question }
  const [aArchiver, setAArchiver] = useState(null);
  const [succes, setSucces] = useState(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    api("/api/formations").then((r) => {
      setFormations(r.formations);
      if (r.formations.length && formationId === null) setFormationId(r.formations[0].id);
    }).catch((e) => setErr(e.message));
  }, [formationId]);

  const charger = useCallback(async () => {
    if (!formationId) return;
    try { setDonnees(await api(`/api/formations/${formationId}/questionnaire`)); setErrDonnees(null); }
    catch (e) { setErrDonnees(e.message); }
  }, [formationId]);
  useEffect(() => { setDonnees(null); charger(); }, [charger]);

  const formation = formations?.find((f) => f.id === formationId);
  const actives = (donnees?.questions || []).filter((q) => !q.archivee);
  const archivees = (donnees?.questions || []).filter((q) => q.archivee);

  async function deplacer(question, sens) {
    const i = actives.findIndex((q) => q.id === question.id);
    const j = i + sens;
    if (j < 0 || j >= actives.length) return;
    const ordre = actives.map((q) => q.id);
    [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
    setEnCours(true);
    try {
      await api(`/api/formations/${formationId}/questionnaire/questions/ordre`, { method: "PUT", body: JSON.stringify({ ordre }) });
      await charger();
    } catch (e) { setErrDonnees(e.message); } finally { setEnCours(false); }
  }

  async function archiver(question) {
    setEnCours(true);
    try {
      await api(`/api/questionnaire-questions/${question.id}`, { method: "DELETE" });
      await charger();
      setSucces(`« ${question.libelle} » retirée du questionnaire. Les réponses déjà recueillies restent conservées.`);
    } catch (e) { setErrDonnees(e.message); } finally { setEnCours(false); setAArchiver(null); }
  }

  async function reactiver(question) {
    setEnCours(true);
    try { await api(`/api/questionnaire-questions/${question.id}/reactiver`, { method: "POST" }); await charger(); }
    catch (e) { setErrDonnees(e.message); } finally { setEnCours(false); }
  }

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Paramètres" }, { libelle: "Questionnaires de formation" }]}
        titre="Questionnaires de formation"
        description="Questions de positionnement propres à chaque formation. Les réponses se saisissent dans le dossier d'accompagnement de chaque stagiaire (onglet Accompagnement de la session)."
      />
      {succes && <Alert ton="success">{succes}</Alert>}
      {err && <Alert ton="error" titre="Les formations n'ont pas pu être chargées.">{err}</Alert>}
      {!formations && !err && <LoadingState texte="Chargement des formations…" />}

      {formations?.length === 0 && <EmptyState titre="Aucune formation">Créez une formation avant de lui associer un questionnaire.</EmptyState>}

      {formations?.length > 0 && (
        <>
          <Field label="Formation" className="ui-field--large">
            <select value={formationId ?? ""} onChange={(e) => setFormationId(Number(e.target.value))}>
              {formations.map((f) => <option key={f.id} value={f.id}>{f.intitule}</option>)}
            </select>
          </Field>

          {errDonnees && <Alert ton="error" titre="Le questionnaire n'a pas pu être chargé." action={<Button compact onClick={charger}>Réessayer</Button>}>{errDonnees}</Alert>}
          {!donnees && !errDonnees && <LoadingState texte="Chargement du questionnaire…" />}

          {donnees && (
            <div className="ui-form">
              {!donnees.questionnaire && <Alert ton="info">Cette formation n'a pas encore de questionnaire : ajoutez une première question pour le créer.</Alert>}
              <div className="sess-actions">
                <Button variante="primary" compact onClick={() => { setSucces(null); setPanneau({ mode: "creation" }); }}>
                  + Ajouter une question
                </Button>
              </div>

              {actives.length === 0 ? (
                <EmptyState titre="Aucune question active">Ajoutez la première question du questionnaire de « {formation?.intitule} ».</EmptyState>
              ) : (
                <table className="sess-table param-table">
                  <caption className="visually-hidden">Questions actives ({actives.length})</caption>
                  <thead>
                    <tr>
                      <th scope="col">Question</th>
                      <th scope="col">Type</th>
                      <th scope="col">Obligatoire</th>
                      <th scope="col"><span className="visually-hidden">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {actives.map((q, i) => (
                      <tr key={q.id}>
                        <td data-label="Question" className="sess-table__principal">{q.libelle}</td>
                        <td data-label="Type">{TYPES[q.type] || q.type}{AVEC_OPTIONS.includes(q.type) ? ` (${q.options.length})` : ""}</td>
                        <td data-label="Obligatoire">{q.obligatoire ? <Badge ton="info">Obligatoire</Badge> : <Badge>Facultative</Badge>}</td>
                        <td className="sess-table__actions">
                          <Button compact aria-label={`Monter « ${q.libelle} »`} disabled={i === 0 || enCours} onClick={() => deplacer(q, -1)}>↑</Button>
                          <Button compact aria-label={`Descendre « ${q.libelle} »`} disabled={i === actives.length - 1 || enCours} onClick={() => deplacer(q, 1)}>↓</Button>
                          <Button compact onClick={() => { setSucces(null); setPanneau({ mode: "modification", question: q }); }}>Modifier</Button>
                          <Button compact variante="danger" disabled={enCours} onClick={() => setAArchiver(q)}>Retirer</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {archivees.length > 0 && (
                <details>
                  <summary>Questions retirées ({archivees.length}) — leurs réponses restent consultables dans le dossier de chaque stagiaire</summary>
                  <table className="sess-table param-table">
                    <caption className="visually-hidden">Questions retirées ({archivees.length})</caption>
                    <thead><tr><th scope="col">Question</th><th scope="col">Type</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
                    <tbody>
                      {archivees.map((q) => (
                        <tr key={q.id} className="sess-table__ligne--estompee">
                          <td data-label="Question">{q.libelle}</td>
                          <td data-label="Type">{TYPES[q.type] || q.type}</td>
                          <td className="sess-table__actions"><Button compact disabled={enCours} onClick={() => reactiver(q)}>Réactiver</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </div>
          )}
        </>
      )}

      <PanneauQuestion
        panneau={panneau} onFermer={() => setPanneau(null)} formationId={formationId}
        onEnregistre={async (message) => { setPanneau(null); await charger(); setSucces(message); }}
      />

      <ConfirmDialog
        ouvert={!!aArchiver} titre="Retirer cette question du questionnaire ?" libelleConfirmer="Retirer"
        ton="danger" enCours={enCours} onConfirmer={() => archiver(aArchiver)} onAnnuler={() => setAArchiver(null)}
      >
        <p>« {aArchiver?.libelle} » ne sera plus proposée aux nouveaux stagiaires de cette formation.</p>
        <p>Les réponses déjà recueillies pour cette question restent conservées et consultables, avec le libellé et les options qu'elles avaient au moment de la saisie.</p>
      </ConfirmDialog>
    </>
  );
}

function PanneauQuestion({ panneau, onFermer, onEnregistre, formationId }) {
  const modification = panneau?.mode === "modification";
  const [libelle, setLibelle] = useState("");
  const [type, setType] = useState("texte_libre");
  const [options, setOptions] = useState(["", ""]);
  const [obligatoire, setObligatoire] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [erreurServeur, setErreurServeur] = useState(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!panneau) return;
    const q = panneau.question;
    setLibelle(q?.libelle || "");
    setType(q?.type || "texte_libre");
    setOptions(q?.options?.length ? q.options : ["", ""]);
    setObligatoire(q?.obligatoire || false);
    setErreur(null); setErreurServeur(null); setEnCours(false);
  }, [panneau]);

  const avecOptions = AVEC_OPTIONS.includes(type);

  async function enregistrer(e) {
    e.preventDefault();
    if (!libelle.trim()) { setErreur("Indiquez le libellé de la question."); return; }
    if (avecOptions && options.filter((o) => o.trim()).length < 2) { setErreur("Indiquez au moins deux options de réponse."); return; }
    setErreur(null); setErreurServeur(null); setEnCours(true);
    const corps = { libelle, type, obligatoire, options: avecOptions ? options.filter((o) => o.trim()) : [] };
    try {
      if (modification) {
        await api(`/api/questionnaire-questions/${panneau.question.id}`, { method: "PATCH", body: JSON.stringify(corps) });
        await onEnregistre("Question modifiée.");
      } else {
        await api(`/api/formations/${formationId}/questionnaire/questions`, { method: "POST", body: JSON.stringify(corps) });
        await onEnregistre("Question ajoutée.");
      }
    } catch (err) {
      setErreurServeur(err.message);
      setEnCours(false);
    }
  }

  return (
    <Drawer
      ouvert={!!panneau} onFermer={onFermer} fermable={!enCours} taille="large"
      titre={modification ? "Modifier la question" : "Nouvelle question"}
      pied={
        <>
          <Button onClick={onFermer} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-question" disabled={enCours}>
            {enCours ? "Enregistrement…" : modification ? "Enregistrer" : "Ajouter"}
          </Button>
        </>
      }
    >
      <form id="form-question" onSubmit={enregistrer} noValidate className="ui-form">
        {erreurServeur && <Alert ton="error" titre="La question n'a pas été enregistrée.">{erreurServeur}</Alert>}
        {modification && <Alert ton="info">Modifier le libellé ou les options ne change pas les réponses déjà enregistrées : elles conservent leur propre énoncé.</Alert>}
        <FormSection titre="Question" colonnes={1}>
          <Field label="Libellé" erreur={erreur && !libelle.trim() ? erreur : null}>
            <textarea rows={2} maxLength={500} value={libelle} onChange={(e) => setLibelle(e.target.value)} required />
          </Field>
          <Field label="Type de réponse">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Checkbox label="Réponse obligatoire" checked={obligatoire} onChange={(e) => setObligatoire(e.target.checked)} />
        </FormSection>
        {avecOptions && (
          <FormSection titre="Options de réponse" colonnes={1}>
            {options.map((o, i) => (
              // Libellé relié au champ de saisie lui-même (et non à son conteneur).
              <div key={i} className="sess-actions">
                <Field label={`Option ${i + 1}`} facultatif={i >= 2}>
                  <input maxLength={200} value={o} onChange={(e) => setOptions((opts) => opts.map((v, j) => (j === i ? e.target.value : v)))} />
                </Field>
                {options.length > 2 && (
                  <Button compact variante="danger" type="button" aria-label={`Retirer l'option ${i + 1}`}
                    onClick={() => setOptions((opts) => opts.filter((_, j) => j !== i))}>Retirer</Button>
                )}
              </div>
            ))}
            <Button compact type="button" onClick={() => setOptions((opts) => [...opts, ""])}>+ Ajouter une option</Button>
            {erreur && <Alert ton="error">{erreur}</Alert>}
          </FormSection>
        )}
      </form>
    </Drawer>
  );
}
