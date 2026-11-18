import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";

// /parametres/organisme (admin) : coordonnées de l'organisme et signataires des documents.
// Ces valeurs alimentent les variables {{organisme_*}} et {{signataire_*}} : elles ne sont plus
// écrites en dur dans les modèles. Un signataire n'est jamais supprimé (les documents déjà
// générés l'ont cité) : il est désactivé.

export const CHAMPS_ORGANISME = [
  ["nom", "Nom de l'organisme", "Association Deuxième Chance"],
  ["adresse_ligne1", "Adresse – ligne 1", "21, rue des Zagrinettes"],
  ["adresse_ligne2", "Adresse – ligne 2", "Cité Manguier"],
  ["code_postal", "Code postal", "97300"],
  ["ville", "Ville", "Cayenne"],
  ["telephone", "Téléphone fixe", "05 94 00 00 00"],
  ["mobile", "Téléphone mobile", "06 94 00 00 00"],
  ["email", "E-mail", "contact@exemple.fr"],
  ["siret", "SIRET", "123 456 789 00010"],
  ["nda", "Numéro de déclaration d'activité", "03 97 30 00 000"],
  ["site_web", "Site web", "https://www.exemple.fr"],
  ["referent_handicap_nom", "Référent handicap", "Prénom Nom"],
  ["referent_handicap_email", "E-mail du référent handicap", "handicap@exemple.fr"],
  ["referent_handicap_telephone", "Téléphone du référent handicap", "06 94 00 00 00"],
];
const VIDE = Object.fromEntries(CHAMPS_ORGANISME.map(([cle]) => [cle, ""]));

function CoordonneesOrganisme() {
  const [valeurs, setValeurs] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [succes, setSucces] = useState(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    let actif = true;
    api("/api/parametres/organisme")
      .then((r) => { if (actif) setValeurs({ ...VIDE, ...Object.fromEntries(Object.entries(r.organisme || {}).filter(([k, v]) => k in VIDE && v != null)) }); })
      .catch((e) => { if (actif) setErreur(e.message); });
    return () => { actif = false; };
  }, []);

  async function enregistrer(e) {
    e.preventDefault();
    setEnCours(true); setErreur(null); setSucces(null);
    try {
      await api("/api/parametres/organisme", { method: "PUT", body: JSON.stringify(valeurs) });
      setSucces("Coordonnées enregistrées. Elles servent aux prochains documents générés.");
    } catch (err) { setErreur(err.message); } finally { setEnCours(false); }
  }

  if (!valeurs) return erreur ? <Alert ton="error" titre="Les coordonnées n'ont pas pu être chargées.">{erreur}</Alert> : <LoadingState texte="Chargement des coordonnées…" />;
  return (
    <section className="param-section" aria-labelledby="titre-coordonnees">
      <h2 id="titre-coordonnees" className="param-section__titre">Coordonnées de l'organisme</h2>
      <p className="sess-secondaire">Variables {"{{organisme_*}}"} des documents. Un champ laissé vide reste vide dans le document ; le nom de l'organisme retombe sur la configuration du serveur tant qu'il n'est pas saisi.</p>
      {succes && <Alert ton="success">{succes}</Alert>}
      {erreur && <Alert ton="error" titre="Les coordonnées n'ont pas été enregistrées.">{erreur}</Alert>}
      <form onSubmit={enregistrer} noValidate>
        <FormSection titre="Identité et adresse" colonnes={2}>
          {CHAMPS_ORGANISME.map(([cle, libelle, exemple]) => (
            <Field key={cle} label={libelle} facultatif>
              <input value={valeurs[cle]} placeholder={exemple} maxLength={200}
                type={cle.endsWith("email") ? "email" : ["telephone", "mobile", "referent_handicap_telephone"].includes(cle) ? "tel" : cle === "site_web" ? "url" : "text"}
                onChange={(e) => { setSucces(null); setValeurs({ ...valeurs, [cle]: e.target.value }); }} />
            </Field>
          ))}
        </FormSection>
        <Button variante="primary" type="submit" disabled={enCours}>{enCours ? "Enregistrement…" : "Enregistrer les coordonnées"}</Button>
      </form>
    </section>
  );
}

function PanneauSignataire({ panneau, onFermer, onEnregistre }) {
  const modification = panneau?.mode === "modification";
  const [nom, setNom] = useState("");
  const [fonction, setFonction] = useState("");
  const [erreurs, setErreurs] = useState({});
  const [erreurServeur, setErreurServeur] = useState(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!panneau) return;
    setNom(panneau.signataire?.nom || ""); setFonction(panneau.signataire?.fonction || "");
    setErreurs({}); setErreurServeur(null); setEnCours(false);
  }, [panneau]);

  async function enregistrer(e) {
    e.preventDefault();
    const trouvees = {};
    if (!nom.trim()) trouvees.nom = "Indiquez le nom.";
    if (!fonction.trim()) trouvees.fonction = "Indiquez la fonction.";
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    setEnCours(true); setErreurServeur(null);
    try {
      if (modification) await api(`/api/signataires/${panneau.signataire.id}`, { method: "PATCH", body: JSON.stringify({ nom, fonction }) });
      else await api("/api/signataires", { method: "POST", body: JSON.stringify({ nom, fonction }) });
      await onEnregistre(modification ? "Signataire modifié." : `Signataire « ${nom.trim()} » ajouté.`);
    } catch (err) { setErreurServeur(err.message); setEnCours(false); }
  }

  return (
    <Drawer
      ouvert={!!panneau} onFermer={onFermer} fermable={!enCours} taille="etroit"
      titre={modification ? "Modifier le signataire" : "Nouveau signataire"}
      description="Le nom et la fonction s'affichent tels quels dans les documents qui utilisent ce signataire."
      pied={(
        <>
          <Button onClick={onFermer} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-signataire" disabled={enCours}>{enCours ? "Enregistrement…" : "Enregistrer"}</Button>
        </>
      )}
    >
      <form id="form-signataire" onSubmit={enregistrer} noValidate>
        {erreurServeur && <Alert ton="error" titre="Le signataire n'a pas été enregistré.">{erreurServeur}</Alert>}
        <Field label="Nom" erreur={erreurs.nom}><input value={nom} maxLength={120} onChange={(e) => setNom(e.target.value)} required /></Field>
        <Field label="Fonction" erreur={erreurs.fonction}><input value={fonction} maxLength={120} placeholder="Ex. Présidente" onChange={(e) => setFonction(e.target.value)} required /></Field>
      </form>
    </Drawer>
  );
}

