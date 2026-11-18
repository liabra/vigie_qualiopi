import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Field, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { formaterDate } from "./RegistrePage.jsx";

// Lien de téléchargement d'un PDF de preuve (même apparence qu'un bouton).
export function LienPdf({ href, children = "PDF", compact = false }) {
  return <a className={"ui-btn ui-btn--secondary" + (compact ? " ui-btn--compact" : "")} href={href} download>{children}</a>;
}

// « Preuves PDF » : tous les documents de preuve téléchargeables en PDF, prêts pour la plateforme de l'organisme certificateur.
export function PreuvesPdfPage({ admin }) {
  useTitrePage("Preuves PDF");
  const [catalogue, setCatalogue] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState("");
  const [enquetes, setEnquetes] = useState([]);
  const [campagnes, setCampagnes] = useState([]);
  const [erreur, setErreur] = useState(null);
  useEffect(() => {
    api("/api/pdf/catalogue").then((r) => setCatalogue(r.exports)).catch((e) => setErreur(e.message));
    if (admin) {
      api("/api/sessions").then((r) => setSessions(r.sessions || [])).catch(() => {});
      api("/api/enquetes").then((r) => setEnquetes(r.enquetes || [])).catch(() => {});
      api("/api/campagnes-audit").then((r) => setCampagnes(r.campagnes || [])).catch(() => {});
    }
  }, [admin]);
  return (
    <>
      <PageHeader fil={[{ libelle: "Qualité" }, { libelle: "Preuves PDF" }]} titre="Preuves PDF"
        description="Chaque document est produit à partir des données à jour, daté et paginé, au nom de l'organisme : prêt à déposer sur la plateforme de l'organisme certificateur." />
      {erreur && <Alert ton="error">{erreur}</Alert>}
      {!catalogue && !erreur && <LoadingState texte="Chargement…" />}
      {catalogue && (
        <ul className="pdf-catalogue">
          {catalogue.map((e) => (
            <li key={e.id}><div><strong>{e.titre}</strong><p className="sess-secondaire">{e.description}</p></div><LienPdf href={e.chemin}>Télécharger le PDF</LienPdf></li>
          ))}
        </ul>
      )}
      {admin && (
        <>
          <h2>Par session</h2>
          <div className="pilotage-filtres">
            <Field label="Session">
              <select value={session} onChange={(e) => setSession(e.target.value)}>
                <option value="">Choisir…</option>
                {sessions.map((s) => <option key={s.id} value={s.id}>{s.reference || s.formation} — {s.formation} — {formaterDate(s.date_debut)}</option>)}
              </select>
            </Field>
            {session && <><LienPdf href={`/api/pdf/sessions/${session}/bilan`}>Bilan de session (indicateurs)</LienPdf><LienPdf href={`/api/pdf/sessions/${session}/assiduite`}>Suivi de l'assiduité</LienPdf></>}
          </div>
          {enquetes.length > 0 && (
            <>
              <h2>Par enquête</h2>
              <ul className="pdf-catalogue">{enquetes.map((e) => <li key={e.id}><div><strong>{e.titre}</strong><p className="sess-secondaire">{e.formation} — {e.session_reference} — {e.reponses} réponse(s)</p></div><LienPdf href={`/api/pdf/enquetes/${e.id}`} /></li>)}</ul>
            </>
          )}
          {campagnes.length > 0 && (
            <>
              <h2>Préparations d'audit</h2>
              <ul className="pdf-catalogue">{campagnes.map((c) => <li key={c.id}><div><strong>{c.titre}</strong><p className="sess-secondaire">Auto-évaluation par indicateur (document interne)</p></div><LienPdf href={`/api/pdf/campagnes-audit/${c.id}`} /></li>)}</ul>
            </>
          )}
        </>
      )}
    </>
  );
}
