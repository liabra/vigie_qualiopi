import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { messageDepassementDuree } from "./messages.js";
import { RechercheDrive } from "./RechercheDrive.jsx";
import Evaluations from "./Evaluations.jsx";

const MODALITES = { presentiel: "Présentiel", distanciel: "Distanciel", mixte: "Mixte" };
// Valeurs admises en base (migration 008). La chaîne vide vaut « non
// renseignée » : le marqueur {{civilite}} est alors remplacé par du vide.
const CIVILITES = ["M.", "Mme"];
// Valeurs admises par la contrainte SQL sur absences.demi_journee.
const DEMI_JOURNEES = { matin: "Matin", apres_midi: "Après-midi", journee: "Journée" };

// Libellé d'un prescripteur à partir de son code, y compris un prescripteur
// désactivé resté sur une ancienne inscription. Retombe sur le code si la
// liste ne le connaît pas (ne devrait pas arriver après la migration 011).
const libellePrescripteur = (code, prescripteurs) =>
  prescripteurs?.find((p) => p.code === code)?.nom || code || "";

// Statuts d'une session (migration 001). Aucun changement automatique : c'est
// l'utilisateur qui choisit, l'interface ne fait qu'avertir d'une incohérence.
const STATUTS_SESSION = {
  planifiee: "Planifiée", en_cours: "En cours", terminee: "Terminée", annulee: "Annulée",
};
const classeStatut = (statut) =>
  statut === "terminee" ? "ok" : statut === "en_cours" ? "warn" : statut === "annulee" ? "off" : "";

// Types suggérés pour un document externe (EduSign / Drive). Le libellé
// final reste libre : on ne fait que proposer.
const TYPES_EDUSIGN = ["Feuille d'émargement EduSign", "Feuille de présence", "Justificatif EduSign"];

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

