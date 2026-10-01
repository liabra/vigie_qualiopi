// Qualité — Signalements : libellés, compteurs, segments, filtres et retard.
// Module PUR (aucun React, aucun réseau) : testable seul. Les valeurs
// viennent du serveur ; jamais de valeur technique affichée.
import { aujourdhuiISO, libellePreuve } from "./format.js";

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

// ── Q1-B3-B2 : formulaire, transitions, historique ─────────────────

const txt = (v) => String(v ?? "").trim();
const idOuVide = (v) => (v === null || v === undefined || v === "" ? "" : String(v));

// Valeurs vides du formulaire (création).
export const SIGNALEMENT_VIDE = {
  type: "reclamation", objet: "", date_constat: "", description: "", responsable_id: "",
  formation_id: "", session_id: "", inscription_id: "", personne_concernee_libelle: "",
  reclamant_nom: "", reclamant_entreprise: "", reclamant_email: "", canal: "",
  delai_cible_jours_ouvres: "", date_echeance_cible: "",
  causes: [], cause_autre_libelle: "", indicateur_ids: [],
  synthese_reponse: "", date_reponse: "",
};

// Valeurs du formulaire préremplies depuis un signalement existant.
export function valeursDepuisSignalement(s) {
  return {
    type: s.type, objet: s.objet || "", date_constat: (s.date_constat || "").slice(0, 10),
    description: s.description || "", responsable_id: idOuVide(s.responsable_id),
    formation_id: idOuVide(s.formation_id), session_id: idOuVide(s.session_id),
    inscription_id: idOuVide(s.inscription_id), personne_concernee_libelle: s.personne_concernee_libelle || "",
    reclamant_nom: s.reclamant_nom || "", reclamant_entreprise: s.reclamant_entreprise || "",
    reclamant_email: s.reclamant_email || "", canal: s.canal || "",
    delai_cible_jours_ouvres: idOuVide(s.delai_cible_jours_ouvres),
    date_echeance_cible: (s.date_echeance_cible || "").slice(0, 10),
    causes: [...(s.causes || [])], cause_autre_libelle: s.cause_autre_libelle || "",
    indicateur_ids: (s.indicateurs || []).map((i) => i.id),
    synthese_reponse: s.synthese_reponse || "", date_reponse: (s.date_reponse || "").slice(0, 10),
  };
}

// Erreurs de saisie bloquantes AVANT l'appel serveur (le serveur reste juge).
export function erreursSignalement(v) {
  const e = {};
  if (!txt(v.objet)) e.objet = "Indiquez l'objet du signalement.";
  if ((v.causes || []).includes("autre") && !txt(v.cause_autre_libelle)) e.cause_autre_libelle = "Précisez la cause « Autre ».";
  if (v.type === "reclamation" && v.delai_cible_jours_ouvres !== "" && !(Number.isInteger(Number(v.delai_cible_jours_ouvres)) && Number(v.delai_cible_jours_ouvres) > 0)) {
    e.delai_cible_jours_ouvres = "Indiquez un nombre entier de jours ouvrés.";
  }
  return e;
}

const CHAMPS_RECLAMATION = ["reclamant_nom", "reclamant_entreprise", "reclamant_email", "canal"];

