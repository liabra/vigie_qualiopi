import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { RechercheDrive } from "./RechercheDrive.jsx";

// Mêmes valeurs que les contraintes en base (migration 001) et que la
// validation serveur (services/audits.js).
const TYPES = {
  initial: "Audit initial",
  surveillance: "Surveillance",
  renouvellement: "Renouvellement",
  blanc: "Audit blanc",
  interne: "Audit interne",
};
// La pastille colore le verdict : obtenu, maintenu, refusé, en attente.
const RESULTATS = {
  en_attente: { libelle: "En attente", classe: "" },
  certifie: { libelle: "Certifié", classe: "ok" },
  maintenu: { libelle: "Maintenu", classe: "ok" },
  non_certifie: { libelle: "Non certifié", classe: "off" },
  suspendu: { libelle: "Suspendu", classe: "off" },
};

const formulaireVide = {
  type: "surveillance", date_audit: "", organisme_certificateur: "", auditeur: "",
  referentiel_version_id: "", resultat: "en_attente", nb_nc_mineures: "", nb_nc_majeures: "",
  non_conformites: "", commentaires: "",
  rapport_drive_file_id: "", rapport_drive_url: "", rapport_drive_nom: "",
};

function Audit({ a }) {
  const resultat = RESULTATS[a.resultat] || null;
  const nc = Array.isArray(a.non_conformites) ? a.non_conformites : [];
  return (
    <article className="card audit">
      <div className="audit-tete">
        <div>
          <strong>{TYPES[a.type] || a.type}</strong>
          <div className="muted small">
            {new Date(a.date_audit).toLocaleDateString("fr-FR")}
            {a.organisme_certificateur && <> · {a.organisme_certificateur}</>}
            {a.auditeur && <> · {a.auditeur}</>}
            {a.referentiel_code && <> · référentiel {a.referentiel_code}</>}
          </div>
        </div>
        {resultat && <span className={"pill " + resultat.classe}>{resultat.libelle}</span>}
      </div>

      <div className="tags">
        <span className={"pill " + (a.nb_nc_majeures > 0 ? "off" : "")}>
          {a.nb_nc_majeures} NC majeure(s)
        </span>
        <span className={"pill " + (a.nb_nc_mineures > 0 ? "warn" : "")}>
          {a.nb_nc_mineures} NC mineure(s)
        </span>
        {a.rapport_drive_file_id && (
          <a className="pill" href={a.rapport_drive_url || `https://drive.google.com/file/d/${a.rapport_drive_file_id}/view`}
             target="_blank" rel="noreferrer">
            {a.rapport_drive_nom || "Rapport d'audit"}
          </a>
        )}
      </div>

      {nc.length > 0 && (
        <ul className="liste-nc">
          {nc.map((texte, i) => <li key={i}>{texte}</li>)}
        </ul>
      )}
      {a.commentaires && <p className="muted small">{a.commentaires}</p>}
    </article>
  );
}

