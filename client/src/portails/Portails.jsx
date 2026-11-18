import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { formaterDate } from "../pilotage/RegistrePage.jsx";

// ── Administration des accès ─────────────────────────────────
export function AccesPortailsPage() {
  useTitrePage("Accès aux portails");
  const [acces, setAcces] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [creation, setCreation] = useState(false);
  const [lien, setLien] = useState(null);
  const [aRevoquer, setARevoquer] = useState(null);
  const charger = useCallback(() => api("/api/acces-portail").then((r) => { setAcces(r.acces); setErreur(null); }).catch((e) => setErreur(e.message)), []);
  useEffect(() => { charger(); }, [charger]);
  return (
    <>
      <PageHeader fil={[{ libelle: "Formation" }, { libelle: "Accès aux portails" }]} titre="Accès aux portails"
        description="Un lien personnel donne à un stagiaire ou à un formateur l'accès à son espace, sans compte Google. Le lien n'est affiché qu'une fois ; il expire et se désactive à tout moment."
        actions={<Button variante="primary" onClick={() => { setLien(null); setCreation(true); }}>+ Créer un accès</Button>} />
      {lien && (
        <Alert ton="success" titre="Accès créé : copiez le lien maintenant (il ne sera plus affiché)">
          <input className="lien-portail" readOnly value={lien.url} onFocus={(e) => e.target.select()} aria-label="Lien d'accès" />
          <div className="sess-actions"><Button compact onClick={() => navigator.clipboard?.writeText(lien.url)}>Copier le lien</Button></div>
          <p>Valable jusqu'au {formaterDate(lien.expire_le)}. Transmettez-le à la personne par un canal sûr (SMS, e-mail personnel).</p>
        </Alert>
      )}
      {erreur && <Alert ton="error">{erreur}</Alert>}
      {!acces && !erreur && <LoadingState texte="Chargement…" />}
      {acces?.length === 0 && <EmptyState titre="Aucun accès créé">Créez un accès pour un stagiaire ou un formateur.</EmptyState>}
      {acces?.length > 0 && (
        <table className="sess-table">
          <caption className="visually-hidden">Accès</caption>
          <thead><tr><th scope="col">Personne</th><th scope="col">Espace</th><th scope="col">Jusqu'au</th><th scope="col">Dernière utilisation</th><th scope="col">État</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>{acces.map((a) => (
            <tr key={a.id}>
              <td data-label="Personne" className="sess-table__principal">{a.personne}</td>
              <td data-label="Espace">{a.type === "stagiaire" ? "Stagiaire" : "Formateur"}</td>
              <td data-label="Jusqu'au">{formaterDate(a.expire_le)}</td>
              <td data-label="Dernière utilisation">{a.derniere_utilisation ? new Date(a.derniere_utilisation).toLocaleString("fr-FR") : "Jamais"}</td>
              <td data-label="État">{a.actif ? <Badge ton="success">Actif</Badge> : <Badge>{a.revoque_le ? "Désactivé" : "Expiré"}</Badge>}</td>
              <td className="sess-table__actions">{a.actif && <Button compact variante="danger" onClick={() => setARevoquer(a)}>Désactiver</Button>}</td>
            </tr>))}
          </tbody>
        </table>
      )}
      {creation && <CreationAcces onFermer={() => setCreation(false)} onCree={(r) => { setCreation(false); setLien({ url: window.location.origin + r.chemin, expire_le: r.acces.expire_le }); charger(); }} />}
      <ConfirmDialog ouvert={!!aRevoquer} titre="Désactiver cet accès ?" libelleConfirmer="Désactiver" onAnnuler={() => setARevoquer(null)}
        onConfirmer={async () => { try { await api(`/api/acces-portail/${aRevoquer.id}`, { method: "DELETE" }); } catch (e) { setErreur(e.message); } setARevoquer(null); charger(); }}>
        <p>Le lien de {aRevoquer?.personne} cessera immédiatement de fonctionner.</p>
      </ConfirmDialog>
    </>
  );
}

