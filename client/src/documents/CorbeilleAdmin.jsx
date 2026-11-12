import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, ConfirmDialog, Field } from "../ui/index.js";
import { libelleMotif, messageErreur, STATUTS_CORBEILLE } from "./format.js";

// Opérations de corbeille en attente ou bloquées (administrateur). Une opération bloquée
// peut être relancée, ou abandonnée avec un motif écrit. Rien n'est supprimé sur Drive ici.
export function CorbeilleAdmin() {
  const [operations, setOperations] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [retour, setRetour] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const [abandon, setAbandon] = useState(null);
  const [motif, setMotif] = useState("");
  const [erreurMotif, setErreurMotif] = useState(null);

  const charger = useCallback(async () => {
    try {
      setOperations((await api("/api/corbeille/en-attente")).operations);
      setErreur(null);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  async function executer(chemin, options, succes) {
    setEnCours(true);
    setRetour(null);
    try {
      const r = await api(chemin, options);
      setRetour({ ton: "success", texte: succes(r) });
      await charger();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnCours(false);
    }
  }

  function reprendre() {
    return executer("/api/corbeille/reprise", { method: "POST" }, (r) => {
      const confirmees = r.reprises.filter((x) => x.statut === "confirmee").length;
      const bloquees = r.reprises.filter((x) => x.statut === "bloquee").length;
      return `Reprise terminée : ${confirmees} confirmée(s), ${bloquees} bloquée(s), ${r.reprises.length} traitée(s).`;
    });
  }

  function relancer(operation) {
    return executer(`/api/corbeille/operations/${operation.id}/relancer`, { method: "POST" },
      () => "Opération remise en attente : la prochaine reprise la traitera.");
  }

  async function confirmerAbandon() {
    const texte = motif.trim();
    if (!texte) {
      setErreurMotif("Un motif est obligatoire.");
      return;
    }
    const operation = abandon;
    setAbandon(null);
    setMotif("");
    setErreurMotif(null);
    await executer(`/api/corbeille/operations/${operation.id}/abandonner`,
      { method: "POST", body: JSON.stringify({ motif: texte }) },
      () => "Opération abandonnée. Son historique et son motif sont conservés.");
  }

  return (
    <section className="docs-corbeille" aria-labelledby="corbeille-titre">
      <div className="docs-section__entete">
        <h2 id="corbeille-titre">Corbeille : opérations en attente ou bloquées</h2>
        <Button compact onClick={reprendre} disabled={enCours}>Lancer la reprise</Button>
      </div>

      {retour && <Alert ton={retour.ton}>{retour.texte}</Alert>}
      {erreur && <Alert ton="error" titre="Action impossible.">{erreur}</Alert>}

      {operations === null && !erreur && <p className="muted">Chargement…</p>}
      {operations && operations.length === 0 && (
        <p className="muted">Aucune opération de corbeille en attente ou bloquée.</p>
      )}

      {operations && operations.length > 0 && (
        <table className="docs-table">
          <thead>
            <tr>
              <th scope="col">Document</th>
              <th scope="col">Version</th>
              <th scope="col">Statut</th>
              <th scope="col">Motif</th>
              <th scope="col">Tentatives</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {operations.map((op) => {
              const statut = STATUTS_CORBEILLE[op.statut] || { libelle: op.statut, ton: "neutral" };
              return (
                <tr key={op.id}>
                  <td data-label="Document"><Link to={`/documents/${op.document_id}`} className="nowrap">Document n°{op.document_id}</Link></td>
                  <td data-label="Version">n°{op.numero}</td>
                  <td data-label="Statut"><Badge ton={statut.ton}>{statut.libelle}</Badge></td>
                  <td data-label="Motif">
                    {libelleMotif(op.motif) || "—"}
                    {/* Le motif bloquant suffit : l'erreur technique n'est montrée que pour une opération en attente. */}
                    {!op.motif && op.derniere_erreur && <span className="muted small"><br />{op.derniere_erreur}</span>}
                  </td>
                  <td data-label="Tentatives">{op.tentatives}</td>
                  <td className="docs-table__actions">
                    {op.statut === "bloquee" && (
                      <>
                        <Button compact onClick={() => relancer(op)} disabled={enCours}>Relancer</Button>
                        <Button compact variante="danger" onClick={() => { setErreurMotif(null); setAbandon(op); }} disabled={enCours}>
                          Abandonner…
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <ConfirmDialog
        ouvert={!!abandon}
        titre="Abandonner l'opération de corbeille"
        libelleConfirmer="Abandonner"
        enCours={enCours}
        onConfirmer={confirmerAbandon}
        onAnnuler={() => { setAbandon(null); setMotif(""); setErreurMotif(null); }}
      >
        <p>
          La version reste sur Drive, intacte. Sa réservation est levée et une nouvelle demande de mise à la corbeille
          redevient possible. Le motif est conservé dans l'historique.
        </p>
        <Field label="Motif de l'abandon" erreur={erreurMotif}>
          <textarea value={motif} rows={3} maxLength={300} onChange={(e) => { setMotif(e.target.value); setErreurMotif(null); }} />
        </Field>
      </ConfirmDialog>
    </section>
  );
}
