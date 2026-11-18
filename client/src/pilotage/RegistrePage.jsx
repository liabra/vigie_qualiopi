import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";

// Page générique d'un registre de pilotage (tâches, risques, partenaires, ressources) : le formulaire et le
// tableau sont produits à partir du schéma servi par l'API (une seule définition, côté serveur).

const TON_STATUT = {
  a_faire: "info", en_cours: "warning", faite: "success", annulee: "neutral",
  actif: "warning", maitrise: "success", clos: "neutral", inactif: "neutral",
  en_service: "success", a_actualiser: "warning", retire: "neutral",
};
export const formaterDate = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");
const aujourdhui = () => new Date().toISOString().slice(0, 10);
export const tonCriticite = (n) => (n >= 12 ? "error" : n >= 6 ? "warning" : "success");

function valeurAffichee(champ, fiche) {
  const v = champ.nom === "indicateurs" ? fiche.indicateurs : fiche[champ.nom];
  if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) return "—";
  if (champ.nom === "responsable_id" || champ.nom === "referent_id") return fiche.responsable_nom || "—";
  if (champ.type === "enum") return champ.libelles?.[v] || v;
  if (champ.type === "date") return formaterDate(v);
  if (champ.type === "indicateurs") return v.join(", ");
  return String(v);
}

export function cellule(champ, fiche) {
  const texte = valeurAffichee(champ, fiche);
  if (champ.nom === "statut" && fiche.statut) return <Badge ton={TON_STATUT[fiche.statut] || "neutral"}>{texte}</Badge>;
  if (champ.nom === "criticite") return <Badge ton={tonCriticite(fiche.criticite)}>{texte}</Badge>;
  if (champ.type === "date" && champ.nom === "echeance" && fiche.echeance && fiche.echeance < aujourdhui() && ["a_faire", "en_cours"].includes(fiche.statut)) {
    return <span className="pilotage-retard">{texte} (en retard)</span>;
  }
  return texte;
}

// Valeurs du formulaire ↔ corps envoyé à l'API.
function valeursDe(schema, fiche) {
  const v = {};
  for (const c of schema.champs) {
    if (c.lectureSeule) continue;
    const brut = c.nom === "indicateurs" ? fiche?.indicateurs : fiche?.[c.nom];
    if (c.type === "indicateurs") v[c.nom] = (brut || []).join(", ");
    else v[c.nom] = brut === null || brut === undefined ? (fiche ? "" : (c.defaut ?? "")) : String(brut);
  }
  return v;
}
export function corpsDe(schema, valeurs, initiales) {
  const corps = {};
  for (const c of schema.champs) {
    if (c.lectureSeule || valeurs[c.nom] === initiales?.[c.nom]) continue;
    const v = valeurs[c.nom];
    if (c.type === "indicateurs") corps[c.nom] = String(v || "").split(/[\s,;]+/).filter(Boolean).map(Number);
    else if (c.type === "entier" || ["utilisateur", "formation", "action"].includes(c.type)) corps[c.nom] = v === "" ? null : Number(v);
    else corps[c.nom] = v === "" ? null : v;
  }
  return corps;
}

// `attributs` : id et aria-* posés par <Field> (libellé relié au contrôle réel, accessibilité).
function Controle({ champ, valeur, onChange, references, desactive, ...attributs }) {
  const commun = { ...attributs, value: valeur ?? "", onChange: (e) => onChange(e.target.value), disabled: desactive };
  if (champ.type === "texte_long") return <textarea rows={4} maxLength={champ.max} {...commun} />;
  if (champ.type === "enum") return <select {...commun}>{!champ.defaut && <option value="">—</option>}{champ.valeurs.map((k) => <option key={k} value={k}>{champ.libelles[k]}</option>)}</select>;
  if (champ.type === "date") return <input type="date" {...commun} />;
  if (champ.type === "entier") return <input type="number" min={champ.min} max={champ.max} step={1} {...commun} />;
  if (["utilisateur", "formation", "action"].includes(champ.type)) {
    const liste = references[champ.type] || [];
    return <select {...commun}><option value="">—</option>{liste.map((o) => <option key={o.id} value={String(o.id)}>{o.nom}</option>)}</select>;
  }
  const type = champ.type === "email" ? "email" : champ.type === "telephone" ? "tel" : champ.type === "url" ? "url" : "text";
  return <input type={type} maxLength={champ.max} {...commun} />;
}

