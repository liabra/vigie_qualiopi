// Acquisition des compétences par stagiaire (migration 045). Les compétences proposées viennent de la version de
// formation de la session puis des séances ; seul le STATUT est saisi (acquis / en cours / pas acquis).
import { query } from "../db.js";
import { modulesDeSession } from "./modulesFormation.js";

export const STATUTS_COMPETENCE = ["acquis", "en_cours", "non_acquis"];
export const LIBELLES_STATUT_COMPETENCE = { acquis: "Acquis", en_cours: "En cours d'acquisition", non_acquis: "Pas acquis" };

// Liste ordonnée sans doublon des compétences d'une session (modules de la formation, puis version de formation, puis séances par date).
export async function competencesDeSession(sessionId) {
  const { rows: [v] } = await query(
    "SELECT COALESCE(fv.competences, '{}') AS competences FROM sessions s LEFT JOIN formation_versions fv ON fv.id = s.formation_version_id WHERE s.id = $1", [sessionId]);
  const { rows: seances } = await query("SELECT competences FROM seances WHERE session_id = $1 ORDER BY date_seance, heure_debut, id", [sessionId]);
  const modules = await modulesDeSession(sessionId);
  const vues = new Set(); const liste = [];
  for (const c of [...modules.flatMap((m) => m.competences), ...(v?.competences || []), ...seances.flatMap((s) => s.competences || [])]) {
    const t = String(c || "").trim();
    if (t && !vues.has(t)) { vues.add(t); liste.push(t); }
  }
  return liste;
}

// Corps PUT : { competences: [{ competence, statut }] } — état complet voulu. Statut absent/null = effacement de la ligne.
export function lireCompetences(corps = {}, autorisees = []) {
  if (!Array.isArray(corps.competences)) return { erreur: "Liste de compétences attendue." };
  if (corps.competences.length > 200) return { erreur: "Trop de compétences." };
  const permises = new Set(autorisees);
  const lignes = []; const vues = new Set();
  for (const l of corps.competences) {
    if (!l || typeof l !== "object" || typeof l.competence !== "string") return { erreur: "Compétence invalide." };
    const competence = l.competence.trim();
    if (!competence || competence.length > 300) return { erreur: "Compétence invalide." };
    if (!permises.has(competence)) return { erreur: "Compétence inconnue pour cette session." };
    if (vues.has(competence)) return { erreur: "Compétence en double." };
    vues.add(competence);
    if (l.statut === null || l.statut === undefined || l.statut === "") continue;
    if (!STATUTS_COMPETENCE.includes(l.statut)) return { erreur: "Statut de compétence inconnu." };
    lignes.push({ competence, statut: l.statut });
  }
  return { lignes };
}