function Signataires() {
  const [signataires, setSignataires] = useState(null);
  const [err, setErr] = useState(null);
  const [erreurAction, setErreurAction] = useState(null);
  const [succes, setSucces] = useState(null);
  const [panneau, setPanneau] = useState(null);
  const [aDesactiver, setADesactiver] = useState(null);
  const [enCours, setEnCours] = useState(null);

  const charger = useCallback(async () => {
    try { setSignataires((await api("/api/signataires?inactifs=1")).signataires); setErr(null); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  async function changerActif(s, actif) {
    setEnCours(s.id); setErreurAction(null); setSucces(null);
    try {
      await api(`/api/signataires/${s.id}`, { method: "PATCH", body: JSON.stringify({ actif }) });
      await charger();
      setSucces(actif ? `« ${s.nom} » est de nouveau proposé.` : `« ${s.nom} » est désactivé.`);
    } catch (e) { setErreurAction(e.message); } finally { setEnCours(null); setADesactiver(null); }
  }

  const ouvrir = (p) => { setSucces(null); setErreurAction(null); setPanneau(p); };
  const nouveau = <Button variante="primary" onClick={() => ouvrir({ mode: "creation" })}>+ Nouveau signataire</Button>;
  return (
    <section className="param-section" aria-labelledby="titre-signataires">
      <div className="sess-section__tete">
        <div>
          <h2 id="titre-signataires" className="param-section__titre">Signataires</h2>
          <p className="sess-secondaire">Le signataire se choisit pour chaque modèle (Paramètres → Modèles de documents) : un signataire fixe, ou le formateur concerné par la session ou le groupe.</p>
        </div>
        {signataires?.length > 0 && nouveau}
      </div>
      {succes && <Alert ton="success">{succes}</Alert>}
      {erreurAction && <Alert ton="error" titre="L'action n'a pas abouti.">{erreurAction}</Alert>}
      {err && <Alert ton="error" titre="Les signataires n'ont pas pu être chargés." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!signataires && !err && <LoadingState texte="Chargement des signataires…" />}
      {signataires?.length === 0 && (
        <EmptyState titre="Aucun signataire" action={nouveau}>Ajoutez par exemple la présidente et la référente Qualiopi.</EmptyState>
      )}
      {signataires?.length > 0 && (
        <table className="sess-table param-table">
          <caption className="visually-hidden">Signataires ({signataires.length})</caption>
          <thead><tr><th scope="col">Nom</th><th scope="col">Fonction</th><th scope="col">Statut</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {signataires.map((s) => (
              <tr key={s.id} className={s.actif ? undefined : "sess-table__ligne--estompee"}>
                <td data-label="Nom" className="sess-table__principal">{s.nom}</td>
                <td data-label="Fonction">{s.fonction}</td>
                <td data-label="Statut">{s.actif ? <Badge ton="success">Actif</Badge> : <Badge>Désactivé</Badge>}</td>
                <td className="sess-table__actions">
                  <Button compact aria-label={`Modifier ${s.nom}`} onClick={() => ouvrir({ mode: "modification", signataire: s })}>Modifier</Button>
                  {s.actif
                    ? <Button compact variante="danger" aria-label={`Désactiver ${s.nom}`} disabled={enCours === s.id} onClick={() => { setSucces(null); setErreurAction(null); setADesactiver(s); }}>Désactiver</Button>
                    : <Button compact aria-label={`Réactiver ${s.nom}`} disabled={enCours === s.id} onClick={() => changerActif(s, true)}>Réactiver</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <PanneauSignataire panneau={panneau} onFermer={() => setPanneau(null)} onEnregistre={async (m) => { setPanneau(null); await charger(); setSucces(m); }} />
      <ConfirmDialog
        ouvert={!!aDesactiver} titre="Désactiver ce signataire ?" libelleConfirmer="Désactiver"
        enCours={enCours === aDesactiver?.id}
        onConfirmer={() => changerActif(aDesactiver, false)} onAnnuler={() => setADesactiver(null)}
      >
        <p>« {aDesactiver?.nom} » ne sera plus proposé pour les modèles. Les documents déjà générés ne changent pas.</p>
        <p>Si un modèle l'utilise encore, la désactivation est refusée : changez d'abord le signataire du modèle.</p>
      </ConfirmDialog>
    </section>
  );
}

export function OrganismePage() {
  useTitrePage("Organisme et signataires");
  return (
    <>
      <PageHeader
        fil={[{ libelle: "Paramètres" }, { libelle: "Organisme et signataires" }]}
        titre="Organisme et signataires"
        description="Coordonnées et signataires utilisés dans les documents générés. Rien n'est écrit en dur dans les modèles."
      />
      <CoordonneesOrganisme />
      <Signataires />
    </>
  );
}
