import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Field, FormSection, LoadingState } from "../ui/index.js";
import { formaterDate } from "../sessions/format.js";
import {
  AVERTISSEMENT_CONFIDENTIEL, CATEGORIES_JUSTIFICATIF, ETATS_JUSTIFICATIF, MSG_PAS_NON_CONFORMITE, validite,
} from "./format.js";

// Section « Justificatifs professionnels » de la fiche (ADMIN uniquement :
// le serveur refuse ces routes au contributeur). Un justificatif = une
// preuve existante rattachée (fichiers Drive, dates et alertes du module
// Preuves) : aucun nouveau stockage, aucune copie.
export function JustificatifsIntervenant({ intervenant }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [attendus, setAttendus] = useState(null); // édition des pièces attendues
  const [ajout, setAjout] = useState(null); // { categorie, date_document, q }
  const [preuves, setPreuves] = useState(null);
  const [aRetirer, setARetirer] = useState(null);
  const [erreurAction, setErreurAction] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const verrou = useRef(false);
  const base = `/api/intervenants/${intervenant.id}/justificatifs`;
  const charger = useCallback(async () => {
    try { setD(await api(base)); setErr(null); } catch (e) { setErr(e.message); }
  }, [base]);
  useEffect(() => { charger(); }, [charger]);

  async function executer(fn) {
    if (verrou.current) return false; // fix : jamais de double envoi
    verrou.current = true; setEnCours(true); setErreurAction(null);
    try { setD(await fn()); return true; } catch (e) { setErreurAction(e.message); return false; } finally { verrou.current = false; setEnCours(false); }
  }
  const ouvrirAjout = () => {
    setErreurAction(null); setAjout({ categorie: "", date_document: "", q: "" });
    if (!preuves) api("/api/preuves").then((r) => setPreuves(r.preuves)).catch((e) => setErreurAction(e.message));
  };
  const dejaLies = new Set((d?.justificatifs || []).map((j) => j.preuve_id));
  const proposees = (preuves || []).filter((p) => !dejaLies.has(p.id) && (!ajout?.q || p.titre.toLowerCase().includes(ajout.q.toLowerCase()))).slice(0, 20);

  if (err) return <Alert ton="error" titre="Les justificatifs n'ont pas pu être chargés." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>;
  if (!d) return <LoadingState texte="Chargement des justificatifs…" />;

  return (
    <section aria-labelledby="titre-justificatifs" className="ui-form">
      <h3 id="titre-justificatifs" className="accompagnement-sections__titre">Justificatifs professionnels</h3>
      <p className="sess-secondaire">Réservé à l'administrateur. {MSG_PAS_NON_CONFORMITE}</p>
      {erreurAction && <Alert ton="error" titre="L'opération n'a pas abouti.">{erreurAction}</Alert>}

      <table className="sess-table">
        <caption className="visually-hidden">Justificatifs par catégorie</caption>
        <thead><tr><th scope="col">Catégorie</th><th scope="col">Pièce attendue</th><th scope="col">Document</th><th scope="col">Validité</th><th scope="col">État</th></tr></thead>
        <tbody>
          {d.lignes.map((l) => (
            <tr key={l.categorie}>
              <td data-label="Catégorie" className="sess-table__principal">{CATEGORIES_JUSTIFICATIF[l.categorie]}</td>
              <td data-label="Pièce attendue">{l.attendue ? "Oui" : "Facultative"}</td>
              <td data-label="Document">
                {l.justificatifs.length === 0 ? <span className="sess-secondaire">{l.attendue ? "Manquant" : "—"}</span> : l.justificatifs.map((j) => (
                  <div key={j.id} className="suivi-inscription">
                    <span>{j.titre}{j.date_document ? ` (document du ${formaterDate(j.date_document)})` : ""}</span>
                    {j.fichiers[0]?.url && <a className="ui-btn ui-btn--ghost ui-btn--compact" href={j.fichiers[0].url} target="_blank" rel="noreferrer" aria-label={`Ouvrir le document ${j.titre} (nouvel onglet)`}>Ouvrir le document</a>}
                    <Button compact variante="ghost" onClick={() => setARetirer(j)} aria-label={`Retirer le lien vers ${j.titre}`}>Retirer le lien</Button>
                  </div>
                ))}
              </td>
              <td data-label="Validité">{l.justificatifs.length ? l.justificatifs.map((j) => <div key={j.id}>{validite(j)}</div>) : <span className="sess-secondaire">—</span>}</td>
              <td data-label="État">{l.etat ? <Badge ton={ETATS_JUSTIFICATIF[l.etat].ton}>{ETATS_JUSTIFICATIF[l.etat].libelle}</Badge> : <span className="sess-secondaire">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {d.sous_traitance && (
        <div className="qualite-fiche" aria-label="Suivi de la sous-traitance">
          <h4 className="accompagnement-sections__titre">Suivi de la sous-traitance</h4>
          <p>Contrat {d.sous_traitance.contrat_attendu ? "attendu" : "non désigné comme attendu"} — état : <strong>{d.sous_traitance.etat ? ETATS_JUSTIFICATIF[d.sous_traitance.etat].libelle : "aucun contrat rattaché"}</strong></p>
          {d.sous_traitance.contrats.map((c) => (
            <p key={c.id} className="sess-secondaire">{c.titre} — {c.date_document ? `contrat du ${formaterDate(c.date_document)}` : "date du contrat non renseignée"} · {validite(c)}</p>
          ))}
        </div>
      )}

      <div className="sess-actions">
        <Button compact onClick={() => { setErreurAction(null); setAttendus([...d.attendus]); }}>Définir les pièces attendues</Button>
        <Button compact variante="primary" onClick={ouvrirAjout}>Rattacher une preuve</Button>
      </div>

      {attendus && (
        <fieldset className="ui-form-section">
          <legend>Pièces attendues pour cet intervenant</legend>
          {Object.entries(CATEGORIES_JUSTIFICATIF).map(([k, l]) => (
            <label key={k} className="ui-case">
              <input type="checkbox" checked={attendus.includes(k)} onChange={() => setAttendus((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]))} />
              <span>{l}</span>
            </label>
          ))}
          <div className="sess-actions">
            <Button compact onClick={() => setAttendus(null)} disabled={enCours}>Annuler</Button>
            <Button compact variante="primary" disabled={enCours}
              onClick={async () => { if (await executer(() => api(`${base}/attendus`, { method: "PUT", body: JSON.stringify({ categories: attendus }) }))) setAttendus(null); }}>
              Enregistrer les pièces attendues
            </Button>
          </div>
        </fieldset>
      )}

      {ajout && (
        <div className="ui-form-section" aria-label="Rattacher une preuve existante">
          <Alert ton="warning" titre="Confidentialité">{AVERTISSEMENT_CONFIDENTIEL}</Alert>
          <FormSection titre="Rattacher une preuve existante" colonnes={2}>
            <Field label="Catégorie du justificatif">
              <select value={ajout.categorie} onChange={(e) => setAjout((a) => ({ ...a, categorie: e.target.value }))}>
                <option value="">Choisir</option>
                {Object.entries(CATEGORIES_JUSTIFICATIF).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="Date du document" facultatif aide="Ex. date du contrat. L'échéance est celle de la preuve.">
              <input type="date" value={ajout.date_document} onChange={(e) => setAjout((a) => ({ ...a, date_document: e.target.value }))} />
            </Field>
            <Field label="Rechercher une preuve" className="ui-field--large" aide="La preuve et ses fichiers Drive doivent déjà exister dans le module Preuves.">
              <input type="search" value={ajout.q} onChange={(e) => setAjout((a) => ({ ...a, q: e.target.value }))} />
            </Field>
          </FormSection>
          {!preuves ? <LoadingState texte="Chargement des preuves…" /> : proposees.length === 0 ? <p className="sess-secondaire">Aucune preuve correspondante.</p> : (
            <ul className="adaptations-liste" aria-label="Preuves proposées">
              {proposees.map((p) => (
                <li key={p.id} className="suivi-inscription">
                  <span>{p.titre} <span className="sess-secondaire">— indicateur {p.indicateur}</span></span>
                  <Button compact variante="primary" disabled={enCours || !ajout.categorie} aria-label={`Rattacher la preuve ${p.titre}`}
                    onClick={async () => { if (await executer(() => api(base, { method: "POST", body: JSON.stringify({ preuve_id: p.id, categorie: ajout.categorie, date_document: ajout.date_document || null }) }))) setAjout(null); }}>
                    Rattacher
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {!ajout.categorie && <p className="sess-secondaire">Choisissez d'abord la catégorie du justificatif.</p>}
          <Button compact onClick={() => setAjout(null)} disabled={enCours}>Fermer</Button>
        </div>
      )}

      <ConfirmDialog ouvert={!!aRetirer} titre="Retirer ce justificatif ?" libelleConfirmer="Retirer le lien" ton="danger" enCours={enCours}
        onAnnuler={() => setARetirer(null)}
        onConfirmer={async () => { await executer(() => api(`${base}/${aRetirer.id}`, { method: "DELETE" })); setARetirer(null); }}>
        Seul le lien avec l'intervenant est retiré : la preuve et ses fichiers Drive sont conservés (et restent réservés à l'administrateur).
      </ConfirmDialog>
    </section>
  );
}
