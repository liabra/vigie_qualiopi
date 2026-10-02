import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, LoadingState } from "../ui/index.js";
import { formaterDate } from "../sessions/format.js";
import { useTitrePage } from "./titre.js";

const RESULTATS_AUDIT = {
  en_attente: { libelle: "En attente", ton: "neutral" },
  certifie: { libelle: "Certifié", ton: "success" },
  maintenu: { libelle: "Maintenu", ton: "success" },
  non_certifie: { libelle: "Non certifié", ton: "error" },
  suspendu: { libelle: "Suspendu", ton: "error" },
};
const TYPES_AUDIT = {
  initial: "Audit initial", surveillance: "Surveillance", renouvellement: "Renouvellement",
  blanc: "Audit blanc", interne: "Audit interne",
};

const Tuile = ({ n, libelle }) => (
  <div className="qualite-compteur">
    <span className="qualite-compteur__n">{n}</span>
    <span className="qualite-compteur__l">{libelle}</span>
  </div>
);
// Une ligne cliquable : libellé + compteur facultatif.
function Ligne({ to, libelle, nombre, ton = "neutral" }) {
  return (
    <li>
      <Link to={to} className="accueil-item">
        <span className="accueil-item__libelle">{libelle}</span>
        {nombre !== undefined && <Badge ton={ton}>{nombre}</Badge>}
      </Link>
    </li>
  );
}
const heure = (d) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

