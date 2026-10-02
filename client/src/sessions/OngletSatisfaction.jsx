import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { RechercheDrive } from "../RechercheDrive.jsx";
import { Alert, Badge, Button, Drawer, EmptyState, Field, FormSection } from "../ui/index.js";
import { formaterDate } from "./format.js";

export const TYPES_SATISFACTION = { a_chaud: "À chaud", a_froid: "À froid", financeur: "Financeur", entreprise: "Entreprise", formateur: "Formateur", prescripteur: "Prescripteur", partenaire: "Partenaire" };
const NOTE_MAX = 5; // échelle proposée par défaut ; les échelles existantes sont conservées
const lienDrive = (id) => `https://drive.google.com/file/d/${id}/view`;
const vide = () => ({ type: "a_chaud", inscription_id: "", date_recueil: "", note_globale: "", note_max: "5", commentaires: "", fichier: null });
export const MSG_INSUFFISANT = "Résultats insuffisants pour une restitution regroupée";
const AIDE_ANONYMAT = "Une réponse anonyme n'est rattachée à aucun stagiaire : ni nom ni adresse e-mail ne sont conservés. Les commentaires libres peuvent néanmoins permettre de reconnaître quelqu'un ; ils restent réservés à l'administrateur.";
const moyenneTexte = (moyenne, echelle) => (moyenne !== null && moyenne !== undefined ? `${moyenne} / ${echelle}` : "Non calculable (échelles différentes)");

// Onglet Satisfaction. ADMIN : réponses individuelles, commentaires, imports.
// CONTRIBUTEUR : résultats REGROUPÉS par public seulement (le serveur ne lui
// renvoie rien d'individuel), groupes de moins de 5 réponses non restitués.
export function OngletSatisfaction({ donnees, admin, peutSaisir, recharger, notifier, archivee }) {
  const { session, stagiaires } = donnees;
  const sa = donnees.satisfactions;
  const [formulaire, setFormulaire] = useState(null);
  const [importOuvert, setImportOuvert] = useState(false);
  const saisie = peutSaisir && !archivee;

  return (
    <div className="sess-sections">
      <section className="sess-section" aria-labelledby="titre-satisfaction">
        <div className="sess-section__tete">
          <h2 id="titre-satisfaction" className="sess-section__titre">Satisfaction</h2>
          {saisie && (
            <div className="sess-actions">
              {admin && <Button compact onClick={() => setImportOuvert(true)}>Importer des réponses (CSV Google Forms)</Button>}
              <Button compact variante="primary" onClick={() => setFormulaire(vide())}>Ajouter un recueil</Button>
            </div>
          )}
        </div>
        {sa.restreint ? <VueRegroupee sa={sa} /> : <VueAdmin sa={sa} saisie={saisie} onModifier={setFormulaire} onAjouter={() => setFormulaire(vide())} />}
      </section>

      {saisie && (
        <DrawerSatisfaction valeurInitiale={formulaire} sessionId={session.id} stagiaires={stagiaires} admin={admin}
          onFermer={() => setFormulaire(null)}
          onFait={async (m) => { setFormulaire(null); notifier({ ton: "success", titre: m }); await recharger(); }} />
      )}
      {saisie && admin && (
        <DrawerImportSatisfaction ouvert={importOuvert} sessionId={session.id} onFermer={() => setImportOuvert(false)}
          onFait={async (b) => {
            setImportOuvert(false);
            notifier({ ton: "success", titre: `${b.importees} réponse(s) importée(s) : ${b.anonymes} anonyme(s), ${b.nominatives} nominative(s).` });
            await recharger();
          }} />
      )}
    </div>
  );
}

