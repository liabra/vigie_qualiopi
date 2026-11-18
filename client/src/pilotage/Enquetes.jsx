import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { formaterDate } from "./RegistrePage.jsx";

export const lienPublic = (jeton) => `${window.location.origin}/repondre/${jeton}`;

// ── Liste et création ────────────────────────────────────────
export function EnquetesPage() {
  useTitrePage("Enquêtes en ligne");
  const navigate = useNavigate();
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [creation, setCreation] = useState(false);
  useEffect(() => { api("/api/enquetes").then(setDonnees).catch((e) => setErreur(e.message)); }, []);
  const nouvelle = <Button variante="primary" onClick={() => setCreation(true)}>+ Nouvelle enquête</Button>;
  return (
    <>
      <PageHeader fil={[{ libelle: "Formations" }, { libelle: "Enquêtes en ligne" }]} titre="Enquêtes en ligne"
        description="Satisfaction à chaud, suivi à froid, avis des partenaires : un lien (ou QR code) à transmettre, des réponses anonymes, une synthèse calculée et l'analyse tracée." actions={nouvelle} />
      {erreur && <Alert ton="error" titre="Chargement impossible.">{erreur}</Alert>}
      {!donnees && !erreur && <LoadingState texte="Chargement…" />}
      {donnees?.enquetes.length === 0 && <EmptyState titre="Aucune enquête" action={nouvelle}>Créez une enquête à partir d'un modèle, puis transmettez le lien aux stagiaires.</EmptyState>}
      {donnees?.enquetes.length > 0 && (
        <table className="sess-table">
          <caption className="visually-hidden">Enquêtes</caption>
          <thead><tr><th scope="col">Enquête</th><th scope="col">Session</th><th scope="col">Réponses</th><th scope="col">État</th></tr></thead>
          <tbody>{donnees.enquetes.map((e) => (
            <tr key={e.id}>
              <td data-label="Enquête" className="sess-table__principal"><Link to={`/enquetes/${e.id}`}>{e.titre}</Link> <span className="sess-secondaire">· {donnees.types[e.type]}</span></td>
              <td data-label="Session">{e.session_reference || e.formation} ({formaterDate(e.date_debut)})</td>
              <td data-label="Réponses">{e.reponses}{e.taux_reponse !== null ? ` · ${e.taux_reponse} %` : ""}</td>
              <td data-label="État">{e.active ? <Badge ton="success">Ouverte</Badge> : <Badge>Close</Badge>}{!e.active && e.reponses > 0 && !e.analyse && <> <Badge ton="warning">À analyser</Badge></>}</td>
            </tr>))}
          </tbody>
        </table>
      )}
      {creation && <CreationEnquete onFermer={() => setCreation(false)} onCree={(id) => navigate(`/enquetes/${id}`)} />}
    </>
  );
}

function CreationEnquete({ onFermer, onCree }) {
  const [modeles, setModeles] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [v, setV] = useState({ modele: "satisfaction_chaud", session_id: "", date_fin: "" });
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    api("/api/enquetes/modeles").then((r) => setModeles(r.modeles)).catch((e) => setErreur(e.message));
    api("/api/sessions").then((r) => setSessions((r.sessions || []).filter((s) => !s.archivee_le))).catch(() => {});
  }, []);
  async function creer(e) {
    e.preventDefault();
    if (!v.session_id) return setErreur("Choisissez la session concernée.");
    setEnCours(true); setErreur(null);
    try { const r = await api("/api/enquetes", { method: "POST", body: JSON.stringify({ modele: v.modele, session_id: Number(v.session_id), date_fin: v.date_fin || null }) }); onCree(r.enquete.id); }
    catch (err) { setErreur(err.message); setEnCours(false); }
  }
  const modele = modeles?.find((m) => m.code === v.modele);
  return (
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} taille="large" titre="Nouvelle enquête" description="Partez d'un modèle : les questions restent modifiables tant qu'aucune réponse n'est arrivée."
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button><Button variante="primary" type="submit" form="form-enquete" disabled={enCours || !modeles}>{enCours ? "Création…" : "Créer"}</Button></>}>
      <form id="form-enquete" onSubmit={creer} noValidate className="ui-form">
        {erreur && <Alert ton="error">{erreur}</Alert>}
        {!modeles && !erreur && <LoadingState texte="Chargement des modèles…" />}
        {modeles && (
          <FormSection titre="Enquête" colonnes={2}>
            <Field label="Modèle"><select value={v.modele} onChange={(e) => setV({ ...v, modele: e.target.value })}>{modeles.map((m) => <option key={m.code} value={m.code}>{m.titre}</option>)}</select></Field>
            <Field label="Session"><select value={v.session_id} onChange={(e) => setV({ ...v, session_id: e.target.value })}><option value="">Choisir…</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.reference || s.formation} — {s.formation} — {formaterDate(s.date_debut)}</option>)}</select></Field>
            <Field label="Clôture automatique le" facultatif><input type="date" value={v.date_fin} onChange={(e) => setV({ ...v, date_fin: e.target.value })} /></Field>
          </FormSection>
        )}
        {modele && <><h3>Questions du modèle</h3><ol>{modele.questions.map((q, i) => <li key={i}>{q.libelle}{q.globale ? " (satisfaction globale)" : ""}</li>)}</ol></>}
      </form>
    </Drawer>
  );
}

