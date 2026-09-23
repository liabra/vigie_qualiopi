// ─────────────────────────────────────────────────────────────
//  Évaluations / QCM + satisfaction — validation et parsing PURS.
//  Aucune entrée/sortie : testable sans base ni Express. Le
//  rapprochement CSV (email, inscriptions) vit dans routes/gestion.js.
// ─────────────────────────────────────────────────────────────
import { normaliser } from "./csvStagiaires.js";

export const TYPES_EVALUATION = [
  "positionnement", "intermediaire", "qcm", "validation_etape", "evaluation_finale", "autre",
];
export const RESULTATS_EVALUATION = ["valide", "non_valide", "non_determine", "non_applicable"];
export const TYPES_SATISFACTION = ["a_chaud", "a_froid", "financeur", "entreprise", "formateur"];

// AAAA-MM-JJ strict, ou null.
export function dateValideStricte(v) {
  if (v === undefined || v === null || v === "") return null;
  const t = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t ? t : null;
}

// Normalise et valide les champs d'une évaluation. Retourne { champs, erreur }.
// `champs` ne contient QUE les colonnes à écrire. `avant` = valeurs actuelles.
export function champsEvaluation(corps, avant = {}) {
  const champs = {};
  const texte = (v) => (v === null ? null : String(v).trim() || null);

  if (corps.type !== undefined) {
    if (!TYPES_EVALUATION.includes(corps.type)) return { erreur: "Type d'évaluation inconnu." };
    champs.type = corps.type;
  }
  if (corps.intitule !== undefined) champs.intitule = texte(corps.intitule);
  if (corps.commentaire !== undefined) champs.commentaire = texte(corps.commentaire);

  if (corps.seuil_reussite !== undefined) {
    if (corps.seuil_reussite === null || corps.seuil_reussite === "") { champs.seuil_reussite = null; }
    else {
      const n = Number(corps.seuil_reussite);
      if (!Number.isFinite(n) || n < 0) return { erreur: "Seuil de réussite invalide." };
      champs.seuil_reussite = n;
    }
  }

  if (corps.date_passage !== undefined) {
    if (corps.date_passage === null || corps.date_passage === "") return { erreur: "Date de passage obligatoire." };
    const d = dateValideStricte(corps.date_passage);
    if (!d) return { erreur: "Date de passage invalide (format AAAA-MM-JJ)." };
    champs.date_passage = d;
  }

  if (corps.resultat !== undefined) {
    if (!RESULTATS_EVALUATION.includes(corps.resultat)) return { erreur: "Résultat inconnu." };
    champs.resultat = corps.resultat;
  }
  if (corps.drive_file_id !== undefined) champs.drive_file_id = texte(corps.drive_file_id);

  // Score / score_max : toujours en paire (les deux renseignés ou les deux
  // absents). Un score seul sans maximum est refusé.
  const scoreFourni = corps.score !== undefined;
  const maxFourni = corps.score_max !== undefined;
  if (scoreFourni !== maxFourni) return { erreur: "Score et score maximum doivent être fournis ensemble." };
  if (scoreFourni) {
    const sv = corps.score === null || corps.score === "" ? null : Number(corps.score);
    const mv = corps.score_max === null || corps.score_max === "" ? null : Number(corps.score_max);
    if (sv !== null && (!Number.isFinite(sv) || sv < 0)) return { erreur: "Score invalide." };
    if (mv !== null && (!Number.isFinite(mv) || mv <= 0)) return { erreur: "Score maximum invalide." };
    if (sv !== null && mv !== null && sv > mv) return { erreur: "Le score dépasse le maximum." };
    champs.score = sv;
    champs.score_max = mv;
  }

  // Cohérence seuil / score_max sur les valeurs FINALES :
  //   - seuil >= 0 (déjà vérifié à la saisie) ;
  //   - seuil <= score_max si score_max renseigné ;
  //   - pas de seuil sans score_max.
  // Le `resultat` n'est JAMAIS déduit du seuil.
  const scoreMaxFinal = champs.score_max !== undefined ? champs.score_max : (avant.score_max ?? null);
  const seuilFinal = champs.seuil_reussite !== undefined ? champs.seuil_reussite : (avant.seuil_reussite ?? null);
  if (seuilFinal !== null && seuilFinal !== undefined) {
    if (scoreMaxFinal === null || scoreMaxFinal === undefined) {
      return { erreur: "Un seuil de réussite ne peut pas être renseigné sans score maximum." };
    }
    if (seuilFinal > scoreMaxFinal) {
      return { erreur: "Le seuil de réussite dépasse le score maximum." };
    }
  }

  return { champs };
}

