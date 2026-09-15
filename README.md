# Vigie Qualiopi — Phase 0 (fondations)

Suivi de la conformité au Référentiel national qualité (Qualiopi).
Même architecture que Vigie : front **React + Vite**, serveur **Express**,
base **PostgreSQL**, déploiement **Railway**.

Cette phase ne contient que les fondations : schéma de base, référentiel V9
en base, connexion Google, accès Drive en lecture seule, et un écran qui
liste les 32 indicateurs par critère. Pas de statut, pas de preuve affichée,
pas de génération de documents, pas d'IA.

## Structure

```
client/                 React + Vite (écran de connexion, référentiel)
server/
  src/index.js          démarrage : config → migrations → seed si base vide → HTTP
  src/app.js            Express : /auth, /api, puis le build du client
  src/session.js        cookies signés HMAC, requireAuth / requireAdmin
  src/services/google.js OAuth Google + Drive (lecture seule)
  src/routes/           auth.js (OAuth), api.js (me, referentiel, drive, health)
  db/migrations/        NNN_*.sql, appliqués une fois chacun (schema_migrations)
  db/seeds/             referentiel_v9.json
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
| `npm run db:seed` | réimporte `referentiel_v9.json` |
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
- **Connecter le Drive** (bouton admin, scope `drive.readonly`) : n'est
  accepté que pour `DRIVE_ACCOUNT_EMAIL`. Le refresh_token est stocké dans
  `drive_connexions` et rafraîchi automatiquement.

## Référentiel

`server/db/seeds/referentiel_v9.json` contient les 7 critères et les 32
indicateurs avec les libellés du décret n° 2019-564. Ils sont marqués
**provisoires** (`texte_source_verifie = false`) jusqu'à l'import du guide de
lecture V9 officiel, qui renseignera aussi niveau attendu, éléments de preuve,
obligations spécifiques, applicabilité aux nouveaux entrants et possibilité de
non-conformité mineure.

Pour importer le texte officiel : compléter le JSON (ou en fournir un autre),
passer `texte_source_verifie` à `true` sur chaque indicateur relu, puis
`npm run db:seed`. Le seed ne réécrit jamais une ligne déjà vérifiée.

## Schéma (migration 001)

- **Référentiel** : `referentiel_versions` (une seule active), `criteres`, `indicateurs`
- **Accès** : `utilisateurs` (admin / contributeur), `drive_connexions`
- **Formation** : `formations`, `sessions`, `groupes`, `stagiaires`,
  `inscriptions` (lien stagiaire ↔ session), `absences`, `resultats_qcm`, `satisfactions`
- **Conformité** : `preuves` (`type_alerte` : revision_periodique exige
  `periodicite_mois`, echeance_fixe exige `date_echeance`,
  rupture_reglementaire se rattache à une entrée de `veille`),
  `veille`, `veille_indicateurs`, `audits_history`

Toute évolution du schéma passe par un nouveau fichier `002_*.sql`, jamais par
la modification d'une migration déjà déployée.
