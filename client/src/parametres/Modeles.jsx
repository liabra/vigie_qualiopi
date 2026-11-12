import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, FormSection, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { SelecteurIndicateurs } from "../veille/SelecteurIndicateurs.jsx";

// DOC-2 — État du diagnostic : couleur ET libellé (jamais la couleur seule).
const ETATS_DIAGNOSTIC = {
  valide: { ton: "success", libelle: "🟢 Valide" },
  valide_avec_avertissements: { ton: "warning", libelle: "🟠 Avertissements" },
  invalide: { ton: "error", libelle: "🔴 Invalide" },
};

// Détail des balises d'un diagnostic déjà reçu : jamais de contenu du
// document, seulement ce que l'API a renvoyé (balises, codes, messages).
function DiagnosticDetail({ d }) {
  const etat = ETATS_DIAGNOSTIC[d.etat] || { ton: "neutral", libelle: d.etat };
  return (
    <div className="param-diagnostic__corps">
      <Badge ton={etat.ton}>{etat.libelle}</Badge>
      <p className="sess-secondaire">
        {d.nombre_occurrences_balises} occurrence(s) de balise, {d.nombre_balises_uniques} distincte(s) ·
        dictionnaire v{d.version_dictionnaire} · {d.type_fichier === "feuille_calcul" ? "Google Sheets" : "Google Docs"}
        {d.onglets_total != null && <> · {d.onglets_analyses}/{d.onglets_total} onglet(s) analysé(s)</>}
      </p>
      {d.erreurs.length > 0 && (
        <ul className="param-indicateurs">
          {d.erreurs.map((e, i) => <li key={i}><strong>Erreur —</strong> {e.message}</li>)}
        </ul>
      )}
      {d.avertissements.length > 0 && (
        <ul className="param-indicateurs">
          {d.avertissements.map((a, i) => <li key={i}>{a.message}</li>)}
        </ul>
      )}
      {d.suggestions.length > 0 && (
        <>
          <p className="sess-secondaire">Suggestions de migration vers les balises canoniques :</p>
          <ul className="param-marqueurs">
            {d.suggestions.map((s) => (
              <li key={s.balise}>
                <code>{s.balise}</code> → {s.cible_conseillee
                  ? <>cible conseillée <code>{s.cible_conseillee}</code></>
                  : "aucune cible canonique certaine"}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export const PORTEES = {
  formation: { court: "Par formation", long: "Un document par formation" },
  session: { court: "Par session", long: "Un document par session" },
  groupe: { court: "Par groupe", long: "Un document par groupe" },
  stagiaire: { court: "Par stagiaire", long: "Un document par stagiaire" },
};
// Bibliothèque : types de document et modes de génération (valeurs admises par l'API).
export const TYPES_DOCUMENT = {
  attestation: "Attestation",
  convocation: "Convocation",
  emargement: "Émargement",
  fiche_session: "Fiche récapitulative de session",
  convention: "Convention",
  compte_rendu: "Compte rendu",
  evaluation: "Évaluation",
  bilan: "Bilan",
  autre: "Autre",
};
export const MODES_GENERATION = {
  manuel: "Manuelle",
  automatique: "Automatique",
  conditionnel: "Conditionnelle",
};
const TYPES_FICHIER = {
  "application/vnd.google-apps.document": "Google Docs",
  "application/vnd.google-apps.spreadsheet": "Google Sheets",
};
const VIDE = {
  nom: "", lien: "", portee: "stagiaire", description: "", indicateur_ids: [],
  type_document: "", mode_generation: "manuel", condition_generation: "",
};

// Lien externe rendu seulement s'il est http(s). // fix
export const lienSur = (url) => (typeof url === "string" && /^https?:\/\//i.test(url) ? url : null);

function LienDrive({ url, nom }) {
  const href = lienSur(url);
  if (!href) return <span className="sess-secondaire">—</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir le fichier du modèle ${nom} sur Google Drive (nouvel onglet)`}>
      Ouvrir sur le Drive
    </a>
  );
}

// Mode de génération : affiché seulement quand il n'est pas le mode manuel habituel.
function Usage({ m }) {
  return (
    <>
      {PORTEES[m.portee]?.court || m.portee}
      <span className="sess-secondaire"> · {TYPES_DOCUMENT[m.type_document] || m.type_document}</span>
      {m.mode_generation && m.mode_generation !== "manuel" && (
        <span className="sess-secondaire"> · génération {MODES_GENERATION[m.mode_generation]?.toLowerCase() || m.mode_generation}</span>
      )}
    </>
  );
}

// /modeles (admin) : liste compacte d'abord ; détail, création, modification et marqueurs
// dans des panneaux. Un modèle désactivé se réactive depuis la liste des désactivés ;
// le retrait ne touche pas les documents déjà générés.
export function ModelesPage() {
  useTitrePage("Modèles de documents");
  const [donnees, setDonnees] = useState(null);
  const [err, setErr] = useState(null);
  const [criteres, setCriteres] = useState(null);
  const [succes, setSucces] = useState(null);
  const [erreurAction, setErreurAction] = useState(null);
  const [creation, setCreation] = useState(false);
  const [edition, setEdition] = useState(null);
  const [detail, setDetail] = useState(null);
  const [marqueursOuverts, setMarqueursOuverts] = useState(false);
  const [aRetirer, setARetirer] = useState(null);
  const [retrait, setRetrait] = useState(false);
  const [desactives, setDesactives] = useState(null);
  const [afficherDesactives, setAfficherDesactives] = useState(false);
  // DOC-2 : { id, chargement, erreur, data } — un diagnostic à la fois,
  // celui du modèle actuellement ouvert dans le Drawer « Détail ».
  const [diag, setDiag] = useState(null);

  // Une lecture Drive par OUVERTURE du Drawer (jamais au simple re-render :
  // la dépendance est l'identifiant, une primitive stable tant que le même
  // modèle reste affiché) ; « Réanalyser » rappelle cette même fonction.
  const analyser = useCallback(async (id) => {
    setDiag({ id, chargement: true, erreur: null, data: null });
    try {
      const r = await api(`/api/modeles/${id}/diagnostic`);
      setDiag((d) => (d?.id === id ? { id, chargement: false, erreur: null, data: r } : d));
    } catch (e) {
      setDiag((d) => (d?.id === id ? { id, chargement: false, erreur: e.message, data: null } : d));
    }
  }, []);
  useEffect(() => {
    if (detail) analyser(detail.id);
    else setDiag(null);
  }, [detail?.id, analyser]);

  const charger = useCallback(async () => {
    try {
      const r = await api("/api/modeles");
      setDonnees({ modeles: r.modeles || [], marqueurs: r.marqueurs || [] });
      setErr(null);
    } catch (e) { setErr(e.message); }
  }, []);
  const chargerDesactives = useCallback(async () => {
    try {
      const r = await api("/api/modeles?inactifs=1");
      setDesactives(r.modeles || []);
    } catch (e) { setErreurAction(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => { if (afficherDesactives) chargerDesactives(); }, [afficherDesactives, chargerDesactives]);
  useEffect(() => {
    api("/api/referentiel").then((r) => setCriteres(r.criteres || [])).catch(() => setCriteres([]));
  }, []);

  // Libellés des indicateurs du référentiel actif, pour le détail.
  const libelles = new Map((criteres || []).flatMap((c) => c.indicateurs || []).map((i) => [i.numero, i.libelle]));

  async function retirer() {
    setRetrait(true);
    setErreurAction(null);
    try {
      await api(`/api/modeles/${aRetirer.id}`, { method: "DELETE" });
      const nom = aRetirer.nom;
      setARetirer(null); setDetail(null);
      await charger();
      if (afficherDesactives) await chargerDesactives();
      setSucces(`Modèle « ${nom} » retiré.`);
    } catch (e) {
      setErreurAction(e.message);
      setARetirer(null);
    } finally {
      setRetrait(false);
    }
  }

  async function reactiver(m) {
    setSucces(null);
    setErreurAction(null);
    try {
      await api(`/api/modeles/${m.id}/reactiver`, { method: "POST" });
      await charger();
      await chargerDesactives();
      setSucces(`Modèle « ${m.nom} » réactivé : il est de nouveau proposé à la génération.`);
    } catch (e) {
      setErreurAction(e.message);
    }
  }

  const modeles = donnees?.modeles;
  const nouveau = <Button variante="primary" onClick={() => { setSucces(null); setErreurAction(null); setCreation(true); }}>+ Nouveau modèle</Button>;

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Paramètres" }, { libelle: "Modèles de documents" }]}
        titre="Modèles de documents"
        description="Un modèle est un Google Doc ou Sheet existant sur le Drive. La génération en fait une copie et y remplace les marqueurs ; le modèle d'origine n'est jamais modifié."
        actions={donnees && (
          <>
            {donnees.marqueurs.length > 0 && <Button onClick={() => setMarqueursOuverts(true)}>Marqueurs reconnus</Button>}
            {modeles.length > 0 && nouveau}
          </>
        )}
      />
      {succes && <Alert ton="success">{succes}</Alert>}
      {erreurAction && <Alert ton="error" titre="L'action sur le modèle n'a pas abouti.">{erreurAction}</Alert>}
      {err && <Alert ton="error" titre="Les modèles n'ont pas pu être chargés." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!donnees && !err && <LoadingState texte="Chargement des modèles…" />}

      {modeles?.length === 0 && (
        <EmptyState titre="Aucun modèle" action={nouveau}>
          Enregistrez un Google Doc ou Sheet du Drive (convocation, attestation, émargement…) pour générer des documents depuis les sessions.
        </EmptyState>
      )}

      {modeles?.length > 0 && (
        <table className="sess-table param-table">
          <caption className="visually-hidden">Modèles de documents ({modeles.length})</caption>
          <thead>
            <tr>
              <th scope="col">Modèle</th>
              <th scope="col">Usage</th>
              <th scope="col">Indicateurs</th>
              <th scope="col">Fichier Google</th>
              <th scope="col"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {modeles.map((m) => (
              <tr key={m.id}>
                <td data-label="Modèle" className="sess-table__principal">
                  <button type="button" className="param-lien-bouton" onClick={() => setDetail(m)}>{m.nom}</button>
                  {m.description && <span className="sess-secondaire param-tronque">{m.description}</span>}
                </td>
                <td data-label="Usage"><Usage m={m} /></td>
                <td data-label="Indicateurs">
                  {(m.indicateurs || []).length ? `Ind. ${m.indicateurs.map((i) => i.numero).join(", ")}` : "—"}
                </td>
                <td data-label="Fichier Google">
                  <LienDrive url={m.drive_url} nom={m.nom} />
                  {TYPES_FICHIER[m.drive_mime] && <span className="sess-secondaire">{TYPES_FICHIER[m.drive_mime]}</span>}
                </td>
                <td className="sess-table__actions">
                  <Button compact aria-label={`Voir le détail du modèle ${m.nom}`} onClick={() => setDetail(m)}>Détail</Button>
                  <Button compact variante="danger" aria-label={`Retirer le modèle ${m.nom}`}
                    onClick={() => { setSucces(null); setErreurAction(null); setARetirer(m); }}>Retirer</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modeles && (
        <section className="param-desactives" aria-labelledby="desactives-titre">
          <h2 id="desactives-titre" className="param-section-titre">Modèles désactivés</h2>
          <Button compact variante="ghost" onClick={() => setAfficherDesactives((v) => !v)} aria-expanded={afficherDesactives}>
            {afficherDesactives ? "Masquer les modèles désactivés" : "Afficher les modèles désactivés"}
          </Button>
          {afficherDesactives && desactives === null && <LoadingState texte="Chargement…" />}
          {afficherDesactives && desactives?.length === 0 && <p className="sess-secondaire">Aucun modèle désactivé.</p>}
          {afficherDesactives && desactives?.length > 0 && (
            <ul className="param-marqueurs">
              {desactives.map((m) => (
                <li key={m.id}>
                  <strong>{m.nom}</strong> <span className="sess-secondaire">· {PORTEES[m.portee]?.court || m.portee}</span>{" "}
                  <Button compact aria-label={`Réactiver le modèle ${m.nom}`} onClick={() => reactiver(m)}>Réactiver</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Drawer ouvert={!!detail} onFermer={() => setDetail(null)} titre={detail?.nom || ""}
        description={detail ? PORTEES[detail.portee]?.long : undefined}
        pied={detail && (
          <>
            <Button onClick={() => { setEdition(detail); setDetail(null); }}>Modifier</Button>
            <Button variante="danger" onClick={() => setARetirer(detail)}>Retirer ce modèle</Button>
            <Button onClick={() => setDetail(null)}>Fermer</Button>
          </>
        )}>
        {detail && (
          <dl className="param-detail">
            <div><dt>Description</dt><dd>{detail.description || <span className="sess-secondaire">Aucune description</span>}</dd></div>
            <div><dt>Type de document</dt><dd>{TYPES_DOCUMENT[detail.type_document] || detail.type_document}</dd></div>
            <div>
              <dt>Mode de génération</dt>
              <dd>
                {MODES_GENERATION[detail.mode_generation] || detail.mode_generation}
                {detail.mode_generation === "conditionnel" && detail.condition_generation && <> — {detail.condition_generation}</>}
              </dd>
            </div>
            <div><dt>Fichier Google</dt><dd><LienDrive url={detail.drive_url} nom={detail.nom} />{TYPES_FICHIER[detail.drive_mime] && <> · {TYPES_FICHIER[detail.drive_mime]}</>}</dd></div>
            <div>
              <dt>Indicateurs liés</dt>
              <dd>
                <ul className="param-indicateurs">
                  {(detail.indicateurs || []).map((i) => (
                    <li key={i.id}><strong>Indicateur {i.numero}</strong>{libelles.get(i.numero) && <> — {libelles.get(i.numero)}</>}</li>
                  ))}
                </ul>
              </dd>
            </div>
            <div>
              <dt>
                Diagnostic des balises{" "}
                <Button compact variante="ghost" onClick={() => analyser(detail.id)} disabled={diag?.chargement}>Réanalyser</Button>
              </dt>
              <dd>
                {diag?.chargement && <LoadingState texte="Analyse du fichier Drive…" />}
                {diag?.erreur && <Alert ton="error" titre="Le modèle n'a pas pu être analysé.">{diag.erreur}</Alert>}
                {diag?.data && !diag.chargement && <DiagnosticDetail d={diag.data} />}
              </dd>
            </div>
          </dl>
        )}
      </Drawer>

      <Drawer ouvert={marqueursOuverts} onFermer={() => setMarqueursOuverts(false)} titre="Marqueurs reconnus"
        description="Écrivez-les tels quels dans le modèle. Un marqueur absent de cette liste n'est pas remplacé et restera visible dans le document produit.">
        <ul className="param-marqueurs">
          {(donnees?.marqueurs || []).map((m) => <li key={m}><code>{"{{" + m + "}}"}</code></li>)}
        </ul>
      </Drawer>

      <FormulaireModele
        ouvert={creation} criteres={criteres} modele={null} onFermer={() => setCreation(false)}
        onEnregistre={async (nom) => { setCreation(false); await charger(); setSucces(`Modèle « ${nom} » enregistré.`); }}
      />
      <FormulaireModele
        ouvert={!!edition} criteres={criteres} modele={edition} onFermer={() => setEdition(null)}
        onEnregistre={async (nom) => { setEdition(null); await charger(); setSucces(`Modèle « ${nom} » mis à jour.`); }}
      />

      <ConfirmDialog
        ouvert={!!aRetirer} titre="Retirer ce modèle ?" libelleConfirmer="Retirer" enCours={retrait}
        onConfirmer={retirer} onAnnuler={() => setARetirer(null)}
      >
        <p>« {aRetirer?.nom} » ne sera plus proposé à la génération. Vous pourrez le réactiver depuis « Modèles désactivés ».</p>
        <p>Les documents déjà générés ne sont pas touchés, et le fichier reste sur le Drive.</p>
      </ConfirmDialog>
    </>
  );
}

// Valeurs initiales : création (vide) ou modification (valeurs du modèle).
function valeursDe(modele) {
  if (!modele) return VIDE;
  return {
    nom: modele.nom || "",
    lien: modele.drive_url || "",
    portee: modele.portee || "stagiaire",
    description: modele.description || "",
    indicateur_ids: (modele.indicateurs || []).map((i) => i.id),
    type_document: modele.type_document || "",
    mode_generation: modele.mode_generation || "manuel",
    condition_generation: modele.condition_generation || "",
  };
}

// Création et modification : même formulaire. En modification, seul le lien modifié est envoyé
// (un lien inchangé ne réinitialise pas le type du fichier Drive).
function FormulaireModele({ ouvert, criteres, modele, onFermer, onEnregistre }) {
  const [valeurs, setValeurs] = useState(VIDE);
  const [erreurs, setErreurs] = useState({});
  const [erreurServeur, setErreurServeur] = useState(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!ouvert) return;
    setValeurs(valeursDe(modele)); setErreurs({}); setErreurServeur(null); setEnCours(false);
  }, [ouvert, modele]);

  const champ = (cle) => (e) => setValeurs({ ...valeurs, [cle]: e.target.value });
  const titre = modele ? "Modifier le modèle" : "Nouveau modèle";

  async function enregistrer(e) {
    e.preventDefault();
    // L'API attend des NUMÉROS d'indicateurs ; le sélecteur manipule des identifiants.
    const parId = new Map((criteres || []).flatMap((c) => c.indicateurs || []).map((i) => [i.id, i.numero]));
    const numeros = valeurs.indicateur_ids.map((id) => parId.get(Number(id))).filter(Boolean).sort((a, b) => a - b);
    const trouvees = {};
    if (!valeurs.nom.trim()) trouvees.nom = "Donnez un nom au modèle.";
    if (!modele && !valeurs.lien.trim()) trouvees.lien = "Collez le lien ou l'identifiant du fichier Drive.";
    if (!valeurs.type_document) trouvees.type_document = "Choisissez le type de document.";
    if (valeurs.mode_generation === "conditionnel" && !valeurs.condition_generation.trim()) {
      trouvees.condition_generation = "Décrivez la condition de génération.";
    }
    if (!numeros.length) trouvees.indicateurs = "Sélectionnez au moins un indicateur.";
    setErreurs(trouvees);
    if (Object.keys(trouvees).length) return;

    const corps = {
      nom: valeurs.nom,
      portee: valeurs.portee,
      description: valeurs.description,
      type_document: valeurs.type_document,
      mode_generation: valeurs.mode_generation,
      condition_generation: valeurs.mode_generation === "conditionnel" ? valeurs.condition_generation : null,
      indicateurs: numeros,
    };
    if (!modele) corps.lien = valeurs.lien;
    else if (valeurs.lien.trim() && valeurs.lien.trim() !== (modele.drive_url || "").trim()) corps.lien = valeurs.lien;

    setEnCours(true);
    setErreurServeur(null);
    try {
      await api(modele ? `/api/modeles/${modele.id}` : "/api/modeles", {
        method: modele ? "PATCH" : "POST",
        body: JSON.stringify(corps),
      });
      await onEnregistre(valeurs.nom.trim());
    } catch (err) {
      setErreurServeur(err.message);
      setEnCours(false);
    }
  }

  return (
    <Drawer
      ouvert={ouvert} onFermer={onFermer} fermable={!enCours} taille="large"
      titre={titre}
      description={modele ? undefined : "Le fichier doit déjà exister sur le Drive de l'organisme."}
      pied={
        <>
          <Button onClick={onFermer} disabled={enCours}>Annuler</Button>
          <Button variante="primary" type="submit" form="form-modele" disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer le modèle"}
          </Button>
        </>
      }
    >
      <form id="form-modele" onSubmit={enregistrer} noValidate>
        {erreurServeur && <Alert ton="error" titre="Le modèle n'a pas été enregistré.">{erreurServeur}</Alert>}
        <FormSection titre="Modèle">
          <Field label="Nom" erreur={erreurs.nom}>
            <input value={valeurs.nom} onChange={champ("nom")} placeholder="Convocation" required />
          </Field>
          <Field label="Type de document" erreur={erreurs.type_document}>
            <select value={valeurs.type_document} onChange={champ("type_document")}>
              <option value="">Choisir un type…</option>
              {Object.entries(TYPES_DOCUMENT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Usage">
            <select value={valeurs.portee} onChange={champ("portee")}>
              {Object.entries(PORTEES).map(([v, p]) => <option key={v} value={v}>{p.long}</option>)}
            </select>
          </Field>
          <Field label="Mode de génération" aide="Manuelle : lancée depuis la session. Automatique et conditionnelle : déclarées, mais pas encore déclenchées automatiquement.">
            <select value={valeurs.mode_generation} onChange={champ("mode_generation")}>
              {Object.entries(MODES_GENERATION).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          {valeurs.mode_generation === "conditionnel" && (
            <Field label="Condition de génération" erreur={erreurs.condition_generation} className="ui-field--large"
              aide="Décrivez quand ce document doit être produit, en une phrase.">
              <textarea value={valeurs.condition_generation} onChange={champ("condition_generation")} rows={2} maxLength={300} />
            </Field>
          )}
          {!modele && (
            <Field label="Lien ou identifiant du fichier Drive" erreur={erreurs.lien} className="ui-field--large"
              aide="Copiez l'adresse du Google Doc ou Sheet depuis la barre du navigateur.">
              <input value={valeurs.lien} onChange={champ("lien")} placeholder="https://docs.google.com/document/d/…/edit" required />
            </Field>
          )}
          {modele && (
            <Field label="Lien du fichier Drive" erreur={erreurs.lien} className="ui-field--large"
              aide="Laissez tel quel pour conserver le fichier actuel.">
              <input value={valeurs.lien} onChange={champ("lien")} />
            </Field>
          )}
          <Field label="Description" facultatif className="ui-field--large">
            <input value={valeurs.description} onChange={champ("description")} />
          </Field>
        </FormSection>
        <div className="param-selecteur">
          {criteres === null
            ? <LoadingState texte="Chargement des indicateurs…" />
            : <SelecteurIndicateurs criteres={criteres} valeur={valeurs.indicateur_ids} label="Indicateurs Qualiopi prouvés par ce document"
                onChange={(ids) => setValeurs({ ...valeurs, indicateur_ids: ids })} />}
          {erreurs.indicateurs && <p className="ui-field__erreur" role="alert">{erreurs.indicateurs}</p>}
        </div>
      </form>
    </Drawer>
  );
}
