import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

const STATUTS = {
  maitrise: "Maîtrisé",
  a_consolider: "À consolider",
  a_risque: "À risque",
  non_applicable: "Non applicable",
};

// Rattachement d'une preuve : candidats proposés par l'import, sinon
// recherche libre sur le Drive. Jamais de ressaisie du nom à la main.
function Rattachement({ preuve, onChange }) {
  const [q, setQ] = useState("");
  const [trouves, setTrouves] = useState(null);
  const [cherche, setCherche] = useState(false);

  async function rechercher(e) {
    e.preventDefault();
    if (q.trim().length < 3) return;
    setCherche(true);
    try {
      const r = await api("/api/drive/recherche?q=" + encodeURIComponent(q.trim()));
      setTrouves(r.fichiers);
    } catch (err) {
      setTrouves([]);
      onChange.erreur(err.message);
    } finally {
      setCherche(false);
    }
  }

  const lier = (f) => onChange.lier(preuve, f);
  const candidats = preuve.candidats || [];

  return (
    <div className="rattachement">
      {candidats.length > 0 && (
        <div className="candidats">
          <span className="muted small">Proposés :</span>
          {candidats.map((c) => (
            <button key={c.id} className="btn petit" onClick={() => lier(c)} title={c.chemin}>
              {c.nom.slice(0, 48)} <span className="muted">· {c.score}%</span>
            </button>
          ))}
        </div>
      )}
      <form className="recherche-drive" onSubmit={rechercher}>
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Chercher un autre fichier sur le Drive" aria-label="Chercher sur le Drive"
        />
        <button className="btn petit" disabled={cherche || q.trim().length < 3}>{cherche ? "…" : "Chercher"}</button>
      </form>
      {trouves && (
        trouves.length
          ? <div className="candidats">{trouves.map((f) => (
              <button key={f.id} className="btn petit" onClick={() => lier(f)}>{f.nom.slice(0, 48)}</button>
            ))}</div>
          : <p className="muted small">Aucun fichier trouvé.</p>
      )}
    </div>
  );
}

