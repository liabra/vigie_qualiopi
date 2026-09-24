import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "./api.js";
import { RechercheDrive } from "./RechercheDrive.jsx";
import { Badge, Button, ConfirmDialog, Drawer, EmptyState } from "./ui/index.js";
import { useTexteUrl } from "./ui/useTexteUrl.js";
import { SOURCES, ALERTES, filtresActifs, filtrerPreuves, grouperParIndicateur } from "./preuves/format.js";

const STATUTS = {
  maitrise: "Maîtrisé",
  a_consolider: "À consolider",
  a_risque: "À risque",
  non_applicable: "Non applicable",
};
const TONS_STATUT = { maitrise: "success", a_consolider: "warning", a_risque: "error", non_applicable: "neutral" };

const MODES = {
  unique: "Un seul fichier",
  multiple: "Plusieurs fichiers",
  par_stagiaire: "Un par stagiaire",
};

const TYPES_ALERTE = {
  revision_periodique: "Révision périodique",
  echeance_fixe: "Échéance fixe",
};

// Réglage de l'échéance d'un document permanent (CGV, habilitation,
// contrat…) : révision périodique ou date fixe. La rupture réglementaire
// (liée à la veille) n'a pas encore d'écran, donc pas de contrôle ici.
const echeanceIncomplete = (p) =>
  (p.type_alerte === "revision_periodique" && !p.periodicite_mois) ||
  (p.type_alerte === "echeance_fixe" && !p.date_echeance);

// Les indicateurs du référentiel actif, groupés par critère. Sert au
// formulaire de création et à la correction de l'indicateur d'une preuve.
function OptionsIndicateurs({ referentiel }) {
  return (referentiel?.criteres || []).map((c) => (
    <optgroup key={c.id} label={`Critère ${c.numero}`}>
      {c.indicateurs.map((i) => (
        <option key={i.id} value={i.id}>
          {i.numero} · {i.libelle.length > 90 ? i.libelle.slice(0, 90) + "…" : i.libelle}
        </option>
      ))}
    </optgroup>
  ));
}

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

      {admin && (
        <RechercheDrive
          dejaRattaches={(p.fichiers || []).map((f) => f.drive_file_id)}
          placeholder={multi
            ? "Ajouter un fichier du Drive"
            : (p.fichiers?.length ? "Remplacer le fichier" : "Rattacher un fichier du Drive")}
          surChoix={(f) => (multi ? actions.ajouterFichier(p, f) : actions.remplacerFichier(p, f))}
          onErreur={actions.erreur}
        />
      )}
    </div>
  );
}

