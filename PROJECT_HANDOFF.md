# Vigie Qualiopi — PROJECT_HANDOFF

| Repère | Valeur |
| --- | --- |
| **Projet** | `liabra/vigie_qualiopi` — branche `main` |
| **Production** | Railway |
| **État validé au** | 22/09/2026 |
| **Dernier lot métier validé en production** | stagiaires et dossiers (L3 `fbdc6c6`) + prescripteurs configurables (L3-bis `a2de631`) |
| **Migration de production actuelle** | `011_prescripteurs_configurables.sql` |
| **Suite de tests validée** | **199/199 au vert** |
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
- `prescripteurs` (migration 011 : liste configurable, `code` stable + `nom` + `actif`)

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
- Absences par inscription : date, demi-journée, durée en heures, justifiée ou non, motif.
- Assiduité par inscription, calculée seulement lorsqu'elle est fiable.
- Import en masse de stagiaires (CSV, aperçu puis confirmation transactionnelle).
- Fiche stagiaire complète : civilité, contact, entreprise, financeur, situation de handicap, besoins d'adaptation.
- Inscription : groupe, prescripteur, dossier complet, statut, abandon.

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

## 7 ter. Lot L2 — absences et assiduité — TERMINÉ

Principe métier confirmé : **un stagiaire est présent par défaut, seules ses absences sont
enregistrées**. Aucune feuille de présence quotidienne parallèle n'a été créée, et **EduSign n'est
pas touché par ce lot**.

### Schéma rencontré — aucune migration nécessaire

La table `absences` existe depuis la migration 001 et couvrait déjà tout le besoin :
`inscription_id` (FK vers `inscriptions`, `ON DELETE CASCADE`), `date_absence NOT NULL`,
`demi_journee` (CHECK `matin` / `apres_midi` / `journee`, **nullable**), `duree_heures`
(`numeric(5,2)`, nullable), `justifiee NOT NULL DEFAULT false`, `motif`, plus le trigger
`absences_updated_at`.

**Aucune migration 011 n'a été créée.** Deux points à retenir :

- `sessions.duree_heures` **n'existe pas**. La durée prévue d'une session se lit sur
  `sessions.duree_heures_reelle`, à défaut sur `formation_versions.duree_heures_defaut`
  (via `sessions.formation_version_id`).
- Le schéma ne peut pas interdire un doublon « même inscription, même date, même demi-journée » :
  `demi_journee` étant nullable, un index unique ne comparerait jamais deux `NULL`. Le contrôle
  est donc fait par la route, qui répond **409**.

### Routes

- `GET /api/sessions/:id/absences` (`requireAuth`) — absences et assiduité, inscription par inscription.
- `POST /api/inscriptions/:id/absences` (`requireRedacteur`) — ajout.
- `PATCH /api/absences/:id` (`requireRedacteur`) — correction.
- `DELETE /api/absences/:id` (`requireRedacteur`) — suppression.

### Calculs retenus

- heures d'absence = somme des `duree_heures` saisies ;
- heures suivies = durée prévue − heures d'absence, avec un plancher à 0 ;
- taux d'assiduité = heures suivies / durée prévue × 100, **borné entre 0 % et 100 %** ;
- **aucun taux** pour un abandon — les heures réellement suivies avant abandon ne sont pas
  modélisées — ni lorsque la durée prévue est inconnue ou nulle ; dans ce cas, seul le total
  d'heures d'absence est affiché ;
- un dépassement (absences supérieures à la durée prévue) est **signalé**, pas masqué ;
- la durée d'une absence est **toujours saisie** : elle n'est jamais déduite d'une « demi-journée ».

### Droits

ADMIN et CONTRIBUTEUR : lecture, création, modification et suppression des absences.
Aucun autre droit n'est élargi : formations, sessions, groupes, preuves, modèles, référentiel,
audits et Drive restent hors de portée du contributeur (vérifié en direct : 403).

### Tests

- `server/test/absences.test.js` : 44 tests hermétiques (application Express réelle + base simulée).
- `npm test` : **135/135**
- test navigateur réel sur PostgreSQL jetable, avec un compte admin **et** un compte contributeur.
- trois mutations rejouées pour vérifier que les tests mordent.

### Production

- commit métier : `2f4fd84` — `Assiduité : gérer les absences des stagiaires`
- commit de clarification : `f7273ee` — `Sessions : clarifier le libellé de durée` (« durée prévue »
  à la place de « durée réelle », colonne SQL et priorité inchangées)
