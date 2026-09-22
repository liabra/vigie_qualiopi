# Vigie Qualiopi — PROJECT_HANDOFF

| Repère | Valeur |
| --- | --- |
| **Projet** | `liabra/vigie_qualiopi` — branche `main` |
| **Production** | Railway |
| **État validé au** | 22/09/2026 |
| **Dernier lot métier validé en production** | preuves — création et rattachement manuels (`1dd4763`) |
| **Migration de production actuelle** | `010_horaire_session.sql` |
| **Suite de tests validée** | **91/91 au vert** |
| **Source de suivi récente** | `VIGIE_AGENT_LOG.md` |

Ce document remplace le handoff Codex historique comme document de passation général du projet.  
Il doit être lu avec `README.md`, `VIGIE_AGENT_LOG.md`, la spec fonctionnelle et les migrations concernées.

**Ce document ne consigne volontairement aucun hash de `HEAD` ni d'`origin/main`** : une telle
valeur est périmée dès le commit suivant. Pour connaître la position réelle du dépôt :

```bash
git log --oneline -5
git rev-list --count origin/main..HEAD   # commits locaux non poussés
```

---

## 1. Finalité métier

Vigie Qualiopi est l'outil interne d'A2C pour :

- rester prêt pour un audit Qualiopi à tout moment ;
- réduire la charge administrative liée aux formations ;
- produire automatiquement les documents de formation ;
- rattacher les preuves au bon indicateur Qualiopi ;
- suivre les alertes, péremptions, audits et non-applicables ;
- gérer formations, sessions, groupes, stagiaires et inscriptions ;
- conserver les fichiers sur Google Drive, l'application servant d'index métier et de couche de contrôle.

L'application remplace progressivement l'ancien fonctionnement fondé sur Google Sheets + Apps Script.

### Principes métier déjà tranchés

- Les fichiers restent sur Google Drive : Vigie n'est pas un coffre-fort.
- Les indicateurs 21 et 23, anciennement relevés en NC majeure, sont considérés corrigés et validés : ne pas rouvrir ce chantier sans nouvelle information.
- Indicateurs historiquement non applicables à A2C : **7, 13, 14, 15, 16, 20, 28, 29**.
- L'indicateur 3 s'applique.
- Pour les absences : principe métier prévu = **présent par défaut, seules les absences sont saisies**.
- Pour l'émargement : A2C utilise déjà **EduSign** ; ne pas recréer un système maison de signature sans décision explicite.
- Historique des anciennes formations et multi-tenant/commercialisation : **reportés**.

---

## 2. Règles de collaboration avec Mme Stark

- Mme Stark pilote l'essentiel du produit côté métier et travaille avec les agents IA en langage naturel.
- Livrer du code testé, committé, traçable et déployable sans manipulation technique de sa part.
- Ne jamais prétendre avoir vérifié une interface, un droit, une route, un document ou un déploiement si cela n'a pas réellement été vérifié.
- Ne pas redemander une décision déjà tranchée.
- Si une vraie décision produit est nécessaire, poser une question claire et unique plutôt que d'inventer.
- Français, tutoiement, réponses claires et relativement courtes.

---

## 3. Stack et exploitation

| Couche | Choix |
| --- | --- |
| Client | React 18 + Vite 5, `client/` |
| Serveur | Node 22.x, Express 4, ES modules, `server/` |
| Base | PostgreSQL Railway |
| Migrations | `server/db/migrations/NNN_*.sql`, appliquées au démarrage |
| Google | OAuth, Drive API, Sheets API, Docs API |
| Déploiement | Railway, auto-deploy depuis `main` |
| Healthcheck | `/api/health` |
| Tests | `node --test` via `npm test` |
| Monorepo | npm workspaces |

### Variables d'environnement

Voir `.env.example`.

Ne jamais committer de valeurs réelles. Les principales variables sont notamment :