// Champs de l'échéance, partagés par le réglage d'une preuve existante et
// par le formulaire de création.
function ChampsEcheance({ typeAlerte, periodiciteMois, dateEcheance, onChamp }) {
  const incomplete = (typeAlerte === "revision_periodique" && !periodiciteMois)
    || (typeAlerte === "echeance_fixe" && !dateEcheance);
  return (
    <div className="reglages-fichiers">
      <label>
        <span className="muted small">Échéance</span>
        <select
          value={typeAlerte || ""} aria-label="Type d'échéance"
          onChange={(e) => onChamp("type_alerte", e.target.value || null)}
        >
          <option value="">Aucune</option>
          {Object.entries(TYPES_ALERTE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      {incomplete && (
        <span className="muted small">
          {typeAlerte === "revision_periodique"
            ? "Indiquez tous les combien de mois cette preuve doit être revue."
            : "Indiquez la date d'expiration portée sur le document."}
        </span>
      )}
      {typeAlerte === "revision_periodique" && (
        <label>
          <span className="muted small">Tous les combien de mois</span>
          <input
            type="number" min="1" value={periodiciteMois || ""} aria-label="Périodicité en mois"
            onChange={(e) => onChamp("periodicite_mois", e.target.value ? Number(e.target.value) : null)}
          />
        </label>
      )}
      {typeAlerte === "echeance_fixe" && (
        <label>
          <span className="muted small">Date d'échéance</span>
          <input
            type="date" value={dateEcheance || ""} aria-label="Date d'échéance"
            onChange={(e) => onChamp("date_echeance", e.target.value || null)}
          />
        </label>
      )}
    </div>
  );
}

// Ligne compacte d'une preuve : titre, source, statut, échéance, fichiers
// et actions principales. Les réglages avancés vivent dans le panneau.
function LignePreuve({ p, admin, selectionnee, onBasculerSelection, onOuvrir }) {
  return (
    <li className={"preuve" + (p.a_confirmer ? " a-confirmer" : "") + (p.incomplet ? " incomplete" : "") + (selectionnee ? " selectionnee" : "")}>
      <div className="preuve-tete">
        {admin && (
          <input
            type="checkbox" className="case-selection" checked={selectionnee}
            onChange={() => onBasculerSelection(p.id)} aria-label={`Sélectionner « ${p.titre} »`}
          />
        )}
        <span className="ind-num petit" title={`Indicateur ${p.indicateur} · Critère ${p.critere}`}>{p.indicateur}</span>
        <div className="preuve-titre">
          <strong>{p.titre}</strong>
          <div className="preuve-meta">
            {SOURCES[p.source] && <span className="pill">{SOURCES[p.source]}</span>}
            {p.a_confirmer && <span className="pill off">À confirmer</span>}
            {p.incomplet && <span className="pill warn">Incomplet</span>}
            {p.alerte_statut && p.alerte_statut !== "ok" && (
              <span className={"pill " + (p.alerte_statut === "perime" ? "off" : "warn")}>{ALERTES[p.alerte_statut]}</span>
            )}
            <span className="pill">{p.nb_fichiers} fichier(s)</span>
          </div>
        </div>
        <Badge ton={TONS_STATUT[p.statut] || "neutral"}>{STATUTS[p.statut] || p.statut}</Badge>
        <Button compact onClick={() => onOuvrir(p.id)}>Ouvrir</Button>
      </div>
    </li>
  );
}

// Panneau de détail : réglages complets d'une preuve (fichiers, échéance,
// statut, correction, confirmation, suppression). Rien n'y est supprimé de
// ce que l'ancienne carte affichait en permanence.
function DetailPreuve({ p, actions, admin, sessions, referentiel, onFermer }) {
  const [edite, setEdite] = useState(false);
  const [champs, setChamps] = useState(null);

  function basculerEdition() {
    if (edite) { setEdite(false); setChamps(null); return; }
    setChamps({
      titre: p.titre,
      description: p.description || "",
      indicateur_id: String(p.indicateur_id ?? ""),
    });
    setEdite(true);
  }

  return (
    <Drawer
      ouvert={!!p} titre={p?.titre} onFermer={onFermer}
      description={p ? `Indicateur ${p.indicateur} · Critère ${p.critere}${SOURCES[p.source] ? ` · ${SOURCES[p.source]}` : ""}` : undefined}
    >
      {p && (
        <div className="zone-actions">
          {p.description && <p className="muted">{p.description}</p>}

          {admin && (
            <label className="champ">
              <span className="muted small">Statut</span>
              <select value={p.statut} onChange={(e) => actions.statut(p, e.target.value)} aria-label="Statut">
                {Object.entries(STATUTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          )}

          <Fichiers p={p} actions={actions} admin={admin} sessions={sessions} />

          {admin ? (
            <div className="fichiers-preuve">
              <ChampsEcheance
                typeAlerte={p.type_alerte} periodiciteMois={p.periodicite_mois} dateEcheance={p.date_echeance}
                onChamp={(champ, valeur) => actions.reglage(p, { [champ]: valeur })}
              />
              {p.type_alerte === "revision_periodique" && (
                <div className="reglages-fichiers">
                  <span className="muted small">
                    Dernière révision : {p.date_derniere_revision ? new Date(p.date_derniere_revision).toLocaleDateString("fr-FR") : "jamais notée"}
                  </span>
                  <button className="btn petit" onClick={() => actions.reglage(p, { marquer_revise: true })}>
                    Marquer révisé aujourd'hui
                  </button>
                </div>
              )}
            </div>
          ) : (
            (p.alerte_statut && p.alerte_statut !== "ok") && (
              <span className={"pill " + (p.alerte_statut === "perime" ? "off" : "warn")}>{ALERTES[p.alerte_statut]}</span>
            )
          )}

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
              </div>
            </>
          )}

          {admin && (
            <>
              {edite && champs && (
                <div className="formulaire">
                  <label className="champ">
                    <span className="muted small">Titre</span>
                    <input value={champs.titre} aria-label="Titre de la preuve"
                      onChange={(e) => setChamps({ ...champs, titre: e.target.value })} />
                  </label>
                  <label className="champ">
                    <span className="muted small">Description</span>
                    <textarea rows={2} value={champs.description} aria-label="Description de la preuve"
                      onChange={(e) => setChamps({ ...champs, description: e.target.value })} />
                  </label>
                  <label className="champ">
                    <span className="muted small">Indicateur</span>
                    <select value={champs.indicateur_id} aria-label="Indicateur de la preuve"
                      onChange={(e) => setChamps({ ...champs, indicateur_id: e.target.value })}>
                      <OptionsIndicateurs referentiel={referentiel} />
                    </select>
                  </label>
                  <div className="preuve-actions">
                    <button className="btn primary petit"
                      onClick={() => actions.modifier(p, champs).then((ok) => ok && setEdite(false))}>
                      Enregistrer
                    </button>
                    <button className="btn petit" onClick={() => setEdite(false)}>Annuler</button>
                  </div>
                </div>
              )}
              <div className="preuve-actions">
                <button className="btn petit" onClick={basculerEdition}>{edite ? "Annuler" : "Modifier"}</button>
                <button className="btn petit danger" onClick={() => actions.supprimer(p)}>Supprimer</button>
              </div>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

// Vue « par indicateur » : critère → indicateur → preuves liées. Les
// indicateurs sans preuve restent visibles (« Aucune preuve rattachée »).
function VueParIndicateur({ groupes, admin, selectionnee, onBasculerSelection, onOuvrir }) {
  return (
    <div className="preuves-par-indicateur">
      {groupes.map((c) => (
        <section key={c.id} className="card preuves-critere" aria-labelledby={`preuves-critere-${c.id}`}>
          <h3 id={`preuves-critere-${c.id}`} className="preuves-critere__titre">
            <span className="num">Critère {c.numero}</span>
            <span>{c.libelle}</span>
          </h3>
          <ul className="preuves-indicateurs">
            {c.indicateurs.map((i) => (
              <li key={i.id} className="preuves-indicateur">
                <div className="preuves-indicateur__tete">
                  <span className="ind-num petit" title={`Indicateur ${i.numero}`}>{i.numero}</span>
                  <span className="preuves-indicateur__libelle">Indicateur {i.numero} — {i.libelle}</span>
                  <span className="pill">{i.preuves.length} preuve(s)</span>
                  {i.non_applicable_force && <span className="pill statut-non_applicable">Non applicable</span>}
                </div>
                {i.preuves.length === 0 ? (
                  <p className="muted small">{i.non_applicable_force ? "Non applicable" : "Aucune preuve rattachée"}</p>
                ) : (
                  <ul className="liste-preuves">
                    {i.preuves.map((p) => (
                      <LignePreuve
                        key={p.id} p={p} admin={admin}
                        selectionnee={selectionnee.has(p.id)} onBasculerSelection={onBasculerSelection}
                        onOuvrir={onOuvrir}
                      />
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function Preuves({ admin, onChange }) {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useTexteUrl("q");
  const vue = params.get("vue") === "toutes" ? "toutes" : "indicateurs";
  const indicateur = params.get("indicateur") || "";
  const aConfirmer = params.get("a_confirmer") === "1";
  const statut = params.get("statut") || "";
  const alerte = params.get("alerte") || "";
  const source = params.get("source") || "";

  const [preuves, setPreuves] = useState(null);
  const [referentiel, setReferentiel] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [err, setErr] = useState(null);
  const [dernier, setDernier] = useState(null);
  const [occupe, setOccupe] = useState(null);
  const [apercu, setApercu] = useState(null);
  const [selection, setSelection] = useState(() => new Set());
  const [statutMasse, setStatutMasse] = useState("maitrise");
  const [enCours, setEnCours] = useState(false);
  const [creation, setCreation] = useState(null);
  const [creationEnCours, setCreationEnCours] = useState(false);
  const [ouverteId, setOuverteId] = useState(null);
  // Suppression confirmée via ConfirmDialog (plus de window.confirm).
  const [aSupprimer, setASupprimer] = useState(null);
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);

  const charger = useCallback(async () => {
    try {
      const r = await api("/api/preuves");
      setPreuves(r.preuves);
      setErr(null);
    } catch (e) { setErr(e.message); }
  }, []);

  useEffect(() => { charger(); }, [charger]);
  useEffect(() => { api("/api/referentiel").then(setReferentiel).catch(() => {}); }, []);
  useEffect(() => { api("/api/sessions").then((r) => setSessions(r.sessions)).catch(() => {}); }, []);
  useEffect(() => {
    if (admin) api("/api/import/dernier").then((r) => setDernier(r.import)).catch(() => {});
  }, [admin]);

  // La sélection ne doit jamais retenir un identifiant qui n'est plus affiché.
  const filtres = { q, statut, alerte, source, a_confirmer: aConfirmer };
  const actifs = filtresActifs(filtres);
  const toutes = preuves || [];
  const filtrees = filtrerPreuves(toutes, { ...filtres, indicateur });
  const idsAffiches = filtrees.map((p) => p.id);
  useEffect(() => {
    setSelection((s) => {
      const visibles = new Set(idsAffiches);
      const n = new Set([...s].filter((id) => visibles.has(id)));
      return n.size === s.size ? s : n;
    });
  }, [idsAffiches.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  function majFiltre(cle, valeur) {
    setParams((courants) => {
      const p = new URLSearchParams(courants);
      if (valeur && !(cle === "vue" && valeur === "indicateurs")) p.set(cle, valeur); else p.delete(cle);
      return p;
    });
  }

  const ouvrirCreation = () => setCreation({
    indicateur_ids: [], titre: "", description: "", statut: "a_risque",
    mode_fichiers: "unique", type_alerte: null, periodicite_mois: null,
    date_echeance: null, fichier: null,
  });

  async function enregistrerCreation() {
    if (!creation.indicateur_ids.length) return setErr("Choisissez au moins un indicateur.");
    if (!creation.titre.trim()) return setErr("Indiquez un titre.");
    setCreationEnCours(true);
    try {
      await api("/api/preuves", {
        method: "POST",
        body: JSON.stringify({
          indicateur_ids: creation.indicateur_ids.map(Number),
          titre: creation.titre,
          description: creation.description,
          statut: creation.statut,
          mode_fichiers: creation.mode_fichiers,
          type_alerte: creation.type_alerte,
          periodicite_mois: creation.periodicite_mois,
          date_echeance: creation.date_echeance,
          ...(creation.fichier ? {
            drive_file_id: creation.fichier.id, drive_url: creation.fichier.url,
            drive_nom: creation.fichier.nom, drive_mime: creation.fichier.mime,
          } : {}),
        }),
      });
      setCreation(null);
      setErr(null);
      await charger();
      onChange?.();
    } catch (e) { setErr(e.message); } finally { setCreationEnCours(false); }
  }

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
    setPreuves((liste) => (liste || []).map((x) => (x.id === p.id ? { ...x, ...champs } : x)));

  const statutApresConfirmation = (p) => (p.statut === "a_risque" ? "maitrise" : p.statut);

  const compteurs = (r) =>
    Object.fromEntries(
      ["statut", "statut_effectif", "mode_fichiers", "nb_fichiers", "fichiers_attendus", "incomplet",
        "type_alerte", "periodicite_mois", "date_echeance", "date_derniere_revision", "alerte_statut"]
        .filter((k) => r[k] !== undefined)
        .map((k) => [k, r[k]])
    );

  async function rafraichirLigne(p) {
    try {
      const { preuve } = await api(`/api/preuves/${p.id}`);
      setPreuves((liste) => (liste || []).map((x) => (x.id === preuve.id ? preuve : x)));
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
        await rafraichirLigne(p);
      } catch (e) { setErr(e.message); }
      onChange?.();
    },
    async ajouterFichier(p, f) {
      try {
        const r = await api(`/api/preuves/${p.id}/fichiers`, {
          method: "POST",
          body: JSON.stringify({ drive_file_id: f.id, drive_url: f.url, drive_nom: f.nom, drive_mime: f.mime }),
        });
        majLocale(p, {
          fichiers: [...(p.fichiers || []).filter((x) => x.drive_file_id !== r.fichier.drive_file_id), r.fichier],
          ...compteurs(r),
        });
      } catch (e) { setErr(e.message); }
      onChange?.();
    },
    async remplacerFichier(p, f) {
      try {
        const r = await api(`/api/preuves/${p.id}`, {
          method: "PATCH",
          body: JSON.stringify({ drive_file_id: f.id, drive_url: f.url, drive_nom: f.nom, drive_mime: f.mime }),
        });
        majLocale(p, compteurs(r));
        await rafraichirLigne(p);
      } catch (e) { setErr(e.message); }
      onChange?.();
    },
    async modifier(p, champs) {
      try {
        await api(`/api/preuves/${p.id}`, { method: "PATCH", body: JSON.stringify(champs) });
        await rafraichirLigne(p);
        onChange?.();
        return true;
      } catch (e) { setErr(e.message); return false; }
    },
    async retirerFichier(p, fichier) {
      majLocale(p, { fichiers: (p.fichiers || []).filter((x) => x.id !== fichier.id) });
      try {
        const r = await api(`/api/preuves/${p.id}/fichiers/${fichier.id}`, { method: "DELETE" });
        majLocale(p, compteurs(r));
      } catch (e) { setErr(e.message); await rafraichirLigne(p); }
      onChange?.();
    },
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
    supprimer(p) {
      setASupprimer(p);
    },
  };

  // Confirmation explicite : le panneau demande, ConfirmDialog valide.
  async function confirmerSuppression() {
    const p = aSupprimer;
    if (!p) return;
    setSuppressionEnCours(true);
    setPreuves((liste) => (liste || []).filter((x) => x.id !== p.id));
    setSelection((s) => { if (!s.has(p.id)) return s; const n = new Set(s); n.delete(p.id); return n; });
    setOuverteId((id) => (id === p.id ? null : id));
    setASupprimer(null);
    try {
      await api(`/api/preuves/${p.id}`, { method: "DELETE" });
      await charger();
    } catch (e) { setErr(e.message); await charger(); }
    finally { setSuppressionEnCours(false); }
    onChange?.();
  }

  function basculerSelection(id) {
    setSelection((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  const toutSelectionne = idsAffiches.length > 0 && idsAffiches.every((id) => selection.has(id));
  const basculerTout = () => setSelection(toutSelectionne ? new Set() : new Set(idsAffiches));

  async function appliquerStatutMasse() {
    if (!selection.size || enCours) return;
    const ids = [...selection];
    const idsSet = new Set(ids);
    setEnCours(true);
    setPreuves((liste) => (liste || []).map((x) => (idsSet.has(x.id) ? { ...x, statut: statutMasse } : x)));
    try {
      await api("/api/preuves", { method: "PATCH", body: JSON.stringify({ ids, statut: statutMasse }) });
      setSelection(new Set());
    } catch (e) { setErr(e.message); }
    finally { setEnCours(false); }
    onChange?.();
  }

  const groupes = grouperParIndicateur(referentiel, toutes);
  const groupesVisibles = actifs
    ? groupes
      .map((c) => ({
        ...c,
        indicateurs: c.indicateurs
          .map((i) => ({ ...i, preuves: filtrerPreuves(i.preuves, filtres) }))
          .filter((i) => i.preuves.length > 0),
      }))
      .filter((c) => c.indicateurs.length > 0)
    : groupes;
  const groupesFinaux = indicateur
    ? groupesVisibles
      .map((c) => ({ ...c, indicateurs: c.indicateurs.filter((i) => String(i.numero) === String(indicateur)) }))
      .filter((c) => c.indicateurs.length > 0)
    : groupesVisibles;

  const ouverte = (toutes.find((p) => p.id === ouverteId)) || null;
  const aConfirmerTotal = toutes.filter((p) => p.a_confirmer).length;
  const perimees = toutes.filter((p) => p.alerte_statut === "perime").length;
  const total = toutes.length;

  return (
    <section className="preuves">
      <div className="ref-head">
        <div>
          <h1>Preuves</h1>
          <p className="muted">
            {preuves ? `${total} preuve(s)` : "Chargement…"}
            {aConfirmerTotal > 0 && <span className="text-erreur"> · {aConfirmerTotal} à confirmer</span>}
            {perimees > 0 && <span className="text-erreur"> · {perimees} périmée(s)</span>}
          </p>
        </div>
        {admin && (
          <div className="import-actions">
            <button className="btn" onClick={ouvrirCreation} disabled={!!occupe}>Ajouter une preuve</button>
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

      <div className="preuves-vues" role="group" aria-label="Mode d'affichage des preuves">
        <button type="button" aria-pressed={vue === "indicateurs"} className={"preuves-vue" + (vue === "indicateurs" ? " preuves-vue--active" : "")} onClick={() => majFiltre("vue", "indicateurs")}>
          Par indicateur
        </button>
        <button type="button" aria-pressed={vue === "toutes"} className={"preuves-vue" + (vue === "toutes" ? " preuves-vue--active" : "")} onClick={() => majFiltre("vue", "toutes")}>
          Toutes les preuves
        </button>
      </div>

      <div className="filtres">
        <input className="search" type="search" placeholder="Rechercher un document" aria-label="Rechercher une preuve"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={source} onChange={(e) => majFiltre("source", e.target.value)} aria-label="Filtrer par source">
          <option value="">Toutes les sources</option>
          {Object.entries(SOURCES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={statut} onChange={(e) => majFiltre("statut", e.target.value)} aria-label="Filtrer par statut">
          <option value="">Tous les statuts</option>
          {Object.entries(STATUTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={alerte} onChange={(e) => majFiltre("alerte", e.target.value)} aria-label="Filtrer par échéance">
          <option value="">Toutes les échéances</option>
          <option value="perime">Périmées</option>
          <option value="bientot">Bientôt à revoir</option>
        </select>
        <select value={indicateur} onChange={(e) => majFiltre("indicateur", e.target.value)} aria-label="Filtrer par indicateur">
          <option value="">Tous les indicateurs</option>
          {(referentiel?.criteres || []).flatMap((c) => c.indicateurs).map((i) => (
            <option key={i.id} value={i.numero}>Indicateur {i.numero} — {i.libelle}</option>
          ))}
        </select>
        <label className="champ case"><input type="checkbox" checked={aConfirmer}
          onChange={(e) => majFiltre("a_confirmer", e.target.checked ? "1" : "")} /> À confirmer d'abord</label>
        {(actifs || indicateur) && (
          <button className="btn petit" onClick={() => setParams(new URLSearchParams(vue === "toutes" ? { vue: "toutes" } : {}))}>
            Effacer les filtres
          </button>
        )}
      </div>

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

      {preuves && preuves.length === 0 && (
        <EmptyState titre="Aucune preuve">
          {admin ? "Ajoutez une preuve, ou lancez l'import du classeur pour peupler le tableau de bord." : "Aucune preuve n'est rattachée pour l'instant."}
        </EmptyState>
      )}

      {preuves && preuves.length > 0 && (
        <>
          {admin && vue === "toutes" && (
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

          {vue === "indicateurs" ? (
            groupesFinaux.length === 0 ? (
              <EmptyState titre="Aucun indicateur ne correspond." />
            ) : (
              <VueParIndicateur
                groupes={groupesFinaux} admin={admin}
                selectionnee={selection} onBasculerSelection={basculerSelection} onOuvrir={setOuverteId}
              />
            )
          ) : (
            filtrees.length === 0 ? (
              <EmptyState titre="Aucune preuve ne correspond à ces filtres." />
            ) : (
              <ul className="liste-preuves">
                {filtrees.map((p) => (
                  <LignePreuve
                    key={p.id} p={p} admin={admin}
                    selectionnee={selection.has(p.id)} onBasculerSelection={basculerSelection}
                    onOuvrir={setOuverteId}
                  />
                ))}
              </ul>
            )
          )}
        </>
      )}

      <DetailPreuve
        p={ouverte} actions={actions} admin={admin} sessions={sessions}
        referentiel={referentiel} onFermer={() => setOuverteId(null)}
      />

      <Drawer
        ouvert={!!creation} titre="Nouvelle preuve" onFermer={() => setCreation(null)} taille="large"
        description="Un document qui existe déjà sur le Drive : export EduSign, convention, habilitation, justificatif…"
        pied={
          <div className="preuve-actions">
            <Button onClick={() => setCreation(null)}>Annuler</Button>
            <Button variante="primary" onClick={enregistrerCreation} disabled={creationEnCours}>
              {creationEnCours ? "Création…" : "Enregistrer la preuve"}
            </Button>
          </div>
        }
      >
        {creation && (
          <div className="zone-actions">
            <label className="champ">
              <span className="muted small">Indicateur(s) — un par preuve à créer</span>
              <select
                multiple size={8} aria-label="Indicateurs de la nouvelle preuve"
                value={creation.indicateur_ids}
                onChange={(e) => setCreation({ ...creation, indicateur_ids: [...e.target.selectedOptions].map((o) => o.value) })}
              >
                <OptionsIndicateurs referentiel={referentiel} />
              </select>
            </label>
            <label className="champ">
              <span className="muted small">Titre</span>
              <input value={creation.titre} aria-label="Titre de la nouvelle preuve"
                onChange={(e) => setCreation({ ...creation, titre: e.target.value })} />
            </label>
            <label className="champ">
              <span className="muted small">Description (facultatif)</span>
              <textarea rows={2} value={creation.description} aria-label="Description de la nouvelle preuve"
                onChange={(e) => setCreation({ ...creation, description: e.target.value })} />
            </label>
            <div className="reglages-fichiers">
              <label>
                <span className="muted small">Statut</span>
                <select value={creation.statut} aria-label="Statut de la nouvelle preuve"
                  onChange={(e) => setCreation({ ...creation, statut: e.target.value })}>
                  {Object.entries(STATUTS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label>
                <span className="muted small">Fichiers attendus</span>
                <select value={creation.mode_fichiers} aria-label="Mode de fichiers de la nouvelle preuve"
                  onChange={(e) => setCreation({ ...creation, mode_fichiers: e.target.value })}>
                  {Object.entries(MODES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
            <ChampsEcheance
              typeAlerte={creation.type_alerte} periodiciteMois={creation.periodicite_mois}
              dateEcheance={creation.date_echeance}
              onChamp={(champ, valeur) => setCreation({ ...creation, [champ]: valeur })}
            />
            <div className="rattachement">
              <span className="muted small">
                {creation.fichier
                  ? `Fichier choisi : ${creation.fichier.nom}`
                  : "Aucun fichier choisi — facultatif : la preuve pourra être rattachée ensuite."}
              </span>
              <RechercheDrive
                dejaRattaches={creation.fichier ? [creation.fichier.id] : []}
                placeholder="Rechercher un fichier existant sur le Drive"
                surChoix={(f) => setCreation({ ...creation, fichier: f })}
                onErreur={setErr}
              />
              {creation.fichier && (
                <button className="btn petit" onClick={() => setCreation({ ...creation, fichier: null })}>
                  Retirer ce fichier
                </button>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        ouvert={!!aSupprimer}
        titre="Supprimer la preuve"
        libelleConfirmer="Supprimer la preuve"
        ton="danger"
        enCours={suppressionEnCours}
        onConfirmer={confirmerSuppression}
        onAnnuler={() => setASupprimer(null)}
      >
        {aSupprimer ? `Supprimer la preuve « ${aSupprimer.titre} » ?` : ""}
      </ConfirmDialog>
    </section>
  );
}