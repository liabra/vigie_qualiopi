import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, EmptyState, Field, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";

// Dictionnaire des variables documentaires : LECTURE SEULE, ouvert à tout utilisateur connecté.
// Source unique : GET /api/documents/variables (catalogue versionné dans le dépôt). Aucune donnée
// personnelle : seulement des définitions (libellé métier, balise {{…}}, description).

const SENSIBILITES = {
  aucune: null,
  personnelle: { libelle: "Donnée personnelle", ton: "warning" },
  restreinte: { libelle: "Accès restreint", ton: "error" },
};
const TYPES = { texte: "Texte", date: "Date", nombre: "Nombre", booleen: "Oui / non", liste: "Liste", bloc: "Bloc" };

const sansAccent = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Recherche : libellé, balise, nom technique, description (casse et accents ignorés).
export function filtrerVariables(variables, recherche) {
  const q = sansAccent(recherche).trim();
  if (!q) return variables;
  return variables.filter((v) => sansAccent(`${v.libelle} ${v.nom} ${v.balise} ${v.description}`).includes(q));
}

// Classement par domaine, dans l'ordre du dictionnaire ; les domaines vides sont omis.
export function grouperParDomaine(variables, domaines) {
  const ordre = Object.keys(domaines);
  return ordre
    .map((cle) => ({ cle, libelle: domaines[cle], variables: variables.filter((v) => v.domaine === cle) }))
    .filter((g) => g.variables.length > 0);
}

function TableVariables({ domaine }) {
  return (
    <table className="sess-table param-table">
      <caption className="visually-hidden">Variables du domaine {domaine.libelle} ({domaine.variables.length})</caption>
      <thead>
        <tr>
          <th scope="col">Libellé</th>
          <th scope="col">Balise</th>
          <th scope="col">Description</th>
          <th scope="col">Type</th>
          <th scope="col">Sensibilité</th>
        </tr>
      </thead>
      <tbody>
        {domaine.variables.map((v) => {
          const sens = SENSIBILITES[v.sensibilite];
          return (
            <tr key={v.nom}>
              <td data-label="Libellé" className="sess-table__principal">{v.libelle}</td>
              <td data-label="Balise"><code className="param-code">{v.balise}</code></td>
              <td data-label="Description">{v.description}</td>
              <td data-label="Type">{TYPES[v.type] || v.type}</td>
              <td data-label="Sensibilité">{sens ? <Badge ton={sens.ton}>{sens.libelle}</Badge> : <span className="sess-secondaire">—</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function VariablesDocumentsPage() {
  useTitrePage("Variables documentaires");
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [recherche, setRecherche] = useState("");

  useEffect(() => {
    let actif = true;
    api("/api/documents/variables")
      .then((r) => { if (actif) setDonnees(r); })
      .catch((e) => { if (actif) setErreur(e.message); });
    return () => { actif = false; };
  }, []);

  const filtrees = useMemo(() => (donnees ? filtrerVariables(donnees.variables, recherche) : []), [donnees, recherche]);
  const domaines = useMemo(() => (donnees ? grouperParDomaine(filtrees, donnees.domaines) : []), [donnees, filtrees]);
  const blocs = useMemo(() => {
    if (!donnees) return [];
    const q = sansAccent(recherche).trim();
    return q ? donnees.blocs.filter((b) => sansAccent(`${b.libelle} ${b.nom}`).includes(q)) : donnees.blocs;
  }, [donnees, recherche]);

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Documents" }, { libelle: "Variables documentaires" }]}
        titre="Variables documentaires"
        description="Les données que Vigie sait insérer dans un document. Écrivez la balise {{…}} dans le modèle Google Docs : elle est remplacée à la génération."
      />
      {erreur && <Alert ton="error" titre="Le dictionnaire n'a pas pu être chargé.">{erreur}</Alert>}
      {!donnees && !erreur && <LoadingState texte="Chargement du dictionnaire…" />}

      {donnees && (
        <>
          <Alert ton="info">
            Dictionnaire v{donnees.version} — {donnees.variables.length} variables, consultation seule. Une balise inconnue empêche la génération du document.
          </Alert>

          <Field label="Rechercher une variable" aide="Par libellé, balise ou description.">
            <input type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Ex. nom du stagiaire, session_date…" />
          </Field>
          <p className="sess-secondaire" role="status">
            {recherche.trim() ? `${filtrees.length} variable(s) trouvée(s) sur ${donnees.variables.length}` : `${donnees.variables.length} variables dans ${domaines.length} domaines`}
          </p>

          {domaines.length === 0 && blocs.length === 0 && (
            <EmptyState titre="Aucune variable ne correspond">Essayez un autre mot, sans tenir compte des accents ni de la casse.</EmptyState>
          )}

          {domaines.map((d) => (
            <section key={d.cle} className="param-section" aria-labelledby={`dom-${d.cle}`}>
              <h2 id={`dom-${d.cle}`} className="param-section__titre">{d.libelle} <span className="sess-secondaire">({d.variables.length})</span></h2>
              <TableVariables domaine={d} />
            </section>
          ))}

          {blocs.length > 0 && (
            <section className="param-section" aria-labelledby="dom-blocs">
              <h2 id="dom-blocs" className="param-section__titre">Blocs répétables <span className="sess-secondaire">({blocs.length})</span></h2>
              <p className="sess-secondaire">Une ligne par élément (séances, évaluations…). Syntaxe : <code className="param-code">{donnees.syntaxe.bloc}</code></p>
              <table className="sess-table param-table">
                <caption className="visually-hidden">Blocs répétables ({blocs.length})</caption>
                <thead>
                  <tr><th scope="col">Bloc</th><th scope="col">Balise d'ouverture</th><th scope="col">Sensibilité</th></tr>
                </thead>
                <tbody>
                  {blocs.map((b) => {
                    const sens = SENSIBILITES[b.sensibilite];
                    return (
                      <tr key={b.nom}>
                        <td data-label="Bloc" className="sess-table__principal">{b.libelle}</td>
                        <td data-label="Balise d'ouverture"><code className="param-code">{`{{#${b.nom}}}`}</code></td>
                        <td data-label="Sensibilité">{sens ? <Badge ton={sens.ton}>{sens.libelle}</Badge> : <span className="sess-secondaire">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </>
  );
}
