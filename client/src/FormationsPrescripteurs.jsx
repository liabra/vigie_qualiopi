// Formations (catalogue) et Prescripteurs : écrans de PARAMÉTRAGE (admin),
// sortis de l'ancien Sessions.jsx en UX-2, code inchangé.
import { useState } from "react";
import { api } from "./api.js";

const MODALITES = { presentiel: "Présentiel", distanciel: "Distanciel", mixte: "Mixte" };

// Petit formulaire repliable : la Phase 2 en compte beaucoup, autant
// qu'ils se ressemblent tous.
function Bloc({ titre, ouvertParDefaut = false, children }) {
  const [ouvert, setOuvert] = useState(ouvertParDefaut);
  return (
    <section className="card bloc">
      <button className="bloc-tete" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert}>
        <strong>{titre}</strong><span className="muted">{ouvert ? "−" : "+"}</span>
      </button>
      {ouvert && <div className="bloc-corps">{children}</div>}
    </section>
  );
}

function Champ({ label, ...props }) {
  return (
    <label className="champ">
      <span className="muted small">{label}</span>
      {props.multiligne
        ? <textarea rows={props.rows || 3} {...props} multiligne={undefined} />
        : <input {...props} />}
    </label>
  );
}

// ── Formations ───────────────────────────────────────────────
export function Formations({ formations, onChange, erreur, ouvert }) {
  const [form, setForm] = useState({ intitule: "", code_interne: "", duree_heures_defaut: "", modalite: "presentiel" });
  const [edite, setEdite] = useState(null);

  const champs = (f, set) => (
    <>
      <Champ label="Intitulé" value={f.intitule || ""} onChange={(e) => set({ ...f, intitule: e.target.value })} />
      <Champ label="Code interne" value={f.code_interne || ""} onChange={(e) => set({ ...f, code_interne: e.target.value })} />
      <Champ label="Durée par défaut (heures)" type="number" min="0" value={f.duree_heures_defaut || ""}
        onChange={(e) => set({ ...f, duree_heures_defaut: e.target.value })} />
      <label className="champ">
        <span className="muted small">Modalité</span>
        <select value={f.modalite || "presentiel"} onChange={(e) => set({ ...f, modalite: e.target.value })}>
          {Object.entries(MODALITES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <p className="muted small">
        Programme, scénario pédagogique et compétences visées : à rattacher comme preuves
        (indicateurs 5 et 6) plutôt qu'à saisir ici.
      </p>
    </>
  );

  async function creer() {
    if (!form.intitule.trim()) return erreur("Indiquez au moins un intitulé.");
    try {
      await api("/api/formations", { method: "POST", body: JSON.stringify(form) });
      setForm({ intitule: "", code_interne: "", duree_heures_defaut: "", modalite: "presentiel" });
      onChange();
    } catch (e) { erreur(e.message); }
  }

  async function enregistrerRevision() {
    try {
      await api(`/api/formations/${edite.id}`, { method: "PUT", body: JSON.stringify(edite) });
      setEdite(null);
      onChange();
    } catch (e) { erreur(e.message); }
  }

  return (
    // Sans formation, rien d'autre n'est possible : le bloc s'ouvre seul.
    <Bloc titre={`Formations (${formations.length})`} ouvertParDefaut={ouvert ?? formations.length === 0}>
      <ul className="liste-simple">
        {formations.map((f) => (
          <li key={f.id}>
            <div>
              <strong>{f.intitule}</strong>
              <div className="muted small">
                version {f.version_numero || "—"} sur {f.nb_versions} · {f.nb_sessions} session(s)
                {f.duree_heures_defaut && <> · {f.duree_heures_defaut} h</>}
              </div>
            </div>
            <button className="btn petit" onClick={() => setEdite({ ...f })}>Réviser</button>
          </li>
        ))}
        {formations.length === 0 && <li className="muted">Aucune formation.</li>}
      </ul>

      {edite && (
        <div className="formulaire">
          <p className="flash info">
            Réviser crée une <strong>nouvelle version</strong>. Les sessions déjà créées gardent la leur.
          </p>
          {champs(edite, setEdite)}
          <div className="preuve-actions">
            <button className="btn primary" onClick={enregistrerRevision}>Enregistrer la révision</button>
            <button className="btn" onClick={() => setEdite(null)}>Annuler</button>
          </div>
        </div>
      )}

      {!edite && (
        <div className="formulaire">
          <strong>Nouvelle formation</strong>
          {champs(form, setForm)}
          <button className="btn primary" onClick={creer}>Créer la formation</button>
        </div>
      )}
    </Bloc>
  );
}

// ── Gestion des prescripteurs (admin) ────────────────────────
// Petite liste configurable : afficher, ajouter, renommer, désactiver.
// La désactivation ne touche pas les inscriptions passées ; un prescripteur
// inactif n'est plus proposé aux nouvelles inscriptions.
export function GestionPrescripteurs({ prescripteurs, onChange, erreur, ouvert = false }) {
  const [nom, setNom] = useState("");
  const [edite, setEdite] = useState(null);

  async function ajouter() {
    if (!nom.trim()) return erreur("Indiquez un nom de prescripteur.");
    try {
      await api("/api/prescripteurs", { method: "POST", body: JSON.stringify({ nom }) });
      setNom("");
      erreur(null);
      await onChange();
    } catch (e) { erreur(e.message); }
  }

  async function renommer(p) {
    if (!p.nom.trim()) return erreur("Le nom ne peut pas être vide.");
    try {
      await api(`/api/prescripteurs/${p.id}`, { method: "PATCH", body: JSON.stringify({ nom: p.nom }) });
      setEdite(null);
      erreur(null);
      await onChange();
    } catch (e) { erreur(e.message); }
  }

  async function desactiver(p) {
    if (!window.confirm(`Désactiver « ${p.nom} » ? Les inscriptions existantes le conservent, mais il ne sera plus proposé.`)) return;
    try {
      await api(`/api/prescripteurs/${p.id}`, { method: "DELETE" });
      erreur(null);
      await onChange();
    } catch (e) { erreur(e.message); }
  }

  async function reactiver(p) {
    try {
      await api(`/api/prescripteurs/${p.id}`, { method: "PATCH", body: JSON.stringify({ actif: true }) });
      erreur(null);
      await onChange();
    } catch (e) { erreur(e.message); }
  }

  return (
    <Bloc titre={`Prescripteurs (${prescripteurs.length})`} ouvertParDefaut={ouvert}>
      <ul className="liste-simple">
        {prescripteurs.map((p) => (
          <li key={p.id} className={p.actif ? "" : "abandonne"}>
            <div>
              {edite?.id === p.id ? (
                <Champ label="Nom" value={edite.nom} onChange={(e) => setEdite({ ...edite, nom: e.target.value })} />
              ) : (
                <>
                  <strong>{p.nom}</strong>
                  <div className="muted small">{p.actif ? "Actif" : "Désactivé"}</div>
                </>
              )}
            </div>
            <div className="preuve-actions">
              {edite?.id === p.id ? (
                <>
                  <button className="btn petit primary" onClick={() => renommer(edite)}>Enregistrer</button>
                  <button className="btn petit" onClick={() => setEdite(null)}>Annuler</button>
                </>
              ) : (
                <>
                  <button className="btn petit" onClick={() => setEdite({ id: p.id, nom: p.nom })}>Renommer</button>
                  {p.actif
                    ? <button className="btn petit danger" onClick={() => desactiver(p)}>Désactiver</button>
                    : <button className="btn petit" onClick={() => reactiver(p)}>Réactiver</button>}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="formulaire ligne">
        <Champ label="Nouveau prescripteur" value={nom} onChange={(e) => setNom(e.target.value)} />
        <button className="btn primary" onClick={ajouter}>Ajouter</button>
      </div>
    </Bloc>
  );
}
