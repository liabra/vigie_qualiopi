import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Button, EmptyState, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "./titre.js";
import { FONCTIONS_INTERVENANT, NATURES_INTERVENANT, nomComplet } from "../intervenants/format.js";
import { JustificatifsIntervenant } from "../intervenants/JustificatifsIntervenant.jsx";
import { DossierDeveloppement } from "../intervenants/Developpement.jsx";
import { formaterDate } from "../pilotage/RegistrePage.jsx";

// Équipe (ADMIN) : une liste des intervenants actifs et, pour celui choisi,
// tout ce qui le concerne au même endroit — justificatifs (indicateur 21),
// compétences et développement (indicateur 22), espace formateur. Les
// écrans existants sont réutilisés tels quels ; le serveur reste seul juge
// des droits (toutes ces routes sont réservées à l'administrateur).

// État d'un intervenant pour la liste : le plus urgent l'emporte.
export function etatIntervenant(i, alertes) {
  const siennes = alertes.filter((a) => a.intervenant.id === i.id);
  if (siennes.some((a) => a.etat === "perime")) return { ton: "attention", libelle: "Justificatif périmé" };
  if (siennes.some((a) => a.etat === "manquant")) return { ton: "attention", libelle: "Justificatif manquant" };
  if (i.entretien_a_faire) return { ton: "attention", libelle: "Entretien à planifier" };
  if (siennes.some((a) => a.etat === "bientot")) return { ton: "info", libelle: "À renouveler bientôt" };
  return { ton: "ok", libelle: "À jour" };
}
const initiales = (i) => `${(i.prenom || "").charAt(0)}${(i.nom || "").charAt(0)}`.toUpperCase();

export function Equipe() {
  useTitrePage("Équipe");
  const [d, setD] = useState(null);
  const [alertes, setAlertes] = useState([]);
  const [err, setErr] = useState(null);
  const [params, setParams] = useSearchParams();
  const [dossier, setDossier] = useState(null);
  const [acces, setAcces] = useState(null);

  const charger = useCallback(async () => {
    try {
      const [dev, justif] = await Promise.all([api("/api/developpement"), api("/api/justificatifs-intervenants")]);
      setD(dev); setAlertes(justif.elements || []); setErr(null);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const liste = d?.intervenants || [];
  const idDemande = Number(params.get("intervenant"));
  const choisi = liste.find((i) => i.id === idDemande) || liste[0] || null;
  const choisir = (id) => setParams({ intervenant: String(id) }, { replace: true });

  useEffect(() => {
    if (!choisi) return;
    setAcces(null);
    api(`/api/acces-portail?intervenant_id=${choisi.id}`).then((r) => setAcces(r.acces || [])).catch(() => setAcces([]));
  }, [choisi?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const accesActif = (acces || []).find((a) => a.actif);
  return (
    <>
      <PageHeader titre="Équipe" description="Justificatifs, compétences et espace formateur de chaque intervenant."
        actions={<>
          <a className="ui-btn ui-btn--secondary" href="/api/pdf/developpement" download>Toute l'équipe en PDF (ind. 21-22)</a>
          <Button variante="primary" to="/intervenants">Ajouter ou modifier un intervenant</Button>
        </>} />
      {err && <Alert ton="error" titre="L'équipe n'a pas pu être chargée." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!d && !err && <LoadingState texte="Chargement de l'équipe…" />}
      {d && liste.length === 0 && (
        <EmptyState titre="Aucun intervenant actif." action={<Button variante="primary" to="/intervenants">Ajouter un intervenant</Button>}>
          Ajoutez les formateurs et les personnes qui interviennent dans vos formations.
        </EmptyState>
      )}
      {d && choisi && (
        <div className="equipe">
          <nav className="equipe-liste" aria-label="Intervenants">
            <ul>
              {liste.map((i) => {
                const etat = etatIntervenant(i, alertes);
                const actif = i.id === choisi.id;
                return (
                  <li key={i.id}>
                    <button type="button" aria-current={actif ? "true" : undefined} onClick={() => choisir(i.id)}
                      className={"equipe-personne" + (actif ? " equipe-personne--actif" : "")}>
                      <span className="equipe-personne__initiales" aria-hidden="true">{initiales(i)}</span>
                      <span className="ajd-element__textes">
                        <span className="ajd-element__titre">{nomComplet(i)}</span>
                        <span className="ajd-element__contexte">{FONCTIONS_INTERVENANT[i.fonction] || i.fonction}</span>
                      </span>
                      <span className={`vq-pastille vq-pastille--${etat.ton}`}>{etat.libelle}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <article className="equipe-fiche" aria-labelledby="equipe-nom">
            <div className="vq-carte equipe-fiche__tete">
              <div>
                <h2 id="equipe-nom" className="equipe-fiche__nom">{nomComplet(choisi)}</h2>
                <p className="ajd-element__contexte">{[FONCTIONS_INTERVENANT[choisi.fonction] || choisi.fonction, NATURES_INTERVENANT[choisi.nature] || choisi.nature].filter(Boolean).join(" · ")}</p>
              </div>
              <a className="ui-btn ui-btn--secondary ui-btn--compact" href={`/api/pdf/intervenants/${choisi.id}/developpement`} download>Fiche PDF</a>
            </div>

            <section className="vq-carte" aria-labelledby="equipe-dev">
              <h3 id="equipe-dev" className="vq-carte__titre">Compétences et développement <span className="ajd-element__contexte">· indicateur 22</span></h3>
              <p className={choisi.entretien_a_faire ? "equipe-entretien equipe-entretien--attention" : "equipe-entretien"}>
                <strong>Entretien annuel :</strong>{" "}
                {choisi.date_dernier_entretien ? `dernier le ${formaterDate(choisi.date_dernier_entretien)}` : "jamais renseigné"}
                {choisi.entretien_a_faire ? " · à planifier" : " · à jour"}
              </p>
              <p className="ajd-element__contexte">
                {choisi.realisees} action(s) de formation réalisée(s), {choisi.prevues} prévue(s).
                {choisi.besoins_developpement ? ` Besoins : ${choisi.besoins_developpement.slice(0, 160)}${choisi.besoins_developpement.length > 160 ? "…" : ""}` : ""}
              </p>
              <div><Button compact onClick={() => setDossier(choisi.id)}>Ouvrir le dossier de développement</Button></div>
            </section>

            <section className="vq-carte" aria-label="Justificatifs (indicateur 21)">
              <JustificatifsIntervenant key={choisi.id} intervenant={choisi} />
            </section>

            <section className="vq-carte equipe-espace" aria-labelledby="equipe-espace">
              <div>
                <h3 id="equipe-espace" className="vq-carte__titre">Espace formateur</h3>
                <p className="ajd-element__contexte">
                  {acces === null ? "Chargement…"
                    : accesActif ? `Lien actif jusqu'au ${formaterDate(accesActif.expire_le)}${accesActif.derniere_utilisation ? ` · dernière visite le ${formaterDate(accesActif.derniere_utilisation)}` : " · jamais ouvert"}`
                    : "Aucun lien actif."}
                </p>
              </div>
              <Button compact to="/acces-portails">{accesActif ? "Gérer le lien" : "Créer un lien"}</Button>
            </section>
          </article>
        </div>
      )}
      {dossier && <DossierDeveloppement id={dossier} onFermer={() => { setDossier(null); charger(); }} />}
    </>
  );
}
