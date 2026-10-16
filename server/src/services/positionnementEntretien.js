// ─────────────────────────────────────────────────────────────
//  DOC-9D2 lot B — Questionnaire de positionnement (rubrique 8, 6 phases).
//  Module PUR : aucune base, aucun réseau.
//
//  Référentiel FERMÉ, transcrit depuis
//  `modeles-local/entree/FSE-IA_Rubrique_8_Positionnement_SOURCE.md`
//  (modèle réel FSE-IA) : 6 phases, 34 compétences au total (4, 8, 8, 5, 6,
//  3). Aucune compétence, aucun niveau, aucune priorité n'est inventé ici —
//  toute compétence hors de ce référentiel est refusée.
//
//  Volontairement ABSENTS : aucun score, aucune moyenne, aucun seuil, aucun
//  résultat global (le modèle réel n'en définit aucun pour cette rubrique).
//  Aucune donnée de la rubrique 2 (handicap).
// ─────────────────────────────────────────────────────────────

export const NIVEAUX_COMPETENCE = Object.freeze(["autonome", "avec_aide", "a_developper"]);
export const PRIORITES_PHASE = Object.freeze(["forte", "moyenne", "faible"]);

export const PHASES_POSITIONNEMENT = Object.freeze([
  {
    phase: 1, titre: "Accueil, diagnostic et construction du parcours", dureeHeures: 45,
    competences: [
      { code: "p1_c1", libelle: "Connaît les droits et devoirs liés à un parcours de formation" },
      { code: "p1_c2", libelle: "Est en capacité d'exprimer ses attentes et ses freins" },
      { code: "p1_c3", libelle: "Comprend le déroulement et les objectifs du parcours FSE-IA" },
      { code: "p1_c4", libelle: "A identifié, avec l'accompagnateur, des objectifs personnalisés" },
    ],
  },
  {
    phase: 2, titre: "Développement des compétences numériques et découverte de l'intelligence artificielle", dureeHeures: 60,
    competences: [
      { code: "p2_c1", libelle: "Maîtrise les outils numériques du quotidien (ordinateur, tablette, smartphone)" },
      { code: "p2_c2", libelle: "Sait travailler de manière collaborative avec des outils numériques" },
      { code: "p2_c3", libelle: "Connaît le fonctionnement de base d'un outil d'intelligence artificielle" },
      { code: "p2_c4", libelle: "A déjà utilisé un outil d'IA type ChatGPT" },
      { code: "p2_c5", libelle: "Sait utiliser l'IA pour créer un CV" },
      { code: "p2_c6", libelle: "Sait utiliser l'IA pour rédiger une lettre de motivation" },
      { code: "p2_c7", libelle: "Sait utiliser l'IA pour rechercher un emploi / préparer un entretien" },
      { code: "p2_c8", libelle: "Fait preuve d'esprit critique face aux réponses produites par l'IA" },
    ],
  },
  {
    phase: 3, titre: "Développement des compétences psychosociales et de la communication", dureeHeures: 57,
    competences: [
      { code: "p3_c1", libelle: "Est à l'aise pour prendre la parole en public" },
      { code: "p3_c2", libelle: "Est à l'aise à l'oral" },
      { code: "p3_c3", libelle: "Est à l'aise à l'écrit" },
      { code: "p3_c4", libelle: "Sait rédiger un courriel professionnel" },
      { code: "p3_c5", libelle: "Sait valoriser son parcours" },
      { code: "p3_c6", libelle: "Sait gérer son stress" },
      { code: "p3_c7", libelle: "A confiance en lui / elle" },
      { code: "p3_c8", libelle: "Coopère facilement au sein d'un groupe" },
    ],
  },
  {
    phase: 4, titre: "Découverte du monde professionnel", dureeHeures: 42,
    competences: [
      { code: "p4_c1", libelle: "A déjà réalisé une immersion professionnelle ou un stage de découverte" },
      { code: "p4_c2", libelle: "A déjà rencontré des recruteurs ou des professionnels d'un secteur" },
      { code: "p4_c3", libelle: "Connaît le fonctionnement général d'une entreprise" },
      { code: "p4_c4", libelle: "A une idée du ou des secteurs d'activité qui l'intéressent" },
      { code: "p4_c5", libelle: "Est prêt(e) à participer à des visites d'entreprises, collectivités ou structures locales" },
    ],
  },
  {
    phase: 5, titre: "Préparation active à l'emploi", dureeHeures: 52,
    competences: [
      { code: "p5_c1", libelle: "A déjà passé un entretien d'embauche" },
      { code: "p5_c2", libelle: "Dispose d'un CV à jour" },
      { code: "p5_c3", libelle: "Dispose d'une lettre de motivation" },
      { code: "p5_c4", libelle: "Sait se présenter en entretien" },
      { code: "p5_c5", libelle: "A déjà utilisé l'IA pour analyser une offre d'emploi ou personnaliser une candidature" },
      { code: "p5_c6", libelle: "Sait constituer un portfolio numérique (CV, lettres, attestations, productions IA)" },
    ],
  },
  {
    phase: 6, titre: "Bilan et valorisation des acquis (non certifiante)", dureeHeures: 14,
    competences: [
      { code: "p6_c1", libelle: "Est capable de s'auto-évaluer" },
      { code: "p6_c2", libelle: "Est à l'aise pour restituer son travail devant un groupe" },
      { code: "p6_c3", libelle: "Se sent en capacité de présenter ses compétences devant des partenaires, employeurs ou sa famille" },
    ],
  },
]);

