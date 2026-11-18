import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { formaterDate } from "./RegistrePage.jsx";

const TON_APPRECIATION = { non_evalue: "neutral", conforme: "success", a_ameliorer: "warning", non_conforme: "error", non_applicable: "neutral" };

// ── Liste des campagnes ──────────────────────────────────────
export function CampagnesAuditPage() {
  useTitrePage("Préparation d'audit");
  const navigate = useNavigate();
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [creation, setCreation] = useState(false);
  useEffect(() => { api("/api/campagnes-audit").then(setDonnees).catch((e) => setErreur(e.message)); }, []);
  const nouvelle = <Button variante="primary" onClick={() => setCreation(true)}>+ Nouvelle préparation</Button>;
  return (
    <>
      <PageHeader fil={[{ libelle: "Qualiopi" }, { libelle: "Préparation d'audit" }]} titre="Préparation d'audit"
        description="Passez chaque indicateur en revue comme le ferait l'auditeur, tirez un échantillon de sessions, produisez le dossier et partagez-le en lecture seule." actions={nouvelle} />
      {erreur && <Alert ton="error" titre="Chargement impossible.">{erreur}</Alert>}
      {!donnees && !erreur && <LoadingState texte="Chargement…" />}
      {donnees?.campagnes.length === 0 && <EmptyState titre="Aucune préparation" action={nouvelle}>Commencez par un audit blanc : Vigie liste les indicateurs et signale ce qui manque.</EmptyState>}
      {donnees?.campagnes.length > 0 && (
        <table className="sess-table">
          <caption className="visually-hidden">Préparations d'audit</caption>
          <thead><tr><th scope="col">Préparation</th><th scope="col">Type</th><th scope="col">Date</th><th scope="col">Avancement</th><th scope="col">Statut</th></tr></thead>
          <tbody>{donnees.campagnes.map((c) => (
            <tr key={c.id}>
              <td data-label="Préparation" className="sess-table__principal"><Link to={`/preparation-audit/${c.id}`}>{c.titre}</Link>{c.partage_auditeur && <> <Badge ton="info">Partagée</Badge></>}</td>
              <td data-label="Type">{donnees.types[c.type]}</td>
              <td data-label="Date">{formaterDate(c.date_audit) || "—"}</td>
              <td data-label="Avancement">{c.indicateurs - c.non_evalues} / {c.indicateurs} évalués · {c.conformes} conformes{c.a_traiter ? ` · ${c.a_traiter} à traiter` : ""}</td>
              <td data-label="Statut"><Badge ton={c.statut === "prete" ? "success" : c.statut === "archivee" ? "neutral" : "info"}>{donnees.statuts[c.statut]}</Badge></td>
            </tr>))}
          </tbody>
        </table>
      )}
      {creation && <CreationCampagne types={donnees?.types || {}} onFermer={() => setCreation(false)} onCree={(id) => navigate(`/preparation-audit/${id}`)} />}
    </>
  );
}

function CreationCampagne({ types, onFermer, onCree }) {
  const [v, setV] = useState({ titre: "", type: "audit_blanc", date_audit: "", organisme_certificateur: "", perimetre: "" });
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  async function creer(e) {
    e.preventDefault();
    if (!v.titre.trim()) return setErreur("Indiquez un intitulé.");
    setEnCours(true); setErreur(null);
    try {
      const r = await api("/api/campagnes-audit", { method: "POST", body: JSON.stringify({ ...v, date_audit: v.date_audit || null }) });
      onCree(r.campagne.id);
    } catch (err) { setErreur(err.message); setEnCours(false); }
  }
  const f = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} titre="Nouvelle préparation d'audit" description="Le référentiel actif est figé pour cette préparation."
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button><Button variante="primary" type="submit" form="form-campagne" disabled={enCours}>{enCours ? "Création…" : "Créer"}</Button></>}>
      <form id="form-campagne" onSubmit={creer} noValidate className="ui-form">
        {erreur && <Alert ton="error">{erreur}</Alert>}
        <FormSection titre="Audit" colonnes={2}>
          <Field label="Intitulé"><input value={v.titre} onChange={f("titre")} maxLength={200} placeholder="Audit de surveillance 2027" /></Field>
          <Field label="Type"><select value={v.type} onChange={f("type")}>{Object.entries(types).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Date prévue" facultatif><input type="date" value={v.date_audit} onChange={f("date_audit")} /></Field>
          <Field label="Organisme certificateur" facultatif><input value={v.organisme_certificateur} onChange={f("organisme_certificateur")} maxLength={200} /></Field>
          <Field label="Périmètre (catégories d'action, formations…)" facultatif className="ui-field--large"><textarea rows={3} value={v.perimetre} onChange={f("perimetre")} maxLength={2000} /></Field>
        </FormSection>
      </form>
    </Drawer>
  );
}