function LignePreuve({ p, actions, admin }) {
  return (
    <li className={"preuve" + (p.a_confirmer ? " a-confirmer" : "")}>
      <div className="preuve-tete">
        <span className="ind-num petit" title={`Critère ${p.critere}`}>{p.indicateur}</span>
        <div className="preuve-titre">
          <strong>{p.titre}</strong>
          <div className="muted small">
            {p.drive_url
              ? <a href={p.drive_url} target="_blank" rel="noreferrer">{p.drive_nom || "Ouvrir sur le Drive"}</a>
              : <span className="text-erreur">{p.motif_confirmation || "Pas de fichier Drive rattaché"}</span>}
            {p.etat_source && <> · classeur : « {p.etat_source} »</>}
            {p.occurrences > 1 && <> · {p.occurrences} lignes</>}
          </div>
        </div>
        {admin ? (
          <select value={p.statut} onChange={(e) => actions.statut(p, e.target.value)} aria-label="Statut">
            {Object.entries(STATUTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        ) : <span className={"pill statut-" + p.statut}>{STATUTS[p.statut]}</span>}
      </div>
      {admin && p.a_confirmer && (
        <>
          <Rattachement preuve={p} onChange={actions} />
          <div className="preuve-actions">
            <button className="btn petit" onClick={() => actions.confirmer(p)}>Confirmer sans fichier</button>
            <button className="btn petit danger" onClick={() => actions.supprimer(p)}>Supprimer</button>
          </div>
        </>
      )}
    </li>
  );
}

export default function Preuves({ admin, onChange }) {
  const [data, setData] = useState(null);
  const [filtre, setFiltre] = useState({ a_confirmer: false, statut: "", q: "" });
  const [err, setErr] = useState(null);
  const [dernier, setDernier] = useState(null);
  const [occupe, setOccupe] = useState(null);
  const [apercu, setApercu] = useState(null);

  const charger = useCallback(async () => {
    const p = new URLSearchParams();
    if (filtre.a_confirmer) p.set("a_confirmer", "1");
    if (filtre.statut) p.set("statut", filtre.statut);
    if (filtre.q.trim()) p.set("q", filtre.q.trim());
    try {
      setData(await api("/api/preuves?" + p));
    } catch (e) { setErr(e.message); }
  }, [filtre]);

  useEffect(() => { charger(); }, [charger]);
  useEffect(() => {
    if (admin) api("/api/import/dernier").then((r) => setDernier(r.import)).catch(() => {});
  }, [admin]);

  async function lancerImport(enApercu) {
    setOccupe(enApercu ? "apercu" : "import");
    setErr(null);
    try {
      const r = await api("/api/import/classeur", { method: "POST", body: JSON.stringify({ apercu: enApercu }) });
      if (enApercu) setApercu(r);
      else {
        setApercu(null);
        setDernier(await api("/api/import/dernier").then((x) => x.import));
        await charger();
        onChange?.();
      }
    } catch (e) { setErr(e.message); }
    finally { setOccupe(null); }
  }

  const majLocale = (p, champs) =>
    setData((d) => ({ ...d, preuves: d.preuves.map((x) => (x.id === p.id ? { ...x, ...champs } : x)) }));

  const actions = {
    erreur: setErr,
    async statut(p, statut) {
      majLocale(p, { statut });
      await api(`/api/preuves/${p.id}`, { method: "PATCH", body: JSON.stringify({ statut }) }).catch((e) => setErr(e.message));
      onChange?.();
    },
    async lier(p, f) {
      majLocale(p, { drive_file_id: f.id, drive_url: f.url, drive_nom: f.nom, a_confirmer: false });
      await api(`/api/preuves/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ drive_file_id: f.id, drive_url: f.url, drive_nom: f.nom, confirmer: true }),
      }).catch((e) => setErr(e.message));
      onChange?.();
    },
    async confirmer(p) {
      majLocale(p, { a_confirmer: false });
      await api(`/api/preuves/${p.id}`, { method: "PATCH", body: JSON.stringify({ confirmer: true }) }).catch((e) => setErr(e.message));
      onChange?.();
    },
    async supprimer(p) {
      if (!window.confirm(`Supprimer la preuve « ${p.titre} » ?`)) return;
      setData((d) => ({ ...d, preuves: d.preuves.filter((x) => x.id !== p.id) }));
      await api(`/api/preuves/${p.id}`, { method: "DELETE" }).catch((e) => setErr(e.message));
      onChange?.();
    },
  };

  const aConfirmer = data?.preuves.filter((p) => p.a_confirmer).length || 0;

  return (
    <section className="preuves">
      <div className="ref-head">
        <div>
          <h1>Preuves</h1>
          <p className="muted">
            {data ? `${data.total} preuve(s)` : "Chargement…"}
            {aConfirmer > 0 && <span className="text-erreur"> · {aConfirmer} à confirmer</span>}
          </p>
        </div>
        {admin && (
          <div className="import-actions">
            <button className="btn" onClick={() => lancerImport(true)} disabled={!!occupe}>
              {occupe === "apercu" ? "Lecture…" : "Aperçu du classeur"}
            </button>
            <button className="btn primary" onClick={() => lancerImport(false)} disabled={!!occupe}>
              {occupe === "import" ? "Import…" : "Importer le classeur"}
            </button>
          </div>
        )}
      </div>

      {err && <p className="flash erreur">{err}</p>}

      {apercu && (
        <div className="card apercu">
          <strong>Aperçu — rien n'a été enregistré</strong>
          <p className="muted small">
            Classeur « {apercu.fichier.nom} », onglet « {apercu.onglet} » · {apercu.lignesLues} lignes lues ·{" "}
            {apercu.preuves} preuves ({apercu.aConfirmer} à confirmer) · {apercu.nbIgnorees} lignes ignorées
          </p>
          <p className="muted small">En-têtes lus : {apercu.entetes.filter(Boolean).join(" | ")}</p>
        </div>
      )}

      {dernier && (
        <p className="muted small">
          Dernier import : {dernier.fichier_nom} (onglet {dernier.onglet}) ·{" "}
          {dernier.preuves_creees} créée(s), {dernier.preuves_majes} mise(s) à jour ·{" "}
          {new Date(dernier.demarre_le).toLocaleString("fr-FR")}
        </p>
      )}

      <div className="filtres">
        <label><input type="checkbox" checked={filtre.a_confirmer}
          onChange={(e) => setFiltre({ ...filtre, a_confirmer: e.target.checked })} /> À confirmer d'abord</label>
        <select value={filtre.statut} onChange={(e) => setFiltre({ ...filtre, statut: e.target.value })} aria-label="Filtrer par statut">
          <option value="">Tous les statuts</option>
          {Object.entries(STATUTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input className="search" type="search" placeholder="Rechercher un document"
          value={filtre.q} onChange={(e) => setFiltre({ ...filtre, q: e.target.value })} />
      </div>

      {data && data.preuves.length === 0 && (
        <p className="muted">Aucune preuve. {admin && "Lancez l'import du classeur pour peupler le tableau de bord."}</p>
      )}
      <ul className="liste-preuves">
        {data?.preuves.map((p) => <LignePreuve key={p.id} p={p} actions={actions} admin={admin} />)}
      </ul>
    </section>
  );
}
