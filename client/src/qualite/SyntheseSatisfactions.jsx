import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { formaterDate } from "../sessions/format.js";
import { FormulaireAction } from "./FormulaireAction.jsx";
import {
  MSG_TAUX_INDISPONIBLE, PUBLICS_SATISFACTION, libellePublic, moyenneSurEchelle, requeteSynthese,
} from "./satisfaction-format.js";

const VIDE = { du: "", au: "", formation_id: "", type: "", session_id: "" };

// /synthese-satisfactions (ADMIN) : consolidation multi-sessions des
// satisfactions. Faits seulement — comptes, répartitions et moyennes PAR
// échelle (jamais mélangées). Aucune réponse individuelle ici : chaque
// session renvoie à son onglet Satisfaction. Aucune action automatique.
export function SyntheseSatisfactions() {
  useTitrePage("Synthèse des satisfactions");
  const [filtres, setFiltres] = useState(VIDE);
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [formations, setFormations] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [action, setAction] = useState(false);
  const [creee, setCreee] = useState(null);

  const charger = useCallback(async (f) => {
    try { setD(await api(`/api/qualite/satisfactions/synthese${requeteSynthese(f)}`)); setErr(null); }
    catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(VIDE); }, [charger]);
  useEffect(() => {
    api("/api/formations").then((r) => setFormations(r.formations || [])).catch(() => setFormations([]));
    Promise.all([api("/api/sessions"), api("/api/sessions?etat=archivees")])
      .then(([a, b]) => setSessions([...(a.sessions || []), ...(b.sessions || [])]))
      .catch(() => setSessions([]));
  }, []);

  const changer = (cle) => (e) => {
    const f = { ...filtres, [cle]: e.target.value };
    if (cle === "formation_id") f.session_id = "";
    setFiltres(f);
    charger(f);
  };
  const formationChoisie = formations.find((f) => String(f.id) === String(filtres.formation_id));
  const sessionsFiltrees = formationChoisie ? sessions.filter((s) => s.formation === formationChoisie.intitule) : sessions;
  const actifs = Object.values(filtres).some(Boolean);
  // Provenance d'une action créée depuis cette synthèse : période effective,
  // public, formation / session seulement si filtrées (jamais inventées).
  const provenance = d && d.reponses > 0 ? {
    mode: "synthese",
    du: filtres.du || d.periode.du, au: filtres.au || d.periode.au, type: filtres.type || null,
    formation_id: filtres.formation_id ? Number(filtres.formation_id) : null,
    session_id: filtres.session_id ? Number(filtres.session_id) : null,
  } : null;

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Qualité" }, { libelle: "Synthèse des satisfactions" }]}
        titre="Synthèse des satisfactions"
        description="Les retours des parties prenantes, toutes sessions confondues. Les moyennes ne mélangent jamais des échelles différentes."
        actions={provenance && <Button variante="primary" onClick={() => { setCreee(null); setAction(true); }}>Créer une action qualité</Button>}
      />
      <section className="qualite-section" aria-label="Filtres">
        <FormSection titre="Filtres" colonnes={3}>
          <Field label="Du"><input type="date" value={filtres.du} onChange={changer("du")} /></Field>
          <Field label="Au"><input type="date" value={filtres.au} onChange={changer("au")} /></Field>
          <Field label="Public interrogé">
            <select value={filtres.type} onChange={changer("type")}>
              <option value="">Tous les publics</option>
              {Object.entries(PUBLICS_SATISFACTION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Formation">
            <select value={filtres.formation_id} onChange={changer("formation_id")}>
              <option value="">Toutes les formations</option>
              {formations.map((f) => <option key={f.id} value={f.id}>{f.intitule}</option>)}
            </select>
          </Field>
          <Field label="Session" facultatif>
            <select value={filtres.session_id} onChange={changer("session_id")}>
              <option value="">Toutes les sessions</option>
              {sessionsFiltrees.map((s) => <option key={s.id} value={s.id}>{s.reference} — {s.formation}</option>)}
            </select>
          </Field>
        </FormSection>
        {actifs && <Button compact variante="ghost" onClick={() => { setFiltres(VIDE); charger(VIDE); }}>Effacer les filtres</Button>}
      </section>

      {creee && <Alert ton="success" titre="Action qualité créée.">L'action <Link to={`/actions-qualite/${creee.id}`}>{creee.reference}</Link> a été créée. Aucune réponse individuelle n'y a été recopiée.</Alert>}
      {err && <Alert ton="error" titre="La synthèse n'a pas pu être chargée." action={<Button compact onClick={() => charger(filtres)}>Réessayer</Button>}>{err}</Alert>}
      {!d && !err && <LoadingState texte="Chargement de la synthèse…" />}
      {d && (d.reponses === 0 ? (
        <EmptyState titre="Aucune réponse pour ces critères">
          {actifs ? "Élargissez la période ou retirez un filtre." : "Les réponses saisies ou importées dans l'onglet Satisfaction des sessions apparaîtront ici."}
        </EmptyState>
      ) : (
        <div className="tdb">
          <section className="qualite-section" aria-labelledby="syn-chiffres">
            <h2 id="syn-chiffres" className="qualite-section__titre">Vue d'ensemble</h2>
            <dl className="sess-chiffres">
              <div><dt>Réponses</dt><dd>{d.reponses}</dd></div>
              <div><dt>Période des réponses</dt><dd>du {formaterDate(d.periode.du)} au {formaterDate(d.periode.au)}</dd></div>
              <div><dt>Sessions concernées</dt><dd>{d.sessions.length}</dd></div>
              <div><dt>Taux de réponse</dt><dd>{d.taux.disponible ? d.taux.valeur : MSG_TAUX_INDISPONIBLE}</dd></div>
            </dl>
            <p className="sess-secondaire">Le nombre de personnes réellement sollicitées n'est pas enregistré : l'effectif d'une session n'est pas utilisé comme dénominateur.</p>
          </section>

          <section className="qualite-section" aria-labelledby="syn-publics">
            <h2 id="syn-publics" className="qualite-section__titre">Répartition par public</h2>
            <table className="sess-table">
              <caption className="visually-hidden">Réponses par public</caption>
              <thead><tr><th scope="col">Public interrogé</th><th scope="col" className="sess-num">Réponses</th></tr></thead>
              <tbody>{d.publics.map((p) => (
                <tr key={p.type}><td data-label="Public interrogé" className="sess-table__principal">{libellePublic(p.type)}</td><td data-label="Réponses" className="sess-num">{p.reponses}</td></tr>
              ))}</tbody>
            </table>
          </section>

          <section className="qualite-section" aria-labelledby="syn-notes">
            <h2 id="syn-notes" className="qualite-section__titre">Notes par échelle</h2>
            {d.echelles.length > 1 && <Alert ton="info">Plusieurs échelles de notation : une moyenne par échelle, sans moyenne globale (non calculable).</Alert>}
            {d.echelles.length === 0 ? <p className="sess-secondaire">Aucune note enregistrée pour ces critères.</p> : d.echelles.map((e) => (
              <div key={e.echelle} className="qualite-fiche">
                <h3 className="accompagnement-sections__titre">Échelle sur {e.echelle}</h3>
                <p>Moyenne : <strong>{moyenneSurEchelle(e.moyenne, e.echelle)}</strong> <span className="sess-secondaire">({e.reponses} note(s))</span></p>
                <table className="sess-table">
                  <caption className="visually-hidden">Répartition des notes sur {e.echelle}</caption>
                  <thead><tr><th scope="col">Note</th><th scope="col" className="sess-num">Réponses</th></tr></thead>
                  <tbody>{e.repartition.map((r) => (
                    <tr key={r.note}><td data-label="Note">{String(r.note).replace(".", ",")} / {e.echelle}</td><td data-label="Réponses" className="sess-num">{r.reponses}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ))}
            {d.sans_note > 0 && <p className="sess-secondaire">{d.sans_note} réponse(s) sans note.</p>}
          </section>

          <section className="qualite-section" aria-labelledby="syn-sessions">
            <h2 id="syn-sessions" className="qualite-section__titre">Sessions concernées</h2>
            <table className="sess-table">
              <caption className="visually-hidden">Sessions concernées</caption>
              <thead><tr><th scope="col">Session</th><th scope="col">Formation</th><th scope="col" className="sess-num">Réponses</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
              <tbody>{d.sessions.map((s) => (
                <tr key={s.id}>
                  <td data-label="Session" className="sess-table__principal">{s.reference}<span className="sess-secondaire">du {formaterDate(s.date_debut)} au {formaterDate(s.date_fin)}</span></td>
                  <td data-label="Formation">{s.formation}</td>
                  <td data-label="Réponses" className="sess-num">{s.reponses}</td>
                  <td className="sess-table__actions"><Link className="ui-btn ui-btn--compact" to={`/sessions/${s.id}/satisfaction`} aria-label={`Ouvrir les réponses de la session ${s.reference}`}>Ouvrir la session</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </section>
          <p className="sess-secondaire">Vigie présente les résultats ; l'appréciation et la décision d'agir restent humaines (aucune action ni non-conformité automatique).</p>
        </div>
      ))}

      {action && provenance && (
        <FormulaireAction satisfactionSource={provenance} onFermer={() => setAction(false)}
          onEnregistre={(a) => { setAction(false); setCreee(a); }} />
      )}
    </>
  );
}
