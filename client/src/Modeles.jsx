import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

const PORTEES = {
  formation: "Formation — un document par formation",
  session: "Session — un document par session",
  groupe: "Groupe — un document par groupe",
  stagiaire: "Stagiaire — un document par stagiaire",
};

export default function Modeles({ admin }) {
  const [modeles, setModeles] = useState([]);
  const [marqueurs, setMarqueurs] = useState([]);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState({ nom: "", lien: "", portee: "stagiaire", indicateurs: "", description: "" });

  const charger = useCallback(async () => {
    try {
      const r = await api("/api/modeles");
      setModeles(r.modeles);
      setMarqueurs(r.marqueurs || []);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  async function enregistrer() {
    const numeros = form.indicateurs.split(/[\s,;]+/).map(Number).filter((n) => n > 0);
    if (!form.nom.trim()) return setErr("Donnez un nom au modèle.");
    if (!form.lien.trim()) return setErr("Collez le lien ou l'identifiant du fichier Drive.");
    if (!numeros.length) return setErr("Indiquez au moins un numéro d'indicateur.");
    try {
      await api("/api/modeles", { method: "POST", body: JSON.stringify({ ...form, indicateurs: numeros }) });
      setForm({ nom: "", lien: "", portee: "stagiaire", indicateurs: "", description: "" });
      setErr(null);
      charger();
    } catch (e) { setErr(e.message); }
  }

  async function retirer(m) {
    if (!window.confirm(`Retirer le modèle « ${m.nom} » ? Les documents déjà générés ne sont pas touchés.`)) return;
    await api(`/api/modeles/${m.id}`, { method: "DELETE" }).catch((e) => setErr(e.message));
    charger();
  }

  return (
    <section className="modeles">
      <h1>Modèles de documents</h1>
      <p className="muted">
        Un modèle est un Google Doc ou Sheet existant sur le Drive. La génération en fait une copie
        et y remplace les marqueurs ci-dessous. Le modèle d'origine n'est jamais modifié.
      </p>
      {err && <p className="flash erreur">{err}</p>}

      {marqueurs.length > 0 && (
        <div className="card apercu">
          <strong>Marqueurs reconnus</strong>
          <p className="muted small">
            Écrivez-les tels quels dans le modèle. Un marqueur absent de cette liste n'est pas
            remplacé et restera visible dans le document produit.
          </p>
          <div className="tags">
            {marqueurs.map((m) => <code key={m} className="pill">{"{{" + m + "}}"}</code>)}
          </div>
        </div>
      )}

      <ul className="liste-simple">
        {modeles.map((m) => (
          <li key={m.id}>
            <div>
              <strong>{m.nom}</strong>
              <div className="muted small">
                portée {m.portee} · indicateur(s) {m.indicateurs.map((i) => i.numero).join(", ") || "—"} ·{" "}
                <a href={m.drive_url} target="_blank" rel="noreferrer">voir sur le Drive</a>
              </div>
            </div>
            {admin && <button className="btn petit danger" onClick={() => retirer(m)}>Retirer</button>}
          </li>
        ))}
        {modeles.length === 0 && <li className="muted">Aucun modèle enregistré.</li>}
      </ul>

      {admin && (
        <div className="formulaire">
          <strong>Enregistrer un modèle</strong>
          <label className="champ">
            <span className="muted small">Nom</span>
            <input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} placeholder="Convocation" />
          </label>
          <label className="champ">
            <span className="muted small">Lien ou identifiant Drive</span>
            <input value={form.lien} onChange={(e) => setForm({ ...form, lien: e.target.value })}
              placeholder="https://docs.google.com/document/d/…/edit" />
          </label>
          <label className="champ">
            <span className="muted small">Portée</span>
            <select value={form.portee} onChange={(e) => setForm({ ...form, portee: e.target.value })}>
              {Object.entries(PORTEES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="champ">
            <span className="muted small">Indicateur(s) Qualiopi — numéros séparés par des virgules</span>
            <input value={form.indicateurs} onChange={(e) => setForm({ ...form, indicateurs: e.target.value })} placeholder="9, 11" />
          </label>
          <label className="champ">
            <span className="muted small">Description</span>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <button className="btn primary" onClick={enregistrer}>Enregistrer le modèle</button>
        </div>
      )}
    </section>
  );
}
