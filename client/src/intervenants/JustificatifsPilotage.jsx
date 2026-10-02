import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, EmptyState, Field, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { formaterDate } from "../sessions/format.js";
import { CATEGORIES_JUSTIFICATIF, ETATS_JUSTIFICATIF, MSG_PAS_NON_CONFORMITE, nomComplet } from "./format.js";

// /justificatifs-intervenants (ADMIN) : pièces attendues manquantes,
// documents bientôt à renouveler ou périmés, intervenants ACTIFS concernés.
export function JustificatifsPilotage() {
  useTitrePage("Justificatifs des intervenants");
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [etat, setEtat] = useState("");
  const charger = useCallback(async () => {
    try { setD(await api("/api/justificatifs-intervenants")); setErr(null); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);
  const elements = d ? d.elements.filter((x) => !etat || x.etat === etat) : [];

  return (
    <>
      <PageHeader fil={[{ libelle: "Formation" }, { libelle: "Justificatifs des intervenants" }]} titre="Justificatifs des intervenants"
        description="Pièces attendues manquantes et documents à renouveler, pour les intervenants actifs." />
      {err && <Alert ton="error" titre="La synthèse n'a pas pu être chargée." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!d && !err && <LoadingState texte="Chargement…" />}
      {d && (
        <>
          <dl className="sess-chiffres">
            <div><dt>Pièces attendues manquantes</dt><dd>{d.resume.manquants}</dd></div>
            <div><dt>Bientôt à renouveler</dt><dd>{d.resume.bientot}</dd></div>
            <div><dt>Périmés</dt><dd>{d.resume.perimes}</dd></div>
            <div><dt>Intervenants concernés</dt><dd>{d.resume.intervenants}</dd></div>
          </dl>
          <p className="sess-secondaire">{MSG_PAS_NON_CONFORMITE}</p>
          <Field label="État">
            <select value={etat} onChange={(e) => setEtat(e.target.value)}>
              <option value="">Tous</option>
              <option value="manquant">Manquant</option>
              <option value="bientot">Bientôt à renouveler</option>
              <option value="perime">Périmé</option>
            </select>
          </Field>
          {elements.length === 0 ? <EmptyState titre="Rien à signaler">Aucune pièce attendue manquante ni document à renouveler.</EmptyState> : (
            <table className="sess-table">
              <caption className="visually-hidden">Justificatifs à traiter ({elements.length})</caption>
              <thead><tr><th scope="col">Intervenant</th><th scope="col">Catégorie</th><th scope="col">Document</th><th scope="col">État</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
              <tbody>
                {elements.map((x, k) => (
                  <tr key={k}>
                    <td data-label="Intervenant" className="sess-table__principal">{nomComplet(x.intervenant)}</td>
                    <td data-label="Catégorie">{CATEGORIES_JUSTIFICATIF[x.categorie]}</td>
                    <td data-label="Document">{x.document ? `${x.document.titre}${x.document.date_echeance ? ` — échéance ${formaterDate(x.document.date_echeance)}` : ""}` : <span className="sess-secondaire">Aucun document rattaché</span>}</td>
                    <td data-label="État"><Badge ton={ETATS_JUSTIFICATIF[x.etat].ton}>{ETATS_JUSTIFICATIF[x.etat].libelle}</Badge></td>
                    <td className="sess-table__actions"><Link className="ui-btn ui-btn--compact" to={`/intervenants?fiche=${x.intervenant.id}`} aria-label={`Ouvrir la fiche de ${nomComplet(x.intervenant)}`}>Ouvrir la fiche</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}
