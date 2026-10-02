// Qualité — Actions qualité : libellés, filtres, compteurs, retard et
// historique. Module PUR (aucun React, aucun réseau) : testable seul.
// Les valeurs viennent du serveur ; jamais de valeur technique affichée.
import { formaterDate } from "../sessions/format.js";

export const STATUTS_ACTION = {
  a_faire: { libelle: "À faire", ton: "neutral" },
  en_cours: { libelle: "En cours", ton: "info" },
  realisee: { libelle: "Réalisée", ton: "success" },
  efficacite_a_verifier: { libelle: "Efficacité à vérifier", ton: "warning" },
  cloturee: { libelle: "Clôturée", ton: "success" },
  annulee: { libelle: "Annulée", ton: "neutral" },
};

export const PRIORITES = {
  basse: { libelle: "Basse", ton: "neutral" },
  normale: { libelle: "Normale", ton: "info" },
  haute: { libelle: "Haute", ton: "warning" },
  urgente: { libelle: "Urgente", ton: "error" },
};

export const ORIGINES = {
  manuel: "Manuelle",
  signalement: "Signalement",
  satisfaction: "Retour de satisfaction",
};

// Date du jour LOCAL (même fuseau que l'utilisateur) au format ISO court.
export function aujourdhuiISO(date = new Date()) {
  const annee = date.getFullYear();
  const mois = String(date.getMonth() + 1).padStart(2, "0");
  const jour = String(date.getDate()).padStart(2, "0");
  return `${annee}-${mois}-${jour}`;
}

// « En retard » est un état VISUEL dérivé, jamais un statut en base :
// échéance dépassée ET action ni clôturée ni annulée.
export function estEnRetard(action, aujourdhui = aujourdhuiISO()) {
  if (!action?.echeance) return false;
  if (action.statut === "cloturee" || action.statut === "annulee") return false;
  return action.echeance < aujourdhui;
}

// Compteurs simples depuis la liste déjà chargée (aucun endpoint dédié).
export function compteursActions(actions, aujourdhui = aujourdhuiISO()) {
  const liste = actions || [];
  const ouvertes = liste.filter((a) => a.statut !== "cloturee" && a.statut !== "annulee").length;
  return {
    ouvertes,
    en_retard: liste.filter((a) => estEnRetard(a, aujourdhui)).length,
    efficacite: liste.filter((a) => a.statut === "efficacite_a_verifier").length,
    cloturees: liste.filter((a) => a.statut === "cloturee").length,
    a_faire: liste.filter((a) => a.statut === "a_faire").length,
  };
}

// Segments de liste (actives / clôturées / annulées / toutes).
export const SEGMENTS = [
  { id: "actives", libelle: "Actives", test: (a) => a.statut !== "cloturee" && a.statut !== "annulee" },
  { id: "clotures", libelle: "Clôturées", test: (a) => a.statut === "cloturee" },
  { id: "annules", libelle: "Annulées", test: (a) => a.statut === "annulee" },
  { id: "toutes", libelle: "Toutes", test: () => true },
];

