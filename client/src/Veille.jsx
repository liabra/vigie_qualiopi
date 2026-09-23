import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { RechercheDrive } from "./RechercheDrive.jsx";

const TYPES = {
  legale_reglementaire: "Légale / réglementaire",
  metiers_competences: "Métiers / compétences",
  innovations_pedagogiques: "Innovations pédagogiques",
  handicap: "Handicap",
  autre: "Autre",
};
const STATUTS = {
  a_analyser: "À analyser",
  analysee: "Analysée",
  integree: "Intégrée",
  sans_impact: "Sans impact",
};
const STATUTS_ACTION = {
  aucune: "Aucune action",
  a_realiser: "À réaliser",
  realisee: "Réalisée",
};
const STATUTS_ORDRE = ["a_analyser", "analysee", "integree", "sans_impact"];
const vide = {
  type: "autre", titre: "", source: "", url: "", date_publication: "", date_effet: "",
  resume: "", analyse_impact: "", rupture_reglementaire: false, statut: "a_analyser",
  action: "", statut_action: "aucune", action_realisee_le: "", date_consultation: "",
  indicateur_ids: [],
};
const dateAffichee = (d) => (d ? String(d).slice(0, 10) : null);
const champOuVide = (v) => (v === null || v === undefined || v === "" ? "" : v);

