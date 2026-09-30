import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, EmptyState, Field, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { useTexteUrl } from "../ui/useTexteUrl.js";
import { formaterDate } from "../sessions/format.js";
import { indicateursCompacts, indicateursPresents } from "./format.js";
import {
  SEGMENTS_SIGNALEMENT, STATUTS_SIGNALEMENT, TYPES_SIGNALEMENT,
  compteursSignalements, compterSegmentsSignalements, estEnRetardReclamation,
  filtrerSignalements,
} from "./signalements-format.js";

// /signalements-qualite : la LISTE (vue de pilotage, admin uniquement).
// Aucune donnée réclamant n'est affichée, même pour l'admin. Segment et
// filtres vivent dans l'URL, filtrage client sur la liste complète
// (GET ?etat=tous), comme les Actions qualité.
export function SignalementsListe() {
  useTitrePage("Signalements");
  const [params, setParams] = useSearchParams();
  const segment = SEGMENTS_SIGNALEMENT.some((s) => s.id === params.get("etat")) ? params.get("etat") : "actifs";
  const [q, setQ] = useTexteUrl("q");
  const filtres = {
    type: params.get("type") || "",
    statut: params.get("statut") || "",
    formation: params.get("formation") || "",
    session: params.get("session") || "",
    responsable: params.get("responsable") || "",
    indicateur: params.get("ind") || "",
    q,
  };

  const [signalements, setSignalements] = useState(null);
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [formations, setFormations] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [err, setErr] = useState(null);

  const charger = useCallback(async () => {
    try {
      const [s, u, f, s1, s2] = await Promise.all([
        api("/api/signalements?etat=tous"),
        api("/api/utilisateurs").catch(() => ({ utilisateurs: [] })),
        api("/api/formations").catch(() => ({ formations: [] })),
        api("/api/sessions").catch(() => ({ sessions: [] })),
        api("/api/sessions?etat=archivees").catch(() => ({ sessions: [] })),
      ]);
      setSignalements(s.signalements);
      setUtilisateurs(u.utilisateurs || []);
      setFormations(f.formations || []);
      setSessions([...(s1.sessions || []), ...(s2.sessions || [])]);
      setErr(null);
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { charger(); }, [charger]);

  function changer(cle, valeur) {
    setParams((courants) => {
      const p = new URLSearchParams(courants);
      if (valeur && !(cle === "etat" && valeur === "actifs")) p.set(cle, valeur); else p.delete(cle);
      return p;
    });
  }
  function reinitialiser() {
    // Efface TOUTE l'URL d'un coup. Le champ de recherche local se
    // resynchronise seul via useTexteUrl (ne pas re-appeler setQ ici :
    // son setParams fonctionnel relirait les anciens paramètres et
    // réappliquerait un filtre qu'on vient d'effacer).
    setParams(new URLSearchParams());
  }

  const formationParId = Object.fromEntries(formations.map((f) => [f.id, f.intitule]));
  const sessionParId = Object.fromEntries(sessions.map((s) => [s.id, s]));
  const responsableParId = Object.fromEntries(utilisateurs.map((u) => [u.id, u.nom || u.email]));

  const affichees = signalements ? filtrerSignalements(signalements, { segment, ...filtres }) : [];
  const compteurs = signalements ? compteursSignalements(signalements) : {};
  const segmentsComptes = signalements ? compterSegmentsSignalements(signalements) : {};
  const filtresActifs = filtres.type || filtres.statut || filtres.formation || filtres.session || filtres.responsable || filtres.indicateur || filtres.q;

  const responsibles = signalements ? [...new Set(signalements.map((s) => s.responsable_id).filter(Boolean))].map((id) => ({ id, nom: responsableParId[id] || `#${id}` })) : [];
  const formationsFiltrables = signalements ? [...new Set(signalements.map((s) => s.formation_id).filter(Boolean))] : [];
  const sessionsFiltrables = signalements ? [...new Set(signalements.map((s) => s.session_id).filter(Boolean))] : [];

  const tuiles = [
    { cle: "a_traiter", n: compteurs.a_traiter || 0, libelle: "À traiter" },
    { cle: "en_retard", n: compteurs.en_retard || 0, libelle: "En retard" },
    { cle: "resolues", n: compteurs.resolues || 0, libelle: "Résolues" },
    { cle: "cloturees", n: compteurs.cloturees || 0, libelle: "Clôturées" },
  ];

  return (
    <>
      <PageHeader
        fil={[{ libelle: "Qualité" }, { libelle: "Signalements" }]}
        titre="Signalements"
        description="Réclamations, incidents et non-conformités : suivez leur traitement, sans exposer les données du réclamant."
      />
      {err && <Alert ton="error" titre="Les signalements n'ont pas pu être chargés." action={<Button compact onClick={charger}>Réessayer</Button>}>{err}</Alert>}
      {!signalements && !err && <LoadingState texte="Chargement des signalements…" />}

      {signalements && signalements.length === 0 && (
        <EmptyState titre="Aucun signalement pour le moment.">
          Les réclamations, incidents et non-conformités apparaîtront ici.
        </EmptyState>
      )}

      {signalements && signalements.length > 0 && (
        <section className="qualite-liste" aria-label="Liste des signalements">
          <div className="qualite-compteurs" role="group" aria-label="Compteurs">
            {tuiles.map((t) => (
              <div key={t.cle} className="qualite-compteur">
                <span className="qualite-compteur__n">{t.n}</span>
                <span className="qualite-compteur__l">{t.libelle}</span>
              </div>
            ))}
          </div>

          <div className="sess-vues" role="group" aria-label="État des signalements">
            {SEGMENTS_SIGNALEMENT.map((s) => (
              <button key={s.id} type="button" aria-pressed={segment === s.id}
                className={"sess-vue" + (segment === s.id ? " sess-vue--active" : "")} onClick={() => changer("etat", s.id)}>
                {s.libelle} <span className="sess-vue__compteur">{segmentsComptes[s.id]}</span>
              </button>
            ))}
          </div>

          <div className="veille-filtres">
            <Field label="Rechercher" className="veille-filtres__recherche">
              <input type="search" value={filtres.q} placeholder="Référence ou objet" onChange={(e) => setQ(e.target.value)} />
            </Field>
            <Field label="Type">
              <select value={filtres.type} onChange={(e) => changer("type", e.target.value)}>
                <option value="">Tous les types</option>
                {Object.entries(TYPES_SIGNALEMENT).map(([k, t]) => <option key={k} value={k}>{t.libelle}</option>)}
              </select>
            </Field>
            <Field label="Statut">
              <select value={filtres.statut} onChange={(e) => changer("statut", e.target.value)}>
                <option value="">Tous les statuts</option>
                {Object.entries(STATUTS_SIGNALEMENT).map(([k, s]) => <option key={k} value={k}>{s.libelle}</option>)}
              </select>
            </Field>
            <Field label="Responsable">
              <select value={filtres.responsable} onChange={(e) => changer("responsable", e.target.value)}>
                <option value="">Tous</option>
                {responsibles.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
              </select>
            </Field>
            <Field label="Formation">
              <select value={filtres.formation} onChange={(e) => changer("formation", e.target.value)}>
                <option value="">Toutes</option>
                {formationsFiltrables.map((fid) => <option key={fid} value={fid}>{formationParId[fid] || `Formation ${fid}`}</option>)}
              </select>
            </Field>
            <Field label="Session">
              <select value={filtres.session} onChange={(e) => changer("session", e.target.value)}>
                <option value="">Toutes les sessions</option>
                {sessionsFiltrables.map((sid) => <option key={sid} value={sid}>{sessionParId[sid]?.reference || `Session ${sid}`}</option>)}
              </select>
            </Field>
            <Field label="Indicateur">
              <select value={filtres.indicateur} onChange={(e) => changer("ind", e.target.value)}>
                <option value="">Tous les indicateurs</option>
                {indicateursPresents(signalements).map((i) => <option key={i.id} value={i.id}>Indicateur {i.numero} — {i.libelle}</option>)}
              </select>
            </Field>
          </div>

          {filtresActifs && (
            <div className="qualite-reset">
              <Button compact onClick={reinitialiser}>Réinitialiser les filtres</Button>
            </div>
          )}

          <p className="sess-secondaire">Échéance réclamation : indicative, calculée en jours ouvrés (lundi à vendredi).</p>

          {affichees.length === 0 ? (
            <EmptyState titre="Aucun signalement ne correspond à ces filtres." action={<Button onClick={reinitialiser}>Effacer les filtres</Button>} />
          ) : (
            <table className="sess-table qualite-table">
              <caption className="visually-hidden">Signalements ({affichees.length})</caption>
              <thead>
                <tr>
                  <th scope="col">Signalement</th>
                  <th scope="col">Date</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Responsable</th>
                  <th scope="col">Contexte</th>
                  <th scope="col">Échéance</th>
                  <th scope="col">Indicateurs</th>
                </tr>
              </thead>
              <tbody>
                {affichees.map((s) => {
                  const ty = TYPES_SIGNALEMENT[s.type] || { libelle: s.type, ton: "neutral" };
                  const st = STATUTS_SIGNALEMENT[s.statut] || { libelle: s.statut, ton: "neutral" };
                  const retard = estEnRetardReclamation(s);
                  const ind = indicateursCompacts(s.indicateurs);
                  const session = s.session_id ? sessionParId[s.session_id] : null;
                  const formation = session?.formation || formationParId[s.formation_id] || null;
                  return (
                    <tr key={s.id}>
                      <td data-label="Signalement" className="sess-table__principal">
                        <span className="sess-principal">{s.objet}</span>
                        <span className="sess-secondaire">{s.reference}</span>
                        <span className="sess-secondaire">{ty.libelle}</span>
                        {retard && <Badge ton="error">En retard</Badge>}
                      </td>
                      <td data-label="Date">{formaterDate(s.date_constat) || <span className="sess-secondaire">—</span>}</td>
                      <td data-label="Statut"><Badge ton={st.ton}>{st.libelle}</Badge></td>
                      <td data-label="Responsable">{responsableParId[s.responsable_id] || <span className="sess-secondaire">—</span>}</td>
                      <td data-label="Contexte">
                        {session ? `${session.reference}${session.archivee_le ? " (archivée)" : ""}` : (formation || <span className="sess-secondaire">—</span>)}
                      </td>
                      <td data-label="Échéance">
                        {s.type === "reclamation" ? (formaterDate(s.date_echeance_cible) || <span className="sess-secondaire">—</span>) : <span className="sess-secondaire">—</span>}
                      </td>
                      <td data-label="Indicateurs">
                        {ind.tous.length === 0 ? <span className="sess-secondaire">—</span> : (
                          <span aria-label={`Indicateurs ${ind.tous.join(", ")}`}>Ind. {ind.visibles.join(", ")}{ind.reste > 0 && ` +${ind.reste}`}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}

// Placeholder neutre pour /signalements-qualite/:id : la fiche détaillée
// arrive au lot suivant (Q1-B3-B2). Aucun lien ne pointe vers cette route.
export function SignalementBientot() {
  useTitrePage("Signalement");
  return (
    <>
      <PageHeader
        fil={[{ libelle: "Qualité" }, { libelle: "Signalements", to: "/signalements-qualite" }, { libelle: "Signalement" }]}
        titre="Signalement"
      />
      <EmptyState titre="La fiche détaillée arrive au prochain lot." action={<Button to="/signalements-qualite">Voir les signalements</Button>}>
        Le suivi détaillé d'un signalement (causes, traitement, réponse, indicateurs, historique) sera disponible prochainement.
      </EmptyState>
    </>
  );
}
