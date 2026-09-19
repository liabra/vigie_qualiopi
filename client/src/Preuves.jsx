import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { RechercheDrive } from "./RechercheDrive.jsx";

const STATUTS = {
  maitrise: "Maîtrisé",
  a_consolider: "À consolider",
  a_risque: "À risque",
  non_applicable: "Non applicable",
};

const MODES = {
  unique: "Un seul fichier",
  multiple: "Plusieurs fichiers",
  par_stagiaire: "Un par stagiaire",
};

// Fichiers rattachés, écart au nombre attendu, et réglages du mode.
function Fichiers({ p, actions, admin, sessions }) {
  const multi = p.mode_fichiers !== "unique";
  const attendus = p.fichiers_attendus;
  const session = sessions.find((s) => s.id === p.session_id);

  return (
    <div className="fichiers-preuve">
      {multi && (
        <div className="compte-fichiers">
          <span className={"pill " + (p.incomplet ? "off" : "ok")}>
            {p.nb_fichiers}/{attendus ?? "?"} rattaché(s)
          </span>
          {p.incomplet && <span className="pill warn">Incomplet</span>}
          {p.mode_fichiers === "par_stagiaire" && attendus === null && (
            <span className="muted small">Rattachez une session pour calculer le nombre attendu.</span>
          )}
          {p.mode_fichiers === "par_stagiaire" && attendus !== null && (
            <span className="muted small">
              d'après {session ? `« ${session.reference || session.formation} »` : "la session rattachée"}
              {p.groupe_nom && <>, groupe {p.groupe_nom}</>}
            </span>
          )}
        </div>
      )}

      {p.fichiers.length > 0 ? (
        <ul className="liste-fichiers">
          {p.fichiers.map((f) => (
            <li key={f.id}>
              <a href={f.url} target="_blank" rel="noreferrer">{f.nom || f.drive_file_id}</a>
              {admin && (
                <button className="btn petit danger" onClick={() => actions.retirerFichier(p, f)} aria-label={`Retirer ${f.nom || "ce fichier"}`}>
                  retirer
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small text-erreur">{p.motif_confirmation || "Aucun fichier Drive rattaché"}</p>
      )}

      {admin && (
        <div className="reglages-fichiers">
          <label>
            <span className="muted small">Mode</span>
            <select value={p.mode_fichiers} onChange={(e) => actions.reglage(p, { mode_fichiers: e.target.value })} aria-label="Mode de fichiers">
              {Object.entries(MODES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {multi && (
            <>
              <label>
                <span className="muted small">Session</span>
                <select
                  value={p.session_id ?? ""} aria-label="Session rattachée"
                  onChange={(e) => actions.reglage(p, { session_id: e.target.value ? Number(e.target.value) : null, groupe_id: null })}
                >
                  <option value="">Aucune</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {(s.reference || s.formation)} · {s.nb_inscrits} inscrit(s)
                    </option>
                  ))}
                </select>
              </label>
              {session && session.groupes.length > 0 && (
                <label>
                  <span className="muted small">Groupe</span>
                  <select
                    value={p.groupe_id ?? ""} aria-label="Groupe rattaché"
                    onChange={(e) => actions.reglage(p, { groupe_id: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">Toute la session</option>
                    {session.groupes.map((g) => (
                      <option key={g.id} value={g.id}>{g.nom} · {g.nb_inscrits} inscrit(s)</option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
        </div>
      )}

      {admin && multi && (
        <RechercheDrive
          dejaRattaches={(p.fichiers || []).map((f) => f.drive_file_id)}
          placeholder="Ajouter un fichier du Drive"
          surChoix={(f) => actions.ajouterFichier(p, f)}
          onErreur={actions.erreur}
        />
      )}
    </div>
  );
}

// Contrôles qu'un clic sur la ligne ne doit jamais transformer en sélection :
// liens, boutons, champs, select, et tout ce qu'ils contiennent (candidats
// proposés, formulaire de recherche Drive…).
const CIBLE_INTERACTIVE = "a, button, input, select, label";

const TYPES_ALERTE = {
  revision_periodique: "Révision périodique",
  echeance_fixe: "Échéance fixe",
};
const ALERTE_LIBELLE = { perime: "Périmé", bientot: "Bientôt à revoir" };

// Réglage de l'échéance d'un document permanent (CGV, habilitation,
// contrat…) : révision périodique ou date fixe. La rupture réglementaire
// (liée à la veille) n'a pas encore d'écran, donc pas de contrôle ici.
// Type choisi mais valeur pas encore saisie : état transitoire admis par
// la base (migration 007) et par la vue, qui ne calcule alors aucune
// alerte. Il ne doit surtout pas passer pour un réglage terminé.
const echeanceIncomplete = (p) =>
  (p.type_alerte === "revision_periodique" && !p.periodicite_mois) ||
  (p.type_alerte === "echeance_fixe" && !p.date_echeance);

function Echeance({ p, actions, admin }) {
  if (!admin && !p.type_alerte) return null;
  const incomplete = echeanceIncomplete(p);
  return (
    <div className="fichiers-preuve">
      {p.alerte_statut && p.alerte_statut !== "ok" && (
        <span className={"pill " + (p.alerte_statut === "perime" ? "off" : "warn")}>
          {ALERTE_LIBELLE[p.alerte_statut]}
        </span>
      )}
      {incomplete && <span className="pill warn">Échéance à configurer</span>}
      {admin && (
        <div className="reglages-fichiers">
          <label>
            <span className="muted small">Échéance</span>
            <select
              value={p.type_alerte || ""} aria-label="Type d'échéance"
              onChange={(e) => actions.reglage(p, { type_alerte: e.target.value || null })}
            >
              <option value="">Aucune</option>
              {Object.entries(TYPES_ALERTE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {incomplete && (
            <span className="muted small">
              {p.type_alerte === "revision_periodique"
                ? "Indiquez tous les combien de mois cette preuve doit être revue."
                : "Indiquez la date d'expiration portée sur le document."}
            </span>
          )}
          {p.type_alerte === "revision_periodique" && (
            <>
              <label>
                <span className="muted small">Tous les combien de mois</span>
                <input
                  type="number" min="1" value={p.periodicite_mois || ""} aria-label="Périodicité en mois"
                  onChange={(e) => actions.reglage(p, { periodicite_mois: e.target.value ? Number(e.target.value) : null })}
                />
              </label>
              <span className="muted small">
                Dernière révision : {p.date_derniere_revision ? new Date(p.date_derniere_revision).toLocaleDateString("fr-FR") : "jamais notée"}
              </span>
              <button className="btn petit" onClick={() => actions.reglage(p, { marquer_revise: true })}>
                Marquer révisé aujourd'hui
              </button>
            </>
          )}
          {p.type_alerte === "echeance_fixe" && (
            <label>
              <span className="muted small">Date d'échéance</span>
              <input
                type="date" value={p.date_echeance || ""} aria-label="Date d'échéance"
                onChange={(e) => actions.reglage(p, { date_echeance: e.target.value || null })}
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function LignePreuve({ p, actions, admin, sessions, selectionnee, onBasculerSelection }) {
  function clicLigne(e) {
    if (!admin || e.target.closest(CIBLE_INTERACTIVE)) return;
    onBasculerSelection(p.id);
  }

  return (
    <li
      className={"preuve" + (p.a_confirmer ? " a-confirmer" : "") + (p.incomplet ? " incomplete" : "")
        + (selectionnee ? " selectionnee" : "") + (admin ? " cliquable" : "")}
      onClick={clicLigne}
    >
      <div className="preuve-tete">
        {admin && (
          <input
            type="checkbox" className="case-selection" checked={selectionnee}
            onChange={() => onBasculerSelection(p.id)} aria-label={`Sélectionner « ${p.titre} »`}
          />
        )}
        <span className="ind-num petit" title={`Critère ${p.critere}`}>{p.indicateur}</span>
        <div className="preuve-titre">
          <strong>{p.titre}</strong>
          <div className="muted small">
            {MODES[p.mode_fichiers]}
            {p.etat_source && <> · classeur : « {p.etat_source} »</>}
            {p.occurrences > 1 && <> · {p.occurrences} lignes</>}
          </div>
        </div>
        {admin ? (
          <select value={p.statut} onChange={(e) => actions.statut(p, e.target.value)} aria-label="Statut">
            {Object.entries(STATUTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        ) : <span className={"pill statut-" + p.statut}>{STATUTS[p.statut]}</span>}
      </div>

      {/* Toute cette zone est dédiée aux actions : un clic dans un espace
          entre deux boutons ne doit pas non plus basculer la sélection,
          pas seulement un clic sur un contrôle précis. */}
      <div className="zone-actions" onClick={(e) => e.stopPropagation()}>
        <Fichiers p={p} actions={actions} admin={admin} sessions={sessions} />
        <Echeance p={p} actions={actions} admin={admin} />
        {admin && p.a_confirmer && (
          <>
            {p.mode_fichiers === "unique" && (
              <RechercheDrive
                candidats={p.candidats || []}
                dejaRattaches={(p.fichiers || []).map((f) => f.drive_file_id)}
                surChoix={(f) => actions.lier(p, f)}
                onErreur={actions.erreur}
              />
            )}
            <div className="preuve-actions">
              <button className="btn petit" onClick={() => actions.confirmer(p)}>Confirmer sans fichier</button>
              <button className="btn petit danger" onClick={() => actions.supprimer(p)}>Supprimer</button>
            </div>
          </>
        )}
      </div>
    </li>
  );
}

export default function Preuves({ admin, onChange }) {
  const [data, setData] = useState(null);
  const [filtre, setFiltre] = useState({ a_confirmer: false, statut: "", q: "", alerte: "" });
  const [err, setErr] = useState(null);
  const [dernier, setDernier] = useState(null);
  const [occupe, setOccupe] = useState(null);
  const [apercu, setApercu] = useState(null);
  // Sélection multiple : remise à zéro à chaque nouveau chargement (filtre
  // changé, import relancé), pour ne jamais garder un id qui n'est plus
  // affiché.
  const [selection, setSelection] = useState(() => new Set());
  const [statutMasse, setStatutMasse] = useState("maitrise");
  const [enCours, setEnCours] = useState(false);
  const [sessions, setSessions] = useState([]);

  const charger = useCallback(async () => {
    const p = new URLSearchParams();
    if (filtre.a_confirmer) p.set("a_confirmer", "1");
    if (filtre.statut) p.set("statut", filtre.statut);
    if (filtre.alerte) p.set("alerte", filtre.alerte);
    if (filtre.q.trim()) p.set("q", filtre.q.trim());
    try {
      setData(await api("/api/preuves?" + p));
      setSelection(new Set());
    } catch (e) { setErr(e.message); }
  }, [filtre]);

  useEffect(() => { charger(); }, [charger]);
  useEffect(() => {
    if (admin) api("/api/import/dernier").then((r) => setDernier(r.import)).catch(() => {});
  }, [admin]);
  // Sessions disponibles pour le mode « par stagiaire » : c'est leur
  // nombre d'inscrits qui fixe le nombre de fichiers attendu.
  useEffect(() => {
    api("/api/sessions").then((r) => setSessions(r.sessions)).catch(() => {});
  }, []);

  async function lancerImport(enApercu) {
    setOccupe(enApercu ? "apercu" : "import");
    setErr(null);
    try {
      const r = await api("/api/import/classeur", { method: "POST", body: JSON.stringify({ apercu: enApercu }) });
      if (enApercu) setApercu(r);
      else {
        setApercu(null);
        setDernier(await api("/api/import/dernier").then((x) => x.import));
        await charger();
        onChange?.();
      }
    } catch (e) { setErr(e.message); }
    finally { setOccupe(null); }
  }

  const majLocale = (p, champs) =>
    setData((d) => ({ ...d, preuves: d.preuves.map((x) => (x.id === p.id ? { ...x, ...champs } : x)) }));

  // Une preuve « à risque » qu'on confirme (fichier trouvé ou « sans
  // fichier ») passe à « Maîtrisé » : c'est le serveur qui tranche
  // (RETURNING statut), ceci n'est qu'un affichage immédiat en attendant
  // sa réponse.
  const statutApresConfirmation = (p) => (p.statut === "a_risque" ? "maitrise" : p.statut);

  // Le compte rattaché, le compte attendu et l'écart sont calculés par le
  // serveur : on recopie sa réponse, on ne la recalcule jamais ici.
  const compteurs = (r) =>
    Object.fromEntries(
      ["statut", "statut_effectif", "mode_fichiers", "nb_fichiers", "fichiers_attendus", "incomplet",
        "type_alerte", "periodicite_mois", "date_echeance", "date_derniere_revision", "alerte_statut"]
        .filter((k) => r[k] !== undefined)
        .map((k) => [k, r[k]])
    );

  // Relit une seule ligne, sans recharger la liste : la sélection en cours
  // et la position de défilement ne bougent pas.
  async function rafraichirLigne(p) {
    try {
      const { preuve } = await api(`/api/preuves/${p.id}`);
      setData((d) => ({ ...d, preuves: d.preuves.map((x) => (x.id === preuve.id ? preuve : x)) }));
    } catch { /* la ligne restera telle quelle jusqu'au prochain chargement */ }
  }

  const actions = {
    erreur: setErr,
    async statut(p, statut) {
      majLocale(p, { statut });
      await api(`/api/preuves/${p.id}`, { method: "PATCH", body: JSON.stringify({ statut }) }).catch((e) => setErr(e.message));
      onChange?.();
    },
    async lier(p, f) {
      majLocale(p, {
        fichiers: [{ id: `attente-${f.id}`, drive_file_id: f.id, url: f.url, nom: f.nom, source: "manuel" }],
        a_confirmer: false, statut: statutApresConfirmation(p),
      });
      try {
        const r = await api(`/api/preuves/${p.id}`, {
          method: "PATCH",
          body: JSON.stringify({ drive_file_id: f.id, drive_url: f.url, drive_nom: f.nom, drive_mime: f.mime, confirmer: true }),
        });
        majLocale(p, compteurs(r));
        // L'identifiant de la pièce jointe vient du serveur : on relit la
        // ligne pour pouvoir la retirer ensuite.
        await rafraichirLigne(p);
      } catch (e) { setErr(e.message); }
      onChange?.();
    },
    // Ajoute une pièce à une preuve qui en accepte plusieurs.
    async ajouterFichier(p, f) {
      try {
        const r = await api(`/api/preuves/${p.id}/fichiers`, {
          method: "POST",
          body: JSON.stringify({ drive_file_id: f.id, drive_url: f.url, drive_nom: f.nom, drive_mime: f.mime }),
        });
        majLocale(p, {
          fichiers: [...p.fichiers.filter((x) => x.drive_file_id !== r.fichier.drive_file_id), r.fichier],
          ...compteurs(r),
        });
      } catch (e) { setErr(e.message); }
      onChange?.();
    },
    async retirerFichier(p, fichier) {
      majLocale(p, { fichiers: p.fichiers.filter((x) => x.id !== fichier.id) });
      try {
        const r = await api(`/api/preuves/${p.id}/fichiers/${fichier.id}`, { method: "DELETE" });
        majLocale(p, compteurs(r));
      } catch (e) { setErr(e.message); await rafraichirLigne(p); }
      onChange?.();
    },
    // Mode de fichiers, session ou groupe rattaché : le nombre attendu est
    // recalculé par le serveur, jamais deviné ici.
    async reglage(p, champs) {
      majLocale(p, champs);
      try {
        const r = await api(`/api/preuves/${p.id}`, { method: "PATCH", body: JSON.stringify(champs) });
        majLocale(p, compteurs(r));
      } catch (e) { setErr(e.message); await rafraichirLigne(p); }
      onChange?.();
    },
    async confirmer(p) {
      majLocale(p, { a_confirmer: false, statut: statutApresConfirmation(p) });
      try {
        const r = await api(`/api/preuves/${p.id}`, { method: "PATCH", body: JSON.stringify({ confirmer: true }) });
        if (r.statut) majLocale(p, { statut: r.statut });
      } catch (e) { setErr(e.message); }
      onChange?.();
    },
    async supprimer(p) {
      if (!window.confirm(`Supprimer la preuve « ${p.titre} » ?`)) return;
      setData((d) => ({ ...d, preuves: d.preuves.filter((x) => x.id !== p.id) }));
      setSelection((s) => { if (!s.has(p.id)) return s; const n = new Set(s); n.delete(p.id); return n; });
      await api(`/api/preuves/${p.id}`, { method: "DELETE" }).catch((e) => setErr(e.message));
      onChange?.();
    },
  };

  function basculerSelection(id) {
    setSelection((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  const idsAffiches = data?.preuves.map((p) => p.id) || [];
  const toutSelectionne = idsAffiches.length > 0 && idsAffiches.every((id) => selection.has(id));
  const basculerTout = () => setSelection(toutSelectionne ? new Set() : new Set(idsAffiches));

  async function appliquerStatutMasse() {
    if (!selection.size || enCours) return;
    const ids = [...selection];
    const idsSet = selection;
    setEnCours(true);
    setData((d) => ({ ...d, preuves: d.preuves.map((x) => (idsSet.has(x.id) ? { ...x, statut: statutMasse } : x)) }));
    try {
      await api("/api/preuves", { method: "PATCH", body: JSON.stringify({ ids, statut: statutMasse }) });
      setSelection(new Set());
    } catch (e) { setErr(e.message); }
    finally { setEnCours(false); }
    onChange?.();
  }

  const aConfirmer = data?.preuves.filter((p) => p.a_confirmer).length || 0;
  const perimees = data?.preuves.filter((p) => p.alerte_statut === "perime").length || 0;

  return (
    <section className="preuves">
      <div className="ref-head">
        <div>
          <h1>Preuves</h1>
          <p className="muted">
            {data ? `${data.total} preuve(s)` : "Chargement…"}
            {aConfirmer > 0 && <span className="text-erreur"> · {aConfirmer} à confirmer</span>}
            {perimees > 0 && <span className="text-erreur"> · {perimees} périmée(s)</span>}
          </p>
        </div>
        {admin && (
          <div className="import-actions">
            <button className="btn" onClick={() => lancerImport(true)} disabled={!!occupe}>
              {occupe === "apercu" ? "Lecture…" : "Aperçu du classeur"}
            </button>
            <button className="btn primary" onClick={() => lancerImport(false)} disabled={!!occupe}>
              {occupe === "import" ? "Import…" : "Importer le classeur"}
            </button>
          </div>
        )}
      </div>

      {err && <p className="flash erreur">{err}</p>}

      {apercu && (
        <div className="card apercu">
          <strong>Aperçu — rien n'a été enregistré</strong>
          <p className="muted small">
            Classeur « {apercu.fichier.nom} », onglet « {apercu.onglet} » · {apercu.lignesLues} lignes lues ·{" "}
            {apercu.preuves} preuves ({apercu.aConfirmer} à confirmer) · {apercu.nbIgnorees} lignes ignorées
          </p>
          <p className="muted small">En-têtes lus : {apercu.entetes.filter(Boolean).join(" | ")}</p>
        </div>
      )}

      {dernier && (
        <p className="muted small">
          Dernier import : {dernier.fichier_nom} (onglet {dernier.onglet}) ·{" "}
          {dernier.preuves_creees} créée(s), {dernier.preuves_majes} mise(s) à jour ·{" "}
          {new Date(dernier.demarre_le).toLocaleString("fr-FR")}
        </p>
      )}

      <div className="filtres">
        <label><input type="checkbox" checked={filtre.a_confirmer}
          onChange={(e) => setFiltre({ ...filtre, a_confirmer: e.target.checked })} /> À confirmer d'abord</label>
        <select value={filtre.statut} onChange={(e) => setFiltre({ ...filtre, statut: e.target.value })} aria-label="Filtrer par statut">
          <option value="">Tous les statuts</option>
          {Object.entries(STATUTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={filtre.alerte} onChange={(e) => setFiltre({ ...filtre, alerte: e.target.value })} aria-label="Filtrer par échéance">
          <option value="">Toutes les échéances</option>
          <option value="perime">Périmées</option>
          <option value="bientot">Bientôt à revoir</option>
        </select>
        <input className="search" type="search" placeholder="Rechercher un document"
          value={filtre.q} onChange={(e) => setFiltre({ ...filtre, q: e.target.value })} />
      </div>

      {data && data.preuves.length === 0 && (
        <p className="muted">Aucune preuve. {admin && "Lancez l'import du classeur pour peupler le tableau de bord."}</p>
      )}

      {admin && data && data.preuves.length > 0 && (
        <div className="selection-entete">
          <label>
            <input type="checkbox" checked={toutSelectionne} onChange={basculerTout} aria-label="Tout sélectionner" />
            Tout sélectionner ({idsAffiches.length})
          </label>
        </div>
      )}

      {admin && selection.size > 0 && (
        <div className="barre-selection">
          <span>{selection.size} preuve(s) sélectionnée(s)</span>
          <select value={statutMasse} onChange={(e) => setStatutMasse(e.target.value)} aria-label="Nouveau statut pour la sélection">
            {Object.entries(STATUTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="btn primary petit" onClick={appliquerStatutMasse} disabled={enCours}>
            {enCours ? "Application…" : "Changer le statut de la sélection"}
          </button>
          <button className="btn petit" onClick={() => setSelection(new Set())}>Désélectionner</button>
        </div>
      )}

      <ul className="liste-preuves">
        {data?.preuves.map((p) => (
          <LignePreuve
            key={p.id} p={p} actions={actions} admin={admin} sessions={sessions}
            selectionnee={selection.has(p.id)} onBasculerSelection={basculerSelection}
          />
        ))}
      </ul>
    </section>
  );
}