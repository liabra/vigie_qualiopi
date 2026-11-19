import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Button, Drawer, Field, LoadingState } from "../ui/index.js";
import { depuisServeur, lireSequenceCollee, versCorps } from "./sequence.js";

const duree = (m) => (m === "" || m === null ? "—" : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`);
const CHAMPS_DETAIL = [["objectif", "Objectif pédagogique", 3], ["support", "Support", 2], ["modalite", "Modalité", 2], ["activites", "Activités ou techniques", 4], ["ressources", "Ressources pédagogiques", 3], ["indicateur", "Indicateur / évaluation", 3]];

// Séquence pédagogique d'une formation (modules → compétences). Enregistrer remplace la séquence de la version courante ;
// le serveur la refuse si des compétences de stagiaires y sont déjà saisies (réviser la formation crée alors une version qui la reprend).
export function SequenceFormation({ formation, onFermer, onEnregistree }) {
  const [modules, setModules] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [avertissements, setAvertissements] = useState([]);
  const [colle, setColle] = useState("");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!formation) return;
    setModules(null); setErreur(null); setAvertissements([]); setColle(""); setEnCours(false);
    api(`/api/formations/${formation.id}/modules`).then((r) => setModules(depuisServeur(r.modules))).catch((e) => { setErreur(e.message); setModules([]); });
  }, [formation]);

  const majModule = (i, cle, v) => setModules(modules.map((m, k) => (k === i ? { ...m, [cle]: v } : m)));
  const majComp = (i, j, cle, v) => setModules(modules.map((m, k) => (k === i ? { ...m, competences: m.competences.map((c, l) => (l === j ? { ...c, [cle]: v } : c)) } : m)));

  function importer() {
    const r = lireSequenceCollee(colle);
    setAvertissements(r.avertissements);
    if (r.modules.length) { setModules(r.modules); setColle(""); }
  }

  async function enregistrer() {
    setEnCours(true); setErreur(null);
    try {
      await api(`/api/formations/${formation.id}/modules`, { method: "PUT", body: JSON.stringify(versCorps(modules)) });
      await onEnregistree(`Séquence pédagogique de « ${formation.intitule} » enregistrée.`);
    } catch (e) { setErreur(e.message); setEnCours(false); }
  }

  const total = modules ? modules.reduce((n, m) => n + (Number(m.duree_minutes) || 0), 0) : 0;
  return (
    <Drawer ouvert={!!formation} onFermer={onFermer} fermable={!enCours} taille="large" titre="Séquence pédagogique"
      description={formation ? `${formation.intitule} — version ${formation.version_numero || ""}` : ""}
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
        <Button variante="primary" onClick={enregistrer} disabled={enCours || !modules}>{enCours ? "Enregistrement…" : "Enregistrer la séquence"}</Button></>}>
      {!modules && <LoadingState texte="Chargement de la séquence…" />}
      {erreur && <Alert ton="error" titre="La séquence n'a pas été enregistrée.">{erreur}</Alert>}
      {modules && (
        <>
          <p className="ui-field__aide">
            Les modules et leurs compétences servent au programme, à la séquence pédagogique, au suivi des résultats et aux bilans intermédiaires.
            Un module est acquis dès 50 % de ses compétences évaluées acquises ; les objectifs sont atteints dès 80 % des modules acquis.
          </p>
          <details className="param-importer">
            <summary>Importer depuis un tableau (Google Sheets, Excel)</summary>
            <Field label="Tableau copié" aide="Copiez les lignes de la séquence (colonnes : étape, durée, objectif, support, modalité, activités, ressources, indicateur) et collez-les ici. Cela remplace la séquence affichée ; rien n'est enregistré avant « Enregistrer la séquence ».">
              <textarea rows={5} value={colle} onChange={(e) => setColle(e.target.value)} />
            </Field>
            <Button compact onClick={importer} disabled={!colle.trim()}>Lire le tableau</Button>
            {avertissements.map((a) => <Alert key={a} ton="warning">{a}</Alert>)}
          </details>
          {modules.length === 0 && <p>Aucun module : importez votre séquence ci-dessus.</p>}
          {modules.length > 0 && <p><strong>{modules.length} modules, {modules.reduce((n, m) => n + m.competences.length, 0)} compétences, {duree(total)}</strong></p>}
          {modules.map((m, i) => (
            <section key={i} className="param-module" aria-label={`Module ${m.code}`}>
              <h3>{m.code} — {m.intitule} <span className="sess-secondaire">{duree(m.duree_minutes)}</span></h3>
              <Field label={`Intitulé du module ${m.code}`}><input value={m.intitule} onChange={(e) => majModule(i, "intitule", e.target.value)} /></Field>
              <Field label={`Durée d'évaluation de ${m.code} (minutes)`} facultatif><input type="number" min="0" value={m.evaluation_minutes} onChange={(e) => majModule(i, "evaluation_minutes", e.target.value)} /></Field>
              <Field label={`Objectif de l'évaluation intermédiaire de ${m.code}`} facultatif><textarea rows={2} value={m.evaluation_objectif} onChange={(e) => majModule(i, "evaluation_objectif", e.target.value)} /></Field>
              {m.competences.map((c, j) => (
                <details key={j} className="param-competence">
                  <summary><strong>{c.code}</strong> {c.libelle} <span className="sess-secondaire">{c.duree_minutes === "" ? "" : `${c.duree_minutes} min`}</span></summary>
                  <Field label={`Compétence ${c.code} (intitulé du programme)`}><input value={c.libelle} onChange={(e) => majComp(i, j, "libelle", e.target.value)} /></Field>
                  <Field label={`Titre court de ${c.code}`} facultatif><input value={c.titre} onChange={(e) => majComp(i, j, "titre", e.target.value)} /></Field>
                  <Field label={`Durée de ${c.code} (minutes)`} facultatif><input type="number" min="0" value={c.duree_minutes} onChange={(e) => majComp(i, j, "duree_minutes", e.target.value)} /></Field>
                  {CHAMPS_DETAIL.map(([cle, lib, rows]) => (
                    <Field key={cle} label={`${lib} (${c.code})`} facultatif><textarea rows={rows} value={c[cle]} onChange={(e) => majComp(i, j, cle, e.target.value)} /></Field>
                  ))}
                </details>
              ))}
            </section>
          ))}
        </>
      )}
    </Drawer>
  );
}
