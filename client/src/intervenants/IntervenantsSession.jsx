import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Alert, Badge, Button, Drawer, EmptyState, Field, LoadingState } from "../ui/index.js";
import { FONCTIONS_INTERVENANT, filtrerIntervenants, nomComplet } from "./format.js";

// Bloc « Intervenants » d'une session (onglet Stagiaires) : intervenants
// rattachés à la session et à chaque groupe, avec le formateur saisi
// AVANT l'annuaire (texte historique, jamais modifié). L'admin rattache
// une fiche explicitement — jamais de fusion sur la ressemblance des noms.
export function IntervenantsSession({ sessionId, admin, archivee, notifier }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [choix, setChoix] = useState(null); // { groupe: null | {id, nom}, recherche }
  const [erreurAction, setErreurAction] = useState(null);
  const verrou = useRef(false);
  const charger = useCallback(async () => {
    try { setD(await api(`/api/sessions/${sessionId}/intervenants`)); setErr(null); }
    catch (e) { setErr(e.message); }
  }, [sessionId]);
  useEffect(() => { charger(); }, [charger]);

  const modifiable = admin && !archivee && !d?.archivee;
  const chemin = (groupe) => (groupe ? `/api/sessions/${sessionId}/groupes/${groupe.id}/intervenants` : `/api/sessions/${sessionId}/intervenants`);

  async function retirer(groupe, i) {
    if (verrou.current) return;
    verrou.current = true; setErreurAction(null);
    try { setD(await api(`${chemin(groupe)}/${i.id}`, { method: "DELETE" })); }
    catch (e) { setErreurAction(e.message); } finally { verrou.current = false; }
  }

  if (err) return <Alert ton="error" titre="Les intervenants n'ont pas pu être chargés." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>;
  if (!d) return <LoadingState texte="Chargement des intervenants…" />;

  const bloc = (titre, groupe, rattaches, historique) => {
    const formateurRattache = rattaches.some((i) => i.fonction === "formateur");
    return (
      <div className="qualite-fiche" key={groupe ? `g${groupe.id}` : "session"}>
        <h3 className="accompagnement-sections__titre">{titre}</h3>
        {historique && (
          <p className="sess-secondaire">
            Formateur saisi (historique) : « {historique} »{formateurRattache ? " — remplacé dans les documents par les formateurs rattachés." : " — utilisé tel quel dans les documents."}
            {modifiable && !formateurRattache && <> <Button compact variante="ghost" onClick={() => setChoix({ groupe, recherche: historique })} aria-label={`Rapprocher « ${historique} » d'une fiche de l'annuaire`}>Rapprocher d'une fiche</Button></>}
          </p>
        )}
        {rattaches.length === 0 ? <p className="sess-secondaire">Aucun intervenant rattaché.</p> : (
          <ul className="adaptations-liste" aria-label={`Intervenants — ${titre}`}>
            {rattaches.map((i) => (
              <li key={i.id} className="suivi-inscription">
                <strong>{nomComplet(i)}</strong>
                <Badge ton="neutral">{FONCTIONS_INTERVENANT[i.fonction] || i.fonction}</Badge>
                {!i.actif && <Badge ton="warning">Inactif</Badge>}
                {modifiable && <Button compact variante="ghost" onClick={() => retirer(groupe, i)} aria-label={`Retirer ${nomComplet(i)} — ${titre}`}>Retirer</Button>}
              </li>
            ))}
          </ul>
        )}
        {modifiable && <Button compact onClick={() => setChoix({ groupe, recherche: "" })} aria-label={`Ajouter un intervenant — ${titre}`}>Ajouter un intervenant</Button>}
      </div>
    );
  };

  return (
    <section className="sess-section" aria-labelledby="titre-intervenants">
      <div className="sess-section__tete">
        <h2 id="titre-intervenants" className="sess-section__titre">Intervenants</h2>
      </div>
      {erreurAction && <Alert ton="error" titre="Le rattachement n'a pas été modifié.">{erreurAction}</Alert>}
      {bloc("Session", null, d.session, d.historique.session)}
      {d.historique.groupes.map((g) => bloc(`Groupe ${g.nom}`, g, d.groupes[g.id] || [], g.formateur))}
      {choix && (
        <DrawerChoix sessionId={sessionId} cible={choix} deja={(choix.groupe ? d.groupes[choix.groupe.id] : d.session) || []} chemin={chemin(choix.groupe)}
          onFermer={() => setChoix(null)}
          onFait={(r, i) => { setD(r); setChoix(null); notifier?.({ ton: "success", titre: `${nomComplet(i)} rattaché(e) — ${choix.groupe ? `groupe ${choix.groupe.nom}` : "session"}.` }); }} />
      )}
    </section>
  );
}

// Choix explicite d'une fiche ACTIVE de l'annuaire (recherche locale).
function DrawerChoix({ cible, deja, chemin, onFermer, onFait }) {
  const [liste, setListe] = useState(null);
  const [q, setQ] = useState(cible.recherche || "");
  const [erreur, setErreur] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const verrou = useRef(false);
  useEffect(() => { api("/api/intervenants?actif=true").then((r) => setListe(r.intervenants)).catch((e) => setErreur(e.message)); }, []);
  const ids = new Set(deja.map((i) => i.id));
  const proposes = liste ? filtrerIntervenants(liste, { q, statut: "actifs" }).filter((i) => !ids.has(i.id)) : [];

  async function rattacher(i) {
    if (verrou.current) return; // fix : jamais de double rattachement
    verrou.current = true; setEnCours(true); setErreur(null);
    try { onFait(await api(chemin, { method: "POST", body: JSON.stringify({ intervenant_id: i.id }) }), i); }
    catch (e) { setErreur(e.message); } finally { verrou.current = false; setEnCours(false); }
  }

  return (
    <Drawer ouvert onFermer={onFermer} fermable={!enCours} titre="Rattacher un intervenant"
      description={cible.groupe ? `Groupe ${cible.groupe.nom}` : "Session"}
      pied={<Button onClick={onFermer} disabled={enCours}>Fermer</Button>}>
      <div className="ui-form">
        {cible.recherche && <Alert ton="info">Recherche pré-remplie avec le formateur saisi « {cible.recherche} ». Choisissez vous-même la bonne fiche : rien n'est rapproché automatiquement, et le texte historique reste inchangé.</Alert>}
        {erreur && <Alert ton="error" titre="Rattachement impossible.">{erreur}</Alert>}
        <Field label="Rechercher dans l'annuaire"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        {!liste && !erreur && <LoadingState texte="Chargement de l'annuaire…" />}
        {liste && (proposes.length === 0 ? (
          <EmptyState titre="Aucune fiche correspondante">Créez la fiche dans le menu Formation › Intervenants, puis revenez la rattacher.</EmptyState>
        ) : (
          <ul className="adaptations-liste" aria-label="Fiches proposées">
            {proposes.map((i) => (
              <li key={i.id} className="suivi-inscription">
                <strong>{nomComplet(i)}</strong>
                <Badge ton="neutral">{FONCTIONS_INTERVENANT[i.fonction] || i.fonction}</Badge>
                {i.domaines?.length > 0 && <span className="sess-secondaire">{i.domaines.join(", ")}</span>}
                <Button compact variante="primary" disabled={enCours} onClick={() => rattacher(i)} aria-label={`Rattacher ${nomComplet(i)}`}>Rattacher</Button>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </Drawer>
  );
}
