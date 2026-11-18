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

## Lot 6 — consolidation avec la chaîne FSE-IA / DOC-10 (branche `livraison/consolidation`)

- Contient : la chaîne locale (entretiens FSE-IA, migrations 026–031, compte rendu prescripteur, génération multiple 028)
  **et** les quatre lots (dictionnaire, signataires, données documentaires, questionnaire/assiduité), fusionnés sans perte.
- Migrations : 41 au total, signatures 026–031 ajoutées. Appliquées « dans le désordre » sur la production (026–031 après
  032–043 déjà présentes) : sans conséquence, elles sont indépendantes et additives.
- Génération multiple : case « Plusieurs documents par session » à la création d'un modèle (usage session/groupe, génération
  manuelle uniquement) ; champ « Libellé » obligatoire à la génération ; même libellé = remplacement après confirmation.
- `{{formation_modalite}}` produit désormais « Présentiel / Distanciel / Mixte » (et non la valeur technique).
- Modèles préparés : 7 fichiers (dont 2 propositions : questionnaire de satisfaction, dossier d'admission), rendus et
  contrôlés avec des données fictives.

## Procédure définitive de mise en production (branche `livraison/consolidation`)

### Vérifications faites avant la mise en production
- **Migrations** : le lanceur applique, dans l'ordre des noms, les seuls fichiers absents de `schema_migrations`, chacun dans
  sa transaction, sous verrou consultatif. Sur une production déjà à 040, il applique donc 026 à 031 puis 041 à 043.
  026–027 et 029–031 créent des tables/colonnes nouvelles ; 028 ajoute deux colonnes et remplace l'index d'unicité des
  documents générés (le libellé vide garde l'ancien comportement). Aucune migration 032–043 ne dépend de 026–031.
  Cas couvert par un test (`migrationsReference.test.js`) : document déjà généré conservé, unicité par libellé, second
  démarrage sans rejeu. Les signatures 026–031 ne servent qu'à établir une référence sur base sans historique.
- **Paramètres initiaux** : le fichier `parametres_initiaux_A2C.json` (hors dépôt) a été contrôlé : champs attendus, validation
  du service réussie, téléphones conformes aux décisions, aucun secret, signataires « Présidente » et « Référente Qualiopi ».
- **Génération multiple** : deux libellés → deux documents ; même libellé → 409 puis remplacement confirmé (test PostgreSQL
  réel et test d'interface).
- **Modèles** : les 7 fichiers ont été rendus (LibreOffice) avec des données fictives : convention sur 2 pages, les autres sur 1.

### Étapes (dans l'ordre)
1. **Sauvegarde** de la base (script de sauvegarde chiffrée existant) et vérification qu'elle se restaure.
2. **Fusion** de `livraison/consolidation` dans `main` (décision humaine). Railway déploie automatiquement ; au démarrage,
   les migrations 026–031 puis 041–043 s'appliquent. En cas d'échec d'une migration, elle est annulée (transaction), le
   démarrage s'arrête avec le nom du fichier : restaurer la sauvegarde si nécessaire, ne rien rejouer à la main.
3. **Paramètres** : `npm run db:parametres-initiaux -- "<chemin du fichier JSON>"` (une seule fois, non destructif).
   Contrôler ensuite Paramètres → Organisme et signataires (coordonnées, deux signataires actifs).
4. **Modèles** : importer les `.docx` **sur copie** dans Google Docs ; Paramètres → Modèles → enregistrer chacun avec son type,
   son usage et son signataire (convocation et attestation : Présidente ; autres : formateur concerné ou Référente Qualiopi).
   Compte rendu prescripteur : cocher « Plusieurs documents par session » (impossible à modifier ensuite).
   Garder l'attestation en mode **manuel** jusqu'à validation du seuil (80 %).
5. **Questionnaire de satisfaction et dossier d'admission** : propositions à valider par A2C avant tout enregistrement.

### Contrôles après déploiement
- Journal de démarrage : « Migration appliquée » pour 026–031 et 041–043, aucune erreur ; second redémarrage sans rejeu.
- Menus : « Variables documentaires » (v1.7, 171 variables), « Organisme et signataires » ; Formations → section « Contenu repris dans les documents ».
- Générer une convocation et une convention pour une session réelle de test : aucune balise `{{…}}` restante, coordonnées et
  signataire corrects, horaires et lieu de la session renseignés (sinon les phrases correspondantes restent vides).
- Compte rendu prescripteur : deux générations avec deux libellés (deux fichiers), puis le même libellé (confirmation demandée).
- Fiche d'analyse des besoins : refusée à un contributeur, produite par un administrateur uniquement.
- Entretiens FSE-IA : ouvrir un entretien existant (tables 026/029/030 créées), vérifier la reprise d'un brouillon.
- Documents déjà générés avant le déploiement : toujours présents et inchangés.

### Précautions
- Ne pas basculer d'autres modèles en génération automatique avant la recette ci-dessus.
- Les données de santé (handicap, besoins, adaptations) ne sortent que pour un administrateur, jamais en génération automatique.
- Retour arrière : restauration de la sauvegarde (les migrations sont additives, sans suppression de données, mais l'index
  d'unicité des documents générés est remplacé par 028).

## Lot 7 — données complémentaires des documents A2C (dictionnaire v1.8, migrations 044 et 045)

Branche `livraison/donnees-documents-2` (issue de `main` à e286c50). Migrations **additives** ; à appliquer au démarrage comme les précédentes.

- **044** : fiche stagiaire (date de naissance, adresse, code postal, ville, profession), entreprise (adresse, SIRET, APE, effectifs,
  responsable, OPCA), domaines de handicap (donnée de santé, **administrateur seulement**), niveau issu du positionnement
  (recueil du besoin), coordonnées du prescripteur (adresse, contact, fonction, e-mail, téléphone).
- **045** : acquisition des compétences par stagiaire (acquis / en cours / pas acquis).
- **Indicateurs de session** calculés selon le document « Méthodes de calcul » d'A2C (variables `indicateur_*`) : satisfaction
  (réponses « à chaud », satisfait = 4 ou 5 sur 5), présence (heures suivies / prévues, abandons exclus), objectifs atteints
  (dernier QCM de chaque stagiaire : validé, ou score ≥ seuil, à défaut 5/10), abandons et leurs catégories, prescripteurs.
  Sans donnée, l'indicateur reste vide (jamais 0 % inventé). Les catégories d'abandon sont celles de Vigie (personnel,
  professionnel, financement, réorientation, sans nouvelles, autre), qui diffèrent des cinq colonnes de l'ancien tableur.
- **Nouveaux blocs** : `{{#competences_stagiaire}}` (grille avec X par colonne) et `{{#inscrits_session}}` (liste des inscrits
  d'une session, abandons compris) : permettent les tableaux « une ligne par stagiaire », impossibles dans Google Sheets.
- **Écrans** : Dossier du stagiaire (coordonnées, entreprise, domaines de handicap pour l'administrateur), Accompagnement
  (niveau de positionnement, nouvelle section « Acquisition des compétences »), Prescripteurs (coordonnées du contact).
- **Modèles** (hors dépôt, dossier « 5 - Modèles complets ») : 10 documents rendus et vérifiés avec le moteur réel ; les anciens
  classeurs 09, 12, 23 et 36 sont refaits en documents Word pour utiliser les blocs.

### Mise en service
1. Fusionner `livraison/donnees-documents-2` (après recette), vérifier au démarrage « Migration appliquée » pour 044 et 045.
2. Saisir les coordonnées des prescripteurs (Paramètres → Prescripteurs → Modifier).
3. Importer les modèles Word sur copie dans Google Docs et les enregistrer ; les modèles 09, 12, 13, 18 et 36 sont de portée
   **session**, les autres de portée **stagiaire** ; 19 (données de santé) n'est générable que par un administrateur.
4. Contrôle : générer 08, 13 et 23 sur une session de test ; vérifier les taux sur des données connues.

## Lot 8 — Vigie 2.0 : pilotage qualité (migrations 046 à 050)

Branche `livraison/vigie-2-0` (contient le lot 7). Migrations **additives**, appliquées au démarrage.

| Migration | Contenu |
|---|---|
| 046 | Mentions légales (SIRET, NDA, site web), référent handicap, durée de conservation ; rôle **auditeur** et date d'expiration des comptes ; journal des opérations sensibles |
| 047 | Registres : tâches qualité (récurrence), risques (criticité), partenaires, ressources et moyens |
| 048 | Préparation d'audit : campagnes, appréciation par indicateur, échantillon de sessions |
| 049 | Enquêtes en ligne (lien public anonyme) ; réponses rangées dans `satisfactions` |
| 050 | RGPD : date d'anonymisation d'une personne |

### Nouveaux écrans
- **Pilotage** : Tâches qualité (création automatique depuis les manques de preuves), Échéancier (toutes les dates), Risques,
  Préparation d'audit (audit blanc, signaux par indicateur, échantillon tiré au sort et tracé, plan d'action, dossier ZIP),
  Partenaires, Ressources et moyens.
- **Qualité** : Enquêtes en ligne (modèles satisfaction à chaud, suivi à froid, partenaires ; synthèse ; analyse tracée) ;
  tableau de bord enrichi d'un bloc « Pilotage ».
- **Paramètres** : Comptes et accès (ajout d'utilisateurs sans variable serveur, auditeur externe 90 jours max, journal),
  RGPD et conservation (durée, personnes au terme, export des données d'une personne, anonymisation confirmée),
  Organisme (SIRET, NDA, site web, référent handicap → variables `{{organisme_siret}}`, `{{organisme_nda}}`, `{{referent_handicap_*}}`).
- **Portail auditeur** : un compte « auditeur » ne voit que les dossiers d'audit partagés (référentiel, preuves, échantillon,
  actions), jamais les appréciations internes ni les données des stagiaires — garde appliquée côté serveur à toute l'API.
- **Questionnaire public** : `/repondre/<jeton>`, sans compte, adapté au téléphone.

### Sécurité
- Rôle auditeur : liste blanche serveur (`GET /api/me`, `GET /api/portail-audit/*`), expiration vérifiée à chaque requête.
- Enquête publique : jeton aléatoire de 32 caractères, réponses validées question par question, débit limité par adresse,
  aucune donnée interne exposée. Liens des ressources limités à http(s) ; CSV protégés contre l'injection de formules.
- Exports (dossier d'audit, données d'une personne), partages et anonymisations journalisés.

### Mise en service
1. Après le déploiement : « Migration appliquée » pour 044 à 050.
2. Paramètres → Organisme : saisir SIRET, NDA, référent handicap.
3. Paramètres → RGPD : fixer la durée de conservation (5 ans par défaut).
4. Tâches qualité → « Créer les tâches depuis les manques », puis attribuer des responsables.
5. Créer une préparation d'audit (audit blanc) pour la prochaine échéance de certification.
6. Pour chaque session : créer l'enquête « Satisfaction à chaud » et transmettre le lien en fin de formation ;
   l'enquête « Suivi à froid » 3 à 6 mois après.

### Couverture du cahier des charges 2.0
| Lot | État |
|---|---|
| A — Pilotage des preuves | Tableau de bord, échéances, tâches avec responsables, historique, création depuis les manques. Le cycle de vie des preuves existant (valide / à réviser / expirée / obsolète, « à confirmer ») est conservé ; pas de responsable propre à la preuve (porté par la tâche liée). |
| B — Amélioration continue | Réclamations, incidents, actions correctives (existants) + registre des risques relié aux actions et indicateurs. |
| C — Audits | Campagnes, simulation par indicateur, échantillonnage tracé, export ZIP, historique, portail auditeur. |
| D — Questionnaires | Constructeur, diffusion par lien, synthèse, analyse, export, alerte d'insatisfaction. Pas d'envoi d'e-mail ni de relance automatique (aucun service d'envoi configuré). |
| E — Ressources et compétences | Ressources et moyens, partenaires ; compétences des stagiaires (lot 7) ; intervenants et justificatifs (existants). |
| F — Gestion opérationnelle | Comptes et accès ; portail auditeur. Portails stagiaire / formateur / entreprise et envoi d'e-mails non réalisés. |
| G — IA | Non réalisé (nécessiterait un service externe et une validation des usages de données). |
| H — Interopérabilité | Exports CSV/ZIP/JSON ; pas d'API publique ni de multi-structures (hors périmètre immédiat). |
| RGPD | Durée de conservation, export (droit d'accès), anonymisation (droit à l'effacement), registre simplifié, journal. |

## Lot 9 — Preuves PDF, développement des intervenants, candidatures, portails (migrations 051 à 053)

Branche `livraison/portails-candidatures` (contient aussi le garde-fou « mode test Drive »).

- **Preuves PDF** (Qualité → Preuves PDF, et bouton « PDF » sur les registres, enquêtes et préparations d'audit) :
  tableau des preuves par indicateur, plan d'amélioration, registre des réclamations (sans identité des réclamants),
  veille, enquêtes, bilan de session (indicateurs), assiduité, plan de développement des intervenants, registres de pilotage,
  auto-évaluation d'audit. Générateur PDF interne (aucune dépendance, polices standard, pagination et date de génération).
- **Développement des intervenants** (Pilotage) : spécialités, diplômes, dernier entretien (signalé au-delà d'un an),
  besoins, actions de développement avec évaluation de l'efficacité (indicateurs 21 et 22) ; PDF global et par intervenant.
- **Candidatures en ligne** : formulaire public `/candidater` (formations ouvertes une à une, pièces attendues, consentement,
  champ piège anti-robot, débit limité). Gestion : pièces reçues, notes, décision motivée, « Accepter et inscrire »
  (fiche personne réutilisée si déjà connue, inscription créée).
- **Portails** : lien personnel `/portail/<jeton>` (empreinte seule conservée, durée 1 à 365 jours, révocable) →
  espace `/espace`. Stagiaire : formation, séances à venir, documents en PDF (export Drive), enquêtes, évaluations,
  compétences, signalement d'une difficulté ou réclamation (devient un signalement qualité). Formateur : ses sessions et
  groupes uniquement, suivi des séances, compétences des stagiaires, ressources, justificatifs, signalement d'incident.
- **Mode test Drive** : `VIGIE_DRIVE_MODE_TEST=1` et `VIGIE_DRIVE_TEST_ROOT_ID` (dossier « test » vide à la racine du Drive)
  pour tout essai local ; sur un poste local avec Google configuré, la génération est bloquée sans ce mode. Sans effet sur Railway.

## Lot 10 — Interface simplifiée : 5 espaces (aucune migration)

Branche `refonte/interface-simplifiee`. Aucune donnée ni droit modifié : seule la façon d'accéder aux écrans change.
Toutes les anciennes adresses restent valides (`/accueil` renvoie vers `/aujourdhui`).

- **Menu à 5 entrées** : Aujourd'hui, Formations, Qualiopi, Équipe, Réglages. Les rubriques de l'espace courant
  s'affichent en onglets en haut de la page ; les moins fréquentes sont rangées sous « Plus ». Réglages présente ses
  rubriques en cartes, chacune avec un lien « Tous les réglages ». Le contributeur ne voit que Aujourd'hui et Formations
  (les autres pages restent protégées par le serveur comme avant).
- **Aujourd'hui** (`GET /api/pilotage/aujourdhui`) : une seule liste « En retard / Cette semaine / Plus tard » rassemblant
  tâches, actions d'amélioration, suivi des sessions, réclamations, enquêtes de fin, candidatures, justificatifs, entretiens
  annuels, preuves, risques, audit, veille et conventions de partenaires. Une tâche se coche sur place. Périmètre
  contributeur appliqué par le serveur : ses tâches (et celles sans responsable), ses actions, le suivi des sessions.
  Aucune donnée nominative de stagiaire.
- **Formations** : sessions regroupées par formation ; dans une session, bandeau « Prochaine étape » (inscrire, compléter
  les dossiers, générer les documents, puis satisfaction et évaluations une fois la session terminée).
- **Qualiopi** : pour chaque indicateur, « ce qui est attendu », « ce que vous avez » (preuves enregistrées) et « ce qui
  manque » ; filtre « seulement ce qui reste à compléter ».
- **Équipe** : liste des intervenants avec leur état (justificatif manquant, entretien à planifier…) et, sur une même
  fiche, justificatifs, compétences et développement, lien de l'espace formateur.
- Aide et tutoriel mis à jour (le contributeur a un parcours en 5 étapes, sans écran hors de son menu).
