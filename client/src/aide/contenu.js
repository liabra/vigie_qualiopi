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
        titre: "Le poste de pilotage",
        lignes: [
          "L'administrateur voit la « Vue d'ensemble A2C », le contributeur « Mon espace de travail » : chacun ne voit que ce que son rôle permet.",
          "« À traiter en priorité » liste au plus 10 points concrets, dans un ordre fixe : retards qualité d'abord, puis péremptions, dossiers stagiaires, recueils du besoin, mesures pédagogiques et échéances à venir. Chaque ligne ouvre l'écran concerné.",
          "Aucun taux de conformité ni score n'est calculé : seulement des faits vérifiables. Le tableau de bord qualité détaillé reste dans le menu Qualité.",
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
          "Accompagnement : pour chaque stagiaire, un dossier réunit besoins et positionnement, mesures pédagogiques, observations et relances. Le compteur de l'onglet Stagiaires compte les inscrits actifs ; l'Accompagnement liste toutes les inscriptions, abandons compris.",
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
      {
        titre: "Contenu repris dans les documents",
        lignes: [
          "Objectifs, objectifs opérationnels (un par ligne), méthodes pédagogiques et modalités d'évaluation alimentent la convention, le programme et le bilan : saisissez-les une fois par version de formation.",
          "Un champ laissé vide reste vide dans le document.",
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
      {
        titre: "Modes de génération",
        lignes: [
          "Manuelle : le document est généré depuis l'onglet Documents de la session.",
          "Automatique : le document est produit seul au moment choisi (création de la session, inscription d'un stagiaire, début ou fin de la session).",
          "Conditionnelle : comme l'automatique, mais seulement pour les stagiaires concernés (situation de handicap, besoin d'adaptation, prescripteur renseigné).",
          "Seuls les documents manquants sont produits : un document existant n'est jamais remplacé. Un modèle utilisant une donnée restreinte n'est jamais généré automatiquement : générez-le à la main.",
          "Le suivi (fait, sans objet, bloqué) apparaît dans l'onglet Documents de chaque session ; une génération bloquée se relance après correction.",
        ],
      },
      {
        titre: "Retirer un modèle",
        lignes: ["Désactiver un modèle le retire des listes et arrête ses générations automatiques ; les documents déjà produits sont conservés. Il peut être réactivé."],
      },
    ],
  },
  "parametres/organisme": {
    titre: "Organisme et signataires",
    sections: [
      {
        titre: "Coordonnées de l'organisme",
        lignes: [
          "Adresse, téléphones et e-mail alimentent les variables {{organisme_*}} des documents (convocation, attestation, convention…). Ils ne sont plus écrits dans les modèles : modifiez-les ici, tous les prochains documents suivent.",
          "Un champ vide reste vide dans le document. Les documents déjà générés ne changent pas.",
        ],
      },
      {
        titre: "Signataires",
        lignes: [
          "Ajoutez les personnes qui signent (nom et fonction). Le signataire se choisit ensuite pour chaque modèle : un signataire fixe (par exemple la présidente) ou le formateur concerné.",
          "Un signataire n'est jamais supprimé : on le désactive. Un signataire utilisé par un modèle ne peut pas être désactivé tant que ce modèle ne change pas de signataire.",
        ],
      },
    ],
  },
  variablesDocumentaires: {
    titre: "Variables documentaires",
    sections: [
      {
        titre: "À quoi sert cette page",
        lignes: [
          "Elle liste toutes les données que Vigie sait insérer dans un document, avec leur libellé et la balise {{…}} à écrire dans le modèle Google Docs.",
          "La recherche ignore les accents et la casse. Une balise absente de la liste est refusée : le document n'est pas généré tant qu'elle n'est pas corrigée.",
          "Les mentions « Donnée personnelle » et « Accès restreint » signalent les données sensibles : une donnée à accès restreint n'est jamais générée automatiquement.",
          "La page est en consultation seule ; le dictionnaire est mis à jour avec l'application.",
        ],
      },
    ],
  },
  questionnaires: {
    titre: "Questionnaires de formation",
    sections: [
      {
        titre: "À quoi ça sert",
        lignes: [
          "Chaque formation peut avoir ses propres questions de positionnement, en plus de l'analyse des besoins commune.",
          "Les réponses se saisissent dans le dossier d'accompagnement du stagiaire (onglet Accompagnement de la session).",
          "Modifier ou retirer une question ne change jamais les réponses déjà recueillies : elles gardent la question telle que posée.",
        ],
      },
    ],
  },
  "parametres/inventaire-drive": {
    titre: "Inventaire Drive",
    sections: [
      {
        titre: "À quoi sert cette page",
        lignes: [
          "Elle liste, en lecture seule, les Google Docs et Sheets du dossier Vigie sur le Drive, et indique ceux déjà déclarés comme modèles.",
          "« Analyser » vérifie les marqueurs d'un fichier et propose un type, un usage et des indicateurs. Rien n'est enregistré sans votre validation.",
          "« Enregistrer comme modèle… » ouvre le formulaire prérempli : le fichier Drive n'est ni copié, ni déplacé, ni modifié.",
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
      {
        titre: "Passer au référentiel V10",
        lignes: [
          "Le V10 (décret n° 2026-728, en vigueur le 1er novembre 2026) est fourni avec Vigie : 33 indicateurs, libellés du décret. Son guide de lecture n'est pas encore publié : niveaux attendus et exemples de preuves sont absents.",
          "À l'activation, « Reporter les rattachements » relie preuves, modèles, veille et qualité à l'indicateur de même numéro. Les preuves des indicateurs dont le texte a changé passent « à confirmer » : relisez-les depuis Preuves.",
          "L'indicateur 33 (nouveau, propre aux CFA) démarre sans preuve. Réactiver V9 avec report ramène les rattachements.",
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
  justificatifsIntervenants: {
    titre: "Justificatifs des intervenants",
    sections: [
      { titre: "À quoi sert cette page", lignes: ["Elle liste, pour les intervenants actifs, les pièces attendues manquantes et les documents bientôt à renouveler ou périmés.", "C'est un repère de suivi : une pièce manquante n'est pas, en soi, une non-conformité Qualiopi."] },
      { titre: "Compléter un dossier", lignes: ["Ouvrez la fiche de l'intervenant : « Définir les pièces attendues », puis « Rattacher une preuve » déjà enregistrée dans le module Preuves (fichiers Drive, échéance).", "Une preuve rattachée devient définitivement réservée à l'administrateur. Retirer le lien ne supprime ni la preuve ni le fichier Drive."] },
    ],
  },
  intervenants: {
    titre: "Intervenants",
    sections: [
      { titre: "L'annuaire", lignes: ["Une fiche par personne : nom, fonction (formateur, référent handicap, personnel d'appui…), nature de l'intervention (salarié, extérieur, sous-traitant, porté), domaines de compétence et formations qu'elle peut animer.", "Données professionnelles uniquement. Une fiche se désactive mais ne se supprime pas : l'historique des sessions est conservé."] },
      { titre: "Dans les sessions", lignes: ["Onglet Stagiaires › Intervenants : l'administrateur rattache une ou plusieurs fiches à la session et à chaque groupe.", "Un formateur saisi avant l'annuaire reste affiché tel quel ; « Rapprocher d'une fiche » permet de choisir soi-même la bonne personne. Le marqueur {{formateur}} utilise alors les formateurs rattachés."] },
    ],
  },
  syntheseSatisfactions: {
    titre: "Synthèse des satisfactions",
    sections: [
      { titre: "À quoi sert cette page", lignes: ["Elle consolide les réponses de satisfaction de toutes les sessions, filtrables par période, formation, public et session.", "Chaque session renvoie à son onglet Satisfaction ; aucune réponse individuelle n'apparaît ici."] },
      { titre: "Lire les résultats", lignes: ["Les moyennes sont calculées par échelle de notation (sur 5, sur 10…) et jamais mélangées.", "Le taux de réponse n'est pas affiché : le nombre de personnes réellement sollicitées n'est pas connu."] },
      { titre: "Agir", lignes: ["« Créer une action qualité » enregistre la période, le public et, si vous les avez filtrées, la formation ou la session. La décision reste humaine : Vigie ne crée jamais d'action automatiquement."] },
    ],
  },
  tableauBordQualite: {
    titre: "Tableau de bord qualité",
    sections: [
      {
        titre: "À quoi sert ce tableau de bord",
        lignes: [
          "Il rassemble les faits du système qualité : actions et signalements à traiter, retards, contrôles d'efficacité, éléments résolus à clôturer.",
          "Chaque priorité et chaque activité ouvre sa fiche source.",
        ],
      },
      {
        titre: "Lire les chiffres",
        lignes: [
          "Aucun score ni taux de conformité n'est calculé : les chiffres sont des comptages factuels.",
          "« Sans preuve liée » et « Aucune preuve enregistrée » sont des repères de pilotage, pas des non-conformités.",
        ],
      },
    ],
  },
  signalements: {
    titre: "Signalements",
    sections: [
      {
        titre: "Réclamations, incidents et non-conformités",
        lignes: [
          "Vigie centralise les réclamations, les incidents et les non-conformités, et en suit le traitement qualité.",
        ],
      },
      {
        titre: "Suivre un signalement",
        lignes: [
          "Ouvrez un signalement pour suivre son traitement : Qualifier, Démarrer le traitement, Résoudre, puis Clôturer.",
          "La réponse apportée peut être enregistrée avant la résolution ; la date de résolution se renseigne avec « Résoudre ».",
          "Au moins un indicateur Qualiopi doit être associé avant la clôture. Une annulation est définitive.",
          "L'historique garde la trace de chaque étape et de son auteur, sans recopier le contenu confidentiel.",
        ],
      },
      {
        titre: "Les actions correctives",
        lignes: [
          "Les actions correctives issues d'un signalement sont pilotées dans « Actions qualité ».",
          "Les actions déjà liées à un signalement apparaissent sur sa fiche et s'ouvrent d'un clic.",
        ],
      },
      {
        titre: "Confidentialité",
        lignes: [
          "Les données du réclamant (nom, e-mail, entreprise) restent réservées aux administrateurs.",
        ],
      },
    ],
  },
  actions: {
    titre: "Actions qualité",
    sections: [
      {
        titre: "Pourquoi une action qualité",
        lignes: [
          "Une action qualité consigne une amélioration ou une correction à mener : un constat, un responsable, une échéance, une action prévue.",
        ],
      },
      {
        titre: "Les champs utiles",
        lignes: [
          "Responsable : la personne chargée de mener l'action. Priorité : Basse, Normale, Haute ou Urgente.",
          "Échéance : la date butoir souhaitée. Action prévue : ce qui sera fait, par qui, comment.",
          "Une action peut être reliée à une formation, une session (même archivée) et à des indicateurs Qualiopi.",
        ],
      },
      {
        titre: "La boucle : À faire → Réalisée → Clôturée",
        lignes: [
          "À faire : l'action est décidée. En cours : elle est engagée.",
          "Réalisée : le résultat est consigné, avec la date de mise en œuvre.",
          "Efficacité à vérifier : le contrôle d'efficacité est renseigné (le « fait » n'est pas encore « efficace »).",
          "Clôturée : l'action est terminée et son efficacité vérifiée. Une action réalisée n'est pas nécessairement clôturée : son efficacité peut devoir être vérifiée.",
        ],
      },
      {
        titre: "Indicateurs liés",
        lignes: [
          "Relier un indicateur Qualiopi rattache l'action au référentiel. Au moins un indicateur est nécessaire avant la clôture.",
        ],
      },
    ],
  },
  preuvesPdf: {
    titre: "Preuves PDF",
    sections: [
      { titre: "Pour l'auditeur", lignes: [
        "Chaque document est produit à la demande à partir des données à jour, daté, paginé, au nom de l'organisme : prêt à déposer sur la plateforme de l'organisme certificateur.",
        "Les registres (tâches, risques, partenaires, ressources), les enquêtes et les préparations d'audit ont aussi un bouton « PDF » sur leur page.",
        "Les identités des réclamants et les données de santé ne figurent jamais dans ces documents.",
      ] },
    ],
  },
  developpement: {
    titre: "Développement des intervenants",
    sections: [
      { titre: "Indicateurs 21 et 22", lignes: [
        "Renseignez pour chaque intervenant ses spécialités, diplômes et habilitations, la date du dernier entretien et ses besoins de développement.",
        "Ajoutez les actions (formations suivies ou prévues, tutorat, événements) et, une fois réalisées, ce qu'elles ont changé dans la pratique : c'est la preuve d'efficacité attendue.",
        "Un entretien datant de plus d'un an est signalé « À planifier ».",
      ] },
    ],
  },
  candidatures: {
    titre: "Candidatures",
    sections: [
      { titre: "Ouvrir une formation", lignes: [
        "« Formations ouvertes et pièces attendues » : cochez les formations proposées dans le formulaire public et listez les pièces à fournir.",
        "Diffusez le lien du formulaire (site, réseaux, prescripteurs). Le candidat choisit la formation et, s'il le souhaite, une session à venir.",
      ] },
      { titre: "Étudier et décider", lignes: [
        "Cochez les pièces reçues, notez l'entretien, puis acceptez en choisissant la session : la personne est inscrite (sa fiche est réutilisée si elle est déjà connue).",
        "Un refus ou une réorientation se motive : c'est la trace demandée pour l'accès à la formation.",
      ] },
    ],
  },
  accesPortails: {
    titre: "Accès aux portails",
    sections: [
      { titre: "Espace stagiaire et espace formateur", lignes: [
        "Un lien personnel ouvre l'espace sans compte Google. Il n'est affiché qu'une fois : copiez-le et transmettez-le par SMS ou e-mail personnel.",
        "Le stagiaire voit sa formation, ses séances, ses documents (PDF), ses enquêtes, ses résultats et peut signaler une difficulté.",
        "Le formateur voit ses sessions et ses groupes, saisit le suivi des séances et les compétences, consulte les ressources et signale un incident.",
        "Désactivez un accès à tout moment : le lien cesse aussitôt de fonctionner.",
      ] },
    ],
  },
  taches: {
    titre: "Tâches qualité",
    sections: [
      { titre: "À quoi ça sert", lignes: [
        "Une tâche dit ce qui doit être fait, par qui et pour quand : actualiser une preuve, relancer une enquête, préparer une réunion qualité.",
        "Une tâche récurrente (mensuelle, trimestrielle…) terminée prépare automatiquement la suivante, à la même date du mois.",
      ] },
      { titre: "Créer les tâches depuis les manques", lignes: [
        "Le bouton crée une tâche pour chaque indicateur applicable sans preuve et pour chaque preuve dont l'échéance est dépassée.",
        "Il ne crée jamais de doublon : relancez-le autant que nécessaire.",
      ] },
    ],
  },
  echeancier: {
    titre: "Échéancier",
    sections: [
      { titre: "Une seule vue des dates", lignes: [
        "Tâches, actions qualité, preuves à réviser, sessions, risques à réévaluer, fins de convention et audits, regroupés par mois.",
        "Les éléments en retard sont signalés en rouge. Chaque ligne ouvre sa fiche.",
      ] },
    ],
  },
  risques: {
    titre: "Risques qualité",
    sections: [
      { titre: "Évaluer un risque", lignes: [
        "Probabilité (1 rare à 4 fréquent) × impact (1 faible à 4 critique) = criticité de 1 à 16. À partir de 12, le risque est critique.",
        "Décrivez les mesures de maîtrise, nommez un responsable et fixez une date de réévaluation : elle apparaît dans l'échéancier.",
        "Un risque peut être relié à une action qualité et à des indicateurs.",
      ] },
    ],
  },
  partenaires: {
    titre: "Partenaires",
    sections: [
      { titre: "Pourquoi les suivre", lignes: [
        "Les indicateurs 23 à 27 attendent la preuve d'un réseau de partenaires et des actions menées avec eux.",
        "Notez les conventions (avec leur date de fin, rappelée dans l'échéancier), le contact et les actions menées.",
      ] },
    ],
  },
  ressources: {
    titre: "Ressources et moyens",
    sections: [
      { titre: "Supports et moyens techniques", lignes: [
        "Supports pédagogiques : version et date d'actualisation, pour prouver qu'ils sont tenus à jour.",
        "Salles, matériels et logiciels : état et date du dernier contrôle (indicateur 17).",
      ] },
    ],
  },
  preparationAudit: {
    titre: "Préparation d'audit",
    sections: [
      { titre: "Comment s'en servir", lignes: [
        "Créez une préparation (audit blanc, surveillance, renouvellement) : tous les indicateurs du référentiel actif sont listés.",
        "Pour chaque indicateur, Vigie affiche des signaux factuels (aucune preuve, preuve à actualiser, action ouverte) ; vous portez l'appréciation.",
        "Tirez un échantillon de sessions : le tirage est daté et tracé, comme le ferait l'auditeur.",
        "« Créer les tâches du plan d'action » transforme chaque indicateur à améliorer ou non conforme en tâche.",
      ] },
      { titre: "Dossier et partage", lignes: [
        "Le dossier ZIP contient un index lisible, les preuves (liens Drive), l'échantillon et les actions — sans aucun nom de stagiaire.",
        "Le partage en lecture seule donne à un compte « auditeur » l'accès au référentiel, aux preuves et à l'échantillon, jamais à vos appréciations internes.",
      ] },
    ],
  },
  enquetes: {
    titre: "Enquêtes en ligne",
    sections: [
      { titre: "Diffuser", lignes: [
        "Créez l'enquête depuis un modèle (satisfaction à chaud, suivi à froid, partenaires), puis transmettez le lien : réponse anonyme, sans compte, sur téléphone ou ordinateur.",
        "Les questions restent modifiables tant qu'aucune réponse n'est arrivée.",
      ] },
      { titre: "Exploiter (indicateurs 30 à 32)", lignes: [
        "Les résultats sont calculés automatiquement ; la question de satisfaction globale alimente la synthèse et les indicateurs de session.",
        "Rédigez l'analyse et les décisions : l'auditeur vérifie que les appréciations sont exploitées. Une alerte signale une enquête close non analysée.",
      ] },
    ],
  },
  comptes: {
    titre: "Comptes et accès",
    sections: [
      { titre: "Rôles", lignes: [
        "Administrateur : tout. Contributeur : saisie courante. Auditeur externe : lecture seule des dossiers d'audit partagés, pour 90 jours au plus.",
        "La personne se connecte avec le compte Google correspondant à l'adresse enregistrée.",
        "Vous ne pouvez pas réduire vos propres droits, et il reste toujours au moins un administrateur actif.",
      ] },
    ],
  },
  rgpd: {
    titre: "RGPD et conservation",
    sections: [
      { titre: "Droits des personnes", lignes: [
        "Droit d'accès : « Exporter » produit un fichier avec toutes les données détenues sur la personne.",
        "Droit à l'effacement : « Anonymiser » efface l'identité, les coordonnées, les données de santé et les textes libres ; les statistiques restent, sans identité.",
        "Les documents déjà générés dans Google Drive ne sont pas modifiés : supprimez-les dans Drive si nécessaire.",
      ] },
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
  ["/tableau-de-bord-qualite", "tableauBordQualite"],
  ["/synthese-satisfactions", "syntheseSatisfactions"],
  ["/signalements-qualite", "signalements"],
  ["/actions-qualite", "actions"],
  ["/formations", "formations"],
  ["/intervenants", "intervenants"],
  ["/justificatifs-intervenants", "justificatifsIntervenants"],
  ["/modeles", "modeles"],
  ["/parametres/organisme", "parametres/organisme"],
  ["/variables-documentaires", "variablesDocumentaires"],
  ["/parametres/inventaire-drive", "parametres/inventaire-drive"],
  ["/prescripteurs", "prescripteurs"],
  ["/questionnaires", "questionnaires"],
  ["/versions", "versions"],
  ["/parametres/google", "parametres/google"],
  ["/preuves-pdf", "preuvesPdf"],
  ["/developpement-intervenants", "developpement"],
  ["/candidatures", "candidatures"],
  ["/acces-portails", "accesPortails"],
  ["/taches", "taches"],
  ["/echeancier", "echeancier"],
  ["/risques", "risques"],
  ["/partenaires", "partenaires"],
  ["/ressources", "ressources"],
  ["/preparation-audit", "preparationAudit"],
  ["/enquetes", "enquetes"],
  ["/parametres/comptes", "comptes"],
  ["/parametres/rgpd", "rgpd"],
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
      { titre: "Dossier", lignes: ["Le dossier réunit le contact, l'entreprise et le financeur. La situation de handicap et les besoins d'adaptation historiques sont réservés à l'administrateur ; les mesures pédagogiques se suivent dans l'onglet Accompagnement."] },
      { titre: "Abandon et relances", lignes: ["L'abandon change le statut de l'inscription ; une catégorie et une précision courte sont facultatives, sans information médicale ni justification intime. Les signaux observés et les relances s'enregistrent dans Accompagnement › Observations et relances, en faits seulement."] },
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
      { titre: "Questionnaires", lignes: ["Recueillez les réponses à chaud, à froid, financeur, entreprise, formateur, prescripteur ou partenaire, toujours rattachées à une session. Une réponse peut être anonyme ; l'échelle de note du questionnaire est conservée.", "Google Forms (administrateur) : dans les réponses, « Afficher dans Sheets », puis Fichier › Télécharger › CSV, et « Importer des réponses (CSV Google Forms) ». Questionnaire anonyme par défaut ; l'adresse e-mail n'est jamais conservée.", "Le contributeur ne voit que des résultats regroupés par public ; un groupe de moins de 5 réponses n'est pas restitué."] },
    ],
  },
  {
    id: "documents", titre: "Documents", admin: false,
    sections: [
      { titre: "Génération", lignes: ["Vigie copie un modèle Drive et remplace les marqueurs {{…}}. Le modèle d'origine n'est jamais modifié.", "Les modèles automatiques et conditionnels sont produits seuls ; leur suivi apparaît sous « Générations automatiques »."] },
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
    id: "bienvenue", titre: "Bienvenue dans Vigie", route: "/accueil",
    admin: "Vigie aide A2C à rester prêt pour un audit Qualiopi : formations, sessions, stagiaires, preuves et veille réglementaire au même endroit.",
    contributeur: "Vigie aide A2C à rester prêt pour un audit Qualiopi : formations, sessions, stagiaires, preuves et veille réglementaire au même endroit.",
  },
  {
    id: "navigation", titre: "Navigation", route: "/accueil",
    admin: "Le menu de gauche donne accès à l'Accueil, aux Sessions et à tout ce qui concerne la qualité (indicateurs, preuves, veille, audits). Les paramètres se règlent en bas de ce menu.",
    contributeur: "Le menu de gauche donne accès à l'Accueil, aux Sessions et à tout ce qui concerne la qualité (indicateurs, preuves, veille, audits).",
  },
  {
    id: "sessions", titre: "Les sessions", route: "/sessions",
    admin: "Une session de formation se crée dans « Sessions », puis se remplit : stagiaires, absences, évaluations, satisfaction et documents, onglet par onglet.",
    contributeur: "Dans « Sessions », ouvrez une session pour gérer les stagiaires : absences, évaluations, satisfaction et documents, onglet par onglet.",
  },
  {
    id: "preuves", titre: "Les preuves", route: "/preuves",
    admin: "Chaque indicateur Qualiopi doit être appuyé par des preuves. Vous les suivez dans « Preuves », par indicateur ou en liste complète, avec leurs statuts et leurs échéances.",
    contributeur: "Les preuves de conformité se consultent dans « Preuves », par indicateur ou en liste complète.",
  },
  {
    id: "veille", titre: "La veille", route: "/veille",
    admin: "La veille réglementaire se traite en trois temps : S'informer, Analyser, puis Agir. Une rupture réglementaire peut rendre des preuves caduques.",
    contributeur: "La veille réglementaire se consulte en trois temps : S'informer, Analyser, puis Agir.",
  },
  {
    id: "accueil", titre: "L'Accueil", route: "/accueil",
    admin: "L'Accueil vous montre ce qui demande votre attention : sessions en cours, prochaines sessions et alertes.",
    contributeur: "L'Accueil vous montre ce qui demande votre attention : sessions en cours, prochaines sessions et alertes.",
  },
  {
    id: "aide", titre: "Où retrouver l'aide", route: "/accueil",
    admin: "Le bouton « ? Aide » en bas du menu ouvre cette aide à tout moment : aide de la page courante, guide complet et relance de ce tutoriel.",
    contributeur: "Le bouton « ? Aide » en bas du menu ouvre cette aide à tout moment : aide de la page courante, guide complet et relance de ce tutoriel.",
  },
];

export function etapesTutoriel(role) {
  const admin = role === "admin";
  return ETAPES.map((e) => ({ id: e.id, titre: e.titre, route: e.route, texte: admin ? e.admin : e.contributeur }));
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
