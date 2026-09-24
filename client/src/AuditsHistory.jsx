import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { RechercheDrive } from "./RechercheDrive.jsx";
import { Badge, Button, Drawer, EmptyState } from "./ui/index.js";

// Mêmes valeurs que les contraintes en base (migration 001) et que la
// validation serveur (services/audits.js).
const TYPES = {
  initial: "Audit initial",
  surveillance: "Surveillance",
  renouvellement: "Renouvellement",
  blanc: "Audit blanc",
  interne: "Audit interne",
};
const RESULTATS = {
  en_attente: { libelle: "En attente", ton: "neutral" },
  certifie: { libelle: "Certifié", ton: "success" },
  maintenu: { libelle: "Maintenu", ton: "success" },
  non_certifie: { libelle: "Non certifié", ton: "error" },
  suspendu: { libelle: "Suspendu", ton: "error" },
};

const formulaireVide = {
  type: "surveillance", date_audit: "", organisme_certificateur: "", auditeur: "",
  referentiel_version_id: "", resultat: "en_attente", nb_nc_mineures: "", nb_nc_majeures: "",
  non_conformites: "", commentaires: "",
  rapport_drive_file_id: "", rapport_drive_url: "", rapport_drive_nom: "",
};

const formaterDate = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "");

// Carte compacte d'un audit : le détail vit dans un panneau.
function Audit({ a, onOuvrir }) {
  const resultat = RESULTATS[a.resultat] || null;
  return (
    <article className="card audit">
      <div className="audit-tete">
        <div>
          <strong>{TYPES[a.type] || a.type}</strong>
          <div className="muted small">
            {formaterDate(a.date_audit)}
            {a.organisme_certificateur && <> · {a.organisme_certificateur}</>}
            {a.referentiel_code && <> · référentiel {a.referentiel_code}</>}
          </div>
        </div>
        {resultat && <Badge ton={resultat.ton}>{resultat.libelle}</Badge>}
      </div>
      <div className="audit-pied">
        <span className={"pill " + (a.nb_nc_majeures > 0 ? "off" : "")}>{a.nb_nc_majeures} NC majeure(s)</span>
        <span className={"pill " + (a.nb_nc_mineures > 0 ? "warn" : "")}>{a.nb_nc_mineures} NC mineure(s)</span>
        <Button compact onClick={() => onOuvrir(a.id)}>Ouvrir</Button>
      </div>
    </article>
  );
}

// Panneau de détail : synthèse, constats, suivi.
function DetailAudit({ a, onFermer }) {
  const nc = a ? (Array.isArray(a.non_conformites) ? a.non_conformites : []) : [];
  return (
    <Drawer ouvert={!!a} titre={a ? TYPES[a.type] || a.type : ""} onFermer={onFermer}
      description={a ? formaterDate(a.date_audit) : undefined}>
      {a && (
        <div className="audit-detail">
          <section aria-label="Synthèse">
            <h3 className="audit-detail__titre">Synthèse</h3>
            <dl className="audit-detail__grille">
              <div><dt>Date</dt><dd>{formaterDate(a.date_audit) || "—"}</dd></div>
              <div><dt>Résultat</dt><dd>{RESULTATS[a.resultat]?.libelle || a.resultat || "—"}</dd></div>
              <div><dt>Organisme</dt><dd>{a.organisme_certificateur || "—"}</dd></div>
              <div><dt>Auditeur</dt><dd>{a.auditeur || "—"}</dd></div>
              <div><dt>Référentiel</dt><dd>{a.referentiel_code ? `${a.referentiel_code} — ${a.referentiel_libelle || ""}` : "—"}</dd></div>
            </dl>
          </section>

          <section aria-label="Constats">
            <h3 className="audit-detail__titre">Constats</h3>
            <p className="muted small">{a.nb_nc_majeures} non-conformité(s) majeure(s) · {a.nb_nc_mineures} mineure(s)</p>
            {nc.length > 0 ? (
              <ul className="liste-nc">
                {nc.map((texte, i) => <li key={i}>{texte}</li>)}
              </ul>
            ) : (
              <p className="muted small">Aucune non-conformité relevée.</p>
            )}
          </section>

          <section aria-label="Suivi">
            <h3 className="audit-detail__titre">Suivi</h3>
            <p className="muted small">{a.commentaires || "Aucun commentaire."}</p>
          </section>

          {a.rapport_drive_file_id && (
            <a className="btn petit" href={a.rapport_drive_url || `https://drive.google.com/file/d/${a.rapport_drive_file_id}/view`}
              target="_blank" rel="noreferrer">
              {a.rapport_drive_nom || "Rapport d'audit"}
            </a>
          )}
        </div>
      )}
    </Drawer>
  );
}

export default function AuditsHistory({ admin }) {
  const [audits, setAudits] = useState([]);
  const [versions, setVersions] = useState([]);
  const [err, setErr] = useState(null);
  const [ouvertId, setOuvertId] = useState(null);
  const [form, setForm] = useState(null);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    try { setAudits((await api("/api/audits")).audits); setErr(null); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  // La version active est proposée par défaut : un audit porte presque
  // toujours sur le référentiel en vigueur le jour où il a lieu.
  useEffect(() => {
    api("/api/referentiel")
      .then((r) => setVersions([r.version]))
      .catch(() => {});
  }, []);

  function ouvrirFormulaire() {
    setForm({ ...formulaireVide, referentiel_version_id: versions[0] ? String(versions[0].id) : "" });
  }

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
      setForm(null);
      setErr(null);
      charger();
    } catch (e) { setErr(e.message); }
    finally { setOccupe(false); }
  }

  const champ = (clef, valeur) => setForm({ ...form, [clef]: valeur });
  const ouvert = audits.find((a) => a.id === ouvertId) || null;

  return (
    <section className="audits">
      <div className="ref-head">
        <div>
          <h1>Historique des audits</h1>
          <p className="muted">
            {audits.length} audit(s) enregistré(s) · mémoire de ce qui a été contrôlé et relevé
          </p>
        </div>
        {admin && <Button onClick={ouvrirFormulaire}>Nouvel audit</Button>}
      </div>
      {err && <p className="flash erreur">{err}</p>}

      {audits.length === 0 && <EmptyState titre="Aucun audit enregistré." />}
      {audits.map((a) => <Audit key={a.id} a={a} onOuvrir={setOuvertId} />)}

      <DetailAudit a={ouvert} onFermer={() => setOuvertId(null)} />

      <Drawer
        ouvert={!!form} titre="Enregistrer un audit" onFermer={() => setForm(null)} taille="large"
        pied={
          <div className="preuve-actions">
            <Button onClick={() => setForm(null)}>Annuler</Button>
            <Button variante="primary" onClick={enregistrer} disabled={occupe}>
              {occupe ? "Enregistrement…" : "Enregistrer l'audit"}
            </Button>
          </div>
        }
      >
        {form && (
          <div className="zone-actions">
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
          </div>
        )}
      </Drawer>
    </section>
  );
}
