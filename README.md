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
- **Connecter le Drive** (bouton admin, scopes `drive.readonly` et
  `spreadsheets.readonly`) : n'est accepté que pour `DRIVE_ACCOUNT_EMAIL`.
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
