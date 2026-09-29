// Aide intégrée (Après VF) — CONTENU CENTRALISÉ.
// Module PUR (aucun React) : testable seul, sans navigateur. Tous les textes
// d'aide vivent ici, dans une configuration structurée, pour rester faciles
// à maintenir quand Vigie évoluera.

// ─────────────────────────────────────────────────────────────
// Aide contextuelle (« Aide de cette page »), selon la route.
// Chaque entrée : { titre, sections: [{ titre, lignes: [..] }] }.
// Les textes décrivent UNIQUEMENT ce qui existe réellement.
// ─────────────────────────────────────────────────────────────

const AIDE = {
  accueil: {
    titre: "Accueil",
    sections: [
      {
        titre: "Le tableau de bord",
        lignes: [
          "Vigie s'ouvre sur l'essentiel : vos sessions en cours, les prochaines sessions et les alertes opérationnelles.",
          "Chaque carte vous mène à l'écran concerné en un clic.",
        ],
      },
    ],
  },
  sessions: {
    titre: "Sessions",
    sections: [
      {
        titre: "La liste des sessions",
        lignes: [
          "Les sessions actives sont affichées par défaut ; les sessions archivées sont consultées depuis la vue « Archivées ».",
          "Filtrez par statut (À venir, En cours, Terminées, Annulées) ou cherchez par référence, formation ou lieu.",
        ],
      },
      {
        titre: "Créer une session",
        lignes: [
          "« Nouvelle session » ouvre un panneau : choisissez une formation, ses dates, et éventuellement un lieu, un formateur, une durée ou un horaire.",
        ],
      },
    ],
  },
  session: {
    titre: "Détail d'une session",
    sections: [
      {
        titre: "Les onglets",
        lignes: [
          "Vue d'ensemble : la synthèse de la session (stagiaires, groupes, assiduité, évaluations, satisfaction, documents).",
          "Stagiaires : inscrire un stagiaire, l'importer en CSV, compléter son dossier, déclarer un abandon.",
          "Assiduité : saisir les absences (présent par défaut), le taux est calculé par Vigie.",
          "Évaluations : enregistrer les résultats (QCM, positionnement…) ou les importer.",
          "Satisfaction : recueillir les questionnaires, anonymes ou nominatifs.",
          "Documents : générer les documents Vigie ou rattacher un fichier externe (EduSign).",
        ],
      },
    ],
  },
  indicateurs: {
    titre: "Indicateurs",
    sections: [
      {
        titre: "La conformité au référentiel",
        lignes: [
          "Les 32 indicateurs Qualiopi sont regroupés par critère, avec leur statut : maîtrisé, à consolider, à risque ou non applicable.",
          "Cliquez sur un indicateur pour voir ses preuves et sa situation.",
        ],
      },
      {
        titre: "Non applicable",
        lignes: [
          "Un indicateur peut être marqué « non applicable » s'il ne concerne pas votre organisme : il n'est plus compté dans le score.",
        ],
      },
    ],
  },
  preuves: {
    titre: "Preuves",
    sections: [
      {
        titre: "Vues",
        lignes: [
          "« Par indicateur » : les preuves rattachées à chaque indicateur du référentiel.",
          "« Toutes les preuves » : la liste complète, quel que soit l'indicateur.",
        ],
      },
      {
        titre: "Statuts et échéances",
        lignes: [
          "Une preuve est maîtrisée, à consolider ou à risque. « À confirmer » signale une preuve à valider.",
          "Une échéance (révision périodique ou date fixe) prévient quand une preuve doit être revue.",
          "L'import du classeur permet de rapprocher automatiquement les preuves du classeur d'audit.",
        ],
      },
    ],
  },
  veille: {
    titre: "Veille",
    sections: [
      {
        titre: "S'informer → Analyser → Agir",
        lignes: [
          "La veille se lit en trois temps : S'informer (la source), Analyser (l'impact), Agir (l'action à mener).",
          "Une rupture réglementaire signale une veille qui peut rendre des preuves caduques.",
          "Chaque veille peut être reliée aux indicateurs concernés.",
        ],
      },
    ],
  },
  audits: {
    titre: "Audits",
    sections: [
      {
        titre: "Historique et saisie",
        lignes: [
          "Les audits sont enregistrés avec leur type, leur date, leur résultat et leurs non-conformités.",
          "Un rapport Drive peut y être rattaché.",
        ],
      },
    ],
  },
  formations: {
    titre: "Formations",
    sections: [
      {
        titre: "Le catalogue",
        lignes: [
          "Chaque formation peut être révisée : une révision crée une nouvelle version, sans rien perdre.",
          "Les sessions déjà créées conservent la version de formation qu'elles ont figée.",
        ],
      },
    ],
  },
  modeles: {
    titre: "Modèles de documents",
    sections: [
      {
        titre: "Les gabarits",
        lignes: [
          "Un modèle est un Google Doc ou Sheet existant sur le Drive. Vigie en fait une copie et remplace les marqueurs {{…}} — le modèle d'origine n'est jamais modifié.",
        ],
      },
    ],
  },
  prescripteurs: {
    titre: "Prescripteurs",
    sections: [
      {
        titre: "La liste configurable",
        lignes: [
          "Ajoutez, renommez ou désactivez un prescripteur. Désactiver ne supprime rien : les inscriptions passées conservent leur prescripteur.",
        ],
      },
    ],
  },
  versions: {
    titre: "Versions du référentiel",
    sections: [
      {
        titre: "Les versions",
        lignes: [
          "Une seule version est active à la fois. Une version vide (sans critère ni indicateur) ne peut pas être activée.",
        ],
      },
    ],
  },
  "parametres/google": {
    titre: "Google Drive",
    sections: [
      {
        titre: "La connexion",
        lignes: [
          "Vigie lit le Drive du compte de l'organisme en lecture seule : les fichiers ne sont jamais copiés dans Vigie.",
          "Cet écran indique l'état de la connexion et les autorisations demandées.",
        ],
      },
    ],
  },
};

