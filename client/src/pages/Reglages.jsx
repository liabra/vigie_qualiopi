import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Button, PageHeader } from "../ui/index.js";
import { useTitrePage } from "./titre.js";

// Réglages : ce qu'on règle une fois, puis qu'on oublie. Une carte par
// rubrique ; chaque rubrique reste sa propre page (adresse inchangée).
const CARTES = [
  { titre: "Organisme", texte: "Nom, SIRET, déclaration d'activité, signataires des documents.", liens: [["/parametres/organisme", "Modifier"]] },
  { titre: "Comptes et accès", texte: "Qui peut se connecter : administrateurs, contributeurs, accès temporaire d'un auditeur. Les contributeurs ne voient que « Aujourd'hui » et « Formations ».", liens: [["/parametres/comptes", "Gérer les comptes"]] },
  { titre: "Google Drive", texte: "Connexion au Drive où sont rangés les documents de chaque session.", drive: true, liens: [["/parametres/google", "Connexion"], ["/parametres/inventaire-drive", "Inventaire"]] },
  { titre: "Modèles de documents", texte: "Conventions, convocations, attestations… et les informations qu'ils reprennent automatiquement.", liens: [["/modeles", "Modèles"], ["/variables-documentaires", "Informations reprises"]] },
  { titre: "Référentiel Qualiopi", texte: "Version du référentiel en vigueur et indicateurs non concernés.", liens: [["/versions", "Versions"], ["/indicateurs/non-applicables", "Non concernés"]] },
  { titre: "Prescripteurs et questionnaires", texte: "Les prescripteurs qui orientent les jeunes et les questionnaires utilisés en formation.", liens: [["/prescripteurs", "Prescripteurs"], ["/questionnaires", "Questionnaires"]] },
  { titre: "Données personnelles", texte: "Durées de conservation, anonymisation et export des données d'une personne.", liens: [["/parametres/rgpd", "Ouvrir"]] },
];

export function Reglages() {
  useTitrePage("Réglages");
  const [drive, setDrive] = useState(null);
  useEffect(() => { api("/api/drive/status").then(setDrive).catch(() => setDrive({ erreur: true })); }, []);
  const etatDrive = !drive ? null
    : drive.erreur ? { ton: "attention", libelle: "À vérifier" }
    : drive.connected && !drive.reconnexionRequise ? { ton: "ok", libelle: "Connecté" }
    : { ton: "attention", libelle: drive.connected ? "Reconnexion requise" : "Non connecté" };
  return (
    <>
      <PageHeader titre="Réglages" description="Ce qu'on règle une fois, puis qu'on oublie." />
      <div className="reglages-grille">
        {CARTES.map((c) => (
          <section key={c.titre} className="vq-carte reglages-carte" aria-labelledby={`reglage-${c.liens[0][0]}`}>
            <h2 id={`reglage-${c.liens[0][0]}`} className="vq-carte__titre">{c.titre}</h2>
            {c.drive && etatDrive && <span className={`vq-pastille vq-pastille--${etatDrive.ton}`}>{etatDrive.libelle}</span>}
            <p>{c.texte}</p>
            <div className="reglages-liens">
              {c.liens.map(([to, libelle], i) => <Button key={to} compact variante={i === 0 ? "secondary" : "ghost"} to={to}>{libelle}</Button>)}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
