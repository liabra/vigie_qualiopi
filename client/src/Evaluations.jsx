import { useEffect, useState } from "react";
import { api } from "./api.js";
import { RechercheDrive } from "./RechercheDrive.jsx";

const TYPES = {
  positionnement: "Positionnement", intermediaire: "Intermédiaire", qcm: "QCM",
  validation_etape: "Validation d'étape", evaluation_finale: "Évaluation finale", autre: "Autre",
};
const RESULTATS = {
  valide: "Validé", non_valide: "Non validé", non_determine: "Non déterminé", non_applicable: "Non applicable",
};
const TYPES_SAT = { a_chaud: "À chaud", a_froid: "À froid", financeur: "Financeur", entreprise: "Entreprise", formateur: "Formateur" };
const STATUT_IMPORT = { pret: "Prêt", a_verifier: "À vérifier", invalide: "Invalide", doublon: "Doublon" };
const dateFr = (d) => (d ? String(d).slice(0, 10) : "");
const videEvaluation = () => ({
  inscription_id: "", type: "qcm", intitule: "", date_passage: "", score: "", score_max: "",
  seuil_reussite: "", resultat: "non_determine", commentaire: "", fichier: null,
});
const videSatisfaction = () => ({
  type: "a_chaud", inscription_id: "", date_recueil: "", note_globale: "", note_max: "5", commentaires: "", fichier: null,
});

