# Journal des interventions d'agent — Vigie Qualiopi

Ce fichier garde la trace de ce qu'un agent a réellement fait, de ce qu'il a
vérifié, et de ce qui reste ouvert. Il ne remplace pas le `README.md`, qui
décrit le produit.

---

## 2026-09-21 — Reprise du chantier « horaire de session » (marqueur `{{horaire}}`)

### Contexte de la reprise

Claude Code indisponible ; un agent précédent avait atteint sa limite avant
les vérifications. Travail **non commité** trouvé dans l'arbre de travail, sur
`main`, dernier commit `e011a25`. Rien n'a été perdu, écrasé, réinitialisé ni
stashé : l'état de départ a été constaté, puis conservé tel quel.

### Travail déjà présent avant la reprise (agent précédent, non commité)

- `server/db/migrations/010_horaire_session.sql` (nouveau) : colonne `horaire
  text`, nullable, additive.
- `server/src/routes/gestion.js` : `POST /api/sessions` accepte et stocke
  `horaire` (rogné, `NULL` si vide).
- `server/src/services/marqueurs.js` : `horaire` ajouté à `MARQUEURS`, à
  `valeursMarqueurs()` (chaîne vide par défaut) et à la documentation d'en-tête.
- `server/test/marqueurs.test.js` : liste figée mise à jour + 2 tests
  (valeur reprise telle quelle / vide si absente, et `{{horaire}}` n'est plus
  un marqueur inconnu).
- `client/src/Sessions.jsx` : champ « Horaire » dans le formulaire de création,
  affichage dans l'en-tête du détail de session.
- `README.md` : ligne `{{horaire}}` dans le tableau des marqueurs.

### Modifications apportées lors de cette reprise

- `README.md` : paragraphe sur l'**horaire de session** dans la section
  « Sessions, stagiaires et génération de documents (Phase 2) » — champ
  facultatif, texte libre, non modélisé en créneaux, usage unique par
  `{{horaire}}`, et comportement quand il est vide.
- `VIGIE_AGENT_LOG.md` : ce journal (création).

**Aucun autre fichier de production n'a été modifié** : le reste du chantier
était déjà complet et correct.

### Vérifications effectuées

Environnement : macOS, Node v24.13.0. `DATABASE_URL` du `.env` pointe sur la
**base de production Railway** : aucune migration, aucune écriture et aucun
test n'a été lancé contre elle (lectures de schéma uniquement). Les
vérifications d'écriture ont été faites sur un **PostgreSQL jetable monté dans
`/tmp/vq-pgtest`** (paquet `embedded-postgres`), hors dépôt.

1. **Suite de tests** — `npm test` : **59/59 au vert**, 0 échec, 0 ignoré.
   Identique à la référence annoncée avant l'interruption (dont les 2 nouveaux
   tests du marqueur).
2. **Build** — `npm run build` (Vite) : OK, 41 modules, `dist/` généré
   (`dist` est ignoré par git).
3. **Base PostgreSQL, chemin réel** — migrations 001 → 010 appliquées sur base
   neuve ; colonne `sessions.horaire` de type `text`, nullable :
   - création d'une session **avec** horaire → 201, valeur stockée puis relue
     par `GET /api/sessions/:id` ;
   - création **sans** horaire, avec `""`, ou avec des espaces → `NULL` en base ;
   - horaire entouré d'espaces → rogné ;
   - migration 010 appliquée à une base contenant déjà une session : la session
     survit, son horaire reste `NULL`, `{{horaire}}` ressort vide.
4. **Génération réelle d'un document** — `genererDocuments()` exécuté sur tout
   son chemin de production (base, arborescence de dossiers, preuve, pièces
   jointes), seule l'API Google étant simulée pour capturer les requêtes :
   - le dossier de session est bien créé (`A2C Qualiopi / <formation> /
     <référence (dates)>`) ;
   - la requête `docs.documents.batchUpdate` contient
     `{{horaire}}` → valeur de la session ;
   - idem pour `sheets.spreadsheets.batchUpdate` ;
   - session sans horaire : remplacement par une chaîne vide, le marqueur n'est
     jamais imprimé ;
   - `documents_generes` et `preuve_fichiers` sont écrits correctement.
5. **Droits** — contributeur : `POST /api/sessions` → **403** (aucune session
   créée en base), lecture d'une session → 200 comme avant ; non connecté →
   401. Le contributeur ne voit ni le champ « Horaire », ni le bouton de
   création, ni l'onglet Modèles : **aucun droit gagné**.
6. **Interface, navigateur réel** (appli servie localement sur base jetable,
   session admin puis contributeur) : le formulaire de création expose bien le
   champ « Horaire » ; une session créée depuis l'interface avec un horaire
   s'affiche et se relit correctement ; le détail affiche
   `· 9h00–12h30 / 14h00–17h00 ·` ; une session sans horaire n'affiche aucun
   séparateur parasite.

**Total : 36 vérifications automatisées (36 OK), 1 constat.**

### Points restants à contrôler

1. **Aucune modification de session n'existe** — ni route HTTP
   (`PATCH`/`PUT /api/sessions/:id` → 404) ni formulaire d'édition dans
   l'écran Sessions. Conséquence directe pour ce chantier : après déploiement de
   la migration 010, les sessions déjà enregistrées en production auront un
   horaire `NULL` qu'aucun écran ne permet de renseigner, et un horaire saisi ne
   peut pas être corrigé. **Décision de périmètre à prendre** (voir « Prochaine
   étape »).
2. **Génération contre le vrai Google Drive non testée** : aucun Drive n'est
   connecté dans l'environnement local et il n'était pas question de déclencher
   une génération réelle en production. La chaîne est validée avec l'API Google
   simulée, au niveau de la requête envoyée.
3. **Migration 010 pas encore appliquée en production** : la base Railway est en
   `009_audits_rapport_drive.sql`. Elle sera appliquée automatiquement au
   démarrage du serveur lors du prochain déploiement (le démarrage exécute les
   migrations en attente). Aucune migration n'a été forcée depuis ce poste.
4. **`GET /api/sessions` (liste) ne renvoie pas `horaire`**, et la liste ne
   l'affiche pas : c'est cohérent avec l'affichage retenu (détail seulement),
   mais à confirmer si l'horaire doit apparaître dans la liste.
5. Observation hors périmètre, à confirmer : un contributeur voit l'onglet
   « Tableau de bord » (le bouton n'est pas restreint dans `client/src/App.jsx`),
   alors que la spécification `docs/spec-systeme-qualiopi-a2c.md` réserve le
   tableau de bord de conformité à l'admin. Comportement préexistant, non touché.

### Prochaine étape recommandée

**Demander à l'utilisateur l'autorisation d'ajouter la modification d'une
session**, seul vrai trou du chantier :

- `PATCH /api/sessions/:id`, réservé à l'admin (`requireAdmin`), sur le modèle
  de `PATCH /stagiaires/:id` (liste de colonnes modifiables, chaîne vide =
  effacement, `updated_at` mis à jour) ;
- un formulaire d'édition repliable dans le détail de session, visible de
  l'admin seul, pour `horaire`, `reference`, `lieu`, `formateur` et
  `duree_heures_reelle` ;
- les tests unitaires correspondants (le projet n'a pas de test HTTP, la
  couverture se ferait comme ici, hors dépôt).

> **Suite donnée le même jour** : l'utilisateur a autorisé la correction, mais
> en réduisant le périmètre au seul champ `horaire`. Voir la section suivante.
> Le formulaire d'édition des autres champs (référence, lieu, formateur,
> durée) n'a **pas** été réalisé, conformément à cette consigne.

---

## 2026-09-21 (suite) — Corriger l'horaire d'une session existante

Autorisation reçue, avec une consigne de **périmètre volontairement étroit** :
permettre à un admin de renseigner, corriger ou supprimer l'horaire d'une
session existante — et rien d'autre. Ce n'est **pas** un système général
d'édition des sessions.

### Ce qui a été implémenté

- `server/src/routes/gestion.js`
  - `normaliserHoraire(valeur)` exportée : rogne, et renvoie `NULL` pour une
    chaîne vide, faite d'espaces, ou pour une valeur absente. La fonction sert
    désormais **aux deux chemins** — `POST /api/sessions` (création) et
    `PATCH /api/sessions/:id` (correction) — pour qu'un horaire saisi puis
    corrigé s'imprime à l'identique dans `{{horaire}}`.
  - `PATCH /api/sessions/:id`, `requireAdmin`, `UPDATE sessions SET horaire =
    $2 ... RETURNING *`. Seul le champ `horaire` est écrit par la route :
    aucun autre `SET`. 404 si la session n'existe pas.
  - Corps sans clé `horaire` → **400 « Rien à modifier. »**, comme les autres
    PATCH du projet (`/stagiaires/:id`, `/inscriptions/:id`). Un corps qui
    porte d'autres champs est **ignoré**, jamais appliqué : c'est le mécanisme
    déjà en place dans ce codebase (liste blanche de colonnes).
  - Aucun `PUT` ajouté : la route reste strictement `PATCH`.