// Corps envoyé à l'API. `date_resolution` n'est JAMAIS envoyée (seule
// l'action « Résoudre » la pose).
//  · CRÉATION : les clés vides sont OMISES (le serveur applique alors son
//    défaut : 15 jours ouvrés et échéance calculée) ; données réclamant
//    envoyées uniquement pour une réclamation.
//  · MODIFICATION : jeu complet des champs éditables (null = effacer), SAUF
//    le délai vide (omis : on ne l'efface pas) ; type jamais envoyé.
//  · Session choisie ⇒ formation déduite par le serveur (jamais de
//    formation contradictoire) ; inscription seulement avec sa session.
//  · `initial` (modification) : un responsable INCHANGÉ n'est pas renvoyé —
//    le serveur refuserait un responsable depuis désactivé.
export function corpsSignalement(v, { creation = false, initial = null } = {}) {
  const reclamation = v.type === "reclamation";
  const session = v.session_id ? Number(v.session_id) : null;
  const inscription = session && v.inscription_id ? Number(v.inscription_id) : null;
  const formation = session ? null : (v.formation_id ? Number(v.formation_id) : null);
  const causes = [...new Set(v.causes || [])];
  const autre = causes.includes("autre");

  if (creation) {
    const c = { type: v.type, objet: txt(v.objet) };
    const ajoute = (cle, val) => { if (val !== null && val !== undefined && val !== "") c[cle] = val; };
    ajoute("date_constat", v.date_constat);
    ajoute("description", txt(v.description));
    ajoute("responsable_id", v.responsable_id ? Number(v.responsable_id) : null);
    ajoute("session_id", session);
    ajoute("inscription_id", inscription);
    ajoute("formation_id", formation);
    if (!inscription) ajoute("personne_concernee_libelle", txt(v.personne_concernee_libelle));
    if (causes.length) {
      c.causes = causes;
      if (autre) c.cause_autre_libelle = txt(v.cause_autre_libelle);
    }
    if ((v.indicateur_ids || []).length) c.indicateur_ids = v.indicateur_ids.map(Number);
    if (reclamation) {
      for (const k of CHAMPS_RECLAMATION) ajoute(k, txt(v[k]));
      ajoute("delai_cible_jours_ouvres", v.delai_cible_jours_ouvres === "" ? null : Number(v.delai_cible_jours_ouvres));
      ajoute("date_echeance_cible", v.date_echeance_cible);
    }
    return c;
  }

  const n = (val) => (val === "" || val === undefined ? null : val);
  const c = {
    objet: txt(v.objet),
    date_constat: n(v.date_constat),
    description: n(txt(v.description)),
    responsable_id: v.responsable_id ? Number(v.responsable_id) : null,
    session_id: session,
    inscription_id: inscription,
    formation_id: formation,
    personne_concernee_libelle: inscription ? null : n(txt(v.personne_concernee_libelle)),
    causes,
    cause_autre_libelle: autre ? txt(v.cause_autre_libelle) : null,
    indicateur_ids: (v.indicateur_ids || []).map(Number),
    synthese_reponse: n(txt(v.synthese_reponse)),
    date_reponse: n(v.date_reponse),
  };
  if (initial && (c.responsable_id ?? null) === (initial.responsable_id ?? null)) delete c.responsable_id;
  if (reclamation) {
    for (const k of CHAMPS_RECLAMATION) c[k] = n(txt(v[k]));
    if (v.delai_cible_jours_ouvres !== "") c.delai_cible_jours_ouvres = Number(v.delai_cible_jours_ouvres);
    c.date_echeance_cible = n(v.date_echeance_cible);
  }
  return c;
}

// Options d'inscription : UNIQUEMENT id, nom, prénom et statut. Les autres
// données de GET /api/sessions/:id (e-mail, téléphone, handicap, besoins…)
// ne sont jamais conservées côté interface.
export function optionsInscriptions(stagiaires) {
  return (stagiaires || []).map((s) => ({ inscription_id: s.inscription_id, nom: s.nom || "", prenom: s.prenom || "", statut: s.statut || null }));
}
export const libelleInscription = (o) => `${o.nom} ${o.prenom}`.trim() + (o.statut === "abandon" ? " (abandon)" : "");

// Boutons métier par statut — strictement les routes backend existantes.
const T = {
  modifier: { id: "modifier", libelle: "Modifier" },
  qualifier: { id: "qualifier", libelle: "Qualifier" },
  traiter: { id: "traiter", libelle: "Démarrer le traitement" },
  resoudre: { id: "resoudre", libelle: "Résoudre" },
  cloturer: { id: "cloturer", libelle: "Clôturer" },
  rouvrir: { id: "rouvrir", libelle: "Réouvrir" },
  annuler: { id: "annuler", libelle: "Annuler" },
};
export function transitionsSignalement(statut) {
  switch (statut) {
    case "ouverte": return [T.modifier, T.qualifier, T.annuler];
    case "qualifiee": return [T.modifier, T.traiter, T.annuler];
    case "en_traitement": return [T.modifier, T.resoudre, T.annuler];
    case "resolue": return [T.modifier, T.cloturer, T.annuler];
    case "cloturee": return [T.rouvrir];
    default: return [];
  }
}