// ── Détail : lien, résultats, analyse ────────────────────────
function Barres({ repartition, libelles }) {
  const total = repartition.reduce((a, b) => a + b, 0) || 1;
  return (
    <ul className="enquete-barres">
      {repartition.map((n, i) => (
        <li key={i}><span className="enquete-barres__libelle">{libelles[i]}</span>
          <span className="enquete-barres__piste" aria-hidden="true"><span className="enquete-barres__barre" style={{ width: `${Math.round((n / total) * 100)}%` }} /></span>
          <span className="enquete-barres__valeur">{n}</span></li>
      ))}
    </ul>
  );
}

export function EnquetePage() {
  const { enqueteId } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [message, setMessage] = useState(null);
  const [analyse, setAnalyse] = useState("");
  const [edition, setEdition] = useState(false);
  const [suppression, setSuppression] = useState(false);
  useTitrePage(d?.enquete.titre || "Enquête");
  const charger = useCallback(() => api(`/api/enquetes/${enqueteId}`).then((r) => { setD(r); setAnalyse(r.enquete.analyse || ""); setErreur(null); }).catch((e) => setErreur(e.message)), [enqueteId]);
  useEffect(() => { charger(); }, [charger]);
  const agir = async (fn, texte) => { setMessage(null); try { await fn(); setMessage({ ton: "success", texte }); await charger(); } catch (e) { setMessage({ ton: "error", texte: e.message }); } };
  if (erreur) return <Alert ton="error" titre="Enquête introuvable.">{erreur}</Alert>;
  if (!d) return <LoadingState texte="Chargement…" />;
  const e = d.enquete;
  const lien = lienPublic(e.jeton);
  const patch = (corps, texte) => agir(() => api(`/api/enquetes/${e.id}`, { method: "PATCH", body: JSON.stringify(corps) }), texte);
  return (
    <>
      <PageHeader fil={[{ libelle: "Formations" }, { libelle: "Enquêtes en ligne", to: "/enquetes" }, { libelle: e.titre }]} titre={e.titre}
        description={`${d.types[e.type]} — ${e.formation || ""} — session ${e.session_reference || ""} du ${formaterDate(e.date_debut)} au ${formaterDate(e.session_fin)}`}
        actions={<>
          {e.reponses > 0 && <a className="ui-btn ui-btn--secondary" href={`/api/enquetes/${e.id}/export`} download>Exporter (CSV)</a>}
          <a className="ui-btn ui-btn--secondary" href={`/api/pdf/enquetes/${e.id}`} download>PDF</a>
          {e.active ? <Button onClick={() => patch({ ouverte: false }, "Enquête close.")}>Clore l'enquête</Button> : <Button onClick={() => patch({ ouverte: true, date_fin: null }, "Enquête rouverte.")}>Rouvrir</Button>}
        </>} />
      {message && <Alert ton={message.ton}>{message.texte}</Alert>}
      {d.alertes.map((a, i) => <Alert key={i} ton="warning">{a}</Alert>)}
      <FormSection titre="Diffusion" colonnes={1}>
        <Field label="Lien à transmettre (réponse anonyme, sans compte)" aide={e.active ? "Envoyez-le par e-mail ou SMS, ou affichez-le en salle sous forme de QR code." : "Enquête close : le lien affiche un message de clôture."}>
          <input readOnly value={lien} onFocus={(ev) => ev.target.select()} />
        </Field>
        <div className="sess-actions">
          <Button onClick={() => navigator.clipboard?.writeText(lien).then(() => setMessage({ ton: "success", texte: "Lien copié." }))}>Copier le lien</Button>
          <a className="ui-btn ui-btn--secondary" href={`/repondre/${e.jeton}`} target="_blank" rel="noopener noreferrer">Ouvrir le questionnaire</a>
        </div>
        <p className="sess-secondaire">QR code : ouvrez le questionnaire dans Chrome, puis menu ⋮ → « Partager » → « Créer un code QR » (aucun service extérieur ne reçoit le lien).</p>
        <p><strong>{e.reponses}</strong> réponse(s){e.taux_reponse !== null ? ` — taux de réponse ${e.taux_reponse} % (${e.inscrits} inscrit(s))` : ""}{e.date_fin ? ` — clôture le ${formaterDate(e.date_fin)}` : ""}.</p>
      </FormSection>

      <section aria-labelledby="titre-resultats">
        <h2 id="titre-resultats">Résultats</h2>
        {e.reponses === 0 && <p className="sess-secondaire">Aucune réponse pour l'instant.</p>}
        {e.reponses > 0 && d.synthese.map((s) => (
          <div key={s.question_id} className="enquete-question">
            <h3>{s.libelle} <span className="sess-secondaire">({s.reponses} réponse{s.reponses > 1 ? "s" : ""})</span></h3>
            {s.type === "echelle" && <><p>Moyenne <strong>{s.moyenne ?? "—"}</strong> / 5 — <strong>{s.taux_satisfaits ?? "—"} %</strong> de satisfaits (4 ou 5)</p><Barres repartition={s.repartition} libelles={["1", "2", "3", "4", "5"]} /></>}
            {s.type === "oui_non" && <Barres repartition={[s.repartition.oui, s.repartition.non]} libelles={["Oui", "Non"]} />}
            {["choix_unique", "choix_multiple"].includes(s.type) && <Barres repartition={Object.values(s.repartition)} libelles={Object.keys(s.repartition)} />}
            {s.type === "nombre" && <p>Moyenne : {s.moyenne ?? "—"}</p>}
            {["texte", "date"].includes(s.type) && (s.textes?.length ? <ul className="enquete-textes">{s.textes.map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="sess-secondaire">Aucune réponse écrite.</p>)}
          </div>
        ))}
      </section>

      <section aria-labelledby="titre-analyse">
        <h2 id="titre-analyse">Exploitation des résultats</h2>
        <p className="sess-secondaire">Indicateurs 30 à 32 : l'auditeur vérifie que les appréciations sont analysées et suivies d'effets.</p>
        <Field label="Analyse et décisions" facultatif aide={e.analysee_le ? `Analysée le ${new Date(e.analysee_le).toLocaleDateString("fr-FR")} par ${e.analysee_par_nom || "—"}.` : undefined}>
          <textarea rows={4} maxLength={8000} value={analyse} onChange={(ev) => setAnalyse(ev.target.value)} placeholder="Ce que les résultats montrent, les points à améliorer, les décisions prises." />
        </Field>
        <div className="sess-actions">
          <Button variante="primary" onClick={() => patch({ analyse }, "Analyse enregistrée.")}>Enregistrer l'analyse</Button>
          <Button onClick={() => agir(() => api(`/api/enquetes/${e.id}/tache`, { method: "POST", body: "{}" }), "Tâche d'analyse créée dans Tâches qualité.")}>Créer une tâche d'analyse</Button>
          <Button to="/actions-qualite">Créer une action qualité</Button>
        </div>
      </section>

      <section aria-labelledby="titre-questions">
        <h2 id="titre-questions">Questions</h2>
        <ol>{d.questions.map((q) => <li key={q.id}>{q.libelle} <span className="sess-secondaire">— {d.types_question[q.type]}{q.obligatoire ? ", obligatoire" : ""}{q.globale ? ", satisfaction globale" : ""}{q.options?.length ? ` : ${q.options.join(" / ")}` : ""}</span></li>)}</ol>
        {e.reponses === 0 && <div className="sess-actions"><Button onClick={() => setEdition(true)}>Modifier les questions</Button><Button variante="danger" onClick={() => setSuppression(true)}>Supprimer l'enquête</Button></div>}
      </section>
      {edition && <EditionQuestions enquete={e} questions={d.questions} types={d.types_question} onFermer={() => setEdition(false)} onEnregistre={async () => { setEdition(false); setMessage({ ton: "success", texte: "Questions enregistrées." }); await charger(); }} />}
      <ConfirmDialog ouvert={suppression} titre="Supprimer cette enquête ?" libelleConfirmer="Supprimer" onAnnuler={() => setSuppression(false)}
        onConfirmer={async () => { try { await api(`/api/enquetes/${e.id}`, { method: "DELETE" }); navigate("/enquetes"); } catch (err) { setSuppression(false); setMessage({ ton: "error", texte: err.message }); } }}>
        <p>Le lien transmis cessera de fonctionner.</p>
      </ConfirmDialog>
    </>
  );
}

function EditionQuestions({ enquete, questions, types, onFermer, onEnregistre }) {
  const [liste, setListe] = useState(questions.map((q) => ({ libelle: q.libelle, type: q.type, options: (q.options || []).join("\n"), obligatoire: q.obligatoire, globale: q.globale })));
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const maj = (i, champ, valeur) => setListe(liste.map((q, j) => (j === i ? { ...q, [champ]: valeur } : champ === "globale" && valeur ? { ...q, globale: false } : q)));
  const deplacer = (i, d) => { const n = [...liste]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setListe(n); };
  async function enregistrer(ev) {
    ev.preventDefault(); setEnCours(true); setErreur(null);
    try {
      await api(`/api/enquetes/${enquete.id}/questions`, { method: "PUT", body: JSON.stringify({ questions: liste.map((q) => ({ ...q, options: q.options.split("\n").map((o) => o.trim()).filter(Boolean) })) }) });
      await onEnregistre();
    } catch (err) { setErreur(err.message); setEnCours(false); }
  }
  return (
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} taille="large" titre="Questions de l'enquête"
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button><Button variante="primary" type="submit" form="form-questions" disabled={enCours}>Enregistrer</Button></>}>
      <form id="form-questions" onSubmit={enregistrer} noValidate className="ui-form">
        {erreur && <Alert ton="error">{erreur}</Alert>}
        {liste.map((q, i) => (
          <fieldset key={i} className="ui-form-section">
            <legend>Question {i + 1}</legend>
            <Field label="Libellé"><input value={q.libelle} maxLength={500} onChange={(e) => maj(i, "libelle", e.target.value)} /></Field>
            <Field label="Type"><select value={q.type} onChange={(e) => maj(i, "type", e.target.value)}>{Object.entries(types).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            {["choix_unique", "choix_multiple"].includes(q.type) && <Field label="Choix (un par ligne)"><textarea rows={3} value={q.options} onChange={(e) => maj(i, "options", e.target.value)} /></Field>}
            <Checkbox label="Réponse obligatoire" checked={q.obligatoire} onChange={(e) => maj(i, "obligatoire", e.target.checked)} />
            {q.type === "echelle" && <Checkbox label="Question de satisfaction globale (alimente les indicateurs)" checked={q.globale} onChange={(e) => maj(i, "globale", e.target.checked)} />}
            <div className="sess-actions">
              <Button compact disabled={i === 0} onClick={() => deplacer(i, -1)} aria-label={`Monter la question ${i + 1}`}>↑</Button>
              <Button compact disabled={i === liste.length - 1} onClick={() => deplacer(i, 1)} aria-label={`Descendre la question ${i + 1}`}>↓</Button>
              <Button compact variante="danger" onClick={() => setListe(liste.filter((_, j) => j !== i))}>Retirer</Button>
            </div>
          </fieldset>
        ))}
        <Button onClick={() => setListe([...liste, { libelle: "", type: "echelle", options: "", obligatoire: false, globale: false }])}>+ Ajouter une question</Button>
      </form>
    </Drawer>
  );
}

// ── Formulaire public (sans compte) ──────────────────────────
export function RepondreEnquete() {
  const { jeton } = useParams();
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [reponses, setReponses] = useState({});
  const [envoi, setEnvoi] = useState(null);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => { document.title = "Questionnaire"; api(`/api/public/enquetes/${jeton}`).then(setD).catch((e) => setErreur(e.message)); }, [jeton]);
  const maj = (id, v) => setReponses({ ...reponses, [id]: v });
  async function envoyer(e) {
    e.preventDefault(); setEnCours(true); setErreur(null);
    try { const r = await api(`/api/public/enquetes/${jeton}/reponses`, { method: "POST", body: JSON.stringify({ reponses }) }); setEnvoi(r.message); }
    catch (err) { setErreur(err.message); setEnCours(false); }
  }
  return (
    <main className="repondre">
      {!d && !erreur && <LoadingState texte="Chargement du questionnaire…" />}
      {erreur && !d && <Alert ton="info" titre="Questionnaire indisponible">{erreur}</Alert>}
      {envoi && <Alert ton="success" titre="Réponse enregistrée">{envoi}</Alert>}
      {d && !envoi && (
        <form onSubmit={envoyer} noValidate className="ui-form">
          <p className="repondre__organisme">{d.enquete.organisme}</p>
          <h1>{d.enquete.titre}</h1>
          {d.enquete.formation && <p className="repondre__formation">{d.enquete.formation}</p>}
          {d.enquete.introduction && <p>{d.enquete.introduction}</p>}
          {d.questions.map((q) => (
            <fieldset key={q.id} className="repondre__question">
              <legend>{q.libelle}{q.obligatoire ? " *" : ""}</legend>
              {q.type === "echelle" && <div className="repondre__echelle">{[1, 2, 3, 4, 5].map((n) => (
                <label key={n}><input type="radio" name={`q${q.id}`} checked={reponses[q.id] === n} onChange={() => maj(q.id, n)} /> {n}</label>))}<span className="sess-secondaire">1 = pas du tout satisfait · 5 = tout à fait satisfait</span></div>}
              {q.type === "oui_non" && ["oui", "non"].map((v) => <label key={v} className="repondre__choix"><input type="radio" name={`q${q.id}`} checked={reponses[q.id] === v} onChange={() => maj(q.id, v)} /> {v === "oui" ? "Oui" : "Non"}</label>)}
              {q.type === "choix_unique" && q.options.map((o) => <label key={o} className="repondre__choix"><input type="radio" name={`q${q.id}`} checked={reponses[q.id] === o} onChange={() => maj(q.id, o)} /> {o}</label>)}
              {q.type === "choix_multiple" && q.options.map((o) => <label key={o} className="repondre__choix"><input type="checkbox" checked={(reponses[q.id] || []).includes(o)} onChange={(e) => maj(q.id, e.target.checked ? [...(reponses[q.id] || []), o] : (reponses[q.id] || []).filter((x) => x !== o))} /> {o}</label>)}
              {q.type === "texte" && <textarea rows={3} maxLength={2000} aria-label={q.libelle} value={reponses[q.id] || ""} onChange={(e) => maj(q.id, e.target.value)} />}
              {q.type === "nombre" && <input type="number" aria-label={q.libelle} value={reponses[q.id] ?? ""} onChange={(e) => maj(q.id, e.target.value === "" ? null : Number(e.target.value))} />}
              {q.type === "date" && <input type="date" aria-label={q.libelle} value={reponses[q.id] || ""} onChange={(e) => maj(q.id, e.target.value)} />}
            </fieldset>
          ))}
          {erreur && <Alert ton="error">{erreur}</Alert>}
          <Button variante="primary" type="submit" disabled={enCours}>{enCours ? "Envoi…" : "Envoyer mes réponses"}</Button>
          <p className="sess-secondaire">Vos réponses sont anonymes et servent uniquement à améliorer la formation.</p>
        </form>
      )}
    </main>
  );
}
