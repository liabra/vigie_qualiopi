# Vigie Qualiopi — Phase 0 (fondations)

Suivi de la conformité au Référentiel national qualité (Qualiopi).
Même architecture que Vigie : front **React + Vite**, serveur **Express**,
base **PostgreSQL**, déploiement **Railway**.

Phase 0 : schéma de base, référentiel V9, connexion Google, accès Drive en
lecture seule, liste des 32 indicateurs par critère.

Phase 1 : indexation du classeur de suivi Drive existant, écran de validation
des preuves importées, tableau de bord de conformité par indicateur avec score
global. Pas de génération de documents, pas de classification par IA, et pas
encore d'échéances de péremption : ce sont des phases à part.

## Structure

```
client/                 React + Vite (écran de connexion, référentiel)
server/
  src/index.js          démarrage : config → migrations → seed si base vide → HTTP
  src/app.js            Express : /auth, /api, puis le build du client
  src/session.js        cookies signés HMAC, requireAuth / requireAdmin
  src/services/google.js OAuth Google, Drive et Sheets (lecture seule)
  src/services/classeur.js  analyse du classeur de suivi (module pur)
  src/services/driveIndex.js index du Drive et rapprochement des noms
  src/services/import.js     orchestration de l'import
  src/routes/           auth.js (OAuth), api.js (referentiel, preuves, import, drive)
  db/migrations/        NNN_*.sql, appliqués une fois chacun (schema_migrations)
  seed/                 referentiel_qualiopi_v9_indicateurs.json (guide V9)
railway.json            build, démarrage, healthcheck /api/health
```

## Démarrer en local

```bash
cp .env.example .env    # puis remplir DATABASE_URL, GOOGLE_*, SESSION_SECRET
npm install
npm run dev             # serveur sur :3000, client sur :5173 (ouvrir celui-ci)
```

Au démarrage, le serveur applique les migrations et importe la V9 si aucune
version du référentiel n'est en base.

| Commande | Rôle |
| --- | --- |
| `npm run db:migrate` | applique les migrations en attente |
| `npm run db:seed` | réimporte le guide V9 |
| `npm run db:seed -- chemin.json` | importe un autre fichier de référentiel |
| `npm test` | tests unitaires serveur |

## Mettre en ligne sur Railway

1. **New Project → Deploy from GitHub repo** → `liabra/vigie_qualiopi`.
2. **New → Database → PostgreSQL**, puis dans le service de l'app, variable
   `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`.
3. Variables : `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_REDIRECT_URI`, `ADMIN_EMAILS`, `DRIVE_ACCOUNT_EMAIL`, et
   `NODE_ENV=production` (cookies `Secure`, `SESSION_SECRET` exigée).
4. **Settings → Networking → Generate Domain**, puis reporter
   `https://<domaine>/auth/google/callback` dans `GOOGLE_REDIRECT_URI` **et**
   dans la console Google.

## Google : connexion et Drive