- `client/src/Sessions.jsx` (détail d'une session)
  - Un champ « Horaire » + deux boutons **« Enregistrer l'horaire »** et
    **« Effacer »**, affichés **uniquement si `admin`**.
  - Le contributeur garde exactement ce qu'il avait : l'horaire s'affiche en
    lecture dans l'en-tête de session, aucune commande d'édition.
  - L'affichage existant est inchangé quand aucun horaire n'est renseigné
    (rien n'est ajouté à la ligne d'en-tête).
  - Le champ de saisie se recale sur la **session ouverte** (`d.session.id`),
    pas à chaque rechargement : ajouter un groupe ou un stagiaire n'efface pas
    une correction commencée. Après enregistrement, il reprend la valeur
    retenue par le serveur (donc rognée).
- `server/test/horaire.test.js` (nouveau, 3 tests) : rognage, vide/espaces/
  absent → `NULL`, et « texte libre » (rien n'est reformaté ni validé).

### Résultats

- `npm test` : **62/62 au vert** (59 avant + 3 nouveaux). Aucun test ignoré,
  aucun échec.
- `npm run build` : OK, bundle `index-DbTUZSeE.js` (195,64 kB).
- **Base PostgreSQL jetable** (`/tmp/vq-pgtest`, jamais la production) —
  harnais de 59 vérifications, **59 OK** :
  - admin renseigne un horaire absent → 200, stocké, relu par `GET` ;
  - admin remplace un horaire existant → 200, l'ancienne valeur disparaît ;
  - `"   "` et `""` → `NULL` en base ;
  - `"   7h–9h   "` → `"7h–9h"` ;
  - **aucun autre champ métier n'est modifié** (comparaison de la ligne
    entière : `date_debut`, `date_fin`, `reference`, `lieu`, `formateur`,
    `duree_heures_reelle`, `formation_version_id` identiques) ;
  - corps sans `horaire` et corps vide → 400 ; champs surnuméraires envoyés
    avec `horaire` → ignorés, seul l'horaire est appliqué ;
  - session inexistante → 404 ; contributeur → 403 et horaire inchangé ;
    non connecté → 401 ; `PUT` → 404 (périmètre étroit respecté) ;
  - la génération de documents, le marqueur `{{horaire}}` et la migration 010
    restent vérifiés comme lors du passage précédent.
- **Interface, navigateur réel** (base jetable, build courant) :
  - admin, session sans horaire : l'en-tête n'affiche aucun horaire, le champ
    est vide, « Effacer » est désactivé ;
  - renseigner → l'en-tête affiche `· 10h30–13h00 / 14h00–17h30 ·` ;
  - corriger en tapant `"  9h00–12h00  "` → l'en-tête et le champ affichent
    `9h00–12h00` (aller-retour serveur) ;
  - « Effacer » → l'en-tête redevient celui d'une session sans horaire ;
  - contributeur, même session : horaire **lisible** dans l'en-tête, **aucun
    champ, aucun bouton** d'édition (liste des boutons du détail relevée).
  - valeurs confirmées ensuite en base locale.

### Points restants à vérifier

1. **`updated_at` est rafraîchi** à chaque correction d'horaire. Ce n'est pas
   la route qui l'écrit : le schéma pose un trigger `BEFORE UPDATE`
   (`001_schema_initial.sql`, boucle sur les tables) qui appelle
   `set_updated_at()`. Comportement prévu, mais à connaître : ne pas s'en
   servir comme d'un « horodatage du seul horaire ».
2. **Toujours pas de modification des autres champs d'une session** (référence,
   dates, lieu, formateur, durée) : c'est volontaire. Une date ou une durée
   erronée reste incorrigible en l'état.
3. **Génération contre le vrai Google Drive** toujours non testée (aucun Drive
   connecté localement) ; la chaîne est validée jusqu'à la requête envoyée.
4. **Migration 010 toujours non appliquée en production** (la base Railway est
   en 009). Elle s'appliquera au prochain déploiement, au démarrage du serveur.
5. **Pas de test HTTP dans le dépôt** : la suite `npm test` est hermétique et
   sans base de données. Les contrats HTTP (403 / 404 / 400 / champs non
   touchés) sont vérifiés par le harnais hors dépôt, pas par `npm test`. Les
   tests ajoutés au dépôt couvrent la règle de normalisation partagée.
6. Une URL mal formée (`/api/sessions/abc`) répond 500 et non 404 : défaut
   préexistant sur **toutes** les routes à identifiant numérique, pas
   introduit ici et non corrigé pour la cohérence de l'ensemble.

### Prochaine étape recommandée

Lire le diff, puis **commiter l'ensemble après autorisation explicite** :
5 fichiers modifiés (`README.md`, `client/src/Sessions.jsx`,
`server/src/routes/gestion.js`, `server/src/services/marqueurs.js`,
`server/test/marqueurs.test.js`) et 3 nouveaux fichiers
(`server/db/migrations/010_horaire_session.sql`, `server/test/horaire.test.js`,
`VIGIE_AGENT_LOG.md`). **Aucun commit n'a été fait à ce stade.**

> **Suite donnée le même jour** : avant de commiter, l'utilisateur a demandé de
> pérenniser la couverture de la route dans le dépôt. Le décompte des fichiers
> ci-dessus est donc complété par la section suivante (`server/src/db.js` en
> plus, et des tests de route dans `server/test/horaire.test.js`).

---

## 2026-09-21 (suite 2) — Pérenniser la couverture de `PATCH /api/sessions/:id`

Le harnais hors dépôt validait la route, mais il disparaîtra : `npm test` ne
protégeait que la normalisation de l'horaire. Objectif : couvrir la route dans
le dépôt, **sans base PostgreSQL réelle, sans nouvelle dépendance, sans
élargir l'architecture de tests**.

### Solution retenue

- `server/src/db.js` : ajout d'un **point d'injection** de 4 lignes
  (`setQueryExecutor`). `query()` passe par une variable interne, remplaçable
  par les tests uniquement ; `null` rétablit le comportement normal. Aucun
  changement de comportement en production, aucun autre fichier de production
  touché pour les tests.
- `server/test/horaire.test.js` : le fichier porte maintenant **11 tests**, les
  3 tests de normalisation d'origine + 8 tests de contrat HTTP. Les tests
  montent l'**application Express réelle** (`createApp()`, port éphémère,
  `fetch`) avec une **base simulée** installée par `setQueryExecutor`. Aucune
  dépendance ajoutée (pas de supertest, pas de base), et la suite reste
  hermétique.
- La base simulée **refuse toute requête qu'elle ne connaît pas** et journalise
  celles qu'elle reçoit : les tests vérifient donc ce que la route a
  réellement écrit, pas seulement ce qu'elle a répondu. Si la route se met un
  jour à écrire ailleurs, ces tests échouent au lieu de passer à vide.

### Points couverts

| Exigence | Test |
| --- | --- |
| admin : modification autorisée | `un admin peut renseigner l'horaire d'une session` (200 + valeur réellement écrite) |
| admin : remplacement d'un horaire existant | `un admin peut remplacer un horaire déjà renseigné` (une seule écriture) |
| chaîne vide / espaces → `NULL` | `un horaire vide, fait d'espaces, ou réduit à rien vaut NULL` (`""`, `"   "`, `"\t\n "`, et `"  9h00–12h00  "` → rogné) |
| contributeur → 403 | `un contributeur ne peut pas modifier l'horaire` (+ **aucune** écriture tentée, valeur en base intacte) |
| session inexistante → 404 | `une session inexistante répond 404` (écriture tentée, base sans effet) |
| corps sans clé `horaire` → 400 | `un corps sans clé horaire répond 400 « Rien à modifier »` (`{}`, autre champ seul, `horaire: undefined`) |
| champs supplémentaires sans effet | `aucun autre champ de la session ne peut être modifié` : la clause `SET` vaut exactement `horaire = $2`, les paramètres valent exactement `[7, …]`, et aucun nom d'autre colonne n'apparaît dans la requête |
| non connecté → 401 | `sans connexion, la correction est refusée` |

### Preuve que les tests mordent (mutation testing manuel)

Deux régressions ont été introduites volontairement, puis retirées :

1. `requireAdmin` → `requireRedacteur` sur la route : le test « contributeur »
   **échoue** (10 pass / 1 fail). Restauré.
2. `SET horaire = $2, lieu = $3` : le test « aucun autre champ » **échoue**
   (10 pass / 1 fail). Restauré, code vérifié identique à l'original.

### Résultats

- `npm test` : **70/70 au vert** (59 → 62 avec la normalisation, 70 avec les
  tests de route), 0 échec, 0 ignoré.
- `npm run build` : OK, `index-DbTUZSeE.js` inchangé (aucun code client touché).
- `git diff --check` : propre, aucune erreur d'espacement.
- `git status` : 6 fichiers modifiés, 3 non suivis (voir ci-dessous).

### Points restants à vérifier

1. **La base simulée n'exécute pas de vrai SQL** : elle vérifie le texte de la
   requête et ses paramètres, pas l'acceptation par PostgreSQL. La validité
   réelle des ordres SQL reste couverte par le harnais hors dépôt
   (`/tmp/vq-pgtest`, 59 vérifications), qui n'est pas dans le dépôt.
2. Le **trigger `updated_at`** de `sessions` (schéma, `001_schema_initial.sql`)
   n'est pas exercé par la base simulée : son effet a été constaté sur la base
   jetable, pas dans `npm test`.
