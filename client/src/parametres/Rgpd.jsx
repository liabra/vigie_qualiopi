import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Button, Drawer, EmptyState, Field, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";

// Registre simplifié des traitements : ce que Vigie conserve, pourquoi, et pour combien de temps.
const TRAITEMENTS = [
  ["Suivi des stagiaires", "Identité, coordonnées, inscription, présences, évaluations, accompagnement", "Exécution de la formation, obligations Qualiopi", "Durée de conservation paramétrée ci-dessous après la fin de la dernière session"],
  ["Données de santé et handicap", "Situation de handicap, domaines, besoins et adaptations", "Adapter la formation (obligation d'accessibilité)", "Même durée ; accès administrateur seulement, jamais en génération automatique"],
  ["Enquêtes de satisfaction", "Réponses anonymes", "Amélioration continue (indicateurs 30 à 32)", "Conservées sans identité"],
  ["Comptes utilisateurs", "Adresse, nom, rôle, connexions", "Sécurité de l'accès", "Tant que le compte est actif"],
  ["Journal de sécurité", "Opérations sensibles et leur auteur", "Traçabilité", "Conservé pour la durée d'utilisation"],
];

export function RgpdPage() {
  useTitrePage("RGPD et conservation");
  const [d, setD] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [succes, setSucces] = useState(null);
  const [duree, setDuree] = useState("");
  const [cible, setCible] = useState(null);
  const charger = useCallback(() => api("/api/rgpd/synthese").then((r) => { setD(r); setDuree(String(r.duree_conservation_annees)); setErreur(null); }).catch((e) => setErreur(e.message)), []);
  useEffect(() => { charger(); }, [charger]);
  async function enregistrerDuree() {
    setSucces(null);
    try { await api("/api/rgpd/duree", { method: "PUT", body: JSON.stringify({ annees: Number(duree) }) }); setSucces("Durée de conservation enregistrée."); charger(); }
    catch (e) { setErreur(e.message); }
  }
  return (
    <>
      <PageHeader fil={[{ libelle: "Paramètres" }, { libelle: "RGPD et conservation" }]} titre="RGPD et conservation"
        description="Durée de conservation, personnes arrivées au terme, droit d'accès (export) et droit à l'effacement (anonymisation)." />
      {succes && <Alert ton="success">{succes}</Alert>}
      {erreur && <Alert ton="error">{erreur}</Alert>}
      {!d && !erreur && <LoadingState texte="Chargement…" />}
      {d && (
        <>
          <div className="pilotage-filtres">
            <Field label="Durée de conservation après la dernière session (années)"><input type="number" min={1} max={50} value={duree} onChange={(e) => setDuree(e.target.value)} /></Field>
            <Button onClick={enregistrerDuree}>Enregistrer</Button>
          </div>
          <h2>Personnes arrivées au terme ({d.au_terme.length})</h2>
          <p className="sess-secondaire">{d.anonymises} personne(s) déjà anonymisée(s). Anonymiser conserve les statistiques (présences, résultats) mais efface l'identité, les coordonnées et les textes libres.</p>
          {d.au_terme.length === 0 ? <EmptyState titre="Aucune personne au terme">Personne n'a dépassé la durée de conservation.</EmptyState> : (
            <table className="sess-table">
              <caption className="visually-hidden">Personnes au terme</caption>
              <thead><tr><th scope="col">Personne</th><th scope="col">Dernière session terminée</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
              <tbody>{d.au_terme.map((p) => (
                <tr key={p.id}>
                  <td data-label="Personne" className="sess-table__principal">{p.prenom} {p.nom}</td>
                  <td data-label="Dernière session">{p.derniere_fin ? String(p.derniere_fin).slice(0, 10).split("-").reverse().join("/") : "Aucune inscription"}</td>
                  <td className="sess-table__actions">
                    <a className="ui-btn ui-btn--secondary ui-btn--compact" href={`/api/rgpd/personnes/${p.id}/export`} download>Exporter</a>
                    <Button compact variante="danger" onClick={() => setCible(p)}>Anonymiser</Button>
                  </td>
                </tr>))}
              </tbody>
            </table>
          )}
          <p className="sess-secondaire">Demande d'une personne encore suivie (accès ou effacement) : ouvrez sa fiche dans la session, ou utilisez son identifiant ci-dessous.</p>
          <DemandePersonne onAnonymiser={setCible} />
          <h2>Registre des traitements (synthèse)</h2>
          <table className="sess-table">
            <thead><tr><th scope="col">Traitement</th><th scope="col">Données</th><th scope="col">Finalité</th><th scope="col">Conservation</th></tr></thead>
            <tbody>{TRAITEMENTS.map((t) => <tr key={t[0]}>{t.map((c, i) => <td key={i} className={i === 0 ? "sess-table__principal" : undefined}>{c}</td>)}</tr>)}</tbody>
          </table>
          <p className="sess-secondaire">Sous-traitants : hébergement Railway (application et base de données), Google (connexion et documents Drive). Les documents déjà générés dans Google Drive ne sont pas modifiés par une anonymisation : supprimez-les dans Drive si nécessaire.</p>
        </>
      )}
      {cible && <Anonymisation personne={cible} onFermer={() => setCible(null)} onFait={(m) => { setCible(null); setSucces(m); charger(); }} />}
    </>
  );
}

function DemandePersonne({ onAnonymiser }) {
  const [id, setId] = useState("");
  const valide = /^\d+$/.test(id);
  return (
    <div className="pilotage-filtres">
      <Field label="Identifiant de la personne" aide="Visible dans l'adresse de sa fiche (Jeunes → fiche)."><input inputMode="numeric" value={id} onChange={(e) => setId(e.target.value.trim())} /></Field>
      <a className={"ui-btn ui-btn--secondary" + (valide ? "" : " ui-btn--desactive")} aria-disabled={!valide} href={valide ? `/api/rgpd/personnes/${id}/export` : undefined} download>Exporter ses données</a>
      <Button variante="danger" disabled={!valide} onClick={() => onAnonymiser({ id: Number(id), prenom: "Personne", nom: `n° ${id}` })}>Anonymiser</Button>
    </div>
  );
}

function Anonymisation({ personne, onFermer, onFait }) {
  const [saisie, setSaisie] = useState("");
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  async function confirmer(e) {
    e.preventDefault(); setEnCours(true); setErreur(null);
    try { const r = await api(`/api/rgpd/personnes/${personne.id}/anonymiser`, { method: "POST", body: JSON.stringify({ confirmation: saisie }) }); onFait(r.message); }
    catch (err) { setErreur(err.message); setEnCours(false); }
  }
  return (
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} titre={`Anonymiser ${personne.prenom} ${personne.nom}`}
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button><Button variante="danger" type="submit" form="form-anonymiser" disabled={enCours || saisie !== "ANONYMISER"}>Anonymiser définitivement</Button></>}>
      <form id="form-anonymiser" onSubmit={confirmer} noValidate className="ui-form">
        <Alert ton="warning" titre="Opération irréversible">Nom, coordonnées, données de santé, textes libres et entretiens sont effacés. Les présences, résultats et réponses aux enquêtes restent, sans identité. Exportez d'abord ses données si la personne les demande.</Alert>
        {erreur && <Alert ton="error">{erreur}</Alert>}
        <Field label="Tapez ANONYMISER pour confirmer"><input value={saisie} onChange={(e) => setSaisie(e.target.value)} autoComplete="off" /></Field>
      </form>
    </Drawer>
  );
}
