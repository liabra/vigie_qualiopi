# Mise en service — intégration documentaire (lots empilés)

Branches empilées à partir de `origin/main` (8550bdd). Aucune n'est fusionnée ni déployée.

| Lot | Branche | Migrations | Contenu |
|---|---|---|---|
| 1 | `livraison/dictionnaire-v1-5` | aucune | Dictionnaire v1.5 (43 libellés), page « Variables documentaires » |
| 2 | `livraison/parametres-signataires` | 041 | Paramètres de l'organisme, signataires configurables, choix par modèle |
| 3 | `livraison/donnees-documentaires` | 042 | Dictionnaire v1.6 : contenu de formation, analyse du besoin, évaluations complètes, adaptations, financeur |

## Lot 2 — paramètres de l'organisme et signataires

- **Migration 041** (additive) : `parametres_organisme` (une ligne vide), `signataires`, colonnes `signataire_mode` /
  `signataire_id` sur `modeles_documents` (défaut « aucun » : aucun modèle existant ne change).
- **Variables alimentées** : `{{organisme_nom}}` (repli sur `ORGANISME_NOM` tant qu'il n'est pas saisi),
  `{{organisme_adresse_ligne1}}`, `{{organisme_adresse_ligne2}}`, `{{organisme_code_postal}}`, `{{organisme_ville}}`,
  `{{organisme_telephone}}`, `{{organisme_mobile}}`, `{{organisme_email}}`, `{{signataire_nom}}`, `{{signataire_fonction}}`.
- **Signataire par modèle** : aucun · fixe (table `signataires`) · formateur concerné (formateur du groupe du stagiaire,
  à défaut de la session ; premier par ordre alphabétique s'il y en a plusieurs).
- **Écran** : Paramètres → Organisme et signataires (administrateur) ; choix du signataire dans le formulaire de modèle.
- **Initialisation** : `npm run db:parametres-initiaux -- parametres.json` (non destructif : ne remplace aucune valeur
  saisie, ne recrée pas un signataire existant). Le fichier des valeurs A2C n'est pas dans le dépôt.

### Après déploiement (administrateur)

1. `npm run db:parametres-initiaux -- "…/parametres_initiaux_A2C.json"` (ou saisie dans l'écran).
2. Dans Modèles de documents : convocation et attestation → signataire fixe « Muriel Kpodar, Présidente ».
3. Remplacer dans les Google Docs l'adresse, les téléphones, l'e-mail et la signature écrits en dur par les balises
   (voir `plan_integration_modeles_A2C.md`), après un test sur une copie.

## Lot 3 — données documentaires (dictionnaire v1.6)

- **Migration 042** (additive) : `formation_versions.objectifs_operationnels` (liste), `methodes_pedagogiques`,
  `modalites_evaluation`. Une modification de formation sans ces champs (ancien client) les **reprend** de la version
  précédente ; un champ vide envoyé explicitement les efface.
- **Variables** (7 nouvelles) : `besoin_date_recueil`, `besoin_attentes`, `besoin_objectifs_personnels`,
  `besoin_prerequis_verifies`, `besoin_conclusion` (recueil saisi dans l'onglet Accompagnement),
  `stagiaire_situation_handicap` (accès restreint), `evaluation_seuil_reussite`.
- **Résolveurs ajoutés** : `formation_objectifs_operationnels` (une ligne par objectif), `formation_methodes_pedagogiques`,
  `formation_modalites_evaluation`, `financeur_nom`, `stagiaire_besoins_specifiques` (accès restreint).
- **Blocs** : `objectifs_formation` (codes O1, O2…), `adaptations` (accès restreint), `evaluations` complété
  (moment, résultat de validation, commentaire, seuil).
- **Sécurité** : les données de santé (`stagiaire_besoins_specifiques`, `stagiaire_situation_handicap`, bloc
  `adaptations`) sont refusées à un contributeur par le précontrôle et ne sont jamais produites par la génération
  automatique (sans droits administrateur) : un modèle qui les utilise se génère à la main par un administrateur.
- **Écran** : Paramètres → Formations → Réviser : section « Contenu repris dans les documents ».

## Lot 4 — questionnaire dans les documents et condition d'assiduité (dictionnaire v1.7)

- **Bloc `{{#questionnaire_formation}}`** (`question_libelle`, `question_reponse`) : réponses du stagiaire au questionnaire de
  sa formation, une ligne par question, dans l'ordre du questionnaire ; la question est celle posée au moment de la
  réponse (instantané). Aucun stagiaire sans réponse : bloc vide.
- **Migration 043** (additive) : condition de génération `assiduite_atteinte` (assiduité d'au moins 80 %, abandons exclus ;
  même calcul et même seuil que l'écran d'assiduité ; durée de session inconnue = personne concerné).
- **Attestation automatique** : modèle « conditionnel », déclencheur « à la fin de la session », condition
  « assiduité d'au moins 80 % ». Le seuil est la constante `SEUIL_ASSIDUITE` (services/assiduite.js) : à ajuster en une
  ligne si la décision B4 diffère. Tant que le modèle de l'attestation reste en mode manuel, rien ne change.

## Lot 5 — modèles préparés (hors dépôt) et dépendance « entretiens FSE-IA »

- **Fichiers préparés** (dossier local « A2C - Modèles préparés », hors dépôt, aucune écriture sur le Drive) : convention
  individuelle gratuite, bilan intermédiaire, fiche d'analyse des besoins (voie A, administrateur uniquement), convocation et
  attestation à organisme/signataire paramétrés, questionnaire de satisfaction (PROPOSITION à valider). Toutes les balises
  sont validées par `analyserModele` (aucune inconnue). À importer **sur copie** dans Google Docs, puis à enregistrer via
  Paramètres → Modèles (signataire à choisir).
- **Non repris ici** : le mode « plusieurs générations par session » (commit `c31fabe`, migration 028) dépend de la chaîne
  de commits locaux non poussés (compte rendu prescripteur, entretiens FSE-IA). Son cherry-pick isolé entre en conflit
  (documents.js, gestion.js, tests) : il doit être repris avec cette chaîne, dans une livraison dédiée.
