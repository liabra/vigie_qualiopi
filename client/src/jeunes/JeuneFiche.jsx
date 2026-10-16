import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, EmptyState, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { nomComplet } from "./format.js";

// DOC-9D2 — Fiche d'un jeune : identité, et ses entretiens (brouillons
// repris, validés en lecture seule). Aucune inscription n'est créée depuis
// cet écran.
export function JeuneFiche() {
  const { jeuneId } = useParams();
  const navigate = useNavigate();
  const [jeune, setJeune] = useState(null);
  const [entretiens, setEntretiens] = useState(null);
  const [err, setErr] = useState(null);
  const [enCours, setEnCours] = useState(false);
  useTitrePage(jeune ? nomComplet(jeune) : "Jeune");

  const charger = useCallback(async () => {
    try {
      const [rj, re] = await Promise.all([
        api(`/api/stagiaires/${jeuneId}`),
        api(`/api/stagiaires/${jeuneId}/entretiens`),
      ]);
      setJeune(rj.stagiaire);
      setEntretiens(re.entretiens);
      setErr(null);
    } catch (e) { setErr(e.message); }
  }, [jeuneId]);
  useEffect(() => { charger(); }, [charger]);

  async function commencer() {
    setEnCours(true);
    try {
      const r = await api(`/api/stagiaires/${jeuneId}/entretiens`, { method: "POST" });
      navigate(`/jeunes/${jeuneId}/entretiens/${r.entretien.id}`);
    } catch (e) { setErr(e.message); setEnCours(false); }
  }

  if (err) return <Alert ton="error" titre="La fiche n'a pas pu être chargée." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>;
  if (!jeune || !entretiens) return <LoadingState texte="Chargement de la fiche…" />;

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Formation" }, { libelle: "Jeunes", to: "/jeunes" }, { libelle: nomComplet(jeune) }]}
        titre={nomComplet(jeune)}
        description={jeune.email || jeune.telephone ? [jeune.email, jeune.telephone].filter(Boolean).join(" · ") : "Aucune coordonnée renseignée."}
        actions={<Button variante="primary" onClick={commencer} disabled={enCours}>{enCours ? "Préparation…" : "Commencer un entretien"}</Button>}
      />

      {entretiens.length === 0 ? (
        <EmptyState titre="Aucun entretien">
          Aucun entretien n'a encore été commencé pour ce jeune.
        </EmptyState>
      ) : (
        <ul className="jeunes-entretiens-liste">
          {entretiens.map((e) => (
            <li key={e.id} className="jeunes-entretiens-liste__item">
              <div>
                <Badge ton={e.statut === "valide" ? "success" : "info"}>
                  {e.statut === "valide" ? "Validé" : "Brouillon"}
                </Badge>
                <span className="sess-secondaire">
                  {" "}Commencé le {new Date(e.cree_le).toLocaleDateString("fr-FR")}
                  {e.statut === "valide" && e.valide_le ? ` · validé le ${new Date(e.valide_le).toLocaleDateString("fr-FR")}` : ""}
                </span>
              </div>
              <Link to={`/jeunes/${jeuneId}/entretiens/${e.id}`}>
                <Button compact>{e.statut === "valide" ? "Consulter" : "Reprendre"}</Button>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
