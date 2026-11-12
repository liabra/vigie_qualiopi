import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";
import { RechercheDrive } from "../RechercheDrive.jsx";
import { Alert, Badge, Button, ConfirmDialog, Field, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { etatVersion, estVersionCourante, lienDriveSur, messageErreur, peutMettreALaCorbeille } from "./format.js";

const STATUT_PREUVE = { maitrise: "Maîtrisé", a_consolider: "À consolider", a_risque: "À risque", non_applicable: "Non applicable", a_confirmer: "À confirmer" };
const ORIGINE = { manuel: "Rattachement manuel", generation: "Génération", import: "Import du classeur" };

const dateFr = (valeur) => (valeur ? new Date(valeur).toLocaleDateString("fr-FR") : "—");
const succes = (texte) => ({ ton: "success", texte });

// /documents/:documentId : fiche d'un document. Un contributeur voit les liens, formations et
// preuves qui lui sont accessibles ; les versions et les actions sont réservées à l'administrateur.
// Le serveur reste seul juge : chaque action renvoie son résultat ou son erreur, affichés tels quels.
export function DocumentFiche({ admin }) {
  const { documentId } = useParams();
  const [fiche, setFiche] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [retour, setRetour] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [preuves, setPreuves] = useState([]);
  const [formations, setFormations] = useState([]);
  const [choixPreuve, setChoixPreuve] = useState("");
  const [choixFormation, setChoixFormation] = useState("");
  useTitrePage(fiche?.document.drive_nom || "Document");

  const charger = useCallback(async () => {
    try {
      setFiche(await api(`/api/documents/${documentId}`));
      setErreur(null);
    } catch (e) {
      setFiche(null);
      setErreur(messageErreur(e));
    }
  }, [documentId]);
  useEffect(() => { charger(); }, [charger]);

  useEffect(() => {
    if (!admin) return;
    api("/api/preuves").then((r) => setPreuves(r.preuves)).catch(() => setPreuves([]));
    api("/api/formations").then((r) => setFormations(r.formations)).catch(() => setFormations([]));
  }, [admin]);

  // Exécute une action serveur : succès = message + rechargement ; échec = message lisible.
  async function agir(chemin, { methode = "POST", corps, succes: enSucces }) {
    setEnCours(true);
    setRetour(null);
    try {
      const r = await api(chemin, { method: methode, body: corps === undefined ? undefined : JSON.stringify(corps) });
      setRetour(enSucces(r));
      await charger();
    } catch (e) {
      setRetour({ ton: "error", texte: messageErreur(e) });
    } finally {
      setEnCours(false);
    }
  }

  if (erreur) {
    return (
      <>
        <PageHeader fil={[{ libelle: "Qualité" }, { libelle: "Documents", to: "/documents" }, { libelle: "Document" }]} titre="Document" />
        <Alert ton="error" titre="Ce document n'est pas disponible." action={<Button compact to="/documents">Retour à la liste</Button>}>
          {erreur}
        </Alert>
      </>
    );
  }
  if (!fiche) return <LoadingState texte="Chargement du document…" />;

  const { document: d, liens, formations: rattachees, versions } = fiche;
  const titre = d.drive_nom || `Document n°${d.id}`;
  const lien = lienDriveSur(d.drive_url);
  const aRevalider = liens.filter((l) => l.en_attente_revalidation).length;
  const dejaLiees = new Set(liens.map((l) => l.preuve_id));
  const dejaRattachees = new Set(rattachees.map((f) => f.formation_id));

  const revaliderLien = (l) => agir(`/api/preuves/${l.preuve_id}/documents/${d.id}/revalider`, {
    succes: () => succes("Lien revalidé : la preuve examine désormais la version courante."),
  });

  const demanderDetachementLien = (l) => setConfirmation({
    titre: "Détacher la preuve",
    libelle: "Détacher",
    corps: <p>Le lien entre « {l.titre} » et ce document est retiré. Le document et ses versions sont conservés.</p>,
    action: () => agir(`/api/preuves/${l.preuve_id}/documents/${d.id}`, {
      methode: "DELETE",
      succes: () => succes("Lien détaché. Le document et ses versions sont conservés."),
    }),
  });

  const rattacherPreuve = async () => {
    const preuve = choixPreuve;
    await agir(`/api/preuves/${preuve}/documents`, {
      corps: { document_id: d.id },
      succes: () => succes("Document rattaché à la preuve."),
    });
    setChoixPreuve("");
  };

  const rattacherFormation = async () => {
    const formation = choixFormation;
    await agir(`/api/documents/${d.id}/formations`, {
      corps: { formation_id: Number(formation) },
      succes: () => succes("Document rattaché à la formation. Sa validation reste à faire."),
    });
    setChoixFormation("");
  };

  const validerFormation = (f) => agir(`/api/documents/${d.id}/formations/${f.formation_id}/valider`, {
    succes: () => succes("Rattachement validé."),
  });

  const demanderDetachementFormation = (f) => setConfirmation({
    titre: "Détacher la formation",
    libelle: "Détacher",
    corps: <p>Le document n'est plus rattaché à « {f.intitule} ». Le document n'est pas supprimé.</p>,
    action: () => agir(`/api/documents/${d.id}/formations/${f.formation_id}`, {
      methode: "DELETE",
      succes: () => succes("Formation détachée."),
    }),
  });

  const demanderCorbeille = (v) => setConfirmation({
    titre: `Mettre la version n°${v.numero} à la corbeille`,
    libelle: "Mettre à la corbeille",
    corps: <p>Le fichier de cette ancienne version est déplacé dans la corbeille Drive. Aucune autre version n'est modifiée.</p>,
    action: () => agir(`/api/documents/${d.id}/versions/${v.numero}/corbeille`, {
      corps: { confirmer: true },
      succes: (r) => (r.statut === "en_attente_confirmation"
        ? { ton: "warning", texte: messageErreur({ code: "corbeille_confirmation_en_attente" }) }
        : succes(`Version n°${v.numero} mise à la corbeille.`)),
    }),
  });

  const demanderRemplacement = (fichier) => setConfirmation({
    titre: "Remplacer le fichier",
    libelle: "Remplacer",
    corps: <p>« {fichier.nom} » devient la nouvelle version courante. L'ancienne version est conservée.</p>,
    action: () => agir(`/api/documents/${d.id}/remplacer`, {
      corps: { drive_file_id: fichier.id, drive_url: fichier.url, drive_nom: fichier.nom, version_attendue: d.version_courante },
      succes: () => succes("Fichier remplacé : une nouvelle version courante est en place."),
    }),
  });

  const demanderArchivage = () => setConfirmation({
    titre: "Archiver le document",
    libelle: "Archiver",
    corps: <p>Le document ne pourra plus être rattaché ni remplacé. Il reste consultable et peut être restauré.</p>,
    action: () => agir(`/api/documents/${d.id}/archiver`, { succes: () => succes("Document archivé.") }),
  });

  const restaurer = () => agir(`/api/documents/${d.id}/restaurer`, { succes: () => succes("Document restauré.") });

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Qualité" }, { libelle: "Documents", to: "/documents" }, { libelle: titre }]}
        titre={titre}
      />

      <div className="docs-badges">
        {d.confidentiel && <Badge ton="warning">Confidentiel</Badge>}
        {d.archive_le && <Badge ton="neutral">Archivé le {dateFr(d.archive_le)}</Badge>}
        <Badge ton="success">Version courante n°{d.version_courante}</Badge>
        {aRevalider > 0 && <Badge ton="warning">{aRevalider} lien(s) à revalider</Badge>}
      </div>

      {retour && <Alert ton={retour.ton}>{retour.texte}</Alert>}

      <section className="docs-section" aria-labelledby="fichier-titre">
        <h2 id="fichier-titre">Fichier</h2>
        {lien
          ? <a href={lien} target="_blank" rel="noopener noreferrer">Ouvrir dans Drive (nouvel onglet)</a>
          : <span className="muted">Lien Drive indisponible.</span>}
      </section>

      <section className="docs-section" aria-labelledby="liens-titre">
        <h2 id="liens-titre">Preuves liées</h2>
        {liens.length === 0 ? (
          <p className="muted">Aucune preuve accessible n'est liée à ce document.</p>
        ) : (
          <table className="docs-table">
            <thead>
              <tr>
                <th scope="col">Preuve</th>
                <th scope="col">Indicateur</th>
                <th scope="col">Statut</th>
                <th scope="col">Origine</th>
                <th scope="col">Revalidation</th>
                {admin && <th scope="col"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {liens.map((l) => (
                <tr key={l.preuve_id}>
                  <td data-label="Preuve">{l.titre}</td>
                  <td data-label="Indicateur">{l.indicateur}</td>
                  <td data-label="Statut">{STATUT_PREUVE[l.statut] || l.statut}</td>
                  <td data-label="Origine">{ORIGINE[l.origine] || l.origine}</td>
                  <td data-label="Revalidation">
                    {l.en_attente_revalidation
                      ? <Badge ton="warning">À revalider</Badge>
                      : <Badge ton="success">À jour</Badge>}
                  </td>
                  {admin && (
                    <td className="docs-table__actions">
                      {l.en_attente_revalidation && (
                        <Button compact onClick={() => revaliderLien(l)} disabled={enCours}>Revalider</Button>
                      )}
                      <Button compact variante="ghost" onClick={() => demanderDetachementLien(l)} disabled={enCours}>Détacher</Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {admin && (
          <div className="docs-ajout">
            <Field label="Rattacher à une preuve">
              <select value={choixPreuve} onChange={(e) => setChoixPreuve(e.target.value)}>
                <option value="">Choisir une preuve…</option>
                {preuves.filter((p) => !dejaLiees.has(p.id)).map((p) => (
                  <option key={p.id} value={p.id}>{p.titre}</option>
                ))}
              </select>
            </Field>
            <Button compact onClick={rattacherPreuve} disabled={!choixPreuve || enCours}>Rattacher</Button>
          </div>
        )}
      </section>

      <section className="docs-section" aria-labelledby="formations-titre">
        <h2 id="formations-titre">Formations</h2>
        {rattachees.length === 0 ? (
          <p className="muted">Ce document n'est rattaché à aucune formation.</p>
        ) : (
          <ul className="docs-liste">
            {rattachees.map((f) => (
              <li key={f.formation_id} className="docs-liste__ligne">
                <span>{f.intitule}</span>
                <span className="docs-liste__badges">
                  {f.valide ? <Badge ton="success">Validée</Badge> : <Badge ton="warning">À valider</Badge>}
                  {admin && !f.valide && (
                    <Button compact onClick={() => validerFormation(f)} disabled={enCours}>Valider</Button>
                  )}
                  {admin && (
                    <Button compact variante="ghost" onClick={() => demanderDetachementFormation(f)} disabled={enCours}>Détacher</Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {admin && (
          <div className="docs-ajout">
            <Field label="Rattacher à une formation">
              <select value={choixFormation} onChange={(e) => setChoixFormation(e.target.value)}>
                <option value="">Choisir une formation…</option>
                {formations.filter((f) => !dejaRattachees.has(f.id)).map((f) => (
                  <option key={f.id} value={f.id}>{f.intitule}</option>
                ))}
              </select>
            </Field>
            <Button compact onClick={rattacherFormation} disabled={!choixFormation || enCours}>Rattacher</Button>
          </div>
        )}
      </section>

      {admin && versions && (
        <section className="docs-section" aria-labelledby="versions-titre">
          <h2 id="versions-titre">Versions</h2>
          <table className="docs-table">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Fichier</th>
                <th scope="col">État</th>
                <th scope="col">Introduite le</th>
                <th scope="col">Remplacée le</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const etat = etatVersion(v, d);
                return (
                  <tr key={v.numero} aria-current={estVersionCourante(v, d) ? "true" : undefined}>
                    <td>n°{v.numero}</td>
                    <td data-label="Fichier">{v.drive_nom || v.drive_file_id}</td>
                    <td data-label="État"><Badge ton={etat.ton}>{etat.libelle}</Badge></td>
                    <td data-label="Introduite le">{dateFr(v.introduite_le)}</td>
                    <td data-label="Remplacée le">{dateFr(v.remplacee_le)}</td>
                    <td className="docs-table__actions">
                      {peutMettreALaCorbeille(v, d) && (
                        <Button compact variante="ghost" onClick={() => demanderCorbeille(v)} disabled={enCours}>Mettre à la corbeille</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {admin && (
        <section className="docs-section" aria-labelledby="gestion-titre">
          <h2 id="gestion-titre">Gestion du document</h2>
          {!d.archive_le && (
            <>
              <p className="muted small">Remplacer par un autre fichier du Drive : il devient la version courante.</p>
              <RechercheDrive
                placeholder="Remplacer par un fichier du Drive"
                surChoix={demanderRemplacement}
                onErreur={(texte) => setRetour({ ton: "error", texte })}
              />
            </>
          )}
          <div className="docs-actions">
            {!d.archive_le ? (
              <Button compact onClick={demanderArchivage} disabled={enCours || liens.length > 0}>Archiver</Button>
            ) : (
              <Button compact onClick={restaurer} disabled={enCours}>Restaurer</Button>
            )}
            {!d.archive_le && liens.length > 0 && (
              <span className="muted small">Détachez les preuves avant d'archiver.</span>
            )}
          </div>
        </section>
      )}

      <ConfirmDialog
        ouvert={!!confirmation}
        titre={confirmation?.titre}
        libelleConfirmer={confirmation?.libelle}
        enCours={enCours}
        onConfirmer={async () => {
          const c = confirmation;
          setConfirmation(null);
          await c.action();
        }}
        onAnnuler={() => setConfirmation(null)}
      >
        {confirmation?.corps}
      </ConfirmDialog>
    </>
  );
}
