import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, EmptyState, Field, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { useTexteUrl } from "../ui/useTexteUrl.js";
import { CorbeilleAdmin } from "./CorbeilleAdmin.jsx";
import { messageErreur } from "./format.js";

// /documents : les documents visibles pour le rôle. Le serveur filtre déjà (un contributeur ne
// voit jamais un document confidentiel ni un document partagé avec une preuve confidentielle).
export function DocumentsListe({ admin }) {
  useTitrePage("Documents");
  const [q, setQ] = useTexteUrl("q");
  const [documents, setDocuments] = useState(null);
  const [erreur, setErreur] = useState(null);

  const charger = useCallback(async () => {
    try {
      setDocuments((await api("/api/documents")).documents);
      setErreur(null);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const recherche = q.trim().toLowerCase();
  const affiches = documents?.filter((d) => !recherche || (d.drive_nom || "").toLowerCase().includes(recherche)) ?? [];

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Qualité" }, { libelle: "Documents" }]}
        titre="Documents"
        description="Documents partagés entre les preuves et les formations"
      />

      {erreur && (
        <Alert ton="error" titre="Les documents n'ont pas pu être chargés." action={<Button compact onClick={charger}>Réessayer</Button>}>
          {erreur}
        </Alert>
      )}
      {!documents && !erreur && <LoadingState texte="Chargement des documents…" />}

      {documents && documents.length === 0 && (
        <EmptyState titre="Aucun document">
          {admin
            ? "Les documents apparaissent ici dès qu'un fichier est rattaché à une preuve ou généré depuis une session."
            : "Aucun document n'est accessible avec vos droits pour le moment."}
        </EmptyState>
      )}

      {documents && documents.length > 0 && (
        <>
          <Field label="Rechercher par nom">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
          {affiches.length === 0 ? (
            <p className="muted">Aucun document ne correspond à cette recherche.</p>
          ) : (
            <ul className="docs-liste" aria-label="Liste des documents">
              {affiches.map((d) => (
                <li key={d.id} className="docs-liste__ligne">
                  <Link to={`/documents/${d.id}`} className="docs-liste__nom">{d.drive_nom || `Document n°${d.id}`}</Link>
                  <span className="docs-liste__badges">
                    {d.confidentiel && <Badge ton="warning">Confidentiel</Badge>}
                    {d.archive_le && <Badge ton="neutral">Archivé</Badge>}
                    <span className="muted small">Version n°{d.version_courante} · {d.nb_liens} lien(s)</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {admin && <CorbeilleAdmin />}
    </>
  );
}