- déployé en production, Railway **SUCCESS**
- `/api/health` : HTTP 200
- migration inchangée : **010**
- smoke test manuel en production par l'utilisatrice : **5/5 OK**
  (bloc visible, ajout + recalcul, modification + recalcul, suppression + retour au calcul
  précédent, stagiaire sans absence à 100 % et abandon sans taux trompeur)

### Limite connue

Le contrôle de doublon se fait par une lecture suivie d'une écriture, sans transaction ni index
unique : deux saisies simultanées de la même absence pourraient toutes deux passer. Acceptable
pour une saisie manuelle à un seul poste ; à revoir si la saisie devient concurrente.

---

## 7 quater. Lot L3 — stagiaires et dossiers : import CSV, fiches, inscriptions — TERMINÉ

Objectif : rendre la préparation d'une session rapide et fiable à plusieurs stagiaires.

### Schéma réutilisé — aucune migration nécessaire

Toutes les colonnes utiles existaient déjà :

- `stagiaires` : `civilite` (008), `nom`, `prenom`, `email`, `telephone`, `entreprise`, `financeur`,
  `situation_handicap`, `besoins_adaptation` ;
- `inscriptions` : `stagiaire_id`, `session_id` (UNIQUE sur le couple), `groupe_id`, `prescripteur`,
  `dossier_complet`, `statut`, `date_abandon`, `motif_abandon` ;
- `groupes` : `session_id`, `nom` (UNIQUE par session) ;
- `sessions` : dates, référence, etc.

**Aucune contrainte UNIQUE n'a été ajoutée sur l'email**, conformément à la consigne : le
rapprochement est fait par la route, jamais par le schéma.

### Import CSV

- parseur **sans dépendance** (`server/src/services/csvStagiaires.js`), virgule ou point-virgule,
  guillemets, BOM, détection d'encodage illisible (U+FFFD) ;
- en-têtes tolérants (« Prénom », « E-mail », « Situation de handicap »…) ;
- une colonne non reconnue est **signalée, jamais devinée** ; deux colonnes rappelant le même champ
  sont refusées comme ambiguës ;
- parcours en deux temps : **aperçu** (aucune écriture) puis **confirmation transactionnelle**
  (`BEGIN`/`COMMIT`, tout ou rien) ;
- bilan : créés, réutilisés, inscrits, déjà inscrits, ignorés (avec motif).

### Rapprochement et doublons

- un **email unique** normalisé (minuscules) rapproche exactement : réutilisation sans ambiguïté ;
- un email partagé par plusieurs stagiaires → « à vérifier », aucune fusion ;
- nom/prénom sans email → « doublon possible », **jamais** fusionné automatiquement ;
- un email déjà présent deux fois dans le fichier → ligne invalide ;
- un stagiaire déjà inscrit dans la session → « déjà inscrit », pas de doublon d'inscription.

### Routes

- `POST /api/sessions/:id/stagiaires/import-apercu` (`requireRedacteur`) — classification, pas d'écriture.
- `POST /api/sessions/:id/stagiaires/import` (`requireRedacteur`) — import transactionnel.
- `PATCH /api/stagiaires/:id` (`requireRedacteur`) — fiche complète (toutes les colonnes ci-dessus).
- `PATCH /api/inscriptions/:id` (`requireRedacteur`) — groupe (validé contre la session), prescripteur,
  dossier, statut/abandon.

### Droits

ADMIN et CONTRIBUTEUR : import CSV, création/correction de fiche, inscription, groupe, prescripteur,
dossier, abandon. Aucun droit admin supplémentaire n'est ouvert au contributeur (formations, sessions,
groupes, preuves, modèles, référentiel, audits, Drive) — vérifié en direct : **403**.

### Données sensibles

`situation_handicap` et `besoins_adaptation` ne sont affichés que dans le panneau « Dossier » de la
gestion du stagiaire, jamais dans l'aperçu d'import, jamais dans les logs ni les messages d'erreur.

### Tests

- `server/test/csvStagiaires.test.js` (15 tests purs), `server/test/stagiaires.test.js` (33 tests
  HTTP, application Express réelle + base simulée) et `server/test/prescripteurs.test.js` (11 tests).
- `npm test` : **199/199**
- test navigateur réel sur PostgreSQL jetable (admin + contributeur).
- deux mutations rejouées pour vérifier que les tests mordent.
- migration 011 testée en deux phases sur une base contenant des données réelles (aucune perte).