// ── Absences d'un stagiaire ──────────────────────────────────
// Principe métier : un stagiaire est PRÉSENT par défaut, on ne saisit que ses
// absences. Le taux d'assiduité est calculé par le serveur, et seulement
// lorsqu'il est fiable : ici, on ne fait que l'afficher. Aucune durée n'est
// déduite d'une « demi-journée » — elle est toujours saisie.
function PanneauAbsences({ fiche, session, peutSaisir, recharger, erreur }) {
  const [form, setForm] = useState(null);

  async function enregistrer() {
    if (!form.date_absence) return erreur("Indiquez la date de l'absence.");
    if (!(Number(form.duree_heures) > 0)) return erreur("Indiquez une durée d'absence en heures, supérieure à 0.");
    try {
      const corps = {
        date_absence: form.date_absence,
        demi_journee: form.demi_journee || null,
        duree_heures: Number(form.duree_heures),
        justifiee: form.justifiee === true,
        motif: form.motif || null,
      };
      if (form.id) await api(`/api/absences/${form.id}`, { method: "PATCH", body: JSON.stringify(corps) });
      else await api(`/api/inscriptions/${form.inscription_id}/absences`, { method: "POST", body: JSON.stringify(corps) });
      erreur(null);
      setForm(null);
      await recharger();
    } catch (e) { erreur(e.message); }
  }

  async function supprimer(a) {
    if (!window.confirm(`Supprimer l'absence du ${a.date_absence} ?`)) return;
    try {
      await api(`/api/absences/${a.id}`, { method: "DELETE" });
      erreur(null);
      setForm(null);
      await recharger();
    } catch (e) { erreur(e.message); }
  }

  return (
    <div className="absences-stagiaire">
      <ul className="liste-absences">
        {fiche.absences.map((x) => (
          <li key={x.id} className={x.justifiee ? "justifiee" : "injustifiee"}>
            <span>{x.date_absence}</span>
            <span className="muted small">{DEMI_JOURNEES[x.demi_journee] || "demi-journée non précisée"}</span>
            <strong>{x.duree_heures} h</strong>
            <span className={"pill " + (x.justifiee ? "ok" : "off")}>
              {x.justifiee ? "Justifiée" : "Non justifiée"}
            </span>
            {x.motif && <span className="muted small absence-motif">{x.motif}</span>}
            {peutSaisir && (
              <span className="preuve-actions">
                <button className="btn petit" onClick={() => setForm({
                  id: x.id, inscription_id: fiche.inscription_id, date_absence: x.date_absence,
                  demi_journee: x.demi_journee || "", duree_heures: x.duree_heures,
                  justifiee: x.justifiee === true, motif: x.motif || "",
                })}>Modifier</button>
                <button className="btn petit danger" onClick={() => supprimer(x)}>Supprimer</button>
              </span>
            )}
          </li>
        ))}
        {fiche.absences.length === 0 && (
          <li className="muted">Aucune absence enregistrée : présence par défaut.</li>
        )}
      </ul>

      {peutSaisir && !form && (
        <button className="btn petit" onClick={() => setForm({
          id: null, inscription_id: fiche.inscription_id, date_absence: session.date_debut,
          demi_journee: "", duree_heures: "", justifiee: false, motif: "",
        })}>
          Ajouter une absence
        </button>
      )}

      {peutSaisir && form && (
        <div className="formulaire ligne">
          <Champ label="Date" type="date" value={form.date_absence}
            min={session.date_debut} max={session.date_fin}
            onChange={(e) => setForm({ ...form, date_absence: e.target.value })} />
          <label className="champ">
            <span className="muted small">Demi-journée</span>
            <select value={form.demi_journee} onChange={(e) => setForm({ ...form, demi_journee: e.target.value })}>
              <option value="">Non précisée</option>
              {Object.entries(DEMI_JOURNEES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <Champ label="Durée (heures)" type="number" min="0" max="24" step="0.25" value={form.duree_heures}
            onChange={(e) => setForm({ ...form, duree_heures: e.target.value })} />
          <label className="champ case">
            <input type="checkbox" checked={form.justifiee}
              onChange={(e) => setForm({ ...form, justifiee: e.target.checked })} />
            <span className="muted small">Justifiée</span>
          </label>
          <Champ label="Motif" value={form.motif} onChange={(e) => setForm({ ...form, motif: e.target.value })} />
          <div className="preuve-actions">
            <button className="btn primary" onClick={enregistrer}>
              {form.id ? "Enregistrer l'absence" : "Ajouter l'absence"}
            </button>
            <button className="btn" onClick={() => setForm(null)}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dossier d'un stagiaire ───────────────────────────────────
// La fiche (personne) et l'inscription (session) sont deux choses
// distinctes : la fiche vit dans `stagiaires`, l'inscription porte le
// groupe, le prescripteur, le dossier et l'abandon. Les champs
// `situation_handicap` et `besoins_adaptation` ne sont visibles qu'ici,
// dans le contexte de la gestion du dossier, et jamais ailleurs.
function PanneauDossier({ st, groupes, prescripteurs, recharger, erreur }) {
  const [fiche, setFiche] = useState({
    civilite: st.civilite || "", nom: st.nom || "", prenom: st.prenom || "",
    email: st.email || "", telephone: st.telephone || "", entreprise: st.entreprise || "",
    financeur: st.financeur || "", situation_handicap: st.situation_handicap === true,
    besoins_adaptation: st.besoins_adaptation || "",
  });
  const [insc, setInsc] = useState({
    groupe_id: st.groupe_id || "", prescripteur: st.prescripteur || "",
    dossier_complet: st.dossier_complet === true,
  });
  const [occupe, setOccupe] = useState(false);

  async function enregistrerFiche() {
    if (!fiche.nom.trim() || !fiche.prenom.trim()) return erreur("Nom et prénom sont obligatoires.");
    setOccupe(true);
    try {
      await api(`/api/stagiaires/${st.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...fiche, civilite: fiche.civilite || null, besoins_adaptation: fiche.besoins_adaptation || null }),
      });
      erreur(null);
      await recharger();
    } catch (e) { erreur(e.message); } finally { setOccupe(false); }
  }

  async function enregistrerInscription() {
    setOccupe(true);
    try {
      await api(`/api/inscriptions/${st.inscription_id}`, {
        method: "PATCH",
        body: JSON.stringify({
          groupe_id: insc.groupe_id || null,
          prescripteur: insc.prescripteur || null,
          dossier_complet: insc.dossier_complet,
        }),
      });
      erreur(null);
      await recharger();
    } catch (e) { erreur(e.message); } finally { setOccupe(false); }
  }

  return (
    <div className="dossier-stagiaire">
      <div className="formulaire">
        <strong>Fiche stagiaire</strong>
        <div className="formulaire ligne">
          <label className="champ">
            <span className="muted small">Civilité</span>
            <select value={fiche.civilite} onChange={(e) => setFiche({ ...fiche, civilite: e.target.value })}>
              <option value="">Non renseignée</option>
              {CIVILITES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <Champ label="Nom" value={fiche.nom} onChange={(e) => setFiche({ ...fiche, nom: e.target.value })} />
          <Champ label="Prénom" value={fiche.prenom} onChange={(e) => setFiche({ ...fiche, prenom: e.target.value })} />
          <Champ label="Courriel" type="email" value={fiche.email} onChange={(e) => setFiche({ ...fiche, email: e.target.value })} />
          <Champ label="Téléphone" value={fiche.telephone} onChange={(e) => setFiche({ ...fiche, telephone: e.target.value })} />
          <Champ label="Entreprise" value={fiche.entreprise} onChange={(e) => setFiche({ ...fiche, entreprise: e.target.value })} />
          <Champ label="Financeur" value={fiche.financeur} onChange={(e) => setFiche({ ...fiche, financeur: e.target.value })} />
          <label className="champ case">
            <input type="checkbox" checked={fiche.situation_handicap}
              onChange={(e) => setFiche({ ...fiche, situation_handicap: e.target.checked })} />
            <span className="muted small">Situation de handicap</span>
          </label>
          <Champ label="Besoins d'adaptation" multiligne rows={2} value={fiche.besoins_adaptation}
            onChange={(e) => setFiche({ ...fiche, besoins_adaptation: e.target.value })} />
        </div>
        <div className="preuve-actions">
          <button className="btn primary" onClick={enregistrerFiche} disabled={occupe}>Enregistrer la fiche</button>
        </div>
      </div>

      <div className="formulaire ligne">
        <label className="champ">
          <span className="muted small">Groupe</span>
          <select value={insc.groupe_id} onChange={(e) => setInsc({ ...insc, groupe_id: e.target.value })}>
            <option value="">Sans groupe</option>
            {groupes.map((g) => <option key={g.id} value={g.id}>{g.nom}</option>)}
          </select>
        </label>
        <label className="champ">
          <span className="muted small">Prescripteur</span>
          <select value={insc.prescripteur} onChange={(e) => setInsc({ ...insc, prescripteur: e.target.value })}>
            <option value="">Aucun</option>
            {prescripteurs.filter((p) => p.actif).map((p) => <option key={p.id} value={p.code}>{p.nom}</option>)}
          </select>
        </label>
        <label className="champ case">
          <input type="checkbox" checked={insc.dossier_complet}
            onChange={(e) => setInsc({ ...insc, dossier_complet: e.target.checked })} />
          <span className="muted small">Dossier complet</span>
        </label>
        <button className="btn" onClick={enregistrerInscription} disabled={occupe}>
          Enregistrer l'inscription
        </button>
      </div>
    </div>
  );
}

// ── Import CSV de stagiaires ─────────────────────────────────
// Deux temps : APERÇU (aucune écriture) puis CONFIRMATION (transactionnelle).
// Le texte du fichier est conservé tel quel pour la confirmation, qui relit
// et reclasse côté serveur : ce qui est affiché est exactement ce qui sera
// importé.
const STATUT_LIGNE = {
  pret: "Prêt à importer",
  existant: "Existant identifié",
  deja_inscrit: "Déjà inscrit",
  doublon_possible: "Doublon possible",
  a_verifier: "À vérifier",
  invalide: "Invalide",
  vide: "Ligne vide",
};

function ImportStagiaires({ sessionId, recharger, erreur }) {
  const [apercu, setApercu] = useState(null);
  const [bilan, setBilan] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const texteRef = useRef(null);

  async function lireFichier(e) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    const texte = await fichier.text();
    texteRef.current = texte;
    setBilan(null);
    try {
      const r = await api(`/api/sessions/${sessionId}/stagiaires/import-apercu`, {
        method: "POST", body: JSON.stringify({ texte }),
      });
      setApercu(r);
      erreur(null);
    } catch (err) { setApercu(null); erreur(err.message); }
    e.target.value = "";   // permet de relire le même fichier
  }

  async function confirmer() {
    if (!texteRef.current) return erreur("Choisissez d'abord un fichier.");
    setOccupe(true);
    try {
      const r = await api(`/api/sessions/${sessionId}/stagiaires/import`, {
        method: "POST", body: JSON.stringify({ texte: texteRef.current }),
      });
      setBilan(r.bilan);
      setApercu(null);
      texteRef.current = null;
      erreur(null);
      await recharger();
    } catch (err) { erreur(err.message); } finally { setOccupe(false); }
  }

  const r = apercu?.resume;

  return (
    <div className="import-stagiaires">
      <input type="file" accept=".csv,text/csv" onChange={lireFichier} />
      <p className="muted small">
        Fichier CSV (virgule ou point-virgule), exportable depuis Excel, LibreOffice ou Google Sheets.
        Colonnes reconnues : civilité, nom, prénom, email, téléphone, entreprise, financeur, situation
        de handicap, besoins d'adaptation, groupe, prescripteur, dossier complet.
      </p>

      {apercu && (
        <>
          {apercu.colonnesInconnues?.length > 0 && (
            <p className="flash info">
              Colonnes non reconnues (ignorées) : {apercu.colonnesInconnues.join(", ")}.
            </p>
          )}
          <div className="resume-import">
            <span className="pill ok">{r.nouveaux} nouveaux stagiaires</span>
            <span className="pill">{r.existants} stagiaires existants</span>
            <span className="pill off">{r.invalides} lignes invalides</span>
            <span className="pill warn">{r.doublons} doublons potentiels</span>
            <span className="pill">{r.dejaInscrits} déjà inscrits</span>
            <span className="pill">{r.vides} lignes vides</span>
          </div>
          <ul className="liste-import">
            {apercu.lignes.map((l) => (
              <li key={l.index} className={"import-" + l.statut}>
                <span className="muted small">ligne {l.index + 1}</span>
                <strong>{l.nom} {l.prenom}</strong>
                {l.email && <span className="muted small">{l.email}</span>}
                <span className={"pill " + (l.statut === "invalide" ? "off" : l.statut === "pret" ? "ok" : l.statut === "existant" ? "ok" : "warn")}>
                  {STATUT_LIGNE[l.statut] || l.statut}
                </span>
                {l.motif && <span className="muted small">{l.motif}</span>}
              </li>
            ))}
          </ul>
          <div className="preuve-actions">
            <button className="btn primary" onClick={confirmer} disabled={occupe || r.nouveaux + r.existants === 0}>
              {occupe ? "Import en cours…" : `Confirmer l'import (${r.nouveaux + r.existants} stagiaire(s))`}
            </button>
            <button className="btn" onClick={() => { setApercu(null); texteRef.current = null; }}>Annuler</button>
          </div>
        </>
      )}

      {bilan && (
        <p className="flash ok">
          Import terminé : {bilan.crees} créé(s), {bilan.reutilises} réutilisé(s), {bilan.inscrits} inscrit(s),
          {bilan.dejaInscrits} déjà inscrit(s), {bilan.ignores.length} ignoré(s).
        </p>
      )}
    </div>
  );
}

// ── Détail d'une session ─────────────────────────────────────
function DetailSession({ sessionId, modeles, prescripteurs, onChange, erreur, admin, peutSaisir }) {
  const [d, setD] = useState(null);
  const [groupe, setGroupe] = useState({ nom: "", lieu: "", formateur: "" });
  const [stagiaire, setStagiaire] = useState({ civilite: "", nom: "", prenom: "", email: "", groupe_id: "", prescripteur: "pole_emploi", dossier_complet: false });
  const [generation, setGeneration] = useState({ modele_id: "", groupe_id: "" });
  const [occupe, setOccupe] = useState(false);
  // Formulaire « Modifier la session », pré-rempli une fois la session ouverte
  // et jamais recalculé à chaque rechargement : ajouter un groupe ou un
  // stagiaire ne doit pas effacer une correction commencée.
  const [fs, setFs] = useState(null);
  // Absences et assiduité de la session, chargées avec le détail : deux
  // appels en parallèle plutôt qu'un aller-retour supplémentaire à l'ouverture
  // de chaque stagiaire.
  const [abs, setAbs] = useState(null);
  const [detailAbsence, setDetailAbsence] = useState(null);
  const [detailDossier, setDetailDossier] = useState(null);
  // Documents externes (EduSign / Drive) rattachés à la session, et la
  // liste légère d'indicateurs pour les rattacher. Les documents générés
  // par Vigie sont déjà dans d.documents.
  const [externes, setExternes] = useState([]);
  const [indicateurs, setIndicateurs] = useState([]);
  const [rattachement, setRattachement] = useState({ type: "", titre: "", indicateur_id: "", fichier: null });

  const charger = useCallback(async () => {
    try {
      const [detail, absences, preuves, indics] = await Promise.all([
        api(`/api/sessions/${sessionId}`),
        api(`/api/sessions/${sessionId}/absences`),
        api(`/api/preuves?session=${sessionId}`),
        api("/api/indicateurs"),
      ]);
      setD(detail);
      setAbs(absences);
      setExternes((preuves.preuves || []).filter((p) => p.source !== "generation"));
      setIndicateurs(indics.indicateurs || []);
    } catch (e) { erreur(e.message); }
  }, [sessionId, erreur]);
  useEffect(() => { charger(); }, [charger]);
  const idSession = d?.session?.id;
  useEffect(() => {
    if (d?.session) {
      setFs({
        reference: d.session.reference || "", date_debut: d.session.date_debut, date_fin: d.session.date_fin,
        lieu: d.session.lieu || "", formateur: d.session.formateur || "",
        duree_heures_reelle: d.session.duree_heures_reelle || "", horaire: d.session.horaire || "",
        statut: d.session.statut,
      });
    }
  }, [idSession]);

  if (!d) return <p className="muted">Chargement de la session…</p>;

  // Corriger une session (admin). La modification ne touche jamais les
  // documents déjà générés : s'ils existent et qu'un champ imprimé change,
  // on le signale — jamais de régénération silencieuse.
  async function enregistrerSession() {
    setOccupe(true);
    try {
      const r = await api(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify({
          reference: fs.reference, date_debut: fs.date_debut, date_fin: fs.date_fin,
          lieu: fs.lieu, formateur: fs.formateur,
          duree_heures_reelle: fs.duree_heures_reelle === "" ? null : fs.duree_heures_reelle,
          horaire: fs.horaire, statut: fs.statut,
        }),
      });
      setFs({
        reference: r.session.reference || "", date_debut: r.session.date_debut, date_fin: r.session.date_fin,
        lieu: r.session.lieu || "", formateur: r.session.formateur || "",
        duree_heures_reelle: r.session.duree_heures_reelle || "", horaire: r.session.horaire || "",
        statut: r.session.statut,
      });
      erreur(null);
      if (r.absencesDepassentDuree) {
        window.alert(messageDepassementDuree({
          total_heures_absence: r.total_heures_absence,
          duree_prevue: r.session.duree_heures_reelle,
        }));
      }
      if (r.documentsObsoletes && d.documents.length > 0) {
        window.alert(`${d.documents.length} document(s) généré(s) peuvent être obsolètes après cette modification : régénérez-les si nécessaire.`);
      }
      await charger();
      onChange?.();
    } catch (e) { erreur(e.message); } finally { setOccupe(false); }
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
      const nonResolus = r.marqueursNonResolus || [];
      window.alert(
        `${r.documents} document(s) généré(s)${r.remplaces ? `, dont ${r.remplaces} remplacé(s)` : ""}.\n` +
        `${r.preuves} preuve(s) rattachée(s).` +
        (inconnus.length
          ? `\n\nAttention, marqueur(s) non reconnu(s) dans le modèle : ${inconnus.join(", ")}.\n` +
            "Ils restent tels quels dans les documents produits."
          : "") +
        (nonResolus.length
          ? `\n\nAttention, marqueur(s) resté(s) non remplacé(s) dans les documents : ${nonResolus.join(", ")}.\n` +
            "Vérifiez que le modèle ne les coupe pas sur plusieurs lignes."
          : "") +
        (r.detectionMarqueurs === false
          ? "\n\nLes marqueurs inconnus ne sont pas détectés sur ce type de fichier."
          : "") +
        (r.marqueursNonRemplaces ? `\n${r.marqueursNonRemplaces} fichier(s) ni Doc ni Sheet : marqueurs non remplacés.` : "") +
        (r.anciensNonArchives && r.anciensNonArchives.length
          ? `\n\nLe nouveau document est enregistré, mais ${r.anciensNonArchives.length} ancien(s) fichier(s) n'ont pas pu être archivé(s).`
          : "")
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

  // Rattacher un document externe (EduSign / Drive) à la session : on ne
  // stocke que l'identifiant du fichier, jamais le PDF, et on ne copie
  // rien. Source « manuel » ⇒ affiché comme externe, jamais « généré ».
  async function rattacherExterne() {
    if (!rattachement.titre.trim()) return erreur("Indiquez un libellé (type de document).");
    if (!rattachement.indicateur_id) return erreur("Choisissez un indicateur.");
    if (!rattachement.fichier) return erreur("Sélectionnez un fichier sur le Drive.");
    try {
      await api("/api/preuves", {
        method: "POST",
        body: JSON.stringify({
          titre: rattachement.titre.trim(),
          indicateur_id: Number(rattachement.indicateur_id),
          drive_file_id: rattachement.fichier.id,
          drive_url: rattachement.fichier.url,
          drive_nom: rattachement.fichier.nom,
          drive_mime: rattachement.fichier.mime,
          session_id: sessionId,
          mode_fichiers: "multiple",
        }),
      });
      setRattachement({ type: "", titre: "", indicateur_id: "", fichier: null });
      await charger();
    } catch (e) { erreur(e.message); }
  }

  const s = d.session;
  const modelesUtiles = modeles.filter((m) => ["session", "groupe", "stagiaire"].includes(m.portee));

  // Avertissement d'incohérence entre le statut et les dates, sans jamais
  // changer le statut automatiquement : les dates peuvent être indicatives.
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const incoherences = [];
  if (s.statut === "planifiee" && s.date_fin < aujourdhui) incoherences.push("session « planifiée » dont la date de fin est passée");
  if (s.statut === "terminee" && s.date_debut > aujourdhui) incoherences.push("session « terminée » dont la date de début est future");

  return (
    <div className="detail-session">
      <div className="ref-head">
        <div>
          <h2>{s.formation} · {s.reference || "sans référence"}</h2>
          <p className="muted small">
            <span className={"pill " + classeStatut(s.statut)}>{STATUTS_SESSION[s.statut] || s.statut}</span>{" "}
            du {s.date_debut} au {s.date_fin} · version {s.version_numero} de la formation ·{" "}
            {s.duree_heures_reelle || s.duree_heures_defaut || "?"} h
            {s.horaire && <> · {s.horaire}</>}
            {s.lieu && <> · {s.lieu}</>}{s.formateur && <> · {s.formateur}</>}
          </p>
        </div>
      </div>

      {incoherences.length > 0 && (
        <p className="flash info">
          Attention : {incoherences.join(" ; ")}. Les dates peuvent être indicatives ou corrigées
          après coup — le statut n'est pas modifié automatiquement.
        </p>
      )}

      {/* L'admin corrige la session ; le contributeur ne voit que la lecture.
          Formulaire repliable pour ne pas surcharger le détail. */}
      {admin && (
        <Bloc titre="Modifier la session">
          {fs && (
            <>
              <div className="formulaire ligne">
                <Champ label="Référence" value={fs.reference}
                  onChange={(e) => setFs({ ...fs, reference: e.target.value })} />
                <Champ label="Début" type="date" value={fs.date_debut}
                  onChange={(e) => setFs({ ...fs, date_debut: e.target.value })} />
                <Champ label="Fin" type="date" value={fs.date_fin}
                  onChange={(e) => setFs({ ...fs, date_fin: e.target.value })} />
                <Champ label="Lieu" value={fs.lieu}
                  onChange={(e) => setFs({ ...fs, lieu: e.target.value })} />
                <Champ label="Formateur" value={fs.formateur}
                  onChange={(e) => setFs({ ...fs, formateur: e.target.value })} />
                <Champ label="Durée prévue (h)" type="number" min="0" value={fs.duree_heures_reelle}
                  onChange={(e) => setFs({ ...fs, duree_heures_reelle: e.target.value })} />
                <Champ label="Horaire" value={fs.horaire} placeholder="8h30–12h00 / 13h00–16h30"
                  onChange={(e) => setFs({ ...fs, horaire: e.target.value })} />
                <label className="champ">
                  <span className="muted small">Statut</span>
                  <select value={fs.statut} onChange={(e) => setFs({ ...fs, statut: e.target.value })}>
                    {Object.entries(STATUTS_SESSION).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </div>
              <div className="preuve-actions">
                <button className="btn primary" onClick={enregistrerSession} disabled={occupe}>
                  Enregistrer la session
                </button>
              </div>
            </>
          )}
        </Bloc>
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
        {abs && (
          <p className="muted small">
            Un stagiaire est <strong>présent par défaut</strong> : seules les absences sont saisies.
            {abs.session.heures_prevues !== null ? (
              <> Durée prévue de la session : <strong>{abs.session.heures_prevues} h</strong>
                {abs.session.source_heures_prevues === "duree_heures_defaut"
                  && " (durée par défaut de la formation : aucune durée prévue n'est déclarée)"}
                {" "}· total des absences : <strong>{abs.total_heures_absence} h</strong>.</>
            ) : (
              <> <span className="text-erreur">Durée prévue inconnue</span> : seules les heures d'absence
                sont affichées — <strong>{abs.total_heures_absence} h</strong>.</>
            )}
          </p>
        )}
        <ul className="liste-simple">
          {d.stagiaires.map((st) => {
            const fiche = abs?.stagiaires.find((x) => x.inscription_id === st.inscription_id) || null;
            const deplie = detailAbsence === st.inscription_id;
            const deplieDossier = detailDossier === st.inscription_id;
            return (
            <li key={st.inscription_id}
              className={[st.statut === "abandon" ? "abandonne" : "", (deplie || deplieDossier) ? "avec-detail" : ""].join(" ").trim()}>
              <div>
                <strong>{st.nom} {st.prenom}</strong>
                <div className="muted small">
                  {d.groupes.find((g) => g.id === st.groupe_id)?.nom || "sans groupe"}
                  {st.prescripteur && <> · {libellePrescripteur(st.prescripteur, prescripteurs)}</>}
                  {" · dossier "}{st.dossier_complet ? "complet" : "incomplet"}
                  {fiche && <> · {fiche.absences.length} absence(s)
                    {fiche.absences.length > 0 && <> · {fiche.total_heures_absence} h</>}</>}
                  {st.statut === "abandon" && <span className="text-erreur"> · abandon le {st.date_abandon}</span>}
                </div>
                {/* L'assiduité n'est affichée que lorsque le serveur la juge
                    fiable : jamais de taux inventé pour un abandon, ni sans
                    durée prévue. */}
                {fiche && (fiche.assiduite.fiable || fiche.assiduite.raison || fiche.assiduite.depassement) && (
                  <div className="tags">
                    {fiche.assiduite.fiable && (
                      <span className={"pill " + (fiche.assiduite.taux >= 80 ? "ok" : "warn")}>
                        Assiduité {fiche.assiduite.taux} % · {fiche.assiduite.heures_suivies} h suivies sur {fiche.assiduite.heures_prevues} h
                      </span>
                    )}
                    {fiche.assiduite.raison === "abandon" && (
                      <span className="pill off">Abandon — taux non calculé</span>
                    )}
                    {fiche.assiduite.raison === "duree_inconnue" && (
                      <span className="pill">Durée prévue inconnue — total d'absences seul</span>
                    )}
                    {fiche.assiduite.depassement && (
                      <span className="pill off">Absences supérieures à la durée prévue</span>
                    )}
                  </div>
                )}
              </div>
              <div className="actions-stagiaire">
                {/* Corriger une fiche passe par PATCH /stagiaires/:id, qui
                    est ouvert aux admins ET aux contributeurs : la civilité
                    rapide reste un raccourci admin, le panneau « Dossier »
                    couvre la fiche entière pour les deux rôles. */}
                {admin && (
                  <select
                    value={st.civilite || ""} aria-label={`Civilité de ${st.prenom} ${st.nom}`}
                    onChange={(e) => reglerCivilite(st, e.target.value)}
                  >
                    <option value="">Civilité ?</option>
                    {CIVILITES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                {peutSaisir && (
                  <button className="btn petit"
                    onClick={() => setDetailDossier(deplieDossier ? null : st.inscription_id)}>
                    {deplieDossier ? "Fermer le dossier" : "Dossier"}
                  </button>
                )}
                {fiche && (
                  <button className="btn petit"
                    onClick={() => setDetailAbsence(deplie ? null : st.inscription_id)}>
                    {deplie ? "Fermer les absences" : `Absences (${fiche.absences.length})`}
                  </button>
                )}
                {peutSaisir && st.statut !== "abandon" && (
                  <button className="btn petit danger" onClick={() => marquerAbandon(st)}>Abandon</button>
                )}
              </div>
              {deplie && fiche && (
                <PanneauAbsences fiche={fiche} session={abs.session} peutSaisir={peutSaisir}
                  recharger={charger} erreur={erreur} />
              )}
              {deplieDossier && (
                <PanneauDossier st={st} groupes={d.groupes} prescripteurs={prescripteurs} recharger={charger} erreur={erreur} />
              )}
            </li>
            );
          })}
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
              <option value="">Aucun</option>
              {prescripteurs.filter((p) => p.actif).map((p) => <option key={p.id} value={p.code}>{p.nom}</option>)}
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

      {peutSaisir && (
        <Bloc titre="Importer des stagiaires (CSV)" ouvertParDefaut={d.stagiaires.length === 0}>
          <ImportStagiaires sessionId={sessionId} recharger={charger} erreur={erreur} />
        </Bloc>
      )}

      <Bloc titre="Évaluations & satisfaction">
        <Evaluations sessionId={sessionId} stagiaires={d.stagiaires} peutSaisir={peutSaisir} admin={admin}
          debut={d.session.date_debut} fin={d.session.date_fin} erreur={erreur} />
      </Bloc>

      <Bloc titre="Documents / Assiduité" ouvertParDefaut>
        <p className="muted small"><strong>Documents générés par Vigie</strong></p>
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
                <div className="muted small">{doc.modele} · portée {doc.portee} · {new Date(doc.genere_le).toLocaleString("fr-FR")} · <span className="pill spec">Généré par Vigie</span></div>
              </div>
            </li>
          ))}
          {d.documents.length === 0 && <li className="muted">Aucun document généré pour cette session.</li>}
        </ul>

        <p className="muted small"><strong>Documents externes / EduSign</strong></p>
        <ul className="liste-simple">
          {externes.map((p) => (
            <li key={p.id}>
              <div>
                <strong>{p.titre}</strong>
                <div className="muted small">Indicateur {p.indicateur} · <span className="pill off">EduSign / externe</span></div>
                {p.fichiers.length === 0 && <div className="muted small">Aucun fichier rattaché.</div>}
                {p.fichiers.map((f) => (
                  <div key={f.id} className="muted small">
                    <a href={f.url} target="_blank" rel="noreferrer">{f.nom || f.drive_file_id}</a>
                  </div>
                ))}
              </div>
            </li>
          ))}
          {externes.length === 0 && <li className="muted">Aucun document externe rattaché.</li>}
        </ul>

        {admin && (
        <div className="formulaire ligne">
          <label className="champ">
            <span className="muted small">Type (facultatif)</span>
            <select value={rattachement.type} onChange={(e) => {
              const type = e.target.value;
              setRattachement({ ...rattachement, type, titre: type || rattachement.titre });
            }}>
              <option value="">Libellé libre…</option>
              {TYPES_EDUSIGN.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <Champ label="Libellé" value={rattachement.titre} placeholder="Ex. Feuille d'émargement EduSign"
            onChange={(e) => setRattachement({ ...rattachement, titre: e.target.value })} />
          <label className="champ">
            <span className="muted small">Indicateur</span>
            <select value={rattachement.indicateur_id} onChange={(e) => setRattachement({ ...rattachement, indicateur_id: e.target.value })}>
              <option value="">Choisir…</option>
              {indicateurs.map((i) => <option key={i.id} value={i.id}>{i.numero} — {i.libelle}</option>)}
            </select>
          </label>
          <div className="champ">
            <span className="muted small">Fichier Drive</span>
            {rattachement.fichier
              ? <div className="muted small">Sélectionné : <strong>{rattachement.fichier.nom}</strong>
                  <button className="link" onClick={() => setRattachement({ ...rattachement, fichier: null })}>retirer</button>
                </div>
              : <RechercheDrive
                  surChoix={(f) => setRattachement({ ...rattachement, fichier: f })}
                  onErreur={erreur}
                  placeholder="Chercher le fichier à rattacher (export EduSign…)" />
            }
          </div>
          <button className="btn primary" onClick={rattacherExterne} disabled={occupe}>Rattacher</button>
        </div>
        )}
      </Bloc>
    </div>
  );
}

// ── Gestion des prescripteurs (admin) ────────────────────────
// Petite liste configurable : afficher, ajouter, renommer, désactiver.
// La désactivation ne touche pas les inscriptions passées ; un prescripteur
// inactif n'est plus proposé aux nouvelles inscriptions.
function GestionPrescripteurs({ prescripteurs, onChange, erreur }) {
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
    <Bloc titre={`Prescripteurs (${prescripteurs.length})`}>
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

// ── Écran ────────────────────────────────────────────────────
export default function Sessions({ admin, peutSaisir, onChange }) {
  const [formations, setFormations] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [modeles, setModeles] = useState([]);
  const [prescripteurs, setPrescripteurs] = useState([]);
  const [err, setErr] = useState(null);
  const [choisie, setChoisie] = useState(null);
  const [form, setForm] = useState({ formation_id: "", reference: "", date_debut: "", date_fin: "", lieu: "", formateur: "", duree_heures_reelle: "", horaire: "" });

  const charger = useCallback(async () => {
    try {
      const [f, s, m, p] = await Promise.all([
        api("/api/formations"), api("/api/sessions"), api("/api/modeles"), api("/api/prescripteurs"),
      ]);
      setFormations(f.formations);
      setSessions(s.sessions);
      setModeles(m.modeles);
      setPrescripteurs(p.prescripteurs);
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
      {err && <p className="flash erreur sticky">{err}</p>}

      {admin && <Formations formations={formations} onChange={charger} erreur={setErr} />}

      {admin && <GestionPrescripteurs prescripteurs={prescripteurs} onChange={charger} erreur={setErr} />}

      <Bloc titre={`Sessions (${sessions.length})`} ouvertParDefaut>
        <ul className="liste-simple">
          {sessions.map((s) => (
            <li key={s.id} className={choisie === s.id ? "actif" : ""}>
              <div>
                <strong>{s.reference || s.formation}</strong>
                <div className="muted small">
                  <span className={"pill " + classeStatut(s.statut)}>{STATUTS_SESSION[s.statut] || s.statut}</span>{" "}
                  {s.formation} · du {s.date_debut} au {s.date_fin}
                  {s.horaire && <> · {s.horaire}</>}{s.lieu && <> · {s.lieu}</>} · {s.nb_inscrits} inscrit(s)
                </div>
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
          <Champ label="Durée prévue (h)" type="number" min="0" value={form.duree_heures_reelle}
            onChange={(e) => setForm({ ...form, duree_heures_reelle: e.target.value })} />
          <Champ label="Horaire" value={form.horaire} placeholder="8h30–12h00 / 13h00–16h30"
            onChange={(e) => setForm({ ...form, horaire: e.target.value })} />
          <button className="btn primary" onClick={creerSession}>Créer la session</button>
        </div>
        )}
      </Bloc>

      {choisie && (
        <DetailSession
          sessionId={choisie} modeles={modeles} prescripteurs={prescripteurs} onChange={charger} erreur={setErr}
          admin={admin} peutSaisir={peutSaisir}
        />
      )}
    </section>
  );
}