// Bloc « Évaluations & satisfaction » d'une session : consultation,
// saisie manuelle, import CSV (aperçu puis confirmation), rattachement
// d'un fichier Drive vérifié. Aucun moteur de questionnaire ici.
export default function Evaluations({ sessionId, stagiaires, peutSaisir, admin, erreur }) {
  const [evals, setEvals] = useState(null);
  const [sats, setSats] = useState(null);
  const [formEval, setFormEval] = useState(null);       // null | { id?, ... }
  const [formSat, setFormSat] = useState(null);
  const [occupe, setOccupe] = useState(false);
  // Import CSV : texte du fichier conservé pour la confirmation.
  const [apercu, setApercu] = useState(null);
  const [bilan, setBilan] = useState(null);
  const [texteCsv, setTexteCsv] = useState(null);

  async function charger() {
    try {
      const [e, s] = await Promise.all([
        api(`/api/sessions/${sessionId}/evaluations`),
        api(`/api/sessions/${sessionId}/satisfactions`),
      ]);
      setEvals(e);
      setSats(s);
    } catch (e) { erreur(e.message); }
  }
  useEffect(() => { charger(); /* eslint-disable-line */ }, [sessionId]);

  async function enregistrerEvaluation() {
    if (!formEval.inscription_id) return erreur("Choisissez un stagiaire.");
    if (!formEval.date_passage) return erreur("Indiquez la date.");
    setOccupe(true);
    try {
      const score = formEval.score === "" ? null : Number(formEval.score);
      const corps = {
        inscription_id: Number(formEval.inscription_id), type: formEval.type, intitule: formEval.intitule,
        date_passage: formEval.date_passage, resultat: formEval.resultat, commentaire: formEval.commentaire,
        seuil_reussite: formEval.seuil_reussite === "" ? null : Number(formEval.seuil_reussite),
        ...(score === null ? {} : { score, score_max: Number(formEval.score_max) }),
        ...(formEval.fichier ? { drive_file_id: formEval.fichier.id } : {}),
      };
      if (formEval.id) await api(`/api/evaluations/${formEval.id}`, { method: "PATCH", body: JSON.stringify(corps) });
      else await api(`/api/sessions/${sessionId}/evaluations`, { method: "POST", body: JSON.stringify(corps) });
      setFormEval(null);
      erreur(null);
      await charger();
    } catch (e) { erreur(e.message); } finally { setOccupe(false); }
  }

  async function enregistrerSatisfaction() {
    if (!formSat.date_recueil) return erreur("Indiquez la date.");
    setOccupe(true);
    try {
      const corps = {
        type: formSat.type, date_recueil: formSat.date_recueil, commentaires: formSat.commentaires,
        inscription_id: formSat.inscription_id === "" ? null : Number(formSat.inscription_id),
        note_globale: formSat.note_globale === "" ? null : Number(formSat.note_globale),
        note_max: Number(formSat.note_max || 5),
        ...(formSat.fichier ? { drive_file_id: formSat.fichier.id } : {}),
      };
      if (formSat.id) await api(`/api/satisfactions/${formSat.id}`, { method: "PATCH", body: JSON.stringify(corps) });
      else await api(`/api/sessions/${sessionId}/satisfactions`, { method: "POST", body: JSON.stringify(corps) });
      setFormSat(null);
      erreur(null);
      await charger();
    } catch (e) { erreur(e.message); } finally { setOccupe(false); }
  }

  async function lireFichier(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const texte = await f.text();
    setTexteCsv(texte);
    setBilan(null);
    try {
      setApercu(await api(`/api/sessions/${sessionId}/evaluations/import-apercu`, { method: "POST", body: JSON.stringify({ texte }) }));
      erreur(null);
    } catch (err) { setApercu(null); erreur(err.message); }
    e.target.value = "";
  }

  async function confirmerImport() {
    setOccupe(true);
    try {
      const r = await api(`/api/sessions/${sessionId}/evaluations/import`, { method: "POST", body: JSON.stringify({ texte: texteCsv }) });
      setBilan(r.bilan);
      setApercu(null);
      setTexteCsv(null);
      erreur(null);
      await charger();
    } catch (e) { erreur(e.message); } finally { setOccupe(false); }
  }

  const selStagiaire = (value, onChange) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choisir…</option>
      {stagiaires.map((s) => (
        <option key={s.inscription_id} value={s.inscription_id}>{s.nom} {s.prenom}{s.email ? ` · ${s.email}` : ""}</option>
      ))}
    </select>
  );

  return (
    <div className="evaluations">
      {/* ── Évaluations ── */}
      <h4>Évaluations</h4>
      {evals && (
        <div className="tags">
          <span className="pill">{evals.agregation.total} résultat(s)</span>
          <span className="pill ok">{evals.agregation.valide} validé(s)</span>
          <span className="pill off">{evals.agregation.non_valide} non validé(s)</span>
          <span className="pill">{evals.agregation.non_determine} non déterminé(s)</span>
          <span className="pill">{evals.agregation.non_applicable} non applicable(s)</span>
        </div>
      )}
      {evals?.evaluations?.length
        ? <ul className="liste-simple">
            {evals.evaluations.map((e) => (
              <li key={e.id}>
                <div>
                  <strong>{e.intitule || TYPES[e.type]}</strong>
                  <div className="muted small">
                    {e.nom} {e.prenom} · {TYPES[e.type]} · {dateFr(e.date_passage)}
                    {e.score !== null && e.score !== undefined ? ` · ${e.score}/${e.score_max}` : " · sans note"}
                  </div>
                  <div className="tags">
                    <span className={"pill " + (e.resultat === "valide" ? "ok" : e.resultat === "non_valide" ? "off" : "")}>{RESULTATS[e.resultat] || e.resultat}</span>
                    {e.commentaire && <span className="muted small">{e.commentaire}</span>}
                    {e.drive_file_id && (
                      <a href={`https://drive.google.com/file/d/${e.drive_file_id}/view`} target="_blank" rel="noreferrer">fichier</a>
                    )}
                  </div>
                </div>
                {peutSaisir && (
                  <button className="btn petit" onClick={() => setFormEval({ id: e.id, inscription_id: String(e.inscription_id), type: e.type, intitule: e.intitule || "", date_passage: dateFr(e.date_passage), score: e.score ?? "", score_max: e.score_max ?? "", seuil_reussite: e.seuil_reussite ?? "", resultat: e.resultat, commentaire: e.commentaire || "", fichier: null })}>
                    Modifier
                  </button>
                )}
              </li>
            ))}
          </ul>
        : <p className="muted small">Aucune évaluation.</p>}

      {peutSaisir && !formEval && (
        <button className="btn petit" onClick={() => setFormEval(videEvaluation())}>Ajouter un résultat</button>
      )}
      {peutSaisir && formEval && (
        <div className="formulaire">
          {selStagiaire(formEval.inscription_id, (v) => setFormEval({ ...formEval, inscription_id: v }))}
          <select value={formEval.type} onChange={(e) => setFormEval({ ...formEval, type: e.target.value })}>
            {Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input placeholder="Intitulé (ex. QCM fin séance 1)" value={formEval.intitule} onChange={(e) => setFormEval({ ...formEval, intitule: e.target.value })} />
          <input type="date" value={formEval.date_passage} onChange={(e) => setFormEval({ ...formEval, date_passage: e.target.value })} />
          <input type="number" min="0" placeholder="Score" value={formEval.score} onChange={(e) => setFormEval({ ...formEval, score: e.target.value })} />
          <input type="number" min="1" placeholder="Score max" value={formEval.score_max} onChange={(e) => setFormEval({ ...formEval, score_max: e.target.value })} />
          <input type="number" min="0" placeholder="Seuil (facultatif)" value={formEval.seuil_reussite} onChange={(e) => setFormEval({ ...formEval, seuil_reussite: e.target.value })} />
          <select value={formEval.resultat} onChange={(e) => setFormEval({ ...formEval, resultat: e.target.value })}>
            {Object.entries(RESULTATS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <textarea rows={2} placeholder="Commentaire" value={formEval.commentaire} onChange={(e) => setFormEval({ ...formEval, commentaire: e.target.value })} />
          {admin && (
          <div>
            {formEval.fichier
              ? <span className="muted small">Fichier : {formEval.fichier.nom} <button className="link" onClick={() => setFormEval({ ...formEval, fichier: null })}>retirer</button></span>
              : <RechercheDrive surChoix={(f) => setFormEval({ ...formEval, fichier: f })} onErreur={erreur} placeholder="Preuve Drive (facultatif)" />}
          </div>
          )}
          <div className="preuve-actions">
            <button className="btn primary" onClick={enregistrerEvaluation} disabled={occupe}>Enregistrer</button>
            <button className="link" onClick={() => setFormEval(null)}>Annuler</button>
          </div>
        </div>
      )}

      {peutSaisir && (
        <div className="import-stagiaires">
          <input type="file" accept=".csv,text/csv" onChange={lireFichier} />
          <p className="muted small">Importer des résultats (Google Forms / Sheets) : email, type, intitulé, date, score, score_max (ou pourcentage), seuil, résultat, commentaire.</p>
          {apercu && (
            <>
              <div className="resume-import">
                <span className="pill ok">{apercu.resume.importables} importable(s)</span>
                <span className="pill off">{apercu.resume.invalides} invalide(s)</span>
                <span className="pill warn">{apercu.resume.aVerifier} à vérifier</span>
                <span className="pill warn">{apercu.resume.doublons} doublon(s)</span>
              </div>
              <ul className="liste-import">
                {apercu.lignes.map((l) => (
                  <li key={l.index} className={"import-" + (l.statut === "pret" ? "pret" : l.statut === "invalide" ? "invalide" : "a_verifier")}>
                    <span className="muted small">ligne {l.index + 1}</span>
                    <strong>{l.stagiaire ? `${l.stagiaire.nom} ${l.stagiaire.prenom}` : "—"}</strong>
                    <span className="muted small">{l.type} · {l.intitule} · {l.date}</span>
                    {l.normalisePourcentage && <span className="pill info">pourcentage → score/100</span>}
                    <span className={"pill " + (l.statut === "pret" ? "ok" : l.statut === "invalide" ? "off" : "warn")}>{STATUT_IMPORT[l.statut] || l.statut}</span>
                    {l.motif && <span className="muted small">{l.motif}</span>}
                  </li>
                ))}
              </ul>
              <div className="preuve-actions">
                <button className="btn primary" onClick={confirmerImport} disabled={occupe || apercu.resume.importables === 0}>
                  Confirmer ({apercu.resume.importables} résultat(s))
                </button>
                <button className="btn" onClick={() => { setApercu(null); setTexteCsv(null); }}>Annuler</button>
              </div>
            </>
          )}
          {bilan && <p className="flash ok">Import : {bilan.importes} importé(s), {bilan.ignores.length} ignoré(s).</p>}
        </div>
      )}

      {/* ── Satisfaction ── */}
      <h4>Satisfaction</h4>
      {sats && (
        <div className="tags">
          <span className="pill">{sats.agregation.reponses} réponse(s)</span>
          <span className="pill">{sats.agregation.anonymes} anonyme(s)</span>
          <span className="pill">{sats.agregation.nominatives} nominative(s)</span>
          {sats.agregation.moyenne !== null
            ? <span className="pill ok">Moyenne {sats.agregation.moyenne}/{sats.agregation.echelleHomogene}</span>
            : sats.agregation.reponses > 0 && <span className="pill warn">moyenne non calculable (échelles différentes)</span>}
        </div>
      )}
      {sats?.satisfactions?.length
        ? <ul className="liste-simple">
            {sats.satisfactions.map((f) => (
              <li key={f.id}>
                <div>
                  <strong>{f.nom ? `${f.nom} ${f.prenom}` : "Anonyme"}</strong>
                  <div className="muted small">
                    {TYPES_SAT[f.type]} · {dateFr(f.date_recueil)}
                    {f.note_globale !== null && f.note_globale !== undefined ? ` · ${f.note_globale}/${f.note_max}` : " · sans note"}
                  </div>
                  {f.commentaires && <div className="muted small">{f.commentaires}</div>}
                  {f.drive_file_id && (
                    <a href={`https://drive.google.com/file/d/${f.drive_file_id}/view`} target="_blank" rel="noreferrer">fichier</a>
                  )}
                </div>
                {peutSaisir && (
                  <button className="btn petit" onClick={() => setFormSat({ id: f.id, type: f.type, inscription_id: f.inscription_id ? String(f.inscription_id) : "", date_recueil: dateFr(f.date_recueil), note_globale: f.note_globale ?? "", note_max: String(f.note_max), commentaires: f.commentaires || "", fichier: null })}>
                    Modifier
                  </button>
                )}
              </li>
            ))}
          </ul>
        : <p className="muted small">Aucune réponse.</p>}

      {peutSaisir && !formSat && (
        <button className="btn petit" onClick={() => setFormSat(videSatisfaction())}>Ajouter une réponse</button>
      )}
      {peutSaisir && formSat && (
        <div className="formulaire">
          <select value={formSat.type} onChange={(e) => setFormSat({ ...formSat, type: e.target.value })}>
            {Object.entries(TYPES_SAT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select value={formSat.inscription_id} onChange={(e) => setFormSat({ ...formSat, inscription_id: e.target.value })}>
            <option value="">Anonyme</option>
            {stagiaires.map((s) => <option key={s.inscription_id} value={s.inscription_id}>{s.nom} {s.prenom}</option>)}
          </select>
          <input type="date" value={formSat.date_recueil} onChange={(e) => setFormSat({ ...formSat, date_recueil: e.target.value })} />
          <input type="number" min="0" step="0.1" placeholder="Note" value={formSat.note_globale} onChange={(e) => setFormSat({ ...formSat, note_globale: e.target.value })} />
          <input type="number" min="1" step="0.1" placeholder="Note max" value={formSat.note_max} onChange={(e) => setFormSat({ ...formSat, note_max: e.target.value })} />
          <textarea rows={2} placeholder="Commentaire" value={formSat.commentaires} onChange={(e) => setFormSat({ ...formSat, commentaires: e.target.value })} />
          {admin && (
          <div>
            {formSat.fichier
              ? <span className="muted small">Fichier : {formSat.fichier.nom} <button className="link" onClick={() => setFormSat({ ...formSat, fichier: null })}>retirer</button></span>
              : <RechercheDrive surChoix={(f) => setFormSat({ ...formSat, fichier: f })} onErreur={erreur} placeholder="Preuve Drive (facultatif)" />}
          </div>
          )}
          <div className="preuve-actions">
            <button className="btn primary" onClick={enregistrerSatisfaction} disabled={occupe}>Enregistrer</button>
            <button className="link" onClick={() => setFormSat(null)}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}
