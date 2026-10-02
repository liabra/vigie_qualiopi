import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { JustificatifsIntervenant } from "./JustificatifsIntervenant.jsx";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { formaterDate } from "../sessions/format.js";
import {
  FONCTIONS_INTERVENANT, NATURES_INTERVENANT, corpsFiche, erreursFiche, filtrerIntervenants, nomComplet, valeursFiche,
} from "./format.js";

// /intervenants — annuaire des formateurs et intervenants (Q4-1).
// ADMIN : recherche, filtres, création, modification, (dés)activation.
// CONTRIBUTEUR : consultation (nom, fonction, domaines) — le serveur ne lui
// renvoie ni e-mail, ni nature, ni formations, ni historique.
export function IntervenantsPage({ admin }) {
  useTitrePage("Intervenants");
  const [liste, setListe] = useState(null);
  const [err, setErr] = useState(null);
  const [filtres, setFiltres] = useState({ q: "", fonction: "", nature: "", statut: "actifs" });
  const [fiche, setFiche] = useState(null); // null | "nouvelle" | intervenant
  const [aBasculer, setABasculer] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const [erreurBascule, setErreurBascule] = useState(null);

  const charger = useCallback(async () => {
    try { setListe((await api("/api/intervenants")).intervenants); setErr(null); }
    catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);
  // ?fiche=ID (depuis la synthèse des justificatifs) : ouvre la fiche (admin).
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = Number(params.get("fiche"));
    if (!admin || !id || !liste) return;
    const i = liste.find((x) => x.id === id);
    if (i) setFiche(i);
    setParams({}, { replace: true });
  }, [admin, liste, params, setParams]);

  const lignes = liste ? filtrerIntervenants(liste, filtres) : [];
  const changer = (cle) => (e) => setFiltres((f) => ({ ...f, [cle]: e.target.value }));

  async function basculer() {
    setEnCours(true); setErreurBascule(null);
    try {
      await api(`/api/intervenants/${aBasculer.id}`, { method: "PATCH", body: JSON.stringify({ actif: !aBasculer.actif }) });
      setABasculer(null);
      await charger();
    } catch (e) { setErreurBascule(e.message); } finally { setEnCours(false); }
  }

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Formation" }, { libelle: "Intervenants" }]}
        titre="Intervenants"
        description="Formateurs et intervenants d'A2C : une fiche par personne, réutilisée dans les sessions et les groupes."
        actions={admin && <Button variante="primary" onClick={() => setFiche("nouvelle")}>Nouvel intervenant</Button>}
      />
      <section className="qualite-section" aria-label="Filtres">
        <FormSection titre="Rechercher" colonnes={admin ? 4 : 3}>
          <Field label="Recherche"><input type="search" value={filtres.q} onChange={changer("q")} placeholder={admin ? "Nom, prénom, e-mail, domaine" : "Nom, prénom, domaine"} /></Field>
          <Field label="Fonction">
            <select value={filtres.fonction} onChange={changer("fonction")}>
              <option value="">Toutes</option>
              {Object.entries(FONCTIONS_INTERVENANT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          {admin && (
            <Field label="Nature">
              <select value={filtres.nature} onChange={changer("nature")}>
                <option value="">Toutes</option>
                {Object.entries(NATURES_INTERVENANT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
          )}
          <Field label="Statut">
            <select value={filtres.statut} onChange={changer("statut")}>
              <option value="actifs">Actifs</option>
              <option value="inactifs">Inactifs</option>
              <option value="tous">Tous</option>
            </select>
          </Field>
        </FormSection>
      </section>

      {err && <Alert ton="error" titre="L'annuaire n'a pas pu être chargé." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!liste && !err && <LoadingState texte="Chargement de l'annuaire…" />}
      {liste && (lignes.length === 0 ? (
        <EmptyState titre={liste.length ? "Aucun intervenant pour ces critères" : "Aucun intervenant enregistré"}
          action={admin && !liste.length && <Button variante="primary" onClick={() => setFiche("nouvelle")}>Nouvel intervenant</Button>}>
          {liste.length ? "Modifiez la recherche ou les filtres." : "Créez une fiche par personne : elle sera ensuite proposée dans les sessions et les groupes."}
        </EmptyState>
      ) : (
        <table className="sess-table">
          <caption className="visually-hidden">Intervenants ({lignes.length})</caption>
          <thead>
            <tr>
              <th scope="col">Intervenant</th><th scope="col">Fonction</th>{admin && <th scope="col">Nature</th>}
              <th scope="col">Domaines de compétence</th>{admin && <th scope="col">Formations</th>}
              <th scope="col">Statut</th>{admin && <th scope="col"><span className="visually-hidden">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {lignes.map((i) => (
              <tr key={i.id}>
                <td data-label="Intervenant" className="sess-table__principal">{i.civilite ? `${i.civilite} ` : ""}{nomComplet(i)}{admin && i.email && <span className="sess-secondaire">{i.email}</span>}</td>
                <td data-label="Fonction">{FONCTIONS_INTERVENANT[i.fonction] || i.fonction}</td>
                {admin && <td data-label="Nature">{NATURES_INTERVENANT[i.nature] || i.nature}</td>}
                <td data-label="Domaines de compétence">{i.domaines?.length ? i.domaines.join(", ") : <span className="sess-secondaire">—</span>}</td>
                {admin && <td data-label="Formations">{i.formations?.length ? i.formations.map((f) => f.intitule).join(", ") : <span className="sess-secondaire">—</span>}</td>}
                <td data-label="Statut"><Badge ton={i.actif ? "success" : "neutral"}>{i.actif ? "Actif" : "Inactif"}</Badge></td>
                {admin && (
                  <td className="sess-table__actions">
                    <Button compact onClick={() => setFiche(i)} aria-label={`Modifier la fiche de ${nomComplet(i)}`}>Modifier la fiche</Button>
                    <Button compact variante="ghost" onClick={() => { setErreurBascule(null); setABasculer(i); }} aria-label={`${i.actif ? "Désactiver" : "Réactiver"} ${nomComplet(i)}`}>{i.actif ? "Désactiver" : "Réactiver"}</Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ))}

      {admin && fiche && (
        <DrawerFiche intervenant={fiche === "nouvelle" ? null : fiche} onFermer={() => setFiche(null)}
          onEnregistre={async () => { setFiche(null); await charger(); }} />
      )}
      <ConfirmDialog ouvert={!!aBasculer} titre={aBasculer?.actif ? "Désactiver cette fiche ?" : "Réactiver cette fiche ?"}
        libelleConfirmer={aBasculer?.actif ? "Désactiver" : "Réactiver"} ton={aBasculer?.actif ? "danger" : "primary"}
        enCours={enCours} onConfirmer={basculer} onAnnuler={() => setABasculer(null)}>
        {aBasculer && (
          <>
            <p>{aBasculer.actif
              ? `${nomComplet(aBasculer)} ne sera plus proposé(e) pour de nouveaux rattachements. Son historique (sessions, groupes, documents) est conservé.`
              : `${nomComplet(aBasculer)} pourra de nouveau être rattaché(e) à des sessions et des groupes.`}</p>
            {erreurBascule && <Alert ton="error">{erreurBascule}</Alert>}
          </>
        )}
      </ConfirmDialog>
    </>
  );
}

// Fiche (création / modification) — données professionnelles uniquement.
function DrawerFiche({ intervenant, onFermer, onEnregistre }) {
  const [v, setV] = useState(() => valeursFiche(intervenant));
  const [formations, setFormations] = useState([]);
  const [historique, setHistorique] = useState(null);
  const [erreurs, setErreurs] = useState({});
  const [erreurServeur, setErreurServeur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const verrou = useRef(false);
  useEffect(() => {
    api("/api/formations").then((r) => setFormations(r.formations || [])).catch(() => setFormations([]));
    if (intervenant) api(`/api/intervenants/${intervenant.id}`).then((r) => setHistorique(r.sessions || [])).catch(() => setHistorique([]));
  }, [intervenant]);
  const c = (cle) => (e) => setV((x) => ({ ...x, [cle]: e.target.value }));
  const basculerFormation = (id) => setV((x) => ({ ...x, formation_ids: x.formation_ids.includes(id) ? x.formation_ids.filter((f) => f !== id) : [...x.formation_ids, id] }));

  async function enregistrer(e) {
    e.preventDefault();
    if (verrou.current) return; // fix : jamais de double soumission
    const trouvees = erreursFiche(v);
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    verrou.current = true; setEnCours(true); setErreurServeur(null);
    try {
      if (intervenant) await api(`/api/intervenants/${intervenant.id}`, { method: "PATCH", body: JSON.stringify(corpsFiche(v)) });
      else await api("/api/intervenants", { method: "POST", body: JSON.stringify(corpsFiche(v)) });
      await onEnregistre();
    } catch (err) {
      setErreurServeur(err.message); // la saisie reste dans le formulaire
    } finally { verrou.current = false; setEnCours(false); }
  }

  return (
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} taille="large"
      titre={intervenant ? `Fiche de ${nomComplet(intervenant)}` : "Nouvel intervenant"}
      description="Données professionnelles uniquement : ni adresse personnelle, ni date de naissance, ni numéro de sécurité sociale, ni coordonnées bancaires."
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
        <Button variante="primary" type="submit" form="form-intervenant" disabled={enCours}>{enCours ? "Enregistrement…" : intervenant ? "Enregistrer la fiche" : "Créer la fiche"}</Button></>}>
      <form id="form-intervenant" onSubmit={enregistrer} noValidate className="ui-form">
        {erreurServeur && <Alert ton="error" titre="La fiche n'a pas été enregistrée.">{erreurServeur}</Alert>}
        <FormSection titre="Identité professionnelle" colonnes={2}>
          <Field label="Civilité" facultatif>
            <select value={v.civilite} onChange={c("civilite")}><option value="">Non précisée</option><option value="M.">M.</option><option value="Mme">Mme</option></select>
          </Field>
          <Field label="E-mail professionnel" facultatif erreur={erreurs.email}><input type="email" value={v.email} onChange={c("email")} /></Field>
          <Field label="Nom" erreur={erreurs.nom}><input value={v.nom} onChange={c("nom")} required /></Field>
          <Field label="Prénom" erreur={erreurs.prenom}><input value={v.prenom} onChange={c("prenom")} required /></Field>
        </FormSection>
        <FormSection titre="Intervention" colonnes={2}>
          <Field label="Fonction" aide="Ce que la personne fait pour A2C.">
            <select value={v.fonction} onChange={c("fonction")}>
              {Object.entries(FONCTIONS_INTERVENANT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Nature de l'intervention" erreur={erreurs.nature} aide="La relation professionnelle avec A2C.">
            <select value={v.nature} onChange={c("nature")} required>
              <option value="">Choisir</option>
              {Object.entries(NATURES_INTERVENANT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Domaines de compétence" facultatif className="ui-field--large" aide="Séparés par des virgules. Aucune notation ni classement.">
            <input value={v.domaines} onChange={c("domaines")} placeholder="Ex. Aide à la personne, Bureautique" />
          </Field>
        </FormSection>
        <fieldset className="ui-form-section">
          <legend>Formations qu'il ou elle peut animer</legend>
          {formations.length === 0 ? <p className="sess-secondaire">Aucune formation enregistrée.</p> : formations.map((f) => (
            <label key={f.id} className="ui-case">
              <input type="checkbox" checked={v.formation_ids.includes(f.id)} onChange={() => basculerFormation(f.id)} />
              <span>{f.intitule}</span>
            </label>
          ))}
        </fieldset>
      </form>
      {intervenant && <JustificatifsIntervenant intervenant={intervenant} />}
      <div className="ui-form">
        {intervenant && (
          <section aria-label="Interventions">
            <h3 className="accompagnement-sections__titre">Interventions (historique)</h3>
            {historique === null ? <LoadingState texte="Chargement…" /> : historique.length === 0 ? <p className="sess-secondaire">Aucune session rattachée.</p> : (
              <ul className="adaptations-liste">
                {historique.map((s) => (
                  <li key={s.id}><Link to={`/sessions/${s.id}/stagiaires`}>{s.reference || "Session"}</Link> — {s.formation} <span className="sess-secondaire">du {formaterDate(s.date_debut)} au {formaterDate(s.date_fin)}{s.groupes.length ? ` · groupes : ${s.groupes.join(", ")}` : ""}</span></li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Drawer>
  );
}
