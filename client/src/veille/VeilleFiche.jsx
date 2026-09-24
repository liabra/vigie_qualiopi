import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api.js";
import { RechercheDrive } from "../RechercheDrive.jsx";
import { Alert, Badge, Button, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { STATUTS_ACTION, STATUTS_VEILLE, TYPES_VEILLE, formaterDate, lienExterneSur } from "./format.js";

// Texte long saisi (résumé, analyse, action) : paragraphes conservés, jamais
// de rendu « formulaire désactivé ».
const Texte = ({ valeur, vide }) => (valeur?.trim()
  ? <div className="veille-texte">{valeur}</div>
  : <p className="sess-secondaire">{vide}</p>);

const Meta = ({ libelle, children }) => (
  <div className="veille-meta__ligne"><dt>{libelle}</dt><dd>{children}</dd></div>
);

// /veille/:id : fiche de lecture en trois temps — S'informer, Analyser,
// Agir — avec une colonne de métadonnées courtes sur ordinateur.
export function VeilleFiche({ veilleId, admin }) {
  const location = useLocation();
  const [donnees, setDonnees] = useState(null);
  const [introuvable, setIntrouvable] = useState(false);
  const [err, setErr] = useState(null);
  const [numeros, setNumeros] = useState({});
  const [rattachement, setRattachement] = useState(false);
  const [succes, setSucces] = useState(location.state?.succes || null);

  const charger = useCallback(async () => {
    try { setDonnees(await api(`/api/veille/${veilleId}`)); setErr(null); setIntrouvable(false); } catch (e) {
      if (e.status === 404 || e.status === 400) setIntrouvable(true); else setErr(e.message);
    }
  }, [veilleId]);
  useEffect(() => { charger(); }, [charger]);
  // Numéro d'indicateur des preuves liées (l'API renvoie l'identifiant).
  useEffect(() => {
    api("/api/referentiel").then((r) => setNumeros(Object.fromEntries(
      (r.criteres || []).flatMap((c) => (c.indicateurs || []).map((i) => [i.id, i.numero])),
    ))).catch(() => {});
  }, []);

  const v = donnees?.veille;
  useTitrePage(v ? v.titre : "Veille");

  if (introuvable) {
    return (
      <>
        <PageHeader fil={[{ libelle: "Qualité" }, { libelle: "Veille", to: "/veille" }, { libelle: "Veille introuvable" }]} titre="Veille introuvable" />
        <EmptyState titre="Cette veille n'existe pas ou n'existe plus." action={<Button variante="primary" to="/veille">Voir toute la veille</Button>}>
          Vérifiez le lien utilisé.
        </EmptyState>
      </>
    );
  }
  if (err && !donnees) return <Alert ton="error" titre="La veille n'a pas pu être chargée." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>;
  if (!donnees) return <LoadingState texte="Chargement de la veille…" />;

  const st = STATUTS_VEILLE[v.statut] || { libelle: v.statut, ton: "neutral" };
  const ac = STATUTS_ACTION[v.statut_action] || { libelle: v.statut_action, ton: "neutral" };
  const lien = lienExterneSur(v.url);
  const indicateurs = v.indicateurs || [];

  return (
    <div className="veille-fiche">
      <PageHeader
        fil={[{ libelle: "Qualité" }, { libelle: "Veille", to: "/veille" }, { libelle: v.titre }]}
        titre={v.titre}
        actions={admin && <Button to={`/veille/${v.id}/modifier`}>Modifier</Button>}
      />
      <div className="veille-badges">
        <Badge ton={st.ton}>{st.libelle}</Badge>
        {v.statut_action !== "aucune" && <Badge ton={ac.ton}>{ac.libelle}</Badge>}
        {v.rupture_reglementaire && <Badge ton="error">Rupture réglementaire</Badge>}
        <span className="sess-secondaire">{TYPES_VEILLE[v.type] || v.type}</span>
      </div>
      {succes && <Alert ton="success" titre={succes} action={<Button variante="ghost" compact onClick={() => setSucces(null)}>Fermer</Button>} />}

      <div className="veille-grille">
        <div className="veille-principal">
          <section className="veille-etape" aria-labelledby="etape-informer">
            <h2 id="etape-informer" className="veille-etape__titre"><span className="veille-etape__num" aria-hidden="true">1</span>S'informer</h2>
            <div className="veille-origine">
              <p><span className="sess-secondaire">Source</span>{v.source || "Non renseignée"}</p>
              {v.url && (
                <p>
                  <span className="sess-secondaire">Lien</span>
                  {lien
                    ? <a href={lien} target="_blank" rel="noopener noreferrer" className="veille-lien-externe">{lien}<span className="visually-hidden"> (site externe, nouvel onglet)</span><span aria-hidden="true"> ↗</span></a>
                    : <span>{v.url}</span>}
                </p>
              )}
            </div>
            <h3 className="veille-sous-titre">Résumé</h3>
            <Texte valeur={v.resume} vide="Aucun résumé." />
          </section>

          <section className="veille-etape" aria-labelledby="etape-analyser">
            <h2 id="etape-analyser" className="veille-etape__titre"><span className="veille-etape__num" aria-hidden="true">2</span>Analyser</h2>
            {v.rupture_reglementaire && (
              <Alert ton="warning" titre="Rupture réglementaire">Cette veille a été signalée comme une rupture réglementaire.</Alert>
            )}
            <h3 className="veille-sous-titre">Analyse d'impact pour l'organisme</h3>
            <Texte valeur={v.analyse_impact} vide={v.statut === "a_analyser" ? "Analyse à réaliser." : "Aucune analyse rédigée."} />
            <h3 className="veille-sous-titre">Indicateurs Qualiopi concernés</h3>
            {indicateurs.length === 0 ? <p className="sess-secondaire">Aucun indicateur lié.</p> : (
              <ul className="veille-indicateurs">
                {indicateurs.map((i) => <li key={i.id}><strong>Indicateur {i.numero}</strong> — {i.libelle}</li>)}
              </ul>
            )}
          </section>

          <section className={"veille-etape" + (v.statut_action === "a_realiser" ? " veille-etape--attention" : "")} aria-labelledby="etape-agir">
            <h2 id="etape-agir" className="veille-etape__titre"><span className="veille-etape__num" aria-hidden="true">3</span>Agir</h2>
            {v.statut_action === "aucune" && !v.action ? (
              <p className="sess-secondaire">Aucune action décidée.</p>
            ) : (
              <>
                <div className="veille-badges">
                  <Badge ton={ac.ton}>{ac.libelle}</Badge>
                  {v.statut_action === "realisee" && v.action_realisee_le && <span>le {formaterDate(v.action_realisee_le)}</span>}
                </div>
                <h3 className="veille-sous-titre">Action décidée</h3>
                <Texte valeur={v.action} vide="Aucun libellé d'action." />
              </>
            )}
            <div className="veille-preuves">
              <div className="sess-section__tete">
                <h3 className="veille-sous-titre">Preuves liées</h3>
                {admin && indicateurs.length > 0 && <Button compact onClick={() => setRattachement(true)}>Rattacher une preuve</Button>}
              </div>
              {donnees.preuves.length === 0 ? <p className="sess-secondaire">Aucune preuve rattachée à cette veille.</p> : (
                <ul className="veille-liste-preuves">
                  {donnees.preuves.map((p) => (
                    <li key={p.id}>
                      <strong>{p.titre}</strong>
                      <span className="sess-secondaire">{numeros[p.indicateur_id] ? `Indicateur ${numeros[p.indicateur_id]}` : "Indicateur hors référentiel actif"}</span>
                      {(p.fichiers || []).map((f) => {
                        const u = lienExterneSur(f.url);
                        return u
                          ? <a key={f.id} href={u} target="_blank" rel="noopener noreferrer">{f.nom || f.drive_file_id}<span className="visually-hidden"> (Drive, nouvel onglet)</span></a>
                          : <span key={f.id}>{f.nom || f.drive_file_id}</span>;
                      })}
                    </li>
                  ))}
                </ul>
              )}
              {donnees.preuves.length > 0 && <p><Link to="/preuves" className="sess-carte__lien">Voir l'écran Preuves</Link></p>}
            </div>
          </section>
        </div>

        <aside className="veille-meta" aria-label="Informations clés">
          <dl>
            <Meta libelle="Statut"><Badge ton={st.ton}>{st.libelle}</Badge></Meta>
            <Meta libelle="Action"><Badge ton={ac.ton}>{ac.libelle}</Badge></Meta>
            {v.statut_action === "realisee" && <Meta libelle="Réalisée le">{formaterDate(v.action_realisee_le) || "—"}</Meta>}
            <Meta libelle="Type">{TYPES_VEILLE[v.type] || v.type}</Meta>
            <Meta libelle="Publiée le">{formaterDate(v.date_publication) || "—"}</Meta>
            <Meta libelle="Date d'effet">{formaterDate(v.date_effet) || "—"}</Meta>
            <Meta libelle="Consultée le">{formaterDate(v.date_consultation) || "—"}</Meta>
            <Meta libelle="Indicateurs">{indicateurs.length ? indicateurs.map((i) => i.numero).join(", ") : "—"}</Meta>
          </dl>
        </aside>
      </div>

      {admin && (
        <DrawerPreuve ouvert={rattachement} veille={v} onFermer={() => setRattachement(false)}
          onFait={async () => { setRattachement(false); setSucces("Preuve rattachée."); await charger(); }} />
      )}
    </div>
  );
}

// Rattacher une preuve Drive à la veille (admin) — même appel qu'avant UX-3.
function DrawerPreuve({ ouvert, veille, onFermer, onFait }) {
  const [p, setP] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    if (ouvert) { setP({ indicateur_id: String(veille.indicateurs?.[0]?.id || ""), titre: "", fichier: null }); setErreur(null); }
  }, [ouvert]); // eslint-disable-line react-hooks/exhaustive-deps

  async function valider(e) {
    e.preventDefault();
    if (!p.indicateur_id || !p.fichier) return setErreur("Choisissez un indicateur et un fichier du Drive.");
    setEnCours(true); setErreur(null);
    try {
      await api("/api/preuves", {
        method: "POST",
        body: JSON.stringify({
          indicateur_id: Number(p.indicateur_id), veille_id: veille.id, titre: p.titre || "Preuve d'action", mode_fichiers: "unique",
          drive_file_id: p.fichier.id, drive_url: p.fichier.url, drive_nom: p.fichier.nom, drive_mime: p.fichier.mime,
        }),
      });
      await onFait();
    } catch (err) { setErreur(err.message); } finally { setEnCours(false); }
  }

  return (
    <Drawer ouvert={ouvert} onFermer={onFermer} fermable={!enCours} titre="Rattacher une preuve"
      description="Un document du Drive qui prouve l'action menée, rattaché à l'un des indicateurs de la veille."
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
        <Button variante="primary" type="submit" form="form-preuve-veille" disabled={enCours}>{enCours ? "Enregistrement…" : "Enregistrer la preuve"}</Button></>}>
      {p && (
        <form id="form-preuve-veille" onSubmit={valider} noValidate className="ui-form">
          {erreur && <Alert ton="error" titre="La preuve n'a pas été rattachée.">{erreur}</Alert>}
          <FormSection titre="Preuve" colonnes={1}>
            <Field label="Indicateur">
              <select value={p.indicateur_id} onChange={(e) => setP({ ...p, indicateur_id: e.target.value })}>
                <option value="">Choisir…</option>
                {(veille.indicateurs || []).map((i) => <option key={i.id} value={i.id}>{i.numero} — {i.libelle}</option>)}
              </select>
            </Field>
            <Field label="Titre de la preuve" facultatif aide="À défaut : « Preuve d'action ».">
              <input value={p.titre} onChange={(e) => setP({ ...p, titre: e.target.value })} />
            </Field>
          </FormSection>
          <FormSection titre="Fichier Drive" colonnes={1}>
            {p.fichier
              ? <p>Fichier : <strong>{p.fichier.nom}</strong> <Button compact variante="ghost" onClick={() => setP({ ...p, fichier: null })}>Retirer</Button></p>
              : <RechercheDrive surChoix={(f) => setP({ ...p, fichier: f })} onErreur={setErreur} placeholder="Chercher un fichier sur le Drive" />}
          </FormSection>
        </form>
      )}
    </Drawer>
  );
}