// Route → clé d'aide. Le préfixe le plus long l'emporte (les onglets d'une
// session relèvent tous de « session »).
const CLES = [
  ["/accueil", "accueil"],
  ["/sessions", "sessions"],
  ["/indicateurs", "indicateurs"],
  ["/preuves", "preuves"],
  ["/veille", "veille"],
  ["/audits", "audits"],
  ["/formations", "formations"],
  ["/modeles", "modeles"],
  ["/prescripteurs", "prescripteurs"],
  ["/versions", "versions"],
  ["/parametres/google", "parametres/google"],
];

// Les routes de DÉTAIL sont reconnues comme leur écran parent.
const DETAIL = [
  { prefixe: "/sessions/", cle: "session" },
];

export function aideDe(chemin) {
  const p = String(chemin || "/");
  for (const { prefixe, cle } of DETAIL) {
    if (p.startsWith(prefixe)) return AIDE[cle];
  }
  let trouve = null;
  for (const [prefixe, cle] of CLES) {
    if (p === prefixe || p.startsWith(prefixe + "/")) {
      if (!trouve || prefixe.length > trouve.prefixe.length) trouve = { prefixe, cle };
    }
  }
  return trouve ? AIDE[trouve.cle] : null;
}

// ─────────────────────────────────────────────────────────────
// Guide complet : rubriques consultables et cherchables.
// ─────────────────────────────────────────────────────────────

