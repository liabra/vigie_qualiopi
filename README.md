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
- **Connecter le Drive** (bouton admin, scope `drive.readonly`) : n'est
  accepté que pour `DRIVE_ACCOUNT_EMAIL`. Le refresh_token est stocké dans
  `drive_connexions` et rafraîchi automatiquement.

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