export function RegistrePage({ nom, admin, actions }) {
  const [schema, setSchema] = useState(null);
  const [fiches, setFiches] = useState(null);
  const [ecriture, setEcriture] = useState(false);
  const [filtre, setFiltre] = useState("ouverts");
  const [mesFiches, setMesFiches] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [succes, setSucces] = useState(null);
  const [ouverte, setOuverte] = useState(null); // null | "nouvelle" | id
  const [references, setReferences] = useState({});
  useTitrePage(schema?.titre || "Registre");

  const charger = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filtre !== "tous") params.set("statut", filtre);
      if (mesFiches) params.set("responsable", "moi");
      const r = await api(`/api/registres/${nom}?${params}`);
      setFiches(r.fiches); setEcriture(r.ecriture); setErreur(null);
    } catch (e) { setErreur(e.message); }
  }, [nom, filtre, mesFiches]);

  useEffect(() => { setSchema(null); setFiches(null); setFiltre("ouverts"); api(`/api/registres/${nom}/schema`).then((r) => setSchema(r.schema)).catch((e) => setErreur(e.message)); }, [nom]);
  useEffect(() => { if (schema) charger(); }, [schema, charger]);
  useEffect(() => {
    if (!schema) return;
    const types = new Set(schema.champs.map((c) => c.type));
    const refs = {};
    const taches = [];
    if (types.has("utilisateur")) taches.push(api("/api/registres-utilisateurs").then((r) => { refs.utilisateur = r.utilisateurs; }).catch(() => {}));
    if (types.has("formation")) taches.push(api("/api/formations").then((r) => { refs.formation = (r.formations || []).map((f) => ({ id: f.id, nom: f.intitule })); }).catch(() => {}));
    if (types.has("action")) taches.push(api("/api/actions-qualite").then((r) => { refs.action = (r.actions || []).map((a) => ({ id: a.id, nom: `${a.reference} — ${a.titre}` })); }).catch(() => {}));
    Promise.all(taches).then(() => setReferences(refs));
  }, [schema]);

  const colonnes = useMemo(() => schema?.champs.filter((c) => c.colonne) || [], [schema]);
  const statut = schema?.champs.find((c) => c.nom === "statut");
  const article = schema?.feminin ? "Nouvelle" : "Nouveau";
  const bouton = ecriture && schema && <Button variante="primary" onClick={() => { setSucces(null); setOuverte("nouvelle"); }}>+ {article} {schema.singulier}</Button>;

  if (!schema) return erreur ? <Alert ton="error" titre="Le registre n'a pas pu être chargé.">{erreur}</Alert> : <LoadingState texte="Chargement…" />;
  return (
    <>
      <PageHeader fil={[{ libelle: "Pilotage" }, { libelle: schema.titre }]} titre={schema.titre} description={schema.description}
        actions={<>{actions?.({ recharger: charger, notifier: setSucces })}{bouton}</>} />
      {succes && <Alert ton="success">{succes}</Alert>}
      {erreur && <Alert ton="error" titre="Action impossible.">{erreur}</Alert>}
      <div className="sess-vues" role="group" aria-label="Filtrer">
        {[["ouverts", "En cours"], ["tous", "Tout"], ...(statut?.valeurs || []).map((v) => [v, statut.libelles[v]])].map(([v, l]) => (
          <button key={v} type="button" className={"sess-vue" + (filtre === v ? " sess-vue--active" : "")} aria-pressed={filtre === v} onClick={() => setFiltre(v)}>{l}</button>
        ))}
        {schema.champs.some((c) => c.nom === "responsable_id") && (
          <Checkbox label="Seulement les miennes" checked={mesFiches} onChange={(e) => setMesFiches(e.target.checked)} />
        )}
      </div>
      {!fiches && <LoadingState texte="Chargement…" />}
      {fiches?.length === 0 && <EmptyState titre="Rien à afficher" action={bouton}>Aucune fiche ne correspond à ce filtre.</EmptyState>}
      {fiches?.length > 0 && (
        <table className="sess-table">
          <caption className="visually-hidden">{schema.titre} ({fiches.length})</caption>
          <thead><tr>{colonnes.map((c) => <th key={c.nom} scope="col">{c.libelle.replace(/ \(.*\)$/, "")}</th>)}<th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {fiches.map((f) => (
              <tr key={f.id}>
                {colonnes.map((c, i) => <td key={c.nom} data-label={c.libelle} className={i === 0 ? "sess-table__principal" : undefined}>{cellule(c, f)}</td>)}
                <td className="sess-table__actions"><Button compact onClick={() => { setSucces(null); setOuverte(f.id); }} aria-label={`Ouvrir ${f.titre || f.nom}`}>{ecriture ? "Modifier" : "Consulter"}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ouverte !== null && (
        <PanneauFiche nom={nom} schema={schema} id={ouverte === "nouvelle" ? null : ouverte} ecriture={ecriture} admin={admin} references={references}
          onFermer={() => setOuverte(null)} onEnregistre={async (message) => { setOuverte(null); setSucces(message); await charger(); }} />
      )}
    </>
  );
}

function PanneauFiche({ nom, schema, id, ecriture, admin, references, onFermer, onEnregistre }) {
  const [fiche, setFiche] = useState(id ? null : {});
  const [historique, setHistorique] = useState([]);
  const [valeurs, setValeurs] = useState(id ? null : valeursDe(schema, null));
  const [initiales, setInitiales] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const [suppression, setSuppression] = useState(false);

  useEffect(() => {
    if (!id) return;
    api(`/api/registres/${nom}/${id}`).then((r) => { setFiche(r.fiche); setHistorique(r.historique); const v = valeursDe(schema, r.fiche); setValeurs(v); setInitiales(v); })
      .catch((e) => setErreur(e.message));
  }, [id, nom, schema]);

  async function enregistrer(e) {
    e.preventDefault();
    setEnCours(true); setErreur(null);
    try {
      const corps = corpsDe(schema, valeurs, id ? initiales : null);
      if (id && !Object.keys(corps).length) { onFermer(); return; }
      const r = await api(id ? `/api/registres/${nom}/${id}` : `/api/registres/${nom}`, { method: id ? "PATCH" : "POST", body: JSON.stringify(corps) });
      await onEnregistre(r.suivante_id ? "Enregistré. La prochaine occurrence de cette tâche récurrente a été créée." : "Enregistré.");
    } catch (err) { setErreur(err.message); setEnCours(false); }
  }
  async function supprimer() {
    setEnCours(true);
    try { await api(`/api/registres/${nom}/${id}`, { method: "DELETE" }); await onEnregistre("Fiche supprimée."); }
    catch (err) { setErreur(err.message); setEnCours(false); setSuppression(false); }
  }

  const lecture = !ecriture;
  return (
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} taille="large" titre={id ? (fiche?.titre || fiche?.nom || "Fiche") : `${schema.feminin ? "Nouvelle" : "Nouveau"} ${schema.singulier}`}
      pied={lecture ? <Button onClick={onFermer}>Fermer</Button> : (
        <>
          {id && admin && <Button variante="danger" onClick={() => setSuppression(true)} disabled={enCours}>Supprimer</Button>}
          <Button onClick={onFermer} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form={`form-registre-${nom}`} disabled={enCours || !valeurs}>{enCours ? "Enregistrement…" : "Enregistrer"}</Button>
        </>
      )}>
      {erreur && <Alert ton="error" titre="Non enregistré.">{erreur}</Alert>}
      {!valeurs && !erreur && <LoadingState texte="Chargement…" />}
      {valeurs && (
        <form id={`form-registre-${nom}`} onSubmit={enregistrer} noValidate className="ui-form">
          <fieldset className="ui-form-lecture" disabled={lecture || enCours}>
            <FormSection titre="Fiche" colonnes={2}>
              {schema.champs.map((c) => {
                if (c.lectureSeule) {
                  if (!id) return null;
                  return <div key={c.nom} className="ui-field"><span className="ui-field__label">{c.libelle}</span><div>{cellule(c, fiche || {})}</div></div>;
                }
                return (
                  <Field key={c.nom} label={c.libelle} facultatif={!c.requis} className={c.type === "texte_long" ? "ui-field--large" : undefined}
                    aide={c.type === "indicateurs" ? "Numéros séparés par des virgules (référentiel actif), par exemple : 1, 2, 30." : undefined}>
                    <Controle champ={c} valeur={valeurs[c.nom]} references={references} desactive={lecture} onChange={(v) => setValeurs({ ...valeurs, [c.nom]: v })} />
                  </Field>
                );
              })}
            </FormSection>
          </fieldset>
          {historique.length > 0 && (
            <details className="pilotage-historique">
              <summary>Historique ({historique.length})</summary>
              <ul>{historique.map((h, i) => (
                <li key={i}>{new Date(h.cree_le).toLocaleString("fr-FR")} — {h.par_nom || "système"} : {h.evenement}{h.champ ? ` · ${h.champ}` : ""}{h.nouvelle_valeur != null ? ` → ${h.nouvelle_valeur}` : ""}</li>
              ))}</ul>
            </details>
          )}
        </form>
      )}
      <ConfirmDialog ouvert={suppression} titre="Supprimer cette fiche ?" libelleConfirmer="Supprimer" enCours={enCours}
        onConfirmer={supprimer} onAnnuler={() => setSuppression(false)}>
        <p>La suppression est définitive. Préférez le statut « clos », « retiré » ou « annulée » pour garder la trace.</p>
      </ConfirmDialog>
    </Drawer>
  );
}