function CreationAcces({ onFermer, onCree }) {
  const [type, setType] = useState("stagiaire");
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState("");
  const [stagiaires, setStagiaires] = useState([]);
  const [intervenants, setIntervenants] = useState([]);
  const [cible, setCible] = useState("");
  const [duree, setDuree] = useState("90");
  const [erreur, setErreur] = useState(null);
  useEffect(() => {
    api("/api/sessions").then((r) => setSessions((r.sessions || []).filter((s) => !s.archivee_le))).catch(() => {});
    api("/api/intervenants").then((r) => setIntervenants((r.intervenants || []).filter((i) => i.actif))).catch(() => {});
  }, []);
  useEffect(() => { setCible(""); if (session) api(`/api/sessions/${session}`).then((r) => setStagiaires(r.stagiaires || [])).catch(() => setStagiaires([])); }, [session]);
  async function creer(e) {
    e.preventDefault(); setErreur(null);
    if (!cible) return setErreur("Choisissez la personne.");
    try {
      const corps = { type, duree_jours: Number(duree), ...(type === "stagiaire" ? { stagiaire_id: Number(cible) } : { intervenant_id: Number(cible) }) };
      onCree(await api("/api/acces-portail", { method: "POST", body: JSON.stringify(corps) }));
    } catch (err) { setErreur(err.message); }
  }
  return (
    <Drawer ouvert onFermer={onFermer} titre="Créer un accès" pied={<><Button onClick={onFermer}>Annuler</Button><Button variante="primary" type="submit" form="form-acces">Créer le lien</Button></>}>
      <form id="form-acces" onSubmit={creer} noValidate className="ui-form">
        {erreur && <Alert ton="error">{erreur}</Alert>}
        <FormSection titre="Accès" colonnes={1}>
          <Field label="Espace"><select value={type} onChange={(e) => { setType(e.target.value); setCible(""); }}><option value="stagiaire">Stagiaire</option><option value="formateur">Formateur</option></select></Field>
          {type === "stagiaire" ? (
            <>
              <Field label="Session"><select value={session} onChange={(e) => setSession(e.target.value)}><option value="">Choisir…</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.reference || s.formation} — {s.formation} — {formaterDate(s.date_debut)}</option>)}</select></Field>
              <Field label="Stagiaire"><select value={cible} onChange={(e) => setCible(e.target.value)} disabled={!session}><option value="">Choisir…</option>{stagiaires.map((s) => <option key={s.id} value={s.id}>{s.prenom} {s.nom}</option>)}</select></Field>
            </>
          ) : (
            <Field label="Formateur" aide="Il verra uniquement les sessions et groupes auxquels il est rattaché."><select value={cible} onChange={(e) => setCible(e.target.value)}><option value="">Choisir…</option>{intervenants.map((i) => <option key={i.id} value={i.id}>{i.prenom} {i.nom}</option>)}</select></Field>
          )}
          <Field label="Durée de validité (jours)"><input type="number" min={1} max={365} value={duree} onChange={(e) => setDuree(e.target.value)} /></Field>
        </FormSection>
      </form>
    </Drawer>
  );
}

// ── Espace personnel (sans compte) ───────────────────────────
// /portail/:jeton : ouvre la session portail puis redirige vers /espace (le jeton quitte la barre d'adresse).
export function PortailConnexion() {
  const { jeton } = useParams();
  const navigate = useNavigate();
  const [erreur, setErreur] = useState(null);
  useEffect(() => {
    document.title = "Mon espace";
    api("/api/portail/connexion", { method: "POST", body: JSON.stringify({ jeton }) }).then(() => navigate("/espace", { replace: true })).catch((e) => setErreur(e.message));
  }, [jeton, navigate]);
  return <main className="repondre">{erreur ? <Alert ton="error" titre="Accès impossible">{erreur}</Alert> : <LoadingState texte="Ouverture de votre espace…" />}</main>;
}