export default function Veille({ admin }) {
  const [data, setData] = useState(null);
  const [indicateurs, setIndicateurs] = useState([]);
  const [err, setErr] = useState(null);
  const [filtres, setFiltres] = useState({ type: "", statut: "", statut_action: "", q: "" });
  const [detail, setDetail] = useState(null);   // { veille, preuves }
  const [edition, setEdition] = useState(null); // null | { id?, ...champs }
  const [enCours, setEnCours] = useState(false);
  // Preuve à rattacher (depuis le détail) : indicateur + fichier Drive.
  const [preuve, setPreuve] = useState(null);

  useEffect(() => {
    api("/api/indicateurs").then((r) => setIndicateurs(r.indicateurs || [])).catch(() => {});
    charger();
  }, []);

  async function charger() {
    const qs = new URLSearchParams();
    if (filtres.type) qs.set("type", filtres.type);
    if (filtres.statut) qs.set("statut", filtres.statut);
    if (filtres.statut_action) qs.set("statut_action", filtres.statut_action);
    if (filtres.q.trim()) qs.set("q", filtres.q.trim());
    try {
      setData(await api("/api/veille?" + qs.toString()));
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function ouvrirDetail(id) {
    try {
      setDetail(await api("/api/veille/" + id));
      setErr(null);
    } catch (e) {
      setErr(e.message);
    }
  }

  function ouvrirEdition(v) {
    setEdition(v ? {
      id: v.id, type: v.type, titre: v.titre, source: champOuVide(v.source), url: champOuVide(v.url),
      date_publication: dateAffichee(v.date_publication) || "", date_effet: dateAffichee(v.date_effet) || "",
      resume: champOuVide(v.resume), analyse_impact: champOuVide(v.analyse_impact),
      rupture_reglementaire: !!v.rupture_reglementaire, statut: v.statut,
      action: champOuVide(v.action), statut_action: v.statut_action,
      action_realisee_le: dateAffichee(v.action_realisee_le) || "", date_consultation: dateAffichee(v.date_consultation) || "",
      indicateur_ids: (v.indicateurs || []).map((i) => i.id),
    } : { ...vide, indicateur_ids: [] });
  }

  async function enregistrer() {
    if (!edition.titre.trim()) return setErr("Indiquez un titre.");
    setEnCours(true);
    try {
      const corps = {
        type: edition.type, titre: edition.titre, source: edition.source, url: edition.url,
        date_publication: edition.date_publication || null, date_effet: edition.date_effet || null,
        resume: edition.resume, analyse_impact: edition.analyse_impact,
        rupture_reglementaire: edition.rupture_reglementaire, statut: edition.statut,
        action: edition.action, statut_action: edition.statut_action,
        action_realisee_le: edition.action_realisee_le || null, date_consultation: edition.date_consultation || null,
        indicateur_ids: edition.indicateur_ids.map(Number),
      };
      if (edition.id) {
        await api("/api/veille/" + edition.id, { method: "PATCH", body: JSON.stringify(corps) });
        setEdition(null);
        setErr(null);
        if (detail) await ouvrirDetail(edition.id); else await charger();
      } else {
        await api("/api/veille", { method: "POST", body: JSON.stringify(corps) });
        setEdition(null);
        setErr(null);
        await charger();
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setEnCours(false);
    }
  }

  async function rattacherPreuve() {
    if (!preuve?.indicateur_id || !preuve?.fichier) return;
    setEnCours(true);
    try {
      await api("/api/preuves", {
        method: "POST",
        body: JSON.stringify({
          indicateur_id: Number(preuve.indicateur_id), veille_id: detail.veille.id,
          titre: preuve.titre || "Preuve d'action",
          mode_fichiers: "unique",
          drive_file_id: preuve.fichier.id, drive_url: preuve.fichier.url,
          drive_nom: preuve.fichier.nom, drive_mime: preuve.fichier.mime,
        }),
      });
      setPreuve(null);
      setErr(null);
      await ouvrirDetail(detail.veille.id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setEnCours(false);
    }
  }

  const statutsClasses = useMemo(() => {
    if (!data) return [];
    return STATUTS_ORDRE.map((s) => data.veilles.filter((v) => v.statut === s))
      .flat()
      .concat(data.veilles.filter((v) => !STATUTS_ORDRE.includes(v.statut)));
  }, [data]);

  if (err && !data) return <p className="flash erreur">Veille : {err}</p>;
  if (!data) return <p className="muted">Chargement de la veille…</p>;

  if (detail && !edition) {
    const v = detail.veille;
    return (
      <section>
        <div className="ref-head">
          <div>
            <h1>Veille — détail</h1>
            <p className="muted">{TYPES[v.type] || v.type}</p>
          </div>
          <button className="btn petit" onClick={() => { setDetail(null); charger(); }}>← Retour</button>
        </div>
        {err && <p className="flash erreur">{err}</p>}

        <article className="card">
          <div className="ref-head">
            <h2>{v.titre}</h2>
            {admin && <button className="btn petit" onClick={() => ouvrirEdition(v)}>Modifier</button>}
          </div>
          <p className="muted small">
            Source : {v.source || "—"} · {STATUTS[v.statut]} · Action : {STATUTS_ACTION[v.statut_action]}
          </p>

          {v.url && <p><a href={v.url} target="_blank" rel="noreferrer">{v.url}</a></p>}
          {v.date_publication && <p className="muted small">Publié le {dateAffichee(v.date_publication)}</p>}
          {v.date_effet && <p className="muted small">Effet au {dateAffichee(v.date_effet)}</p>}

          <h3>Résumé</h3>
          <p>{v.resume || <span className="muted">Non renseigné.</span>}</p>

          <h3>Analyse / impact</h3>
          <p>{v.analyse_impact || <span className="muted">Non renseignée.</span>}</p>
          {v.rupture_reglementaire && <p className="flash info">Rupture réglementaire signalée.</p>}

          <h3>Action</h3>
          <p>{v.action || <span className="muted">Aucune action.</span>}</p>
          <div className="tags">
            <span className="pill">{STATUTS_ACTION[v.statut_action]}</span>
            {v.action_realisee_le && <span className="pill">Réalisée le {dateAffichee(v.action_realisee_le)}</span>}
            {v.date_consultation && <span className="pill">Consultée le {dateAffichee(v.date_consultation)}</span>}
          </div>

          <h3>Indicateurs concernés</h3>
          {v.indicateurs?.length
            ? <div className="tags">{v.indicateurs.map((i) => <span key={i.id} className="pill">{i.numero} · {i.libelle}</span>)}</div>
            : <p className="muted">Aucun indicateur rattaché.</p>}

          <h3>Preuves</h3>
          {detail.preuves?.length
            ? <ul>{detail.preuves.map((p) => (
                <li key={p.id}>
                  {p.titre} <span className="muted small">· indicateur {p.indicateur_id}</span>
                  {(p.fichiers || []).map((f) => (
                    <span key={f.id}> · <a href={f.url} target="_blank" rel="noreferrer">{f.nom || f.drive_file_id}</a></span>
                  ))}
                </li>
              ))}</ul>
            : <p className="muted">Aucune preuve rattachée.</p>}

          {admin && !preuve && (
            <button className="btn" onClick={() => setPreuve({ indicateur_id: (v.indicateurs || [])[0]?.id || "", titre: "", fichier: null })}>
              Rattacher une preuve
            </button>
          )}
          {admin && preuve && (
            <div className="card">
              <h4>Rattacher une preuve</h4>
              <label>
                Indicateur
                <select value={preuve.indicateur_id} onChange={(e) => setPreuve({ ...preuve, indicateur_id: e.target.value })}>
                  <option value="">— Choisir —</option>
                  {(v.indicateurs || []).map((i) => <option key={i.id} value={i.id}>{i.numero} · {i.libelle}</option>)}
                </select>
              </label>
              <label>
                Titre de la preuve
                <input value={preuve.titre} onChange={(e) => setPreuve({ ...preuve, titre: e.target.value })} />
              </label>
              <RechercheDrive
                surChoix={(f) => setPreuve({ ...preuve, fichier: f })}
                onErreur={setErr}
                placeholder="Chercher un fichier sur le Drive"
              />
              {preuve.fichier && <p className="muted small">Fichier : {preuve.fichier.nom}</p>}
              <button className="btn" disabled={!preuve.indicateur_id || !preuve.fichier || enCours} onClick={rattacherPreuve}>
                Enregistrer la preuve
              </button>
              <button className="link" onClick={() => setPreuve(null)}>Annuler</button>
            </div>
          )}
        </article>
      </section>
    );
  }

  if (edition) {
    return (
      <section>
        <div className="ref-head">
          <h1>{edition.id ? "Modifier la veille" : "Nouvelle veille"}</h1>
          <button className="btn petit" onClick={() => setEdition(null)}>← Retour</button>
        </div>
        {err && <p className="flash erreur">{err}</p>}
        <article className="card formulaire">
          <label>Type
            <select value={edition.type} onChange={(e) => setEdition({ ...edition, type: e.target.value })}>
              {Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label>Titre
            <input value={edition.titre} onChange={(e) => setEdition({ ...edition, titre: e.target.value })} />
          </label>
          <label>Source
            <input value={edition.source} onChange={(e) => setEdition({ ...edition, source: e.target.value })} />
          </label>
          <label>Lien
            <input value={edition.url} onChange={(e) => setEdition({ ...edition, url: e.target.value })} />
          </label>
          <label>Date de publication
            <input type="date" value={edition.date_publication} onChange={(e) => setEdition({ ...edition, date_publication: e.target.value })} />
          </label>
          <label>Date d'effet
            <input type="date" value={edition.date_effet} onChange={(e) => setEdition({ ...edition, date_effet: e.target.value })} />
          </label>
          <label>Date de consultation
            <input type="date" value={edition.date_consultation} onChange={(e) => setEdition({ ...edition, date_consultation: e.target.value })} />
          </label>
          <label>Résumé
            <textarea value={edition.resume} onChange={(e) => setEdition({ ...edition, resume: e.target.value })} />
          </label>
          <label>Analyse / impact
            <textarea value={edition.analyse_impact} onChange={(e) => setEdition({ ...edition, analyse_impact: e.target.value })} />
          </label>
          <label className="check">
            <input type="checkbox" checked={edition.rupture_reglementaire}
              onChange={(e) => setEdition({ ...edition, rupture_reglementaire: e.target.checked })} />
            Rupture réglementaire
          </label>
          <label>Statut de la veille
            <select value={edition.statut} onChange={(e) => setEdition({ ...edition, statut: e.target.value })}>
              {Object.entries(STATUTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label>Action à mener
            <textarea value={edition.action} onChange={(e) => setEdition({ ...edition, action: e.target.value })} />
          </label>
          <label>Statut de l'action
            <select value={edition.statut_action} onChange={(e) => setEdition({ ...edition, statut_action: e.target.value })}>
              {Object.entries(STATUTS_ACTION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          {edition.statut_action === "realisee" && (
            <label>Date de réalisation
              <input type="date" value={edition.action_realisee_le} onChange={(e) => setEdition({ ...edition, action_realisee_le: e.target.value })} />
            </label>
          )}
          <label>Indicateurs concernés
            <select multiple value={edition.indicateur_ids.map(String)}
              onChange={(e) => setEdition({ ...edition, indicateur_ids: [...e.target.selectedOptions].map((o) => Number(o.value)) })}>
              {indicateurs.map((i) => <option key={i.id} value={i.id}>{i.numero} · {i.libelle}</option>)}
            </select>
          </label>
          <div className="actions">
            <button className="btn" disabled={enCours} onClick={enregistrer}>Enregistrer</button>
            <button className="link" onClick={() => setEdition(null)}>Annuler</button>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section>
      <div className="ref-head">
        <div>
          <h1>Veille Qualiopi</h1>
          <p className="muted">{data.total} entrée(s)</p>
        </div>
        {admin && <button className="btn" onClick={() => ouvrirEdition(null)}>Nouvelle veille</button>}
      </div>
      {err && <p className="flash erreur">{err}</p>}
      <form className="filtres" onSubmit={(e) => { e.preventDefault(); charger(); }}>
        <select value={filtres.type} onChange={(e) => setFiltres({ ...filtres, type: e.target.value })}>
          <option value="">Tous les types</option>
          {Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={filtres.statut} onChange={(e) => setFiltres({ ...filtres, statut: e.target.value })}>
          <option value="">Tous les statuts</option>
          {Object.entries(STATUTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={filtres.statut_action} onChange={(e) => setFiltres({ ...filtres, statut_action: e.target.value })}>
          <option value="">Toutes les actions</option>
          {Object.entries(STATUTS_ACTION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input type="search" value={filtres.q} onChange={(e) => setFiltres({ ...filtres, q: e.target.value })} placeholder="Rechercher…" />
        <button className="btn petit">Filtrer</button>
      </form>

      {statutsClasses.length === 0
        ? <p className="muted">Aucune entrée de veille.</p>
        : <ol className="indicateurs">
            {statutsClasses.map((v) => (
              <li key={v.id}>
                <span className={"ind-num statut-" + v.statut} title={STATUTS[v.statut]}>{v.statut.slice(0, 1).toUpperCase()}</span>
                <div className="veille-ligne">
                  <button className="link titre" onClick={() => ouvrirDetail(v.id)}>{v.titre}</button>
                  <div className="tags">
                    <span className="pill">{TYPES[v.type] || v.type}</span>
                    <span className="pill">{STATUTS[v.statut]}</span>
                    <span className="pill">Action : {STATUTS_ACTION[v.statut_action]}</span>
                    {v.indicateurs?.length > 0 && <span className="pill">{v.indicateurs.length} indicateur(s)</span>}
                  </div>
                </div>
              </li>
            ))}
          </ol>}
    </section>
  );
}
