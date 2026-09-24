import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";

// /prescripteurs (admin) : petite liste administrative. Le code est
// l'identifiant stable stocké dans les inscriptions (jamais modifié) ;
// désactiver ne touche pas les inscriptions passées, le prescripteur n'est
// simplement plus proposé.
export function PrescripteursPage() {
  useTitrePage("Prescripteurs");
  const [prescripteurs, setPrescripteurs] = useState(null);
  const [err, setErr] = useState(null);
  const [erreurAction, setErreurAction] = useState(null);
  const [succes, setSucces] = useState(null);
  const [panneau, setPanneau] = useState(null); // { mode: "creation" } | { mode: "renommage", prescripteur }
  const [aDesactiver, setADesactiver] = useState(null);
  const [enCours, setEnCours] = useState(null); // id en cours de (dés)activation

  const charger = useCallback(async () => {
    try { setPrescripteurs((await api("/api/prescripteurs")).prescripteurs); setErr(null); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const ouvrir = (p) => { setSucces(null); setErreurAction(null); setPanneau(p); };
  const nouveau = <Button variante="primary" onClick={() => ouvrir({ mode: "creation" })}>+ Nouveau prescripteur</Button>;

  async function changerActif(p, actif) {
    setEnCours(p.id);
    setErreurAction(null); setSucces(null);
    try {
      if (actif) await api(`/api/prescripteurs/${p.id}`, { method: "PATCH", body: JSON.stringify({ actif: true }) });
      else await api(`/api/prescripteurs/${p.id}`, { method: "DELETE" });
      await charger();
      setSucces(actif ? `« ${p.nom} » est de nouveau proposé.` : `« ${p.nom} » est désactivé.`);
    } catch (e) {
      setErreurAction(e.message);
    } finally {
      setEnCours(null);
      setADesactiver(null);
    }
  }

  const actifs = prescripteurs?.filter((p) => p.actif).length ?? 0;

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Paramètres" }, { libelle: "Prescripteurs" }]}
        titre="Prescripteurs"
        description="Liste proposée lors de l'inscription d'un stagiaire. Désactiver un prescripteur ne modifie pas les inscriptions existantes."
        actions={prescripteurs?.length > 0 && nouveau}
      />
      {succes && <Alert ton="success">{succes}</Alert>}
      {erreurAction && <Alert ton="error" titre="L'action n'a pas abouti.">{erreurAction}</Alert>}
      {err && <Alert ton="error" titre="Les prescripteurs n'ont pas pu être chargés." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!prescripteurs && !err && <LoadingState texte="Chargement des prescripteurs…" />}

      {prescripteurs?.length === 0 && (
        <EmptyState titre="Aucun prescripteur" action={nouveau}>
          Le prescripteur reste facultatif à l'inscription. Ajoutez ceux que vous souhaitez proposer (France Travail, OPCO…).
        </EmptyState>
      )}

      {prescripteurs?.length > 0 && (
        <>
          <p className="sess-secondaire">{actifs} actif(s) sur {prescripteurs.length}</p>
          <table className="sess-table param-table">
            <caption className="visually-hidden">Prescripteurs ({prescripteurs.length})</caption>
            <thead>
              <tr>
                <th scope="col">Nom</th>
                <th scope="col">Code</th>
                <th scope="col">Statut</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {prescripteurs.map((p) => (
                <tr key={p.id} className={p.actif ? undefined : "sess-table__ligne--estompee"}>
                  <td data-label="Nom" className="sess-table__principal">{p.nom}</td>
                  <td data-label="Code"><code className="param-code">{p.code}</code></td>
                  <td data-label="Statut">{p.actif ? <Badge ton="success">Actif</Badge> : <Badge>Inactif</Badge>}</td>
                  <td className="sess-table__actions">
                    <Button compact aria-label={`Renommer ${p.nom}`} onClick={() => ouvrir({ mode: "renommage", prescripteur: p })}>Renommer</Button>
                    {p.actif
                      ? <Button compact variante="danger" aria-label={`Désactiver ${p.nom}`} disabled={enCours === p.id}
                          onClick={() => { setSucces(null); setErreurAction(null); setADesactiver(p); }}>Désactiver</Button>
                      : <Button compact aria-label={`Réactiver ${p.nom}`} disabled={enCours === p.id}
                          onClick={() => changerActif(p, true)}>{enCours === p.id ? "Réactivation…" : "Réactiver"}</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <PanneauPrescripteur
        panneau={panneau} onFermer={() => setPanneau(null)}
        onEnregistre={async (message) => { setPanneau(null); await charger(); setSucces(message); }}
      />

      <ConfirmDialog
        ouvert={!!aDesactiver} titre="Désactiver ce prescripteur ?" libelleConfirmer="Désactiver"
        enCours={enCours === aDesactiver?.id}
        onConfirmer={() => changerActif(aDesactiver, false)} onAnnuler={() => setADesactiver(null)}
      >
        <p>« {aDesactiver?.nom} » ne sera plus proposé aux nouvelles inscriptions.</p>
        <p>Les inscriptions existantes le conservent. Vous pourrez le réactiver à tout moment.</p>
      </ConfirmDialog>
    </>
  );
}

function PanneauPrescripteur({ panneau, onFermer, onEnregistre }) {
  const renommage = panneau?.mode === "renommage";
  const [nom, setNom] = useState("");
  const [erreur, setErreur] = useState(null);
  const [erreurServeur, setErreurServeur] = useState(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!panneau) return;
    setNom(panneau.prescripteur?.nom || "");
    setErreur(null); setErreurServeur(null); setEnCours(false);
  }, [panneau]);

  async function enregistrer(e) {
    e.preventDefault();
    if (!nom.trim()) { setErreur("Indiquez un nom."); return; }
    setErreur(null); setErreurServeur(null); setEnCours(true);
    try {
      if (renommage) {
        await api(`/api/prescripteurs/${panneau.prescripteur.id}`, { method: "PATCH", body: JSON.stringify({ nom }) });
        await onEnregistre(`Prescripteur renommé en « ${nom.trim()} ».`);
      } else {
        await api("/api/prescripteurs", { method: "POST", body: JSON.stringify({ nom }) });
        await onEnregistre(`Prescripteur « ${nom.trim()} » ajouté.`);
      }
    } catch (err) {
      setErreurServeur(err.message);
      setEnCours(false);
    }
  }

  return (
    <Drawer
      ouvert={!!panneau} onFermer={onFermer} fermable={!enCours} taille="etroit"
      titre={renommage ? "Renommer le prescripteur" : "Nouveau prescripteur"}
      description={renommage
        ? `Le code « ${panneau.prescripteur.code} » ne change pas : les inscriptions existantes restent rattachées.`
        : "Le code est déduit du nom à la création, puis ne change plus."}
      pied={
        <>
          <Button onClick={onFermer} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-prescripteur" disabled={enCours}>
            {enCours ? "Enregistrement…" : renommage ? "Enregistrer" : "Ajouter"}
          </Button>
        </>
      }
    >
      <form id="form-prescripteur" onSubmit={enregistrer} noValidate>
        {erreurServeur && <Alert ton="error" titre="Le prescripteur n'a pas été enregistré.">{erreurServeur}</Alert>}
        <Field label="Nom" erreur={erreur}>
          <input value={nom} onChange={(e) => setNom(e.target.value)} required />
        </Field>
      </form>
    </Drawer>
  );
}
