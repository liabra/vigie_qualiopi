import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { ETATS_JEUNES, etatJeune, nomComplet } from "./format.js";

const VIDE = { civilite: "", nom: "", prenom: "", email: "", telephone: "" };

// DOC-9D1 — Accueil des jeunes : enregistrer, retrouver et gérer les jeunes
// AVANT leur inscription à une formation. Aucune donnée médicale ni de
// handicap n'est affichée ni collectée.
export function JeunesPage({ admin }) {
  useTitrePage("Jeunes");
  const [jeunes, setJeunes] = useState(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [etat, setEtat] = useState("tous");
  const [err, setErr] = useState(null);
  const [succes, setSucces] = useState(null);
  const [erreurAction, setErreurAction] = useState(null);
  const [panneau, setPanneau] = useState(false);
  const [aSupprimer, setASupprimer] = useState(null);
  const [enCours, setEnCours] = useState(null); // id en cours d'action

  const charger = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (etat !== "tous") params.set("etat", etat);
      if (q.trim().length >= 2) params.set("q", q.trim());
      const suffixe = params.toString();
      const r = await api(`/api/stagiaires${suffixe ? `?${suffixe}` : ""}`);
      setJeunes(r.stagiaires); setTotal(r.total); setErr(null);
    } catch (e) { setErr(e.message); }
  }, [q, etat]);
  useEffect(() => { charger(); }, [charger]);

  async function changerCycle(j, action) {
    setEnCours(j.id); setSucces(null); setErreurAction(null);
    try {
      await api(`/api/stagiaires/${j.id}/${action}`, { method: "POST" });
      await charger();
      setSucces(action === "sans-suite" ? `« ${nomComplet(j)} » est classé sans suite.` : `« ${nomComplet(j)} » est rouvert.`);
    } catch (e) { setErreurAction(e.message); }
    finally { setEnCours(null); }
  }

  async function supprimer(j) {
    setEnCours(j.id); setSucces(null); setErreurAction(null);
    try {
      await api(`/api/stagiaires/${j.id}`, { method: "DELETE" });
      setASupprimer(null);
      await charger();
      setSucces(`Le dossier de ${nomComplet(j)} a été supprimé.`);
    } catch (e) { setErreurAction(e.message); }
    finally { setEnCours(null); }
  }

  const ajouter = <Button variante="primary" onClick={() => { setSucces(null); setErreurAction(null); setPanneau(true); }}>+ Ajouter un jeune</Button>;

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Formation" }, { libelle: "Jeunes" }]}
        titre="Jeunes"
        description="Enregistrez et retrouvez les jeunes avant leur inscription à une formation. Les entretiens restent des brouillons tant qu'ils ne sont pas validés."
        actions={ajouter}
      />
      {succes && <Alert ton="success">{succes}</Alert>}
      {erreurAction && <Alert ton="error" titre="L'action n'a pas abouti.">{erreurAction}</Alert>}
      {err && <Alert ton="error" titre="Les jeunes n'ont pas pu être chargés." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!jeunes && !err && <LoadingState texte="Chargement des jeunes…" />}

      {jeunes && jeunes.length === 0 && q.trim().length < 2 && etat === "tous" && (
        <EmptyState titre="Aucun jeune" action={ajouter}>
          Commencez par ajouter un jeune pour préparer son entretien initial.
        </EmptyState>
      )}

      {jeunes && (
        <>
          <div className="sess-filtres">
            <Field label="Rechercher" className="veille-filtres__recherche">
              <input type="search" value={q} placeholder="Nom, prénom ou e-mail" onChange={(e) => setQ(e.target.value)} />
            </Field>
            <Field label="Filtrer">
              <select value={etat} onChange={(e) => setEtat(e.target.value)}>
                {ETATS_JEUNES.map((e) => <option key={e.id} value={e.id}>{e.libelle}</option>)}
              </select>
            </Field>
          </div>

          {jeunes.length === 0 ? (
            <EmptyState titre="Aucun résultat">
              Aucun jeune ne correspond à ce filtre ou à cette recherche.
            </EmptyState>
          ) : (
            <table className="sess-table param-table">
              <caption className="visually-hidden">Jeunes ({total})</caption>
              <thead>
                <tr>
                  <th scope="col">Jeune</th>
                  <th scope="col">État</th>
                  <th scope="col">Entretiens</th>
                  <th scope="col">Téléphone</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {jeunes.map((j) => {
                  const etatB = etatJeune(j);
                  return (
                    <tr key={j.id} className={j.sans_suite_le ? "sess-table__ligne--estompee" : undefined}>
                      <td data-label="Jeune" className="sess-table__principal">
                        {nomComplet(j)}
                        {j.email && <span className="sess-secondaire">{j.email}</span>}
                      </td>
                      <td data-label="État"><Badge ton={etatB.ton}>{etatB.libelle}</Badge></td>
                      <td data-label="Entretiens">
                        {j.nb_entretiens > 0
                          ? `${j.nb_entretiens} (${j.entretiens_en_cours} en cours, ${j.entretiens_valides} validé${j.entretiens_valides > 1 ? "s" : ""})`
                          : "Aucun"}
                      </td>
                      <td data-label="Téléphone">{j.telephone || "—"}</td>
                      <td className="sess-table__actions">
                        {j.sans_suite_le
                          ? <Button compact aria-label={`Rouvrir ${nomComplet(j)}`} disabled={enCours === j.id}
                              onClick={() => changerCycle(j, "rouvrir")}>{enCours === j.id ? "Réouverture…" : "Rouvrir"}</Button>
                          : j.nb_inscriptions === 0 && (
                            <Button compact aria-label={`Classer sans suite ${nomComplet(j)}`} disabled={enCours === j.id}
                              onClick={() => changerCycle(j, "sans-suite")}>Sans suite</Button>
                          )}
                        {admin && j.nb_inscriptions === 0 && (
                          <Button compact variante="danger" aria-label={`Supprimer ${nomComplet(j)}`} disabled={enCours === j.id}
                            onClick={() => { setSucces(null); setErreurAction(null); setASupprimer(j); }}>
                            Supprimer
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}

      <PanneauAjout
        ouvert={panneau}
        onFermer={() => setPanneau(false)}
        onAjoute={async (message) => { setPanneau(false); setSucces(message); await charger(); }}
        onOuvrirExistant={(personne) => { setPanneau(false); setSucces(`Fiche existante : ${nomComplet(personne)}. Aucun nouveau dossier créé.`); }}
      />

      <ConfirmDialog
        ouvert={!!aSupprimer} titre="Supprimer définitivement ce dossier ?"
        libelleConfirmer="Supprimer" enCours={enCours === aSupprimer?.id}
        onConfirmer={() => supprimer(aSupprimer)} onAnnuler={() => setASupprimer(null)}
      >
        <p>Le dossier de {aSupprimer ? nomComplet(aSupprimer) : ""} sera supprimé définitivement, avec ses entretiens.</p>
        <p>La suppression est refusée si des inscriptions ou des preuves y sont rattachées. Cette opération est irréversible.</p>
      </ConfirmDialog>
    </>
  );
}

// Formulaire d'ajout en DEUX temps : d'abord la vérification des doublons
// (GET avant tout enregistrement), puis la création. Aucune fusion, jamais de
// blocage d'un homonyme ; « Ouvrir la fiche existante » ne crée rien.
function PanneauAjout({ ouvert, onFermer, onAjoute, onOuvrirExistant }) {
  const [v, setV] = useState(VIDE);
  const [erreurs, setErreurs] = useState({});
  const [erreurServeur, setErreurServeur] = useState(null);
  const [correspondances, setCorrespondances] = useState(null); // null = pas encore vérifié
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    setV(VIDE); setErreurs({}); setErreurServeur(null); setCorrespondances(null); setEnCours(false);
  }, [ouvert]);

  const champ = (cle) => (e) => setV({ ...v, [cle]: e.target.value });

  async function verifier(e) {
    e.preventDefault();
    const trouvees = {};
    if (!v.nom.trim()) trouvees.nom = "Indiquez le nom.";
    if (!v.prenom.trim()) trouvees.prenom = "Indiquez le prénom.";
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    setEnCours(true); setErreurServeur(null);
    try {
      const q = v.email.trim() || v.nom.trim();
      const r = await api(`/api/stagiaires?q=${encodeURIComponent(q)}`);
      setCorrespondances(r.stagiaires || []);
    } catch (err) {
      setErreurServeur(err.message);
    } finally { setEnCours(false); }
  }

  async function creer() {
    setEnCours(true); setErreurServeur(null);
    try {
      await api("/api/stagiaires", {
        method: "POST",
        body: JSON.stringify({ civilite: v.civilite || null, nom: v.nom, prenom: v.prenom, email: v.email || null, telephone: v.telephone || null }),
      });
      await onAjoute(`Jeune « ${v.prenom} ${v.nom} » enregistré.`);
    } catch (err) {
      setErreurServeur(err.message);
    } finally { setEnCours(false); }
  }

  const enVerification = correspondances === null;

  return (
    <Drawer
      ouvert={ouvert} onFermer={onFermer} fermable={!enCours} taille="etroit"
      titre="Ajouter un jeune"
      description="Identité et coordonnées. L'inscription à une session se fera plus tard, après l'entretien."
      pied={
        enVerification
          ? <>
              <Button onClick={onFermer} disabled={enCours}>Annuler</Button>
              <Button variante="primary" type="submit" form="form-jeune" disabled={enCours}>
                {enCours ? "Vérification…" : "Vérifier les doublons"}
              </Button>
            </>
          : correspondances.length === 0
            ? <>
                <Button onClick={() => setCorrespondances(null)} disabled={enCours}>Retour</Button>
                <Button variante="primary" onClick={creer} disabled={enCours}>{enCours ? "Enregistrement…" : "Créer le dossier"}</Button>
              </>
            : <>
                <Button onClick={onFermer} disabled={enCours}>Annuler</Button>
                <Button variante="primary" onClick={creer} disabled={enCours}>Créer quand même</Button>
              </>
      }
    >
      {erreurServeur && <Alert ton="error" titre="L'action n'a pas abouti.">{erreurServeur}</Alert>}

      {enVerification && (
        <form id="form-jeune" onSubmit={verifier} noValidate>
          <FormSection titre="Identité">
            <Field label="Civilité" facultatif>
              <select value={v.civilite} onChange={champ("civilite")}>
                <option value="">Non précisée</option>
                <option value="M.">M.</option>
                <option value="Mme">Mme</option>
              </select>
            </Field>
            <Field label="Nom" erreur={erreurs.nom}>
              <input value={v.nom} onChange={champ("nom")} required />
            </Field>
            <Field label="Prénom" erreur={erreurs.prenom}>
              <input value={v.prenom} onChange={champ("prenom")} required />
            </Field>
          </FormSection>
          <FormSection titre="Contact">
            <Field label="E-mail" facultatif>
              <input type="email" value={v.email} onChange={champ("email")} />
            </Field>
            <Field label="Téléphone" facultatif>
              <input type="tel" value={v.telephone} onChange={champ("telephone")} />
            </Field>
          </FormSection>
        </form>
      )}

      {correspondances?.length > 0 && (
        <Alert ton="warning" titre="Des dossiers similaires existent déjà">
          <p>Vérifiez s'il ne s'agit pas de la même personne. Ouvrir une fiche existante ne crée aucun nouveau dossier.</p>
          <ul>
            {correspondances.map((c) => (
              <li key={c.id} className="jeunes-correspondance">
                <span>{c.civilite ? `${c.civilite} ` : ""}{c.prenom} {c.nom}{c.email ? ` — ${c.email}` : ""}</span>
                <Button compact onClick={() => onOuvrirExistant(c)}>Ouvrir la fiche existante</Button>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {correspondances?.length === 0 && (
        <Alert ton="success" titre="Aucun doublon trouvé">
          Aucune fiche existante ne correspond. Vous pouvez créer le dossier.
        </Alert>
      )}
    </Drawer>
  );
}