3. Le défaut préexistant `GET /api/sessions/abc` → 500 (identifiant non
   numérique) reste **hors périmètre** de ce chantier, volontairement.
4. La génération contre le vrai Google Drive reste non testée localement.
5. La migration 010 reste non appliquée en production (base Railway en 009).

### Prochaine étape recommandée

**Committer après autorisation explicite.** État exact de l'arbre de travail :

- modifiés : `README.md`, `client/src/Sessions.jsx`, `server/src/db.js`,
  `server/src/routes/gestion.js`, `server/src/services/marqueurs.js`,
  `server/test/marqueurs.test.js` ;
- nouveaux : `server/db/migrations/010_horaire_session.sql`,
  `server/test/horaire.test.js`, `VIGIE_AGENT_LOG.md`.

**Aucun commit, aucun push, aucun stash ; la base Railway de production n'a
jamais été écrite.**

> **Suites données le même jour** : le commit `b834d6b` a été créé puis poussé
> sur `origin/main`, et le service a été déployé en production. Les points 4
> (génération réelle) et 5 (migration 010) de la liste ci-dessus sont donc
> levés — voir la section suivante.

---

## 2026-09-21 (suite 3) — Déploiement en production et validation

### Commit et push

| | |
| --- | --- |
| Commit | `b834d6bd49043dff5e729d864bef087e11061043` — « Sessions : ajouter et modifier l'horaire » |
| Contenu | 9 fichiers, +632 / −9 |
| Push | `e011a25..b834d6b  main -> main`, **sans `--force`** |
| Contrôles avant push | arbre propre ; HEAD conforme ; `origin/main` toujours en `e011a25`, **0 commit non examiné** ; `origin/main` ancêtre de `main` (aucune divergence) |
| `origin/main` après push | `b834d6bd49043dff5e729d864bef087e11061043` |

### Déploiement Railway

Projet `Vigie Qualiopi` (`6a1d0145-7b57-494c-acd3-f4c3b2784999`), environnement
`production` (`da6ebbe4-675c-4937-8f7c-b3f74dcd71cb`), service `vigie_qualiopi`
(`0aa5dbd9-dd30-4869-b466-cc7b5f3031ea`).

- Déploiement `ec7c8e7e-b7be-4069-afbc-fb32ff52ba63`, déclenché par le push sur
  `main`, commit `b834d6b`.
- Cycle : `BUILDING` (16:21:50) → `DEPLOYING` (16:22:08) → **`SUCCESS`** (16:22:26).
- Build : `✓ 41 modules transformed`, `✓ built in 682ms`, Node 22.23.2. Aucune erreur.
- Aucun déploiement déclenché à la main, aucune modification de configuration.

### Migration 010 appliquée

Logs de démarrage (intégralité — 13 lignes) :

```
Starting Container
> vigie-qualiopi@0.1.0 start
> npm start -w server
> @vigie-qualiopi/server@0.1.0 start
> node src/index.js

Migration appliquée : 010_horaire_session.sql
Vigie Qualiopi en ligne sur le port 8080 (Node v22.23.2)
```

- **Une seule** migration appliquée : `010_horaire_session.sql`. Aucune autre
  migration inattendue.
