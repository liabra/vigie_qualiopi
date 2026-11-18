# Mise en service — bibliothèque de modèles (PR n°1)

## Contenu livré

- Migrations `036_modeles_bibliotheque.sql` et `037_modeles_typologie_unicite.sql`.
- Bibliothèque de modèles : type de document (12 catégories), mode de génération déclaré,
  condition, modification, désactivation et réactivation.
- Lanceur de migrations capable de reprendre une base déjà peuplée dont `schema_migrations` est vide.

## Décision technique : référence des migrations par signature

Constat : la table `schema_migrations` a été trouvée vide alors que le schéma 001 à 025 est présent.
Le lanceur rejouerait alors `001_schema_initial.sql` et le démarrage échouerait.

Choix retenu : plutôt qu'une réconciliation SQL manuelle, le lanceur traite ce cas lui-même.

- Si `schema_migrations` contient un historique : comportement inchangé (seules 036 et 037 s'appliquent).
- Si `schema_migrations` est vide **et** que la base est peuplée (`referentiel_versions` existe) :
  chaque migration est vérifiée par sa signature (`server/src/signaturesMigrations.js`, requêtes en lecture seule).
  - signature présente : la migration est enregistrée, **sans être rejouée** ;
  - signature absente (par exemple 007) : la migration est appliquée normalement, dans l'ordre.
- Si une migration n'a pas de signature : le démarrage s'arrête, rien n'est rejoué ni enregistré.

Tout se fait dans la transaction du lanceur, sous verrou consultatif. Les signatures de 006, 007, 020 et 021
reprennent la requête de contrôle A (vue `preuves_enrichies`, contraintes `preuves_check*`,
contrainte `satisfactions_type_check`).

Tests : `server/test/migrationsReference.test.js` (base de production simulée, cas 007 absente,
historique présent, signature manquante) et `server/test/livraisonModeles.test.js`.

## Ordre des opérations (chacune soumise à autorisation)

1. **Contrôle en lecture seule** sur la production (facultatif mais recommandé) :
   ```sql
   SELECT count(*) FROM schema_migrations;
   ```
   Si le résultat n'est pas 0, l'historique existe : le lanceur appliquera seulement 036 et 037.
2. **Sauvegarde** de la base (pg_dump depuis le poste, voir la procédure de sauvegarde locale).
3. **Fusion de la PR n°1** dans `main` : déclenche le déploiement Railway automatique.
4. **Vérification du démarrage** dans les journaux Railway :
   - `Référence des migrations établie sur base existante : 25 enregistrée(s) sans rejeu` (si la table était vide) ;
   - `Migration appliquée : 036_modeles_bibliotheque.sql`, puis `037_modeles_typologie_unicite.sql` ;
   - `/api/health` répond.
5. **Contrôles après déploiement** (lecture seule) :
   ```sql
   SELECT count(*) FROM schema_migrations;                           -- 27
   SELECT type_document, mode_generation, count(*) FROM modeles_documents GROUP BY 1, 2;  -- existants : autre / manuel
   SELECT to_regclass('public.modeles_un_actif_par_fichier_portee'); -- non nul
   ```
6. **Reclassement** des modèles existants depuis Paramètres → Modèles (type, mode, indicateurs).

## Retour arrière

Revenir au déploiement précédent dans Railway. Les migrations 036 et 037 sont additives ; les colonnes
ajoutées sont ignorées par l'ancienne version. Si nécessaire :

```sql
BEGIN;
DROP INDEX IF EXISTS modeles_un_actif_par_fichier_portee;
ALTER TABLE modeles_documents ADD CONSTRAINT modeles_documents_drive_file_id_portee_key UNIQUE (drive_file_id, portee);
ALTER TABLE modeles_documents DROP CONSTRAINT IF EXISTS modeles_documents_type_document_check;
ALTER TABLE modeles_documents DROP CONSTRAINT IF EXISTS modeles_condition_coherente;
ALTER TABLE modeles_documents DROP COLUMN IF EXISTS type_document, DROP COLUMN IF EXISTS mode_generation, DROP COLUMN IF EXISTS condition_generation;
DELETE FROM schema_migrations WHERE nom IN ('036_modeles_bibliotheque.sql', '037_modeles_typologie_unicite.sql');
COMMIT;
```

La contrainte d'unicité ne peut être rétablie que si aucun couple fichier × portée n'a plusieurs modèles.