- `DATABASE_URL`
- `SESSION_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `ADMIN_EMAILS`
- `CONTRIBUTEUR_EMAILS`
- `DRIVE_ACCOUNT_EMAIL`
- `ORGANISME_NOM`
- `DRIVE_RACINE`
- `DRIVE_RACINE_ID`

### Google

- Compte Drive dédié à l'association.
- La recherche Drive n'est pas restreinte au seul dossier Qualiopi : risque connu et accepté.
- Conserver les scopes minimaux ; ne pas demander le scope Drive complet sans décision explicite.
- `google-auth-library` doit rester compatible avec la pile `@googleapis/*` ; le test `pileGoogle.test.js` protège ce point.
- Un changement de scopes impose une reconnexion Drive côté admin.

### Railway

- Un push sur `main` déclenche un déploiement production.
- Les migrations sont exécutées automatiquement au démarrage.
- **Ne jamais lancer une migration manuellement en production si le mécanisme normal suffit.**
- `railway.json` fonctionne encore mais a été signalé comme déprécié ; prévoir un chantier dédié de migration de configuration avant le **01/12/2026**.
- Ne pas mélanger ce chantier de maintenance avec une fonctionnalité métier.

---

## 4. Architecture

```text
server/src/index.js
    démarrage : config → migrations → seed si base vide → HTTP

server/src/app.js
    Express : /auth, /api, puis build du client

server/src/session.js
    cookies signés HMAC
    requireAuth / requireRedacteur / requireAdmin

server/src/routes/auth.js
    OAuth + connexion Drive

server/src/routes/api.js
    référentiel, preuves, import classeur, Drive, audits

server/src/routes/gestion.js
    formations, sessions, groupes, stagiaires, inscriptions,
    modèles et génération documentaire

server/src/services/
    google.js
    classeur.js
    driveIndex.js
    import.js
    documents.js
    marqueurs.js
    audits.js

client/src/
    App
    Referentiel
    Preuves
    Sessions
    Modeles
    AuditsHistory
    RechercheDrive
    DriveStatus
    Login
```

Navigation historique :

- Référentiel
- Preuves
- Audits
- Sessions
- Modèles

L'audit produit à venir doit reconstruire la navigation et les écrans actuels depuis le code plutôt que de supposer que cette liste est encore exhaustive.

---

## 5. Modèle de données connu

### Référentiel

- `referentiel_versions`
- `criteres`
- `indicateurs`
- `indicateurs_non_applicables`

Architecture prévue pour plusieurs versions de référentiel.

### Preuves

- `preuves`
- `preuve_fichiers`
- vue `preuves_enrichies`

La vue `preuves_enrichies` centralise la logique de statut, incomplet et alertes.

### Gestion des formations

- `formations`
- `formation_versions`
- `sessions`
- `groupes`
- `stagiaires`
- `inscriptions`

Tables existantes historiquement mais non exploitées ou partiellement exploitées :

- `absences`
- `resultats_qcm`
- `satisfactions`

Ces tables se rattachent à l'inscription, pas directement au stagiaire.

### Conformité / veille

- `audits_history`
- `veille`
- `veille_indicateurs`

### Accès

- `utilisateurs`
- `drive_connexions`

---

## 6. Fonctionnalités considérées livrées

### Référentiel / conformité

- Référentiel V9 exploité.
- Statut agrégé par indicateur.
- Gestion des non-applicables.
- Score basé sur le nombre d'indicateurs applicables.
- Changement de statut en masse.

### Import / Drive

- Import du classeur d'audit.
- Analyse des en-têtes et cellules fusionnées.
- Rapprochement Drive.
- Gestion des rapprochements ambigus.
- Import rejouable / idempotent.

### Preuves

- Preuves multi-fichiers.
- Modes `unique`, `multiple`, `par_stagiaire`.
- Inscriptions abandonnées exclues des comptes attendus.
- Alertes de péremption.
- Statuts et dates.
- **Création manuelle d'une preuve** (sans import préalable), pour un ou plusieurs indicateurs.
- **Rattachement / remplacement / retrait manuel d'un fichier Drive** sur une preuve existante.
- **Modification manuelle** du titre, de la description et de l'indicateur d'une preuve.

### Formations / sessions / groupes / stagiaires

- Formations versionnées.
- Sessions figent la version de formation.
- Groupes.
- Stagiaires.
- Inscriptions.
- Abandons datés.
- Civilité.

### Documents

- Modèles Google Docs / Sheets.
- Copie du modèle, jamais modification du modèle original.
- Marqueurs.
- Classement Drive.
- Rattachement à une preuve.
- Régénération contrôlée.
- Contrôle de marqueurs inconnus sur Docs.
- Convocation et Attestation déjà travaillées.

### Audits

- Historique d'audits.
- Types d'audits.
- Rapport Drive.
- Lecture et droits selon rôle.

---

## 7. Fonctionnalité horaire — TERMINÉE

Le chantier historique `{{horaire}}` est **clos** et ne doit plus être remis au backlog.

### Implémenté

- migration `010_horaire_session.sql`
- champ `sessions.horaire` nullable
- création avec ou sans horaire
- trim
- chaîne vide / espaces → `NULL`
- lecture / affichage
- marqueur `{{horaire}}`
- génération documentaire
- édition de l'horaire d'une session existante par admin
- suppression de l'horaire
- lecture seule contributeur

### Tests

- `npm test` : **70/70** au moment de ce lot (repère courant : voir §14)
- build Vite : OK
- tests de route PATCH hermétiques avec base simulée
- tests sur PostgreSQL jetable
- test navigateur réel
- génération Google simulée
- smoke tests production
- génération réelle Google validée

### Production

- commit métier : `b834d6b` — `Sessions : ajouter et modifier l'horaire`
- commit documentaire : `d1be9f9` — `Documentation : valider le déploiement horaire`
- migration 010 appliquée automatiquement en production
- healthcheck OK
- aucun incident de déploiement

Réserve : le compte contributeur n'a pas été rejoué manuellement en production faute d'adresse disponible, mais son comportement est couvert par tests automatisés et vérifications locales.

---

## 7 bis. Lot L1 — preuves : ajout et rattachement manuel — TERMINÉ

C'était le **blocage principal** identifié par l'audit produit : une preuve ne pouvait naître que
d'un import de classeur, d'une recherche Drive ou d'une génération documentaire. Impossible de
créer une preuve à la main ni d'en corriger une — ce qui bloquait de fait le rattachement EduSign
et la reprise indicateur par indicateur des preuves de l'auditrice.

### Implémenté

- `POST /api/preuves` (`requireAdmin`) : création manuelle, un ou plusieurs indicateurs, fichier
  Drive facultatif ; un fichier partagé par N indicateurs produit N preuves liées.
- `PATCH /api/preuves/:id` étendu : titre, description, indicateur.
- Écran Preuves : formulaire de création, édition en ligne, remplacement / rattachement /
  retrait d'un fichier Drive, suppression avec rafraîchissement du compteur.
- Vérification que l'indicateur visé appartient bien à une version **active** du référentiel.

### Tests

- `server/test/preuves.test.js` : 21 tests hermétiques (application Express réelle + base simulée).
- `npm test` : **91/91** (contre 70/70 avant ce lot)
- build Vite : OK
- test navigateur réel sur PostgreSQL jetable
- suppression mutante rejouée pour vérifier que les tests mordent

### Production

- commit métier : `1dd4763` — `Preuves : compléter l'ajout et le rattachement manuel`
- commit documentaire : `40e9d54` — `Documentation : ajouter le handoff projet`
- déployé en production, Railway **SUCCESS**
- migration inchangée : **010**
- smoke test manuel en production par l'utilisatrice : **8/8 OK**
  (bouton d'ajout, création, affichage, modification titre/description, changement d'indicateur,
  rattachement / remplacement d'un fichier unique, suppression et compteur, preuves antérieures intactes)

---

## 8. Droits

Historique de principe :

| Rôle | Portée |
| --- | --- |
| Admin | administration complète |
| Contributeur | consultation + génération documentaire + gestion stagiaire/inscription selon routes explicitement autorisées |

Le contributeur peut historiquement :

- consulter les données autorisées ;
- ajouter un stagiaire sur une session ;
- gérer inscription, groupe, prescripteur et dossier ;
- gérer l'abandon ;
- générer des documents.

Décision historique à vérifier pendant l'audit :

- le contributeur doit pouvoir saisir les absences.

Le contributeur ne doit pas obtenir par accident de droits admin sur :

- formations ;
- création de sessions ;
- création de groupes ;
- modèles ;
- référentiel ;
- non-applicable ;
- preuves ;
- audits ;
- connexion Drive ;
- administration.

### Écart déjà observé

Le contributeur semble pouvoir voir l'onglet **Tableau de bord**, alors que la spec historique le réserve à l'admin.  
À réauditer côté frontend **et** backend.

Toute nouvelle route doit choisir explicitement :

- `requireAuth`
- `requireRedacteur`
- `requireAdmin`

Une restriction visuelle seule n'est jamais suffisante.

---

## 9. Règles Git / base / migrations

### Git

Avant toute tâche :

1. `git status`
2. `git log` récent
3. lire `VIGIE_AGENT_LOG.md`
4. lire ce handoff
5. lire les fichiers métier concernés

Avant commit :

- tests appropriés
- build si frontend ou intégration
- `git diff --check`
- vérifier absence de secrets et artefacts

Avant push :

- `git fetch`
- vérifier divergence avec `origin/main`
- jamais `--force`

### Production

Demander validation humaine avant :

- suppression de données ;
- modification destructive ;
- réécriture d'historique ;
- changement risqué de migration ;
- push dont les effets ne sont pas vérifiables ;
- manipulation manuelle de production.

### Migrations

- Ne jamais modifier une migration déjà déployée.
- La prochaine migration doit être **011** ou plus.
- Toujours additive et sûre sur une base contenant des données réelles sauf décision explicite contraire.
- Préférer colonnes nullables / valeurs compatibles.

---

## 10. Règles de génération documentaire

Le registre de référence des marqueurs est :

`server/src/services/marqueurs.js`

Lorsqu'un nouveau marqueur est ajouté :

1. l'ajouter au registre ;
2. l'ajouter à la documentation ;
3. ajouter / adapter les tests ;
4. s'il provient d'un stagiaire ou d'une autre entité, vérifier que la requête source le sélectionne réellement.

Piège déjà rencontré : un champ absent de `cibles()` peut produire un marqueur vide silencieusement.

Ne jamais supposer qu'un modèle est correctement intégré simplement parce qu'il existe sur Drive.

---

## 11. Backlog historique à réévaluer

Ce backlog reste la base historique, mais **l'audit actuel doit vérifier l'état réel dans le code avant de développer quoi que ce soit**.

### 11.1 Émargement / EduSign

Décision historique :

- A2C utilise déjà EduSign.
- Ne pas développer une capture de signature maison sans besoin explicite.

À étudier :

- modèle d'émargement si nécessaire ;
- export EduSign ;
- rattachement de l'export comme preuve ;
- classement Drive ;
- lien avec assiduité.

**Mise à jour 22/09/2026** : le rattachement manuel d'un fichier Drive comme preuve **n'est plus
bloqué** par l'absence de création de preuve — c'est précisément ce qu'a livré le lot L1 (§7 bis).
Un export EduSign peut donc désormais être déposé comme preuve sans passer par un import de classeur.
Ce qui reste à décider est le **modèle d'émargement** et le **classement Drive**, pas la mécanique
de rattachement.

### 11.2 Présence / assiduité / absences

Infrastructure historique : table `absences`.

Principe métier :

- tous présents par défaut ;
- saisir uniquement les absences ;
- contribuer au suivi d'assiduité, abandon et éventuellement heures réellement suivies ;
- saisissable par contributeur.

À terminer après audit réel des routes/écrans existants.

### 11.3 Résultats QCM / notes

Infrastructure historique :

- `resultats_qcm`

Décision précédente :

- développement fonctionnel volontairement différé en attente d'une meilleure automatisation de saisie.

Le besoin est désormais à réévaluer car une nouvelle session de formation approche.

À couvrir potentiellement :

- positionnement initial ;
- QCM formatifs ;
- validations intermédiaires ;
- score ;
- seuil de réussite ;
- remédiation ;
- traçabilité nominative.

### 11.4 Satisfaction

Infrastructure historique :

- `satisfactions`

À réévaluer pour :

- bénéficiaires ;
- autres parties prenantes si nécessaire ;
- synthèse ;
- preuve Qualiopi ;
- exploitation des retours.

### 11.5 Intervenants / formateurs

État historique :

- champ `formateur` texte seulement.

À construire selon besoins :

- fiche intervenant ;
- rattachement formations / sessions / groupes ;
- compétences / qualifications ;
- justificatifs ;
- éléments nécessaires aux indicateurs concernés.

### 11.6 Veille / rupture réglementaire

Infrastructure :

- `veille`
- `veille_indicateurs`

À câbler :

- saisie de veille ;
- rattachement aux indicateurs ;
- rupture / changement réglementaire ;
- exploitation concrète de la veille ;
- actions / adaptations résultantes ;
- preuves associées.

### 11.7 Référentiel V10

Architecture préparée pour plusieurs versions.

Règle absolue :

- **ne rien inventer** ;
- attendre / utiliser uniquement le guide officiel applicable ;
- préparer la migration sans écraser des données vérifiées.

### 11.8 Modèles documentaires / marqueurs

Convocation et Attestation déjà faites.

À auditer modèle par modèle :

- modèle présent ?
- marqueurs valides ?
- données disponibles ?
- génération réelle ?
- rattachement preuve ?
- classement ?
- régénération ?

### 11.9 Preuves Noé

Chantier de fond :

- reprendre indicateur par indicateur ;
- rattacher les preuves validées par l'auditrice ;
- conserver les liens Drive ;
- appliquer les non-applicables confirmés.

**Mise à jour 22/09/2026** : ce chantier **n'est plus bloqué par l'outil**. La création manuelle
d'une preuve, la modification de son titre / description / indicateur et le rattachement ou le
remplacement d'un fichier Drive sont livrés et validés en production (§7 bis). Il ne reste donc
qu'un travail de **contenu** — indicateur par indicateur, avec l'auditrice.

### 11.10 Historique anciennes formations

**REPORTÉ**

Ne pas développer maintenant sauf décision explicite.

### 11.11 Multi-tenant / commercialisation

**REPORTÉ**

Nécessitera un vrai chantier d'isolation de données et de sécurité.  
Ne pas sur-concevoir maintenant.

---

## 12. Écarts / dettes déjà identifiés récemment

À inclure dans l'audit consolidé :

1. `/api/sessions/abc` provoquait un **500** au lieu d'une réponse propre pour identifiant invalide.
   - défaut préexistant ;
   - probablement représentatif d'autres routes à identifiant numérique ;
   - à traiter comme chantier de validation générique si confirmé.

2. Les autres champs d'une session restent historiquement peu ou pas modifiables après création.
   - horaire est modifiable ;
   - vérifier dates, durée, lieu, etc.
   - décider ce qui doit être modifiable avant la prochaine session.

3. Tableau de bord visible au contributeur :
   - vérifier cohérence avec la spec ;
   - vérifier protection backend.

4. Test manuel contributeur en production :
   - non réalisé pour horaire faute d'adresse de test ;
   - les tests automatisés sont verts.

5. Configuration Railway :
   - `railway.json` à migrer dans un chantier dédié avant échéance signalée.

6. README historique :
   - certaines sections peuvent être périmées ;
   - ne jamais le prendre comme vérité unique sans comparaison avec le code et `VIGIE_AGENT_LOG.md`.

---

## 13. Pièges déjà rencontrés

- Colonne oubliée dans `cibles()` → marqueur vide silencieux.
- Compteur de conformité figé sur 32 au lieu de soustraire les non-applicables.
- Contraintes SQL trop strictes rendant certains réglages impossibles.
- API Google Docs non activée → génération bloquée.
- Recherche Drive par parent : partage public insuffisant dans certains cas.
- Écran Audits : ne pas réutiliser des propriétés supposant une preuve.
- Ne pas dupliquer la recherche Drive ; composant mutualisé.
- Ne jamais considérer un bouton caché comme une protection de droit.
- Ne jamais travailler directement contre la base Railway lorsqu'une base jetable peut être utilisée.
- Les tests hors dépôt sont utiles pour exploration, mais les protections essentielles doivent finir dans `npm test`.

---

## 14. Niveau actuel de validation

Référence connue au **22/09/2026** :

- `npm test` : **91/91**
- `npm run build` : OK
- production Railway : OK
- migration de production : **010**
- healthcheck : OK
- arbre Git : propre, aucun commit en attente de push au moment de cette rédaction

Ces valeurs sont des **repères de passation**. Toujours les revérifier au début d'un nouveau
chantier.

Une fonctionnalité n'est considérée comme validée que si elle a été vérifiée **en production**
(ou sur une base jetable équivalente), pas seulement parce que ses tests passent.

---

## 15. Priorité actuelle : finaliser Vigie avant une nouvelle session

La priorité n'est plus d'ajouter des fonctions isolées au fil de l'eau.

Objectif :

> rendre Vigie réellement exploitable de bout en bout pour une nouvelle session de formation, puis fermer les principaux écarts Qualiopi.

Avant nouvelle implémentation, réaliser un audit exhaustif qui fusionne :

1. backlog historique de ce document ;
2. état réel du dépôt ;
3. `VIGIE_AGENT_LOG.md` ;
4. spec fonctionnelle ;
5. écarts récents ;
6. couverture de tests ;
7. besoins de la prochaine session.

État de la feuille de route au **22/09/2026** :

- **L1 — preuves : ajout et rattachement manuel** : exécuté, déployé, validé en production (§7 bis).
- **L2 — absences / assiduité** : lot suivant, en cours de développement.

Classer ensuite :

- BLOQUANT
- IMPORTANT
- CONFORT
- DETTE TECHNIQUE
- REPORTÉ

Puis exécuter les lots validés séquentiellement :

```text
lot
→ tests
→ build
→ vérifications réelles
→ commit
→ journal
→ validation avant push si production concernée
→ lot suivant
```

Ne pas faire plusieurs chantiers d'écriture concurrents dans le même arbre Git.

---

## 16. Parcours cible à pouvoir réaliser sans bricolage technique

À terme, Vigie doit permettre de :

```text
Créer / choisir une formation
→ préparer une session
→ renseigner les intervenants
→ créer les groupes
→ ajouter / importer les stagiaires
→ les inscrire
→ compléter leurs dossiers
→ rattacher prescripteurs
→ générer les documents
→ démarrer la formation
→ suivre présence / absences / assiduité
→ saisir ou importer évaluations / QCM
→ gérer remédiations
→ recueillir les satisfactions
→ gérer un abandon
→ produire les documents de fin
→ rattacher émargements EduSign
→ rattacher les preuves
→ vérifier la conformité Qualiopi
→ préparer un audit
```

Toute étape nécessitant SQL, modification manuelle en base, bricolage Drive non prévu ou intervention technique doit être signalée comme écart.

---

## 17. Démarrage d'un agent

Avant de modifier quoi que ce soit :

```bash
git status
git fetch
git log --oneline -10
npm test
```

Puis lire :

1. `PROJECT_HANDOFF.md`
2. `VIGIE_AGENT_LOG.md`
3. `README.md`
4. la spec fonctionnelle
5. les migrations / routes / services du chantier

Ne pas lancer de modification avant d'avoir compris l'état réel du dépôt.

---

## 18. Source de vérité

Ordre recommandé lorsque des documents se contredisent :

1. **code et schéma réellement déployés**
2. **tests exécutés**
3. **VIGIE_AGENT_LOG.md**
4. **PROJECT_HANDOFF.md**
5. **README.md**
6. anciennes specs / anciens handoffs

Une fonctionnalité n'est pas considérée comme terminée parce qu'elle est documentée ou qu'une table existe.

Elle est considérée terminée seulement si son parcours réel est exploitable, protégé par les bons droits et suffisamment testé.
