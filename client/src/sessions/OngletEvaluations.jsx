import { useEffect, useState } from "react";
import { api } from "../api.js";
import { RechercheDrive } from "../RechercheDrive.jsx";
import { Alert, Badge, Button, Drawer, EmptyState, Field, FormSection } from "../ui/index.js";
import { formaterDate } from "./format.js";

export const TYPES_EVALUATION = {
  positionnement: "Positionnement", intermediaire: "Intermédiaire", qcm: "QCM",
  validation_etape: "Validation d'étape", evaluation_finale: "Évaluation finale", autre: "Autre",
};
export const RESULTATS = {
  valide: { libelle: "Validé", ton: "success" },
  non_valide: { libelle: "Non validé", ton: "error" },
  non_determine: { libelle: "Non déterminé", ton: "neutral" },
  non_applicable: { libelle: "Non applicable", ton: "neutral" },
};
const STATUT_IMPORT = {
  pret: { libelle: "Prêt", ton: "success" }, a_verifier: { libelle: "À vérifier", ton: "warning" },
  invalide: { libelle: "Invalide", ton: "error" }, doublon: { libelle: "Doublon", ton: "warning" },
};
const lienDrive = (id) => `https://drive.google.com/file/d/${id}/view`;
const vide = () => ({
  inscription_id: "", type: "qcm", intitule: "", date_passage: "", score: "", score_max: "",
  seuil_reussite: "", resultat: "non_determine", commentaire: "", fichier: null,
});

