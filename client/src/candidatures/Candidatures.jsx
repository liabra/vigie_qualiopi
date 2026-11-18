import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { formaterDate } from "../pilotage/RegistrePage.jsx";

const TON = { nouvelle: "info", en_etude: "warning", acceptee: "success", refusee: "neutral", sans_suite: "neutral" };

// Candidatures reçues par le formulaire public : étude, pièces, décision, affectation à une session.
export function CandidaturesPage() {
  useTitrePage("Candidatures");
  const [d, setD] = useState(null);
  const [filtre, setFiltre] = useState("");
  const [erreur, setErreur] = useState(null);
  const [succes, setSucces] = useState(null);
  const [ouverte, setOuverte] = useState(null);
  const [reglages, setReglages] = useState(false);
  const charger = useCallback(() => api(`/api/candidatures${filtre ? `?statut=${filtre}` : ""}`).then((r) => { setD(r); setErreur(null); }).catch((e) => setErreur(e.message)), [filtre]);
  useEffect(() => { charger(); }, [charger]);
  const lien = `${window.location.origin}/candidater`;
  return (
    <>
      <PageHeader fil={[{ libelle: "Formation" }, { libelle: "Candidatures" }]} titre="Candidatures"
        description="Demandes reçues par le formulaire en ligne : étude du dossier, pièces reçues, décision motivée et inscription à une session."
        actions={<Button onClick={() => setReglages(true)}>Formations ouvertes et pièces attendues</Button>} />
      {succes && <Alert ton="success">{succes}</Alert>}
      {erreur && <Alert ton="error">{erreur}</Alert>}
      <Field label="Lien du formulaire public à diffuser (site, réseaux, prescripteurs)"><input readOnly value={lien} onFocus={(e) => e.target.select()} /></Field>
      <div className="sess-vues" role="group" aria-label="Filtrer">
        {[["", "Toutes"], ...Object.entries(d?.statuts || {})].map(([k, l]) => (
          <button key={k} type="button" className={"sess-vue" + (filtre === k ? " sess-vue--active" : "")} aria-pressed={filtre === k} onClick={() => setFiltre(k)}>{l}</button>
        ))}
      </div>
      {!d && !erreur && <LoadingState texte="Chargement…" />}
      {d?.candidatures.length === 0 && <EmptyState titre="Aucune candidature">Ouvrez une formation à la candidature, puis diffusez le lien du formulaire.</EmptyState>}
      {d?.candidatures.length > 0 && (
        <table className="sess-table">
          <caption className="visually-hidden">Candidatures</caption>
          <thead><tr><th scope="col">Candidat</th><th scope="col">Formation</th><th scope="col">Reçue le</th><th scope="col">Pièces</th><th scope="col">Statut</th><th scope="col"><span className="visually-hidden">Ouvrir</span></th></tr></thead>
          <tbody>{d.candidatures.map((c) => (
            <tr key={c.id}>
              <td data-label="Candidat" className="sess-table__principal">{c.prenom} {c.nom}</td>
              <td data-label="Formation">{c.formation}{c.session_souhaitee_reference ? ` — ${c.session_souhaitee_reference}` : ""}</td>
              <td data-label="Reçue le">{formaterDate(c.cree_le)}</td>
              <td data-label="Pièces">{(c.pieces_attendues || []).length ? `${(c.pieces_recues || []).filter((p) => c.pieces_attendues.includes(p)).length} / ${c.pieces_attendues.length}` : "—"}</td>
              <td data-label="Statut"><Badge ton={TON[c.statut]}>{d.statuts[c.statut]}</Badge></td>
              <td className="sess-table__actions"><Button compact onClick={() => { setSucces(null); setOuverte(c); }} aria-label={`Ouvrir la candidature de ${c.prenom} ${c.nom}`}>Ouvrir</Button></td>
            </tr>))}
          </tbody>
        </table>
      )}
      {ouverte && <DossierCandidature candidature={ouverte} statuts={d.statuts} onFermer={() => setOuverte(null)} onFait={(m) => { setOuverte(null); setSucces(m); charger(); }} />}
      {reglages && d && <ReglagesFormations formations={d.formations} onFermer={() => { setReglages(false); charger(); }} />}
    </>
  );
}

