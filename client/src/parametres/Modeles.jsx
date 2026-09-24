import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Button, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { SelecteurIndicateurs } from "../veille/SelecteurIndicateurs.jsx";

export const PORTEES = {
  formation: { court: "Par formation", long: "Un document par formation" },
  session: { court: "Par session", long: "Un document par session" },
  groupe: { court: "Par groupe", long: "Un document par groupe" },
  stagiaire: { court: "Par stagiaire", long: "Un document par stagiaire" },
};
const TYPES_FICHIER = {
  "application/vnd.google-apps.document": "Google Docs",
  "application/vnd.google-apps.spreadsheet": "Google Sheets",
};
const VIDE = { nom: "", lien: "", portee: "stagiaire", description: "", indicateur_ids: [] };

// Lien externe rendu seulement s'il est http(s). // fix
export const lienSur = (url) => (typeof url === "string" && /^https?:\/\//i.test(url) ? url : null);

function LienDrive({ url, nom }) {
  const href = lienSur(url);
  if (!href) return <span className="sess-secondaire">—</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir le fichier du modèle ${nom} sur Google Drive (nouvel onglet)`}>
      Ouvrir sur le Drive
    </a>
  );
}

// /modeles (admin) : liste compacte d'abord ; détail, création et marqueurs
// dans des panneaux. Un modèle se crée ou se retire (pas de modification
// côté serveur) ; le retrait ne touche pas les documents déjà générés.
export function ModelesPage() {
  useTitrePage("Modèles de documents");
  const [donnees, setDonnees] = useState(null);
  const [err, setErr] = useState(null);
  const [criteres, setCriteres] = useState(null);
  const [succes, setSucces] = useState(null);
  const [erreurAction, setErreurAction] = useState(null);
  const [creation, setCreation] = useState(false);
  const [detail, setDetail] = useState(null);
  const [marqueursOuverts, setMarqueursOuverts] = useState(false);
  const [aRetirer, setARetirer] = useState(null);
  const [retrait, setRetrait] = useState(false);

  const charger = useCallback(async () => {
    try {
      const r = await api("/api/modeles");
      setDonnees({ modeles: r.modeles || [], marqueurs: r.marqueurs || [] });
      setErr(null);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => {
    api("/api/referentiel").then((r) => setCriteres(r.criteres || [])).catch(() => setCriteres([]));
  }, []);

  // Libellés des indicateurs du référentiel actif, pour le détail.
  const libelles = new Map((criteres || []).flatMap((c) => c.indicateurs || []).map((i) => [i.numero, i.libelle]));

  async function retirer() {
    setRetrait(true);
    setErreurAction(null);
    try {
      await api(`/api/modeles/${aRetirer.id}`, { method: "DELETE" });
      const nom = aRetirer.nom;
      setARetirer(null); setDetail(null);
      await charger();
      setSucces(`Modèle « ${nom} » retiré.`);
    } catch (e) {
      setErreurAction(e.message);
      setARetirer(null);
    } finally {
      setRetrait(false);
    }
  }

  const modeles = donnees?.modeles;
  const nouveau = <Button variante="primary" onClick={() => { setSucces(null); setErreurAction(null); setCreation(true); }}>+ Nouveau modèle</Button>;

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Paramètres" }, { libelle: "Modèles de documents" }]}
        titre="Modèles de documents"
        description="Un modèle est un Google Doc ou Sheet existant sur le Drive. La génération en fait une copie et y remplace les marqueurs ; le modèle d'origine n'est jamais modifié."
        actions={donnees && (
          <>
            {donnees.marqueurs.length > 0 && <Button onClick={() => setMarqueursOuverts(true)}>Marqueurs reconnus</Button>}
            {modeles.length > 0 && nouveau}
          </>
        )}
      />
      {succes && <Alert ton="success">{succes}</Alert>}
      {erreurAction && <Alert ton="error" titre="Le modèle n'a pas été retiré.">{erreurAction}</Alert>}
      {err && <Alert ton="error" titre="Les modèles n'ont pas pu être chargés." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!donnees && !err && <LoadingState texte="Chargement des modèles…" />}

      {modeles?.length === 0 && (
        <EmptyState titre="Aucun modèle" action={nouveau}>
          Enregistrez un Google Doc ou Sheet du Drive (convocation, attestation, émargement…) pour générer des documents depuis les sessions.
        </EmptyState>
      )}

      {modeles?.length > 0 && (
        <table className="sess-table param-table">
          <caption className="visually-hidden">Modèles de documents ({modeles.length})</caption>
          <thead>
            <tr>
              <th scope="col">Modèle</th>
              <th scope="col">Usage</th>
              <th scope="col">Indicateurs</th>
              <th scope="col">Fichier Google</th>
              <th scope="col"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {modeles.map((m) => (
              <tr key={m.id}>
                <td data-label="Modèle" className="sess-table__principal">
                  <button type="button" className="param-lien-bouton" onClick={() => setDetail(m)}>{m.nom}</button>
                  {m.description && <span className="sess-secondaire param-tronque">{m.description}</span>}
                </td>
                <td data-label="Usage">{PORTEES[m.portee]?.court || m.portee}</td>
                <td data-label="Indicateurs">
                  {(m.indicateurs || []).length ? `Ind. ${m.indicateurs.map((i) => i.numero).join(", ")}` : "—"}
                </td>
                <td data-label="Fichier Google">
                  <LienDrive url={m.drive_url} nom={m.nom} />
                  {TYPES_FICHIER[m.drive_mime] && <span className="sess-secondaire">{TYPES_FICHIER[m.drive_mime]}</span>}
                </td>
                <td className="sess-table__actions">
                  <Button compact aria-label={`Voir le détail du modèle ${m.nom}`} onClick={() => setDetail(m)}>Détail</Button>
                  <Button compact variante="danger" aria-label={`Retirer le modèle ${m.nom}`}
                    onClick={() => { setSucces(null); setErreurAction(null); setARetirer(m); }}>Retirer</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Drawer ouvert={!!detail} onFermer={() => setDetail(null)} titre={detail?.nom || ""}
        description={detail ? PORTEES[detail.portee]?.long : undefined}
        pied={detail && (
          <>
            <Button variante="danger" onClick={() => setARetirer(detail)}>Retirer ce modèle</Button>
            <Button onClick={() => setDetail(null)}>Fermer</Button>
          </>
        )}>
        {detail && (
          <dl className="param-detail">
            <div><dt>Description</dt><dd>{detail.description || <span className="sess-secondaire">Aucune description</span>}</dd></div>
            <div><dt>Fichier Google</dt><dd><LienDrive url={detail.drive_url} nom={detail.nom} />{TYPES_FICHIER[detail.drive_mime] && <> · {TYPES_FICHIER[detail.drive_mime]}</>}</dd></div>
            <div>
              <dt>Indicateurs liés</dt>
              <dd>
                <ul className="param-indicateurs">
                  {(detail.indicateurs || []).map((i) => (
                    <li key={i.id}><strong>Indicateur {i.numero}</strong>{libelles.get(i.numero) && <> — {libelles.get(i.numero)}</>}</li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
        )}
      </Drawer>

      <Drawer ouvert={marqueursOuverts} onFermer={() => setMarqueursOuverts(false)} titre="Marqueurs reconnus"
        description="Écrivez-les tels quels dans le modèle. Un marqueur absent de cette liste n'est pas remplacé et restera visible dans le document produit.">
        <ul className="param-marqueurs">
          {(donnees?.marqueurs || []).map((m) => <li key={m}><code>{"{{" + m + "}}"}</code></li>)}
        </ul>
      </Drawer>

      <CreationModele
        ouvert={creation} criteres={criteres} onFermer={() => setCreation(false)}
        onCree={async (nom) => { setCreation(false); await charger(); setSucces(`Modèle « ${nom} » enregistré.`); }}
      />

      <ConfirmDialog
        ouvert={!!aRetirer} titre="Retirer ce modèle ?" libelleConfirmer="Retirer" enCours={retrait}
        onConfirmer={retirer} onAnnuler={() => setARetirer(null)}
      >
        <p>« {aRetirer?.nom} » ne sera plus proposé à la génération.</p>
        <p>Les documents déjà générés ne sont pas touchés, et le fichier reste sur le Drive.</p>
      </ConfirmDialog>
    </>
  );
}

function CreationModele({ ouvert, criteres, onFermer, onCree }) {
  const [valeurs, setValeurs] = useState(VIDE);
  const [erreurs, setErreurs] = useState({});
  const [erreurServeur, setErreurServeur] = useState(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    setValeurs(VIDE); setErreurs({}); setErreurServeur(null); setEnCours(false);
  }, [ouvert]);

  const champ = (cle) => (e) => setValeurs({ ...valeurs, [cle]: e.target.value });

  async function enregistrer(e) {
    e.preventDefault();
    // L'API attend des NUMÉROS d'indicateurs ; le sélecteur manipule des identifiants.
    const parId = new Map((criteres || []).flatMap((c) => c.indicateurs || []).map((i) => [i.id, i.numero]));
    const numeros = valeurs.indicateur_ids.map((id) => parId.get(Number(id))).filter(Boolean).sort((a, b) => a - b);
    const trouvees = {};
    if (!valeurs.nom.trim()) trouvees.nom = "Donnez un nom au modèle.";
    if (!valeurs.lien.trim()) trouvees.lien = "Collez le lien ou l'identifiant du fichier Drive.";
    if (!numeros.length) trouvees.indicateurs = "Sélectionnez au moins un indicateur.";
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    setEnCours(true);
    setErreurServeur(null);
    try {
      await api("/api/modeles", {
        method: "POST",
        body: JSON.stringify({ nom: valeurs.nom, lien: valeurs.lien, portee: valeurs.portee, description: valeurs.description, indicateurs: numeros }),
      });
      await onCree(valeurs.nom.trim());
    } catch (err) {
      setErreurServeur(err.message);
      setEnCours(false);
    }
  }

  return (
    <Drawer
      ouvert={ouvert} onFermer={onFermer} fermable={!enCours} taille="large"
      titre="Nouveau modèle"
      description="Le fichier doit déjà exister sur le Drive de l'organisme."
      pied={
        <>
          <Button onClick={onFermer} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-modele" disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer le modèle"}
          </Button>
        </>
      }
    >
      <form id="form-modele" onSubmit={enregistrer} noValidate>
        {erreurServeur && <Alert ton="error" titre="Le modèle n'a pas été enregistré.">{erreurServeur}</Alert>}
        <FormSection titre="Modèle">
          <Field label="Nom" erreur={erreurs.nom}>
            <input value={valeurs.nom} onChange={champ("nom")} placeholder="Convocation" required />
          </Field>
          <Field label="Usage">
            <select value={valeurs.portee} onChange={champ("portee")}>
              {Object.entries(PORTEES).map(([v, p]) => <option key={v} value={v}>{p.long}</option>)}
            </select>
          </Field>
          <Field label="Lien ou identifiant du fichier Drive" erreur={erreurs.lien} className="ui-field--large"
            aide="Copiez l'adresse du Google Doc ou Sheet depuis la barre du navigateur.">
            <input value={valeurs.lien} onChange={champ("lien")} placeholder="https://docs.google.com/document/d/…/edit" required />
          </Field>
          <Field label="Description" facultatif className="ui-field--large">
            <input value={valeurs.description} onChange={champ("description")} />
          </Field>
        </FormSection>
        <div className="param-selecteur">
          {criteres === null
            ? <LoadingState texte="Chargement des indicateurs…" />
            : <SelecteurIndicateurs criteres={criteres} valeur={valeurs.indicateur_ids} label="Indicateurs Qualiopi prouvés par ce document"
                onChange={(ids) => setValeurs({ ...valeurs, indicateur_ids: ids })} />}
          {erreurs.indicateurs && <p className="ui-field__erreur" role="alert">{erreurs.indicateurs}</p>}
        </div>
      </form>
    </Drawer>
  );
}