- Contrôle en **lecture seule** de la base de production : **10 migrations**
  présentes, `001` → `010`, dans l'ordre ; colonne `sessions.horaire` de type
  `text`, nullable. Table `sessions` : 1 ligne, 0 avec horaire (session
  antérieure, désormais modifiable depuis l'écran Sessions).
- La migration a été appliquée **par le démarrage normal du serveur**. Aucune
  migration lancée à la main, **aucune écriture manuelle en base**.

### Healthcheck

```
GET https://vigiequaliopi-production.up.railway.app/api/health
{"ok":true}
HTTP 200 (0,10 s puis 0,06 s au second appel)
```

### Smoke tests production (exécutés par l'utilisateur)

| Test | Résultat |
| --- | --- |
| Ajout d'un horaire sur une session existante | OK |
| Persistance après rechargement | OK |
| Modification de l'horaire | OK |
| Effacement de l'horaire | OK |
| Affichage sans séparateur parasite quand l'horaire est vide | OK |
| Création d'une nouvelle session avec horaire | OK |
| Génération réelle d'un document Google avec `{{horaire}}` | OK |
| Comportement général après déploiement | OK |
| Test manuel du compte **contributeur** en production | **non réalisé** — aucune adresse courriel disponible |

### Réserve : contributeur non testé manuellement en production

Le compte contributeur n'a pas pu être essayé « en vrai » en production, faute
d'une adresse courriel disponible pour ouvrir une session. Ce qui protège ce
point malgré tout :

- **tests automatisés dans le dépôt** (`server/test/horaire.test.js`) :
  contributeur → **403**, avec vérification qu'**aucune écriture** n'est tentée
  ni effectuée ; non connecté → 401 ;
- **harnais sur base jetable** : contributeur → 403, horaire inchangé en base,
  aucune session créée ;
- **vérification en navigateur sur base jetable** : le contributeur **voit**
  l'horaire en lecture dans l'en-tête de session, et dispose de **aucun champ
  ni bouton** d'édition ; l'onglet Modèles et le formulaire de création de
  session ne lui sont pas proposés ;
- côté code, la route est sous `requireAdmin` et le bloc d'édition de
  l'interface est sous `{admin && …}` : le contributeur ne peut donc pas y
  accéder par l'interface, et une requête directe recevrait 403.

À refaire si un second compte est créé : un essai manuel en production
resterait la seule vérification de bout en bout non couverte.

### Erreurs et alertes relevées

- Runtime : **0 ligne d'erreur** sur l'ensemble des logs du déploiement.
- Logs HTTP : une seule requête, `GET /api/health 200` — aucun 4xx/5xx.
- Deux avertissements **préexistants**, sans rapport avec cette évolution :
  `npm warn config production Use --omit=dev instead.` (bruit npm) et la
  dépréciation par Railway de `railway.json` (Config as Code) au profit de
  `.railway/railway.ts` — les fichiers actuels continuent de fonctionner
  **jusqu'au 2026-12-01**.

### Statut final

**Fonctionnalité « horaire de session » : VALIDÉE EN PRODUCTION.**

- création d'une session avec horaire, et modification / effacement de
  l'horaire d'une session existante : validés en production ;
- propagation jusqu'au document Google généré via `{{horaire}}` : validée en
  production ;
- migration 010 appliquée en production par le démarrage normal du serveur ;
- `npm test` : 70/70 ; `npm run build` : OK.

### Points restants (inchangés par ce déploiement)

1. Test manuel du contributeur en production — voir la réserve ci-dessus.
2. Les autres champs d'une session (référence, dates, lieu, formateur, durée)
   restent **non modifiables** : périmètre volontairement étroit.
3. `GET /api/sessions/abc` → 500 : défaut préexistant, hors périmètre.
4. `railway.json` déprécié par Railway : à migrer vers Infrastructure as Code
   avant le **2026-12-01** (chantier dédié, non engagé).

---

## 2026-09-22 — L1 : compléter l'ajout et le rattachement manuel des preuves

Premier lot issu de l'audit produit. Constat de départ, vérifié dans le code :
**aucune route ne créait de preuve** (`INSERT INTO preuves` n'existait que dans
`services/import.js` et `services/documents.js`), et deux capacités du backend
étaient inatteignables depuis l'écran — supprimer une preuve non « à
confirmer », et rattacher un fichier à une preuve `unique` déjà confirmée.

### L1-A — Réparer une preuve existante

- `DELETE /api/preuves/:id` **n'a pas été touchée** : elle était correcte, seul
  le bouton était enfermé dans `admin && p.a_confirmer` (`Preuves.jsx`). Le
  bouton « Supprimer » est désormais disponible sur toute preuve, admin, avec
  la confirmation `window.confirm` déjà en place.
- **Rattacher / remplacer le fichier** : le composant `RechercheDrive` existant
  est réutilisé **sans duplication**, avec deux usages selon le mode — en mode
  `multiple` il ajoute une pièce (`POST /api/preuves/:id/fichiers`), en mode
  `unique` il remplace la pièce (`PATCH /api/preuves/:id`, capacité qui
  existait déjà mais n'était proposée que sur une preuve « à confirmer »).
- **Titre, description et indicateur** deviennent corrigeables :
  `PATCH /api/preuves/:id` accepte `titre`, `description` et `indicateur_id`.
  L'indicateur doit appartenir au **référentiel actif** : une preuve rattachée
  à une version inexploitée disparaîtrait des deux écrans.
- La ligne est relue après correction (`GET /api/preuves/:id`) car l'indicateur
  affiché est son **numéro**, que seul le serveur connaît.
- Suppression : la liste est relue après le `DELETE` (`charger()`), pour que le
  total et les compteurs suivent — l'ancien code ne rafraîchissait rien.
- `description` et `indicateur_id` sont désormais renvoyés par
  `GET /api/preuves` et `GET /api/preuves/:id` (colonnes ajoutées aux deux
  `SELECT`).

### L1-B — Création manuelle

- Nouvelle route `POST /api/preuves` (`requireAdmin`), calquée sur les
  conventions du projet (`STATUTS`, `MODES`, `TYPES_ALERTE`, `manque`-style,
  codes 400/403/500 cohérents), avec transaction : **tout ou rien**.
- Champs : indicateur(s), titre (obligatoire, rogné), description, statut,
  mode de fichiers, échéance (révision périodique ou date fixe) et fichier
  Drive **facultatif** — une preuve sans fichier est un état normal du modèle
  (statut « À risque », comptage « 0/12 rattaché(s) »), et L1-A permet de la
  rattacher ensuite.
- Écran : bouton « Ajouter une preuve » (admin), formulaire repliable avec
  sélection d'indicateurs groupée par critère, et `RechercheDrive` réutilisé
  pour choisir un document existant.
- L'import du classeur et la génération documentaire n'ont **pas** été touchés.

### L1-C — Un document pour plusieurs indicateurs

Implémenté sans toucher au schéma : `POST /api/preuves` accepte
`indicateur_ids`, et crée **une preuve distincte par indicateur**, toutes
pointant sur le **même `drive_file_id`**. La contrainte d'unicité
`(preuve_id, drive_file_id)` autorise le même fichier sur des preuves
différentes : la seule chose interdite reste de rattacher deux fois le même
fichier à la **même** preuve. Les doublons d'indicateur dans la liste sont
retirés, et un indicateur hors référentiel actif fait échouer tout l'appel
(rollback, aucune preuve créée).

### Point d'injection de test étendu

`server/src/db.js` : `setPoolFactory(fn)` ajouté à côté de `setQueryExecutor`.
Le premier couvre les **transactions** (`getPool().connect()`), que le second
ne couvrait pas — sans quoi `POST /api/preuves` n'était pas testable sans base.
Les deux sont documentés comme réservés aux tests ; `null` rétablit le
comportement normal.

### Vérifications effectuées

- `npm test` : **91/91 au vert** (70 avant + **21 nouveaux** dans
  `server/test/preuves.test.js`), 0 échec, 0 ignoré.
- `npm run build` : OK.
- `git diff --check` : propre.
- **Preuve que les tests mordent** : `requireAdmin` remplacé par
  `requireRedacteur` sur `POST /api/preuves` → le test « un contributeur ne
  peut pas créer de preuve » **échoue** (20 pass / 1 fail). Code restauré et
  vérifié identique.
- **Navigateur réel**, sur PostgreSQL jetable (`/tmp/vq-pgtest`, jamais la
  production) :
  - « Ajouter une preuve » → 2 indicateurs sélectionnés → 2 preuves créées,
    titre rogné, description affichée, badges d'indicateur « 1 » et « 2 » ;
  - « Modifier » → pré-rempli, titre et description changés, preuve déplacée
    de l'indicateur **1 à l'indicateur 7** (badge et critère suivent) ;
  - « Supprimer » sur une preuve **confirmée** → confirmation claire, ligne
    retirée, **compteur recalculé sans rechargement** (2 → 1) ;
  - mode `unique` : la recherche Drive « Rattacher un fichier du Drive » est
    présente (elle était absente avant) ;
  - contributeur : **aucun bouton, aucune case de sélection** — seuls les
    filtres restent ; statut affiché en pastille.

### Limites restantes

1. **Rattachement Drive réel non testé** : aucun Drive n'est connecté dans
   l'environnement local. `POST /api/preuves` n'appelle **aucune** API Google
   (il enregistre un identifiant, une URL et un nom) : le risque se limite donc
   au composant de recherche, déjà utilisé ailleurs. Un identifiant Drive
   inexistant n'est pas vérifié, comme dans le reste du projet.
2. Les calculs de la vue `preuves_enrichies` (comptage attendu, `incomplet`,
   alertes) ne sont pas exercés par `npm test` : la base simulée ne fait pas de
   SQL. Cela reste vérifié sur base jetable.
3. Les tests de `GET /api/preuves` ne sont pas dans la suite : les colonnes
   ajoutées (`description`, `indicateur_id`) ont été vérifiées à l'écran,
   contre le PostgreSQL jetable.
4. Toujours aucun **export**, aucune purge des documents générés, et
   l'indicateur 3 (etc.) garde ses autres colonnes non modifiables.
5. Contributeur : toujours en lecture seule sur les preuves — c'est voulu.

### Prochaine étape

Lot **L2** (présence / absences) — non commencé. Aucun push effectué.

---

## 2026-09-22 (suite) — Validation du lot L1 en production

### Push

- commit métier : `1dd4763` — `Preuves : compléter l'ajout et le rattachement manuel`
- commit documentaire : `40e9d54` — `Documentation : ajouter le handoff projet`
- `git fetch` avant push : `origin/main` inchangé (`d1be9f9`), **avance simple, aucune
  divergence**, 0 nouveau commit distant
- push `main` **sans `--force`** : `d1be9f9..40e9d54`
- contrôles préalables : `git status` propre, `npm test` **91/91**, `npm run build` OK,
  `git diff --check` propre

### Déploiement Railway

- déploiement `58383ba8-90da-43e9-8f8e-0a74ad409da3`, commit `40e9d547`
- statut : **SUCCESS**
- `/api/health` : **HTTP 200** → `{"ok":true}`
- **aucune ligne « Migration appliquée »** au démarrage : **migration toujours 010**
- base de production inchangée (28 tables ; `preuves` 143, `preuve_fichiers` 114, `sessions` 1)
- erreurs : **aucune** ; seuls les avertissements bénins déjà connus
  (`npm warn config production`, dépendances dépréciées, dépréciation `railway.json`)

### Smoke test production (effectué par l'utilisatrice) — 8/8 OK

1. bouton « Ajouter une preuve » ;
2. création d'une preuve ;
3. affichage ;
4. modification du titre et de la description ;
5. changement d'indicateur ;
6. rattachement / remplacement d'un fichier unique ;
7. suppression et recalcul du compteur ;
8. preuves antérieures intactes.

### État

- `npm test` : **91/91**
- `npm run build` : OK
- **Lot L1 TERMINÉ.**

### Prochaine étape

Lot **L2** — absences / assiduité des stagiaires.

---

## 2026-09-22 (suite 2) — L2 : absences et assiduité des stagiaires

### Étape 1 — documentation du lot preuves

- `PROJECT_HANDOFF.md` : repères rendus non auto-périmés (plus aucun hash de `HEAD` ni
  d'`origin/main` dans l'en-tête ; « état validé au 22/09/2026 », « dernier lot métier validé en
  production », « suite de tests validée », « migration de production actuelle »). Nouvelle section
  §7 bis consacrée au lot L1. §11.1 (EduSign) et §11.9 (preuves Noé) ne sont plus présentés comme
  bloqués par l'absence de création de preuve. §14 mis à jour (91/91).
- L'en-tête du handoff a été converti de citation en tableau : la convention de « saut de ligne
  dur » du fichier utilise deux espaces en fin de ligne, ce que `git diff --check` signale.
- commit documentaire : `e720a45` — `Documentation : valider le lot preuves`. **Non poussé.**

### Schéma `absences` rencontré

Table présente depuis la migration 001, suffisante telle quelle : **aucune migration 011 créée**.

- `inscription_id` NOT NULL → `inscriptions(id) ON DELETE CASCADE` ;
- `date_absence` date NOT NULL ;
- `demi_journee` text CHECK IN ('matin','apres_midi','journee'), **nullable** ;
- `duree_heures` numeric(5,2) CHECK >= 0, **nullable** ;
- `justifiee` boolean NOT NULL DEFAULT false ;
- `motif` text ; `created_at` / `updated_at` + trigger `absences_updated_at` ;
- index `absences_inscription`.

Deux constats qui ont orienté le lot :

1. **`sessions.duree_heures` n'existe pas.** La durée prévue se lit sur
   `sessions.duree_heures_reelle`, à défaut sur `formation_versions.duree_heures_defaut`
   (via `sessions.formation_version_id`). Le libellé « durée prévue » de la demande correspond donc
   à ces deux colonnes.
2. Le schéma **ne peut pas** garantir l'unicité « même inscription / même date / même demi-journée » :
   `demi_journee` étant nullable, un index unique ne comparerait jamais deux `NULL`. Le contrôle est
   fait dans la route (409). Limite assumée : deux saisies simultanées pourraient passer.

En production, la table `absences` était **vide** (3 inscriptions, 1 session) : aucun risque de
reprise de données.

### Routes créées

- `GET /api/sessions/:id/absences` — `requireAuth` ; absences et assiduité, inscription par inscription ;
- `POST /api/inscriptions/:id/absences` — `requireRedacteur` ;
- `PATCH /api/absences/:id` — `requireRedacteur` ;
- `DELETE /api/absences/:id` — `requireRedacteur`.

Utilitaires exportés et testés directement : `estDateValide`, `calculerAssiduite`.

### Calculs retenus

- heures d'absence = somme des `duree_heures` saisies (arrondi au centième, comme la colonne) ;
- heures suivies = durée prévue − heures d'absence, **plancher à 0** ;
- taux = heures suivies / durée prévue × 100, **borné à [0 ; 100]** ;
- **aucun taux** pour un abandon (les heures suivies avant abandon ne sont pas modélisées), ni
  lorsque la durée prévue est absente ou nulle : seul le total d'heures d'absence est alors affiché ;
- un **dépassement** (absences > durée prévue) est signalé, pas masqué ;
- la durée d'une absence est **toujours saisie** : jamais déduite d'une « demi-journée ».

### Interface

Dans le détail d'une session, le bloc **Stagiaires** porte désormais l'assiduité :

- résumé en tête : durée prévue (en précisant quand elle vient de la formation), total d'absences ;
- par stagiaire : nombre d'absences, heures cumulées, pastille d'assiduité (ou mention explicite
  « Abandon — taux non calculé » / « Durée prévue inconnue ») ;
- bouton **Absences (n)** → panneau déplié sous la ligne du stagiaire : historique chronologique,
  distinction justifiée / non justifiée par le bord **et** la pastille, formulaire d'ajout et
  d'édition, suppression avec confirmation.

### Droits

ADMIN et CONTRIBUTEUR : lecture, création, modification, suppression des absences.
Aucun autre droit élargi — vérifié en direct sur le serveur jetable : `POST /api/sessions`,
`PATCH /api/sessions/:id`, `POST /api/sessions/:id/groupes`, `PUT /api/formations/:id`,
`DELETE /api/modeles/:id` et `POST /api/preuves` répondent **403** au contributeur.

### Codes d'erreur

400 (identifiant invalide, date invalide ou hors session, durée hors [0 ; 24], demi-journée hors
valeurs du CHECK, motif > 500 caractères, corps vide), 401 (non authentifié), 403 (rôle non
autorisé), 404 (inscription ou absence introuvable), 409 (doublon). **Aucun 500** sur une erreur
d'utilisateur.

### Vérifications effectuées

- `npm test` : **135/135**, 0 échec, 0 ignoré (91 avant ce lot → 44 nouveaux tests).
- `npm run build` : OK.
- `git diff --check` : propre.
- **Preuve que les tests mordent** (trois mutations, code restauré à l'identique après chacune) :
  1. `requireRedacteur` → `requireAdmin` sur `POST /inscriptions/:id/absences` → 134/135,
     échec de « un contributeur ajoute une absence » ;
  2. suppression du plancher `Math.max(0, …)` sur les heures suivies → 134/135, échec de
     « l'assiduité est bornée entre 0 % et 100 % » ;
  3. `statut === "abandon"` neutralisé → 133/135, échec de « un abandon affiche ses absences mais
     aucun taux » **et** du test de bornage.
- **Navigateur réel**, sur PostgreSQL jetable (`/tmp/vq-pgtest`, jamais la production) :
  - admin : session à 28 h, 3 stagiaires dont un en abandon ; Blandine 3,5 h → **88 %**,
    Noé 0 absence → **100 %**, Amy en abandon → **aucun taux** affiché ;
  - ajout d'une absence (durée vide → message d'erreur ; doublon → **409** affiché ; puis
    7 h le 2026-01-07) → total session **10,5 h**, assiduité recalculée à **63 %** ;
  - modification (formulaire pré-rempli, 7 h → 3,5 h et passage en justifiée) → total **7 h**,
    assiduité **75 %**, l'autre absence intacte ;
  - suppression (confirmation nominative) → total revenu à **3,5 h**, assiduité **88 %** ;
  - durée de repli : sur la session sans durée prévue déclarée, l'écran affiche « 21 h (durée par
    défaut de la formation : aucune durée prévue n'est déclarée) » ;
  - **contributeur** : peut lire, ajouter (vérifié : absence créée, total 7 h, Noé 88 %) et
    supprimer ; ne voit **aucun** contrôle admin — ni le champ Horaire, ni le sélecteur de civilité,
    ni le formulaire de création de groupe, ni le bloc Formations, ni l'onglet Modèles.
- **Contrôle direct de la base jetable** : les lignes écrites sont bien présentes avec leurs
  valeurs ; migration courante toujours **010** ; 28 tables publiques.

### Limites restantes

1. Contrôle de doublon non transactionnel (lecture puis écriture) : fenêtre de concurrence résiduelle.
2. Les heures réellement suivies **avant un abandon** ne sont pas modélisées : aucun taux n'est
   produit dans ce cas, volontairement.
3. Pas d'état de synthèse d'assiduité toutes sessions confondues, ni d'export.
4. La durée prévue reste déduite (`duree_heures_reelle` → `duree_heures_defaut`) : il n'existe
   toujours pas de champ de durée prévue propre à la session. Le chantier de validation générique
   des identifiants (D1) reste entier : seules les routes du lot L2 renvoient 400 au lieu de 500.

### Prochaine étape

Déploiement du lot L2 après validation, puis lot suivant. **Aucun push effectué.**

---

## 2026-09-22 (suite 3) — Relibellage de la durée d'une session

Décision métier : le terme historique « durée réelle » est ambigu — il peut laisser croire à des
heures effectivement réalisées, alors que `sessions.duree_heures_reelle` contient la durée
**déclarée/planifiée** de la session. L'interface utilise désormais **« Durée prévue (h) »**.

Périmètre volontairement étroit :

- **colonne SQL non renommée** : `sessions.duree_heures_reelle` reste tel quel, aucune migration ;
- **marqueur `{{duree}}` inchangé** dans son comportement, priorité inchangée
  (`duree_heures_reelle` puis `duree_heures_defaut`) ;
- **calcul d'assiduité inchangé** ;
- seuls les libellés visibles et la documentation ont été réalignés :
  formulaire de création de session, texte d'aide du repli de durée (L2), commentaire de la
  convention de marqueurs, ligne `{{duree}}` du README, et cette note.

---

## 2026-09-22 (suite 4) — Validation du lot L2 en production

### Push

- commits poussés (fast-forward, sans `--force`) : `e720a45` (documentation preuves),
  `2f4fd84` (assiduité), `f7273ee` (clarification du libellé de durée)
- `git fetch` préalable : `origin/main` inchangé (`40e9d54`), 0 commit distant, avance simple

### Déploiement Railway

- déploiement `a97c9407-b08a-4624-ad03-e2f1d7c71c41`, commit `f7273eea`
- statut : **SUCCESS**
- `/api/health` : **HTTP 200** → `{"ok":true}`
- **aucune ligne « Migration appliquée »** : migration toujours **010** (10 migrations)
- erreurs : aucune ; seuls les avertissements bénins connus

### Smoke test production (par l'utilisatrice) — 5/5 OK

1. bloc « Absences / assiduité » visible ;
2. ajout d'une absence + recalcul correct ;
3. modification + recalcul correct ;
4. suppression + retour au calcul précédent ;
5. stagiaire sans absence = 100 % lorsque la durée prévue est connue, abandon sans taux trompeur.

### État

- `npm test` : **135/135**
- **Lot L2 ASSIDUITÉ : TERMINÉ.**

### Prochaine étape

Lot **L3** — stagiaires et dossiers : import CSV en masse, fiches stagiaires, inscriptions.

---

## 2026-09-22 (suite 5) — L3 : stagiaires et dossiers

### Schéma réellement réutilisé — aucune migration

Toutes les colonnes utiles existaient déjà : `stagiaires` (`civilite`, `nom`, `prenom`, `email`,
`telephone`, `entreprise`, `financeur`, `situation_handicap`, `besoins_adaptation`),
`inscriptions` (`stagiaire_id`, `session_id` UNIQUE, `groupe_id`, `prescripteur`,
`dossier_complet`, `statut`, `date_abandon`), `groupes` (`session_id`, `nom`), `sessions`.
**Aucune contrainte UNIQUE sur l'email** ajoutée : le rapprochement est fait par la route.

### Format CSV retenu

- séparateur virgule **ou** point-virgule détecté sur la première ligne (point-virgule prioritaire) ;
- guillemets, BOM UTF-8, fins de ligne CRLF ;
- en-têtes tolérants, sans casse ni accents (« Prénom », « E-mail », « Situation handicap »…) ;
- colonne inconnue signalée, jamais devinée ; deux colonnes rappelant le même champ refusées ;
- encodage illisible détecté (U+FFFD) ;
- parseur **sans dépendance** (`services/csvStagiaires.js`, fonctions pures testées).

### Règles de rapprochement / doublons

- email unique normalisé → rapprochement exact, réutilisation sans ambiguïté ;
- email partagé par plusieurs stagiaires → « à vérifier », jamais fusionné ;
- nom/prénom sans email → « doublon possible », jamais fusionné ;
- email deux fois dans le fichier → ligne invalide ;
- stagiaire déjà inscrit dans la session → « déjà inscrit », pas de doublon.

### Routes

- `POST /api/sessions/:id/stagiaires/import-apercu` (`requireRedacteur`) — classification, aucune écriture.
- `POST /api/sessions/:id/stagiaires/import` (`requireRedacteur`) — confirmation **transactionnelle**.
- `PATCH /api/stagiaires/:id` (`requireRedacteur`) — fiche complète (toutes les colonnes).
- `PATCH /api/inscriptions/:id` (`requireRedacteur`) — groupe validé contre la session, prescripteur,
  dossier, statut/abandon.

### Parcours UI

Dans le détail de session : bouton « Dossier » par stagiaire (fiche + inscription) et bloc
« Importer des stagiaires (CSV) » en deux temps — aperçu classé et résumé, puis confirmation avec
bilan. `situation_handicap` et `besoins_adaptation` ne sont affichés que dans le panneau Dossier.

### Droits

ADMIN et CONTRIBUTEUR : import, création/correction de fiche, inscription, groupe, prescripteur,
dossier, abandon. Aucun droit admin supplémentaire ouvert au contributeur — vérifié en direct : 403
sur `POST /api/sessions`, `POST /api/preuves`, `PUT /api/formations/:id`, etc. ; 401 sans cookie.

### Vérifications effectuées

- `npm test` : **183/183** (135 avant → 48 nouveaux : 15 purs CSV + 33 HTTP).
- `npm run build` : OK ; `git diff --check` : propre.
- **Preuve que les tests mordent** (deux mutations, code restauré à l'identique) :
  1. `requireRedacteur` → `requireAdmin` sur l'import → 182/183, échec de
     « un contributeur importe un stagiaire » ;
  2. validation de groupe neutralisée → 182/183, échec de « un groupe d'une autre session est refusé ».
- **Navigateur réel** sur PostgreSQL jetable : import d'un CSV de 4 lignes → aperçu exact
  (2 prêts, 1 doublon possible, 1 invalide) → confirmation → 2 créés, 2 inscrits, 2 ignorés ;
  groupe/prescripteur/dossier appliqués ; correction de fiche (entreprise, situation de handicap,
  besoins) ; changement de prescripteur et de dossier ; stagiaires antérieurs et abandon intacts ;
  contributeur : voit « Dossier » et l'import, aucun contrôle admin.
- **Bug réel corrigé en cours de route** : `cx.query` passé nu perdait sa liaison (`this`) → 500
  contre le vrai client pg alors que la base simulée passait. Corrigé en flèche
  `(sql, params) => cx.query(sql, params)`, et le faux client de test exige désormais la liaison
  pour attraper ce genre de régression.
- Le chemin zsh : une variable locale nommée `path` a écrasé `PATH` (piège zsh connu) ; restauré.

### Limites restantes

1. Rapprochement par email non transactionnel face à deux imports concurrents : fenêtre résiduelle.
2. Pas d'export CSV des stagiaires, ni d'import des absences/QCM dans ce lot.
3. Le chantier D1 (identifiants invalides sur les autres routes) reste entier.

### Prochaine étape

Déploiement du lot L3 après validation. **Aucun push effectué.**

---

## 2026-09-22 (suite 6) — L3-bis : prescripteurs configurables

### État initial du schéma

- `inscriptions.prescripteur` : `text`, **nullable**, sans défaut ;
- **CHECK SQL présent** : `inscriptions_prescripteur_check` = `IN ('pole_emploi','mission_locale',
  'of','autre')` (posé par la migration 005) ;
- liste figée à 4 endroits : le CHECK, `PRESCRIPTEURS` dans `gestion.js`, la map `PRESCRIPTEURS`
  dans `Sessions.jsx`, `normaliserPrescripteur` dans `csvStagiaires.js` ;
- valeurs réelles en production : `pole_emploi` (4), `mission_locale` (1), `of` (1).

### Architecture choisie — migration 011

**Table de référence + texte conservé**, sans FK : `inscriptions.prescripteur` reste du texte et
continue de stocker le `code`. Aucune inscription n'est réécrite, aucune conversion risquée.

Migration `011_prescripteurs_configurables.sql` :

- `ALTER TABLE inscriptions DROP CONSTRAINT IF EXISTS inscriptions_prescripteur_check` ;
- `CREATE TABLE prescripteurs (id, code UNIQUE, nom, actif, created_at, updated_at)` + trigger ;
- seed inchangé : `pole_emploi` → « Pôle Emploi », `mission_locale`, `of` → « Organisme de
  formation », `autre`, + `cap_emploi` → « CAP Emploi ».

### Comportement CSV

- colonne absente ou cellule vide → ligne acceptée, prescripteur NULL, aucune erreur ;
- valeur connue (code **ou** libellé, normalisés) et **active** → rattachée ;
- valeur inconnue → `invalide — prescripteur inconnu : <valeur>` ;
- valeur connue mais **désactivée** → `invalide — prescripteur inactif` ;
- jamais de création automatique : l'admin crée le prescripteur, puis le même CSV se réanalyse.

### Routes

- `GET /api/prescripteurs` (`requireAuth`) — liste complète avec `actif`.
- `POST /api/prescripteurs` (`requireAdmin`) — code = nom normalisé, suffixé si collision.
- `PATCH /api/prescripteurs/:id` (`requireAdmin`) — renomme le libellé (le code ne bouge jamais),
  réactive/désactive.
- `DELETE /api/prescripteurs/:id` (`requireAdmin`) — désactive (soft), ne supprime jamais.
- `POST /sessions/:id/stagiaires` et `PATCH /inscriptions/:id` valident désormais contre la table.

### Gestion UI

Bloc « Prescripteurs » (admin, écran Sessions) : afficher, ajouter, renommer, désactiver/réactiver.
Dans le dossier stagiaire : select « Aucun » + prescripteurs **actifs** uniquement. L'affichage d'une
ancienne inscription résout le code vers le libellé, même désactivé.

### Droits

ADMIN : créer / renommer / désactiver. CONTRIBUTEUR : sélectionner seulement (GET 200, POST/PATCH/
DELETE 403). Aucun autre droit modifié.

### Tests

- `server/test/prescripteurs.test.js` (11 tests : CRUD, droits, 401/403, 400/404).
- `csvStagiaires.test.js` : `trouverPrescripteur` (code ou libellé, inactif inclus).
- `stagiaires.test.js` : CSV sans colonne, cellule vide, connu, inactif, import après création.
- `npm test` : **199/199** (183 avant → 16 nouveaux).
- migration 011 testée en deux phases sur une base contenant des données réelles : inscriptions
  existantes conservées (`pole_emploi`, `mission_locale`), CHECK levé, `cap_emploi` accepté après.
- navigateur réel (admin + contributeur) : bloc de gestion, ajout « France Travail », import CSV
  vide/connu/inconnu, contributeur sans le bloc de gestion et 403 sur la création.

### Limites restantes

1. Le code généré d'un nouveau prescripteur n'est pas renommable (voulu : il est référencé tel quel).
2. Pas de contrainte d'unicité sur le `nom` (deux prescripteurs peuvent porter le même libellé).
3. Chantier D1 toujours entier.

### Prochaine étape

Déploiement de L3 + L3-bis après validation. **Aucun push effectué.**

---

## 2026-09-22 (suite 7) — Validation de L3 + L3-bis en production

### Push

- commits poussés (fast-forward, sans `--force`) : `fbdc6c6` (stagiaires/dossiers),
  `a2de631` (prescripteurs configurables)
- `git fetch` préalable : `origin/main` inchangé, 0 commit distant, avance simple

### Déploiement Railway

- déploiement `ed08e99a-946f-4981-9e5d-5a8c6beec391`, commit `a2de631b`
- statut : **SUCCESS** ; `/api/health` : **HTTP 200**
- **migration 011 appliquée automatiquement UNE seule fois** (« Migration appliquée :
  011_prescripteurs_configurables.sql ») ; `schema_migrations` : 11, dernière = 011
- lecture seule : `prescripteurs` seedé (autre, cap_emploi, mission_locale, of, pole_emploi) ;
  `inscriptions.prescripteur` inchangé (pole_emploi 4, mission_locale 1, of 1) — aucune perte
- erreurs : aucune ; avertissements bénins connus uniquement

### Smoke tests production

- L3 : **8/8 OK**
- L3-bis : **5/5 OK** (création, reconnaissance CSV, rattachement, vide accepté,
  désactivation/réactivation)

### État

- tests au moment du déploiement : **199/199**
- **L3 et L3-bis TERMINÉS.**

### Prochaine étape

Lot **L4** — sessions corrigeables et cycle de vie (statut).

---

## 2026-09-22 (suite 8) — L4 : sessions corrigeables et cycle de vie

### Audit préalable

- `sessions.statut` existait depuis 001 (`DEFAULT 'planifiee'` + CHECK 4 valeurs) mais n'était ni
  exposé ni modifiable : `GET /api/sessions` ne le renvoyait pas, `PATCH /api/sessions/:id` ne
  gérait que `horaire`.
- **Aucune migration nécessaire** : le lot est purement applicatif (route + client + tests).

### Backend

- `PATCH /api/sessions/:id` (`requireAdmin`) réécrit : charge la ligne, applique uniquement les
  champs reconnus (`reference`, `date_debut`, `date_fin`, `lieu`, `formateur`,
  `duree_heures_reelle`, `horaire`, `statut`), valide chaque saisie, calcule `documentsObsoletes`
  sur les 7 champs imprimés (durée comparée numériquement), `23505` → 409.
- `GET /api/sessions` (`requireAuth`) renvoie en plus `statut`, `lieu`, `horaire`.

### Client

- liste : pilule de statut + horaire + lieu ;
- détail : pilule de statut, avertissement d'incohérence sans correction automatique
  (planifiée/fin passée, terminée/début futur), bloc admin « Modifier la session » repliable ;
- après enregistrement, la liste se rafraîchit (`onChange` repassé sur le `charger` parent).

### Tests

- `server/test/sessions.test.js` (16 tests, app réelle + base simulée) ;
- `server/test/horaire.test.js` recentré sur `normaliserHoraire` (le contrat HTTP du PATCH vit
  désormais dans `sessions.test.js`) ;
- `npm test` : **208/208** (199 → 208) ; `npm run build` OK ; `git diff --check` propre.

### Vérification navigateur (PostgreSQL jetable `/tmp/vq-pgtest`)

- admin : édition lieu/durée/statut/formateur → persistée, liste rafraîchie à vif, assiduité
  recalculée (30 h), avertissement « planifiée » fin passée présent puis absent selon le statut ;
- contributeur : détail en lecture seule (pas de bloc « Modifier la session »), 403 direct en API ;
- API : `documentsObsoletes` true/false corrects (lieu changé / statut / sans changement réel),
  statut invalide 400, contributeur 403.

### État

- **L4 TERMINÉ.** Aucun push effectué ; attente de validation pour pousser et déployer.

### Prochaine étape

Validation L4 par l'utilisateur, puis push + déploiement Railway.

---

## 2026-09-22 (suite 9) — L4 : arbitrage appliqué (dates/absences, durée, référence)

Après audit lecture seule et arbitrage de l'utilisateur, trois corrections minimales :

### 1. Dates vs absences existantes — BLOQUER

`PATCH /api/sessions/:id` : si `date_debut`/`date_fin` changent réellement, la nouvelle période est
comparée aux absences des inscriptions de la session. Si au moins une absence tombe hors période,
réponse **400** « Impossible : N absence(s) tomberaient hors des nouvelles dates… », sans aucune
écriture. Aucun changement de schéma.

### 2. Durée prévue vs absences — NE PAS bloquer, signaler

Si `duree_heures_reelle` est réduite sous le total d'heures d'absence, la réponse porte
`absencesDepassentDuree: true` et `total_heures_absence`. Le client alerte :
« Attention : N h d'absence dépassent la nouvelle durée prévue de M h. » (fonction pure
`messageDepassementDuree` dans `client/src/messages.js`). Le calcul d'assiduité reste inchangé
(taux borné à 0 %, heures suivies plancher 0, dépassement signalé dans le détail).

### 3. Référence — FACULTATIVE

Référence de session **facultative, unique lorsqu'elle est renseignée**. Confirmé par le schéma
(`reference text UNIQUE`, nullable), le formulaire de création (seuls formation + dates sont
obligatoires) et la production (session existante sans référence). Aucune modification : comportement
documenté seulement.

### Tests

- `server/test/sessions.test.js` : +8 (dates excluant une absence sur `date_debut`, `date_fin`,
  les deux, comptage multiple, aucune écriture partielle ; durée < absences → drapeau, durée >=
  absences → rien, effacement → rien).
- `server/test/avertissements.test.js` (nouveau, 2 tests) : message client de dépassement.
- `npm test` : **218/218** (208 avant → +10) ; `npm run build` OK ; `git diff --check` propre.

### Vérification navigateur (PostgreSQL jetable)

- blocage dates : `date_debut` 2026-01-10 (exclut l'absence du 06) → erreur « 1 absence tomberait
  hors… » affichée, rien modifié ;
- durée 2 h (< 3,5 h d'absences) → dialogue « Attention : 3.5 h d'absence dépassent la nouvelle
  durée prévue de 2 h. », puis détail « Assiduité 0 % · 0 h suivies sur 2 h » + pilule
  « Absences supérieures à la durée prévue » ;
- modification normale (lieu → Kourou, durée → 28) toujours fonctionnelle, liste rafraîchie ;
- contributeur toujours en lecture seule (pas de bloc « Modifier la session », 403 direct en API).

### État

- Corrections appliquées, tests et navigateur OK. **Aucun push effectué.**

### Prochaine étape

Push + déploiement après validation finale.

---

## 2026-09-23 (suite 10) — L4 : référence facultative et alertes épinglées (correctif post-déploiement)

### Bug référence (corrigé)

**Cause exacte** : `PATCH /api/sessions/:id` refusait `reference: ""` / `"   "` avec
« La référence ne peut pas être vide. », alors que la création (`POST /sessions`) normalise
déjà `reference?.trim() || null` et que la production contient une session `reference = NULL`.
Le client envoie toujours `reference` (chaîne vide pour une session sans référence), donc toute
édition d'un autre champ était refusée pour ces sessions.

**Correction** : le PATCH applique désormais **la même normalisation que la création** —
vide ou espaces ⇒ `NULL`, sinon trim + contrôle d'unicité (`23505` → 409). Aucune migration.

### Alertes épinglées (sticky)

Le message d'erreur de l'écran Sessions s'affichait en haut de page, invisible quand le formulaire
« Modifier la session » est plus bas. Correctif minimal sans refonte :

- nouvelle classe `.flash.sticky` (`position: sticky; top: 8px; z-index: 60`) ;
- appliquée **uniquement** à l'erreur globale de l'écran Sessions (les notes d'information
  permanentes, comme la note V10 du référentiel, restent non épinglées) ;
- bornée par sa section : elle s'efface d'elle-même sans masquer durablement l'interface.

### Tests

- `sessions.test.js` : référence vide/espaces ⇒ NULL, référence rognée, session sans référence
  corrigeable, collision 409, non-régression création (vide ⇒ NULL côté INSERT) ;
- `npm test` : **221/221** (218 avant → +3) ; `npm run build` OK ; `git diff --check` propre.

### Vérification navigateur (PostgreSQL jetable)

- session `reference = NULL` : modification du lieu seul ⇒ **200**, persistée après rechargement,
  référence toujours vide acceptée ;
- référence réelle « TEST-REF » ⇒ sauvegardée et affichée ;
- référence « SESS-SANS » (déjà prise) ⇒ **409** « Cette référence est déjà utilisée… » ;
- erreur provoquée formulaire bas de page : le flash `position: sticky` reste en haut de l'écran
  (top 8 px dans le viewport) — immédiatement visible sans remonter.

### État

- Correctif committé localement. **Aucun push effectué.**

### Prochaine étape

Validation, puis push + déploiement du correctif.

---

## 2026-09-23 (suite 11) — L4 : validation en production (clôture)

### Push et déploiement du correctif

- pré-push : 221/221 tests, build OK, `git diff --check` propre ; `origin/main` inchangé
  (`1b8054e`), ancêtre de HEAD, seul `fee0376` au-dessus ;
- push **sans `--force`** : `1b8054e..fee0376 main -> main` ;
- déploiement Railway `e5dbcf59` → **SUCCESS**, `/api/health` **200** ;
- logs : aucune migration supplémentaire, aucune erreur runtime (avertissements bénins connus).

### Contrôles production (lecture seule)

- migration courante : **011_prescripteurs_configurables.sql** (11 au total) ;
- données intactes : 1 session, 8 inscriptions, 1 absence ;
- la session qui était sans référence porte désormais `reference = "001"` (posée lors du smoke
  test utilisateur « vraie référence ») — le correctif n'a touché à aucune session.

### Smoke tests production finaux (utilisateur)

- session sans référence modifiable : OK ;
- flash sticky visible sans remonter : OK.

### État

**L4 TERMINÉ.** Commits : `1b8054e` (principal) + `fee0376` (correctif).

### Prochaine étape

Lot **L5** — documents d'assiduité / EduSign.

---

## 2026-09-23 (suite 12) — L5 : assiduité et pièces EduSign

### Audit (avant toute modification)

Existait déjà : génération documentaire (modèles Drive, `generations`, `documents_generes`),
preuves/pièces Drive (`preuves` + `preuve_fichiers`, source manuel/import_drive/generation),
calcul d'assiduité L2 (`calculerAssiduite`), 12 marqueurs (aucun d'assiduité ni d'email/tel/
prescripteur/groupe). Le rattachement manuel d'un fichier Drive existait déjà via `POST /api/preuves`.

### Architecture retenue — aucune migration

- assiduité dans les documents : **marqueurs** + **données chargées** (`cibles` étendue,
  `calculerAssiduite` réutilisé, déplacé dans `services/assiduite.js` et ré-exporté) ;
- rattachement EduSign : `preuves`/`preuve_fichiers` (source « manuel » = externe), `POST /api/preuves`
  accepte `session_id`/`groupe_id`, `GET /api/preuves?session` filtre, nouveau `GET /api/indicateurs` ;
- aucun PDF stocké, aucun fichier copié.

### Marqueurs ajoutés (additifs)

`session_reference`, `session_statut`, `email`, `telephone`, `entreprise`, `financeur`,
`prescripteur`, `groupe`, `heures_absence`, `heures_suivies`, `taux_assiduite` (23 au total).
Assiduité non fiable ⇒ `heures_suivies`/`taux_assiduite` vides, jamais un faux chiffre.

### UI

Bloc « Documents / Assiduité » dans le détail de session, en deux parties : « Documents générés
par Vigie » (pilule dédiée) et « Documents externes / EduSign » (pilule dédiée + formulaire admin
« Rattacher » : type suggéré, libellé, indicateur, id de fichier Drive).

### Droits

ADMIN : générer + rattacher. CONTRIBUTEUR : consulter + générer (droit existant), pas de
rattachement (`POST /api/preuves` reste `requireAdmin`). Aucun droit admin nouveau accidentel.

### Tests

- `marqueurs.test.js` : liste des 23 marqueurs, valeurs d'assiduité, fiabilité ;
- `assiduiteDocuments.test.js` (nouveau) : GET /indicateurs (200/401), GET /preuves?session,
  calculerAssiduite réutilisé ;
- `preuves.test.js` : rattachement EduSign à une session, source « manuel », aucune copie ;
- `npm test` : **230/230** (221 → +9) ; build OK ; `git diff --check` propre.

### Vérification navigateur (PostgreSQL jetable)

- requête `cibles` vérifiée sur la base réelle : prescripteur libellé, groupe, `heures_absence` ;
- admin : bloc en deux sections, rattachement « Feuille d'émargement EduSign » sur indicateur 11
  avec id Drive ⇒ affiché dans « Documents externes / EduSign » ;
- contributeur : consulte les deux listes, génère, mais sans formulaire « Rattacher » ;
- génération réelle non rejouée (Drive non connecté dans le harnais) — la capacité est couverte par
  les tests de marqueurs/données et la requête `cibles`.

### Correctifs avant push (relecture produit)

1. **Rattachement Drive** : le formulaire demandait un ID Drive en saisie libre (fictif accepté).
   Correction : réutilisation du sélecteur **`RechercheDrive`** (recherche par nom, nom du fichier
   affiché), et vérification serveur `drive.files.get` avant écriture : fichier inexistant ⇒ **400**,
   Drive non connecté/indisponible ⇒ **503** (jamais accepté à l'aveugle), nom/URL/MIME réels récupérés.
2. **Intégrité session/groupe** : `POST /api/preuves` refuse session inexistante, groupe inexistant,
   et un groupe qui n'appartient pas à la session fournie.
3. **Preuve de génération** : nouveau test `generationAssiduite.test.js` — `genererDocuments` avec
   client Google injecté, le payload exact des requêtes de remplacement contient `heures_absence`,
   `heures_suivies`, `taux_assiduite` corrects (avec et sans absence).

### État

- L5 amendé localement (correctifs inclus). **Aucun push effectué.**

### Prochaine étape

Validation, puis push + déploiement du lot L5.

---

## 2026-09-23 (suite 13) — L5 : validation en production (clôture)

### Push et déploiement

- pré-push : 235/235 tests, build OK, `git diff --check` propre ; `origin/main` inchangé
  (`fee0376`), ancêtre de HEAD, commits `3a2c93b` (doc L4) + `65b70ef` (L5) au-dessus ;
- push **sans `--force`** : `fee0376..65b70ef main -> main` ;
- déploiement Railway `94dd340c` → **SUCCESS**, `/api/health` **200** ;
- logs : aucune migration supplémentaire, aucune erreur runtime ;
- contrôles production lecture seule : migration courante **011**, route `/api/drive/recherche`
  montée (401 sans cookie), données intactes (1 session, 8 inscriptions, 1 absence) ; aucun
  fichier rattaché ni document généré par l'agent.

### Smoke test production réel (utilisateur)

Bloc Documents / Assiduité, recherche d'un vrai fichier EduSign dans Drive, sélection sans ID
technique, rattachement, affichage dans Documents externes / EduSign, lien vers le fichier Drive
original, aucune copie supplémentaire : **OK**.

### Génération réelle

Non faite (aucun modèle d'assiduité utile disponible) — **non bloquant** : le chemin jusqu'au
payload Google Docs est couvert par `generationAssiduite.test.js`.

### État

**L5 TERMINÉ.** Commit : `65b70ef`.

### Prochaine étape

Lot **L6** — référentiel Qualiopi et veille.

---

## 2026-09-23 (suite 14) — L6 : référentiel versionné + veille Qualiopi

### Audit (avant toute modification)

- `veille` : 0 ligne en production, statut distribution vide, `integree` 0 ;
- `referentiel_versions` : unique version V9 active, 7 critères / 32 indicateurs intacts ;
- aucune migration L6 en production (courante : 011).

### Décision produit

- migration 012 **additive** uniquement : cycle d'action séparé, `veille.statut` intouché ;
- pas de contenu V10 inventé : la préparation de version ne crée qu'une coquille ;
- activation de version **explicite** (jamais déduite de la date), transactionnelle.

### Backend

- routes versions : `GET /referentiel/versions`, `GET /referentiel/versions/:id`,
  `POST /referentiel/versions` (coquille, 409 doublon), `POST /referentiel/versions/:id/activer`
  (une seule active, avertissement si date future) ;
- routes veille : `GET /veille` (filtres), `GET /veille/:id` (détail + preuves), `POST /veille`,
  `PATCH /veille/:id` (indicateurs remplacés transactionnellement), cohérence du cycle d'action
  (réalisée ⇒ action non vide ; date de réalisation ⇒ réalisée ; retour en arrière retire la date ;
  dates strictes) ;
- `POST /api/preuves` accepte `veille_id` (existence vérifiée), réutilise la vérification Drive.

### UI

- onglet **Veille** (admin + contributeur lecture seule) ;
- écran **Versions** dans le référentiel (admin) : liste classée, activation, coquille.

### Tests

- `referentielVersions.test.js` + `veille.test.js` (fakes `setPoolFactory`/`setDriveFactory`) ;
- suite complète : **263/263** (235 avant → +28).

### Vérification navigateur (PostgreSQL jetable)

- admin : création veille (type, indicateurs 23/24), détail, modification (a_analyser→analysee,
  action a_realiser), retour au détail à jour — OK ;
- versions : V9 active ; création V10 coquille (future) ; activation V10 → V9 historique avec
  relations intactes (7 critères / 32 indicateurs), avertissement « date future » affiché ;
  réactivation V9 → V10 future, V9 active — OK ;
- contributeur : onglet Veille visible, liste + détail en lecture seule (aucun bouton d'écriture) ;
- preuve attachée à la veille via `veille_id` (API réelle) — OK ; la variante Drive simulée est
  couverte par `veille.test.js` (Drive réel non connecté dans le bac à sable jetable).

### État

**L6 TERMINÉ en local** — commit en attente, **aucun push** sans autorisation explicite.

### Prochaine étape

- commit local `Referentiel : versionner et exploiter la veille Qualiopi` ;
- puis, après validation utilisateur : push + déploiement Railway + vérification production.

---

## 2026-09-23 (suite 15) — L6 : garde « version vide non activable » + revalidation

### Demande produit

Sécuriser avant push : une coquille de référentiel sans critères/indicateurs ne doit JAMAIS
devenir la version active (elle masquerait le référentiel et viderait la liste des indicateurs
utilisée par le tableau de bord, les preuves et la veille).

### Audit confirmé

- `POST /referentiel/versions` ne crée que la coquille (0 critère, 0 indicateur) ;
- avant correction, `POST /referentiel/versions/:id/activer` activait sans vérifier le contenu :
  une version active vide rendait le tableau de bord vide (0 critère / 0 indicateur), et
  `GET /api/indicateurs` / `POST /api/preuves` (filtre `est_active`) ne trouvaient plus aucun
  indicateur — risque **confirmé**.

### Correction

- garde ajoutée dans `POST /referentiel/versions/:id/activer`, **avant** toute écriture :
  comptage des critères et indicateurs de la version cible ; 0 critère OU 0 indicateur ⇒ **409**
  « Impossible d'activer cette version : aucun critère ou indicateur n'a encore été importé. » ;
- un refus ne désactive pas la version active (aucune écriture n'a eu lieu) ;
- pas de sur-validation (aucun nombre minimal, aucun contenu attendu, aucun texte vérifié exigé).

### Tests

- `referentielVersions.test.js` : coquille vide refusée (409) sans désactiver l'active, une seule
  active après refus ; critères seuls refusés ; indicateurs seuls refusés ; version avec
  critères + indicateurs activable ; activation toujours transactionnelle ; droits contributeur
  (lecture versions/détail 200, POST 403, activation 403) et anonyme (401) ;
- `veille.test.js` : contributeur lit le détail d'une veille (200) ;
- suite complète : **267/267** (263 avant → +4).

### Vérification navigateur / API (PostgreSQL jetable)

1. V9 active (32 indicateurs) ;
2. création V10 coquille (future) ;
3. tentative activation V10 ⇒ **409 visible** dans l'écran Versions, V10 reste « future » ;
4. V9 toujours active après refus ;
5. injection HARNIS UNIQUEMENT d'un critère + indicateur techniques fictifs dans V10 ;
6. activation V10 ⇒ succès (avertissement date future), V9 devient historique ;
7. V9 historique avec relations intactes (7 critères / 32 indicateurs) ;
8. réactivation V9 ⇒ V10 future, V9 active.

### Droits backend vérifiés (HTTP réel)

- CONTRIBUTEUR : GET versions 200, GET détail version 200, POST version 403, activation 403,
  GET veille 200, GET détail veille 200, POST/PATCH veille 403 ;
- ANONYME : 401.

### État

Garde intégrée, tests 267/267, build OK, `git diff --check` propre. **Aucun push**.