Dans la [console Google Cloud](https://console.cloud.google.com) : activer
l'**API Google Drive**, créer un identifiant OAuth **Application Web**, et
autoriser les URI de redirection locale et de production. Tant que l'écran de
consentement est en mode *Test*, ajouter `actions.a2c@gmail.com` aux
utilisateurs test.

Deux consentements distincts :

- **Connexion** (`openid email profile`) : identifie la personne. Au premier
  passage, seules les adresses de `ADMIN_EMAILS` créent leur compte, en
  admin. Ensuite la table `utilisateurs` fait foi (rôle, `actif`).
- **Connecter le Drive** (bouton admin, scopes `drive.readonly`,
  `spreadsheets.readonly` et `drive.file`) : n'est accepté que pour `DRIVE_ACCOUNT_EMAIL`.
  Le refresh_token est stocké dans `drive_connexions` et rafraîchi
  automatiquement. Le scope Sheets sert à lire le classeur de suivi : l'export
  CSV de Drive ne rendrait que le premier onglet et perdrait les cellules
  fusionnées. **Un Drive connecté avant la Phase 1 doit être reconnecté** :
  l'écran d'accueil le signale.

## Référentiel

Source : `server/seed/referentiel_qualiopi_v9_indicateurs.json`, tiré du guide
de lecture V9 du 8 janvier 2024 (DGEFP). Il contient les 7 critères et les 32
indicateurs avec type commun ou spécifique, catégories concernées (OF, CFA,
CBC, VAE), niveau attendu, exemples de preuves, obligations spécifiques,
sous-traitance, gradation des non-conformités, modalités pour nouveaux
entrants et audit initial aménagé.

L'import est idempotent. Un fichier est réputé tiré du guide officiel, sauf
s'il porte `"provisoire": true`. Un import provisoire ne réécrit jamais un
indicateur déjà vérifié.

> **V10** : le décret n° 2026-728 du 1er août 2026 passe le référentiel à 33
> indicateurs au 1er novembre 2026. Le guide V10 n'est pas encore publié.
> La table `referentiel_versions` accueillera la V10 à côté de la V9 ; une
> seule version est active à la fois.

## Import du classeur de suivi (Phase 1)

Le classeur Sheets de suivi d'audit est la source de vérité de cette phase.
L'écran **Preuves** propose à l'admin deux boutons : **Aperçu du classeur**,
qui lit tout sans rien écrire, puis **Importer le classeur**.

Le classeur est cherché **par son nom** (jamais par un identifiant en dur) :
les noms contenant « Audit », « construction », « système qualité »,
« Qualiopi » ou « suivi » sont candidats, et celui du compte de l'organisme,
le plus récemment modifié, l'emporte. L'admin peut aussi imposer un
`fichierId` et un `onglet` précis dans l'appel à l'API.

Les en-têtes sont **lus dans la feuille**, pas supposés : le module cherche la
ligne d'en-têtes parmi les douze premières, puis retrouve chaque colonne par
son intitulé. L'ordre des colonnes peut donc changer. Les cellules fusionnées,
dont le classeur est truffé, sont propagées vers le bas avant lecture.

Pour chaque couple (indicateur, document) :

| Colonne d'état du classeur | Statut en base |
| --- | --- |
| `check ok` | Maîtrisé |
| `en cours`, `aval` | À consolider |
| `pas besoin`, `non applicable` | Non applicable |
| vide ou absente | À risque |

Le classeur a **deux colonnes « Etat »** (modèle validé, document complété).
Les deux sont lues, et la plus défavorable l'emporte : une seule ligne
inachevée suffit à ce que le document ne soit pas déclaré maîtrisé.

Le fichier est ensuite cherché sur le Drive, dans l'arborescence de dossiers
de critère qui contient le classeur. Les raccourcis Drive sont résolus vers
leur cible. Un nom identique, unique, est rattaché directement ; sinon la
preuve est marquée **à confirmer**, avec ses candidats et le motif du doute,
et l'admin tranche en un clic depuis l'écran Preuves. Un rattachement validé
à la main n'est jamais écrasé par un réimport.

L'import est **rejouable** : une preuve importée est identifiée par son
indicateur et son titre, un second passage met à jour sans dupliquer.

## Versions des librairies Google : à ne pas désaligner

`google-auth-library` doit rester sur la même version majeure que celle
attendue par le `googleapis-common` embarqué dans `@googleapis/sheets`,
aujourd'hui la 11.

Sinon l'en-tête `Authorization` est perdu entre le paquet Sheets et notre
client OAuth : la requête part sans identité, et Google répond 403
« Method doesn't allow unregistered callers », alors que le jeton, le scope
et le projet Cloud sont valides. Drive continue de fonctionner pendant ce
temps, car il embarque une version plus ancienne de `googleapis-common`,
ce qui rend le symptôme très trompeur.

Le test `server/test/pileGoogle.test.js` échoue si les versions divergent.
Le script `server/scripts/debug-sheets.js`, ignoré par git, rejoue un appel
Sheets avec un jeton collé à la main par quatre chemins différents, et
distingue un en-tête perdu, 403, d'un jeton refusé, 401.

## Diagnostic des refus de Google

Quand un appel Drive ou Sheets échoue, `POST /api/import/classeur` répond
400 avec deux champs distincts :

- `error` : le message lisible, affiché dans l'écran Preuves.
- `diagnostic` : la réponse brute de Google, à lire dans l'onglet Réseau du
  navigateur, sans passer par les journaux du serveur.

Le diagnostic contient l'opération fautive, par exemple
`sheets.spreadsheets.get`, le `code` et le `status` HTTP, l'URL appelée
sans sa chaîne de requête, et `googleErreur`, le corps JSON complet renvoyé
par Google. C'est ce corps qui distingue les causes : `CREDENTIALS_MISSING`
pour une requête reçue sans identité, `SERVICE_DISABLED` pour une API non
activée sur le projet Cloud, `ACCESS_TOKEN_SCOPE_INSUFFICIENT` pour un scope
manquant.

Il porte aussi `jeton`, l'état de l'access_token au moment de l'appel :
présence, date d'expiration, `expire` et `secondesRestantes`. Une valeur
négative indique qu'un rafraîchissement a dû avoir lieu juste avant.

Le même diagnostic est journalisé côté serveur, en une ligne JSON préfixée
`Google — échec de`. Les jetons n'y figurent jamais : toute clé ressemblant
à un secret est masquée, et seuls le message et le corps d'erreur de Google
sont conservés.

## Preuves à plusieurs fichiers

Une preuve porte désormais une liste de fichiers Drive, dans la table
`preuve_fichiers`, et non plus une seule référence. `mode_fichiers`
décide de ce qu'on attend d'elle :

| Mode | Ce qu'il change |
| --- | --- |
| `unique` | un seul fichier, le nouveau remplace l'ancien. C'est le mode par défaut et le comportement d'origine, inchangé |
| `multiple` | plusieurs fichiers, sans nombre cible |
| `par_stagiaire` | un fichier par stagiaire, le nombre attendu étant **calculé** |

En mode `par_stagiaire`, le nombre attendu vient des inscriptions de la
session rattachée, ou du groupe quand il est précisé. Il n'est jamais
saisi à la main. **Les abandons en sont exclus** : on n'attend pas
d'attestation pour quelqu'un qui a quitté la formation. Sans session
rattachée, le nombre reste inconnu et la preuve est tenue pour incomplète,
faute de pouvoir prouver le contraire.

L'écran Preuves affiche alors « 12/20 rattaché(s) » et un badge
**Incomplet** tant que le compte n'y est pas. Cet écart l'emporte sur le
statut saisi : une preuve marquée Maîtrisé mais incomplète compte comme
« à consolider » dans le tableau de bord, donc l'indicateur ne passe pas
au vert. C'est la colonne `statut_effectif` de la vue
`preuves_enrichies`, où se concentre tout ce calcul pour que les deux
écrans ne puissent pas diverger.

L'import n'a pas changé de logique : le rapprochement reste le même, son
résultat est simplement rangé dans `preuve_fichiers`. Un réimport ne
touche que les fichiers qu'un import avait posés, jamais ceux ajoutés à la
main, et jamais une preuve validée par l'admin.

> Les sessions, groupes et inscriptions sont encore vides : ils seront
> alimentés en Phase 2. D'ici là, le mode « par stagiaire » fonctionne
> mais n'a aucune session à laquelle se rattacher.

## Sessions, stagiaires et génération de documents (Phase 2)

### Formations versionnées

`formations` porte l'identité, `formation_versions` le contenu qui
évolue : programme, scénario pédagogique, compétences, durée par défaut.
Réviser une formation crée une **nouvelle version**. Une session retient
la version en vigueur au jour de sa création, donc réviser ne réécrit
jamais l'histoire des sessions déjà lancées, ni la durée imprimée sur
leurs documents.

Une session contient un ou plusieurs **groupes**. Un groupe est un lieu ou
une cohorte, avec son propre lieu et son propre formateur : deux groupes
d'une même session peuvent se tenir sur deux sites aux mêmes dates. Une
session sur un seul lieu n'a qu'un groupe.

Une session porte aussi un **horaire**, facultatif et en **texte libre**
(« 8h30–12h00 / 13h00–16h30 »). Il n'est volontairement pas modélisé en
journées, demi-journées ni créneaux d'émargement : cette structure viendra
avec le chantier présence et assiduité. D'ici là, son seul usage est d'être
imprimé sur les documents via `{{horaire}}`. Une session sans horaire reste
valide : le marqueur est alors remplacé par du vide, jamais imprimé tel quel.

Le prescripteur et l'état du dossier sont portés par l'**inscription**, pas
par la personne : ils peuvent différer d'une session à l'autre pour un
même stagiaire. Marquer un abandon date l'abandon et sort aussitôt le
stagiaire du décompte « un par stagiaire » des preuves.

### Marqueurs de documents

Un modèle est un Google Doc ou Sheet **existant** sur le Drive. La
génération en fait une copie et y remplace ces marqueurs. Le modèle
d'origine n'est jamais modifié.

| Marqueur | Valeur |
| --- | --- |
| `{{civilite}}` | « M. » ou « Mme », vide si non renseignée |
| `{{nom_stagiaire}}` | nom du stagiaire, portée stagiaire seulement |
| `{{prenom_stagiaire}}` | prénom du stagiaire, idem |
| `{{date_debut}}` | début de session, jj/mm/aaaa |
| `{{date_fin}}` | fin de session, jj/mm/aaaa |
| `{{date_attestation}}` | date portée sur l'attestation, identique à `{{date_fin}}` |
| `{{horaire}}` | horaire indiqué sur la session, texte libre |
| `{{duree}}` | durée prévue (déclarée) de la session — colonne `duree_heures_reelle` — à défaut celle de la version (`duree_heures_defaut`) |
| `{{intitule_formation}}` | intitulé de la formation |
| `{{lieu}}` | lieu du groupe, à défaut celui de la session |
| `{{formateur}}` | formateur du groupe, à défaut celui de la session |
| `{{nom_organisme}}` | variable d'environnement `ORGANISME_NOM` |

**N'ajoutez pas de marqueur sans l'inscrire ici et dans
`server/src/services/marqueurs.js`**, qui fait foi. Un marqueur inconnu
n'est pas remplacé et reste visible dans le document produit. Le test
`server/test/marqueurs.test.js` fige cette liste.

Un marqueur tiré du stagiaire exige aussi sa colonne dans la requête
`cibles()` de `services/documents.js` : une colonne oubliée là ressort
en marqueur vide, sans la moindre erreur. C'est ainsi que `{{civilite}}`
est passé inaperçu.

**Chaque génération contrôle le modèle** et signale les marqueurs qu'elle
n'y reconnaît pas, corps, tableaux, en-têtes et pieds de page compris. Le
message de fin les liste, plutôt qu'un succès silencieux. Deux réserves :
ce contrôle n'est pas fait sur les Google Sheets, qui demanderaient de
parcourir toutes les cellules de tous les onglets, et il ne bloque jamais
la production. S'il échoue, les documents sortent quand même et le
message dit que la vérification n'a pas pu être faite.

### Générer

Depuis l'écran d'une session : choisir un modèle, éventuellement un
groupe, puis « Générer les documents ». Une portée session ou groupe
produit un fichier ; une portée stagiaire produit une copie par stagiaire
inscrit, **abandons exclus**.

Les copies sont déposées dans
`/<DRIVE_RACINE>/<formation>/<référence et dates>/<groupe>/`, créé au
besoin. Chaque génération crée ou retrouve une preuve par indicateur
associé au modèle : en mode « un seul fichier » pour une portée session ou
groupe, en mode « un par stagiaire » sinon. Le comptage est celui de la
Phase 1bis, aucune logique nouvelle.

Regénérer ne duplique pas : les documents déjà produits pour le même
couple modèle / groupe / stagiaire sont mis à la corbeille et remplacés,
après confirmation explicite. Le serveur répond 409 tant que ce
remplacement n'est pas confirmé.

### Accès Drive en écriture

La génération exige le scope `drive.file`, qui n'autorise l'écriture que
sur les fichiers créés par l'application. L'application ne demande jamais
le scope `drive` complet, qui donnerait accès en écriture à tout le Drive.

> **Après ce déploiement, l'admin doit reconnecter le Drive**, comme lors
> de l'ajout du scope Sheets en Phase 1. L'écran d'accueil le signale, et
> toute tentative de génération répond « Reconnectez-le pour autoriser la
> création de documents ».

## Rôles : admin et contributeur

| Qui | Ce qu'il peut faire |
| --- | --- |
| **Admin** | tout : référentiel, preuves, formations, sessions, groupes, modèles, audits, connexion Drive |
| **Contributeur** | consulter tous les écrans, **plus** ajouter un stagiaire, gérer son inscription et son abandon, et générer des documents pour une session |

Un contributeur ne configure rien : ni formation, ni session, ni groupe,
ni modèle, ni référentiel, ni preuve, ni audit. Ces refus tiennent côté
**serveur** (`requireAdmin`), pas seulement par des boutons masqués : un
appel direct à ces routes en compte contributeur répond 403. Seules trois
routes passent sous `requireRedacteur` : l'ajout d'un stagiaire, la
modification d'une inscription, et la génération de documents.

Le rôle est attribué à la première connexion : `ADMIN_EMAILS` d'abord,
puis `CONTRIBUTEUR_EMAILS`, sinon l'accès est refusé. Une adresse
présente dans les deux listes devient admin. Ensuite, c'est la table
`utilisateurs` qui fait foi.

## Historique des audits

L'onglet **Audits** tient la mémoire de ce qui a été contrôlé : type
d'audit, date, organisme certificateur, auditeur, référentiel visé,
verdict, nombre de non-conformités majeures et mineures, liste des
non-conformités relevées, et rapport rattaché depuis le Drive.

La lecture est ouverte à tout compte connecté ; seul un admin enregistre
ou corrige un audit. Les non-conformités se saisissent **une par ligne**,
comme les compétences autrefois : le serveur découpe, retire les espaces
et ignore les lignes vides.

Les valeurs de `type` et `resultat` sont validées côté serveur avant
d'atteindre la base, dans `services/audits.js`, pour répondre 400 avec un
message lisible plutôt que de laisser une contrainte `CHECK` échouer en
500. Le `PATCH` est partiel : seules les clés envoyées sont modifiées.

Le rattachement du rapport réutilise la recherche Drive de l'écran
Preuves, désormais dans `client/src/RechercheDrive.jsx` : une seule
implémentation pour les deux écrans.

## Tableau de bord

Chaque indicateur porte un statut agrégé à partir de ses preuves :

| Statut | Règle |
| --- | --- |
| Maîtrisé (vert) | toutes ses preuves sont maîtrisées |
| À consolider (orange) | au moins une à consolider, aucune à risque |
| À risque (rouge) | au moins une à risque, **ou aucune preuve** |
| Non applicable (gris) | toutes ses preuves sont non applicables |

Les preuves non applicables sont neutres : elles ne dégradent pas un
indicateur qui porte par ailleurs des preuves valables. Le bandeau du haut
affiche le score global, du type « 12 indicateurs au vert sur 32 ».

## Schéma (migration 001)

- **Référentiel** : `referentiel_versions` (une seule active), `criteres`, `indicateurs`
- **Accès** : `utilisateurs` (admin / contributeur), `drive_connexions`
- **Formation** : `formations`, `sessions`, `groupes`, `stagiaires`,
  `inscriptions` (lien stagiaire ↔ session), `absences`, `resultats_qcm`, `satisfactions`
- **Conformité** : `preuves` (`type_alerte` : revision_periodique exige
  `periodicite_mois`, echeance_fixe exige `date_echeance`,
  rupture_reglementaire se rattache à une entrée de `veille`),
  `veille`, `veille_indicateurs`, `audits_history`

La migration 002 ajoute `imports_drive` et, sur `preuves`, les statuts de
conformité, la traçabilité de l'import et le drapeau « à confirmer ».
`type_alerte` y devient facultatif : les échéances ne sont pas alimentées
par l'import, elles feront l'objet d'une phase dédiée.

Toute évolution du schéma passe par un nouveau fichier `002_*.sql`, jamais par
la modification d'une migration déjà déployée.