// Onglet Évaluations : résultats (QCM, positionnement…), saisie et import
// CSV. Aucun moteur de questionnaire. La date de passage est bornée à la
// période de la session (contrôlée aussi par le serveur).
export function OngletEvaluations({ donnees, admin, peutSaisir, recharger, notifier }) {
  const { session, stagiaires } = donnees;
  const ev = donnees.evaluations;
  const [formulaire, setFormulaire] = useState(null);
  const [imports, setImports] = useState(false);

  return (
    <div className="sess-sections">
      <section className="sess-section" aria-labelledby="titre-evaluations">
        <div className="sess-section__tete">
          <h2 id="titre-evaluations" className="sess-section__titre">Évaluations</h2>
          {peutSaisir && (
            <div className="sess-actions">
              <Button compact onClick={() => setImports(true)}>Importer un CSV</Button>
              <Button compact variante="primary" onClick={() => setFormulaire(vide())} disabled={stagiaires.length === 0}>Ajouter une évaluation</Button>
            </div>
          )}
        </div>
        {ev.agregation.total > 0 && (
          <div className="sess-badges" aria-label="Synthèse des résultats">
            <Badge ton="neutral">{ev.agregation.total} résultat(s)</Badge>
            <Badge ton="success">{ev.agregation.valide} validé(s)</Badge>
            <Badge ton="error">{ev.agregation.non_valide} non validé(s)</Badge>
            <Badge ton="neutral">{ev.agregation.non_determine} non déterminé(s)</Badge>
            <Badge ton="neutral">{ev.agregation.non_applicable} non applicable(s)</Badge>
          </div>
        )}
        {ev.evaluations.length === 0 ? (
          <EmptyState
            titre="Aucune évaluation enregistrée"
            action={peutSaisir && stagiaires.length > 0 && <Button variante="primary" onClick={() => setFormulaire(vide())}>Ajouter une évaluation</Button>}
          >
            {stagiaires.length === 0 ? "Inscrivez d'abord des stagiaires." : "Saisissez les résultats un par un, ou importez un export Google Forms / Sheets."}
          </EmptyState>
        ) : (
          <table className="sess-table">
            <caption className="visually-hidden">Résultats d'évaluation</caption>
            <thead>
              <tr>
                <th scope="col">Stagiaire</th><th scope="col">Épreuve</th><th scope="col">Date</th>
                <th scope="col" className="sess-num">Score</th><th scope="col">Résultat</th><th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {ev.evaluations.map((e) => {
                const r = RESULTATS[e.resultat] || { libelle: e.resultat, ton: "neutral" };
                return (
                  <tr key={e.id}>
                    <td data-label="Stagiaire" className="sess-table__principal">{e.nom} {e.prenom}</td>
                    <td data-label="Épreuve">
                      {e.intitule || TYPES_EVALUATION[e.type]}
                      <span className="sess-secondaire">{TYPES_EVALUATION[e.type]}</span>
                      {e.commentaire && <span className="sess-secondaire">{e.commentaire}</span>}
                    </td>
                    <td data-label="Date">{formaterDate(e.date_passage)}</td>
                    <td data-label="Score" className="sess-num">{e.score !== null && e.score !== undefined ? `${e.score} / ${e.score_max}` : "—"}</td>
                    <td data-label="Résultat"><Badge ton={r.ton}>{r.libelle}</Badge></td>
                    <td className="sess-table__actions">
                      {e.drive_file_id && <a className="ui-btn ui-btn--ghost ui-btn--compact" href={lienDrive(e.drive_file_id)} target="_blank" rel="noreferrer">Pièce<span className="visually-hidden"> (nouvel onglet)</span></a>}
                      {peutSaisir && (
                        <Button compact onClick={() => setFormulaire({
                          id: e.id, inscription_id: String(e.inscription_id), type: e.type, intitule: e.intitule || "",
                          date_passage: String(e.date_passage || "").slice(0, 10), score: e.score ?? "", score_max: e.score_max ?? "",
                          seuil_reussite: e.seuil_reussite ?? "", resultat: e.resultat, commentaire: e.commentaire || "", fichier: null,
                        })}>Modifier</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {peutSaisir && (
        <>
          <DrawerEvaluation valeurInitiale={formulaire} session={session} stagiaires={stagiaires} admin={admin}
            onFermer={() => setFormulaire(null)}
            onFait={async (m) => { setFormulaire(null); notifier({ ton: "success", titre: m }); await recharger(); }} />
          <DrawerImportEvaluations ouvert={imports} sessionId={session.id} onFermer={() => setImports(false)}
            onFait={async (b) => {
              setImports(false);
              notifier({ ton: "success", titre: "Import terminé.", texte: `${b.importes} importé(s), ${b.ignores.length} ignoré(s).` });
              await recharger();
            }} />
        </>
      )}
    </div>
  );
}

function DrawerEvaluation({ valeurInitiale, session, stagiaires, admin, onFermer, onFait }) {
  const [v, setV] = useState(null);
  const [erreurs, setErreurs] = useState({});
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => { setV(valeurInitiale); setErreurs({}); setErreur(null); }, [valeurInitiale]);

  async function valider(e) {
    e.preventDefault();
    const trouvees = {};
    if (!v.inscription_id) trouvees.inscription_id = "Choisissez un stagiaire.";
    if (!v.date_passage) trouvees.date_passage = "Indiquez la date.";
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    setEnCours(true); setErreur(null);
    try {
      const score = v.score === "" ? null : Number(v.score);
      const corps = {
        inscription_id: Number(v.inscription_id), type: v.type, intitule: v.intitule,
        date_passage: v.date_passage, resultat: v.resultat, commentaire: v.commentaire,
        seuil_reussite: v.seuil_reussite === "" ? null : Number(v.seuil_reussite),
        ...(score === null ? {} : { score, score_max: Number(v.score_max) }),
        ...(v.fichier ? { drive_file_id: v.fichier.id } : {}),
      };
      if (v.id) await api(`/api/evaluations/${v.id}`, { method: "PATCH", body: JSON.stringify(corps) });
      else await api(`/api/sessions/${session.id}/evaluations`, { method: "POST", body: JSON.stringify(corps) });
      await onFait(v.id ? "Évaluation modifiée." : "Évaluation enregistrée.");
    } catch (err) { setErreur(err.message); } finally { setEnCours(false); }
  }

  const ouvert = !!v;
  const c = (cle) => (e) => setV({ ...v, [cle]: e.target.value });
  return (
    <Drawer ouvert={ouvert} onFermer={onFermer} fermable={!enCours}
      titre={v?.id ? "Modifier l'évaluation" : "Ajouter une évaluation"}
      description={`Date de passage comprise entre le ${formaterDate(session.date_debut)} et le ${formaterDate(session.date_fin)}.`}
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
        <Button variante="primary" type="submit" form="form-evaluation" disabled={enCours}>{enCours ? "Enregistrement…" : "Enregistrer l'évaluation"}</Button></>}>
      {ouvert && (
        <form id="form-evaluation" onSubmit={valider} noValidate className="ui-form">
          {erreur && <Alert ton="error" titre="L'évaluation n'a pas été enregistrée.">{erreur}</Alert>}
          <FormSection titre="Stagiaire et épreuve">
            <Field label="Stagiaire" erreur={erreurs.inscription_id}>
              <select value={v.inscription_id} onChange={c("inscription_id")}>
                <option value="">Choisir…</option>
                {stagiaires.map((s) => <option key={s.inscription_id} value={String(s.inscription_id)}>{s.nom} {s.prenom}{s.email ? ` · ${s.email}` : ""}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select value={v.type} onChange={c("type")}>
                {Object.entries(TYPES_EVALUATION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="Intitulé" facultatif><input value={v.intitule} onChange={c("intitule")} placeholder="Ex. QCM fin de séance 1" /></Field>
            <Field label="Date de passage" erreur={erreurs.date_passage}>
              <input type="date" min={session.date_debut || undefined} max={session.date_fin || undefined} value={v.date_passage} onChange={c("date_passage")} />
            </Field>
          </FormSection>
          <FormSection titre="Résultat" colonnes={3}>
            <Field label="Score" facultatif><input type="number" min="0" inputMode="decimal" value={v.score} onChange={c("score")} /></Field>
            <Field label="Score maximum" facultatif><input type="number" min="1" inputMode="decimal" value={v.score_max} onChange={c("score_max")} /></Field>
            <Field label="Seuil de réussite" facultatif><input type="number" min="0" inputMode="decimal" value={v.seuil_reussite} onChange={c("seuil_reussite")} /></Field>
            <Field label="Résultat">
              <select value={v.resultat} onChange={c("resultat")}>
                {Object.entries(RESULTATS).map(([k, r]) => <option key={k} value={k}>{r.libelle}</option>)}
              </select>
            </Field>
          </FormSection>
          <FormSection titre="Commentaire" colonnes={1}>
            <Field label="Commentaire" facultatif><textarea rows={3} value={v.commentaire} onChange={c("commentaire")} /></Field>
          </FormSection>
          {admin && (
            <FormSection titre="Pièce justificative (Drive)" colonnes={1}>
              {v.fichier
                ? <p>Fichier : <strong>{v.fichier.nom}</strong> <Button compact variante="ghost" onClick={() => setV({ ...v, fichier: null })}>Retirer</Button></p>
                : <RechercheDrive surChoix={(f) => setV({ ...v, fichier: f })} onErreur={setErreur} placeholder="Rechercher la pièce sur le Drive (facultatif)" />}
            </FormSection>
          )}
        </form>
      )}
    </Drawer>
  );
}

function DrawerImportEvaluations({ ouvert, sessionId, onFermer, onFait }) {
  const [apercu, setApercu] = useState(null);
  const [texte, setTexte] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => { if (ouvert) { setApercu(null); setTexte(null); setErreur(null); } }, [ouvert]);

  async function lireFichier(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const t = await f.text();
    setTexte(t); setErreur(null);
    try {
      setApercu(await api(`/api/sessions/${sessionId}/evaluations/import-apercu`, { method: "POST", body: JSON.stringify({ texte: t }) }));
    } catch (err) { setApercu(null); setErreur(err.message); }
    e.target.value = "";
  }

  async function confirmer() {
    setEnCours(true); setErreur(null);
    try {
      const r = await api(`/api/sessions/${sessionId}/evaluations/import`, { method: "POST", body: JSON.stringify({ texte }) });
      await onFait(r.bilan);
    } catch (err) { setErreur(err.message); } finally { setEnCours(false); }
  }

  const n = apercu?.resume?.importables ?? 0;
  return (
    <Drawer ouvert={ouvert} onFermer={onFermer} fermable={!enCours} taille="large" titre="Importer des résultats (CSV)"
      description="Étape 1 : choisir le fichier et vérifier l'aperçu (rien n'est enregistré). Étape 2 : confirmer."
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
        <Button variante="primary" onClick={confirmer} disabled={enCours || !apercu || n === 0}>
          {enCours ? "Import en cours…" : `Confirmer${apercu ? ` (${n} résultat(s))` : ""}`}
        </Button></>}>
      <div className="ui-form">
        {erreur && <Alert ton="error" titre="Import impossible.">{erreur}</Alert>}
        <Field label="Fichier CSV" aide="Export Google Forms / Sheets : email, type, intitulé, date, score, score_max (ou pourcentage), seuil, résultat, commentaire.">
          <input type="file" accept=".csv,text/csv" onChange={lireFichier} />
        </Field>
        {apercu && (
          <>
            <Alert ton="info" titre="Aperçu — rien n'a encore été enregistré." />
            <div className="sess-badges">
              <Badge ton="success">{apercu.resume.importables} importable(s)</Badge>
              <Badge ton="error">{apercu.resume.invalides} invalide(s)</Badge>
              <Badge ton="warning">{apercu.resume.aVerifier} à vérifier</Badge>
              <Badge ton="warning">{apercu.resume.doublons} doublon(s)</Badge>
            </div>
            <ul className="sess-apercu">
              {apercu.lignes.map((l) => {
                const s = STATUT_IMPORT[l.statut] || { libelle: l.statut, ton: "neutral" };
                return (
                  <li key={l.index}>
                    <span className="sess-secondaire">Ligne {l.index + 1}</span>
                    <strong>{l.stagiaire ? `${l.stagiaire.nom} ${l.stagiaire.prenom}` : "—"}</strong>
                    <span className="sess-secondaire">{l.type} · {l.intitule} · {l.date}</span>
                    {l.normalisePourcentage && <Badge ton="info">Pourcentage → score sur 100</Badge>}
                    <Badge ton={s.ton}>{s.libelle}</Badge>
                    {l.motif && <span className="sess-secondaire">{l.motif}</span>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Drawer>
  );
}
