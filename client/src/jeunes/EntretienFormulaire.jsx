import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Field, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { nomComplet } from "./format.js";
import { CHAMPS_ENTRETIEN, ECRANS_ENTRETIEN, champsDeLecran, libelleSource } from "./entretienFormat.js";
import { NIVEAUX_COMPETENCE, PHASES_POSITIONNEMENT, PRIORITES_PHASE } from "./positionnementFormat.js";

// DOC-9D2 lot A — Entretien guidé en 5 écrans, sauvegarde progressive.
// Tout vit dans CE composant (un seul montage) : circuler entre les écrans
// ne perd jamais une réponse déjà saisie, qu'elle soit enregistrée ou non.
// Un entretien `valide` est intégralement en lecture seule.
export function EntretienFormulaire() {
  const { jeuneId, entretienId } = useParams();
  const navigate = useNavigate();
  const [jeune, setJeune] = useState(null);
  const [entretien, setEntretien] = useState(null);
  const [valeurs, setValeurs] = useState({});
  const [evaluations, setEvaluations] = useState({}); // competence_code → niveau
  const [phases, setPhases] = useState({}); // phase → { priorite, observations }
  const [etape, setEtape] = useState(0);
  const [modifieReponses, setModifieReponses] = useState(false);
  const [modifiePositionnement, setModifiePositionnement] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [conflit, setConflit] = useState(false);
  const [confirmerValidation, setConfirmerValidation] = useState(false);
  const [err, setErr] = useState(null);
  useTitrePage(jeune ? `Entretien — ${nomComplet(jeune)}` : "Entretien");
  const modifie = modifieReponses || modifiePositionnement;

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
      setModifieReponses(false);
      setModifiePositionnement(false);
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

  // Enregistre la TOTALITÉ des réponses classiques actuelles (remplacement
  // complet, le contrat du backend) — jamais seulement l'écran courant.
  async function sauvegarderReponses(version) {
    const reponses = Object.entries(valeurs)
      .filter(([cle, valeur]) => CHAMPS_ENTRETIEN[cle] && valeur.trim().length > 0)
      .map(([cle, valeur]) => ({ cle, valeur: valeur.trim() }));
    const r = await api(`/api/entretiens/${entretienId}/reponses`, {
      method: "PUT",
      body: JSON.stringify({ version, reponses }),
    });
    setEntretien(r.entretien);
    setModifieReponses(false);
    return r.entretien;
  }

  // Idem pour le positionnement (34 compétences au plus + priorité/
  // observations par phase) — même contrat de remplacement complet, sur le
  // MÊME verrou de version que les réponses classiques.
  async function sauvegarderPositionnement(version) {
    const listeEvaluations = Object.entries(evaluations)
      .filter(([, niveau]) => niveau)
      .map(([competence_code, niveau]) => ({ competence_code, niveau }));
    const listePhases = Object.entries(phases)
      .filter(([, p]) => (p.priorite || "").trim() || (p.observations || "").trim())
      .map(([phase, p]) => ({ phase: Number(phase), priorite: p.priorite || null, observations: p.observations?.trim() || null }));
    const r = await api(`/api/entretiens/${entretienId}/positionnement`, {
      method: "PUT",
      body: JSON.stringify({ version, evaluations: listeEvaluations, phases: listePhases }),
    });
    setEntretien(r.entretien);
    setModifiePositionnement(false);
    return r.entretien;
  }

  // Enregistre tout ce qui a changé (réponses puis positionnement, dans
  // cet ordre, en chaînant la version renvoyée) — jamais les deux écritures
  // séparément exposées à l'utilisateur comme deux actions distinctes.
  async function enregistrer() {
    if (!modifie) return true;
    setEnregistrement(true); setErreur(null);
    try {
      let version = entretien.version;
      if (modifieReponses) {
        const e = await sauvegarderReponses(version);
        version = e.version;
      }
      if (modifiePositionnement) {
        await sauvegarderPositionnement(version);
      }
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
      setModifie(false);
    } catch (e) {
      setConfirmerValidation(false);
      setErreur(e.message);
    }
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

      <nav aria-label="Écrans de l'entretien" className="entretien-etapes">
        <ol>
          {ECRANS_ENTRETIEN.map((e, i) => {
            const champs = champsDeLecran(e.id);
            const remplis = champs.filter((c) => (valeurs[c.cle] || "").trim().length > 0).length;
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
                  {champs.length > 0 && <span className="sess-secondaire"> {remplis}/{champs.length}</span>}
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
        valeurs={valeurs}
        onChange={changerChamp}
        evaluations={evaluations}
        onChangeEvaluation={changerEvaluation}
        phases={phases}
        onChangePhase={changerPhase}
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
    </>
  );
}

function EcranEntretien({ ecran, jeune, valeurs, onChange, evaluations, onChangeEvaluation, phases, onChangePhase, lectureSeule }) {
  if (ecran.id === 1) {
    return (
      <section aria-label={ecran.titre}>
        <h2>{ecran.titre}</h2>
        <p>Ces informations proviennent déjà du dossier du jeune et ne se ressaisissent pas ici.</p>
        <dl className="jeunes-identite">
          <div><dt>Nom</dt><dd>{nomComplet(jeune)}</dd></div>
          <div><dt>E-mail</dt><dd>{jeune.email || "—"}</dd></div>
          <div><dt>Téléphone</dt><dd>{jeune.telephone || "—"}</dd></div>
        </dl>
      </section>
    );
  }
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
  const champs = champsDeLecran(ecran.id);
  return (
    <section aria-label={ecran.titre}>
      <h2>{ecran.titre}</h2>
      {champs.map((c) => (
        <Field key={c.cle} label={c.libelle} aide={libelleSource(c.source)} facultatif>
          <textarea
            rows={3}
            value={valeurs[c.cle] || ""}
            onChange={(e) => onChange(c.cle, e.target.value)}
            disabled={lectureSeule}
          />
        </Field>
      ))}
    </section>
  );
}