export const RUBRIQUES_GUIDE = [
  {
    id: "accueil", titre: "Accueil", admin: false,
    sections: [
      { titre: "Le tableau de bord", lignes: ["L'accueil réunit les sessions en cours, les prochaines sessions et les alertes opérationnelles. Chaque carte mène à l'écran concerné."] },
    ],
  },
  {
    id: "sessions", titre: "Sessions", admin: false,
    sections: [
      { titre: "Créer et corriger", lignes: ["Une session se crée à partir d'une formation (menu Sessions → Nouvelle session). L'admin peut ensuite corriger la référence, les dates, le lieu, le formateur, la durée, l'horaire et le statut."] },
      { titre: "Cycle de vie", lignes: ["L'archivage met une session en lecture seule, sans rien supprimer ; la restauration la rend de nouveau modifiable. La suppression définitive reste exceptionnelle, réservée aux sessions vides."] },
    ],
  },
  {
    id: "stagiaires", titre: "Stagiaires", admin: false,
    sections: [
      { titre: "Inscription", lignes: ["Dans l'onglet Stagiaires, ajoutez un stagiaire un par un ou importez un CSV. L'inscription porte le groupe, le prescripteur et l'état du dossier."] },
      { titre: "Dossier", lignes: ["Le dossier réunit le contact, l'entreprise, le financeur et, en accès restreint, la situation de handicap et les besoins d'adaptation."] },
    ],
  },
  {
    id: "assiduite", titre: "Assiduité", admin: false,
    sections: [
      { titre: "Principe", lignes: ["Un stagiaire est présent par défaut : seules les absences sont saisies. Le taux d'assiduité est calculé par Vigie, seulement quand il est fiable."] },
    ],
  },
  {
    id: "evaluations", titre: "Évaluations", admin: false,
    sections: [
      { titre: "Résultats", lignes: ["Enregistrez les QCM, positionnements et validations d'étape, ou importez un export. La date doit tomber dans la période de la session."] },
    ],
  },
  {
    id: "satisfaction", titre: "Satisfaction", admin: false,
    sections: [
      { titre: "Questionnaires", lignes: ["Recueillez les réponses à chaud, à froid, financeur, entreprise ou formateur. Une réponse peut être anonyme."] },
    ],
  },
  {
    id: "documents", titre: "Documents", admin: false,
    sections: [
      { titre: "Génération", lignes: ["Vigie copie un modèle Drive et remplace les marqueurs {{…}}. Le modèle d'origine n'est jamais modifié."] },
      { titre: "Externes / EduSign", lignes: ["Rattachez un fichier déjà présent sur le Drive (export EduSign…) sans le copier ni le stocker dans Vigie."] },
    ],
  },
  {
    id: "indicateurs", titre: "Indicateurs", admin: false,
    sections: [
      { titre: "Conformité", lignes: ["Les 32 indicateurs Qualiopi, groupés par critère, affichent leur statut : maîtrisé, à consolider, à risque ou non applicable."] },
    ],
  },
  {
    id: "preuves", titre: "Preuves", admin: false,
    sections: [
      { titre: "Suivi des preuves", lignes: ["Une preuve rattache un fichier Drive à un indicateur. Statuts, échéances et alertes de péremption signalent ce qui doit être revu."] },
    ],
  },
  {
    id: "veille", titre: "Veille", admin: false,
    sections: [
      { titre: "S'informer → Analyser → Agir", lignes: ["Chaque veille se lit en trois temps. Une rupture réglementaire peut invalider des preuves liées."] },
    ],
  },
  {
    id: "audits", titre: "Audits", admin: false,
    sections: [
      { titre: "Historique", lignes: ["Les audits sont consignés avec leur type, leur date, leur résultat et leurs non-conformités."] },
    ],
  },
  {
    id: "parametres", titre: "Paramètres admin", admin: true,
    sections: [
      { titre: "Réservé aux administrateurs", lignes: ["Formations, Modèles de documents, Prescripteurs, Versions du référentiel et Google Drive se règlent depuis le menu Paramètres."] },
    ],
  },
];

// Rubriques visibles pour un rôle : le guide ne montre JAMAIS une action
// admin-only à un contributeur.
export function rubriquesPour(role) {
  const admin = role === "admin";
  return RUBRIQUES_GUIDE.filter((r) => admin || !r.admin);
}

