import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button } from "../ui/index.js";
import { construireAccueil } from "../accueil/format.js";
import { useTitrePage } from "./titre.js";

const STATUTS_SESSION = {
  planifiee: { libelle: "Planifiée", ton: "info" },
  en_cours: { libelle: "En cours", ton: "info" },
  terminee: { libelle: "Terminée", ton: "success" },
  annulee: { libelle: "Annulée", ton: "neutral" },
};
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

// Un item de la liste « À traiter » : libellé, compteur et destination.
function ItemATraiter({ to, libelle, nombre, ton }) {
  return (
    <li>
      <Link to={to} className="accueil-item">
        <span className="accueil-item__libelle">{libelle}</span>
        {nombre > 0 && <Badge ton={ton}>{nombre}</Badge>}
      </Link>
    </li>
  );
}

export function Accueil({ user }) {
  useTitrePage("Accueil");
  const admin = user.role === "admin";
  const prenom = (user.nom || "").trim();
  const [donnees, setDonnees] = useState(null);
  const [drive, setDrive] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let actif = true;
    (async () => {
      try {
        const [referentiel, preuves, veilles, sessions, audits] = await Promise.all([
          api("/api/referentiel"), api("/api/preuves"), api("/api/veille"),
          api("/api/sessions"), api("/api/audits"),
        ]);
        if (!actif) return;
        setDonnees({ referentiel, preuves: preuves.preuves, veilles: veilles.veilles, sessions: sessions.sessions, audits: audits.audits });
      } catch (e) { if (actif) setErr(e.message); }
    })();
    if (admin) api("/api/drive/status").then(setDrive).catch(() => {});
    return () => { actif = false; };
  }, [admin]);

  if (err && !donnees) return <Alert ton="error" titre="Accueil indisponible">{err}</Alert>;
  if (!donnees) return <p className="muted">Chargement…</p>;

  const b = construireAccueil(donnees);
  const rienATraiter = b.aTraiterTotal === 0;
  const driveActionRequise = admin && drive && (!drive.connected || drive.reconnexionRequise || drive.erreur);

  return (
    <>
      <section className="accueil-entete">
        <div>
          <h1>Accueil</h1>
          <p className="muted">
            {prenom ? `Bonjour ${prenom}.` : "Bonjour."}{" "}
            {admin ? "Voici ce qui mérite votre attention aujourd'hui." : "Voici vos sessions et vos accès."}
          </p>
        </div>
      </section>

      {driveActionRequise && (
        <Alert ton={drive.erreur ? "error" : "warning"} titre="Google Drive"
          action={<Button compact to="/parametres/google">Paramètres Drive</Button>}>
          {drive.erreur
            ? drive.erreur
            : !drive.connected ? "Le Google Drive n'est pas connecté." : "Une reconnexion du Drive est requise."}
        </Alert>
      )}

      {admin && (
        <section className="accueil-bloc" aria-labelledby="accueil-atraiter">
          <h2 id="accueil-atraiter" className="accueil-bloc__titre">À traiter</h2>
          {rienATraiter ? (
            <p className="muted">Rien à traiter.</p>
          ) : (
            <ul className="accueil-liste">
              {b.aConfirmer > 0 && <ItemATraiter to="/preuves?a_confirmer=1" libelle="Preuves à confirmer" nombre={b.aConfirmer} ton="error" />}
              {b.perimees > 0 && <ItemATraiter to="/preuves?alerte=perime" libelle="Preuves périmées" nombre={b.perimees} ton="error" />}
              {b.bientot > 0 && <ItemATraiter to="/preuves?alerte=bientot" libelle="Preuves à revoir bientôt" nombre={b.bientot} ton="warning" />}
              {b.veillesAction > 0 && <ItemATraiter to="/veille?vue=actions" libelle="Veille : actions à réaliser" nombre={b.veillesAction} ton="warning" />}
            </ul>
          )}
        </section>
      )}

      <section className="accueil-bloc" aria-labelledby="accueil-activite">
        <h2 id="accueil-activite" className="accueil-bloc__titre">Activité formation</h2>
        {b.sessionsEnCours.length === 0 && b.prochaines.length === 0 ? (
          <p className="muted">Aucune session.</p>
        ) : (
          <ul className="accueil-liste">
            {b.sessionsEnCours.map((s) => (
              <li key={s.id}>
                <Link to={`/sessions/${s.id}`} className="accueil-item">
                  <span className="accueil-item__libelle">{s.reference || s.formation}</span>
                  <Badge ton={STATUTS_SESSION[s.statut]?.ton || "neutral"}>{STATUTS_SESSION[s.statut]?.libelle || s.statut}</Badge>
                </Link>
              </li>
            ))}
            {b.prochaines.slice(0, 3).map((s) => (
              <li key={s.id}>
                <Link to={`/sessions/${s.id}`} className="accueil-item">
                  <span className="accueil-item__libelle">{s.reference || s.formation}</span>
                  <Badge ton="info">{s.date_debut ? `À partir du ${s.date_debut}` : "À venir"}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {admin && b.score && (
        <section className="accueil-bloc" aria-labelledby="accueil-qualite">
          <h2 id="accueil-qualite" className="accueil-bloc__titre">Qualité</h2>
          <ul className="accueil-liste">
            <li>
              <Link to="/indicateurs" className="accueil-item">
                <span className="accueil-item__libelle">Indicateurs au vert</span>
                <Badge ton="success">{b.score.maitrise}/{b.totalApplicable}</Badge>
              </Link>
            </li>
            <li>
              <Link to="/preuves" className="accueil-item">
                <span className="accueil-item__libelle">Preuves rattachées</span>
                <Badge ton="neutral">{b.score.preuves}</Badge>
              </Link>
            </li>
            {b.dernierAudit && (
              <li>
                <Link to="/audits" className="accueil-item">
                  <span className="accueil-item__libelle">
                    Dernier audit : {TYPES_AUDIT[b.dernierAudit.type] || b.dernierAudit.type}
                    {b.dernierAudit.date_audit ? ` · ${b.dernierAudit.date_audit}` : ""}
                  </span>
                  <Badge ton={RESULTATS_AUDIT[b.dernierAudit.resultat]?.ton || "neutral"}>
                    {RESULTATS_AUDIT[b.dernierAudit.resultat]?.libelle || b.dernierAudit.resultat}
                  </Badge>
                </Link>
              </li>
            )}
          </ul>
        </section>
      )}

      <section className="accueil-bloc" aria-labelledby="accueil-raccourcis">
        <h2 id="accueil-raccourcis" className="accueil-bloc__titre">Raccourcis</h2>
        <div className="accueil-raccourcis">
          <Button to="/sessions">Sessions</Button>
          {!admin && <Button to="/indicateurs">Indicateurs</Button>}
          <Button to="/preuves">Preuves</Button>
          <Button to="/veille">Veille</Button>
          <Button to="/audits">Audits</Button>
        </div>
      </section>
    </>
  );
}