// Index plat code → { phase, libelle }, et ensemble des phases valides —
// construits une fois, jamais recalculés à la volée.
export const COMPETENCES_PAR_CODE = Object.freeze(
  Object.fromEntries(
    PHASES_POSITIONNEMENT.flatMap((p) => p.competences.map((c) => [c.code, { phase: p.phase, libelle: c.libelle }]))
  )
);
export const PHASES_VALIDES = Object.freeze(new Set(PHASES_POSITIONNEMENT.map((p) => p.phase)));

export const MAX_OBSERVATIONS = 4000;

// Valide UNE évaluation `{ competence_code, niveau }`. La phase est DÉRIVÉE
// du code, jamais fournie par l'appelant (pas de désaccord possible).
export function validerEvaluation(e) {
  const code = typeof e?.competence_code === "string" ? e.competence_code.trim() : "";
  const ref = COMPETENCES_PAR_CODE[code];
  if (!ref) return { erreur: `Compétence inconnue : ${code || "(vide)"}.` };
  const niveau = typeof e?.niveau === "string" ? e.niveau.trim() : "";
  if (!NIVEAUX_COMPETENCE.includes(niveau)) return { erreur: `Niveau invalide pour « ${code} ».` };
  return { competence_code: code, phase: ref.phase, niveau };
}

export function validerEvaluations(liste) {
  if (!Array.isArray(liste)) return { erreur: "Évaluations invalides : liste attendue." };
  const vues = new Set();
  const evaluations = [];
  for (const e of liste) {
    const v = validerEvaluation(e);
    if (v.erreur) return { erreur: v.erreur };
    if (vues.has(v.competence_code)) return { erreur: `Compétence en double : ${v.competence_code}.` };
    vues.add(v.competence_code);
    evaluations.push(v);
  }
  return { evaluations };
}

// Valide UNE phase `{ phase, priorite, observations }`. `priorite` et
// `observations` sont tous deux FACULTATIFS indépendamment (une phase peut
// n'avoir qu'une observation sans priorité choisie, ou l'inverse).
export function validerPhase(p) {
  const phase = Number(p?.phase);
  if (!PHASES_VALIDES.has(phase)) return { erreur: `Phase invalide : ${p?.phase}.` };
  let priorite = null;
  if (p?.priorite != null && p.priorite !== "") {
    priorite = typeof p.priorite === "string" ? p.priorite.trim() : "";
    if (!PRIORITES_PHASE.includes(priorite)) return { erreur: `Priorité invalide pour la phase ${phase}.` };
  }
  let observations = null;
  if (p?.observations != null && p.observations !== "") {
    observations = typeof p.observations === "string" ? p.observations.trim() : "";
    if (observations.length > MAX_OBSERVATIONS) return { erreur: `Observations trop longues pour la phase ${phase}.` };
  }
  if (priorite === null && observations === null) return { erreur: `Phase ${phase} vide : omettez-la plutôt que de l'envoyer sans contenu.` };
  return { phase, priorite, observations };
}

export function validerPhases(liste) {
  if (!Array.isArray(liste)) return { erreur: "Phases invalides : liste attendue." };
  const vues = new Set();
  const phases = [];
  for (const p of liste) {
    const v = validerPhase(p);
    if (v.erreur) return { erreur: v.erreur };
    if (vues.has(v.phase)) return { erreur: `Phase en double : ${v.phase}.` };
    vues.add(v.phase);
    phases.push(v);
  }
  return { phases };
}