export function EspacePage() {
  const [moi, setMoi] = useState(null);
  const [erreur, setErreur] = useState(null);
  useEffect(() => { document.title = "Mon espace"; api("/api/portail/moi").then(setMoi).catch((e) => setErreur(e.message)); }, []);
  async function quitter() { await api("/api/portail/deconnexion", { method: "POST", body: "{}" }).catch(() => {}); setMoi(null); setErreur("Vous êtes déconnecté. Rouvrez le lien reçu pour revenir."); }
  return (
    <main className="repondre espace">
      {!moi && !erreur && <LoadingState texte="Chargement…" />}
      {erreur && <Alert ton="info" titre="Espace indisponible">{erreur}</Alert>}
      {moi && (
        <>
          <div className="espace__entete"><span className="repondre__organisme">{moi.organisme.nom}</span><Button compact onClick={quitter}>Se déconnecter</Button></div>
          <h1>Bonjour {moi.personne?.prenom}</h1>
          {moi.type === "stagiaire" ? <EspaceStagiaire /> : <EspaceFormateur />}
          {(moi.organisme.telephone || moi.organisme.email) && <p className="sess-secondaire">Une question ? {[moi.organisme.telephone, moi.organisme.email].filter(Boolean).join(" — ")}</p>}
        </>
      )}
    </main>
  );
}

const RESULTATS = { valide: "Validé", non_valide: "Non validé" };
const STATUTS_COMP = { acquis: "Acquis", en_cours: "En cours d'acquisition", non_acquis: "Pas acquis" };

function EspaceStagiaire() {
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState(null);
  useEffect(() => { api("/api/portail/stagiaire").then(setD).catch((e) => setErreur(e.message)); }, []);
  if (erreur) return <Alert ton="error">{erreur}</Alert>;
  if (!d) return <LoadingState texte="Chargement…" />;
  if (!d.inscriptions.length) return <p>Aucune formation en cours.</p>;
  return d.inscriptions.map((i) => (
    <section key={i.inscription_id} className="repondre__question espace__formation" aria-label={i.formation}>
      <h2>{i.formation}</h2>
      <p>Du {formaterDate(i.date_debut)} au {formaterDate(i.date_fin)}{i.horaire ? ` — ${i.horaire}` : ""}{i.lieu ? ` — ${i.lieu}` : ""}{i.groupe ? ` — groupe ${i.groupe}` : ""}</p>
      {i.assiduite !== null && <p>Assiduité : <strong>{i.assiduite} %</strong></p>}
      {i.objectif && <p>{i.objectif}</p>}
      {i.objectifs_operationnels.length > 0 && <><h3>Objectifs</h3><ul>{i.objectifs_operationnels.map((o) => <li key={o}>{o}</li>)}</ul></>}
      {i.prochaines_seances.length > 0 && <><h3>Prochaines séances</h3><ul>{i.prochaines_seances.map((s, k) => <li key={k}>{formaterDate(s.date_seance)} {String(s.heure_debut || "").slice(0, 5)}–{String(s.heure_fin || "").slice(0, 5)}{s.theme ? ` — ${s.theme}` : ""}{s.lieu ? ` (${s.lieu})` : ""}</li>)}</ul></>}
      {i.documents.length > 0 && <><h3>Mes documents</h3><ul>{i.documents.map((doc) => <li key={doc.id}><a href={`/api/portail/stagiaire/documents/${doc.id}/pdf`} download>{doc.nom}</a> <span className="sess-secondaire">({formaterDate(doc.genere_le)})</span></li>)}</ul></>}
      {i.enquetes.length > 0 && <><h3>Donnez votre avis</h3><ul>{i.enquetes.map((e) => <li key={e.chemin}><a href={e.chemin}>{e.titre}</a></li>)}</ul></>}
      {i.evaluations.length > 0 && <><h3>Mes évaluations</h3><ul>{i.evaluations.map((e, k) => <li key={k}>{e.intitule} — {formaterDate(e.date_passage)}{e.score !== null && e.score !== undefined ? ` — ${Number(e.score)} / ${Number(e.score_max)}` : ""}{RESULTATS[e.resultat] ? ` — ${RESULTATS[e.resultat]}` : ""}</li>)}</ul></>}
      {i.competences.length > 0 && <><h3>Mes compétences</h3><ul>{i.competences.map((c) => <li key={c.competence}>{c.competence} — {STATUTS_COMP[c.statut]}</li>)}</ul></>}
      <Signalement url="/api/portail/stagiaire/signalement" contexte={{ inscription_id: i.inscription_id }} choixType />
    </section>
  ));
}

