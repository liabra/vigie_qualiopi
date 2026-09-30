// Qualité — Signalements : libellés, compteurs, segments, filtres et retard.
// Module PUR (aucun React, aucun réseau) : testable seul. Les valeurs
// viennent du serveur ; jamais de valeur technique affichée.
import { aujourdhuiISO } from "./format.js";

export const TYPES_SIGNALEMENT = {
  reclamation: { libelle: "Réclamation", ton: "warning" },
  incident: { libelle: "Incident", ton: "error" },
  non_conformite: { libelle: "Non-conformité", ton: "error" },
};

export const STATUTS_SIGNALEMENT = {
  ouverte: { libelle: "Ouverte", ton: "neutral" },
  qualifiee: { libelle: "Qualifiée", ton: "info" },
  en_traitement: { libelle: "En traitement", ton: "info" },
  resolue: { libelle: "Résolue", ton: "success" },
  cloturee: { libelle: "Clôturée", ton: "success" },
  annulee: { libelle: "Annulée", ton: "neutral" },
};

export const CAUSES_SIGNALEMENT = {
  organisation: "Organisation",
  pedagogie: "Pédagogie",
  communication: "Communication",
  logistique: "Logistique",
  autre: "Autre",
};

export const CANAUX_SIGNALEMENT = {
  email: "E-mail",
  poste: "Courrier",
  autre: "Autre",
};

// « En retard » est un état VISUEL dérivé, jamais un statut en base :
// uniquement pour une RÉCLAMATION dont l'échéance est renseignée et
// strictement antérieure à aujourd'hui, et encore EN COURS (ouverte,
// qualifiée, en traitement). Décision PO : résolue, clôturée ou annulée
// n'est jamais en retard (une résolue reste pourtant dans « Actifs »).
// Comparaison lexicographique sur YYYY-MM-DD (pas de piège de fuseau).
const STATUTS_EN_COURS = ["ouverte", "qualifiee", "en_traitement"];
export function estEnRetardReclamation(s, dateReference = aujourdhuiISO()) {
  if (!s || s.type !== "reclamation") return false;
  if (!s.date_echeance_cible) return false;
  if (!STATUTS_EN_COURS.includes(s.statut)) return false;
  return s.date_echeance_cible < dateReference;
}

// Compteurs sur la collection COMPLÈTE (etat=tous), indépendants des filtres.
export function compteursSignalements(liste) {
  const l = liste || [];
  return {
    a_traiter: l.filter((s) => ["ouverte", "qualifiee", "en_traitement"].includes(s.statut)).length,
    en_retard: l.filter((s) => estEnRetardReclamation(s)).length,
    resolues: l.filter((s) => s.statut === "resolue").length,
    cloturees: l.filter((s) => s.statut === "cloturee").length,
  };
}

// Segments de liste. « Actifs » = tout ce qui n'est ni clôturé ni annulé.
export const SEGMENTS_SIGNALEMENT = [
  { id: "actifs", libelle: "Actifs", test: (s) => ["ouverte", "qualifiee", "en_traitement", "resolue"].includes(s.statut) },
  { id: "clotures", libelle: "Clôturés", test: (s) => s.statut === "cloturee" },
  { id: "annules", libelle: "Annulés", test: (s) => s.statut === "annulee" },
  { id: "tous", libelle: "Tous", test: () => true },
];

export function compterSegmentsSignalements(liste) {
  return Object.fromEntries(SEGMENTS_SIGNALEMENT.map((s) => [s.id, (liste || []).filter(s.test).length]));
}

const normaliser = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Filtre client sur la liste complète (GET /api/signalements?etat=tous).
// La recherche ne porte que sur la référence et l'objet — JAMAIS sur le
// nom, l'e-mail ou l'entreprise du réclamant. Valeurs inconnues ou non
// numériques : ignorées (comportées « aucun filtre »), comme pour Actions.
export function filtrerSignalements(liste, { segment = "actifs", type = "", statut = "", formation = "", session = "", responsable = "", indicateur = "", q = "" } = {}) {
  const seg = SEGMENTS_SIGNALEMENT.find((s) => s.id === segment) || SEGMENTS_SIGNALEMENT[0];
  const aiguille = normaliser(q.trim());
  const typeOk = TYPES_SIGNALEMENT[type] ? type : "";
  const statutOk = STATUTS_SIGNALEMENT[statut] ? statut : "";
  const idFiltre = (v) => { if (v === "") return null; const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
  const form = idFiltre(formation);
  const sess = idFiltre(session);
  const resp = idFiltre(responsable);
  const ind = idFiltre(indicateur);
  return (liste || []).filter((s) =>
    seg.test(s)
    && (!typeOk || s.type === typeOk)
    && (!statutOk || s.statut === statutOk)
    && (form === null || s.formation_id === form)
    && (sess === null || s.session_id === sess)
    && (resp === null || s.responsable_id === resp)
    && (ind === null || (s.indicateurs || []).some((i) => i.id === ind))
    && (!aiguille || [s.reference, s.objet].some((c) => normaliser(c).includes(aiguille))));
}
