import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";

export const MODALITES = { presentiel: "Présentiel", distanciel: "Distanciel", mixte: "Mixte" };
const VIDE = { intitule: "", code_interne: "", duree_heures_defaut: "", modalite: "presentiel", tarif_ht: "" };

// Nombre saisi (virgule acceptée) : vide, ou positif. Le serveur reste juge.
function nombreInvalide(v) {
  if (v === "" || v === null || v === undefined) return false;
  const n = Number(String(v).replace(",", "."));
  return !Number.isFinite(n) || n < 0;
}
const heures = (v) => (v === null || v === undefined || v === "" ? null : `${Number(v).toLocaleString("fr-FR")} h`);
const euros = (v) => (v === null || v === undefined || v === "" ? null
  : Number(v).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) + " HT");

// /formations (admin) : le catalogue d'abord ; création et révision dans un
// panneau. Réviser une formation crée une NOUVELLE version côté serveur :
// les sessions existantes gardent la leur (règle métier inchangée).
export function FormationsPage() {
  useTitrePage("Formations");
  const [formations, setFormations] = useState(null);
  const [err, setErr] = useState(null);
  const [panneau, setPanneau] = useState(null); // { mode: "creation" } | { mode: "revision", formation }
  const [succes, setSucces] = useState(null);

  const charger = useCallback(async () => {
    try { setFormations((await api("/api/formations")).formations); setErr(null); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const nouvelle = <Button variante="primary" onClick={() => { setSucces(null); setPanneau({ mode: "creation" }); }}>+ Nouvelle formation</Button>;

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Formation" }, { libelle: "Formations" }]}
        titre="Formations"
        description="Catalogue des formations. Réviser une formation crée une nouvelle version ; les sessions existantes gardent la leur."
        actions={formations?.length > 0 && nouvelle}
      />
      {succes && <Alert ton="success">{succes}</Alert>}
      {err && <Alert ton="error" titre="Les formations n'ont pas pu être chargées." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!formations && !err && <LoadingState texte="Chargement des formations…" />}

      {formations?.length === 0 && (
        <EmptyState titre="Aucune formation" action={nouvelle}>
          Une session se crée toujours à partir d'une formation du catalogue : commencez par en créer une.
        </EmptyState>
      )}

      {formations?.length > 0 && (
        <table className="sess-table param-table">
          <caption className="visually-hidden">Formations ({formations.length})</caption>
          <thead>
            <tr>
              <th scope="col">Formation</th>
              <th scope="col">Version</th>
              <th scope="col">Durée par défaut</th>
              <th scope="col">Modalité</th>
              <th scope="col">Tarif</th>
              <th scope="col" className="sess-num">Sessions</th>
              <th scope="col"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {formations.map((f) => (
              <tr key={f.id} className={f.actif === false ? "sess-table__ligne--estompee" : undefined}>
                <td data-label="Formation" className="sess-table__principal">
                  {f.intitule}
                  {f.code_interne && <span className="sess-secondaire">Code {f.code_interne}</span>}
                  {f.actif === false && <span className="param-statut"><Badge>Inactive</Badge></span>}
                </td>
                <td data-label="Version">
                  Version {f.version_numero || "—"}
                  {f.nb_versions > 1 && <span className="sess-secondaire">{f.nb_versions} versions au total</span>}
                </td>
                <td data-label="Durée par défaut">{heures(f.duree_heures_defaut) || "—"}</td>
                <td data-label="Modalité">{MODALITES[f.modalite] || "—"}</td>
                <td data-label="Tarif">{euros(f.tarif_ht) || "—"}</td>
                <td data-label="Sessions" className="sess-num">{f.nb_sessions ?? 0}</td>
                <td className="sess-table__actions">
                  <Button compact aria-label={`Réviser la formation ${f.intitule}`}
                    onClick={() => { setSucces(null); setPanneau({ mode: "revision", formation: f }); }}>
                    Réviser
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <PanneauFormation
        panneau={panneau}
        onFermer={() => setPanneau(null)}
        onEnregistree={async (message) => { setPanneau(null); setSucces(message); await charger(); }}
      />
    </>
  );
}

function PanneauFormation({ panneau, onFermer, onEnregistree }) {
  const revision = panneau?.mode === "revision";
  const [valeurs, setValeurs] = useState(VIDE);
  const [erreurs, setErreurs] = useState({});
  const [erreurServeur, setErreurServeur] = useState(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!panneau) return;
    const f = panneau.formation;
    // Révision : on part de TOUTE la version courante (objectifs, public…),
    // pour que la nouvelle version ne perde aucun champ non affiché ici.
    setValeurs(f ? { ...f, code_interne: f.code_interne || "", duree_heures_defaut: f.duree_heures_defaut ?? "", tarif_ht: f.tarif_ht ?? "", modalite: f.modalite || "presentiel" } : VIDE);
    setErreurs({}); setErreurServeur(null); setEnCours(false);
  }, [panneau]);

  const champ = (cle) => (e) => setValeurs({ ...valeurs, [cle]: e.target.value });

  async function enregistrer(e) {
    e.preventDefault();
    const trouvees = {};
    if (!String(valeurs.intitule || "").trim()) trouvees.intitule = "Indiquez l'intitulé de la formation.";
    if (nombreInvalide(valeurs.duree_heures_defaut)) trouvees.duree_heures_defaut = "Indiquez un nombre d'heures positif.";
    if (nombreInvalide(valeurs.tarif_ht)) trouvees.tarif_ht = "Indiquez un montant positif.";
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    setEnCours(true);
    setErreurServeur(null);
    const corps = {
      ...valeurs,
      duree_heures_defaut: valeurs.duree_heures_defaut === "" ? null : String(valeurs.duree_heures_defaut).replace(",", "."),
      tarif_ht: valeurs.tarif_ht === "" ? null : String(valeurs.tarif_ht).replace(",", "."),
    };
    try {
      if (revision) {
        await api(`/api/formations/${panneau.formation.id}`, { method: "PUT", body: JSON.stringify(corps) });
        await onEnregistree(`« ${corps.intitule.trim()} » : nouvelle version enregistrée.`);
      } else {
        await api("/api/formations", { method: "POST", body: JSON.stringify(corps) });
        await onEnregistree(`Formation « ${corps.intitule.trim()} » créée.`);
      }
    } catch (err) {
      setErreurServeur(err.message);
      setEnCours(false);
    }
  }

  const f = panneau?.formation;
  return (
    <Drawer
      ouvert={!!panneau} onFermer={onFermer} fermable={!enCours}
      titre={revision ? "Réviser la formation" : "Nouvelle formation"}
      description={revision ? f.intitule : "La formation est créée avec sa première version."}
      pied={
        <>
          <Button onClick={onFermer} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-formation" disabled={enCours}>
            {enCours ? "Enregistrement…" : revision ? "Enregistrer la nouvelle version" : "Créer la formation"}
          </Button>
        </>
      }
    >
      <form id="form-formation" onSubmit={enregistrer} noValidate>
        {revision && (
          <Alert ton="info" titre={`Enregistrer créera la version ${(Number(f.version_numero) || 0) + 1}.`}>
            Les sessions déjà créées gardent la version {f.version_numero || "actuelle"}.
          </Alert>
        )}
        {erreurServeur && <Alert ton="error" titre="La formation n'a pas été enregistrée.">{erreurServeur}</Alert>}
        <FormSection titre="Identité">
          <Field label="Intitulé" erreur={erreurs.intitule} className="ui-field--large">
            <input value={valeurs.intitule || ""} onChange={champ("intitule")} required />
          </Field>
          <Field label="Code interne" facultatif>
            <input value={valeurs.code_interne} onChange={champ("code_interne")} />
          </Field>
        </FormSection>
        <FormSection titre="Paramètres">
          <Field label="Durée par défaut (heures)" facultatif erreur={erreurs.duree_heures_defaut}>
            <input type="number" inputMode="decimal" min="0" step="0.5" value={valeurs.duree_heures_defaut} onChange={champ("duree_heures_defaut")} />
          </Field>
          <Field label="Modalité">
            <select value={valeurs.modalite} onChange={champ("modalite")}>
              {Object.entries(MODALITES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Tarif (€ HT)" facultatif erreur={erreurs.tarif_ht}>
            <input type="number" inputMode="decimal" min="0" step="0.01" value={valeurs.tarif_ht} onChange={champ("tarif_ht")} />
          </Field>
        </FormSection>
        <p className="ui-field__aide">
          Programme, scénario pédagogique et compétences visées : à rattacher comme preuves
          (indicateurs 5 et 6) plutôt qu'à saisir ici.
        </p>
      </form>
    </Drawer>
  );
}