### Prescripteurs configurables (L3-bis)

La liste des prescripteurs, jusqu'ici figée dans un CHECK SQL (`pole_emploi`, `mission_locale`,
`of`, `autre`), devient **configurable** via la migration 011 :

- `inscriptions.prescripteur` reste du TEXTE et continue de stocker le `code` : aucune inscription
  existante n'est réécrite, aucune FK n'est ajoutée ;
- table `prescripteurs` (`code` UNIQUE, `nom`, `actif`) : afficher, ajouter, renommer (le code ne
  bouge jamais), désactiver sans supprimer ;
- seed historique inchangé (Pôle Emploi, Mission Locale, Organisme de formation, Autre) + CAP Emploi ;
- un prescripteur est **facultatif** : CSV sans colonne ou cellule vide = non renseigné, sans erreur ;
- valeur CSV inconnue ou désactivée : signalée dans l'aperçu, jamais devinée, jamais créée
  automatiquement — l'admin la crée dans Vigie, puis le CSV se réanalyse ;
- droits : ADMIN crée/renomme/désactive ; CONTRIBUTEUR sélectionne seulement.

### Production

- commit L3 : `fbdc6c6` — `Stagiaires : importer et compléter les dossiers`, smoke test production **8/8 OK** ;
- commit L3-bis : `a2de631` — `Prescripteurs : rendre la liste configurable` ;
- migration **011** appliquée automatiquement **une seule fois** ;
- déploiement Railway **SUCCESS**, `/api/health` 200 ;
- tests au moment du déploiement : **199/199** ;
- smoke test production L3-bis **5/5 OK** (création, reconnaissance CSV, rattachement, vide accepté,
  désactivation/réactivation).

### Limite connue

Le rapprochement par email se fait par une lecture puis une écriture, sans contrainte unique : deux
imports concurrents d'un même email pourraient créer deux fiches. Acceptable à un seul poste ; le
chantier de déduplication, s'il devient nécessaire, est distinct.

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
- gérer inscription, groupe, prescripteur et dossier ;lot L2, §7 ter) ;
- **importer des stagiaires en masse (CSV)** : aperçu puis confirmation (lot L3, §7 quater) ;
- **corriger une fiche stagiaire** : civilité, nom, prénom, email, téléphone, entreprise,
  financeur, situation de handicap, besoins d'adaptation (lot L3, §7 qua
- gérer l'abandon ;
- générer des documents ;
- **gérer les absences d'un stagiaire** : ajout, modification, suppression (tranché et livré, lot L2 §7 ter).

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
- Terminé et validé en production (lot L2, §7 ter)** — voir cette section pour le détail des routes,
des calculs et des - classement Drive ;
- lien avec assiduité.

**Mise à jour 22/09/2026** : le rattachement manuel d'un fichier Drive comme preuve **n'est plus
bloqué** par l'absence de création de preuve — c'est précisément ce qu'a livré le lot L1 (§7 bis).
Un export EduSign peut donc désormais être déposé comme preuve sans passer par un import de classeur.
Ce qui reste à décider est le **modèle d'émargement** et le **classement Drive**, pas la mécanique
de rattachement.

### 11.2 Présence / assiduité / absences

**Livré (lot L2, §7 ter)** — voir cette section pour le détail des routes, des calculs et des
droits. En résumé :

- tous présents par défaut, seules les absences sont saisies ;
- saisissable par contributeur (et par admin) ;
- assiduité calculée par inscription, uniquement lorsqu'elle est fiable ;
- table `absences` réutilisée **sans migration**.

Reste ouvert, hors de ce lot :

- les **heures réellement suivies avant un abandon** (aujourd'hui aucun taux n'est produit pour un
  abandon, volontairement) ;
- la **durée prévue de la session** n'est pas saisie comme un champ propre : elle est déduite de
  `duree_heures_reelle` ou de `duree_heures_defaut` ;
- la structuration de l'horaire en journées et demi-journées (voir §7, volontairement non modélisé) ;
- aucun état de synthèse « assiduité globale » toutes sessions confondues.

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

- `npm test` : **199/199**
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
- **L2 — absences / assiduité** : exécuté, déployé, validé en production (§7 ter).
- **L3 — stagiaires et dossiers (import CSV, fiches, inscriptions)** : exécuté, déployé, validé en
  production (§7 quater).
- **L3-bis — prescripteurs configurables** : exécuté, déployé, validé en production (§7 quater).

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
