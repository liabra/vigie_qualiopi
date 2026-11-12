import { useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, EmptyState, Field, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { MODES_GENERATION, PORTEES, TYPES_DOCUMENT } from "./Modeles.jsx";

// Inventaire Drive des modèles : LECTURE SEULE. Rien n'est enregistré ni modifié dans Vigie,
// ni sur Drive. Les propositions (type, portée, mode, indicateurs) sont des brouillons à valider.

const ENTETES = [
  "Nom", "Identifiant Drive", "Type de fichier", "Emplacement", "Modifié le", "Déclaré dans Vigie",
  "Classement", "Motifs du classement", "Type proposé", "Portée proposée", "Mode proposé", "Indicateurs proposés (brouillon)", "Lien",
];

const dateFr = (valeur) => (valeur ? new Date(valeur).toLocaleDateString("fr-FR") : "—");
const lienGoogle = (url) => (typeof url === "string" && /^https:\/\/(docs|drive)\.google\.com\//.test(url) ? url : null);
const TYPE_FICHIER = { document: "Google Docs", feuille: "Google Sheets" };

function declarationTexte(d) {
  return `${d.nom} · ${PORTEES[d.portee]?.court || d.portee} · ${d.actif ? "active" : "désactivée"}`;
}

// Export CSV des lignes affichées : un fichier téléchargé côté navigateur, sans appel serveur.
function telechargerCsv(nomFichier, contenu) {
  const blob = new Blob([contenu], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomFichier;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function InventaireDrivePage() {
  useTitrePage("Inventaire Drive des modèles");
  const [inventaire, setInventaire] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [seulementNonDeclares, setSeulementNonDeclares] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [analyses, setAnalyses] = useState({});
  const [analyseEnCours, setAnalyseEnCours] = useState(null);
  const [erreurAnalyse, setErreurAnalyse] = useState(null);
  const [ouverte, setOuverte] = useState(null);

  async function lancer() {
    setChargement(true);
    setErreur(null);
    try {
      setInventaire(await api("/api/inventaire-drive"));
    } catch (e) {
      setErreur(e.message);
      setInventaire(null);
    } finally {
      setChargement(false);
    }
  }

  async function analyser(fichier) {
    setAnalyseEnCours(fichier.id);
    setErreurAnalyse(null);
    try {
      const r = await api("/api/inventaire-drive/diagnostic", { method: "POST", body: JSON.stringify({ drive_file_id: fichier.id }) });
      setAnalyses((a) => ({ ...a, [fichier.id]: r }));
      setOuverte(fichier.id);
    } catch (e) {
      setErreurAnalyse(e.message);
    } finally {
      setAnalyseEnCours(null);
    }
  }

  const fichiers = inventaire?.fichiers || [];
  const filtres = fichiers.filter((f) => {
    if (seulementNonDeclares && f.declarations.length) return false;
    if (recherche.trim() && !f.nom.toLowerCase().includes(recherche.trim().toLowerCase())) return false;
    return true;
  });

  function exporter() {
    const lignes = filtres.map((f) => {
      const a = analyses[f.id];
      const proposition = a?.proposition;
      return [
        f.nom, f.id, TYPE_FICHIER[f.type] || f.type, f.emplacement, dateFr(f.modifie_le),
        f.declarations.length ? f.declarations.map(declarationTexte).join(" | ") : "Non déclaré",
        a ? (a.classement.statut === "utilisable" ? "utilisable" : "correction") : "non analysé",
        a ? a.classement.motifs.join(" ; ") : "",
        proposition ? TYPES_DOCUMENT[proposition.type_document] : "",
        proposition?.portee ? PORTEES[proposition.portee]?.court : (proposition ? "à déterminer" : ""),
        proposition ? MODES_GENERATION[proposition.mode_generation] : "",
        proposition ? proposition.indicateurs.join(", ") : "",
        f.url || "",
      ];
    });
    // Les cellules sont assemblées ici, puis neutralisées par la même règle que côté serveur.
    const echapper = (v) => {
      let t = v === null || v === undefined ? "" : String(v);
      if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
      return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const contenu = "﻿" + [ENTETES, ...lignes].map((l) => l.map(echapper).join(";")).join("\r\n") + "\r\n";
    telechargerCsv("inventaire-modeles-drive.csv", contenu);
  }

  const analyseOuverte = ouverte ? analyses[ouverte] : null;
  const fichierOuvert = ouverte ? fichiers.find((f) => f.id === ouverte) : null;

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Paramètres" }, { libelle: "Inventaire Drive" }]}
        titre="Inventaire Drive des modèles"
        description="Lecture seule : rien n'est enregistré ni modifié, ni dans Vigie, ni sur Google Drive. Les propositions sont à valider."
        actions={<Button variante="primary" onClick={lancer} disabled={chargement}>{inventaire ? "Relancer l'inventaire" : "Lancer l'inventaire"}</Button>}
      />

      {erreur && <Alert ton="error" titre="L'inventaire n'a pas pu être lu.">{erreur}</Alert>}
      {chargement && <LoadingState texte="Lecture du dossier Drive…" />}

      {!inventaire && !chargement && !erreur && (
        <EmptyState titre="Inventaire non lancé">
          Lancez l'inventaire pour lister les Google Docs et Sheets du dossier Vigie, avec leurs déclarations existantes.
        </EmptyState>
      )}

      {inventaire && (
        <>
          {(inventaire.tronque || inventaire.dossiers_non_parcourus > 0) && (
            <Alert ton="warning" titre="Inventaire incomplet.">
              {inventaire.dossiers_non_parcourus > 0
                ? `${inventaire.dossiers_non_parcourus} dossier(s) au-delà de la profondeur maximale n'ont pas été lus. `
                : ""}
              {inventaire.tronque && `Limite de ${inventaire.limite} fichiers atteinte. `}
            </Alert>
          )}

          <div className="docs-ajout">
            <Field label="Rechercher par nom">
              <input type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
            </Field>
            <label className="ui-field">
              <input type="checkbox" checked={seulementNonDeclares} onChange={(e) => setSeulementNonDeclares(e.target.checked)} />{" "}
              Non déclarés seulement
            </label>
            <Button onClick={exporter} disabled={!filtres.length}>Exporter en CSV</Button>
          </div>

          <p className="sess-secondaire">
            {filtres.length} fichier(s) affiché(s) sur {fichiers.length} · racine : {inventaire.racine}
          </p>

          {fichiers.length === 0 && <EmptyState titre="Aucun Google Docs ou Sheets dans le dossier Vigie" />}

          {filtres.length > 0 && (
            <table className="sess-table param-table">
              <caption className="visually-hidden">Fichiers Google du périmètre Vigie ({filtres.length})</caption>
              <thead>
                <tr>
                  <th scope="col">Nom</th>
                  <th scope="col">Type</th>
                  <th scope="col">Emplacement</th>
                  <th scope="col">Modifié le</th>
                  <th scope="col">Déclaré dans Vigie</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filtres.map((f) => (
                  <tr key={f.id}>
                    <td data-label="Nom" className="sess-table__principal">
                      {lienGoogle(f.url) ? <a href={lienGoogle(f.url)} target="_blank" rel="noopener noreferrer">{f.nom}</a> : f.nom}
                      <span className="sess-secondaire">{f.id}</span>
                    </td>
                    <td data-label="Type">{TYPE_FICHIER[f.type] || f.type}</td>
                    <td data-label="Emplacement">{f.emplacement}</td>
                    <td data-label="Modifié le">{dateFr(f.modifie_le)}</td>
                    <td data-label="Déclaré dans Vigie">
                      {f.declarations.length === 0
                        ? <Badge ton="neutral">Non déclaré</Badge>
                        : f.declarations.map((d) => (
                            <span key={d.id} className="sess-secondaire" style={{ display: "block" }}>
                              <Badge ton={d.actif ? "success" : "neutral"}>{d.actif ? "Actif" : "Désactivé"}</Badge> {declarationTexte(d)}
                            </span>
                          ))}
                    </td>
                    <td className="sess-table__actions">
                      <Button compact onClick={() => analyser(f)} disabled={analyseEnCours !== null}
                        aria-label={`Analyser le fichier ${f.nom}`}>
                        {analyseEnCours === f.id ? "Analyse…" : "Analyser"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {erreurAnalyse && <Alert ton="error" titre="Le fichier n'a pas pu être analysé.">{erreurAnalyse}</Alert>}

      {analyseOuverte && fichierOuvert && (
        <section className="param-detail" aria-labelledby="analyse-titre">
          <h2 id="analyse-titre" className="param-section-titre">Analyse : {fichierOuvert.nom}</h2>
          <p>
            <Badge ton={analyseOuverte.classement.statut === "utilisable" ? "success" : "warning"}>
              {analyseOuverte.classement.statut === "utilisable" ? "Utilisable immédiatement" : "Correction requise"}
            </Badge>
          </p>
          {analyseOuverte.classement.motifs.length > 0 && (
            <ul className="param-indicateurs">
              {analyseOuverte.classement.motifs.map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}

          <h3 className="param-section-titre">Marqueurs</h3>
          <dl>
            <div><dt>Reconnus (catalogue canonique)</dt><dd>{analyseOuverte.marqueurs.reconnus.length ? analyseOuverte.marqueurs.reconnus.map((m) => <code key={m}>{`{{${m}}} `}</code>) : "aucun"}</dd></div>
            <div><dt>À migrer (historiques ou alias)</dt><dd>{analyseOuverte.marqueurs.historiques.length ? analyseOuverte.marqueurs.historiques.map((m) => <code key={m}>{`{{${m}}} `}</code>) : "aucun"}</dd></div>
            <div><dt>Inconnus</dt><dd>{analyseOuverte.marqueurs.inconnus.length ? analyseOuverte.marqueurs.inconnus.map((m) => <code key={m}>{`{{${m}}} `}</code>) : "aucun"}</dd></div>
          </dl>

          <h3 className="param-section-titre">Proposition (non enregistrée)</h3>
          <p className="sess-secondaire">Brouillon à valider par un administrateur. Rien n'est enregistré dans Vigie.</p>
          <dl>
            <div><dt>Type de document</dt><dd>{TYPES_DOCUMENT[analyseOuverte.proposition.type_document]}</dd></div>
            <div><dt>Portée</dt><dd>{analyseOuverte.proposition.portee ? PORTEES[analyseOuverte.proposition.portee].long : "À déterminer"}</dd></div>
            <div><dt>Mode de génération</dt><dd>{MODES_GENERATION[analyseOuverte.proposition.mode_generation]}</dd></div>
            <div><dt>Indicateurs Qualiopi suggérés</dt><dd>{analyseOuverte.proposition.indicateurs.length ? `Indicateur(s) ${analyseOuverte.proposition.indicateurs.join(", ")}` : "Aucun suggéré : à déterminer"}</dd></div>
          </dl>
          <ul className="param-indicateurs">
            {analyseOuverte.proposition.motifs.map((m) => <li key={m}>{m}</li>)}
          </ul>
          <Button compact variante="ghost" onClick={() => setOuverte(null)}>Fermer l'analyse</Button>
        </section>
      )}
    </>
  );
}
