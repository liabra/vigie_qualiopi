# Mise en service — inventaire Drive et génération automatique

Branches empilées sur la PR n°1 (bibliothèque de modèles) :

1. `livraison/inventaire-drive` : inventaire Drive en lecture seule, enregistrement d'un fichier comme modèle.
2. `livraison/generation-automatique` : déclencheurs réels des modes automatique et conditionnel.

Chaque branche contient la précédente. Elles se fusionnent **dans cet ordre, après la PR n°1**.

## Inventaire Drive (aucune migration)

- Menu Paramètres → Inventaire Drive (administrateur).
- Périmètre : le dossier racine Vigie (`DRIVE_RACINE_ID`, sinon le dossier unique nommé `DRIVE_RACINE`,
  « A2C Qualiopi » par défaut, à la racine du Drive). Jamais créé : s'il est absent ou ambigu, la page
  l'indique (409) et rien n'est écrit.
- Lecture seule : seuls `files.list`, `files.get` et `documents.get` sont appelés. Aucune copie, aucun
  déplacement, aucune suppression sur le Drive.
- « Enregistrer comme modèle… » ouvre le formulaire de la bibliothèque prérempli ; l'enregistrement
  n'écrit que dans la base Vigie (le fichier Drive reste l'original).

## Génération automatique et conditionnelle (migration 038)

### Fonctionnement

- Un modèle automatique ou conditionnel choisit un **moment** : création de la session, inscription
  d'un stagiaire, début de la session, fin de la session.
- Un modèle conditionnel choisit aussi une **condition** évaluée par stagiaire : situation de handicap,
  besoin d'adaptation (champ ou adaptation de parcours), prescripteur renseigné.
- L'événement dépose une tâche dans `generations_planifiees` ; une file en arrière-plan la traite
  (au démarrage, à chaque événement, puis toutes les 15 minutes).
- Seuls les documents **manquants** sont produits : un document existant n'est jamais remplacé ni retiré
  des preuves. Les documents sont rattachés à la session, aux preuves des indicateurs du modèle et à
  l'historique (`generations.planification_id`).
- Début et fin de session : au passage du statut (en cours, terminée) ou quand la date est atteinte.
  Le balayage par date ne remonte **jamais** avant l'activation du déclencheur : aucun rattrapage
  massif des sessions passées.

### Sécurité et erreurs

- Génération sans droits administrateur : un modèle qui utilise une donnée restreinte (besoins
  spécifiques, aménagements…) est **bloqué** et doit être généré à la main par un administrateur.
- Drive non connecté : la tâche attend, sans être comptée en échec.
- Autre échec (Google momentanément indisponible, modèle illisible…) : nouvel essai après 15, 30, 45 puis
  60 minutes ; bloquée au 5ᵉ échec. Un refus du précontrôle bloque immédiatement.
- Modèle désactivé ou repassé en manuel, session annulée ou archivée : tâche « sans objet ».
- Une tâche bloquée se relance depuis l'onglet Documents de la session (administrateur).
- Les erreurs Google et SQL brutes ne sont jamais affichées.

### Migration 038

- Ajoute à `modeles_documents` : `declencheur`, `condition_code`, `declencheur_actif_depuis`
  (contraintes de valeurs et de cohérence).
- Crée `generations_planifiees` (une seule tâche en attente par modèle × session × événement).
- Ajoute `generations.planification_id`.
- Additive ; les modèles déjà classés « automatique » ou « conditionnel » sont conservés tels quels,
  **sans déclencheur** : ils ne produisent rien tant que l'administrateur n'a pas choisi le moment.
- Signature ajoutée à `server/src/signaturesMigrations.js` (base sans historique : référence possible).

## Ordre des opérations (chacune soumise à autorisation)

1. PR n°1 fusionnée et vérifiée (voir `MISE_EN_SERVICE_BIBLIOTHEQUE.md`).
2. Sauvegarde de la base.
3. Fusion de `livraison/inventaire-drive` : aucun changement de schéma.
4. Contrôle : Paramètres → Inventaire Drive liste les fichiers du dossier Vigie.
5. Fusion de `livraison/generation-automatique` : le démarrage applique `038_generations_automatiques.sql`.
   Journal attendu : `Migration appliquée : 038_generations_automatiques.sql`.
6. Contrôles en lecture seule :
   ```sql
   SELECT count(*) FROM schema_migrations;                                   -- 28
   SELECT mode_generation, declencheur, count(*) FROM modeles_documents GROUP BY 1, 2;
   SELECT statut, count(*) FROM generations_planifiees GROUP BY 1;            -- vide au départ
   ```
7. Activation progressive : passer **un** modèle en automatique sur une session de test, vérifier le
   document produit et le suivi dans l'onglet Documents, puis généraliser.

## Retour arrière

Revenir au déploiement précédent. Si nécessaire, après avoir repassé les modèles en manuel :

```sql
BEGIN;
ALTER TABLE generations DROP COLUMN IF EXISTS planification_id;
DROP TABLE IF EXISTS generations_planifiees;
ALTER TABLE modeles_documents DROP CONSTRAINT IF EXISTS modeles_declencheur_coherent;
ALTER TABLE modeles_documents DROP COLUMN IF EXISTS declencheur, DROP COLUMN IF EXISTS condition_code,
  DROP COLUMN IF EXISTS declencheur_actif_depuis;
DELETE FROM schema_migrations WHERE nom = '038_generations_automatiques.sql';
COMMIT;
```

Les documents déjà générés automatiquement restent sur le Drive et dans `documents_generes`.
