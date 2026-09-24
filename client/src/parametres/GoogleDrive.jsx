import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";

// Autorisations accordées, en clair. Aucune donnée OAuth brute (portées,
// jetons, message d'erreur Google) n'est affichée. // fix
export function capacitesDrive(s) {
  return [
    { libelle: "Lire les fichiers (preuves, modèles)", ok: !!s.lectureSeule },
    { libelle: "Créer les documents générés", ok: !!s.ecritureAutorisee },
    { libelle: "Lire le classeur de suivi", ok: !!s.sheetsAutorise },
  ];
}

const connecter = (libelle, variante = "primary") => (
  // Navigation complète vers le flux OAuth du serveur (même origine).
  <a className={`ui-btn ui-btn--${variante}`} href="/auth/google/drive">{libelle}</a>
);

// /parametres/google (admin) : état de la connexion Drive de l'organisme,
// connexion et déconnexion. Le serveur reste seul juge du compte autorisé.
export function GoogleDrivePage() {
  useTitrePage("Google Drive");
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const [confirmation, setConfirmation] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreurAction, setErreurAction] = useState(null);
  const [succes, setSucces] = useState(null);

  const charger = useCallback(async () => {
    try { setS(await api("/api/drive/status")); setErr(null); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  async function deconnecter() {
    setEnCours(true);
    setErreurAction(null);
    try {
      await api("/api/drive/disconnect", { method: "POST" });
      setConfirmation(false);
      await charger();
      setSucces("Google Drive déconnecté.");
    } catch (e) {
      setErreurAction(e.message);
      setConfirmation(false);
    } finally {
      setEnCours(false);
    }
  }

  const connecte = s?.connected;
  const compte = s?.verifie || s?.compte;

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Paramètres" }, { libelle: "Google Drive" }]}
        titre="Google Drive"
        description="Vigie utilise Google Drive pour les modèles, les preuves et les documents générés."
      />
      {succes && <Alert ton="success">{succes}</Alert>}
      {erreurAction && <Alert ton="error" titre="Le Drive n'a pas été déconnecté.">{erreurAction}</Alert>}
      {err && <Alert ton="error" titre="L'état du Drive n'a pas pu être lu." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!s && !err && <LoadingState texte="Lecture de l'état du Drive…" />}

      {s && !s.configured && (
        <Alert ton="warning" titre="La connexion Google n'est pas disponible.">
          Elle doit d'abord être configurée sur le serveur par la personne qui administre l'hébergement de Vigie.
        </Alert>
      )}

      {s && s.configured && (
        <section className="param-carte drive-carte" aria-labelledby="drive-etat">
          <div className="param-carte__tete">
            <div>
              <h2 id="drive-etat" className="param-carte__titre">État de la connexion</h2>
              <div className="sess-badges">
                {connecte
                  ? (s.erreur ? <Badge ton="error">Connecté, mais ne répond pas</Badge> : <Badge ton="success">Connecté</Badge>)
                  : <Badge>Non connecté</Badge>}
              </div>
            </div>
            <div className="param-carte__action">
              {connecte
                ? <Button variante="danger" onClick={() => { setSucces(null); setErreurAction(null); setConfirmation(true); }}>Déconnecter</Button>
                : connecter("Connecter le Drive")}
            </div>
          </div>

          <dl className="param-carte__meta">
            {compte && <div><dt>{s.verifie ? "Compte connecté" : "Compte de l'organisme"}</dt><dd className="drive-compte">{compte}</dd></div>}
          </dl>

          {connecte && !s.erreur && (
            <ul className="drive-capacites" aria-label="Autorisations accordées">
              {capacitesDrive(s).map((c) => (
                <li key={c.libelle}>
                  <span aria-hidden="true" className={"drive-capacite__marque" + (c.ok ? " drive-capacite__marque--ok" : "")}>{c.ok ? "✓" : "–"}</span>
                  {c.libelle} : <strong>{c.ok ? "autorisé" : "non autorisé"}</strong>
                </li>
              ))}
            </ul>
          )}

          {connecte && s.erreur && (
            <Alert ton="error" titre="Le Drive ne répond pas." action={connecter("Reconnecter le Drive", "secondary")}>
              L'autorisation a peut-être été retirée ou a expiré. Reconnectez le Drive avec le compte de l'organisme.
            </Alert>
          )}
          {connecte && !s.erreur && s.reconnexionRequise && (
            <Alert ton="warning" titre="Certaines autorisations manquent." action={connecter("Reconnecter le Drive", "secondary")}>
              Reconnectez le Drive pour accorder toutes les autorisations nécessaires.
            </Alert>
          )}
          {!connecte && (
            <p className="sess-secondaire">
              Connectez le Drive avec le compte de l'organisme{s.compte ? ` (${s.compte})` : ""} : Google vous demandera de confirmer les autorisations.
            </p>
          )}
        </section>
      )}

      <ConfirmDialog
        ouvert={confirmation} titre="Déconnecter le Google Drive ?" libelleConfirmer="Déconnecter" enCours={enCours}
        onConfirmer={deconnecter} onAnnuler={() => setConfirmation(false)}
      >
        <p>Vigie ne pourra plus importer de preuves, rechercher dans le Drive ni générer de documents tant qu'il ne sera pas reconnecté.</p>
        <p>Aucun fichier n'est supprimé du Drive.</p>
      </ConfirmDialog>
    </>
  );
}
