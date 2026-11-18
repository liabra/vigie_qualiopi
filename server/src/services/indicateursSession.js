// ─────────────────────────────────────────────────────────────
//  Indicateurs de résultats d'UNE session, pour les documents (bilan de session, méthodes de calcul).
//  Méthodes reprises du document A2C « Méthodes de calcul de l'indicateur de performance » :
//   - satisfaction : réponses « à chaud », note globale ramenée sur 5 ; satisfait = 4 ou 5 ;
//   - assiduité : heures suivies / heures prévues (calcul unique de assiduite.js), abandons exclus ;
//   - atteinte des objectifs : QCM final validé (ou score au moins égal au seuil, à défaut 5/10) ;
//   - abandon : inscriptions en abandon / toutes les inscriptions.
//  Un indicateur sans donnée vaut null (jamais 0 % inventé) ; les comptages valent 0.
//  Fonctions pures + un chargeur SQL (3 requêtes, indépendantes du nombre de documents).
// ─────────────────────────────────────────────────────────────
import { query } from "../db.js";
import { calculerAssiduite } from "./assiduite.js";

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);
const CATEGORIES = ["personnel", "professionnel", "financement", "reorientation", "sans_nouvelles"];

export function calculerIndicateurs({ inscriptions = [], heuresPrevues = null, satisfactions = [], qcm = [] } = {}) {
  const abandons = inscriptions.filter((i) => i.statut === "abandon");
  const actifs = inscriptions.filter((i) => i.statut !== "abandon");

  // Assiduité : somme des heures suivies sur la somme des heures prévues (inscriptions au taux fiable).
  let suivies = 0; let prevues = 0;
  for (const i of actifs) {
    const a = calculerAssiduite({ heuresPrevues, heuresAbsence: i.heures_absence, statut: i.statut });
    if (a.fiable) { suivies += a.heures_suivies; prevues += a.heures_prevues; }
  }
  const assiduite = pct(suivies, prevues);

  // Satisfaction « à chaud » : note ramenée sur 5, arrondie, bornée de 1 à 5.
  const niveaux = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let repondants = 0;
  for (const s of satisfactions) {
    const note = Number(s.note_globale); const max = Number(s.note_max);
    if (s.type !== "a_chaud" || s.note_globale === null || !Number.isFinite(note) || !Number.isFinite(max) || max <= 0) continue;
    niveaux[Math.min(5, Math.max(1, Math.round((note / max) * 5)))]++;
    repondants++;
  }

  // Atteinte des objectifs : dernier QCM de chaque stagiaire non en abandon.
  const dernier = new Map();
  for (const q of qcm) {
    if (q.type !== "qcm") continue;
    const p = dernier.get(q.inscription_id);
    if (!p || String(q.date_passage) > String(p.date_passage) || (String(q.date_passage) === String(p.date_passage) && q.id > p.id)) dernier.set(q.inscription_id, q);
  }
  let reussites = 0; let echecs = 0;
  for (const i of actifs) {
    const q = dernier.get(i.id);
    if (!q) continue;
    let ok = null;
    if (q.resultat === "valide") ok = true;
    else if (q.resultat === "non_valide") ok = false;
    else if (q.score !== null && q.score_max) ok = q.seuil_reussite !== null && q.seuil_reussite !== undefined ? Number(q.score) >= Number(q.seuil_reussite) : Number(q.score) / Number(q.score_max) >= 0.5;
    if (ok === true) reussites++; else if (ok === false) echecs++;
  }

  const motifs = Object.fromEntries(CATEGORIES.map((c) => [c, abandons.filter((i) => i.categorie_abandon === c).length]));
  motifs.autre = abandons.length - Object.values(motifs).reduce((a, b) => a + b, 0);
  const presc = (code) => actifs.filter((i) => i.prescripteur === code).length;
  const prescripteurs = { pole_emploi: presc("pole_emploi"), mission_locale: presc("mission_locale"), of: presc("of") };
  prescripteurs.autres = actifs.length - prescripteurs.pole_emploi - prescripteurs.mission_locale - prescripteurs.of;

  return {
    taux_satisfaction: pct(niveaux[5] + niveaux[4], repondants), repondants, niveaux,
    taux_assiduite: assiduite, taux_absence: assiduite === null ? null : 100 - assiduite,
    taux_abandon: pct(abandons.length, inscriptions.length), abandons: abandons.length, motifs,
    taux_atteinte: pct(reussites, reussites + echecs), reussites, echecs, prescripteurs,
  };
}

export async function chargerIndicateursSession(sessionId, heuresPrevues) {
  const [{ rows: inscriptions }, { rows: satisfactions }, { rows: qcm }] = await Promise.all([
    query(`SELECT i.id, i.statut, i.categorie_abandon, i.prescripteur,
                  COALESCE((SELECT sum(a.duree_heures) FROM absences a WHERE a.inscription_id = i.id), 0) AS heures_absence
           FROM inscriptions i WHERE i.session_id = $1`, [sessionId]),
    query("SELECT type, note_globale, note_max FROM satisfactions WHERE session_id = $1", [sessionId]),
    query(`SELECT q.id, q.inscription_id, q.type, q.date_passage, q.score, q.score_max, q.seuil_reussite, q.resultat
           FROM resultats_qcm q JOIN inscriptions i ON i.id = q.inscription_id WHERE i.session_id = $1 AND q.type = 'qcm'`, [sessionId]),
  ]);
  return calculerIndicateurs({ inscriptions, heuresPrevues, satisfactions, qcm });
}