function Signalement({ url, contexte, choixType = false, titre = "Signaler une difficulté ou faire une réclamation" }) {
  const [ouvert, setOuvert] = useState(false);
  const [v, setV] = useState({ type: "incident", objet: "", description: "" });
  const [message, setMessage] = useState(null);
  async function envoyer(e) {
    e.preventDefault(); setMessage(null);
    try { const r = await api(url, { method: "POST", body: JSON.stringify({ ...contexte, ...v }) }); setMessage({ ton: "success", texte: `${r.message} (référence ${r.reference})` }); setOuvert(false); setV({ type: "incident", objet: "", description: "" }); }
    catch (err) { setMessage({ ton: "error", texte: err.message }); }
  }
  return (
    <div className="espace__signalement">
      {message && <Alert ton={message.ton}>{message.texte}</Alert>}
      {!ouvert ? <Button compact onClick={() => setOuvert(true)}>{titre}</Button> : (
        <form onSubmit={envoyer} noValidate className="ui-form">
          {choixType && <Field label="Nature"><select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}><option value="incident">Une difficulté</option><option value="reclamation">Une réclamation</option></select></Field>}
          <Field label="Objet"><input value={v.objet} maxLength={200} onChange={(e) => setV({ ...v, objet: e.target.value })} /></Field>
          <Field label="Précisions" facultatif><textarea rows={3} maxLength={4000} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
          <div className="sess-actions"><Button onClick={() => setOuvert(false)}>Annuler</Button><Button variante="primary" type="submit">Envoyer</Button></div>
        </form>
      )}
    </div>
  );
}

function EspaceFormateur() {
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [seance, setSeance] = useState(null);
  const [competences, setCompetences] = useState(null);
  useEffect(() => { api("/api/portail/formateur").then(setD).catch((e) => setErreur(e.message)); }, []);
  if (erreur) return <Alert ton="error">{erreur}</Alert>;
  if (!d) return <LoadingState texte="Chargement…" />;
  return (
    <>
      {d.sessions.length === 0 && <p>Aucune session ne vous est rattachée pour le moment.</p>}
      {d.sessions.map((s) => (
        <section key={s.id} className="repondre__question espace__formation" aria-label={s.formation}>
          <h2>{s.formation} — {s.reference}</h2>
          <p>Du {formaterDate(s.date_debut)} au {formaterDate(s.date_fin)}{s.horaire ? ` — ${s.horaire}` : ""}{s.lieu ? ` — ${s.lieu}` : ""}{s.archivee ? " (archivée)" : ""}</p>
          <h3>Séances</h3>
          {s.seances.length === 0 ? <p className="sess-secondaire">Aucune séance planifiée.</p> : (
            <ul className="pilotage-liste">{s.seances.map((x) => (
              <li key={x.id}><span className="pilotage-liste__date">{formaterDate(x.date_seance)}</span>{String(x.heure_debut || "").slice(0, 5)}–{String(x.heure_fin || "").slice(0, 5)}{x.theme ? ` — ${x.theme}` : ""}{x.groupe ? ` (${x.groupe})` : ""}
                <Button compact onClick={() => setSeance(x.id)}>Suivi de la séance</Button></li>))}
            </ul>
          )}
          <h3>Stagiaires ({s.stagiaires.length})</h3>
          <ul className="pilotage-liste">{s.stagiaires.map((x) => <li key={x.inscription_id}>{x.prenom} {x.nom}{x.groupe ? ` — ${x.groupe}` : ""}<Button compact onClick={() => setCompetences({ id: x.inscription_id, nom: `${x.prenom} ${x.nom}` })}>Compétences</Button></li>)}</ul>
          {s.ressources.length > 0 && <><h3>Ressources</h3><ul>{s.ressources.map((r, k) => <li key={k}>{r.lien ? <a href={r.lien} target="_blank" rel="noopener noreferrer">{r.titre}</a> : r.titre}{r.version ? ` (v${r.version})` : ""}</li>)}</ul></>}
          <Signalement url="/api/portail/formateur/incident" contexte={{ session_id: s.id }} titre="Signaler un incident" />
        </section>
      ))}
      {d.justificatifs.length > 0 && (
        <section className="repondre__question" aria-label="Mes justificatifs">
          <h2>Mes justificatifs</h2>
          <ul>{d.justificatifs.map((j, k) => <li key={k}>{j.categorie} — {j.titre}{j.date_echeance ? ` (échéance ${formaterDate(j.date_echeance)})` : ""}</li>)}</ul>
        </section>
      )}
      {seance && <SuiviSeance id={seance} onFermer={() => setSeance(null)} />}
      {competences && <CompetencesStagiaire cible={competences} onFermer={() => setCompetences(null)} />}
    </>
  );
}

