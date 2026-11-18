import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, Checkbox, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";

const ROLES = {
  admin: ["Administrateur", "Tout : paramétrage, référentiel, modèles, données sensibles."],
  contributeur: ["Contributeur", "Saisie courante : stagiaires, assiduité, documents, tâches."],
  auditeur: ["Auditeur externe", "Lecture seule des dossiers d'audit partagés, accès limité dans le temps (90 jours au plus)."],
};
const date = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "—");

// Comptes et accès : ajouter un collègue ou un auditeur sans toucher aux réglages du serveur ; journal des opérations sensibles.
export function ComptesPage({ moi }) {
  useTitrePage("Comptes et accès");
  const [donnees, setDonnees] = useState(null);
  const [journal, setJournal] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [succes, setSucces] = useState(null);
  const [panneau, setPanneau] = useState(null);
  const charger = useCallback(() => {
    api("/api/comptes").then((r) => { setDonnees(r); setErreur(null); }).catch((e) => setErreur(e.message));
    api("/api/journal-securite?limite=100").then((r) => setJournal(r.evenements)).catch(() => {});
  }, []);
  useEffect(() => { charger(); }, [charger]);
  const nouveau = <Button variante="primary" onClick={() => { setSucces(null); setPanneau({}); }}>+ Ajouter un compte</Button>;
  return (
    <>
      <PageHeader fil={[{ libelle: "Réglages", to: "/reglages" }, { libelle: "Comptes et accès" }]} titre="Comptes et accès"
        description="La connexion se fait avec un compte Google : enregistrez ici l'adresse autorisée et son rôle." actions={nouveau} />
      {succes && <Alert ton="success">{succes}</Alert>}
      {erreur && <Alert ton="error" titre="Chargement impossible.">{erreur}</Alert>}
      {!donnees && !erreur && <LoadingState texte="Chargement…" />}
      {donnees && (
        <table className="sess-table">
          <caption className="visually-hidden">Comptes ({donnees.comptes.length})</caption>
          <thead><tr><th scope="col">Personne</th><th scope="col">Rôle</th><th scope="col">Accès jusqu'au</th><th scope="col">Dernière connexion</th><th scope="col">État</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>{donnees.comptes.map((c) => (
            <tr key={c.id}>
              <td data-label="Personne" className="sess-table__principal">{c.nom || c.email}<span className="sess-secondaire"> {c.nom ? c.email : ""}</span></td>
              <td data-label="Rôle">{ROLES[c.role]?.[0] || c.role}</td>
              <td data-label="Accès jusqu'au">{date(c.expire_le)}</td>
              <td data-label="Dernière connexion">{c.derniere_connexion ? new Date(c.derniere_connexion).toLocaleDateString("fr-FR") : "Jamais"}</td>
              <td data-label="État">{c.actif ? <Badge ton="success">Actif</Badge> : <Badge>Désactivé</Badge>}</td>
              <td className="sess-table__actions"><Button compact onClick={() => { setSucces(null); setPanneau(c); }} aria-label={`Modifier ${c.email}`}>Modifier</Button></td>
            </tr>))}
          </tbody>
        </table>
      )}
      <section aria-labelledby="titre-journal">
        <h2 id="titre-journal">Journal des opérations sensibles</h2>
        <p className="sess-secondaire">Créations et modifications de comptes, exports, partages avec l'auditeur, opérations RGPD.</p>
        {journal?.length === 0 && <EmptyState titre="Aucune opération enregistrée">Le journal se remplit au fil des opérations sensibles.</EmptyState>}
        {journal?.length > 0 && (
          <ul className="pilotage-liste">{journal.map((j) => (
            <li key={j.id}><span className="pilotage-liste__date">{new Date(j.cree_le).toLocaleString("fr-FR")}</span> {j.par_nom || j.par_email || "Système"} — {j.evenement.replace(/_/g, " ")}{j.detail ? ` (${j.detail})` : ""}{j.cible_type ? ` · ${j.cible_type} ${j.cible_id ?? ""}` : ""}</li>
          ))}</ul>
        )}
      </section>
      {panneau && <PanneauCompte compte={panneau.id ? panneau : null} moi={moi} onFermer={() => setPanneau(null)} onEnregistre={(m) => { setPanneau(null); setSucces(m); charger(); }} />}
    </>
  );
}

function PanneauCompte({ compte, moi, onFermer, onEnregistre }) {
  const [v, setV] = useState({ email: compte?.email || "", nom: compte?.nom || "", role: compte?.role || "contributeur", expire_le: compte?.expire_le ? String(compte.expire_le).slice(0, 10) : "", actif: compte ? compte.actif : true });
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const soiMeme = compte?.id === moi?.id;
  async function enregistrer(e) {
    e.preventDefault(); setEnCours(true); setErreur(null);
    try {
      if (compte) {
        const corps = {};
        if (v.nom !== (compte.nom || "")) corps.nom = v.nom;
        if (v.role !== compte.role) corps.role = v.role;
        if (v.expire_le !== (compte.expire_le ? String(compte.expire_le).slice(0, 10) : "")) corps.expire_le = v.expire_le || null;
        if (v.actif !== compte.actif) corps.actif = v.actif;
        if (!Object.keys(corps).length) return onFermer();
        await api(`/api/comptes/${compte.id}`, { method: "PATCH", body: JSON.stringify(corps) });
        onEnregistre("Compte mis à jour.");
      } else {
        await api("/api/comptes", { method: "POST", body: JSON.stringify({ email: v.email, nom: v.nom || null, role: v.role, expire_le: v.expire_le || null }) });
        onEnregistre(`Compte ajouté : la personne peut se connecter avec ${v.email}.`);
      }
    } catch (err) { setErreur(err.message); setEnCours(false); }
  }
  const f = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return (
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} titre={compte ? "Modifier le compte" : "Ajouter un compte"}
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button><Button variante="primary" type="submit" form="form-compte" disabled={enCours}>Enregistrer</Button></>}>
      <form id="form-compte" onSubmit={enregistrer} noValidate className="ui-form">
        {erreur && <Alert ton="error">{erreur}</Alert>}
        {soiMeme && <Alert ton="info">C'est votre compte : vous ne pouvez pas réduire vos propres droits.</Alert>}
        <FormSection titre="Compte" colonnes={1}>
          <Field label="Adresse Google"><input type="email" value={v.email} onChange={f("email")} disabled={!!compte} maxLength={200} /></Field>
          <Field label="Nom" facultatif><input value={v.nom} onChange={f("nom")} maxLength={150} /></Field>
          <Field label="Rôle" aide={ROLES[v.role]?.[1]}><select value={v.role} onChange={f("role")} disabled={soiMeme}>{Object.entries(ROLES).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Accès jusqu'au" facultatif={v.role !== "auditeur"} aide={v.role === "auditeur" ? "Obligatoire pour un auditeur (90 jours au plus)." : "Laissez vide pour un accès permanent."}>
            <input type="date" value={v.expire_le} onChange={f("expire_le")} disabled={soiMeme} />
          </Field>
          {compte && <Checkbox label="Compte actif" checked={v.actif} disabled={soiMeme} onChange={(e) => setV({ ...v, actif: e.target.checked })} />}
        </FormSection>
      </form>
    </Drawer>
  );
}