// Normalise et valide les champs d'une satisfaction. { champs, erreur }.
export function champsSatisfaction(corps, avant = {}) {
  const champs = {};
  const texte = (v) => (v === null ? null : String(v).trim() || null);

  if (corps.type !== undefined) {
    if (!TYPES_SATISFACTION.includes(corps.type)) return { erreur: "Type de satisfaction inconnu." };
    champs.type = corps.type;
  }
  if (corps.date_recueil !== undefined) {
    if (corps.date_recueil === null || corps.date_recueil === "") return { erreur: "Date de recueil obligatoire." };
    const d = dateValideStricte(corps.date_recueil);
    if (!d) return { erreur: "Date de recueil invalide (format AAAA-MM-JJ)." };
    champs.date_recueil = d;
  }
  if (corps.note_globale !== undefined) {
    if (corps.note_globale === null || corps.note_globale === "") { champs.note_globale = null; }
    else {
      const n = Number(corps.note_globale);
      if (!Number.isFinite(n) || n < 0) return { erreur: "Note globale invalide." };
      champs.note_globale = n;
    }
  }
  if (corps.note_max !== undefined) {
    if (corps.note_max === null || corps.note_max === "") return { erreur: "Note maximum invalide." };
    const n = Number(corps.note_max);
    if (!Number.isFinite(n) || n <= 0) return { erreur: "Note maximum invalide." };
    champs.note_max = n;
  }
  if (corps.commentaires !== undefined) champs.commentaires = texte(corps.commentaires);
  if (corps.reponses !== undefined) champs.reponses = corps.reponses;
  if (corps.drive_file_id !== undefined) champs.drive_file_id = texte(corps.drive_file_id);

  // Note <= note_max sur les valeurs FINALES.
  const note = champs.note_globale !== undefined ? champs.note_globale : avant.note_globale;
  const max = champs.note_max !== undefined ? champs.note_max : (avant.note_max ?? 5);
  if (note !== null && note !== undefined && max !== null && max !== undefined && note > max) {
    return { erreur: "La note dépasse le maximum." };
  }
  return { champs };
}

// ── CSV résultats ────────────────────────────────────────────

// Colonnes canoniques et noms d'en-têtes tolérés (normalisés).
const CORRESPONDANCES_RESULTATS = [
  ["email", ["email", "mail", "courriel", "mel", "adresseemail"]],
  ["nom", ["nom", "name", "nomdefamille", "nomusage"]],
  ["prenom", ["prenom", "firstname", "givenname"]],
  ["type", ["type", "typedevaluation", "evaluation", "typedeval"]],
  ["intitule", ["intitule", "libelle", "titre", "evaluationlibelle", "nomdelevaluation"]],
  ["date", ["date", "datepassage", "dateeval", "datedevaluation"]],
  ["score", ["score", "note", "points", "resultatnumerique"]],
  ["score_max", ["scoremax", "scoremaximum", "maximum", "notemax", "total", "sur", "max", "scoretotal"]],
  ["pourcentage", ["pourcentage", "pct", "pourcent"]],
  ["seuil", ["seuil", "seuilreussite", "seuildereussite", "seuilvalidation"]],
  ["resultat", ["resultat", "statut", "validation", "reussi"]],
  ["commentaire", ["commentaire", "comment", "remarque", "observation"]],
];

// { colonnes: { index -> canonique }, inconnus, ambigus } — même contrat que
// construireMapping du CSV stagiaires, mais pour les colonnes de résultats.
export function construireMappingResultats(enTetes) {
  const colonnes = {};
  const inconnus = [];
  const ambigus = [];
  const vus = new Map();
  enTetes.forEach((tete, i) => {
    const cle = normaliser(tete);
    if (!cle) return;
    const trouve = CORRESPONDANCES_RESULTATS.find(([, noms]) => noms.includes(cle));
    if (!trouve) { inconnus.push(tete); return; }
    const [canonique] = trouve;
    if (vus.has(canonique)) { ambigus.push({ cle: canonique, noms: [...vus.get(canonique), tete] }); return; }
    vus.set(canonique, [tete]);
    colonnes[i] = canonique;
  });
  return { colonnes, inconnus, ambigus };
}

// Date CSV tolérante : AAAA-MM-JJ ou JJ/MM/AAAA. Renvoie AAAA-MM-JJ ou null.
export function dateDeCsv(v) {
  const t = String(v ?? "").trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return dateValideStricte(`${m[1]}-${m[2]}-${m[3]}`);
  m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return dateValideStricte(`${m[3]}-${m[2]}-${m[1]}`);
  return null;
}

// Nombre CSV : virgule décimale tolérée. { valeur } ou { erreur }.
export function lireNombreCsv(v) {
  const t = String(v ?? "").trim();
  if (!t) return { valeur: null };
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n)) return { erreur: `Nombre illisible : ${v}` };
  return { valeur: n };
}

// Libellés tolérants → type canonique, ou null si inconnu.
export function typeEvaluationCsv(v) {
  const n = normaliser(v);
  if (!n) return null;
  return {
    positionnement: "positionnement", positionnementinitial: "positionnement", initial: "positionnement",
    qcm: "qcm", quiz: "qcm", quizz: "qcm", test: "qcm",
    validation: "validation_etape", validationetape: "validation_etape", etape: "validation_etape", validationdetape: "validation_etape",
    intermediaire: "intermediaire",
    finale: "evaluation_finale", evaluationfinale: "evaluation_finale", evaluationfinal: "evaluation_finale", eval: "evaluation_finale",
    autre: "autre", autres: "autre",
  }[n] ?? null;
}

// Libellés tolérants → résultat canonique (vide ⇒ non_determine), null si inconnu.
export function resultatCsv(v) {
  const n = normaliser(v);
  if (!n) return "non_determine";
  if (["valide", "oui", "ok", "reussi", "vrai", "1", "acquise", "acquis"].includes(n)) return "valide";
  if (["nonvalide", "nonvalide", "ko", "non", "echoue", "echec", "0", "nonacquis", "nonacquise"].includes(n)) return "non_valide";
  if (["nonapplicable", "nonapplicable", "na", "sansobjet"].includes(n)) return "non_applicable";
  if (["nondetermine", "nondetermine", "indetermine", "indetermine", "?"].includes(n)) return "non_determine";
  return null;
}
