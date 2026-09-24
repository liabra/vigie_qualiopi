import { Link } from "react-router-dom";
import { formaterHeures, syntheseAssiduite, syntheseStagiaires } from "./format.js";

// Vue d'ensemble : « où en est cette session ? », à partir des seules
// données déjà chargées par le détail (aucune API supplémentaire).
function Carte({ titre, lien, libelleLien, children }) {
  return (
    <section className="sess-carte" aria-label={titre}>
      <h2 className="sess-carte__titre">{titre}</h2>
      <div className="sess-carte__corps">{children}</div>
      {lien && <Link className="sess-carte__lien" to={lien}>{libelleLien}</Link>}
    </section>
  );
}

const Ligne = ({ libelle, valeur, attention = false }) => (
  <div className={"sess-ligne" + (attention ? " sess-ligne--attention" : "")}>
    <dt>{libelle}</dt>
    <dd>{valeur}</dd>
  </div>
);

export function VueEnsemble({ donnees, base }) {
  const st = syntheseStagiaires(donnees.stagiaires);
  const as = syntheseAssiduite(donnees.absences);
  const ev = donnees.evaluations?.agregation;
  const sa = donnees.satisfactions?.agregation;
  const heuresPrevues = donnees.absences?.session?.heures_prevues;

  return (
    <div className="sess-cartes">
      <Carte titre="Stagiaires" lien={`${base}/stagiaires`} libelleLien="Gérer les stagiaires">
        <dl>
          <Ligne libelle="Inscrits actifs" valeur={st.actifs} />
          <Ligne libelle="Abandons" valeur={st.abandons} />
          <Ligne libelle="Dossiers incomplets" valeur={st.dossiersIncomplets} attention={st.dossiersIncomplets > 0} />
        </dl>
      </Carte>

      <Carte titre="Groupes" lien={`${base}/stagiaires`} libelleLien="Voir les groupes">
        {donnees.groupes.length === 0
          ? <p className="sess-secondaire">Aucun groupe. Une session sur un seul lieu n'en a pas besoin.</p>
          : (
            <ul className="sess-puces">
              {donnees.groupes.map((g) => (
                <li key={g.id}><strong>{g.nom}</strong> · {g.nb_inscrits} inscrit(s){g.lieu && ` · ${g.lieu}`}</li>
              ))}
            </ul>
          )}
      </Carte>

      <Carte titre="Assiduité" lien={`${base}/assiduite`} libelleLien="Voir l'assiduité">
        <dl>
          <Ligne libelle="Durée prévue" valeur={heuresPrevues !== null && heuresPrevues !== undefined ? formaterHeures(heuresPrevues) : "Inconnue"} attention={heuresPrevues === null} />
          <Ligne libelle="Absences saisies" valeur={`${as.nbAbsences} (${formaterHeures(as.totalHeures) || "0 h"})`} />
          <Ligne libelle="Assiduité sous 80 %" valeur={as.sousSeuil} attention={as.sousSeuil > 0} />
        </dl>
      </Carte>

      <Carte titre="Évaluations" lien={`${base}/evaluations`} libelleLien="Voir les évaluations">
        {ev && ev.total > 0 ? (
          <dl>
            <Ligne libelle="Résultats" valeur={ev.total} />
            <Ligne libelle="Validés" valeur={ev.valide} />
            <Ligne libelle="Non validés" valeur={ev.non_valide} attention={ev.non_valide > 0} />
          </dl>
        ) : <p className="sess-secondaire">Aucun résultat enregistré.</p>}
      </Carte>

      <Carte titre="Satisfaction" lien={`${base}/satisfaction`} libelleLien="Voir la satisfaction">
        {sa && sa.reponses > 0 ? (
          <dl>
            <Ligne libelle="Réponses" valeur={sa.reponses} />
            <Ligne
              libelle="Moyenne"
              valeur={sa.moyenne !== null ? `${sa.moyenne} / ${sa.echelleHomogene}` : "Non calculable (échelles différentes)"}
            />
          </dl>
        ) : <p className="sess-secondaire">Aucune réponse recueillie.</p>}
      </Carte>

      <Carte titre="Documents" lien={`${base}/documents`} libelleLien="Voir les documents">
        <dl>
          <Ligne libelle="Générés par Vigie" valeur={donnees.documents.length} />
          <Ligne libelle="Externes / EduSign" valeur={donnees.externes.length} />
        </dl>
      </Carte>
    </div>
  );
}
