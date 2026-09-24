import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Button, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { SelecteurIndicateurs } from "./SelecteurIndicateurs.jsx";
import { STATUTS_ACTION, STATUTS_VEILLE, TYPES_VEILLE, VEILLE_VIDE, corpsVeille, valeursDepuisVeille } from "./format.js";

const AIDE_ACTION = {
  aucune: "Aucune action n'est prévue pour l'instant.",
  a_realiser: "Une action est décidée et reste à mener.",
  realisee: "L'action est terminée : indiquez sa date de réalisation.",
};

// /veille/nouvelle et /veille/:id/modifier : page dédiée (formulaire long),
// en trois temps — S'informer, Analyser, Agir. Mêmes champs métier qu'avant
// UX-3 ; le serveur reste seul juge de la cohérence (règles L6), ses
// messages s'affichent près des boutons.
export function VeilleFormulaire({ veilleId = null }) {
  const modification = veilleId !== null;
  useTitrePage(modification ? "Modifier la veille" : "Nouvelle veille");
  const naviguer = useNavigate();
  const [valeurs, setValeurs] = useState(modification ? null : VEILLE_VIDE);
  const [origine, setOrigine] = useState(null);
  const [criteres, setCriteres] = useState(null);
  const [introuvable, setIntrouvable] = useState(false);
  const [erreurs, setErreurs] = useState({});
  const [erreurServeur, setErreurServeur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const zoneErreur = useRef(null);

  useEffect(() => {
    api("/api/referentiel").then((r) => setCriteres(r.criteres || [])).catch(() => setCriteres([]));
    if (!modification) return;
    api(`/api/veille/${veilleId}`)
      .then((r) => { setOrigine(r.veille); setValeurs(valeursDepuisVeille(r.veille)); })
      .catch((e) => { if (e.status === 404 || e.status === 400) setIntrouvable(true); else setErreurServeur(e.message); });
  }, [veilleId, modification]);

  const fil = [{ libelle: "Qualité" }, { libelle: "Veille", to: "/veille" },
    ...(modification && origine ? [{ libelle: origine.titre, to: `/veille/${veilleId}` }] : []),
    { libelle: modification ? "Modifier" : "Nouvelle veille" }];

  if (introuvable) {
    return (
      <>
        <PageHeader fil={fil} titre="Veille introuvable" />
        <EmptyState titre="Cette veille n'existe pas ou n'existe plus." action={<Button variante="primary" to="/veille">Voir toute la veille</Button>} />
      </>
    );
  }
  if (!valeurs) return erreurServeur ? <Alert ton="error" titre="La veille n'a pas pu être chargée.">{erreurServeur}</Alert> : <LoadingState texte="Chargement de la veille…" />;

  const champ = (cle) => (e) => setValeurs({ ...valeurs, [cle]: e.target.value });
  const retour = modification ? `/veille/${veilleId}` : "/veille";

  async function enregistrer(e) {
    e.preventDefault();
    const trouvees = {};
    if (!valeurs.titre.trim()) trouvees.titre = "Indiquez un titre.";
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    setEnCours(true);
    setErreurServeur(null);
    try {
      const corps = corpsVeille(valeurs);
      const r = modification
        ? await api(`/api/veille/${veilleId}`, { method: "PATCH", body: JSON.stringify(corps) })
        : await api("/api/veille", { method: "POST", body: JSON.stringify(corps) });
      naviguer(`/veille/${r.veille.id}`, { state: { succes: modification ? "Modifications enregistrées." : "Veille créée." } });
    } catch (err) {
      setErreurServeur(err.message);
      setEnCours(false);
      requestAnimationFrame(() => zoneErreur.current?.scrollIntoView?.({ block: "nearest" }));
    }
  }

  return (
    <>
      <PageHeader fil={fil} titre={modification ? "Modifier la veille" : "Nouvelle veille"}
        description="Trois temps : l'information d'origine, son analyse pour l'organisme, puis l'action décidée." />
      <form className="veille-form" onSubmit={enregistrer} noValidate>
        <section className="veille-form__etape" aria-labelledby="form-informer">
          <h2 id="form-informer" className="veille-etape__titre"><span className="veille-etape__num" aria-hidden="true">1</span>S'informer</h2>
          <FormSection titre="Information">
            <Field label="Titre" erreur={erreurs.titre} className="ui-field--large">
              <input value={valeurs.titre} onChange={champ("titre")} required />
            </Field>
            <Field label="Type">
              <select value={valeurs.type} onChange={champ("type")}>
                {Object.entries(TYPES_VEILLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="Source" facultatif aide="Ex. Légifrance, France compétences, OPCO…">
              <input value={valeurs.source} onChange={champ("source")} />
            </Field>
            <Field label="Lien" facultatif className="ui-field--large" aide="Adresse web complète (https://…).">
              <input type="url" inputMode="url" value={valeurs.url} onChange={champ("url")} placeholder="https://" />
            </Field>
          </FormSection>
          <FormSection titre="Dates" colonnes={3}>
            <Field label="Date de publication" facultatif><input type="date" value={valeurs.date_publication} onChange={champ("date_publication")} /></Field>
            <Field label="Date d'effet" facultatif><input type="date" value={valeurs.date_effet} onChange={champ("date_effet")} /></Field>
            <Field label="Date de consultation" facultatif><input type="date" value={valeurs.date_consultation} onChange={champ("date_consultation")} /></Field>
          </FormSection>
          <FormSection titre="Résumé" colonnes={1}>
            <Field label="Résumé de l'information" facultatif><textarea rows={4} value={valeurs.resume} onChange={champ("resume")} /></Field>
          </FormSection>
        </section>

        <section className="veille-form__etape" aria-labelledby="form-analyser">
          <h2 id="form-analyser" className="veille-etape__titre"><span className="veille-etape__num" aria-hidden="true">2</span>Analyser</h2>
          <FormSection titre="Impact pour l'organisme" colonnes={1}>
            <Field label="Analyse d'impact" facultatif aide="Ce que cette information change pour A2C : processus, documents, formations, indicateurs.">
              <textarea rows={6} value={valeurs.analyse_impact} onChange={champ("analyse_impact")} />
            </Field>
          </FormSection>
          <fieldset className="veille-radios">
            <legend className="ui-field__label">Cette veille constitue-t-elle une rupture réglementaire ?</legend>
            <label className="ui-case"><input type="radio" name="rupture" checked={valeurs.rupture_reglementaire === true} onChange={() => setValeurs({ ...valeurs, rupture_reglementaire: true })} /><span>Oui, c'est une rupture réglementaire</span></label>
            <label className="ui-case"><input type="radio" name="rupture" checked={valeurs.rupture_reglementaire === false} onChange={() => setValeurs({ ...valeurs, rupture_reglementaire: false })} /><span>Non</span></label>
          </fieldset>
          <FormSection titre="Suivi de l'analyse" colonnes={2}>
            <Field label="Statut de la veille">
              <select value={valeurs.statut} onChange={champ("statut")}>
                {Object.entries(STATUTS_VEILLE).map(([k, s]) => <option key={k} value={k}>{s.libelle}</option>)}
              </select>
            </Field>
          </FormSection>
          {criteres === null
            ? <LoadingState texte="Chargement des indicateurs…" />
            : <SelecteurIndicateurs criteres={criteres} valeur={valeurs.indicateur_ids} dejaLies={origine?.indicateurs || []}
                onChange={(ids) => setValeurs({ ...valeurs, indicateur_ids: ids })} />}
        </section>

        <section className="veille-form__etape" aria-labelledby="form-agir">
          <h2 id="form-agir" className="veille-etape__titre"><span className="veille-etape__num" aria-hidden="true">3</span>Agir</h2>
          <fieldset className="veille-radios">
            <legend className="ui-field__label">Statut de l'action</legend>
            {Object.entries(STATUTS_ACTION).map(([k, s]) => (
              <label key={k} className="ui-case">
                <input type="radio" name="statut_action" value={k} checked={valeurs.statut_action === k} onChange={() => setValeurs({ ...valeurs, statut_action: k })} />
                <span>{s.libelle}<span className="ui-field__aide ui-case__aide">{AIDE_ACTION[k]}</span></span>
              </label>
            ))}
          </fieldset>
          <FormSection titre="Action" colonnes={1}>
            <Field label="Action à mener" facultatif={valeurs.statut_action === "aucune"}
              aide={valeurs.statut_action === "realisee" ? "Une action réalisée doit avoir un libellé." : undefined}>
              <textarea rows={4} value={valeurs.action} onChange={champ("action")} />
            </Field>
            {valeurs.statut_action === "realisee" && (
              <Field label="Date de réalisation" facultatif>
                <input type="date" value={valeurs.action_realisee_le} onChange={champ("action_realisee_le")} />
              </Field>
            )}
          </FormSection>
        </section>

        <div className="veille-form__actions" ref={zoneErreur}>
          {erreurServeur && <Alert ton="error" titre="La veille n'a pas été enregistrée.">{erreurServeur}</Alert>}
          <div className="veille-form__boutons">
            <Button to={retour} aria-disabled={enCours || undefined}>Annuler</Button>
            <Button variante="primary" type="submit" disabled={enCours}>
              {enCours ? "Enregistrement…" : modification ? "Enregistrer les modifications" : "Enregistrer"}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