export default function AuditsHistory({ admin }) {
  const [audits, setAudits] = useState([]);
  const [versions, setVersions] = useState([]);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState(formulaireVide);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    try { setAudits((await api("/api/audits")).audits); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  // La version active est proposée par défaut : un audit porte presque
  // toujours sur le référentiel en vigueur le jour où il a lieu.
  useEffect(() => {
    api("/api/referentiel")
      .then((r) => {
        setVersions([r.version]);
        setForm((f) => (f.referentiel_version_id ? f : { ...f, referentiel_version_id: String(r.version.id) }));
      })
      .catch(() => {});
  }, []);

  async function enregistrer() {
    if (!form.date_audit) return setErr("Indiquez la date de l'audit.");
    setOccupe(true);
    try {
      await api("/api/audits", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          referentiel_version_id: form.referentiel_version_id ? Number(form.referentiel_version_id) : null,
        }),
      });
      setForm({ ...formulaireVide, referentiel_version_id: form.referentiel_version_id });
      setErr(null);
      charger();
    } catch (e) { setErr(e.message); }
    finally { setOccupe(false); }
  }

  const champ = (clef, valeur) => setForm({ ...form, [clef]: valeur });

  return (
    <section className="audits">
      <div className="ref-head">
        <div>
          <h1>Historique des audits</h1>
          <p className="muted">
            {audits.length} audit(s) enregistré(s) · mémoire de ce qui a été contrôlé et relevé
          </p>
        </div>
      </div>
      {err && <p className="flash erreur">{err}</p>}

      {audits.length === 0 && <p className="muted">Aucun audit enregistré.</p>}
      {audits.map((a) => <Audit key={a.id} a={a} />)}

      {admin && (
        <div className="formulaire">
          <strong>Enregistrer un audit</strong>
          <div className="formulaire ligne">
            <label className="champ">
              <span className="muted small">Type</span>
              <select value={form.type} onChange={(e) => champ("type", e.target.value)} aria-label="Type d'audit">
                {Object.entries(TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="champ">
              <span className="muted small">Date</span>
              <input type="date" value={form.date_audit} onChange={(e) => champ("date_audit", e.target.value)} aria-label="Date de l'audit" />
            </label>
            <label className="champ">
              <span className="muted small">Résultat</span>
              <select value={form.resultat} onChange={(e) => champ("resultat", e.target.value)} aria-label="Résultat">
                {Object.entries(RESULTATS).map(([v, r]) => <option key={v} value={v}>{r.libelle}</option>)}
              </select>
            </label>
            <label className="champ">
              <span className="muted small">Référentiel</span>
              <select value={form.referentiel_version_id} onChange={(e) => champ("referentiel_version_id", e.target.value)} aria-label="Version du référentiel">
                <option value="">Non précisé</option>
                {versions.map((v) => <option key={v.id} value={v.id}>{v.code}</option>)}
              </select>
            </label>
            <label className="champ">
              <span className="muted small">Organisme certificateur</span>
              <input value={form.organisme_certificateur} onChange={(e) => champ("organisme_certificateur", e.target.value)} />
            </label>
            <label className="champ">
              <span className="muted small">Auditeur</span>
              <input value={form.auditeur} onChange={(e) => champ("auditeur", e.target.value)} />
            </label>
            <label className="champ">
              <span className="muted small">NC majeures</span>
              <input type="number" min="0" value={form.nb_nc_majeures} onChange={(e) => champ("nb_nc_majeures", e.target.value)} aria-label="Nombre de NC majeures" />
            </label>
            <label className="champ">
              <span className="muted small">NC mineures</span>
              <input type="number" min="0" value={form.nb_nc_mineures} onChange={(e) => champ("nb_nc_mineures", e.target.value)} aria-label="Nombre de NC mineures" />
            </label>
          </div>

          <label className="champ">
            <span className="muted small">Non-conformités relevées (une par ligne)</span>
            <textarea rows={3} value={form.non_conformites} onChange={(e) => champ("non_conformites", e.target.value)} aria-label="Non-conformités" />
          </label>
          <label className="champ">
            <span className="muted small">Commentaires</span>
            <textarea rows={2} value={form.commentaires} onChange={(e) => champ("commentaires", e.target.value)} aria-label="Commentaires" />
          </label>

          <div className="champ">
            <span className="muted small">
              Rapport d'audit sur le Drive
              {form.rapport_drive_file_id && <> · rattaché : {form.rapport_drive_nom || form.rapport_drive_file_id}</>}
            </span>
            <RechercheDrive
              placeholder="Chercher le rapport sur le Drive"
              dejaRattaches={form.rapport_drive_file_id ? [form.rapport_drive_file_id] : []}
              onErreur={setErr}
              surChoix={(f) => setForm({ ...form, rapport_drive_file_id: f.id, rapport_drive_url: f.url, rapport_drive_nom: f.nom })}
            />
          </div>

          <button className="btn primary" onClick={enregistrer} disabled={occupe}>
            {occupe ? "Enregistrement…" : "Enregistrer l'audit"}
          </button>
        </div>
      )}
    </section>
  );
}