const normaliser = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Filtre client sur la liste complète (GET /api/actions-qualite?etat=tous).
export function filtrerActions(actions, { segment = "toutes", statut = "", priorite = "", origine = "", indicateur = "", session = "", responsable = "", q = "" } = {}) {
  const seg = SEGMENTS.find((s) => s.id === segment) || SEGMENTS[3];
  const aiguille = normaliser(q.trim());
  // Valeurs inconnues ou non numériques (URL éditée à la main) : ignorées,
  // comportées comme « aucun filtre » plutôt que de vider la liste — l'URL
  // et l'interface restent en phase.
  const statutOk = STATUTS_ACTION[statut] ? statut : "";
  const prioriteOk = PRIORITES[priorite] ? priorite : "";
  const origineOk = ORIGINES[origine] ? origine : "";
  const idFiltre = (v) => { if (v === "") return null; const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
  const ind = idFiltre(indicateur);
  const sess = idFiltre(session);
  const resp = idFiltre(responsable);
  return (actions || []).filter((a) =>
    seg.test(a)
    && (!statutOk || a.statut === statutOk)
    && (!prioriteOk || a.priorite === prioriteOk)
    && (!origineOk || a.origine === origineOk)
    && (ind === null || (a.indicateurs || []).some((i) => i.id === ind))
    && (sess === null || a.session_id === sess)
    && (resp === null || a.responsable_id === resp)
    && (!aiguille || [a.titre, a.reference, a.responsable_nom].some((c) => normaliser(c).includes(aiguille))));
}

export function compterSegments(actions) {
  return Object.fromEntries(SEGMENTS.map((s) => [s.id, (actions || []).filter(s.test).length]));
}

// Indicateurs présents dans la liste (pour le filtre), triés par numéro.
export function indicateursPresents(actions) {
  return [...new Set((actions || []).flatMap((a) => (a.indicateurs || []).map((i) => i.id)))]
    .map((id) => (actions || []).flatMap((a) => a.indicateurs || []).find((i) => i.id === id))
    .filter(Boolean)
    .sort((a, b) => a.numero - b.numero);
}

// « Ind. 11, 23 +2 » : trois numéros au plus, le reste compté.
export function indicateursCompacts(indicateurs, max = 3) {
  const nums = (indicateurs || []).map((i) => i.numero).sort((a, b) => a - b);
  return { visibles: nums.slice(0, max), reste: Math.max(0, nums.length - max), tous: nums };
}

// ── Historique : mapper frontend centralisé ──────────────────
// Jamais de valeur JSON brute ; un événement inconnu retombe sur un
// libellé neutre. Les champs de contenu ne sont journalisés QUE par le
// fait (ancienne_valeur / nouvelle_valeur = null) : on n'affiche jamais
// de donnée personnelle.

const CHAMPS_CONTENU = {
  titre: "Titre",
  constat: "Constat",
  action_prevue: "Action prévue",
  resultat: "Résultat",
  controle_efficacite: "Contrôle d'efficacité",
  description: "Description",
  objet: "Objet",
  synthese_reponse: "Réponse",
};

const statut = (v) => STATUTS_ACTION[v]?.libelle || v || "—";
const priorite = (v) => PRIORITES[v]?.libelle || v || "—";
const date = (v) => formaterDate(v) || "—";

// Preuve citée par l'historique : titre si elle est encore liée (donc
// connue de la fiche), sinon mention neutre — jamais de contenu de fichier.
export function libellePreuve(id, preuves = []) {
  const p = preuves.find((x) => x.id === Number(id));
  return p ? p.titre : `Preuve (ID interne ${id})`;
}

// Retourne { titre, avant?, apres? } ou { titre } pour un événement.
export function decrireEvenement(ev, { indicateurs = [], utilisateurs = [], preuves = [] } = {}) {
  const ind = (id) => {
    const i = indicateurs.find((x) => x.id === Number(id));
    return i ? `Indicateur ${i.numero} — ${i.libelle}` : `Indicateur ${id}`;
  };
  const nom = (id) => {
    const u = utilisateurs.find((x) => x.id === Number(id));
    return u ? (u.nom || u.email) : "—";
  };

  if (ev.evenement === "creation") return { titre: "Action créée" };
  if (ev.evenement === "preuve_rattachee") return { titre: "Preuve rattachée", apres: libellePreuve(ev.nouvelle_valeur, preuves) };
  if (ev.evenement === "preuve_detachee") return { titre: "Lien avec une preuve retiré", apres: libellePreuve(ev.ancienne_valeur, preuves) };

  if (ev.evenement === "rattachement_indicateur") return { titre: "Indicateur ajouté", apres: ind(ev.nouvelle_valeur) };
  if (ev.evenement === "retrait_indicateur") return { titre: "Indicateur retiré", apres: ind(ev.ancienne_valeur) };

  if (ev.champ === "statut") return { titre: "Statut", avant: statut(ev.ancienne_valeur), apres: statut(ev.nouvelle_valeur) };
  if (ev.champ === "responsable_id") {
    if (!utilisateurs.length) return { titre: "Responsable modifié" };
    return { titre: "Responsable", avant: nom(ev.ancienne_valeur), apres: nom(ev.nouvelle_valeur) };
  }
  if (ev.champ === "priorite") return { titre: "Priorité", avant: priorite(ev.ancienne_valeur), apres: priorite(ev.nouvelle_valeur) };
  if (ev.champ === "echeance") return { titre: "Échéance", avant: date(ev.ancienne_valeur), apres: date(ev.nouvelle_valeur) };
  if (ev.champ === "date_mise_en_oeuvre") return { titre: "Date de mise en œuvre", avant: date(ev.ancienne_valeur), apres: date(ev.nouvelle_valeur) };
  if (ev.champ === "date_controle_efficacite") return { titre: "Date de contrôle", avant: date(ev.ancienne_valeur), apres: date(ev.nouvelle_valeur) };

  if (ev.champ && CHAMPS_CONTENU[ev.champ]) return { titre: `${CHAMPS_CONTENU[ev.champ]} modifié` };
  if (ev.champ === "signalement_id") return { titre: "Origine modifiée" };
  if (ev.champ === "formation_id" || ev.champ === "session_id") return { titre: "Contexte modifié" };

  return { titre: "Modification de l'action" };
}