// Poste de pilotage (Q5). Une seule lecture agrégée, adaptée au rôle par le
// SERVEUR (GET /api/pilotage/accueil) : l'écran n'affiche que ce qu'il reçoit.
// ADMIN : « Vue d'ensemble A2C » ; CONTRIBUTEUR : « Mon espace de travail ».
export function Accueil({ user }) {
  const admin = user.role === "admin";
  const titre = admin ? "Vue d'ensemble A2C" : "Mon espace de travail";
  useTitrePage(titre);
  const prenom = (user.nom || "").trim();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [actualise, setActualise] = useState(null);
  const [drive, setDrive] = useState(null);

  const charger = useCallback(async () => {
    try { setD(await api("/api/pilotage/accueil")); setErr(null); setActualise(new Date()); }
    catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => { if (admin) api("/api/drive/status").then(setDrive).catch(() => {}); }, [admin]);
  const driveActionRequise = admin && drive && (!drive.connected || drive.reconnexionRequise || drive.erreur);

  return (
    <>
      <section className="accueil-entete">
        <div>
          <h1>{titre}</h1>
          <p className="muted">
            {prenom ? `Bonjour ${prenom}.` : "Bonjour."}{" "}
            {admin ? "Ce qui est en cours, ce qui approche et ce qui demande votre intervention." : "Vos sessions, vos dossiers à compléter et vos actions."}
          </p>
        </div>
        {d && (
          <p className="muted small">
            Actualisé à {heure(actualise)} <Button compact variante="ghost" onClick={charger}>Actualiser</Button>
          </p>
        )}
      </section>

      {driveActionRequise && (
        <Alert ton={drive.erreur ? "error" : "warning"} titre="Google Drive" action={<Button compact to="/parametres/google">Paramètres Drive</Button>}>
          {drive.erreur ? drive.erreur : !drive.connected ? "Le Google Drive n'est pas connecté." : "Une reconnexion du Drive est requise."}
        </Alert>
      )}

      {err && <Alert ton="error" titre="Le tableau de pilotage n'a pas pu être chargé." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!d && !err && <LoadingState texte="Chargement de votre vue d'ensemble…" />}

      {d && (
        <>
          {/* A — Résumé rapide */}
          <section className="accueil-bloc" aria-labelledby="pil-resume">
            <h2 id="pil-resume" className="accueil-bloc__titre">En bref</h2>
            <div className="qualite-compteurs">
              <Tuile n={d.sessions.en_cours} libelle="Sessions en cours" />
              <Tuile n={d.sessions.inscrits_actifs} libelle="Stagiaires inscrits (sessions non archivées)" />
              <Tuile n={d.priorites.lignes.length + d.priorites.reste} libelle="Points à traiter" />
              {admin
                ? <Tuile n={d.qualite.actions_en_retard} libelle="Actions qualité en retard" />
                : <Tuile n={d.mes_actions.ouvertes} libelle="Mes actions qualité ouvertes" />}
            </div>
          </section>

          {/* B — À traiter en priorité */}
          <section className="accueil-bloc" aria-labelledby="pil-priorites">
            <h2 id="pil-priorites" className="accueil-bloc__titre">À traiter en priorité</h2>
            {d.priorites.lignes.length === 0 ? (
              <p className="muted">Rien d'urgent : aucun point en attente.</p>
            ) : (
              <ol className="accueil-liste" aria-label="Priorités">
                {d.priorites.lignes.map((l) => <Ligne key={l.cle} to={l.to} libelle={l.libelle} />)}
              </ol>
            )}
            {d.priorites.reste > 0 && (
              <p className="muted small">
                Et {d.priorites.reste} autre(s) point(s).{" "}
                {d.priorites.voir_davantage && <Link to={d.priorites.voir_davantage.to}>{d.priorites.voir_davantage.libelle}</Link>}
              </p>
            )}
          </section>

          {/* C — Sessions et bénéficiaires */}
          <section className="accueil-bloc" aria-labelledby="pil-sessions">
            <h2 id="pil-sessions" className="accueil-bloc__titre">Sessions et bénéficiaires</h2>
            <ul className="accueil-liste">
              <Ligne to="/sessions?vue=en_cours" libelle="Sessions en cours" nombre={d.sessions.en_cours} />
              <Ligne to="/sessions" libelle="Dossiers stagiaires à compléter" nombre={d.sessions.dossiers_incomplets} ton={d.sessions.dossiers_incomplets ? "warning" : "neutral"} />
              <Ligne to="/sessions" libelle="Recueils du besoin à réaliser" nombre={d.sessions.recueils_a_faire} ton={d.sessions.recueils_a_faire ? "warning" : "neutral"} />
              <Ligne to="/sessions" libelle="Mesures pédagogiques à mettre en œuvre" nombre={d.sessions.mesures_prevues} ton={d.sessions.mesures_prevues ? "warning" : "neutral"} />
            </ul>
            {d.sessions.a_venir.length > 0 && (
              <>
                <h3 className="accueil-bloc__titre">Prochaines sessions</h3>
                <ul className="accueil-liste">
                  {d.sessions.a_venir.slice(0, 3).map((s) => (
                    <Ligne key={s.id} to={`/sessions/${s.id}`} libelle={`${s.reference || s.formation} — ${s.formation}`} nombre={`dès le ${formaterDate(s.date_debut)}`} ton="info" />
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* D — Qualité et justificatifs (périmètre du rôle) */}
          <section className="accueil-bloc" aria-labelledby="pil-qualite">
            <h2 id="pil-qualite" className="accueil-bloc__titre">{admin ? "Qualité et justificatifs" : "Mes actions qualité"}</h2>
            {admin ? (
              <ul className="accueil-liste">
                <Ligne to="/actions-qualite" libelle="Actions qualité ouvertes" nombre={d.qualite.actions_ouvertes} />
                <Ligne to="/signalements-qualite?type=reclamation" libelle="Réclamations en cours" nombre={d.qualite.reclamations_en_cours} ton={d.qualite.reclamations_en_retard ? "error" : "neutral"} />
                <Ligne to="/preuves?alerte=perime" libelle="Preuves périmées" nombre={d.preuves.perimees} ton={d.preuves.perimees ? "error" : "neutral"} />
                <Ligne to="/justificatifs-intervenants" libelle="Justificatifs d'intervenants manquants ou à renouveler" nombre={d.justificatifs.manquants + d.justificatifs.bientot + d.justificatifs.perimes} />
                <Ligne to="/synthese-satisfactions" libelle="Réponses de satisfaction (sessions courantes et passées non archivées)" nombre={d.satisfaction.reponses} />
                {d.dernier_audit && (
                  <Ligne to="/audits" libelle={`Dernier audit : ${TYPES_AUDIT[d.dernier_audit.type] || d.dernier_audit.type} · ${formaterDate(d.dernier_audit.date_audit)}`}
                    nombre={RESULTATS_AUDIT[d.dernier_audit.resultat]?.libelle || "—"} ton={RESULTATS_AUDIT[d.dernier_audit.resultat]?.ton || "neutral"} />
                )}
                <li><Link to="/tableau-de-bord-qualite">Ouvrir le tableau de bord qualité</Link></li>
              </ul>
            ) : d.mes_actions.liste.length === 0 ? (
              <p className="muted">Aucune action qualité ne vous est attribuée.</p>
            ) : (
              <ul className="accueil-liste">
                {d.mes_actions.liste.map((a) => (
                  <Ligne key={a.id} to={`/actions-qualite/${a.id}`} libelle={`${a.reference} — ${a.titre}${a.echeance ? ` (échéance ${formaterDate(a.echeance)})` : ""}`}
                    nombre={a.en_retard ? "En retard" : undefined} ton="error" />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {/* E — Raccourcis */}
      <section className="accueil-bloc" aria-labelledby="accueil-raccourcis">
        <h2 id="accueil-raccourcis" className="accueil-bloc__titre">Raccourcis</h2>
        <div className="accueil-raccourcis">
          <Button to="/sessions">Sessions</Button>
          <Button to="/intervenants">Intervenants</Button>
          <Button to="/indicateurs">Indicateurs</Button>
          <Button to="/preuves">Preuves</Button>
          <Button to="/actions-qualite">Actions qualité</Button>
          {admin && <Button to="/tableau-de-bord-qualite">Tableau de bord qualité</Button>}
        </div>
      </section>
    </>
  );
}
