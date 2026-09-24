import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";

export const TYPES_VERSION = {
  active: { libelle: "Active", ton: "success" },
  future: { libelle: "Future", ton: "info" },
  historique: { libelle: "Historique", ton: "neutral" },
};
const VIDE = { code: "", libelle: "", date_publication: "", date_application: "", source: "", note: "" };

export function formaterDateVersion(d) {
  if (!d) return null;
  const [a, m, j] = String(d).slice(0, 10).split("-");
  return a && m && j ? `${j}/${m}/${a}` : null;
}

// Une version sans critère ou sans indicateur est une COQUILLE : le serveur
// refuse de l'activer (409). L'interface ne la propose donc pas.
export const estCoquille = (contenu) => !!contenu && (contenu.criteres === 0 || contenu.indicateurs === 0);

// /versions (admin) : page sensible. La version active d'abord, puis les
// autres ; l'activation passe TOUJOURS par une confirmation explicite.
export function VersionsPage({ onChange }) {
  useTitrePage("Versions du référentiel");
  const [versions, setVersions] = useState(null);
  const [contenus, setContenus] = useState({}); // id → { criteres, indicateurs } | "erreur"
  const [err, setErr] = useState(null);
  const [erreurAction, setErreurAction] = useState(null);
  const [succes, setSucces] = useState(null);
  const [avertissement, setAvertissement] = useState(null);
  const [aActiver, setAActiver] = useState(null);
  const [activation, setActivation] = useState(false);
  const [creation, setCreation] = useState(false);

  const charger = useCallback(async () => {
    try {
      const r = await api("/api/referentiel/versions");
      setVersions(r.versions || []);
      setErr(null);
      // Nombre de critères / indicateurs de chaque version (lecture seule).
      const paires = await Promise.all((r.versions || []).map(async (v) => {
        try {
          const d = await api(`/api/referentiel/versions/${v.id}`);
          const criteres = d.criteres || [];
          return [v.id, { criteres: criteres.length, indicateurs: criteres.reduce((n, c) => n + (c.indicateurs || []).length, 0) }];
        } catch { return [v.id, "erreur"]; }
      }));
      setContenus(Object.fromEntries(paires));
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  async function activer() {
    setActivation(true);
    setErreurAction(null); setAvertissement(null);
    try {
      const r = await api(`/api/referentiel/versions/${aActiver.id}/activer`, { method: "POST" });
      const code = aActiver.code;
      setAActiver(null);
      await charger();
      setSucces(`La version ${code} est désormais active.`);
      if (r.avertissement) setAvertissement(r.avertissement);
      onChange?.();
    } catch (e) {
      setErreurAction(e.message);
      setAActiver(null);
    } finally {
      setActivation(false);
    }
  }

  const active = versions?.find((v) => v.est_active);
  const autres = versions?.filter((v) => !v.est_active) || [];
  const preparer = <Button onClick={() => { setSucces(null); setErreurAction(null); setCreation(true); }}>Préparer une nouvelle version</Button>;

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Paramètres" }, { libelle: "Versions du référentiel" }]}
        titre="Versions du référentiel"
        description="Plusieurs versions coexistent : une seule est active et sert partout (indicateurs, preuves, veille, modèles)."
        actions={versions && preparer}
      />
      {succes && <Alert ton="success">{succes}</Alert>}
      {avertissement && <Alert ton="warning">{avertissement}</Alert>}
      {erreurAction && <Alert ton="error" titre="La version n'a pas été activée.">{erreurAction}</Alert>}
      {err && <Alert ton="error" titre="Les versions n'ont pas pu être chargées." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!versions && !err && <LoadingState texte="Chargement des versions…" />}

      {versions && (
        <>
          <section className="param-section" aria-labelledby="versions-active">
            <h2 id="versions-active" className="param-section__titre">Version active</h2>
            {active
              ? <CarteVersion v={active} contenu={contenus[active.id]} />
              : <Alert ton="warning" titre="Aucune version active.">Activez une version dont le contenu a été importé.</Alert>}
          </section>

          <section className="param-section" aria-labelledby="versions-autres">
            <h2 id="versions-autres" className="param-section__titre">Autres versions</h2>
            {autres.length === 0
              ? <EmptyState titre="Aucune autre version">
                  Préparez la prochaine version (par exemple V10) : seules ses métadonnées sont créées ici, son contenu viendra d'un import.
                </EmptyState>
              : autres.map((v) => (
                <CarteVersion key={v.id} v={v} contenu={contenus[v.id]}
                  action={<ActionActivation v={v} contenu={contenus[v.id]} onActiver={() => { setSucces(null); setAvertissement(null); setErreurAction(null); setAActiver(v); }} />} />
              ))}
          </section>
        </>
      )}

      <CreationVersion ouvert={creation} onFermer={() => setCreation(false)}
        onCree={async (code) => { setCreation(false); await charger(); setSucces(`Version ${code} préparée. Elle ne sera activable qu'après l'import de son contenu.`); }} />

      <ConfirmDialog
        ouvert={!!aActiver} titre={`Activer la version ${aActiver?.code} ?`} libelleConfirmer="Activer cette version"
        ton="primary" enCours={activation} onConfirmer={activer} onAnnuler={() => setAActiver(null)}
      >
        <p>
          <strong>{aActiver?.code}</strong> remplacera <strong>{active?.code || "la version actuelle"}</strong> comme référentiel
          utilisé partout : tableau de bord, indicateurs, preuves, veille et modèles.
        </p>
        {aActiver?.type === "future" && <p>Sa date d'application ({formaterDateVersion(aActiver.date_application)}) n'est pas encore atteinte.</p>}
        <p>Une seule version est active à la fois.</p>
      </ConfirmDialog>
    </>
  );
}

function ActionActivation({ v, contenu, onActiver }) {
  if (contenu === undefined) return <span className="sess-secondaire">Vérification du contenu…</span>;
  if (contenu === "erreur") return <span className="sess-secondaire">Contenu non vérifié : activation indisponible.</span>;
  if (estCoquille(contenu)) return <span className="sess-secondaire">Activation impossible tant que le contenu n'est pas importé.</span>;
  return <Button compact onClick={onActiver} aria-label={`Activer la version ${v.code}`}>Activer…</Button>;
}

function CarteVersion({ v, contenu, action }) {
  const type = TYPES_VERSION[v.type] || { libelle: v.type, ton: "neutral" };
  return (
    <article className={"param-carte" + (v.est_active ? " param-carte--active" : "")} aria-label={`Version ${v.code}`}>
      <div className="param-carte__tete">
        <div>
          <h3 className="param-carte__titre">{v.code} <span className="param-carte__libelle">— {v.libelle}</span></h3>
          <div className="sess-badges">
            <Badge ton={type.ton}>{type.libelle}</Badge>
            {estCoquille(contenu) && <Badge ton="warning">Contenu non importé</Badge>}
          </div>
        </div>
        {action && <div className="param-carte__action">{action}</div>}
      </div>
      <dl className="param-carte__meta">
        <div><dt>Publication</dt><dd>{formaterDateVersion(v.date_publication) || "—"}</dd></div>
        <div><dt>Application</dt><dd>{formaterDateVersion(v.date_application) || "—"}</dd></div>
        <div><dt>Contenu</dt><dd>
          {contenu === undefined ? "…" : contenu === "erreur" ? "Non vérifié" : `${contenu.criteres} critère(s) · ${contenu.indicateurs} indicateur(s)`}
        </dd></div>
        {v.source && <div><dt>Source</dt><dd>{v.source}</dd></div>}
      </dl>
      {v.note && <p className="sess-secondaire">{v.note}</p>}
    </article>
  );
}

function CreationVersion({ ouvert, onFermer, onCree }) {
  const [valeurs, setValeurs] = useState(VIDE);
  const [erreurs, setErreurs] = useState({});
  const [erreurServeur, setErreurServeur] = useState(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    setValeurs(VIDE); setErreurs({}); setErreurServeur(null); setEnCours(false);
  }, [ouvert]);

  const champ = (cle) => (e) => setValeurs({ ...valeurs, [cle]: e.target.value });

  async function creer(e) {
    e.preventDefault();
    const trouvees = {};
    if (!valeurs.code.trim()) trouvees.code = "Indiquez un code (ex. V10).";
    if (!valeurs.libelle.trim()) trouvees.libelle = "Indiquez un libellé.";
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    setEnCours(true);
    setErreurServeur(null);
    try {
      await api("/api/referentiel/versions", { method: "POST", body: JSON.stringify(valeurs) });
      await onCree(valeurs.code.trim());
    } catch (err) {
      setErreurServeur(err.message);
      setEnCours(false);
    }
  }

  return (
    <Drawer
      ouvert={ouvert} onFermer={onFermer} fermable={!enCours}
      titre="Préparer une nouvelle version"
      description="Seules les métadonnées sont créées ici : le contenu officiel des critères et indicateurs viendra d'un import ultérieur."
      pied={
        <>
          <Button onClick={onFermer} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-version" disabled={enCours}>
            {enCours ? "Création…" : "Créer la version"}
          </Button>
        </>
      }
    >
      <form id="form-version" onSubmit={creer} noValidate>
        {erreurServeur && <Alert ton="error" titre="La version n'a pas été créée.">{erreurServeur}</Alert>}
        <FormSection titre="Identification">
          <Field label="Code" erreur={erreurs.code}><input value={valeurs.code} onChange={champ("code")} placeholder="V10" required /></Field>
          <Field label="Libellé" erreur={erreurs.libelle}><input value={valeurs.libelle} onChange={champ("libelle")} required /></Field>
        </FormSection>
        <FormSection titre="Dates">
          <Field label="Date de publication" facultatif><input type="date" value={valeurs.date_publication} onChange={champ("date_publication")} /></Field>
          <Field label="Date d'application" facultatif><input type="date" value={valeurs.date_application} onChange={champ("date_application")} /></Field>
        </FormSection>
        <FormSection titre="Origine" colonnes={1}>
          <Field label="Source" facultatif><input value={valeurs.source} onChange={champ("source")} /></Field>
          <Field label="Note" facultatif><input value={valeurs.note} onChange={champ("note")} /></Field>
        </FormSection>
      </form>
    </Drawer>
  );
}
