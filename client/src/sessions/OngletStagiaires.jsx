import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Drawer, EmptyState, Field, FormSection } from "../ui/index.js";
import { CIVILITES, formaterDate, libellePrescripteur } from "./format.js";

// Onglet Stagiaires : groupes, inscriptions, ajout, import CSV, dossier,
// abandon. Lecture d'abord : les formulaires s'ouvrent à la demande.
// Les champs sensibles (handicap, besoins d'adaptation) n'apparaissent QUE
// dans le dossier, jamais dans le tableau.
export function OngletStagiaires({ donnees, annexes, admin, peutSaisir, recharger, notifier }) {
  const { session, groupes, stagiaires } = donnees;
  const [filtreGroupe, setFiltreGroupe] = useState("");
  const [drawer, setDrawer] = useState(null); // "groupe" | "ajout" | "import" | { dossier: inscription_id }
  const [abandon, setAbandon] = useState(null);
  const [abandonEnCours, setAbandonEnCours] = useState(false);
  const [erreurAbandon, setErreurAbandon] = useState(null);

  const affiches = filtreGroupe === ""
    ? stagiaires
    : stagiaires.filter((s) => String(s.groupe_id ?? "aucun") === filtreGroupe);
  const nomGroupe = (id) => groupes.find((g) => g.id === id)?.nom;
  const dossierOuvert = drawer?.dossier ? stagiaires.find((s) => s.inscription_id === drawer.dossier) : null;

  async function confirmerAbandon() {
    setAbandonEnCours(true);
    setErreurAbandon(null);
    try {
      await api(`/api/inscriptions/${abandon.inscription_id}`, { method: "PATCH", body: JSON.stringify({ statut: "abandon" }) });
      notifier({ ton: "success", titre: `${abandon.prenom} ${abandon.nom} : abandon enregistré.` });
      setAbandon(null);
      await recharger();
    } catch (e) {
      setErreurAbandon(e.message);
    } finally {
      setAbandonEnCours(false);
    }
  }

  return (
    <div className="sess-sections">
      <section className="sess-section" aria-labelledby="titre-groupes">
        <div className="sess-section__tete">
          <h2 id="titre-groupes" className="sess-section__titre">Groupes</h2>
          {admin && <Button compact onClick={() => setDrawer("groupe")}>Ajouter un groupe</Button>}
        </div>
        {groupes.length === 0
          ? <p className="sess-secondaire">Aucun groupe. Une session sur un seul lieu n'en a pas besoin.</p>
          : (
            <ul className="sess-groupes">
              {groupes.map((g) => (
                <li key={g.id} className="sess-groupe">
                  <strong>{g.nom}</strong>
                  <span className="sess-secondaire">
                    {g.nb_inscrits} inscrit(s){g.lieu && ` · ${g.lieu}`}{g.formateur && ` · ${g.formateur}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className="sess-section" aria-labelledby="titre-stagiaires">
        <div className="sess-section__tete">
          <h2 id="titre-stagiaires" className="sess-section__titre">Stagiaires</h2>
          {peutSaisir && (
            <div className="sess-actions">
              <Button compact onClick={() => setDrawer("import")}>Importer un CSV</Button>
              <Button compact variante="primary" onClick={() => setDrawer("ajout")}>Ajouter un stagiaire</Button>
            </div>
          )}
        </div>

        {stagiaires.length === 0 ? (
          <EmptyState
            titre="Aucun stagiaire inscrit"
            action={peutSaisir && <Button variante="primary" onClick={() => setDrawer("ajout")}>Ajouter un stagiaire</Button>}
          >
            {peutSaisir ? "Ajoutez les stagiaires un par un, ou importez un fichier CSV." : "Aucune inscription pour cette session."}
          </EmptyState>
        ) : (
          <>
            {groupes.length > 0 && (
              <div className="sess-barre">
                <Field label="Groupe" className="sess-barre__champ">
                  <select value={filtreGroupe} onChange={(e) => setFiltreGroupe(e.target.value)}>
                    <option value="">Tous les groupes</option>
                    {groupes.map((g) => <option key={g.id} value={String(g.id)}>{g.nom}</option>)}
                    <option value="aucun">Sans groupe</option>
                  </select>
                </Field>
              </div>
            )}
            <table className="sess-table">
              <caption className="visually-hidden">Stagiaires inscrits ({affiches.length})</caption>
              <thead>
                <tr>
                  <th scope="col">Stagiaire</th>
                  <th scope="col">Courriel</th>
                  <th scope="col">Groupe</th>
                  <th scope="col">Prescripteur</th>
                  <th scope="col">Dossier</th>
                  <th scope="col">Inscription</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {affiches.map((st) => {
                  const abandonne = st.statut === "abandon";
                  return (
                    <tr key={st.inscription_id} className={abandonne ? "sess-table__ligne--estompee" : ""}>
                      <td data-label="Stagiaire" className="sess-table__principal">
                        {st.civilite ? `${st.civilite} ` : ""}{st.nom} {st.prenom}
                      </td>
                      <td data-label="Courriel">{st.email || "—"}</td>
                      <td data-label="Groupe">{nomGroupe(st.groupe_id) || "Sans groupe"}</td>
                      <td data-label="Prescripteur">{libellePrescripteur(st.prescripteur, annexes.prescripteurs) || "—"}</td>
                      <td data-label="Dossier">
                        <Badge ton={st.dossier_complet ? "success" : "warning"}>{st.dossier_complet ? "Complet" : "Incomplet"}</Badge>
                      </td>
                      <td data-label="Inscription">
                        {abandonne
                          ? <Badge ton="error">Abandon{st.date_abandon ? ` le ${formaterDate(st.date_abandon)}` : ""}</Badge>
                          : <Badge ton="neutral">Inscrit</Badge>}
                      </td>
                      <td className="sess-table__actions">
                        <Button compact onClick={() => setDrawer({ dossier: st.inscription_id })} aria-label={`Dossier de ${st.prenom} ${st.nom}`}>
                          Dossier
                        </Button>
                        {peutSaisir && !abandonne && (
                          <Button compact variante="ghost" onClick={() => { setErreurAbandon(null); setAbandon(st); }} aria-label={`Déclarer l'abandon de ${st.prenom} ${st.nom}`}>
                            Abandon…
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>

      {admin && (
        <DrawerGroupe ouvert={drawer === "groupe"} sessionId={session.id} onFermer={() => setDrawer(null)}
          onFait={async (nom) => { setDrawer(null); notifier({ ton: "success", titre: `Groupe « ${nom} » ajouté.` }); await recharger(); }} />
      )}
      {peutSaisir && (
        <>
          <DrawerAjout ouvert={drawer === "ajout"} sessionId={session.id} groupes={groupes} prescripteurs={annexes.prescripteurs}
            onFermer={() => setDrawer(null)}
            onFait={async (nom) => { setDrawer(null); notifier({ ton: "success", titre: `${nom} inscrit(e) à la session.` }); await recharger(); }} />
          <DrawerImport ouvert={drawer === "import"} sessionId={session.id} onFermer={() => setDrawer(null)}
            onFait={async (b) => {
              setDrawer(null);
              notifier({
                ton: "success", titre: "Import terminé.",
                texte: `${b.crees} créé(s), ${b.reutilises} réutilisé(s), ${b.inscrits} inscrit(s), ${b.dejaInscrits} déjà inscrit(s), ${b.ignores.length} ignoré(s).`,
              });
              await recharger();
            }} />
        </>
      )}
      <DrawerDossier
        st={dossierOuvert} groupes={groupes} prescripteurs={annexes.prescripteurs} peutSaisir={peutSaisir}
        onFermer={() => setDrawer(null)}
        onFait={async () => { setDrawer(null); notifier({ ton: "success", titre: "Dossier enregistré." }); await recharger(); }}
      />

      <ConfirmDialog
        ouvert={!!abandon} titre="Déclarer un abandon ?" libelleConfirmer="Déclarer l'abandon"
        enCours={abandonEnCours} onAnnuler={() => setAbandon(null)} onConfirmer={confirmerAbandon}
      >
        {abandon && (
          <>
            <p><strong>{abandon.prenom} {abandon.nom}</strong> passera en abandon à la date du jour. Il ne comptera plus dans les inscrits actifs ni dans le décompte des preuves par stagiaire.</p>
            {erreurAbandon && <Alert ton="error">{erreurAbandon}</Alert>}
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}

// ── Ajouter un groupe (admin) ────────────────────────────────
function DrawerGroupe({ ouvert, sessionId, onFermer, onFait }) {
  const [v, setV] = useState({ nom: "", lieu: "", formateur: "" });
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => { if (ouvert) { setV({ nom: "", lieu: "", formateur: "" }); setErreur(null); } }, [ouvert]);

  async function valider(e) {
    e.preventDefault();
    if (!v.nom.trim()) return setErreur("Indiquez un nom de groupe.");
    setEnCours(true); setErreur(null);
    try {
      await api(`/api/sessions/${sessionId}/groupes`, { method: "POST", body: JSON.stringify(v) });
      await onFait(v.nom.trim());
    } catch (err) { setErreur(err.message); } finally { setEnCours(false); }
  }

  return (
    <Drawer ouvert={ouvert} onFermer={onFermer} fermable={!enCours} titre="Ajouter un groupe" taille="etroit"
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
        <Button variante="primary" type="submit" form="form-groupe" disabled={enCours}>{enCours ? "Ajout…" : "Ajouter le groupe"}</Button></>}>
      <form id="form-groupe" onSubmit={valider} noValidate className="ui-form">
        {erreur && <Alert ton="error">{erreur}</Alert>}
        <Field label="Nom du groupe"><input value={v.nom} onChange={(e) => setV({ ...v, nom: e.target.value })} required /></Field>
        <Field label="Lieu" facultatif><input value={v.lieu} onChange={(e) => setV({ ...v, lieu: e.target.value })} /></Field>
        <Field label="Formateur" facultatif><input value={v.formateur} onChange={(e) => setV({ ...v, formateur: e.target.value })} /></Field>
      </form>
    </Drawer>
  );
}

// ── Ajouter un stagiaire ─────────────────────────────────────
function DrawerAjout({ ouvert, sessionId, groupes, prescripteurs, onFermer, onFait }) {
  const actifs = (prescripteurs || []).filter((p) => p.actif);
  // Même valeur par défaut qu'avant UX-2 (Pôle emploi) si elle est proposée.
  const defaut = actifs.some((p) => p.code === "pole_emploi") ? "pole_emploi" : "";
  const vide = { civilite: "", nom: "", prenom: "", email: "", groupe_id: "", prescripteur: defaut, dossier_complet: false };
  const [v, setV] = useState(vide);
  const [erreurs, setErreurs] = useState({});
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => { if (ouvert) { setV(vide); setErreurs({}); setErreur(null); } }, [ouvert]); // eslint-disable-line react-hooks/exhaustive-deps

  async function valider(e) {
    e.preventDefault();
    const trouvees = {};
    if (!v.nom.trim()) trouvees.nom = "Le nom est obligatoire.";
    if (!v.prenom.trim()) trouvees.prenom = "Le prénom est obligatoire.";
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    setEnCours(true); setErreur(null);
    try {
      await api(`/api/sessions/${sessionId}/stagiaires`, {
        method: "POST",
        body: JSON.stringify({ ...v, civilite: v.civilite || null, groupe_id: v.groupe_id || null }),
      });
      await onFait(`${v.prenom.trim()} ${v.nom.trim()}`);
    } catch (err) { setErreur(err.message); } finally { setEnCours(false); }
  }

  return (
    <Drawer ouvert={ouvert} onFermer={onFermer} fermable={!enCours} titre="Ajouter un stagiaire"
      description="La fiche complète (contact, financement, adaptation) se complète ensuite dans son dossier."
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
        <Button variante="primary" type="submit" form="form-ajout-stagiaire" disabled={enCours}>{enCours ? "Ajout…" : "Ajouter le stagiaire"}</Button></>}>
      <form id="form-ajout-stagiaire" onSubmit={valider} noValidate className="ui-form">
        {erreur && <Alert ton="error" titre="Le stagiaire n'a pas été ajouté.">{erreur}</Alert>}
        <FormSection titre="Identité">
          <Field label="Civilité" facultatif>
            <select value={v.civilite} onChange={(e) => setV({ ...v, civilite: e.target.value })}>
              <option value="">Non renseignée</option>
              {CIVILITES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Courriel" facultatif><input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
          <Field label="Nom" erreur={erreurs.nom}><input value={v.nom} onChange={(e) => setV({ ...v, nom: e.target.value })} required /></Field>
          <Field label="Prénom" erreur={erreurs.prenom}><input value={v.prenom} onChange={(e) => setV({ ...v, prenom: e.target.value })} required /></Field>
        </FormSection>
        <FormSection titre="Inscription">
          <Field label="Groupe" facultatif>
            <select value={v.groupe_id} onChange={(e) => setV({ ...v, groupe_id: e.target.value })}>
              <option value="">Sans groupe</option>
              {groupes.map((g) => <option key={g.id} value={g.id}>{g.nom}</option>)}
            </select>
          </Field>
          <Field label="Prescripteur" facultatif>
            <select value={v.prescripteur} onChange={(e) => setV({ ...v, prescripteur: e.target.value })}>
              <option value="">Aucun</option>
              {actifs.map((p) => <option key={p.id} value={p.code}>{p.nom}</option>)}
            </select>
          </Field>
          <Checkbox label="Dossier complet" checked={v.dossier_complet} onChange={(e) => setV({ ...v, dossier_complet: e.target.checked })} />
        </FormSection>
      </form>
    </Drawer>
  );
}

// ── Import CSV : APERÇU (aucune écriture) puis CONFIRMATION ────
// Le texte lu est conservé tel quel et renvoyé à la confirmation : ce qui
// est affiché est exactement ce qui sera importé.
const STATUT_LIGNE = {
  pret: { libelle: "Prêt à importer", ton: "success" },
  existant: { libelle: "Existant identifié", ton: "success" },
  deja_inscrit: { libelle: "Déjà inscrit", ton: "neutral" },
  doublon_possible: { libelle: "Doublon possible", ton: "warning" },
  a_verifier: { libelle: "À vérifier", ton: "warning" },
  invalide: { libelle: "Invalide", ton: "error" },
  vide: { libelle: "Ligne vide", ton: "neutral" },
};

function DrawerImport({ ouvert, sessionId, onFermer, onFait }) {
  const [apercu, setApercu] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const texteRef = useRef(null);
  useEffect(() => { if (ouvert) { setApercu(null); setErreur(null); texteRef.current = null; } }, [ouvert]);

  async function lireFichier(e) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    const texte = await fichier.text();
    texteRef.current = texte;
    setErreur(null);
    try {
      setApercu(await api(`/api/sessions/${sessionId}/stagiaires/import-apercu`, { method: "POST", body: JSON.stringify({ texte }) }));
    } catch (err) { setApercu(null); setErreur(err.message); }
    e.target.value = "";
  }

  async function confirmer() {
    if (!texteRef.current) return setErreur("Choisissez d'abord un fichier.");
    setEnCours(true); setErreur(null);
    try {
      const r = await api(`/api/sessions/${sessionId}/stagiaires/import`, { method: "POST", body: JSON.stringify({ texte: texteRef.current }) });
      await onFait(r.bilan);
    } catch (err) { setErreur(err.message); } finally { setEnCours(false); }
  }

  const r = apercu?.resume;
  const importables = r ? r.nouveaux + r.existants : 0;
  return (
    <Drawer ouvert={ouvert} onFermer={onFermer} fermable={!enCours} taille="large" titre="Importer des stagiaires (CSV)"
      description="Étape 1 : choisir le fichier et vérifier l'aperçu (rien n'est enregistré). Étape 2 : confirmer."
      pied={<><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
        <Button variante="primary" onClick={confirmer} disabled={enCours || !apercu || importables === 0}>
          {enCours ? "Import en cours…" : `Confirmer l'import${apercu ? ` (${importables} stagiaire(s))` : ""}`}
        </Button></>}>
      <div className="ui-form">
        {erreur && <Alert ton="error" titre="Import impossible.">{erreur}</Alert>}
        <Field label="Fichier CSV" aide="Virgule ou point-virgule, exportable depuis Excel, LibreOffice ou Google Sheets. Colonnes reconnues : civilité, nom, prénom, email, téléphone, entreprise, financeur, situation de handicap, besoins d'adaptation, groupe, prescripteur, dossier complet.">
          <input type="file" accept=".csv,text/csv" onChange={lireFichier} />
        </Field>
        {apercu && (
          <>
            <Alert ton="info" titre="Aperçu — rien n'a encore été enregistré." />
            {apercu.colonnesInconnues?.length > 0 && (
              <Alert ton="warning" titre="Colonnes non reconnues (ignorées)">{apercu.colonnesInconnues.join(", ")}</Alert>
            )}
            <div className="sess-badges">
              <Badge ton="success">{r.nouveaux} nouveau(x)</Badge>
              <Badge ton="success">{r.existants} existant(s)</Badge>
              <Badge ton="error">{r.invalides} invalide(s)</Badge>
              <Badge ton="warning">{r.doublons} doublon(s) possible(s)</Badge>
              <Badge ton="neutral">{r.dejaInscrits} déjà inscrit(s)</Badge>
              <Badge ton="neutral">{r.vides} ligne(s) vide(s)</Badge>
            </div>
            <ul className="sess-apercu">
              {apercu.lignes.map((l) => {
                const s = STATUT_LIGNE[l.statut] || { libelle: l.statut, ton: "neutral" };
                return (
                  <li key={l.index}>
                    <span className="sess-secondaire">Ligne {l.index + 1}</span>
                    <strong>{l.nom} {l.prenom}</strong>
                    {l.email && <span className="sess-secondaire">{l.email}</span>}
                    <Badge ton={s.ton}>{s.libelle}</Badge>
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

// ── Dossier d'un stagiaire (drawer large) ────────────────────
// La fiche (personne) et l'inscription (session) restent deux appels
// distincts, comme avant : seul ce qui a changé est envoyé.
function DrawerDossier({ st, groupes, prescripteurs, peutSaisir, onFermer, onFait }) {
  const ficheDe = (x) => ({
    civilite: x.civilite || "", nom: x.nom || "", prenom: x.prenom || "", email: x.email || "",
    telephone: x.telephone || "", entreprise: x.entreprise || "", financeur: x.financeur || "",
    situation_handicap: x.situation_handicap === true, besoins_adaptation: x.besoins_adaptation || "",
  });
  const inscDe = (x) => ({ groupe_id: x.groupe_id ? String(x.groupe_id) : "", prescripteur: x.prescripteur || "", dossier_complet: x.dossier_complet === true });
  const [fiche, setFiche] = useState(null);
  const [insc, setInsc] = useState(null);
  const [erreurs, setErreurs] = useState({});
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const cle = st?.inscription_id;
  useEffect(() => { if (st) { setFiche(ficheDe(st)); setInsc(inscDe(st)); setErreurs({}); setErreur(null); } }, [cle]); // eslint-disable-line react-hooks/exhaustive-deps

  async function enregistrer(e) {
    e.preventDefault();
    const trouvees = {};
    if (!fiche.nom.trim()) trouvees.nom = "Le nom est obligatoire.";
    if (!fiche.prenom.trim()) trouvees.prenom = "Le prénom est obligatoire.";
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;
    setEnCours(true); setErreur(null);
    try {
      if (JSON.stringify(fiche) !== JSON.stringify(ficheDe(st))) {
        await api(`/api/stagiaires/${st.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...fiche, civilite: fiche.civilite || null, besoins_adaptation: fiche.besoins_adaptation || null }),
        });
      }
      if (JSON.stringify(insc) !== JSON.stringify(inscDe(st))) {
        await api(`/api/inscriptions/${st.inscription_id}`, {
          method: "PATCH",
          body: JSON.stringify({ groupe_id: insc.groupe_id ? Number(insc.groupe_id) : null, prescripteur: insc.prescripteur || null, dossier_complet: insc.dossier_complet }),
        });
      }
      await onFait();
    } catch (err) { setErreur(err.message); } finally { setEnCours(false); }
  }

  const ouvert = !!st && !!fiche;
  const lecture = !peutSaisir;
  const f = (cle2) => (ev) => setFiche({ ...fiche, [cle2]: ev.target.value });
  return (
    <Drawer ouvert={ouvert} onFermer={onFermer} fermable={!enCours} taille="large"
      titre={st ? `Dossier de ${st.prenom} ${st.nom}` : "Dossier"}
      description={st?.statut === "abandon" ? `Abandon${st.date_abandon ? ` le ${formaterDate(st.date_abandon)}` : ""}.` : undefined}
      pied={peutSaisir
        ? <><Button onClick={onFermer} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-dossier" disabled={enCours}>{enCours ? "Enregistrement…" : "Enregistrer le dossier"}</Button></>
        : <Button onClick={onFermer}>Fermer</Button>}>
      {ouvert && (
        <form id="form-dossier" onSubmit={enregistrer} noValidate className="ui-form">
          {erreur && <Alert ton="error" titre="Le dossier n'a pas été entièrement enregistré.">{erreur}</Alert>}
          <fieldset disabled={lecture || enCours} className="ui-form-lecture">
            <FormSection titre="Identité">
              <Field label="Civilité" facultatif>
                <select value={fiche.civilite} onChange={f("civilite")}>
                  <option value="">Non renseignée</option>
                  {CIVILITES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <div />
              <Field label="Nom" erreur={erreurs.nom}><input value={fiche.nom} onChange={f("nom")} /></Field>
              <Field label="Prénom" erreur={erreurs.prenom}><input value={fiche.prenom} onChange={f("prenom")} /></Field>
            </FormSection>
            <FormSection titre="Contact">
              <Field label="Courriel" facultatif><input type="email" value={fiche.email} onChange={f("email")} /></Field>
              <Field label="Téléphone" facultatif><input type="tel" value={fiche.telephone} onChange={f("telephone")} /></Field>
            </FormSection>
            <FormSection titre="Entreprise et financement">
              <Field label="Entreprise" facultatif><input value={fiche.entreprise} onChange={f("entreprise")} /></Field>
              <Field label="Financeur" facultatif><input value={fiche.financeur} onChange={f("financeur")} /></Field>
            </FormSection>
            <FormSection titre="Inscription à la session">
              <Field label="Groupe" facultatif>
                <select value={insc.groupe_id} onChange={(ev) => setInsc({ ...insc, groupe_id: ev.target.value })}>
                  <option value="">Sans groupe</option>
                  {groupes.map((g) => <option key={g.id} value={String(g.id)}>{g.nom}</option>)}
                </select>
              </Field>
              <Field label="Prescripteur" facultatif>
                <select value={insc.prescripteur} onChange={(ev) => setInsc({ ...insc, prescripteur: ev.target.value })}>
                  <option value="">Aucun</option>
                  {(prescripteurs || []).filter((p) => p.actif || p.code === insc.prescripteur).map((p) => <option key={p.id} value={p.code}>{p.nom}</option>)}
                </select>
              </Field>
              <Checkbox label="Dossier complet" checked={insc.dossier_complet} onChange={(ev) => setInsc({ ...insc, dossier_complet: ev.target.checked })} />
            </FormSection>
            <FormSection titre="Accessibilité (confidentiel)" colonnes={1}>
              <p className="sess-secondaire">Informations visibles uniquement dans ce dossier.</p>
              <Checkbox label="Situation de handicap" checked={fiche.situation_handicap} onChange={(ev) => setFiche({ ...fiche, situation_handicap: ev.target.checked })} />
              <Field label="Besoins d'adaptation" facultatif>
                <textarea rows={3} value={fiche.besoins_adaptation} onChange={f("besoins_adaptation")} />
              </Field>
            </FormSection>
          </fieldset>
        </form>
      )}
    </Drawer>
  );
}
