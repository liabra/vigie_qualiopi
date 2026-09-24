import { Fragment, useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Drawer, EmptyState, Field, FormSection } from "../ui/index.js";
import { DEMI_JOURNEES, SEUIL_ASSIDUITE, formaterDate, formaterHeures, syntheseAssiduite } from "./format.js";

// Onglet Assiduité. Principe métier inchangé : un stagiaire est PRÉSENT par
// défaut, seules les absences sont saisies. Le taux est calculé par le
// serveur et affiché seulement quand il le juge fiable (jamais pour un
// abandon ni sans durée prévue). Aucune durée n'est déduite d'une
// demi-journée : elle est toujours saisie.
export function OngletAssiduite({ donnees, peutSaisir, recharger, notifier }) {
  const abs = donnees.absences;
  const synthese = syntheseAssiduite(abs);
  const [deplie, setDeplie] = useState(() => new Set());
  const [formulaire, setFormulaire] = useState(null); // null | { id?, inscription_id, ... }
  const [suppression, setSuppression] = useState(null);
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);
  const [erreurSuppression, setErreurSuppression] = useState(null);

  const nom = (inscriptionId) => {
    const s = donnees.stagiaires.find((x) => x.inscription_id === inscriptionId);
    return s ? `${s.nom} ${s.prenom}` : "Stagiaire";
  };
  const basculer = (id) => setDeplie((d) => { const n = new Set(d); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function supprimer() {
    setSuppressionEnCours(true); setErreurSuppression(null);
    try {
      await api(`/api/absences/${suppression.id}`, { method: "DELETE" });
      notifier({ ton: "success", titre: `Absence du ${formaterDate(suppression.date_absence)} supprimée.` });
      setSuppression(null);
      await recharger();
    } catch (e) { setErreurSuppression(e.message); } finally { setSuppressionEnCours(false); }
  }

  const s = abs.session;
  return (
    <div className="sess-sections">
      <section className="sess-section" aria-labelledby="titre-synthese-assiduite">
        <div className="sess-section__tete">
          <h2 id="titre-synthese-assiduite" className="sess-section__titre">Synthèse</h2>
          {peutSaisir && donnees.stagiaires.length > 0 && (
            <Button compact variante="primary" onClick={() => setFormulaire({ id: null, inscription_id: "", date_absence: s.date_debut, demi_journee: "", duree_heures: "", justifiee: false, motif: "" })}>
              Saisir une absence
            </Button>
          )}
        </div>
        <p className="sess-secondaire">Chaque stagiaire est <strong>présent par défaut</strong> : seules les absences sont saisies.</p>
        <dl className="sess-chiffres">
          <div>
            <dt>Durée prévue</dt>
            <dd>
              {s.heures_prevues !== null ? formaterHeures(s.heures_prevues) : "Inconnue"}
              {s.source_heures_prevues === "duree_heures_defaut" && <span className="sess-secondaire"> (durée de la formation)</span>}
            </dd>
          </div>
          <div><dt>Absences</dt><dd>{synthese.nbAbsences} · {formaterHeures(synthese.totalHeures) || "0 h"}</dd></div>
          <div><dt>Assiduité sous {SEUIL_ASSIDUITE} %</dt><dd>{synthese.sousSeuil} stagiaire(s)</dd></div>
          <div><dt>Taux non calculé</dt><dd>{synthese.nonCalcules} stagiaire(s)</dd></div>
        </dl>
        {s.heures_prevues === null && (
          <Alert ton="warning" titre="Durée prévue inconnue">
            Aucune durée n'est déclarée pour la session ni pour la formation : seules les heures d'absence sont affichées, sans taux.
          </Alert>
        )}
        {synthese.depassements > 0 && (
          <Alert ton="warning" titre="Absences supérieures à la durée prévue">
            {synthese.depassements} stagiaire(s) cumulent plus d'heures d'absence que la durée prévue.
          </Alert>
        )}
      </section>

      <section className="sess-section" aria-labelledby="titre-assiduite-stagiaires">
        <h2 id="titre-assiduite-stagiaires" className="sess-section__titre">Par stagiaire</h2>
        {abs.stagiaires.length === 0 ? (
          <EmptyState titre="Aucun stagiaire inscrit">L'assiduité s'affichera dès que des stagiaires seront inscrits.</EmptyState>
        ) : (
          <table className="sess-table">
            <caption className="visually-hidden">Assiduité par stagiaire</caption>
            <thead>
              <tr>
                <th scope="col">Stagiaire</th>
                <th scope="col" className="sess-num">Absences</th>
                <th scope="col" className="sess-num">Heures d'absence</th>
                <th scope="col" className="sess-num">Heures suivies</th>
                <th scope="col">Assiduité</th>
                <th scope="col"><span className="visually-hidden">Détail</span></th>
              </tr>
            </thead>
            <tbody>
              {abs.stagiaires.map((f) => {
                const a = f.assiduite || {};
                const ouvert = deplie.has(f.inscription_id);
                const idDetail = `absences-${f.inscription_id}`;
                return (
                  <Fragment key={f.inscription_id}>
                    <tr>
                      <td data-label="Stagiaire" className="sess-table__principal">{nom(f.inscription_id)}</td>
                      <td data-label="Absences" className="sess-num">{f.absences.length}</td>
                      <td data-label="Heures d'absence" className="sess-num">{formaterHeures(f.total_heures_absence) || "0 h"}</td>
                      <td data-label="Heures suivies" className="sess-num">{a.fiable ? formaterHeures(a.heures_suivies) : "—"}</td>
                      <td data-label="Assiduité">
                        {a.fiable && <Badge ton={a.taux >= SEUIL_ASSIDUITE ? "success" : "warning"}>{a.taux} %</Badge>}
                        {a.raison === "abandon" && <Badge ton="neutral">Abandon — taux non calculé</Badge>}
                        {a.raison === "duree_inconnue" && <Badge ton="neutral">Durée inconnue</Badge>}
                        {a.depassement && <> <Badge ton="error">Au-delà de la durée prévue</Badge></>}
                      </td>
                      <td className="sess-table__actions">
                        <Button compact variante="ghost" aria-expanded={ouvert} aria-controls={idDetail} onClick={() => basculer(f.inscription_id)}>
                          {ouvert ? "Masquer" : "Voir les absences"}
                        </Button>
                      </td>
                    </tr>
                    {ouvert && (
                      <tr className="sess-table__detail" id={idDetail}>
                        <td colSpan={6}>
                          {f.absences.length === 0 ? (
                            <p className="sess-secondaire">Aucune absence enregistrée : présent sur toute la session.</p>
                          ) : (
                            <ul className="sess-absences">
                              {f.absences.map((x) => (
                                <li key={x.id}>
                                  <span>{formaterDate(x.date_absence)}</span>
                                  <span className="sess-secondaire">{DEMI_JOURNEES[x.demi_journee] || "Demi-journée non précisée"}</span>
                                  <strong>{formaterHeures(x.duree_heures)}</strong>
                                  <Badge ton={x.justifiee ? "success" : "error"}>{x.justifiee ? "Justifiée" : "Non justifiée"}</Badge>
                                  {x.motif && <span className="sess-secondaire sess-absences__motif">{x.motif}</span>}
                                  {peutSaisir && (
                                    <span className="sess-actions">
                                      <Button compact onClick={() => setFormulaire({
                                        id: x.id, inscription_id: String(f.inscription_id), date_absence: x.date_absence,
                                        demi_journee: x.demi_journee || "", duree_heures: x.duree_heures, justifiee: x.justifiee === true, motif: x.motif || "",
                                      })}>Modifier</Button>
                                      <Button compact variante="danger" onClick={() => { setErreurSuppression(null); setSuppression(x); }}>Supprimer</Button>
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {peutSaisir && (
        <DrawerAbsence
          valeurInitiale={formulaire} session={s} stagiaires={donnees.stagiaires}
          onFermer={() => setFormulaire(null)}
          onFait={async (message) => { setFormulaire(null); notifier({ ton: "success", titre: message }); await recharger(); }}
        />
      )}

      <ConfirmDialog
        ouvert={!!suppression} titre="Supprimer cette absence ?" libelleConfirmer="Supprimer l'absence"
        enCours={suppressionEnCours} onAnnuler={() => setSuppression(null)} onConfirmer={supprimer}
      >
        {suppression && (
          <>
            <p>Absence du <strong>{formaterDate(suppression.date_absence)}</strong> ({formaterHeures(suppression.duree_heures)}). Le stagiaire redeviendra présent sur cette période.</p>
            {erreurSuppression && <Alert ton="error">{erreurSuppression}</Alert>}
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}

function DrawerAbsence({ valeurInitiale, session, stagiaires, onFermer, onFait }) {
  const [v, setV] = useState(null);
  const [erreurs, setErreurs] = useState({});
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => { setV(valeurInitiale); setErreurs({}); setErreur(null); }, [valeurInitiale]);

  async function valider(e) {
    e.preventDefault();
    const trouvees = {};
    if (!v.inscription_id) trouvees.inscription_id = "Choisissez le stagiaire.";
    if (!v.date_absence) trouvees.date_absence = "Indiquez la date de l'absence.";
    if (!(Number(v.duree_heures) > 0)) trouvees.duree_heures = "Indiquez une durée d'absence en heures, supérieure à 0.";
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    setEnCours(true); setErreur(null);
    try {
      const corps = {
        date_absence: v.date_absence, demi_journee: v.demi_journee || null, duree_heures: Number(v.duree_heures),
        justifiee: v.justifiee === true, motif: v.motif || null,
      };
      if (v.id) await api(`/api/absences/${v.id}`, { method: "PATCH", body: JSON.stringify(corps) });
      else await api(`/api/inscriptions/${v.inscription_id}/absences`, { method: "POST", body: JSON.stringify(corps) });
      await onFait(v.id ? "Absence modifiée." : "Absence enregistrée.");
    } catch (err) { setErreur(err.message); } finally { setEnCours(false); }
  }

  const ouvert = !!v;
  return (
    <Drawer ouvert={ouvert} onFermer={onFermer} fermable={!enCours}
      titre={v?.id ? "Modifier l'absence" : "Saisir une absence"}
      description={`Date comprise entre le ${formaterDate(session.date_debut)} et le ${formaterDate(session.date_fin)}.`}
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
        <Button variante="primary" type="submit" form="form-absence" disabled={enCours}>
          {enCours ? "Enregistrement…" : v?.id ? "Enregistrer l'absence" : "Ajouter l'absence"}
        </Button></>}>
      {ouvert && (
        <form id="form-absence" onSubmit={valider} noValidate className="ui-form">
          {erreur && <Alert ton="error" titre="L'absence n'a pas été enregistrée.">{erreur}</Alert>}
          <FormSection titre="Absence">
            <Field label="Stagiaire" erreur={erreurs.inscription_id} className="ui-field--large">
              <select value={v.inscription_id} onChange={(e) => setV({ ...v, inscription_id: e.target.value })} disabled={!!v.id}>
                <option value="">Choisir…</option>
                {stagiaires.map((st) => <option key={st.inscription_id} value={String(st.inscription_id)}>{st.nom} {st.prenom}</option>)}
              </select>
            </Field>
            <Field label="Date" erreur={erreurs.date_absence}>
              <input type="date" value={v.date_absence} min={session.date_debut} max={session.date_fin} onChange={(e) => setV({ ...v, date_absence: e.target.value })} />
            </Field>
            <Field label="Demi-journée" facultatif>
              <select value={v.demi_journee} onChange={(e) => setV({ ...v, demi_journee: e.target.value })}>
                <option value="">Non précisée</option>
                {Object.entries(DEMI_JOURNEES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="Durée (heures)" erreur={erreurs.duree_heures} aide="Toujours saisie : elle n'est jamais déduite de la demi-journée.">
              <input type="number" min="0" max="24" step="0.25" inputMode="decimal" value={v.duree_heures} onChange={(e) => setV({ ...v, duree_heures: e.target.value })} />
            </Field>
            <Checkbox label="Absence justifiée" checked={v.justifiee} onChange={(e) => setV({ ...v, justifiee: e.target.checked })} />
            <Field label="Motif" facultatif className="ui-field--large">
              <input value={v.motif} onChange={(e) => setV({ ...v, motif: e.target.value })} />
            </Field>
          </FormSection>
        </form>
      )}
    </Drawer>
  );
}
