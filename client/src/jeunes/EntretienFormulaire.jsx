import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Field, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { nomComplet } from "./format.js";
import { CHAMPS_ENTRETIEN, ECRANS_ENTRETIEN, champsDeLecran, libelleSource } from "./entretienFormat.js";

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
  const [etape, setEtape] = useState(0);
  const [modifie, setModifie] = useState(false);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [conflit, setConflit] = useState(false);
  const [confirmerValidation, setConfirmerValidation] = useState(false);
  const [err, setErr] = useState(null);
  useTitrePage(jeune ? `Entretien — ${nomComplet(jeune)}` : "Entretien");

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
      setModifie(false);
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
    setModifie(true);
  }

  // Enregistre la TOTALITÉ des réponses actuelles (remplacement complet, le
  // contrat du backend) — jamais seulement l'écran courant : les écrans
  // déjà remplis ne doivent jamais disparaître d'une sauvegarde à l'autre.
  async function enregistrer() {
    setEnregistrement(true); setErreur(null);
    try {
      const reponses = Object.entries(valeurs)
        .filter(([cle, valeur]) => CHAMPS_ENTRETIEN[cle] && valeur.trim().length > 0)
        .map(([cle, valeur]) => ({ cle, valeur: valeur.trim() }));
      const r = await api(`/api/entretiens/${entretienId}/reponses`, {
        method: "PUT",
        body: JSON.stringify({ version: entretien.version, reponses }),
      });
      setEntretien(r.entretien);
      setModifie(false);
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

function EcranEntretien({ ecran, jeune, valeurs, onChange, lectureSeule }) {
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
        <Alert ton="warning" titre="Questionnaire non disponible pour le moment">
          Le questionnaire de positionnement (les six phases du parcours FSE-IA) doit être repris
          exactement du modèle officiel. Il n'a pas pu être lu dans cet environnement
          (accès Drive refusé pour ce fichier) : aucune question n'est inventée en attendant.
          Cet écran sera complété dès que l'accès au modèle sera rétabli.
        </Alert>
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
