import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Field, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { nomComplet } from "./format.js";
import {
  ECRANS_ENTRETIEN, CHAMPS_SIMPLES, BLOCS_LIGNES,
  champsSimplesDeLecran, groupesChoixDeLecran, blocsLignesDeLecran, libelleSource,
} from "./entretienFormat.js";
import { NIVEAUX_COMPETENCE, PHASES_POSITIONNEMENT, PRIORITES_PHASE } from "./positionnementFormat.js";

const cleChoix = (groupe, code) => `${groupe}::${code}`;

// DOC-9D2/DOC-9D3 — Entretien guidé en 5 écrans, sauvegarde progressive.
// Tout vit dans CE composant (un seul montage) : circuler entre les écrans
// ne perd jamais une réponse déjà saisie, qu'elle soit enregistrée ou non.
// Un entretien `valide` est intégralement en lecture seule.
export function EntretienFormulaire() {
  const { jeuneId, entretienId } = useParams();
  const navigate = useNavigate();
  const [jeune, setJeune] = useState(null);
  const [entretien, setEntretien] = useState(null);
  const [valeurs, setValeurs] = useState({}); // cle (texte/select/echelle/date) → valeur
  const [evaluations, setEvaluations] = useState({}); // competence_code → niveau
  const [phases, setPhases] = useState({}); // phase → { priorite, observations }
  const [choix, setChoix] = useState({}); // "groupe::code" → true
  const [lignes, setLignes] = useState({ experiences: [], plan_action: [] });
  const [etape, setEtape] = useState(0);
  const [modifieReponses, setModifieReponses] = useState(false);
  const [modifiePositionnement, setModifiePositionnement] = useState(false);
  const [modifieChoix, setModifieChoix] = useState(false);
  const [modifieLignes, setModifieLignes] = useState({ experiences: false, plan_action: false });
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [conflit, setConflit] = useState(false);
  const [confirmerValidation, setConfirmerValidation] = useState(false);
  const [ficheEnCours, setFicheEnCours] = useState(false);
  const [ficheErreur, setFicheErreur] = useState(null);
  const [confirmerRegeneration, setConfirmerRegeneration] = useState(false);
  const [err, setErr] = useState(null);
  useTitrePage(jeune ? `Entretien — ${nomComplet(jeune)}` : "Entretien");
  const modifie = modifieReponses || modifiePositionnement || modifieChoix || modifieLignes.experiences || modifieLignes.plan_action;

  const charger = useCallback(async () => {
    try {
      const [rj, re] = await Promise.all([
        api(`/api/stagiaires/${jeuneId}`),
        api(`/api/entretiens/${entretienId}`),
      ]);
      setJeune(rj.stagiaire);
      setEntretien(re.entretien);
      const v = {};
      for (const r of re.reponses) v[r.cle] = r.valeur;
      setValeurs(v);
      const ev = {};
      for (const e of re.positionnement?.evaluations || []) ev[e.competence_code] = e.niveau;
      setEvaluations(ev);
      const ph = {};
      for (const p of re.positionnement?.phases || []) ph[p.phase] = { priorite: p.priorite || "", observations: p.observations || "" };
      setPhases(ph);
      const ch = {};
      for (const c of re.choix || []) ch[cleChoix(c.groupe, c.code)] = true;
      setChoix(ch);
      setLignes({
        experiences: (re.lignes?.experiences || []).map((l) => ({ structure: l.structure || "", duree: l.duree || "", missions: l.missions || "", retenue: l.retenue || "" })),
        plan_action: (re.lignes?.plan_action || []).map((l) => ({ objectif: l.objectif || "", phase: l.phase ? String(l.phase) : "", action: l.action || "", echeance: l.echeance || "", etat: l.etat || "" })),
      });
      setModifieReponses(false);
      setModifiePositionnement(false);
      setModifieChoix(false);
      setModifieLignes({ experiences: false, plan_action: false });
      setConflit(false);
      setErr(null);
    } catch (e) { setErr(e.message); }
  }, [jeuneId, entretienId]);
  useEffect(() => { charger(); }, [charger]);

  // Empêche une fermeture d'onglet silencieuse tant qu'il reste des
  // modifications non enregistrées.
  useEffect(() => {
    if (!modifie) return;
    const avertir = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", avertir);
    return () => window.removeEventListener("beforeunload", avertir);
  }, [modifie]);

  const lectureSeule = entretien?.statut === "valide";

  function changerChamp(cle, valeur) {
    setValeurs((v) => ({ ...v, [cle]: valeur }));
    setModifieReponses(true);
  }

  function changerEvaluation(code, niveau) {
    setEvaluations((v) => ({ ...v, [code]: niveau }));
    setModifiePositionnement(true);
  }

  function changerPhase(phase, champ, valeur) {
    setPhases((v) => ({ ...v, [phase]: { ...(v[phase] || { priorite: "", observations: "" }), [champ]: valeur } }));
    setModifiePositionnement(true);
  }

  function basculerChoix(groupe, code) {
    setChoix((v) => {
      const cle = cleChoix(groupe, code);
      const copie = { ...v };
      if (copie[cle]) delete copie[cle]; else copie[cle] = true;
      return copie;
    });
    setModifieChoix(true);
  }

  function ajouterLigne(bloc) {
    setLignes((v) => ({ ...v, [bloc]: [...v[bloc], Object.fromEntries(BLOCS_LIGNES[bloc].colonnes.map((c) => [c.cle, ""]))] }));
    setModifieLignes((v) => ({ ...v, [bloc]: true }));
  }

  function changerLigne(bloc, index, champ, valeur) {
    setLignes((v) => ({ ...v, [bloc]: v[bloc].map((l, i) => (i === index ? { ...l, [champ]: valeur } : l)) }));
    setModifieLignes((v) => ({ ...v, [bloc]: true }));
  }

  function supprimerLigne(bloc, index) {
    setLignes((v) => ({ ...v, [bloc]: v[bloc].filter((_, i) => i !== index) }));
    setModifieLignes((v) => ({ ...v, [bloc]: true }));
  }

  // Enregistre la TOTALITÉ des réponses « simples » actuelles (texte,
  // sélection, échelle, date — remplacement complet, le contrat du
  // backend) — jamais seulement l'écran courant.
  async function sauvegarderReponses(version) {
    const reponses = Object.entries(valeurs)
      .filter(([cle, valeur]) => CHAMPS_SIMPLES[cle] && String(valeur).trim().length > 0)
      .map(([cle, valeur]) => ({ cle, valeur: String(valeur).trim() }));
    const r = await api(`/api/entretiens/${entretienId}/reponses`, { method: "PUT", body: JSON.stringify({ version, reponses }) });
    setEntretien(r.entretien);
    setModifieReponses(false);
    return r.entretien;
  }

  async function sauvegarderPositionnement(version) {
    const listeEvaluations = Object.entries(evaluations)
      .filter(([, niveau]) => niveau)
      .map(([competence_code, niveau]) => ({ competence_code, niveau }));
    const listePhases = Object.entries(phases)
      .filter(([, p]) => (p.priorite || "").trim() || (p.observations || "").trim())
      .map(([phase, p]) => ({ phase: Number(phase), priorite: p.priorite || null, observations: p.observations?.trim() || null }));
    const r = await api(`/api/entretiens/${entretienId}/positionnement`, { method: "PUT", body: JSON.stringify({ version, evaluations: listeEvaluations, phases: listePhases }) });
    setEntretien(r.entretien);
    setModifiePositionnement(false);
    return r.entretien;
  }

  async function sauvegarderChoix(version) {
    const liste = Object.keys(choix).map((cle) => { const [groupe, code] = cle.split("::"); return { groupe, code }; });
    const r = await api(`/api/entretiens/${entretienId}/choix`, { method: "PUT", body: JSON.stringify({ version, choix: liste }) });
    setEntretien(r.entretien);
    setModifieChoix(false);
    return r.entretien;
  }

  // Le TABLEAU de lignes à l'écran DEVIENT l'ordre envoyé : pas d'identifiant
  // stable par ligne, seulement une position — conforme à « ne pas forcer
  // un nombre de lignes », la liste peut être vide, partielle ou complète.
  async function sauvegarderLignes(bloc, version) {
    const brutes = lignes[bloc]
      .map((l, i) => ({ ordre: i + 1, ...l }))
      .filter((l) => BLOCS_LIGNES[bloc].colonnes.some((c) => String(l[c.cle] || "").trim().length > 0));
    const r = await api(`/api/entretiens/${entretienId}/lignes`, { method: "PUT", body: JSON.stringify({ version, bloc, lignes: brutes }) });
    setEntretien(r.entretien);
    setModifieLignes((v) => ({ ...v, [bloc]: false }));
    return r.entretien;
  }

  // Enregistre tout ce qui a changé, dans un ordre fixe, en chaînant la
  // version renvoyée par chaque appel — jamais les écritures séparément
  // exposées à l'utilisateur comme des actions distinctes.
  async function enregistrer() {
    if (!modifie) return true;
    setEnregistrement(true); setErreur(null);
    try {
      let version = entretien.version;
      if (modifieReponses) version = (await sauvegarderReponses(version)).version;
      if (modifiePositionnement) version = (await sauvegarderPositionnement(version)).version;
      if (modifieChoix) version = (await sauvegarderChoix(version)).version;
      if (modifieLignes.experiences) version = (await sauvegarderLignes("experiences", version)).version;
      if (modifieLignes.plan_action) version = (await sauvegarderLignes("plan_action", version)).version;
      return true;
    } catch (e) {
      if (e.status === 409) { setConflit(true); return false; }
      setErreur(e.message);
      return false;
    } finally { setEnregistrement(false); }
  }

  async function allerA(nouvelleEtape) {
    if (lectureSeule || !modifie) { setEtape(nouvelleEtape); return; }
    const ok = await enregistrer();
    if (ok) setEtape(nouvelleEtape);
  }

  async function valider() {
    try {
      const r = await api(`/api/entretiens/${entretienId}/valider`, { method: "POST" });
      setEntretien(r.entretien);
      setConfirmerValidation(false);
    } catch (e) {
      setConfirmerValidation(false);
      setErreur(e.message);
    }
  }

  // DOC-9E — Génération de la fiche FSE-IA (document Google Docs créé par
  // Vigie à partir des données structurées, PAS une copie du modèle
  // officiel — indisponible dans cet environnement, cf. VIGIE_AGENT_LOG.md).
  async function genererFiche(remplacer = false) {
    setFicheEnCours(true); setFicheErreur(null);
    try {
      const r = await api(`/api/entretiens/${entretienId}/fiche`, { method: "POST", body: JSON.stringify({ remplacer }) });
      setEntretien(r.entretien);
      setConfirmerRegeneration(false);
    } catch (e) {
      if (e.status === 409) { setConfirmerRegeneration(true); return; }
      setFicheErreur(e.message);
    } finally { setFicheEnCours(false); }
  }

  if (err) return <Alert ton="error" titre="L'entretien n'a pas pu être chargé." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>;
  if (!jeune || !entretien) return <LoadingState texte="Chargement de l'entretien…" />;

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Formation" }, { libelle: "Jeunes", to: "/jeunes" }, { libelle: nomComplet(jeune), to: `/jeunes/${jeuneId}` }, { libelle: "Entretien" }]}
        titre={`Entretien initial — ${nomComplet(jeune)}`}
        description={lectureSeule
          ? `Entretien validé le ${new Date(entretien.valide_le).toLocaleDateString("fr-FR")} : lecture seule.`
          : "Les réponses sont enregistrées en changeant d'écran. Rien n'est inscrit tant que l'entretien n'est pas validé."}
        actions={<Badge ton={lectureSeule ? "success" : "info"}>{lectureSeule ? "Validé" : "Brouillon"}</Badge>}
      />

      {erreur && <Alert ton="error" titre="L'enregistrement a échoué.">{erreur}</Alert>}
      {conflit && (
        <Alert ton="warning" titre="Cet entretien a été modifié entre-temps.">
          Quelqu'un (ou un autre onglet) a enregistré une version plus récente. Rechargez pour voir ces changements —
          vos saisies non enregistrées sur cet écran seront perdues.
          <div><Button compact onClick={charger}>Recharger l'entretien</Button></div>
        </Alert>
      )}

      {lectureSeule && (
        <Alert ton="info" titre="Fiche FSE-IA">
          {ficheErreur && <p>{ficheErreur}</p>}
          {entretien.fiche_drive_url ? (
            <p>
              Fiche générée le {new Date(entretien.fiche_generee_le).toLocaleDateString("fr-FR")} —{" "}
              <a href={entretien.fiche_drive_url} target="_blank" rel="noreferrer">Voir le document</a>.{" "}
              <Button compact onClick={() => genererFiche(false)} disabled={ficheEnCours}>
                {ficheEnCours ? "Régénération…" : "Régénérer"}
              </Button>
            </p>
          ) : (
            <>
              <p>Aucune fiche n'a encore été générée pour cet entretien. Ce document est créé directement par Vigie à
                partir des réponses structurées : il ne reproduit pas la mise en page exacte du modèle officiel FSE-IA
                (inaccessible dans cet environnement).</p>
              <Button variante="primary" onClick={() => genererFiche(false)} disabled={ficheEnCours}>
                {ficheEnCours ? "Génération…" : "Générer la fiche FSE-IA"}
              </Button>
            </>
          )}
        </Alert>
      )}

      <nav aria-label="Écrans de l'entretien" className="entretien-etapes">
        <ol>
          {ECRANS_ENTRETIEN.map((e, i) => {
            const totalCompetences = e.id === 4 ? PHASES_POSITIONNEMENT.reduce((n, p) => n + p.competences.length, 0) : 0;
            const competencesRemplies = e.id === 4 ? Object.values(evaluations).filter(Boolean).length : 0;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  className={"entretien-etapes__bouton" + (i === etape ? " entretien-etapes__bouton--actif" : "")}
                  aria-current={i === etape ? "step" : undefined}
                  onClick={() => allerA(i)}
                  disabled={enregistrement}
                >
                  {e.titre}
                  {totalCompetences > 0 && <span className="sess-secondaire"> {competencesRemplies}/{totalCompetences}</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <EcranEntretien
        ecran={ECRANS_ENTRETIEN[etape]}
        jeune={jeune}
        valeurs={valeurs} onChange={changerChamp}
        evaluations={evaluations} onChangeEvaluation={changerEvaluation}
        phases={phases} onChangePhase={changerPhase}
        choix={choix} onToggleChoix={basculerChoix}
        lignes={lignes} onAjouterLigne={ajouterLigne} onChangerLigne={changerLigne} onSupprimerLigne={supprimerLigne}
        lectureSeule={lectureSeule}
      />

      <div className="entretien-navigation">
        <Button onClick={() => allerA(Math.max(0, etape - 1))} disabled={etape === 0 || enregistrement}>Précédent</Button>
        {!lectureSeule && (
          <Button onClick={enregistrer} disabled={!modifie || enregistrement}>
            {enregistrement ? "Enregistrement…" : "Enregistrer le brouillon"}
          </Button>
        )}
        {etape < ECRANS_ENTRETIEN.length - 1
          ? <Button variante="primary" onClick={() => allerA(Math.min(ECRANS_ENTRETIEN.length - 1, etape + 1))} disabled={enregistrement}>Suivant</Button>
          : !lectureSeule && <Button variante="primary" onClick={() => setConfirmerValidation(true)} disabled={modifie || enregistrement}>Valider l'entretien</Button>}
      </div>
      {etape === ECRANS_ENTRETIEN.length - 1 && !lectureSeule && modifie && (
        <p className="sess-secondaire">Enregistrez le brouillon avant de valider l'entretien.</p>
      )}

      <ConfirmDialog
        ouvert={confirmerValidation} titre="Valider cet entretien ?"
        libelleConfirmer="Valider" onConfirmer={valider} onAnnuler={() => setConfirmerValidation(false)}
      >
        <p>L'entretien passera en lecture seule : plus aucune réponse ne pourra être modifiée.</p>
        <p>Aucune inscription n'est créée par cette validation.</p>
      </ConfirmDialog>

      <ConfirmDialog
        ouvert={confirmerRegeneration} titre="Régénérer la fiche FSE-IA ?"
        libelleConfirmer="Régénérer" enCours={ficheEnCours}
        onConfirmer={() => genererFiche(true)} onAnnuler={() => setConfirmerRegeneration(false)}
      >
        <p>Une fiche existe déjà pour cet entretien. La régénérer créera un nouveau document et mettra l'ancien à la corbeille.</p>
      </ConfirmDialog>
    </>
  );
}

function ChampSimple({ champ, valeur, onChange, lectureSeule }) {
  if (champ.type === "select") {
    return (
      <Field label={champ.libelle} aide={libelleSource(champ.source)} facultatif>
        <select value={valeur || ""} onChange={(e) => onChange(champ.cle, e.target.value)} disabled={lectureSeule}>
          <option value="">Non renseigné</option>
          {champ.options.map((o) => <option key={o.valeur} value={o.valeur}>{o.libelle}</option>)}
        </select>
      </Field>
    );
  }
  if (champ.type === "echelle") {
    return (
      <Field label={champ.libelle} aide={libelleSource(champ.source)} facultatif>
        <input type="number" min={champ.min} max={champ.max} step={1} value={valeur || ""} onChange={(e) => onChange(champ.cle, e.target.value)} disabled={lectureSeule} />
      </Field>
    );
  }
  if (champ.type === "date") {
    return (
      <Field label={champ.libelle} aide={libelleSource(champ.source)} facultatif>
        <input type="date" value={valeur || ""} onChange={(e) => onChange(champ.cle, e.target.value)} disabled={lectureSeule} />
      </Field>
    );
  }
  return (
    <Field label={champ.libelle} aide={libelleSource(champ.source)} facultatif>
      <textarea rows={3} value={valeur || ""} onChange={(e) => onChange(champ.cle, e.target.value)} disabled={lectureSeule} />
    </Field>
  );
}

function GroupeChoixCases({ groupe, choix, onToggle, lectureSeule }) {
  return (
    <fieldset className="entretien-choix">
      <legend>{groupe.libelle} <span className="sess-secondaire">({libelleSource(groupe.source)})</span></legend>
      {groupe.options.map((o) => (
        <label key={o.code} className="ui-case">
          <input
            type="checkbox"
            checked={!!choix[cleChoix(groupe.groupe, o.code)]}
            onChange={() => onToggle(groupe.groupe, o.code)}
            disabled={lectureSeule}
          />
          <span>{o.libelle}</span>
        </label>
      ))}
    </fieldset>
  );
}

function TableauRepetable({ bloc, lignes, onAjouter, onChanger, onSupprimer, lectureSeule }) {
  return (
    <fieldset className="entretien-tableau">
      <legend>{bloc.libelle} <span className="sess-secondaire">({libelleSource(bloc.source)})</span></legend>
      {lignes.length === 0 && <p className="sess-secondaire">Aucune ligne pour le moment.</p>}
      {lignes.map((ligne, i) => (
        <div key={i} className="entretien-tableau__ligne">
          {bloc.colonnes.map((c) => (
            <Field key={c.cle} label={c.libelle} facultatif>
              {c.type === "select" ? (
                <select value={ligne[c.cle] || ""} onChange={(e) => onChanger(bloc.bloc, i, c.cle, e.target.value)} disabled={lectureSeule}>
                  <option value="">Non renseigné</option>
                  {c.options.map((o) => <option key={o.valeur} value={o.valeur}>{o.libelle}</option>)}
                </select>
              ) : (
                <textarea rows={2} value={ligne[c.cle] || ""} onChange={(e) => onChanger(bloc.bloc, i, c.cle, e.target.value)} disabled={lectureSeule} />
              )}
            </Field>
          ))}
          {!lectureSeule && <Button compact variante="danger" onClick={() => onSupprimer(bloc.bloc, i)}>Supprimer cette ligne</Button>}
        </div>
      ))}
      {!lectureSeule && <Button compact onClick={() => onAjouter(bloc.bloc)}>+ Ajouter une ligne</Button>}
    </fieldset>
  );
}

function EcranEntretien({
  ecran, jeune, valeurs, onChange, evaluations, onChangeEvaluation, phases, onChangePhase,
  choix, onToggleChoix, lignes, onAjouterLigne, onChangerLigne, onSupprimerLigne, lectureSeule,
}) {
  if (ecran.id === 4) {
    return (
      <section aria-label={ecran.titre}>
        <h2>{ecran.titre}</h2>
        <p>Questionnaire de positionnement des six phases du parcours FSE-IA (34 compétences). Une réponse reste vide tant qu'aucun niveau n'est choisi.</p>
        {PHASES_POSITIONNEMENT.map((p) => (
          <fieldset key={p.phase} className="entretien-phase">
            <legend>Phase {p.phase} — {p.titre} ({p.dureeHeures} h)</legend>
            {p.competences.map((c) => (
              <fieldset key={c.code} className="entretien-competence">
                <legend>{c.libelle}</legend>
                {NIVEAUX_COMPETENCE.map((n) => (
                  <label key={n.valeur} className="ui-case">
                    <input
                      type="radio"
                      name={c.code}
                      value={n.valeur}
                      checked={evaluations[c.code] === n.valeur}
                      onChange={() => onChangeEvaluation(c.code, n.valeur)}
                      disabled={lectureSeule}
                    />
                    <span>{n.libelle}</span>
                  </label>
                ))}
              </fieldset>
            ))}
            <Field label={`Priorité pour ce parcours — Phase ${p.phase}`} facultatif>
              <select
                value={phases[p.phase]?.priorite || ""}
                onChange={(e) => onChangePhase(p.phase, "priorite", e.target.value)}
                disabled={lectureSeule}
              >
                <option value="">Non renseignée</option>
                {PRIORITES_PHASE.map((pr) => <option key={pr.valeur} value={pr.valeur}>{pr.libelle}</option>)}
              </select>
            </Field>
            <Field label={`Observations de l'accompagnateur — Phase ${p.phase}`} aide={libelleSource("accompagnateur")} facultatif>
              <textarea
                rows={2}
                value={phases[p.phase]?.observations || ""}
                onChange={(e) => onChangePhase(p.phase, "observations", e.target.value)}
                disabled={lectureSeule}
              />
            </Field>
          </fieldset>
        ))}
      </section>
    );
  }

  const champs = champsSimplesDeLecran(ecran.id);
  const groupes = groupesChoixDeLecran(ecran.id);
  const blocs = blocsLignesDeLecran(ecran.id);
  return (
    <section aria-label={ecran.titre}>
      <h2>{ecran.titre}</h2>
      {ecran.id === 1 && (
        <>
          <p>Identité déjà connue du dossier du jeune, ne se ressaisit pas ici.</p>
          <dl className="jeunes-identite">
            <div><dt>Nom</dt><dd>{nomComplet(jeune)}</dd></div>
            <div><dt>E-mail</dt><dd>{jeune.email || "—"}</dd></div>
            <div><dt>Téléphone</dt><dd>{jeune.telephone || "—"}</dd></div>
          </dl>
        </>
      )}
      {champs.map((c) => <ChampSimple key={c.cle} champ={c} valeur={valeurs[c.cle]} onChange={onChange} lectureSeule={lectureSeule} />)}
      {groupes.map((g) => <GroupeChoixCases key={g.groupe} groupe={g} choix={choix} onToggle={onToggleChoix} lectureSeule={lectureSeule} />)}
      {blocs.map((b) => (
        <TableauRepetable
          key={b.bloc} bloc={b} lignes={lignes[b.bloc] || []}
          onAjouter={onAjouterLigne} onChanger={onChangerLigne} onSupprimer={onSupprimerLigne}
          lectureSeule={lectureSeule}
        />
      ))}
    </section>
  );
}
