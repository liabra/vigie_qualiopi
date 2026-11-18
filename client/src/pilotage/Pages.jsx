import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Badge, Button, EmptyState, Field, LoadingState, PageHeader } from "../ui/index.js";
import { useTitrePage } from "../pages/titre.js";
import { RegistrePage, formaterDate } from "./RegistrePage.jsx";

export function TachesPage({ admin }) {
  return (
    <RegistrePage nom="taches" admin={admin} actions={admin ? ({ recharger, notifier }) => <CreerDepuisManques recharger={recharger} notifier={notifier} /> : undefined} />
  );
}
export const RisquesPage = ({ admin }) => <RegistrePage nom="risques" admin={admin} />;
export const PartenairesPage = ({ admin }) => <RegistrePage nom="partenaires" admin={admin} />;
export const RessourcesPage = ({ admin }) => <RegistrePage nom="ressources" admin={admin} />;

// Scénario « preuve manquante » : une tâche par indicateur sans preuve et par preuve à actualiser, sans doublon.
function CreerDepuisManques({ recharger, notifier }) {
  const [enCours, setEnCours] = useState(false);
  async function lancer() {
    setEnCours(true);
    try {
      const r = await api("/api/taches/depuis-manques", { method: "POST", body: "{}" });
      notifier(r.crees ? `${r.crees} tâche(s) créée(s) : ${r.indicateurs_sans_preuve} indicateur(s) sans preuve, ${r.preuves_a_actualiser} preuve(s) à actualiser.` : "Aucun nouveau manque : toutes les tâches nécessaires existent déjà.");
      await recharger();
    } catch (e) { notifier(`Échec : ${e.message}`); } finally { setEnCours(false); }
  }
  return <Button onClick={lancer} disabled={enCours}>{enCours ? "Analyse…" : "Créer les tâches depuis les manques"}</Button>;
}

const TYPES_ECHEANCE = {
  tache: ["Tâche", "info"], action: ["Action qualité", "warning"], preuve: ["Preuve", "neutral"], session: ["Session", "success"],
  risque: ["Risque", "error"], partenaire: ["Partenaire", "neutral"], campagne_audit: ["Audit", "error"],
};
const moisDe = (d) => new Date(String(d).slice(0, 10) + "T00:00:00Z").toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });

export function EcheancierPage() {
  useTitrePage("Échéancier");
  const debut = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const fin = new Date(Date.now() + 180 * 864e5).toISOString().slice(0, 10);
  const [periode, setPeriode] = useState({ du: debut, au: fin });
  const [types, setTypes] = useState(new Set(Object.keys(TYPES_ECHEANCE)));
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState(null);
  const charger = useCallback(() => {
    api(`/api/echeancier?du=${periode.du}&au=${periode.au}`).then((r) => { setDonnees(r); setErreur(null); }).catch((e) => setErreur(e.message));
  }, [periode]);
  useEffect(() => { charger(); }, [charger]);
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const evenements = (donnees?.evenements || []).filter((e) => types.has(e.type));
  const parMois = [];
  for (const e of evenements) {
    const m = moisDe(e.date);
    if (!parMois.length || parMois[parMois.length - 1].mois !== m) parMois.push({ mois: m, lignes: [] });
    parMois[parMois.length - 1].lignes.push(e);
  }
  return (
    <>
      <PageHeader fil={[{ libelle: "Pilotage" }, { libelle: "Échéancier" }]} titre="Échéancier"
        description="Toutes les dates à tenir, quel que soit le module : tâches, actions, preuves à réviser, sessions, risques à réévaluer, conventions et audits." />
      {erreur && <Alert ton="error" titre="L'échéancier n'a pas pu être chargé.">{erreur}</Alert>}
      {donnees?.en_retard > 0 && <Alert ton="warning" titre={`${donnees.en_retard} élément(s) en retard`}>Tâches et actions qualité dont l'échéance est dépassée.</Alert>}
      <div className="pilotage-filtres">
        <Field label="Du"><input type="date" value={periode.du} onChange={(e) => e.target.value && setPeriode({ ...periode, du: e.target.value })} /></Field>
        <Field label="Au"><input type="date" value={periode.au} onChange={(e) => e.target.value && setPeriode({ ...periode, au: e.target.value })} /></Field>
        <div className="sess-vues" role="group" aria-label="Types d'échéance">
          {Object.entries(TYPES_ECHEANCE).map(([t, [l]]) => (
            <button key={t} type="button" className={"sess-vue" + (types.has(t) ? " sess-vue--active" : "")} aria-pressed={types.has(t)}
              onClick={() => { const n = new Set(types); n.has(t) ? n.delete(t) : n.add(t); setTypes(n); }}>{l}</button>
          ))}
        </div>
      </div>
      {!donnees && !erreur && <LoadingState texte="Chargement de l'échéancier…" />}
      {donnees && !evenements.length && <EmptyState titre="Aucune échéance sur la période">Élargissez la période ou les types affichés.</EmptyState>}
      {parMois.map((m) => (
        <section key={m.mois} className="pilotage-mois" aria-label={m.mois}>
          <h2 className="pilotage-mois__titre">{m.mois}</h2>
          <ul className="pilotage-liste">
            {m.lignes.map((e) => (
              <li key={`${e.type}-${e.id}-${e.date}`} className={String(e.date) < aujourdhui && ["tache", "action"].includes(e.type) ? "pilotage-retard" : undefined}>
                <span className="pilotage-liste__date">{formaterDate(e.date)}</span>
                <Badge ton={TYPES_ECHEANCE[e.type][1]}>{TYPES_ECHEANCE[e.type][0]}</Badge>
                <Link to={e.lien}>{e.libelle}</Link>
                {e.responsable && <span className="sess-secondaire"> · {e.responsable}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
