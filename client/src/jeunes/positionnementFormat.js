// DOC-9D2 lot B — Miroir CÔTÉ CLIENT de
// `server/src/services/positionnementEntretien.js` (PHASES_POSITIONNEMENT) :
// uniquement pour l'affichage. La validation réelle et la liste fermée des
// 34 compétences restent UNIQUEMENT côté serveur.
//
// Transcrit depuis `modeles-local/entree/FSE-IA_Rubrique_8_Positionnement_SOURCE.md`
// (modèle réel FSE-IA) — aucune compétence, aucun niveau, aucune priorité
// n'est inventé ici.

export const NIVEAUX_COMPETENCE = [
  { valeur: "autonome", libelle: "Autonome" },
  { valeur: "avec_aide", libelle: "Avec aide" },
  { valeur: "a_developper", libelle: "À développer" },
];

export const PRIORITES_PHASE = [
  { valeur: "forte", libelle: "Forte" },
  { valeur: "moyenne", libelle: "Moyenne" },
  { valeur: "faible", libelle: "Faible" },
];

export const PHASES_POSITIONNEMENT = [
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
];

export const TOTAL_COMPETENCES = PHASES_POSITIONNEMENT.reduce((n, p) => n + p.competences.length, 0);