// ── Détail d'une campagne ────────────────────────────────────
export function CampagneAuditPage() {
  const { campagneId } = useParams();
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [message, setMessage] = useState(null);
  const [filtre, setFiltre] = useState("tous");
  const [indicateur, setIndicateur] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [ajout, setAjout] = useState("");
  const [suppression, setSuppression] = useState(false);
  useTitrePage(d?.campagne.titre || "Préparation d'audit");
  const charger = useCallback(() => api(`/api/campagnes-audit/${campagneId}`).then((r) => { setD(r); setErreur(null); }).catch((e) => setErreur(e.message)), [campagneId]);
  useEffect(() => { charger(); api("/api/sessions").then((r) => setSessions(r.sessions || [])).catch(() => {}); }, [charger]);

  const agir = async (fn, succes) => { setMessage(null); try { const r = await fn(); setMessage({ ton: "success", texte: typeof succes === "function" ? succes(r) : succes }); await charger(); } catch (e) { setMessage({ ton: "error", texte: e.message }); } };
  const patch = (corps, texte) => agir(() => api(`/api/campagnes-audit/${campagneId}`, { method: "PATCH", body: JSON.stringify(corps) }), texte);

  if (erreur) return <Alert ton="error" titre="Préparation introuvable.">{erreur}</Alert>;
  if (!d) return <LoadingState texte="Chargement…" />;
  const c = d.campagne;
  const archivee = c.statut === "archivee";
  const lignes = d.indicateurs.filter((r) => filtre === "tous" || (filtre === "signaux" ? r.signaux.length : r.appreciation === filtre));
  const compte = (a) => d.indicateurs.filter((r) => r.appreciation === a).length;
  return (
    <>
      <PageHeader fil={[{ libelle: "Qualiopi" }, { libelle: "Préparation d'audit", to: "/preparation-audit" }, { libelle: c.titre }]} titre={c.titre}
        description={`${d.types[c.type]}${c.date_audit ? ` prévu le ${formaterDate(c.date_audit)}` : ""} — référentiel ${c.referentiel_code || ""} — ${d.statuts[c.statut]}`}
        actions={<>
          <a className="ui-btn ui-btn--secondary" href={`/api/campagnes-audit/${c.id}/export`} download>Télécharger le dossier (ZIP)</a>
          <a className="ui-btn ui-btn--secondary" href={`/api/pdf/campagnes-audit/${c.id}`} download>PDF</a>
          {!archivee && <Button onClick={() => agir(() => api(`/api/campagnes-audit/${c.id}/taches`, { method: "POST", body: "{}" }), (r) => (r.crees ? `${r.crees} tâche(s) créée(s) dans le plan d'action.` : "Aucune nouvelle tâche : les indicateurs à traiter ont déjà la leur."))}>Créer les tâches du plan d'action</Button>}
        </>} />
      {message && <Alert ton={message.ton}>{message.texte}</Alert>}
      <div className="audit-resume">
        <span><strong>{compte("conforme")}</strong> conformes</span>
        <span><strong>{compte("a_ameliorer")}</strong> à améliorer</span>
        <span><strong>{compte("non_conforme")}</strong> non conformes</span>
        <span><strong>{compte("non_evalue")}</strong> non évalués</span>
        <span><strong>{d.indicateurs.filter((r) => r.signaux.length).length}</strong> avec signal</span>
      </div>
      <FormSection titre="Pilotage de la préparation" colonnes={2}>
        <Field label="Statut">
          <select value={c.statut} onChange={(e) => patch({ statut: e.target.value }, "Statut mis à jour.")}>{Object.entries(d.statuts).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <div className="ui-field">
          <Checkbox label="Partager en lecture seule avec l'auditeur" checked={c.partage_auditeur} disabled={archivee}
            aide="L'auditeur (compte « auditeur » créé dans Paramètres → Comptes et accès) voit le référentiel, les preuves et l'échantillon — jamais vos appréciations internes ni les données des stagiaires."
            onChange={(e) => patch({ partage_auditeur: e.target.checked }, e.target.checked ? "Dossier partagé avec l'auditeur." : "Partage retiré.")} />
        </div>
        <SyntheseCampagne campagne={c} disabled={archivee} onEnregistrer={(t) => patch({ synthese: t }, "Synthèse enregistrée.")} />
      </FormSection>

      <section aria-labelledby="titre-echantillon">
        <h2 id="titre-echantillon">Échantillon de sessions</h2>
        <p className="sess-secondaire">Sélection traçable des sessions présentées à l'auditeur (choix manuel ou tirage aléatoire daté).</p>
        {!archivee && (
          <div className="pilotage-filtres">
            <Field label="Ajouter une session">
              <select value={ajout} onChange={(e) => setAjout(e.target.value)}>
                <option value="">Choisir…</option>
                {sessions.map((s) => <option key={s.id} value={s.id}>{s.reference || s.formation} — {s.formation} — {formaterDate(s.date_debut)}</option>)}
              </select>
            </Field>
            <Button disabled={!ajout} onClick={() => agir(() => api(`/api/campagnes-audit/${c.id}/echantillon`, { method: "POST", body: JSON.stringify({ session_id: Number(ajout) }) }), "Session ajoutée.").then(() => setAjout(""))}>Ajouter</Button>
            <Button onClick={() => agir(() => api(`/api/campagnes-audit/${c.id}/echantillon`, { method: "POST", body: JSON.stringify({ aleatoire: true, nombre: 3 }) }), (r) => `${r.ajoutees} session(s) tirée(s) au sort.`)}>Tirer 3 sessions au sort</Button>
          </div>
        )}
        {d.echantillon.length === 0 ? <p className="sess-secondaire">Aucune session sélectionnée.</p> : (
          <ul className="pilotage-liste">{d.echantillon.map((s) => (
            <li key={s.session_id}><Link to={`/sessions/${s.session_id}`}>{s.reference || s.intitule}</Link> — {formaterDate(s.date_debut)} → {formaterDate(s.date_fin)} · {s.inscrits} inscrit(s) <span className="sess-secondaire">· {s.motif}</span>
              {!archivee && <> <Button compact onClick={() => agir(() => api(`/api/campagnes-audit/${c.id}/echantillon/${s.session_id}`, { method: "DELETE" }), "Session retirée de l'échantillon.")}>Retirer</Button></>}</li>))}
          </ul>
        )}
      </section>

      <section aria-labelledby="titre-indicateurs">
        <h2 id="titre-indicateurs">Revue des indicateurs</h2>
        <div className="sess-vues" role="group" aria-label="Filtrer les indicateurs">
          {[["tous", "Tous"], ["signaux", "Avec signal"], ["non_evalue", "Non évalués"], ["a_ameliorer", "À améliorer"], ["non_conforme", "Non conformes"], ["conforme", "Conformes"]].map(([k, l]) => (
            <button key={k} type="button" className={"sess-vue" + (filtre === k ? " sess-vue--active" : "")} aria-pressed={filtre === k} onClick={() => setFiltre(k)}>{l}</button>
          ))}
        </div>
        <table className="sess-table">
          <caption className="visually-hidden">Indicateurs ({lignes.length})</caption>
          <thead><tr><th scope="col">Indicateur</th><th scope="col">Preuves</th><th scope="col">Signaux</th><th scope="col">Appréciation</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>{lignes.map((r) => (
            <tr key={r.indicateur_id}>
              <td data-label="Indicateur" className="sess-table__principal"><strong>{r.numero}</strong> — {r.libelle}</td>
              <td data-label="Preuves">{r.nb_preuves} ({r.nb_preuves_valides} validée{r.nb_preuves_valides > 1 ? "s" : ""})</td>
              <td data-label="Signaux">{r.signaux.length ? <span className="pilotage-retard">{r.signaux.join(" · ")}</span> : "—"}</td>
              <td data-label="Appréciation"><Badge ton={TON_APPRECIATION[r.appreciation]}>{d.appreciations[r.appreciation]}</Badge>{r.observation && <span className="sess-secondaire"> {r.observation.slice(0, 80)}{r.observation.length > 80 ? "…" : ""}</span>}</td>
              <td className="sess-table__actions">{!archivee && <Button compact onClick={() => setIndicateur(r)} aria-label={`Évaluer l'indicateur ${r.numero}`}>Évaluer</Button>}</td>
            </tr>))}
          </tbody>
        </table>
      </section>
      {c.statut === "preparation" && <p><Button variante="danger" onClick={() => setSuppression(true)}>Supprimer cette préparation</Button></p>}
      {indicateur && <EvaluationIndicateur campagneId={c.id} ligne={indicateur} appreciations={d.appreciations} onFermer={() => setIndicateur(null)} onEnregistre={async () => { setIndicateur(null); await charger(); }} />}
      <ConfirmDialog ouvert={suppression} titre="Supprimer cette préparation ?" libelleConfirmer="Supprimer" onAnnuler={() => setSuppression(false)}
        onConfirmer={async () => { try { await api(`/api/campagnes-audit/${c.id}`, { method: "DELETE" }); navigate("/preparation-audit"); } catch (e) { setSuppression(false); setMessage({ ton: "error", texte: e.message }); } }}>
        <p>Les appréciations et l'échantillon seront perdus. Une préparation déjà avancée s'archive plutôt.</p>
      </ConfirmDialog>
    </>
  );
}

function SyntheseCampagne({ campagne, disabled, onEnregistrer }) {
  const [t, setT] = useState(campagne.synthese || "");
  return (
    <Field label="Synthèse et points d'attention" facultatif className="ui-field--large">
      <textarea rows={3} maxLength={8000} value={t} disabled={disabled} onChange={(e) => setT(e.target.value)} onBlur={() => t !== (campagne.synthese || "") && onEnregistrer(t)} />
    </Field>
  );
}

function EvaluationIndicateur({ campagneId, ligne, appreciations, onFermer, onEnregistre }) {
  const [a, setA] = useState(ligne.appreciation === "non_evalue" ? "conforme" : ligne.appreciation);
  const [o, setO] = useState(ligne.observation || "");
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  async function enregistrer(e) {
    e.preventDefault(); setEnCours(true); setErreur(null);
    try { await api(`/api/campagnes-audit/${campagneId}/indicateurs/${ligne.indicateur_id}`, { method: "PUT", body: JSON.stringify({ appreciation: a, observation: o }) }); await onEnregistre(); }
    catch (err) { setErreur(err.message); setEnCours(false); }
  }
  return (
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} titre={`Indicateur ${ligne.numero}`} description={ligne.libelle}
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button><Button variante="primary" type="submit" form="form-evaluation" disabled={enCours}>Enregistrer</Button></>}>
      <form id="form-evaluation" onSubmit={enregistrer} noValidate className="ui-form">
        {erreur && <Alert ton="error">{erreur}</Alert>}
        <Alert ton="info" titre="Questions de l'auditeur">La pratique est-elle réelle et régulière ? La preuve est-elle à jour et couvre-t-elle le bon périmètre ? Les personnes connaissent-elles la procédure ? Les retours des bénéficiaires sont-ils exploités ?</Alert>
        {ligne.signaux.length > 0 && <Alert ton="warning" titre="Signaux relevés par Vigie">{ligne.signaux.join(" · ")}</Alert>}
        <p><Link to={`/preuves?indicateur=${ligne.numero}`}>Voir les preuves de l'indicateur {ligne.numero}</Link></p>
        <Field label="Appréciation"><select value={a} onChange={(e) => setA(e.target.value)}>{Object.entries(appreciations).filter(([k]) => k !== "non_evalue").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Observation" facultatif><textarea rows={5} maxLength={4000} value={o} onChange={(e) => setO(e.target.value)} placeholder="Ce qui est démontré, ce qui manque, ce qu'il faut préparer." /></Field>
      </form>
    </Drawer>
  );
}

// ── Portail auditeur (lecture seule) ─────────────────────────
export function PortailAuditPage() {
  const { campagneId } = useParams();
  const [liste, setListe] = useState(null);
  const [dossier, setDossier] = useState(null);
  const [erreur, setErreur] = useState(null);
  useTitrePage("Dossier d'audit");
  useEffect(() => {
    setErreur(null);
    if (campagneId) api(`/api/portail-audit/campagnes/${campagneId}`).then(setDossier).catch((e) => setErreur(e.message));
    else api("/api/portail-audit/campagnes").then(setListe).catch((e) => setErreur(e.message));
  }, [campagneId]);
  if (erreur) return <Alert ton="error" titre="Dossier indisponible.">{erreur}</Alert>;
  if (!campagneId) {
    if (!liste) return <LoadingState texte="Chargement…" />;
    return (
      <>
        <PageHeader titre="Dossiers d'audit" description="Dossiers mis à votre disposition par l'organisme, en lecture seule." />
        {liste.campagnes.length === 0 ? <EmptyState titre="Aucun dossier partagé">L'organisme ne vous a pas encore partagé de dossier.</EmptyState> : (
          <ul className="pilotage-liste">{liste.campagnes.map((c) => <li key={c.id}><Link to={`/portail-audit/${c.id}`}>{c.titre}</Link> — {liste.types[c.type]}{c.date_audit ? `, ${formaterDate(c.date_audit)}` : ""}</li>)}</ul>
        )}
      </>
    );
  }
  if (!dossier) return <LoadingState texte="Chargement du dossier…" />;
  const c = dossier.campagne;
  return (
    <>
      <PageHeader fil={[{ libelle: "Dossiers d'audit", to: "/portail-audit" }, { libelle: c.titre }]} titre={c.titre}
        description={`${dossier.organisme.nom || ""}${dossier.organisme.nda ? ` — NDA ${dossier.organisme.nda}` : ""} — ${dossier.types[c.type]}${c.date_audit ? ` le ${formaterDate(c.date_audit)}` : ""} — référentiel ${c.referentiel_code || ""}`} />
      {c.perimetre && <p><strong>Périmètre :</strong> {c.perimetre}</p>}
      <h2>Échantillon de sessions</h2>
      {dossier.echantillon.length ? <ul className="pilotage-liste">{dossier.echantillon.map((s, i) => <li key={i}>{s.reference || s.intitule} — {s.intitule} — {formaterDate(s.date_debut)} → {formaterDate(s.date_fin)} · {s.inscrits} inscrit(s)</li>)}</ul> : <p className="sess-secondaire">Aucune session sélectionnée.</p>}
      <h2>Indicateurs et preuves</h2>
      {dossier.indicateurs.filter((r) => !r.non_applicable).map((r) => (
        <section key={r.numero} className="portail-indicateur" aria-label={`Indicateur ${r.numero}`}>
          <h3>Indicateur {r.numero}{r.critere ? ` (critère ${r.critere})` : ""}</h3>
          <p>{r.libelle}</p>
          {r.preuves.length ? <ul>{r.preuves.map((p, i) => <li key={i}>{p.lien ? <a href={p.lien} target="_blank" rel="noopener noreferrer">{p.titre}</a> : p.titre}{p.date_derniere_revision ? ` — révisée le ${formaterDate(p.date_derniere_revision)}` : ""}</li>)}</ul> : <p className="sess-secondaire">Aucune preuve rattachée.</p>}
        </section>
      ))}
      <h2>Indicateurs non applicables</h2>
      <p>{dossier.indicateurs.filter((r) => r.non_applicable).map((r) => r.numero).join(", ") || "Aucun."}</p>
      <h2>Actions d'amélioration</h2>
      <ul className="pilotage-liste">{dossier.actions.map((a, i) => <li key={i}>{a.reference} — {a.titre} ({a.statut})</li>)}</ul>
    </>
  );
}