function DossierCandidature({ candidature: c, statuts, onFermer, onFait }) {
  const [v, setV] = useState({ statut: c.statut, notes: c.notes || "", motif_decision: c.motif_decision || "", pieces_recues: c.pieces_recues || [] });
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(c.session_souhaitee_id ? String(c.session_souhaitee_id) : "");
  const [erreur, setErreur] = useState(null);
  const [suppression, setSuppression] = useState(false);
  const acceptee = c.statut === "acceptee";
  useEffect(() => { api("/api/sessions").then((r) => setSessions((r.sessions || []).filter((s) => !s.archivee_le))).catch(() => {}); }, []);
  const appel = async (fn, m) => { setErreur(null); try { await fn(); onFait(m); } catch (e) { setErreur(e.message); } };
  return (
    <Drawer ouvert onFermer={onFermer} taille="large" titre={`${c.prenom} ${c.nom}`} description={`${c.formation} — reçue le ${formaterDate(c.cree_le)}`}
      pied={acceptee ? <Button onClick={onFermer}>Fermer</Button> : <>
        <Button variante="danger" onClick={() => setSuppression(true)}>Supprimer</Button>
        <Button onClick={onFermer}>Fermer</Button>
        <Button variante="primary" onClick={() => appel(() => api(`/api/candidatures/${c.id}`, { method: "PATCH", body: JSON.stringify({ ...v, statut: v.statut === "acceptee" ? undefined : v.statut }) }), "Candidature enregistrée.")}>Enregistrer</Button>
      </>}>
      {erreur && <Alert ton="error">{erreur}</Alert>}
      {acceptee && <Alert ton="success" titre="Candidature acceptée">La personne est inscrite.{c.session_affectee_id && <> <Link to={`/sessions/${c.session_affectee_id}/stagiaires`}>Voir la session</Link></>}</Alert>}
      <div className="ui-form">
        <FormSection titre="Candidat" colonnes={2}>
          {[["Civilité", c.civilite], ["E-mail", c.email], ["Téléphone", c.telephone], ["Date de naissance", formaterDate(c.date_naissance)], ["Adresse", [c.adresse, c.code_postal, c.ville].filter(Boolean).join(" ")],
            ["Situation", c.situation], ["Orienté par", c.prescripteur], ["Session souhaitée", c.session_souhaitee_reference ? `${c.session_souhaitee_reference} (${formaterDate(c.session_souhaitee_debut)})` : ""]]
            .map(([l, x]) => <div key={l} className="ui-field"><span className="ui-field__label">{l}</span><div>{x || "—"}</div></div>)}
        </FormSection>
        {c.motivation && <><h3>Motivation</h3><p className="texte-preserve">{c.motivation}</p></>}
        {c.besoins_amenagement && <Alert ton="info" titre="Besoins d'aménagement (confidentiel)">{c.besoins_amenagement}</Alert>}
        {!acceptee && (
          <>
            {(c.pieces_attendues || []).length > 0 && (
              <fieldset className="ui-form-section"><legend>Pièces reçues</legend>
                {c.pieces_attendues.map((p) => <Checkbox key={p} label={p} checked={v.pieces_recues.includes(p)} onChange={(e) => setV({ ...v, pieces_recues: e.target.checked ? [...v.pieces_recues, p] : v.pieces_recues.filter((x) => x !== p) })} />)}
              </fieldset>
            )}
            <Field label="Statut"><select value={v.statut} onChange={(e) => setV({ ...v, statut: e.target.value })}>{Object.entries(statuts).filter(([k]) => k !== "acceptee").map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Notes d'étude (entretien, prérequis…)" facultatif><textarea rows={3} maxLength={4000} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
            <Field label="Motif de la décision" facultatif aide="À renseigner en cas de refus ou de réorientation (traçabilité)."><textarea rows={2} maxLength={1000} value={v.motif_decision} onChange={(e) => setV({ ...v, motif_decision: e.target.value })} /></Field>
            <fieldset className="ui-form-section"><legend>Accepter et inscrire</legend>
              <Field label="Session"><select value={session} onChange={(e) => setSession(e.target.value)}><option value="">Choisir…</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.reference || s.formation} — {s.formation} — {formaterDate(s.date_debut)}</option>)}</select></Field>
              <Button variante="primary" disabled={!session} onClick={() => appel(() => api(`/api/candidatures/${c.id}/affecter`, { method: "POST", body: JSON.stringify({ session_id: Number(session) }) }),
                "Candidature acceptée : la personne est inscrite à la session (fiche existante réutilisée si elle était déjà connue).")}>Accepter et inscrire</Button>
            </fieldset>
          </>
        )}
      </div>
      <ConfirmDialog ouvert={suppression} titre="Supprimer cette candidature ?" libelleConfirmer="Supprimer" onAnnuler={() => setSuppression(false)}
        onConfirmer={() => appel(() => api(`/api/candidatures/${c.id}`, { method: "DELETE" }), "Candidature supprimée.")}>
        <p>Les données de la candidature sont effacées définitivement.</p>
      </ConfirmDialog>
    </Drawer>
  );
}