function SuiviSeance({ id, onFermer }) {
  const [d, setD] = useState(null);
  const [message, setMessage] = useState(null);
  useEffect(() => { api(`/api/portail/formateur/seances/${id}`).then(setD).catch((e) => setMessage({ ton: "error", texte: e.message })); }, [id]);
  const maj = (insc, champ, val) => setD({ ...d, suivis: d.suivis.map((x) => (x.inscription_id === insc ? { ...x, [champ]: val } : x)) });
  async function enregistrer(x) {
    setMessage(null);
    try { await api(`/api/portail/formateur/seances/${id}/suivi/${x.inscription_id}`, { method: "PUT", body: JSON.stringify({ accompagnement: x.accompagnement, difficultes: x.difficultes, impressions: x.impressions, observations: x.observations }) }); setMessage({ ton: "success", texte: `Suivi de ${x.prenom} ${x.nom} enregistré.` }); }
    catch (e) { setMessage({ ton: "error", texte: e.message }); }
  }
  return (
    <Drawer ouvert onFermer={onFermer} taille="large" titre="Suivi de la séance" description={d ? `${formaterDate(d.seance.date_seance)}${d.seance.theme ? ` — ${d.seance.theme}` : ""}` : ""} pied={<Button onClick={onFermer}>Fermer</Button>}>
      {message && <Alert ton={message.ton}>{message.texte}</Alert>}
      {!d && !message && <LoadingState texte="Chargement…" />}
      {d?.suivis.map((x) => (
        <fieldset key={x.inscription_id} className="ui-form-section" disabled={d.archivee}><legend>{x.prenom} {x.nom}</legend>
          {[["accompagnement", "Accompagnement apporté"], ["difficultes", "Difficultés"], ["impressions", "Impressions du stagiaire"], ["observations", "Observations"]].map(([k, l]) => (
            <Field key={k} label={l} facultatif><textarea rows={2} maxLength={2000} value={x[k] || ""} onChange={(e) => maj(x.inscription_id, k, e.target.value)} /></Field>
          ))}
          <Button compact variante="primary" onClick={() => enregistrer(x)}>Enregistrer</Button>
        </fieldset>
      ))}
    </Drawer>
  );
}

function CompetencesStagiaire({ cible, onFermer }) {
  const [d, setD] = useState(null);
  const [statuts, setStatuts] = useState({});
  const [message, setMessage] = useState(null);
  useEffect(() => { api(`/api/portail/formateur/competences/${cible.id}`).then((r) => { setD(r); setStatuts(Object.fromEntries(r.competences.map((c) => [c.competence, c.statut || ""]))); }).catch((e) => setMessage({ ton: "error", texte: e.message })); }, [cible.id]);
  async function enregistrer() {
    try { await api(`/api/portail/formateur/competences/${cible.id}`, { method: "PUT", body: JSON.stringify({ competences: d.competences.map((c) => ({ competence: c.competence, statut: statuts[c.competence] || null })) }) }); setMessage({ ton: "success", texte: "Compétences enregistrées." }); }
    catch (e) { setMessage({ ton: "error", texte: e.message }); }
  }
  return (
    <Drawer ouvert onFermer={onFermer} titre={`Compétences — ${cible.nom}`} pied={<><Button onClick={onFermer}>Fermer</Button>{d?.competences.length > 0 && !d.archivee && <Button variante="primary" onClick={enregistrer}>Enregistrer</Button>}</>}>
      {message && <Alert ton={message.ton}>{message.texte}</Alert>}
      {!d && !message && <LoadingState texte="Chargement…" />}
      {d?.competences.length === 0 && <p>Aucune compétence définie pour cette formation.</p>}
      <div className="ui-form">{d?.competences.map((c) => (
        <Field key={c.competence} label={c.competence} facultatif>
          <select value={statuts[c.competence] || ""} disabled={d.archivee} onChange={(e) => setStatuts({ ...statuts, [c.competence]: e.target.value })}><option value="">Non évalué</option>{Object.entries(STATUTS_COMP).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>))}
      </div>
    </Drawer>
  );
}
