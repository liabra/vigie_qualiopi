import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

const PRESCRIPTEURS = {
  pole_emploi: "Pôle Emploi", mission_locale: "Mission Locale", of: "Organisme de formation", autre: "Autre",
};
const MODALITES = { presentiel: "Présentiel", distanciel: "Distanciel", mixte: "Mixte" };
// Valeurs admises en base (migration 008). La chaîne vide vaut « non
// renseignée » : le marqueur {{civilite}} est alors remplacé par du vide.
const CIVILITES = ["M.", "Mme"];

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
function Formations({ formations, onChange, erreur }) {
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
    <Bloc titre={`Formations (${formations.length})`} ouvertParDefaut={formations.length === 0}>
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

// ── Détail d'une session ─────────────────────────────────────
function DetailSession({ sessionId, modeles, onChange, erreur, admin, peutSaisir }) {
  const [d, setD] = useState(null);
  const [groupe, setGroupe] = useState({ nom: "", lieu: "", formateur: "" });
  const [stagiaire, setStagiaire] = useState({ civilite: "", nom: "", prenom: "", email: "", groupe_id: "", prescripteur: "pole_emploi", dossier_complet: false });
  const [generation, setGeneration] = useState({ modele_id: "", groupe_id: "" });
  const [occupe, setOccupe] = useState(false);
  // Horaire en cours de saisie. Il se recale sur la session OUVERTE, et non
  // à chaque rechargement : ajouter un groupe ou un stagiaire ne doit pas
  // effacer une correction commencée.
  const [horaireSaisi, setHoraireSaisi] = useState("");
  const [horaireEnCours, setHoraireEnCours] = useState(false);

  const charger = useCallback(async () => {
    try { setD(await api(`/api/sessions/${sessionId}`)); } catch (e) { erreur(e.message); }
  }, [sessionId, erreur]);
  useEffect(() => { charger(); }, [charger]);
  const idSession = d?.session?.id;
  useEffect(() => { setHoraireSaisi(d?.session?.horaire || ""); }, [idSession]);

  if (!d) return <p className="muted">Chargement de la session…</p>;

  // Renseigner, corriger ou effacer l'horaire — le seul champ d'une session
  // que l'admin peut reprendre après coup : les dates, le lieu, le formateur
  // et la durée figent ce qui a été déclaré, et la durée est déjà imprimée
  // sur les documents générés. Un texte vide efface l'horaire (NULL en base).
  async function enregistrerHoraire(valeur) {
    setHoraireEnCours(true);
    try {
      const r = await api(`/api/sessions/${sessionId}`, {
        method: "PATCH", body: JSON.stringify({ horaire: valeur }),
      });
      setHoraireSaisi(r.session.horaire || "");   // la valeur retenue par le serveur
      erreur(null);
      await charger();
    } catch (e) { erreur(e.message); } finally { setHoraireEnCours(false); }
  }

  async function ajouterGroupe() {
    if (!groupe.nom.trim()) return erreur("Indiquez un nom de groupe.");
    try {
      await api(`/api/sessions/${sessionId}/groupes`, { method: "POST", body: JSON.stringify(groupe) });
      setGroupe({ nom: "", lieu: "", formateur: "" });
      charger();
    } catch (e) { erreur(e.message); }
  }

  async function ajouterStagiaire() {
    if (!stagiaire.nom.trim() || !stagiaire.prenom.trim()) return erreur("Nom et prénom sont obligatoires.");
    try {
      await api(`/api/sessions/${sessionId}/stagiaires`, {
        method: "POST",
        body: JSON.stringify({ ...stagiaire, civilite: stagiaire.civilite || null, groupe_id: stagiaire.groupe_id || null }),
      });
      setStagiaire({ ...stagiaire, nom: "", prenom: "", email: "" });
      charger();
      onChange?.();
    } catch (e) { erreur(e.message); }
  }

  // Les stagiaires saisis avant l'ajout de la civilité n'en ont pas :
  // ce réglage en ligne est le seul moyen de la renseigner après coup.
  async function reglerCivilite(st, civilite) {
    setD((d) => ({ ...d, stagiaires: d.stagiaires.map((x) => (x.id === st.id ? { ...x, civilite } : x)) }));
    try {
      await api(`/api/stagiaires/${st.id}`, { method: "PATCH", body: JSON.stringify({ civilite: civilite || null }) });
    } catch (e) { erreur(e.message); charger(); }
  }

  async function marquerAbandon(inscription) {
    if (!window.confirm(`Marquer ${inscription.prenom} ${inscription.nom} en abandon ?`)) return;
    try {
      await api(`/api/inscriptions/${inscription.inscription_id}`, {
        method: "PATCH", body: JSON.stringify({ statut: "abandon" }),
      });
      charger();
      onChange?.();
    } catch (e) { erreur(e.message); }
  }

  // Générer : si des documents existent déjà, le serveur répond 409 et on
  // propose explicitement de les remplacer.
  async function generer(remplacer = false) {
    if (!generation.modele_id) return erreur("Choisissez un modèle.");
    setOccupe(true);
    try {
      const r = await api("/api/generations", {
        method: "POST",
        body: JSON.stringify({
          modele_id: Number(generation.modele_id), session_id: sessionId,
          groupe_id: generation.groupe_id ? Number(generation.groupe_id) : null, remplacer,
        }),
      });
      erreur(null);
      const inconnus = r.marqueursInconnus || [];
      window.alert(
        `${r.documents} document(s) généré(s)${r.remplaces ? `, dont ${r.remplaces} remplacé(s)` : ""}.\n` +
        `${r.preuves} preuve(s) rattachée(s).` +
        (inconnus.length
          ? `\n\nAttention, marqueur(s) non reconnu(s) dans le modèle : ${inconnus.join(", ")}.\n` +
            "Ils restent tels quels dans les documents produits."
          : "") +
        (r.detectionMarqueurs === false
          ? "\n\nLes marqueurs inconnus ne sont pas détectés sur ce type de fichier."
          : "") +
        (r.marqueursNonRemplaces ? `\n${r.marqueursNonRemplaces} fichier(s) ni Doc ni Sheet : marqueurs non remplacés.` : "")
      );
      charger();
      onChange?.();
    } catch (e) {
      if (/déjà été générés/.test(e.message) && window.confirm(e.message + "\n\nRemplacer ces documents ?")) {
        setOccupe(false);
        return generer(true);
      }
      erreur(e.message);
    } finally { setOccupe(false); }
  }

  const s = d.session;
  const modelesUtiles = modeles.filter((m) => ["session", "groupe", "stagiaire"].includes(m.portee));

  return (
    <div className="detail-session">
      <div className="ref-head">
        <div>
          <h2>{s.formation} · {s.reference || "sans référence"}</h2>
          <p className="muted small">
            du {s.date_debut} au {s.date_fin} · version {s.version_numero} de la formation ·{" "}
            {s.duree_heures_reelle || s.duree_heures_defaut || "?"} h
            {s.horaire && <> · {s.horaire}</>}
            {s.lieu && <> · {s.lieu}</>}{s.formateur && <> · {s.formateur}</>}
          </p>
        </div>
      </div>

      {/* Le contributeur lit l'horaire comme le reste de la session, mais ne
          dispose d'aucune commande pour le changer. */}
      {admin && (
        <div className="formulaire ligne">
          <Champ label="Horaire" value={horaireSaisi} placeholder="8h30–12h00 / 13h00–16h30"
            onChange={(e) => setHoraireSaisi(e.target.value)} />
          <button className="btn petit" onClick={() => enregistrerHoraire(horaireSaisi)} disabled={horaireEnCours}>
            Enregistrer l'horaire
          </button>
          <button className="btn petit" onClick={() => enregistrerHoraire("")}
            disabled={horaireEnCours || !s.horaire}>
            Effacer
          </button>
        </div>
      )}

      <Bloc titre={`Groupes (${d.groupes.length})`} ouvertParDefaut>
        <ul className="liste-simple">
          {d.groupes.map((g) => (
            <li key={g.id}>
              <div><strong>{g.nom}</strong>
                <div className="muted small">{g.nb_inscrits} inscrit(s){g.lieu && <> · {g.lieu}</>}{g.formateur && <> · {g.formateur}</>}</div>
              </div>
            </li>
          ))}
          {d.groupes.length === 0 && <li className="muted">Aucun groupe. Une session sur un seul lieu n'en a qu'un.</li>}
        </ul>
        {admin && (
          <div className="formulaire ligne">
            <Champ label="Nom du groupe" value={groupe.nom} onChange={(e) => setGroupe({ ...groupe, nom: e.target.value })} />
            <Champ label="Lieu" value={groupe.lieu} onChange={(e) => setGroupe({ ...groupe, lieu: e.target.value })} />
            <Champ label="Formateur" value={groupe.formateur} onChange={(e) => setGroupe({ ...groupe, formateur: e.target.value })} />
            <button className="btn" onClick={ajouterGroupe}>Ajouter le groupe</button>
          </div>
        )}
      </Bloc>

      <Bloc titre={`Stagiaires (${d.stagiaires.filter((x) => x.statut !== "abandon").length} actifs sur ${d.stagiaires.length})`} ouvertParDefaut>
        <ul className="liste-simple">
          {d.stagiaires.map((st) => (
            <li key={st.inscription_id} className={st.statut === "abandon" ? "abandonne" : ""}>
              <div>
                <strong>{st.nom} {st.prenom}</strong>
                <div className="muted small">
                  {d.groupes.find((g) => g.id === st.groupe_id)?.nom || "sans groupe"}
                  {st.prescripteur && <> · {PRESCRIPTEURS[st.prescripteur]}</>}
                  {" · dossier "}{st.dossier_complet ? "complet" : "incomplet"}
                  {st.statut === "abandon" && <span className="text-erreur"> · abandon le {st.date_abandon}</span>}
                </div>
              </div>
              <div className="actions-stagiaire">
                {/* Corriger une fiche passe par PATCH /stagiaires/:id, qui
                    est réservé à l'admin : inutile de proposer un réglage
                    qui répondrait 403. */}
                {admin && (
                  <select
                    value={st.civilite || ""} aria-label={`Civilité de ${st.prenom} ${st.nom}`}
                    onChange={(e) => reglerCivilite(st, e.target.value)}
                  >
                    <option value="">Civilité ?</option>
                    {CIVILITES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                {peutSaisir && st.statut !== "abandon" && (
                  <button className="btn petit danger" onClick={() => marquerAbandon(st)}>Abandon</button>
                )}
              </div>
            </li>
          ))}
          {d.stagiaires.length === 0 && <li className="muted">Aucun stagiaire inscrit.</li>}
        </ul>
        {peutSaisir && (
        <div className="formulaire ligne">
          <label className="champ">
            <span className="muted small">Civilité</span>
            <select value={stagiaire.civilite} onChange={(e) => setStagiaire({ ...stagiaire, civilite: e.target.value })}>
              <option value="">Non renseignée</option>
              {CIVILITES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <Champ label="Nom" value={stagiaire.nom} onChange={(e) => setStagiaire({ ...stagiaire, nom: e.target.value })} />
          <Champ label="Prénom" value={stagiaire.prenom} onChange={(e) => setStagiaire({ ...stagiaire, prenom: e.target.value })} />
          <Champ label="Courriel" type="email" value={stagiaire.email} onChange={(e) => setStagiaire({ ...stagiaire, email: e.target.value })} />
          <label className="champ">
            <span className="muted small">Groupe</span>
            <select value={stagiaire.groupe_id} onChange={(e) => setStagiaire({ ...stagiaire, groupe_id: e.target.value })}>
              <option value="">Sans groupe</option>
              {d.groupes.map((g) => <option key={g.id} value={g.id}>{g.nom}</option>)}
            </select>
          </label>
          <label className="champ">
            <span className="muted small">Prescripteur</span>
            <select value={stagiaire.prescripteur} onChange={(e) => setStagiaire({ ...stagiaire, prescripteur: e.target.value })}>
              {Object.entries(PRESCRIPTEURS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="champ case">
            <input type="checkbox" checked={stagiaire.dossier_complet}
              onChange={(e) => setStagiaire({ ...stagiaire, dossier_complet: e.target.checked })} />
            <span className="muted small">Dossier complet</span>
          </label>
          <button className="btn" onClick={ajouterStagiaire}>Ajouter le stagiaire</button>
        </div>
        )}
      </Bloc>

      <Bloc titre={`Documents générés (${d.documents.length})`} ouvertParDefaut>
        {peutSaisir && (
        <div className="formulaire ligne">
          <label className="champ">
            <span className="muted small">Modèle</span>
            <select value={generation.modele_id} onChange={(e) => setGeneration({ ...generation, modele_id: e.target.value })}>
              <option value="">Choisir…</option>
              {modelesUtiles.map((m) => (
                <option key={m.id} value={m.id}>{m.nom} · portée {m.portee}</option>
              ))}
            </select>
          </label>
          <label className="champ">
            <span className="muted small">Groupe visé</span>
            <select value={generation.groupe_id} onChange={(e) => setGeneration({ ...generation, groupe_id: e.target.value })}>
              <option value="">Toute la session</option>
              {d.groupes.map((g) => <option key={g.id} value={g.id}>{g.nom}</option>)}
            </select>
          </label>
          <button className="btn primary" onClick={() => generer(false)} disabled={occupe}>
            {occupe ? "Génération…" : "Générer les documents"}
          </button>
        </div>
        )}
        <ul className="liste-simple">
          {d.documents.map((doc) => (
            <li key={doc.id}>
              <div>
                <a href={doc.drive_url} target="_blank" rel="noreferrer">{doc.nom}</a>
                <div className="muted small">{doc.modele} · portée {doc.portee} · {new Date(doc.genere_le).toLocaleString("fr-FR")}</div>
              </div>
            </li>
          ))}
          {d.documents.length === 0 && <li className="muted">Aucun document généré pour cette session.</li>}
        </ul>
      </Bloc>
    </div>
  );
}

// ── Écran ────────────────────────────────────────────────────
export default function Sessions({ admin, peutSaisir, onChange }) {
  const [formations, setFormations] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [modeles, setModeles] = useState([]);
  const [err, setErr] = useState(null);
  const [choisie, setChoisie] = useState(null);
  const [form, setForm] = useState({ formation_id: "", reference: "", date_debut: "", date_fin: "", lieu: "", formateur: "", duree_heures_reelle: "", horaire: "" });

  const charger = useCallback(async () => {
    try {
      const [f, s, m] = await Promise.all([api("/api/formations"), api("/api/sessions"), api("/api/modeles")]);
      setFormations(f.formations);
      setSessions(s.sessions);
      setModeles(m.modeles);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  async function creerSession() {
    if (!form.formation_id) return setErr("Choisissez une formation.");
    if (!form.date_debut || !form.date_fin) return setErr("Les dates de début et de fin sont obligatoires.");
    try {
      const r = await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ ...form, formation_id: Number(form.formation_id), duree_heures_reelle: form.duree_heures_reelle || null }),
      });
      setForm({ formation_id: "", reference: "", date_debut: "", date_fin: "", lieu: "", formateur: "", duree_heures_reelle: "", horaire: "" });
      setErr(null);
      await charger();
      setChoisie(r.session.id);
    } catch (e) { setErr(e.message); }
  }

  if (!admin && !peutSaisir) {
    return <p className="muted">Vous n'avez pas accès à la saisie des sessions.</p>;
  }

  return (
    <section className="sessions">
      <h1>Sessions</h1>
      {err && <p className="flash erreur">{err}</p>}

      {admin && <Formations formations={formations} onChange={charger} erreur={setErr} />}

      <Bloc titre={`Sessions (${sessions.length})`} ouvertParDefaut>
        <ul className="liste-simple">
          {sessions.map((s) => (
            <li key={s.id} className={choisie === s.id ? "actif" : ""}>
              <div>
                <strong>{s.reference || s.formation}</strong>
                <div className="muted small">{s.formation} · du {s.date_debut} au {s.date_fin} · {s.nb_inscrits} inscrit(s)</div>
              </div>
              <button className="btn petit" onClick={() => setChoisie(choisie === s.id ? null : s.id)}>
                {choisie === s.id ? "Fermer" : "Ouvrir"}
              </button>
            </li>
          ))}
          {sessions.length === 0 && <li className="muted">Aucune session.</li>}
        </ul>
        {admin && (
        <div className="formulaire ligne">
          <label className="champ">
            <span className="muted small">Formation</span>
            <select value={form.formation_id} onChange={(e) => setForm({ ...form, formation_id: e.target.value })}>
              <option value="">Choisir…</option>
              {formations.map((f) => <option key={f.id} value={f.id}>{f.intitule} (v{f.version_numero})</option>)}
            </select>
          </label>
          <Champ label="Référence" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          <Champ label="Début" type="date" value={form.date_debut} onChange={(e) => setForm({ ...form, date_debut: e.target.value })} />
          <Champ label="Fin" type="date" value={form.date_fin} onChange={(e) => setForm({ ...form, date_fin: e.target.value })} />
          <Champ label="Lieu" value={form.lieu} onChange={(e) => setForm({ ...form, lieu: e.target.value })} />
          <Champ label="Formateur" value={form.formateur} onChange={(e) => setForm({ ...form, formateur: e.target.value })} />
          <Champ label="Durée réelle (h)" type="number" min="0" value={form.duree_heures_reelle}
            onChange={(e) => setForm({ ...form, duree_heures_reelle: e.target.value })} />
          <Champ label="Horaire" value={form.horaire} placeholder="8h30–12h00 / 13h00–16h30"
            onChange={(e) => setForm({ ...form, horaire: e.target.value })} />
          <button className="btn primary" onClick={creerSession}>Créer la session</button>
        </div>
        )}
      </Bloc>

      {choisie && (
        <DetailSession
          sessionId={choisie} modeles={modeles} onChange={onChange} erreur={setErr}
          admin={admin} peutSaisir={peutSaisir}
        />
      )}
    </section>
  );
}