function ReglagesFormations({ formations, onFermer }) {
  const [liste, setListe] = useState(formations.map((f) => ({ ...f, pieces: (f.pieces_attendues || []).join("\n") })));
  const [message, setMessage] = useState(null);
  async function enregistrer(f) {
    setMessage(null);
    try {
      await api(`/api/formations/${f.id}/candidature`, { method: "PATCH", body: JSON.stringify({ candidature_ouverte: f.candidature_ouverte, pieces_attendues: f.pieces.split("\n").map((p) => p.trim()).filter(Boolean) }) });
      setMessage({ ton: "success", texte: `« ${f.intitule} » enregistrée.` });
    } catch (e) { setMessage({ ton: "error", texte: e.message }); }
  }
  const maj = (id, champ, val) => setListe(liste.map((f) => (f.id === id ? { ...f, [champ]: val } : f)));
  return (
    <Drawer ouvert onFermer={onFermer} taille="large" titre="Formations ouvertes à la candidature" pied={<Button onClick={onFermer}>Fermer</Button>}>
      {message && <Alert ton={message.ton}>{message.texte}</Alert>}
      <div className="ui-form">
        {liste.map((f) => (
          <fieldset key={f.id} className="ui-form-section"><legend>{f.intitule}</legend>
            <Checkbox label="Proposer cette formation dans le formulaire public" checked={f.candidature_ouverte} onChange={(e) => maj(f.id, "candidature_ouverte", e.target.checked)} />
            <Field label="Pièces attendues (une par ligne)" facultatif><textarea rows={3} value={f.pieces} onChange={(e) => maj(f.id, "pieces", e.target.value)} /></Field>
            <Button onClick={() => enregistrer(f)}>Enregistrer</Button>
          </fieldset>
        ))}
      </div>
    </Drawer>
  );
}

// ── Formulaire public ────────────────────────────────────────
const VIDE = { civilite: "", nom: "", prenom: "", email: "", telephone: "", date_naissance: "", adresse: "", code_postal: "", ville: "", situation: "", prescripteur: "", motivation: "", besoins_amenagement: "", consentement: false, site_web: "" };