// Contributeur : restitution regroupée par public, sans aucune réponse individuelle.
function VueRegroupee({ sa }) {
  const a = sa.agregation;
  return (
    <>
      <p className="sess-secondaire">
        Résultats regroupés par public. Les réponses individuelles et les commentaires sont réservés à l'administrateur ;
        un groupe de moins de {sa.seuil} réponses n'est pas restitué (cette précaution ne garantit pas à elle seule l'anonymat).
      </p>
      {a.reponses === 0 ? (
        <EmptyState titre="Aucune réponse recueillie">Les résultats regroupés apparaîtront ici.</EmptyState>
      ) : a.insuffisant ? (
        <Alert ton="info">{MSG_INSUFFISANT}.</Alert>
      ) : (
        <>
          <dl className="sess-chiffres">
            <div><dt>Réponses</dt><dd>{a.reponses}</dd></div>
            <div><dt>Moyenne</dt><dd>{moyenneTexte(a.moyenne, a.echelleHomogene)}</dd></div>
          </dl>
          <table className="sess-table">
            <caption className="visually-hidden">Résultats regroupés par public</caption>
            <thead><tr><th scope="col">Public</th><th scope="col" className="sess-num">Réponses</th><th scope="col">Moyenne</th></tr></thead>
            <tbody>
              {sa.groupes.map((g) => (
                <tr key={g.type}>
                  <td data-label="Public" className="sess-table__principal">{TYPES_SATISFACTION[g.type] || g.type}</td>
                  {g.insuffisant
                    ? <td data-label="Résultat" colSpan={2} className="sess-secondaire">{MSG_INSUFFISANT}</td>
                    : <><td data-label="Réponses" className="sess-num">{g.reponses}</td><td data-label="Moyenne">{moyenneTexte(g.moyenne, g.echelle)}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

// Admin : réponses individuelles (répondant, commentaires, fichier source).
function VueAdmin({ sa, saisie, onModifier, onAjouter }) {
  return (
    <>
      <Alert ton="info" titre="Confidentialité">{AIDE_ANONYMAT} Le contributeur ne voit que des résultats regroupés.</Alert>
      {sa.agregation.reponses > 0 && (
        <dl className="sess-chiffres">
          <div><dt>Réponses</dt><dd>{sa.agregation.reponses}</dd></div>
          <div><dt>Anonymes / nominatives</dt><dd>{sa.agregation.anonymes} / {sa.agregation.nominatives}</dd></div>
          <div><dt>Moyenne</dt><dd>{moyenneTexte(sa.agregation.moyenne, sa.agregation.echelleHomogene)}</dd></div>
        </dl>
      )}
      {sa.satisfactions.length === 0 ? (
        <EmptyState titre="Aucune réponse recueillie" action={saisie && <Button variante="primary" onClick={onAjouter}>Ajouter un recueil</Button>}>
          Importez les réponses d'un formulaire Google Forms ou saisissez les questionnaires à chaud, à froid, financeur, entreprise, formateur, prescripteur ou partenaire.
        </EmptyState>
      ) : (
        <table className="sess-table">
          <caption className="visually-hidden">Réponses de satisfaction</caption>
          <thead>
            <tr>
              <th scope="col">Répondant</th><th scope="col">Public</th><th scope="col">Date</th>
              <th scope="col" className="sess-num">Note</th><th scope="col">Commentaire</th><th scope="col"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {sa.satisfactions.map((f) => (
              <tr key={f.id}>
                <td data-label="Répondant" className="sess-table__principal">{f.nom ? `${f.nom} ${f.prenom}` : "Anonyme"}</td>
                <td data-label="Public"><Badge ton="neutral">{TYPES_SATISFACTION[f.type] || f.type}</Badge></td>
                <td data-label="Date">{formaterDate(f.date_recueil)}</td>
                <td data-label="Note" className="sess-num">{f.note_globale !== null && f.note_globale !== undefined ? `${Number(f.note_globale)} / ${Number(f.note_max)}` : "—"}</td>
                <td data-label="Commentaire" className="sess-table__texte">{f.commentaires || "—"}</td>
                <td className="sess-table__actions">
                  {f.drive_file_id && <a className="ui-btn ui-btn--ghost ui-btn--compact" href={lienDrive(f.drive_file_id)} target="_blank" rel="noreferrer">Pièce<span className="visually-hidden"> (nouvel onglet)</span></a>}
                  {saisie && (
                    <Button compact onClick={() => onModifier({
                      id: f.id, type: f.type, inscription_id: f.inscription_id ? String(f.inscription_id) : "",
                      date_recueil: String(f.date_recueil || "").slice(0, 10), note_globale: f.note_globale ?? "",
                      note_max: String(Number(f.note_max)), commentaires: f.commentaires || "", fichier: null,
                    })}>Modifier</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function DrawerSatisfaction({ valeurInitiale, sessionId, stagiaires, admin, onFermer, onFait }) {
  const [v, setV] = useState(null);
  const [erreurs, setErreurs] = useState({});
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => { setV(valeurInitiale); setErreurs({}); setErreur(null); }, [valeurInitiale]);

  async function valider(e) {
    e.preventDefault();
    if (!v.date_recueil) { setErreurs({ date_recueil: "Indiquez la date." }); return; }
    const max = Number(v.note_max || NOTE_MAX);
    if (v.note_globale !== "" && (Number(v.note_globale) < 0 || Number(v.note_globale) > max)) { setErreurs({ note_globale: `Note entre 0 et ${max}.` }); return; }
    setErreurs({}); setEnCours(true); setErreur(null);
    try {
      const corps = {
        type: v.type, date_recueil: v.date_recueil, commentaires: v.commentaires,
        inscription_id: v.inscription_id === "" ? null : Number(v.inscription_id),
        note_globale: v.note_globale === "" ? null : Number(v.note_globale),
        note_max: Number(v.note_max || NOTE_MAX),
        ...(v.fichier ? { drive_file_id: v.fichier.id } : {}),
      };
      if (v.id) await api(`/api/satisfactions/${v.id}`, { method: "PATCH", body: JSON.stringify(corps) });
      else await api(`/api/sessions/${sessionId}/satisfactions`, { method: "POST", body: JSON.stringify(corps) });
      await onFait(v.id ? "Réponse modifiée." : "Réponse enregistrée.");
    } catch (err) { setErreur(err.message); } finally { setEnCours(false); }
  }

  const ouvert = !!v;
  const c = (cle) => (e) => setV({ ...v, [cle]: e.target.value });
  return (
    <Drawer ouvert={ouvert} onFermer={onFermer} fermable={!enCours}
      titre={v?.id ? "Modifier la réponse" : "Ajouter un recueil"}
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
        <Button variante="primary" type="submit" form="form-satisfaction" disabled={enCours}>{enCours ? "Enregistrement…" : "Enregistrer la réponse"}</Button></>}>
      {ouvert && (
        <form id="form-satisfaction" onSubmit={valider} noValidate className="ui-form">
          {erreur && <Alert ton="error" titre="La réponse n'a pas été enregistrée.">{erreur}</Alert>}
          <FormSection titre="Recueil">
            <Field label="Public interrogé">
              <select value={v.type} onChange={c("type")}>
                {Object.entries(TYPES_SATISFACTION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="Répondant" aide="Laisser « Anonyme » pour une réponse non nominative : aucun nom ni e-mail n'est alors conservé.">
              <select value={v.inscription_id} onChange={c("inscription_id")}>
                <option value="">Anonyme</option>
                {stagiaires.map((s) => <option key={s.inscription_id} value={String(s.inscription_id)}>{s.nom} {s.prenom}</option>)}
              </select>
            </Field>
            <Field label="Date du recueil" erreur={erreurs.date_recueil}>
              <input type="date" value={v.date_recueil} onChange={c("date_recueil")} />
            </Field>
          </FormSection>
          <FormSection titre="Note">
            <Field label="Note" facultatif erreur={erreurs.note_globale}>
              <input type="number" min="0" max={Number(v.note_max || NOTE_MAX)} step="0.1" inputMode="decimal" value={v.note_globale} onChange={c("note_globale")} />
            </Field>
            <Field label="Note maximale" aide="Échelle du questionnaire (5 par défaut). Les moyennes ne mélangent jamais des échelles différentes.">
              <input type="number" min="1" step="0.1" inputMode="decimal" value={v.note_max} onChange={c("note_max")} />
            </Field>
          </FormSection>
          <FormSection titre="Commentaires" colonnes={1}>
            <Field label="Commentaires" facultatif aide="Un commentaire libre peut permettre de reconnaître quelqu'un : il reste réservé à l'administrateur."><textarea rows={4} value={v.commentaires} onChange={c("commentaires")} /></Field>
          </FormSection>
          {admin && (
            <FormSection titre="Pièce justificative (Drive)" colonnes={1}>
              {v.fichier
                ? <p>Fichier : <strong>{v.fichier.nom}</strong> <Button compact variante="ghost" onClick={() => setV({ ...v, fichier: null })}>Retirer</Button></p>
                : <RechercheDrive surChoix={(f) => setV({ ...v, fichier: f })} onErreur={setErreur} placeholder="Rechercher la pièce sur le Drive (facultatif)" />}
            </FormSection>
          )}
        </form>
      )}
    </Drawer>
  );
}

const STATUT_IMPORT_SATISFACTION = {
  pret: { libelle: "À importer", ton: "success" },
  invalide: { libelle: "Invalide", ton: "error" },
  a_verifier: { libelle: "À vérifier", ton: "warning" },
  doublon: { libelle: "Déjà importée", ton: "warning" },
};

// Q3-1 — Import des réponses Google Forms (export CSV de la feuille de
// réponses), ADMIN seulement. Questionnaire anonyme par défaut ; nominatif =
// rapprochement par e-mail exact. Échelle du formulaire conservée.
// Aperçu sans écriture, colonnes ajustables, puis confirmation.
function DrawerImportSatisfaction({ ouvert, sessionId, onFermer, onFait }) {
  const [texte, setTexte] = useState(null);
  const [nomFichier, setNomFichier] = useState("");
  const [reglages, setReglages] = useState({ type: "a_chaud", rapprocher_email: false, note_max: "5", colonne_note: undefined, colonne_commentaire: undefined, date_defaut: "" });
  const [apercu, setApercu] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const verrou = useRef(false);
  useEffect(() => {
    if (ouvert) { setTexte(null); setNomFichier(""); setApercu(null); setErreur(null); setReglages({ type: "a_chaud", rapprocher_email: false, note_max: "5", colonne_note: undefined, colonne_commentaire: undefined, date_defaut: "" }); }
  }, [ouvert]);

  const corps = (t, r) => ({ texte: t, type: r.type, rapprocher_email: r.rapprocher_email, note_max: Number(r.note_max || NOTE_MAX),
    ...(r.colonne_note !== undefined ? { colonne_note: r.colonne_note } : {}),
    ...(r.colonne_commentaire !== undefined ? { colonne_commentaire: r.colonne_commentaire } : {}),
    ...(r.date_defaut ? { date_defaut: r.date_defaut } : {}) });

  async function analyser(t = texte, r = reglages) {
    if (!t) return;
    setErreur(null);
    try {
      const a = await api(`/api/sessions/${sessionId}/satisfactions/import-apercu`, { method: "POST", body: JSON.stringify(corps(t, r)) });
      setApercu(a);
      setReglages((x) => ({ ...x, colonne_note: a.colonne_note, colonne_commentaire: a.colonne_commentaire }));
    } catch (err) { setApercu(null); setErreur(err.message); }
  }
  async function lireFichier(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const t = await f.text();
    setTexte(t); setNomFichier(f.name);
    const r = { ...reglages, colonne_note: undefined, colonne_commentaire: undefined };
    setReglages(r);
    await analyser(t, r);
    e.target.value = "";
  }
  const regler = (cle, conv = (x) => x) => (e) => {
    const val = conv(e.target.type === "checkbox" ? e.target.checked : e.target.value);
    const r = { ...reglages, [cle]: val };
    setReglages(r);
    analyser(texte, r);
  };
  const colonne = (x) => (x === "" ? null : Number(x));

  async function confirmer() {
    if (verrou.current || !apercu) return; // fix : jamais de double import
    verrou.current = true;
    setEnCours(true); setErreur(null);
    try {
      const r = await api(`/api/sessions/${sessionId}/satisfactions/import`, { method: "POST", body: JSON.stringify(corps(texte, reglages)) });
      await onFait(r.bilan);
    } catch (err) { setErreur(err.message); } finally { verrou.current = false; setEnCours(false); }
  }

  const n = apercu?.resume?.importables ?? 0;
  const questions = apercu ? apercu.enTetes.map((t, i) => ({ t, i })).filter(({ t, i }) => t && !apercu.colonnesEcartees.includes(t) && i !== apercu.colonne_horodateur) : [];
  return (
    <Drawer ouvert={ouvert} onFermer={onFermer} fermable={!enCours} taille="large" titre="Importer des réponses (CSV Google Forms)"
      description="Dans Google Forms : Réponses › Afficher dans Sheets, puis Fichier › Télécharger › CSV. Rien n'est enregistré avant la confirmation."
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
        <Button variante="primary" onClick={confirmer} disabled={enCours || !apercu || n === 0}>
          {enCours ? "Import en cours…" : `Importer${apercu ? ` ${n} réponse(s)` : ""}`}
        </Button></>}>
      <div className="ui-form">
        {erreur && <Alert ton="error" titre="Import impossible.">{erreur}</Alert>}
        <FormSection titre="Formulaire" colonnes={2}>
          <Field label="Public interrogé">
            <select value={reglages.type} onChange={regler("type")}>
              {Object.entries(TYPES_SATISFACTION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Fichier CSV des réponses" aide={nomFichier || "Export CSV de la feuille de réponses."}>
            <input type="file" accept=".csv,text/csv" onChange={lireFichier} />
          </Field>
          <Field label="Échelle de la note" aide="Note maximale du formulaire (5 par défaut). Elle est conservée telle quelle.">
            <input type="number" min="1" max="100" step="1" inputMode="numeric" value={reglages.note_max} onChange={regler("note_max")} />
          </Field>
        </FormSection>
        <fieldset className="ui-form-section">
          <legend>Questionnaire</legend>
          <label className="ui-case">
            <input type="radio" name="mode-questionnaire" checked={!reglages.rapprocher_email} onChange={() => regler("rapprocher_email")({ target: { value: false } })} />
            <span>Anonyme (recommandé)
              <span className="ui-field__aide ui-case__aide">Aucune réponse n'est rattachée à un stagiaire ; aucun nom ni e-mail n'est conservé.</span>
            </span>
          </label>
          <label className="ui-case">
            <input type="radio" name="mode-questionnaire" checked={reglages.rapprocher_email} onChange={() => regler("rapprocher_email")({ target: { value: true } })} />
            <span>Nominatif — rapprochement par e-mail
              <span className="ui-field__aide ui-case__aide">Chaque réponse est rattachée au stagiaire inscrit ayant exactement cet e-mail ; sinon elle est refusée. L'adresse e-mail n'est jamais conservée.</span>
            </span>
          </label>
        </fieldset>
        <Alert ton="warning" titre="Commentaires libres">Un commentaire peut permettre de reconnaître son auteur, même dans un questionnaire anonyme. Les réponses individuelles restent réservées à l'administrateur.</Alert>
        {apercu && (
          <>
            <FormSection titre="Questions utilisées" colonnes={2}>
              <Field label={`Note globale (sur ${apercu.note_max})`} facultatif>
                <select value={apercu.colonne_note ?? ""} onChange={regler("colonne_note", colonne)}>
                  <option value="">Aucune</option>
                  {questions.map(({ t, i }) => <option key={i} value={i}>{t}</option>)}
                </select>
              </Field>
              <Field label="Commentaire" facultatif>
                <select value={apercu.colonne_commentaire ?? ""} onChange={regler("colonne_commentaire", colonne)}>
                  <option value="">Aucun</option>
                  {questions.map(({ t, i }) => <option key={i} value={i}>{t}</option>)}
                </select>
              </Field>
              {!apercu.horodateur && (
                <Field label="Date du recueil" aide="Le fichier n'a pas d'horodateur.">
                  <input type="date" value={reglages.date_defaut} onChange={regler("date_defaut")} />
                </Field>
              )}
            </FormSection>
            <Alert ton="info" titre="Aperçu — rien n'a encore été enregistré.">
              Toutes les réponses aux questions sont conservées avec la réponse importée
              {apercu.colonnesEcartees.length ? `, sauf les colonnes d'identité (${apercu.colonnesEcartees.join(", ")})` : ""}.
              {!apercu.horodateur && " Sans horodateur, un nouvel import du même fichier créerait des doublons."}
            </Alert>
            <div className="sess-badges">
              <Badge ton="success">{apercu.resume.importables} à importer</Badge>
              <Badge ton="error">{apercu.resume.invalides} invalide(s)</Badge>
              <Badge ton="warning">{apercu.resume.aVerifier} à vérifier</Badge>
              <Badge ton="warning">{apercu.resume.doublons} déjà importée(s)</Badge>
            </div>
            <ul className="sess-apercu" aria-label="Aperçu des réponses">
              {apercu.lignes.map((l) => {
                const st = STATUT_IMPORT_SATISFACTION[l.statut] || { libelle: l.statut, ton: "neutral" };
                return (
                  <li key={l.index}>
                    <span className="sess-secondaire">Réponse {l.index + 1}</span>
                    <strong>{l.stagiaire ? `${l.stagiaire.nom} ${l.stagiaire.prenom}` : "Anonyme"}</strong>
                    <span className="sess-secondaire">{l.date ? formaterDate(l.date) : "—"} · {l.note !== null ? `${l.note} / ${apercu.note_max}` : "sans note"}</span>
                    {l.commentaire && <span className="sess-table__texte">{l.commentaire.length > 140 ? `${l.commentaire.slice(0, 140)}…` : l.commentaire}</span>}
                    <Badge ton={st.ton}>{st.libelle}</Badge>
                    {l.motif && <span className="sess-secondaire">{l.motif}</span>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </Drawer>
  );
}
