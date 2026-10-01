import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, Field, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { formaterDate, formaterDateHeure } from "../sessions/format.js";
import { aujourdhuiISO } from "./format.js";
import { TRIS_INDICATEURS, filtrerIndicateurs, libelleActivite, libelleType, lienObjet } from "./tableau-bord-format.js";

const Tuile = ({ n, libelle, ton }) => (
  <div className={"qualite-compteur" + (ton === "alerte" && n > 0 ? " qualite-compteur--alerte" : "")}>
    <span className="qualite-compteur__n">{n}</span>
    <span className="qualite-compteur__l">{libelle}</span>
  </div>
);

// /tableau-de-bord-qualite (admin) : FAITS opérationnels du système
// qualité — aucun score ni taux de conformité, aucun diagnostic. Chaque
// élément exploitable renvoie à sa fiche source.
export function TableauBordQualite() {
  useTitrePage("Tableau de bord qualité");
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [tri, setTri] = useState("numero");

  const charger = useCallback(async () => {
    try {
      // Date LOCALE : mêmes règles de retard que les fiches.
      setD(await api(`/api/qualite/tableau-de-bord?aujourdhui=${aujourdhuiISO()}`));
      setErr(null);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const indicateurs = d ? filtrerIndicateurs(d.indicateurs, { q, tri }) : [];

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Qualité" }, { libelle: "Tableau de bord qualité" }]}
        titre="Tableau de bord qualité"
        description="Ce qui demande une action, ce qui est en retard, ce qui attend un contrôle — chaque élément renvoie à sa fiche."
      />
      {err && <Alert ton="error" titre="Le tableau de bord n'a pas pu être chargé." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!d && !err && <LoadingState texte="Chargement du tableau de bord…" />}

      {d && (
        <div className="tdb">
          <section className="qualite-section" aria-labelledby="tdb-actions">
            <h2 id="tdb-actions" className="qualite-section__titre">Actions qualité</h2>
            <div className="qualite-compteurs">
              <Tuile n={d.kpis.actions.ouvertes} libelle="Actions ouvertes" />
              <Tuile n={d.kpis.actions.en_retard} libelle="Actions en retard" ton="alerte" />
              <Tuile n={d.kpis.actions.efficacite_a_verifier} libelle="Efficacité à vérifier" ton="alerte" />
              <Tuile n={d.kpis.actions.cloturees} libelle="Actions clôturées" />
            </div>
          </section>
          <section className="qualite-section" aria-labelledby="tdb-signalements">
            <h2 id="tdb-signalements" className="qualite-section__titre">Signalements</h2>
            <div className="qualite-compteurs">
              <Tuile n={d.kpis.signalements.a_traiter} libelle="Signalements à traiter" />
              <Tuile n={d.kpis.signalements.reclamations_en_retard} libelle="Réclamations en retard" ton="alerte" />
              <Tuile n={d.kpis.signalements.resolus_a_cloturer} libelle="Résolus à clôturer" ton="alerte" />
              <Tuile n={d.kpis.signalements.clotures} libelle="Signalements clôturés" />
            </div>
          </section>
          <section className="qualite-section" aria-labelledby="tdb-preuves">
            <h2 id="tdb-preuves" className="qualite-section__titre">Preuves</h2>
            <div className="qualite-compteurs tdb-compteurs--5">
              <Tuile n={d.kpis.preuves.total} libelle="Preuves enregistrées" />
              <Tuile n={d.kpis.actions.ouvertes_avec_preuve} libelle="Actions ouvertes avec preuve liée" />
              <Tuile n={d.kpis.actions.ouvertes_sans_preuve} libelle="Actions ouvertes sans preuve liée" />
              <Tuile n={d.kpis.signalements.actifs_avec_preuve} libelle="Signalements actifs avec preuve liée" />
              <Tuile n={d.kpis.signalements.actifs_sans_preuve} libelle="Signalements actifs sans preuve liée" />
            </div>
            <p className="sess-secondaire">« Sans preuve liée » est un repère de pilotage, pas une non-conformité.</p>
          </section>

          <section className="qualite-section" aria-labelledby="tdb-priorites">
            <h2 id="tdb-priorites" className="qualite-section__titre">Priorités du moment</h2>
            <div className="qualite-fiche">
              {d.priorites.length === 0 ? <p className="sess-secondaire">Aucune priorité actuellement.</p> : (
                <ol className="tdb-priorites">
                  {d.priorites.map((p) => (
                    <li key={`${p.type}:${p.id}`} className="tdb-priorite">
                      <div className="tdb-priorite__tete">
                        <Badge ton={/retard/.test(p.raison) ? "error" : "warning"}>{p.raison_libelle}</Badge>
                        <span className="sess-secondaire">{libelleType(p.type)} {p.reference}</span>
                      </div>
                      <Link to={lienObjet(p.type, p.id)}>{p.titre}</Link>
                      {p.echeance && <span className="sess-secondaire">Échéance : {formaterDate(p.echeance)}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>

          <section className="qualite-section" aria-labelledby="tdb-indicateurs">
            <h2 id="tdb-indicateurs" className="qualite-section__titre">Vue par indicateur Qualiopi</h2>
            <div className="tdb-outils">
              <Field label="Rechercher un indicateur">
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Numéro ou mot-clé" />
              </Field>
              <Field label="Trier">
                <select value={tri} onChange={(e) => setTri(e.target.value)}>
                  {Object.entries(TRIS_INDICATEURS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
            </div>
            {indicateurs.length === 0 ? <p className="sess-secondaire">Aucun indicateur ne correspond.</p> : (
              <table className="sess-table tdb-table">
                <caption className="visually-hidden">Indicateurs du référentiel actif ({indicateurs.length})</caption>
                <thead>
                  <tr>
                    <th scope="col">Indicateur</th>
                    <th scope="col">Preuves</th>
                    <th scope="col" className="sess-num">Actions actives</th>
                    <th scope="col" className="sess-num">Signalements actifs</th>
                  </tr>
                </thead>
                <tbody>
                  {indicateurs.map((i) => (
                    <tr key={i.id}>
                      <td data-label="Indicateur" className="sess-table__principal">
                        <Link to={`/preuves?indicateur=${i.numero}`}>Indicateur {i.numero}</Link>
                        <span className="sess-secondaire tdb-libelle">{i.libelle}</span>
                      </td>
                      <td data-label="Preuves">{i.preuves === 0 ? <span className="sess-secondaire">Aucune preuve enregistrée</span> : i.preuves}</td>
                      <td data-label="Actions actives" className="sess-num">{i.actions_actives}</td>
                      <td data-label="Signalements actifs" className="sess-num">{i.signalements_actifs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="qualite-section" aria-labelledby="tdb-activite">
            <h2 id="tdb-activite" className="qualite-section__titre">Activité qualité récente</h2>
            {d.activite_recente.length === 0 ? <p className="sess-secondaire">Aucune activité récente.</p> : (
              <ol className="qualite-historique">
                {d.activite_recente.map((ev) => (
                  <li key={ev.id} className="qualite-historique__item">
                    <time className="qualite-historique__date" dateTime={ev.cree_le}>{formaterDateHeure(ev.cree_le)}</time>
                    <span className="qualite-historique__auteur">{ev.acteur_nom || "Utilisateur indisponible"}</span>
                    <span className="qualite-historique__texte">
                      {libelleActivite(ev)} : <Link to={lienObjet(ev.type, ev.objet_id)}>{ev.reference || `${libelleType(ev.type)} ${ev.objet_id}`}</Link>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </>
  );
}