export function CandidaterPage() {
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [v, setV] = useState({ ...VIDE, formation_id: "", session_souhaitee_id: "" });
  const [envoye, setEnvoye] = useState(null);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    document.title = "Candidater";
    api("/api/public/candidature").then((r) => { setD(r); const f = new URLSearchParams(window.location.search).get("formation"); if (f && r.formations.some((x) => String(x.id) === f)) setV((x) => ({ ...x, formation_id: f })); }).catch((e) => setErreur(e.message));
  }, []);
  const formation = d?.formations.find((f) => String(f.id) === String(v.formation_id));
  const f = (k) => (e) => setV({ ...v, [k]: e.target.value });
  async function envoyer(e) {
    e.preventDefault(); setEnCours(true); setErreur(null);
    try {
      const corps = { ...v, formation_id: Number(v.formation_id), session_souhaitee_id: v.session_souhaitee_id ? Number(v.session_souhaitee_id) : null };
      for (const k of Object.keys(corps)) if (corps[k] === "") delete corps[k];
      const r = await api("/api/public/candidatures", { method: "POST", body: JSON.stringify(corps) });
      setEnvoye(r.message);
    } catch (err) { setErreur(err.message); setEnCours(false); }
  }
  return (
    <main className="repondre">
      {!d && !erreur && <LoadingState texte="Chargement…" />}
      {envoye && <Alert ton="success" titre="Candidature envoyée">{envoye}{formation?.pieces_attendues?.length ? <ul>{formation.pieces_attendues.map((p) => <li key={p}>{p}</li>)}</ul> : null}</Alert>}
      {d && !envoye && (
        <form onSubmit={envoyer} noValidate className="ui-form">
          <p className="repondre__organisme">{d.organisme.nom}</p>
          <h1>Candidater à une formation</h1>
          {d.formations.length === 0 ? <Alert ton="info">Aucune formation n'est ouverte à la candidature pour le moment.{d.organisme.telephone ? ` Contactez-nous au ${d.organisme.telephone}.` : ""}</Alert> : (
            <>
              <fieldset className="repondre__question"><legend>Formation</legend>
                <Field label="Formation souhaitée"><select value={v.formation_id} onChange={(e) => setV({ ...v, formation_id: e.target.value, session_souhaitee_id: "" })}><option value="">Choisir…</option>{d.formations.map((x) => <option key={x.id} value={x.id}>{x.intitule}</option>)}</select></Field>
                {formation && (
                  <>
                    {formation.objectifs && <p>{formation.objectifs}</p>}
                    {formation.public_vise && <p className="sess-secondaire">Public : {formation.public_vise}</p>}
                    {formation.prerequis && <p className="sess-secondaire">Prérequis : {formation.prerequis}</p>}
                    {formation.sessions.length > 0 && <Field label="Session souhaitée" facultatif><select value={v.session_souhaitee_id} onChange={f("session_souhaitee_id")}><option value="">Indifférent</option>{formation.sessions.map((s) => <option key={s.id} value={s.id}>du {formaterDate(s.date_debut)} au {formaterDate(s.date_fin)}{s.lieu ? ` — ${s.lieu}` : ""}</option>)}</select></Field>}
                    {formation.pieces_attendues?.length > 0 && <p className="sess-secondaire">Pièces à prévoir : {formation.pieces_attendues.join(", ")}.</p>}
                  </>
                )}
              </fieldset>
              <fieldset className="repondre__question"><legend>Vous</legend>
                <Field label="Civilité" facultatif><select value={v.civilite} onChange={f("civilite")}><option value="">—</option><option value="Mme">Madame</option><option value="M.">Monsieur</option></select></Field>
                <Field label="Nom"><input value={v.nom} maxLength={100} onChange={f("nom")} autoComplete="family-name" /></Field>
                <Field label="Prénom"><input value={v.prenom} maxLength={100} onChange={f("prenom")} autoComplete="given-name" /></Field>
                <Field label="E-mail" facultatif aide="E-mail ou téléphone : au moins l'un des deux."><input type="email" value={v.email} maxLength={200} onChange={f("email")} autoComplete="email" /></Field>
                <Field label="Téléphone" facultatif><input type="tel" value={v.telephone} maxLength={30} onChange={f("telephone")} autoComplete="tel" /></Field>
                <Field label="Date de naissance" facultatif><input type="date" value={v.date_naissance} onChange={f("date_naissance")} /></Field>
                <Field label="Adresse" facultatif><input value={v.adresse} maxLength={300} onChange={f("adresse")} autoComplete="street-address" /></Field>
                <Field label="Code postal" facultatif><input value={v.code_postal} maxLength={10} onChange={f("code_postal")} autoComplete="postal-code" /></Field>
                <Field label="Ville" facultatif><input value={v.ville} maxLength={100} onChange={f("ville")} autoComplete="address-level2" /></Field>
                <Field label="Votre situation" facultatif><select value={v.situation} onChange={f("situation")}><option value="">—</option>{d.situations.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
                <Field label="Structure qui vous oriente (France Travail, Mission Locale…)" facultatif><input value={v.prescripteur} maxLength={200} onChange={f("prescripteur")} /></Field>
                <Field label="Pourquoi cette formation ?" facultatif><textarea rows={4} maxLength={4000} value={v.motivation} onChange={f("motivation")} /></Field>
                <Field label="Avez-vous besoin d'un aménagement (handicap, santé…) ?" facultatif aide="Facultatif et confidentiel : seulement ce qui nous aide à adapter l'accueil, jamais de diagnostic."><textarea rows={2} maxLength={2000} value={v.besoins_amenagement} onChange={f("besoins_amenagement")} /></Field>
                <div className="champ-piege" aria-hidden="true"><label>Site web<input tabIndex={-1} autoComplete="off" value={v.site_web} onChange={f("site_web")} /></label></div>
              </fieldset>
              <Checkbox label={`J'accepte que ${d.organisme.nom || "l'organisme"} utilise ces informations pour étudier ma candidature et me recontacter. Elles ne sont transmises à personne d'autre.`} checked={v.consentement} onChange={(e) => setV({ ...v, consentement: e.target.checked })} />
              {erreur && <Alert ton="error">{erreur}</Alert>}
              <Button variante="primary" type="submit" disabled={enCours || !v.formation_id}>{enCours ? "Envoi…" : "Envoyer ma candidature"}</Button>
            </>
          )}
        </form>
      )}
      {erreur && !d && <Alert ton="error">{erreur}</Alert>}
    </main>
  );
}
