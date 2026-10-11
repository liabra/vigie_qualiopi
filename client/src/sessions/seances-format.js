// Séances : formats et validation d'affichage. Module PUR (aucun React,
// aucun appel réseau) : testable seul. Aucune règle métier n'est décidée
// ici — les bornes et formats viennent du serveur.

// « 09:00:00 » ou « 09:00 » → « 09:00 » ; vide → "".
export function formaterHeureSeance(h) {
  const t = String(h || "").trim();
  return t.length >= 5 ? t.slice(0, 5) : t;
}

// Créneau « 09:00 – 12:00 », « 09:00 », ou "" si rien.
export function creneauxSeance(seance) {
  const d = formaterHeureSeance(seance?.heure_debut);
  const f = formaterHeureSeance(seance?.heure_fin);
  if (d && f) return `${d} – ${f}`;
  return d || f || "";
}

// « Session entière » pour une séance commune, sinon le nom du groupe.
export function libelleGroupe(seance) {
  return seance?.groupe_nom || "Session entière";
}

// Un suivi est « renseigné » dès qu'au moins un champ contient du texte.
export function suiviRenseigne(suivi) {
  return ["accompagnement", "difficultes", "impressions", "observations"].some((c) => String(suivi?.[c] || "").trim());
}

// Validation du formulaire : { champ: message }. La date est obligatoire ;
// fin ≤ début est refusée quand les deux heures sont présentes.
export function erreursSeance(v) {
  const e = {};
  if (!String(v.date_seance || "").trim()) e.date_seance = "Indiquez la date.";
  if (v.phase_numero !== "" && (!Number.isInteger(Number(v.phase_numero)) || Number(v.phase_numero) <= 0)) {
    e.phase_numero = "La phase doit être un entier positif.";
  }
  const d = String(v.heure_debut || "").trim();
  const f = String(v.heure_fin || "").trim();
  if (d && f && f <= d) e.heure_fin = "L'heure de fin doit être postérieure à l'heure de début.";
  return e;
}

// Corps envoyé à l'API (null pour les champs vides).
export function corpsSeance(v) {
  return {
    date_seance: String(v.date_seance).trim(),
    groupe_id: v.groupe_id === "" ? null : Number(v.groupe_id),
    phase_numero: v.phase_numero === "" ? null : Number(v.phase_numero),
    heure_debut: String(v.heure_debut || "").trim() || null,
    heure_fin: String(v.heure_fin || "").trim() || null,
    theme: String(v.theme || "").trim() || null,
    competences: Array.isArray(v.competences) ? v.competences : [],
    activites: String(v.activites || "").trim() || null,
    lieu: String(v.lieu || "").trim() || null,
  };
}

export function seanceVide() {
  return { date_seance: "", groupe_id: "", phase_numero: "", heure_debut: "", heure_fin: "", theme: "", competences: [], activites: "", lieu: "" };
}

// Une séance appartient au filtre de groupe : commune (groupe_id null) ou de
// ce groupe. `filtreGroupe` "" = toutes.
export function seanceCorrespond(seance, filtreGroupe) {
  if (!filtreGroupe) return true;
  return seance?.groupe_id == null || String(seance.groupe_id) === String(filtreGroupe);
}
