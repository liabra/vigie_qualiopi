import { useEffect, useState } from "react";
import { api } from "../api.js";
import { RechercheDrive } from "../RechercheDrive.jsx";
import { Alert, Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, FormSection } from "../ui/index.js";
import { PORTEES, TYPES_EDUSIGN, formaterDateHeure } from "./format.js";

// Onglet Documents : d'un côté les DOCUMENTS GÉNÉRÉS PAR VIGIE (modèles
// Google, dont les feuilles d'assiduité), de l'autre les DOCUMENTS EXTERNES
// (EduSign, Drive), rattachés sans être copiés.
export function OngletDocuments({ donnees, annexes, admin, peutSaisir, recharger, notifier }) {
  const { session, groupes, documents, externes } = donnees;
  const [generation, setGeneration] = useState(false);
  const [rattachement, setRattachement] = useState(false);
  const nomGroupe = (id) => groupes.find((g) => g.id === id)?.nom;

  return (
    <div className="sess-sections">
      <section className="sess-section" aria-labelledby="titre-generes">
        <div className="sess-section__tete">
          <div>
            <h2 id="titre-generes" className="sess-section__titre">Documents générés par Vigie</h2>
            <p className="sess-secondaire">Copies des modèles Google Docs / Sheets, marqueurs remplacés. Le modèle d'origine n'est jamais modifié.</p>
          </div>
          {peutSaisir && <Button compact variante="primary" onClick={() => setGeneration(true)}>Générer un document</Button>}
        </div>
        {documents.length === 0 ? (
          <EmptyState titre="Aucun document généré pour cette session"
            action={peutSaisir && <Button variante="primary" onClick={() => setGeneration(true)}>Générer un document</Button>}>
            Convocations, attestations, feuilles d'assiduité… à partir des modèles déclarés.
          </EmptyState>
        ) : (
          <table className="sess-table">
            <caption className="visually-hidden">Documents générés par Vigie</caption>
            <thead><tr><th scope="col">Document</th><th scope="col">Modèle</th><th scope="col">Groupe</th><th scope="col">Généré le</th></tr></thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td data-label="Document" className="sess-table__principal">
                    <a href={doc.drive_url} target="_blank" rel="noreferrer">{doc.nom}<span className="visually-hidden"> (ouvre le Drive dans un nouvel onglet)</span></a>
                  </td>
                  <td data-label="Modèle">{doc.modele}<span className="sess-secondaire">{PORTEES[doc.portee] || doc.portee}</span></td>
                  <td data-label="Groupe">{nomGroupe(doc.groupe_id) || "—"}</td>
                  <td data-label="Généré le">{formaterDateHeure(doc.genere_le)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="sess-section" aria-labelledby="titre-externes">
        <div className="sess-section__tete">
          <div>
            <h2 id="titre-externes" className="sess-section__titre">Documents externes / EduSign</h2>
            <p className="sess-secondaire">Fichiers déjà présents sur le Drive (exports EduSign…), rattachés à un indicateur. Rien n'est copié.</p>
          </div>
          {admin && <Button compact onClick={() => setRattachement(true)}>Rattacher un document</Button>}
        </div>
        {externes.length === 0 ? (
          <p className="sess-secondaire">Aucun document externe rattaché.</p>
        ) : (
          <table className="sess-table">
            <caption className="visually-hidden">Documents externes rattachés</caption>
            <thead><tr><th scope="col">Document</th><th scope="col">Indicateur</th><th scope="col">Fichiers</th></tr></thead>
            <tbody>
              {externes.map((p) => (
                <tr key={p.id}>
                  <td data-label="Document" className="sess-table__principal">{p.titre} <Badge ton="neutral">Externe</Badge></td>
                  <td data-label="Indicateur">Indicateur {p.indicateur}</td>
                  <td data-label="Fichiers">
                    {p.fichiers.length === 0 ? <span className="sess-secondaire">Aucun fichier rattaché</span> : (
                      <ul className="sess-liens">
                        {p.fichiers.map((f) => (
                          <li key={f.id}><a href={f.url} target="_blank" rel="noreferrer">{f.nom || f.drive_file_id}<span className="visually-hidden"> (nouvel onglet)</span></a></li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {peutSaisir && (
        <DrawerGeneration ouvert={generation} session={session} groupes={groupes} modeles={annexes.modeles}
          onFermer={() => setGeneration(false)} onGenere={recharger} />
      )}
      {admin && (
        <DrawerRattachement ouvert={rattachement} sessionId={session.id} indicateurs={annexes.indicateurs}
          onFermer={() => setRattachement(false)}
          onFait={async () => { setRattachement(false); notifier({ ton: "success", titre: "Document externe rattaché." }); await recharger(); }} />
      )}
    </div>
  );
}

// Génération : si des documents existent déjà pour ce modèle, le serveur
// répond 409 et on propose EXPLICITEMENT de les remplacer. Le bouton reste
// désactivé pendant l'appel (anti double soumission, en plus de la garde
// serveur). Le résultat détaillé s'affiche dans le panneau.
function DrawerGeneration({ ouvert, session, groupes, modeles, onFermer, onGenere }) {
  const [v, setV] = useState({ modele_id: "", groupe_id: "" });
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [resultat, setResultat] = useState(null);
  const [remplacement, setRemplacement] = useState(null); // message 409
  const utiles = (modeles || []).filter((m) => ["session", "groupe", "stagiaire"].includes(m.portee));
  useEffect(() => { if (ouvert) { setV({ modele_id: "", groupe_id: "" }); setErreur(null); setResultat(null); setRemplacement(null); } }, [ouvert]);

  async function generer(remplacer = false) {
    if (!v.modele_id) return setErreur("Choisissez un modèle.");
    setEnCours(true); setErreur(null); setResultat(null); setRemplacement(null);
    try {
      const r = await api("/api/generations", {
        method: "POST",
        body: JSON.stringify({
          modele_id: Number(v.modele_id), session_id: session.id,
          groupe_id: v.groupe_id ? Number(v.groupe_id) : null, remplacer,
        }),
      });
      setResultat(r);
      await onGenere();
    } catch (e) {
      // 409 « déjà générés » : proposer le remplacement. Une génération déjà
      // en cours (autre 409) reste une simple erreur.
      if (e.status === 409 && /déjà été générés/.test(e.message)) setRemplacement(e.message);
      else setErreur(e.message);
    } finally { setEnCours(false); }
  }

  const inconnus = resultat?.marqueursInconnus || [];
  const nonResolus = resultat?.marqueursNonResolus || [];
  const nonArchives = resultat?.anciensNonArchives || [];
  return (
    <Drawer ouvert={ouvert} onFermer={onFermer} fermable={!enCours} titre="Générer un document"
      description="Une copie du modèle est créée sur le Drive pour la session, le groupe ou chaque stagiaire."
      pied={resultat
        ? <Button variante="primary" onClick={onFermer}>Fermer</Button>
        : <><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
          <Button variante="primary" onClick={() => generer(false)} disabled={enCours}>{enCours ? "Génération…" : "Générer"}</Button></>}>
      <div className="ui-form">
        {erreur && <Alert ton="error" titre="La génération a échoué.">{erreur}</Alert>}
        {enCours && <Alert ton="info" titre="Génération en cours…">Les copies sont créées sur le Drive ; cela peut prendre quelques secondes.</Alert>}
        {!resultat && (
          <FormSection titre="Document à produire" colonnes={1}>
            <Field label="Modèle">
              <select value={v.modele_id} onChange={(e) => setV({ ...v, modele_id: e.target.value })} disabled={enCours}>
                <option value="">Choisir un modèle…</option>
                {utiles.map((m) => <option key={m.id} value={m.id}>{m.nom} — {PORTEES[m.portee] || m.portee}</option>)}
              </select>
            </Field>
            <Field label="Groupe visé" facultatif>
              <select value={v.groupe_id} onChange={(e) => setV({ ...v, groupe_id: e.target.value })} disabled={enCours}>
                <option value="">Toute la session</option>
                {groupes.map((g) => <option key={g.id} value={g.id}>{g.nom}</option>)}
              </select>
            </Field>
            {utiles.length === 0 && <Alert ton="warning" titre="Aucun modèle utilisable">Aucun modèle de portée session, groupe ou stagiaire n'est déclaré.</Alert>}
          </FormSection>
        )}
        {resultat && (
          <>
            <Alert ton="success" titre={`${resultat.documents} document(s) généré(s)${resultat.remplaces ? `, dont ${resultat.remplaces} remplacé(s)` : ""}.`}>
              {resultat.preuves} preuve(s) rattachée(s).
            </Alert>
            {inconnus.length > 0 && (
              <Alert ton="warning" titre="Marqueur(s) non reconnu(s) dans le modèle">
                {inconnus.join(", ")} — ils restent tels quels dans les documents produits.
              </Alert>
            )}
            {nonResolus.length > 0 && (
              <Alert ton="warning" titre="Marqueur(s) resté(s) non remplacé(s)">
                {nonResolus.join(", ")} — vérifiez que le modèle ne les coupe pas sur plusieurs lignes.
              </Alert>
            )}
            {resultat.detectionMarqueurs === false && (
              <Alert ton="info">Les marqueurs inconnus ne sont pas détectés sur ce type de fichier.</Alert>
            )}
            {resultat.marqueursNonRemplaces > 0 && (
              <Alert ton="warning">{resultat.marqueursNonRemplaces} fichier(s) ni Doc ni Sheet : marqueurs non remplacés.</Alert>
            )}
            {nonArchives.length > 0 && (
              <Alert ton="warning" titre="Anciens fichiers non archivés">
                Le nouveau document est enregistré, mais {nonArchives.length} ancien(s) fichier(s) n'ont pas pu être archivé(s) : ils restent sur le Drive.
              </Alert>
            )}
          </>
        )}
      </div>
      <ConfirmDialog
        ouvert={!!remplacement} titre="Remplacer les documents existants ?" libelleConfirmer="Remplacer les documents"
        onAnnuler={() => setRemplacement(null)} onConfirmer={() => generer(true)}
      >
        <p>{remplacement}</p>
        <p>Les anciens fichiers seront archivés sur le Drive (mis à la corbeille), puis remplacés par les nouveaux.</p>
      </ConfirmDialog>
    </Drawer>
  );
}

// Rattacher un document externe (admin) : on ne stocke que l'identifiant du
// fichier Drive, jamais le fichier ; source « manuel » ⇒ jamais « généré ».
function DrawerRattachement({ ouvert, sessionId, indicateurs, onFermer, onFait }) {
  const [v, setV] = useState({ type: "", titre: "", indicateur_id: "", fichier: null });
  const [erreurs, setErreurs] = useState({});
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => { if (ouvert) { setV({ type: "", titre: "", indicateur_id: "", fichier: null }); setErreurs({}); setErreur(null); } }, [ouvert]);

  async function valider(e) {
    e.preventDefault();
    const t = {};
    if (!v.titre.trim()) t.titre = "Indiquez un libellé (type de document).";
    if (!v.indicateur_id) t.indicateur_id = "Choisissez un indicateur.";
    if (!v.fichier) t.fichier = "Sélectionnez un fichier sur le Drive.";
    setErreurs(t);
    if (Object.keys(t).length) return;
    setEnCours(true); setErreur(null);
    try {
      await api("/api/preuves", {
        method: "POST",
        body: JSON.stringify({
          titre: v.titre.trim(), indicateur_id: Number(v.indicateur_id),
          drive_file_id: v.fichier.id, drive_url: v.fichier.url, drive_nom: v.fichier.nom, drive_mime: v.fichier.mime,
          session_id: sessionId, mode_fichiers: "multiple",
        }),
      });
      await onFait();
    } catch (err) { setErreur(err.message); } finally { setEnCours(false); }
  }

  return (
    <Drawer ouvert={ouvert} onFermer={onFermer} fermable={!enCours} titre="Rattacher un document externe"
      description="Export EduSign, feuille de présence… déjà présent sur le Drive."
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
        <Button variante="primary" type="submit" form="form-rattachement" disabled={enCours}>{enCours ? "Rattachement…" : "Rattacher"}</Button></>}>
      <form id="form-rattachement" onSubmit={valider} noValidate className="ui-form">
        {erreur && <Alert ton="error" titre="Le document n'a pas été rattaché.">{erreur}</Alert>}
        <FormSection titre="Document" colonnes={1}>
          <Field label="Type suggéré" facultatif>
            <select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value, titre: e.target.value || v.titre })}>
              <option value="">Libellé libre…</option>
              {TYPES_EDUSIGN.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Libellé" erreur={erreurs.titre}>
            <input value={v.titre} placeholder="Ex. Feuille d'émargement EduSign" onChange={(e) => setV({ ...v, titre: e.target.value })} />
          </Field>
          <Field label="Indicateur" erreur={erreurs.indicateur_id}>
            <select value={v.indicateur_id} onChange={(e) => setV({ ...v, indicateur_id: e.target.value })}>
              <option value="">Choisir…</option>
              {indicateurs.map((i) => <option key={i.id} value={i.id}>{i.numero} — {i.libelle}</option>)}
            </select>
          </Field>
        </FormSection>
        <FormSection titre="Fichier Drive" colonnes={1}>
          {v.fichier
            ? <p>Sélectionné : <strong>{v.fichier.nom}</strong> <Button compact variante="ghost" onClick={() => setV({ ...v, fichier: null })}>Retirer</Button></p>
            : <RechercheDrive surChoix={(f) => setV({ ...v, fichier: f })} onErreur={setErreur} placeholder="Chercher le fichier à rattacher (export EduSign…)" />}
          {erreurs.fichier && <p className="ui-field__erreur" role="alert">{erreurs.fichier}</p>}
        </FormSection>
      </form>
    </Drawer>
  );
}