// ── Historique lisible ───────────────────────────────────────
// Les champs sensibles ne sont journalisés que comme FAIT (valeurs
// nulles côté serveur) : on n'affiche jamais d'ancienne / nouvelle valeur.
const EVENEMENTS_STATUT = {
  creation: "Signalement créé",
  qualifier: "Signalement qualifié",
  traiter: "Traitement démarré",
  resoudre: "Signalement résolu",
  cloturer: "Signalement clôturé",
  rouvrir: "Signalement réouvert",
  annuler: "Signalement annulé",
};
const CHAMPS_FAIT = {
  objet: "Objet modifié",
  description: "Description modifiée",
  reclamant_nom: "Informations du réclamant modifiées",
  reclamant_entreprise: "Informations du réclamant modifiées",
  reclamant_email: "Informations du réclamant modifiées",
  personne_concernee_libelle: "Personne concernée modifiée",
  synthese_reponse: "Réponse mise à jour",
  cause_autre_libelle: "Précision de la cause « Autre » modifiée",
  causes: "Causes mises à jour",
  formation_id: "Contexte modifié",
  session_id: "Contexte modifié",
  inscription_id: "Contexte modifié",
};
const dateLisible = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "non renseignée";
};

// `indicateurs` : indicateurs connus (référentiel actif + liés au
// signalement). `noms` : Map id → nom (utilisateurs actifs + noms fournis
// par le détail). Retourne { titre, avant?, apres? }.
export function decrireEvenementSignalement(ev, { indicateurs = [], noms = new Map(), preuves = [] } = {}) {
  const ind = (id) => {
    const i = indicateurs.find((x) => x.id === Number(id));
    return i ? `Indicateur ${i.numero} — ${i.libelle}` : `Indicateur historique (ID interne ${id})`;
  };
  const nom = (id) => (id === null || id === undefined || id === "" ? "Aucun" : noms.get(Number(id)) || "Utilisateur indisponible");

  if (EVENEMENTS_STATUT[ev.evenement]) return { titre: EVENEMENTS_STATUT[ev.evenement] };
  if (ev.evenement === "rattachement_indicateur") return { titre: "Indicateur ajouté", apres: ind(ev.nouvelle_valeur) };
  if (ev.evenement === "retrait_indicateur") return { titre: "Indicateur retiré", apres: ind(ev.ancienne_valeur) };
  if (ev.evenement === "preuve_rattachee") return { titre: "Preuve rattachée", apres: libellePreuve(ev.nouvelle_valeur, preuves) };
  if (ev.evenement === "preuve_detachee") return { titre: "Lien avec une preuve retiré", apres: libellePreuve(ev.ancienne_valeur, preuves) };
  if (ev.evenement !== "modification") return { titre: "Signalement mis à jour" };

  if (CHAMPS_FAIT[ev.champ]) return { titre: CHAMPS_FAIT[ev.champ] };
  if (ev.champ === "responsable_id") return { titre: "Responsable", avant: nom(ev.ancienne_valeur), apres: nom(ev.nouvelle_valeur) };
  if (ev.champ === "date_echeance_cible") return { titre: "Échéance", avant: dateLisible(ev.ancienne_valeur), apres: dateLisible(ev.nouvelle_valeur) };
  if (ev.champ === "date_constat") return { titre: "Date de constat / réception", avant: dateLisible(ev.ancienne_valeur), apres: dateLisible(ev.nouvelle_valeur) };
  if (ev.champ === "date_reponse") return { titre: "Date de réponse", avant: dateLisible(ev.ancienne_valeur), apres: dateLisible(ev.nouvelle_valeur) };
  if (ev.champ === "canal") return { titre: "Canal", avant: CANAUX_SIGNALEMENT[ev.ancienne_valeur] || "Non renseigné", apres: CANAUX_SIGNALEMENT[ev.nouvelle_valeur] || "Non renseigné" };
  if (ev.champ === "delai_cible_jours_ouvres") {
    const j = (v) => (v ? `${v} jours ouvrés` : "non renseigné");
    return { titre: "Délai cible", avant: j(ev.ancienne_valeur), apres: j(ev.nouvelle_valeur) };
  }
  return { titre: "Signalement mis à jour" };
}

// Carte id → nom pour l'historique : utilisateurs actifs, puis noms
// conservés par le détail (même pour un compte désactivé).
export function nomsConnus(utilisateurs = [], signalement = {}, historique = []) {
  const m = new Map();
  for (const u of utilisateurs) m.set(u.id, u.nom || u.email);
  const s = signalement || {};
  for (const [id, n] of [[s.responsable_id, s.responsable_nom], [s.cree_par, s.cree_par_nom], [s.cloture_par, s.cloture_par_nom], [s.annulee_par, s.annulee_par_nom]]) {
    if (id && n) m.set(id, n);
  }
  for (const h of historique || []) if (h.par && h.acteur_nom) m.set(h.par, h.acteur_nom);
  return m;
}