// Recherche simple : titre + textes des rubriques.
export function rechercherGuide(role, q) {
  const aiguille = String(q || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (!aiguille) return rubriquesPour(role);
  return rubriquesPour(role).filter((r) => {
    const texte = [r.titre, ...r.sections.map((s) => s.titre + " " + s.lignes.join(" "))]
      .join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return texte.includes(aiguille);
  });
}

// ─────────────────────────────────────────────────────────────
// Tutoriel de démarrage (5 à 7 étapes, respect du rôle).
// ─────────────────────────────────────────────────────────────

const ETAPES = [
  {
    id: "bienvenue", titre: "Bienvenue dans Vigie",
    admin: "Vigie aide A2C à rester prêt pour un audit Qualiopi : formations, sessions, stagiaires, preuves et veille réglementaire au même endroit.",
    contributeur: "Vigie aide A2C à rester prêt pour un audit Qualiopi : formations, sessions, stagiaires, preuves et veille réglementaire au même endroit.",
  },
  {
    id: "navigation", titre: "Navigation",
    admin: "Le menu de gauche donne accès à l'Accueil, aux Sessions et à tout ce qui concerne la qualité (indicateurs, preuves, veille, audits). Les paramètres se règlent en bas de ce menu.",
    contributeur: "Le menu de gauche donne accès à l'Accueil, aux Sessions et à tout ce qui concerne la qualité (indicateurs, preuves, veille, audits).",
  },
  {
    id: "sessions", titre: "Les sessions",
    admin: "Une session de formation se crée dans « Sessions », puis se remplit : stagiaires, absences, évaluations, satisfaction et documents, onglet par onglet.",
    contributeur: "Dans « Sessions », ouvrez une session pour gérer les stagiaires : absences, évaluations, satisfaction et documents, onglet par onglet.",
  },
  {
    id: "preuves", titre: "Les preuves",
    admin: "Chaque indicateur Qualiopi doit être appuyé par des preuves. Vous les suivez dans « Preuves », par indicateur ou en liste complète, avec leurs statuts et leurs échéances.",
    contributeur: "Les preuves de conformité se consultent dans « Preuves », par indicateur ou en liste complète.",
  },
  {
    id: "veille", titre: "La veille",
    admin: "La veille réglementaire se traite en trois temps : S'informer, Analyser, puis Agir. Une rupture réglementaire peut rendre des preuves caduques.",
    contributeur: "La veille réglementaire se consulte en trois temps : S'informer, Analyser, puis Agir.",
  },
  {
    id: "accueil", titre: "L'Accueil",
    admin: "L'Accueil vous montre ce qui demande votre attention : sessions en cours, prochaines sessions et alertes.",
    contributeur: "L'Accueil vous montre ce qui demande votre attention : sessions en cours, prochaines sessions et alertes.",
  },
  {
    id: "aide", titre: "Où retrouver l'aide",
    admin: "Le bouton « ? Aide » en bas du menu ouvre cette aide à tout moment : aide de la page courante, guide complet et relance de ce tutoriel.",
    contributeur: "Le bouton « ? Aide » en bas du menu ouvre cette aide à tout moment : aide de la page courante, guide complet et relance de ce tutoriel.",
  },
];

export function etapesTutoriel(role) {
  const admin = role === "admin";
  return ETAPES.map((e) => ({ id: e.id, titre: e.titre, texte: admin ? e.admin : e.contributeur }));
}

// ─────────────────────────────────────────────────────────────
// Petites notions (« ? » contextuels) : un clic / focus explique.
// ─────────────────────────────────────────────────────────────

export const NOTIONS = {
  non_applicable: {
    libelle: "Non applicable",
    texte: "Un indicateur marqué « non applicable » ne concerne pas votre organisme : il n'est plus compté dans le score de conformité.",
  },
  preuve_a_confirmer: {
    libelle: "Preuve à confirmer",
    texte: "Une preuve « à confirmer » doit être validée pour compter comme maîtrisée.",
  },
  echeance: {
    libelle: "Échéance",
    texte: "Une preuve à échéance fixe expire à une date ; une preuve à révision périodique doit être revue tous les N mois.",
  },
  rupture_reglementaire: {
    libelle: "Rupture réglementaire",
    texte: "Une veille en rupture réglementaire peut rendre caduques les preuves liées aux indicateurs concernés.",
  },
  duree_prevue: {
    libelle: "Durée prévue",
    texte: "La durée prévue est celle déclarée pour la session, ou à défaut celle de la formation. Elle sert au calcul d'assiduité.",
  },
  document_obsolete: {
    libelle: "Document obsolète",
    texte: "Après une correction de session, un document généré peut ne plus refléter les nouvelles valeurs : régénérez-le si nécessaire.",
  },
};

export function notion(id) {
  return NOTIONS[id] || null;
}
