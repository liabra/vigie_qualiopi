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

## 7 quinquies. Lot L4 — sessions corrigeables et cycle de vie — TERMINÉ

Objectif : permettre à l'admin de **corriger** une session déjà créée et de suivre son **statut**,
sans jamais toucher aux documents déjà générés.

### État initial du champ `statut`

`sessions.statut` existait depuis la migration 001 (`text NOT NULL DEFAULT 'planifiee'` avec
`CHECK (statut IN ('planifiee','en_cours','terminee','annulee'))`) mais n'était **ni exposé ni
modifiable** : `GET /api/sessions` ne le renvoyait pas, `PATCH /api/sessions/:id` ne gérait que
l'horaire (héritage du lot « horaire »). Aucune migration n'a donc été nécessaire.

### Champs rendus modifiables

`PATCH /api/sessions/:id` (`requireAdmin`) accepte désormais :

- `reference`, `date_debut`, `date_fin`, `lieu`, `formateur`, `duree_heures_reelle`, `horaire`,
  `statut`.

### Règles métier retenues

- dates : format strict `AAAA-MM-JJ`, et `date_fin >= date_debut` (contre la date restée en base
  si une seule est envoyée) ;
- durée : nombre strictement positif, ou `null`/`""` pour l'effacer ;
- **si `date_debut`/`date_fin` changent réellement**, les absences des inscriptions de la session
  sont contrôlées : toute absence qui tomberait hors de la nouvelle période bloque la modification
  (**400** « Impossible : N absence(s) tomberaient hors des nouvelles dates… »), sans aucune
  écriture partielle ;
- **réduction de la durée prévue** : jamais bloquée (le calcul d'assiduité borne déjà le taux à
  0 %), mais si `total_heures_absence > nouvelle durée`, la réponse porte `absencesDepassentDuree:
  true` et `total_heures_absence`, et le client avertit explicitement ;
- référence : **facultative**, unique lorsqu'elle est renseignée (`reference text UNIQUE`, nullable) ;
  vide ou espaces ⇒ **NULL** (même normalisation qu'à la création), sinon rognée ; collision
  `23505` → **409** « Cette référence est déjà utilisée par une autre session » ;
- statut : strictement dans `planifiee|en_cours|terminee|annulee`, sinon **400** ;
- horaire : normalisé par `normaliserHoraire` (rogné, `NULL` si vide) — partagé avec la création ;
- corps vide ou sans champ reconnu → **400** « Rien à modifier » ;
- identifiant non numérique → **400**, session introuvable → **404**.

### Comportement face aux documents déjà générés

La modification **ne régénère jamais** un document. La route compare les champs **imprimés**
(`reference`, `date_debut`, `date_fin`, `lieu`, `formateur`, `duree_heures_reelle`, `horaire`)
à leur valeur en base (durée comparée numériquement : « 28 » = « 28.00 ») et renvoie
`documentsObsoletes`. Si des documents existent et qu'un de ces champs a réellement changé, le
client alerte « peuvent être obsolètes : régénérez-les si nécessaire » — aucune régénération
silencieuse, aucun moteur de version documentaire.

### Droits

- `PATCH /api/sessions/:id` : **requireAdmin** (401 anonyme, 403 contributeur) — vérifié en test et
  en navigateur ;
- `GET /api/sessions` (`requireAuth`) renvoie en plus `statut`, `lieu`, `horaire` pour la liste.

### UI

- liste des sessions : pilule de statut (Planifiée / En cours / Terminée / Annulée) + horaire + lieu ;
- détail : pilule de statut, avertissement d'incohérence **sans correction automatique** (session
  « planifiée » dont la fin est passée ; « terminée » dont le début est futur) ;
- bloc « Modifier la session » repliable, admin uniquement ; la liste se rafraîchit après l'enregistrement ;
- alertes : l'erreur globale de l'écran Sessions est **épinglée en haut de l'écran** (`.flash.sticky`,
  `position: sticky; top: 8px`) : elle reste visible quand on corrige une session plus bas dans la page.

### Tests

- `server/test/sessions.test.js` (27 tests HTTP, application Express réelle + base simulée) :
  champs modifiables, multi-champs, 400 (vide, dates, durée, statut, identifiant), 404, 409,
  401/403, `documentsObsoletes`, aucune écriture dans `generations`/`documents_generes`,
  **blocage des dates qui excluraient une absence**, signal `absencesDepassentDuree`,
  **référence vide/espaces ⇒ NULL, rognée sinon, session sans référence corrigeable, et
  non-régression de la création** ;
- `server/test/avertissements.test.js` (2 tests) : message client de dépassement de durée
  (`messageDepassementDuree` dans `client/src/messages.js`) ;
- `server/test/horaire.test.js` recentré sur la règle de normalisation (le contrat HTTP vit dans
  `sessions.test.js`) ;
- `npm test` : **221/221** (218 avant → +3).

### Limites restantes

1. Aucun contrôle croisé du statut au-delà de l'avertissement d'affichage : les dates peuvent être
   indicatives, le statut n'est jamais déduit ni corrigé automatiquement.
2. Le passage d'un statut à l'autre n'écrit pas d'historique (pas de table de journal des statuts).
3. L'alerte « documents obsolètes » repose sur le nombre de documents affichés dans le détail ;
   si l'utilisateur navigue hors du détail, l'alerte n'est pas rejouée.
4. L'avertissement « absences supérieures à la durée prévue » n'apparaît qu'au moment de
   l'enregistrement : il n'est pas rejoué si l'utilisateur reconsulte la session plus tard
   (le détail, lui, continue d'afficher le dépassement via le calcul d'assiduité).

### Production — TERMINÉ

- commit principal : `1b8054e` — « Sessions : permettre la correction et le suivi du statut » ;
- correctif final : `fee0376` — « Sessions : corriger la référence facultative et les alertes » ;
- tests au moment du déploiement : **221/221** ;
- déploiement Railway **SUCCESS**, `/api/health` **200** ;
- migration courante : **011_prescripteurs_configurables.sql** (aucune nouvelle migration) ;
- smoke tests production complets : **OK** (6/6 fonctionnalités, puis session sans référence
  modifiable et flash sticky visible) ;
- **lot L4 TERMINÉ.**

---

## 7 sexies. Lot L5 — assiduité et pièces EduSign — TERMINÉ

Objectif : permettre de produire les documents administratifs d'assiduité (feuille de présence,
attestation individuelle, récapitulatif d'absences) à partir des modèles Drive existants, et de
rattacher les exports EduSign sans jamais copier ni stocker de PDF, et sans double saisie.

### Ce qui existait déjà (audit)

- génération documentaire complète (L1/L2) : `modeles_documents` (portée formation/session/groupe/
  stagiaire), `generations`, `documents_generes`, dépôt dans `<racine>/<formation>/<dates>/<groupe>`,
  remplacement des marqueurs dans la COPIE (jamais le modèle), regénération avec remplacement ;
- preuves et pièces Drive (L1) : `preuves` (une par indicateur) + `preuve_fichiers` (plusieurs
  fichiers, `source` ∈ manuel/import_drive/generation) — le rattachement manuel d'un export EduSign
  existait donc déjà via `POST /api/preuves` et `POST /api/preuves/:id/fichiers` ;
- calcul d'assiduité (L2) : `calculerAssiduite` (taux borné 0 %, dépassement signalé, fiable ou non) ;
- marqueurs existants : civilite, nom/prenom, dates, horaire, duree, intitule, lieu, formateur,
  nom_organisme — mais **rien** pour l'assiduité ni pour l'email/téléphone/prescripteur/groupe.

### Architecture retenue — aucune migration

- la génération d'assiduité passe par les **modèles Drive existants** : aucun nouveau type de
  document codé en dur ; seuls les **marqueurs** et les **données chargées** manquaient ;
- le rattachement EduSign réutilise `preuves`/`preuve_fichiers` (`source = 'manuel'` = externe),
  avec un simple ajout : `POST /api/preuves` accepte désormais `session_id`/`groupe_id`, et
  `GET /api/preuves?session=…` filtre sur la session ;
- **aucun PDF stocké** (seul l'identifiant Drive est en base), **aucun fichier copié** par le
  rattachement.

### Documents couverts

1. **Feuille/liste de présence de session** — modèle de portée `session`, via les marqueurs de
   session + groupe ;
2. **Attestation individuelle de présence/assiduité** — modèle de portée `stagiaire`, via les
   marqueurs d'assiduité (`heures_absence`, `heures_suivies`, `taux_assiduite`) ;
3. **Récapitulatif des absences d'un stagiaire** — modèle de portée `stagiaire`, mêmes marqueurs.

Quand l'assiduité n'est pas fiable (abandon, durée inconnue), `heures_suivies` et `taux_assiduite`
restent **vides** dans le document : jamais un faux chiffre. `heures_absence` reste un fait.

### Marqueurs ajoutés (additifs, aucun ancien modifié)

`session_reference`, `session_statut`, `email`, `telephone`, `entreprise`, `financeur`,
`prescripteur`, `groupe`, `heures_absence`, `heures_suivies`, `taux_assiduite`.

### Rattachement EduSign (simple)

Dans le détail de session, bloc **« Documents / Assiduité »** en deux parties :

- **Documents générés par Vigie** (pilule « Généré par Vigie ») ;
- **Documents externes / EduSign** (pilule « EduSign / externe ») : liste des preuves de source
  manuelle rattachées à la session, et formulaire admin « Rattacher » (type suggéré, libellé,
  indicateur, **sélecteur Drive réutilisé `RechercheDrive`**). Aucun PDF copié ni stocké.

Côté serveur, `POST /api/preuves` vérifie :

- le **fichier Drive existe et est accessible** AVANT d'écrire : Drive non connecté/indisponible
  ⇒ **503** « Google Drive est indisponible ou non connecté… » ; fichier inconnu/inaccessible ⇒
  **400** ; jamais de pièce cassée ; nom/URL/MIME réels récupérés ;
- la **session** existe, le **groupe** existe, et le **groupe appartient bien à la session**
  fournie — 400 clair sinon.

### Droits

- ADMIN : générer (déjà), **rattacher** un document EduSign (nouveau formulaire) ;
- CONTRIBUTEUR : consulter les deux listes et générer (droit existant), **pas** de rattachement ;
- aucune nouvelle route administrative n'est ouverte au contributeur (`POST /api/preuves` reste
  `requireAdmin`).

### Tests

- `server/test/marqueurs.test.js` : liste des 23 marqueurs figée, valeurs d'assiduité,
  assiduité non fiable ⇒ vides, session_reference/statut sans invention ;
- `server/test/assiduiteDocuments.test.js` (nouveau) : `GET /api/indicateurs` (200/401),
  `GET /api/preuves?session` (filtre réel), `calculerAssiduite` réutilisé (contrat L2) ;
- `server/test/preuves.test.js` : rattachement EduSign à une session (session_id/groupe_id,
  source « manuel », aucune copie), **fichier Drive inexistant refusé / réel vérifié**,
  **session ou groupe invalides refusés, groupe d'une autre session refusé** ;
- `server/test/generationAssiduite.test.js` (nouveau) : `genererDocuments` avec client Google
  injecté — prouve que les valeurs d'assiduité arrivent dans le **payload exact** des requêtes de
  remplacement Google Docs (avec/sans absence) ;
- `npm test` : **234/234** (230 avant → +4).

### Limites restantes

1. La génération d'assiduité exige un **modèle Drive** existant + Drive connecté en écriture :
   le lot livre la capacité (marqueurs + données), pas les modèles eux-mêmes. Le test automatisé
   prouve le chemin jusqu'au **payload** de génération (pas une écriture Drive réelle, impossible
   hors production sans compte Google de test).
2. Le « type documentaire » EduSign est un libellé libre (titre de preuve), pas une colonne dédiée.
3. Le classement Drive des exports EduSign rattachés n'est pas automatisé (le fichier reste à son
   emplacement d'origine).

### Production — TERMINÉ

- commit : `65b70ef` — « Documents : structurer l'assiduité et les pièces EduSign » ;
- tests au moment du déploiement : **235/235** ;
- déploiement Railway **SUCCESS**, `/api/health` **200** ;
- migration courante : **011_prescripteurs_configurables.sql** (aucune nouvelle migration) ;
- smoke test production réel (Drive) : bloc Documents / Assiduité, recherche d'un vrai fichier
  EduSign, sélection sans ID technique, rattachement, affichage, lien vers l'original, aucune
  copie — **OK** ;
- génération Drive réelle non faite (aucun modèle d'assiduité utile encore disponible) — non
  bloquant : le chemin jusqu'au payload Google Docs est couvert par les tests automatisés ;
- **lot L5 TERMINÉ.**

---

## 7 septies. Lot L6 — référentiel versionné + veille Qualiopi — TERMINÉ (local)

Objectif : permettre de faire coexister plusieurs versions du référentiel Qualiopi (active /
future / historique) et d'exploiter la veille réglementaire — sans jamais toucher au cycle de
la veille existant ni inventer de contenu V10.

### Ce qui existait déjà (audit)

- table `referentiel_versions` déjà multi-versions : `code` UNIQUE, `est_active`, `date_publication`,
  `date_application`, `note` ; `criteres`/`indicateurs` liés par `version_id` ; le référentiel
  affiché (`GET /api/referentiel`) lit la version `est_active` ;
- table `veille` déjà créée en migration 001 (type, titre, source, url, dates, résumé,
  analyse_impact, rupture_reglementaire, statut `a_analyser|analysee|integree|sans_impact`) +
  table `veille_indicateurs` (liens N-N) + colonne `preuves.veille_id` (ON DELETE SET NULL) —
  mais **aucun écran ni route ne l'exploitaient** ;
- `seed.js` gère déjà l'activation transactionnelle et ne doit PAS devenir une API.

### Décisions produit

- **ne pas créer de contenu V10** : seul le libellé de la note existe (décret 2026-728) ; la
  préparation de version ne crée qu'une **coquille** (métadonnées), le contenu officiel viendra
  d'un import ultérieur ;
- **cycle de la veille et cycle de l'action sont SÉPARÉS** : on n'a jamais touché à
  `veille.statut` ; l'action vit dans ses propres colonnes ;
- **une version de référentiel vide ne peut pas devenir active** : garde métier bloquante
  (aucun critère OU aucun indicateur ⇒ activation refusée), voir Backend.

### Migration 012 — `012_veille_actions.sql` (additive, sans perte)

`ALTER TABLE veille` ajoute uniquement :

- `date_consultation date` ;
- `action text` ;
- `statut_action text NOT NULL DEFAULT 'aucune' CHECK (statut_action IN ('aucune','a_realiser','realisee'))` ;
- `action_realisee_le date`.

Aucune colonne retirée, aucune ligne réécrite, aucune contrainte existante levée.

### Backend (routes nouvelles, `server/src/routes/api.js`)

**Versions** (lecture `requireAuth`, écriture `requireAdmin`) :

- `GET /api/referentiel/versions` — liste classée `active` / `future` (date_application future) /
  `historique`, tri par date d'application décroissante ;
- `GET /api/referentiel/versions/:id` — détail (critères + indicateurs), lecture seule ;
- `POST /api/referentiel/versions` — coquille {code, libelle, dates, source, note}, 400 code vide,
  409 code dupliqué (23505) ;
- `POST /api/referentiel/versions/:id/activer` — activation **explicite et transactionnelle**
  (une seule active), 404 si inconnue, `avertissement` si la date d'application est future (non
  bloquant) ;
- **garde métier** : une version **sans aucun critère OU sans aucun indicateur** ne peut pas être
  activée — **409** « Impossible d'activer cette version : aucun critère ou indicateur n'a encore
  été importé. ». Vérifiée AVANT toute écriture : un refus ne désactive pas la version active.
  Aucune sur-validation (pas de nombre minimal de critères/indicateurs).

**Veille** (lecture `requireAuth`, écriture `requireAdmin`) :

- `GET /api/veille` — filtres `?type=&statut=&statut_action=&q=` (ILIKE titre), indicateurs liés
  agrégés en JSON ;
- `GET /api/veille/:id` — détail + indicateurs liés + preuves rattachées (avec fichiers) ;
- `POST /api/veille` — création (type par défaut `autre`, titre obligatoire), rattachement
  d'indicateurs validés (existence) ;
- `PATCH /api/veille/:id` — modification de tous les champs + remplacement des `indicateur_ids`
  (transactionnel) ;
- **cohérence du cycle d'action** : `statut_action='realisee'` ⇒ `action` non vide (400) ;
  `action_realisee_le` fourni (date non vide) ⇒ `statut_action='realisee'` (400 sinon) ; repasser
  de `realisee` à un autre statut retire d'office `action_realisee_le` ; **jamais** de date du
  jour auto-remplie ; dates strictement `AAAA-MM-JJ` ;
- `POST /api/preuves` accepte désormais `veille_id` (existence vérifiée ⇒ 400 sinon), en
  réutilisant **toute la vérification Drive existante** (Drive indisponible ⇒ 503, fichier
  inconnu ⇒ 400).

### UI

- nouvel onglet **« Veille »** (admin + contributeur) : `client/src/Veille.jsx` — liste filtrée,
  détail en lecture SOURCE → RÉSUMÉ → ANALYSE/IMPACT → ACTION → PREUVE, formulaire admin
  (création/édition), rattachement d'une preuve via `RechercheDrive` ;
- `client/src/Referentiel.jsx` : écran admin **« Versions »** (liste classée, bouton Activer,
  formulaire « Préparer une nouvelle version » en coquille) ;
- contributeur : **lecture seule** (aucun bouton d'écriture, backend `requireAdmin`).

### Droits

- ADMIN : créer/modifier la veille, rattacher une preuve, préparer/activer une version ;
- CONTRIBUTEUR : consulter veille et versions, **rien d'autre** ;
- aucune route d'écriture ouverte au contributeur ; `POST /api/preuves` reste `requireAdmin`.

### Tests

- `server/test/referentielVersions.test.js` (nouveau) : classification active/future/historique,
  coquille (code rogné, jamais active d'office), code vide 400, code dupliqué 409, activation
  transactionnelle (une seule active), activation future non bloquée mais signalée, **refus d'une
  coquille vide (0 critère OU 0 indicateur ⇒ 409) sans désactiver l'active**, version avec
  contenu activable, 404, droits admin/contributeur/anonyme ;
- `server/test/veille.test.js` (nouveau) : CRUD, filtres, détail + preuves, rattachement
  d'indicateurs (existence + remplacement), cohérence du cycle d'action (4 règles), date invalide,
  preuve Drive rattachée via `veille_id` (réutilise `setDriveFactory`), preuve sur veille inconnue
  400, droits ;
- non-régression L1–L5 : suite complète **267/267**.

### Limites restantes

1. Le contenu V10 (critères/indicateurs) n'existe pas encore : la coquille est prête, l'import
   officiel reste à faire (hors lot).
2. Le rattachement d'une preuve à une veille exige toujours un `indicateur_id` (contrainte
   existante de `preuves`) : une preuve de veille porte donc sur un indicateur précis.
3. Aucune « clôture » de veille dédiée : on passe par `statut`/`statut_action` (pas de suppression).

### Production — TERMINÉ

- commit : `7ae2f94` — « Referentiel : versionner et exploiter la veille Qualiopi » ;
- migration : **012_veille_actions.sql** (appliquée une seule fois, migration courante 012) ;
- tests au moment du déploiement : **267/267** ;
- déploiement Railway **SUCCESS**, `/api/health` **200** ;
- production lecture seule : V9 **seule version active**, 7 critères / 32 indicateurs intacts,
  aucune coquille V10 ni version de test introduite, `veille` à 0 ligne avant/après ;
- smoke test production : Référentiel / Versions OK, V9 active consultable OK, création réelle
  d'une veille OK, modification analyse / action / statuts OK, contributeur lecture seule OK ;
- droits backend vérifiés : contributeur (lecture versions + veille, écriture refusée 403),
  anonyme 401 ;
- garde métier validée : une version vide ne peut pas devenir active (409) ;
- **lot L6 TERMINÉ.**

---

## 7 octies. Lot L7 — évaluations / QCM / satisfaction — TERMINÉ (local)

Objectif : centraliser qu'une évaluation a eu lieu (qui, quand, quel type, quel résultat) et la
satisfaction, SANS construire de moteur de questionnaire. A2C utilise Google Forms / papier /
autres outils ; Vigie enregistre les résultats et les preuves.

### Audit initial

- tables `resultats_qcm` et `satisfactions` créées en migration 001, **jamais utilisées** par
  aucune route ni écran (tables dormantes) ;
- `resultats_qcm` : `inscription_id` NOT NULL (⇒ l'appartenance à la session est structurelle),
  `type` limité à 3 valeurs, `score`/`score_max` NOT NULL, pas de colonne résultat ni
  commentaire ;
- `satisfactions` : `session_id` NOT NULL, `inscription_id` **nullable ⇒ anonymat natif**,
  `note_globale` nullable, `note_max` DEFAULT 5, `reponses` jsonb ;
- aucun marqueur documentaire QCM/satisfaction, aucun import CSV de résultats.

### Migration 013 — `013_evaluations_qcm.sql` (assouplissement, sans perte)

- `type` : historiques conservés (`positionnement`, `intermediaire`, `evaluation_finale`) +
  `qcm`, `validation_etape`, `autre` ;
- `score` et `score_max` **nullables**, en PAIRES (les deux renseignés ou les deux NULL) ;
  règles conservées quand présents : score >= 0, score_max > 0, score <= score_max ;
- `resultat text NOT NULL DEFAULT 'non_determine'` CHECK (`valide`, `non_valide`,
  `non_determine`, `non_applicable`) — **jamais déduit** de score/seuil ;
- `commentaire text` ;
- lignes historiques : type et score conservés, `resultat` = `non_determine`, `commentaire`
  NULL — aucun recalcul ;
- `satisfactions` : aucune modification.

### Backend (`server/src/routes/gestion.js` + `services/evaluations.js`)

- `GET /sessions/:id/evaluations` (requireAuth) : liste + agrégation (total, validés, non
  validés, non déterminés, non applicables) ;
- `POST /sessions/:id/evaluations` (requireRedacteur) : création, inscription vérifiée dans la
  session, Drive vérifié (503/400), score en paire ;
- `PATCH /evaluations/:id` (requireRedacteur) : modification ;
- `POST /sessions/:id/evaluations/import-apercu` (requireRedacteur) : aperçu sans écriture ;
- `POST /sessions/:id/evaluations/import` (requireRedacteur) : confirmation transactionnelle ;
- `GET /sessions/:id/satisfactions` (requireAuth) : liste + agrégation (réponses, anonymes,
  moyenne uniquement si note_max homogène) ;
- `POST /sessions/:id/satisfactions` (requireRedacteur) : nominative (inscription) ou anonyme
  (inscription NULL) ;
- `PATCH /satisfactions/:id` (requireRedacteur) ;
- `GET /drive/recherche` reste **`requireAdmin`** : la recherche est GLOBALE sur le compte
  Drive connecté (aucun dossier racine fiable ne permet un périmètre Vigie) — le contributeur
  n'y a PAS accès ;
- le rattachement Drive d'une évaluation/satisfaction est réservé à l'**admin** (403 pour un
  contributeur, `drive_file_id` refusé côté serveur).

### Cohérence des données (serveur)

- seuil de réussite : `>= 0` si renseigné, `<= score_max` si `score_max` renseigné, et
  **interdit** sans `score_max` (jamais de seuil orphelin) ;
- `resultat` jamais déduit du seuil ;
- **`date_passage` bornée à la session** (bornes INCLUSES) : `date < date_debut` ou
  `date > date_fin` ⇒ 400 ; la correction des dates d'une session est BLOQUÉE si une évaluation
  (ou une absence) tomberait hors des nouvelles dates — message combinant les deux compteurs ;
- les **satisfactions ne sont PAS bornées** par la session (une `a_froid` peut être recueillie
  après la date de fin).
- satisfaction : `note_globale >= 0`, `note_max > 0`, `note_globale <= note_max` — la dernière
  règle est appliquée par l'API (le SQL n'impose que `note_globale >= 0` et `note_max > 0`).

### Import CSV

Réutilise le parseur L3 (`parserCsv`, `normaliserEmail`, `validerEmail`, `normaliser`) + un
mapping tolérant dédié (`construireMappingResultats`). Rapprochement **par email uniquement**
(normalisé, unique) : inconnu ⇒ invalide, partagé ⇒ à vérifier, jamais de fusion sur nom/prénom.
Doublon exact (inscription + type + intitulé + date) signalé, jamais fusionné. Pourcentage seul
normalisé en `score/100`, affiché dans l'aperçu avant confirmation. **Ligne hors période de
session ⇒ invalide** (revalidée côté serveur à la confirmation, transactionnelle).

### UI

Bloc **« Évaluations & satisfaction »** dans le détail de session (`client/src/Evaluations.jsx`) :
liste compacte, agrégations, ajout/modification, import CSV (aperçu → confirmation), rattachement
d'un fichier Drive via `RechercheDrive` **réservé à l'admin** (masqué pour le contributeur).
Aucun moteur de questionnaire.

### Droits

- ADMIN et CONTRIBUTEUR : consulter, ajouter/modifier, importer ;
- **rattacher un fichier Drive : ADMIN uniquement** (la recherche Drive étant globale et
  admin-only, le contributeur n'a pas de sélecteur) ;
- le contributeur n'obtient **aucun** droit admin (connexion/statut/déconnexion Drive,
  référentiel, modèles restent `requireAdmin`) ;
- anonyme : 401.

### Tests

- `server/test/evaluations.test.js` (nouveau) : création avec/sans score, types historiques et
  nouveaux, résultat valide/invalide, score négatif, max invalide, score > max, paire
  incohérente, **seuil négatif / > max / sans max / valide**, plusieurs évaluations par
  stagiaire, stagiaire d'une autre session refusé, satisfaction nominative/anonyme, note
  invalide, agrégations homogène/hétérogène, Drive valide/inconnu/indisponible, **recherche
  Drive réservée à l'admin, contributeur sans Drive (status/disconnect/attach 403)**, droits ;
- `server/test/importResultats.test.js` (nouveau) : aperçu sans écriture, email exact/inconnu/
  ambigu, doublon fichier, pourcentage → score/100 affiché, confirmation transactionnelle,
  rollback, **lignes hors période invalides** ;
- test migration 013 sur base avec ligne historique (harnais embarqué) : ligne conservée,
  `resultat` = non_determine, `commentaire` NULL, nouveaux types acceptés, règles de score,
  satisfactions intactes ;
- `sessions.test.js` : la correction des dates d'une session bloque si une évaluation tomberait
  hors période (message combinant absences + évaluations, aucune écriture) ;
- non-régression L1–L6 : suite complète **318/318**.

### Limites restantes

1. `resultats_qcm.drive_file_id` reste un identifiant unique (pas le système `preuve_fichiers`
   multi-fichiers) : le rattachement à une preuve Qualiopi globale est volontairement laissé
   pour plus tard ;
2. la recherche Drive est GLOBALE et admin-only : aucun dossier racine fiable n'existe encore
   pour la limiter à un périmètre Vigie, donc le contributeur n'a pas de sélecteur Drive ;
3. pas de moyenne globale inter-évaluations (seules les évaluations homogènes se moyennent) ;
4. pas de marqueurs documentaires QCM/satisfaction (ambigu quand un stagiaire a plusieurs
   évaluations) ;
5. l'UX du formulaire est brute : refonte visuelle dans un chantier UX/UI ultérieur.

### Production — TERMINÉ

- migration : **013_evaluations_qcm.sql** (appliquée une seule fois, migration courante 013) ;
- commit principal : `a0ee566` — « Evaluations : suivre les QCM et la satisfaction » ;
- correctif dates : `cc438e1` — « Evaluations : contrôler les dates de session » (période des
  évaluations, protection du PATCH session, revalidation import) ;
- tests finaux : **318/318** ;
- déploiements Railway **SUCCESS** (a0ee566 puis cc438e1), `/api/health` **200** ;
- production lecture seule : les 2 évaluations du smoke test étaient hors période
  (`date_passage` 2026-09-24 < `date_debut` 2026-09-28), non corrigées en base, puis corrigées
  depuis l'interface après déploiement du correctif ;
- smoke test final utilisateur : correction des QCM vers une date valide OK, tentative de date
  hors session refusée, satisfaction à froid après session OK ;
- **lot L7 TERMINÉ.**

---

## 7 nonies. Lot L8 — robustesse HTTP / identifiants / erreurs — TERMINÉ (déployé)

Objectif : uniformiser la gestion des identifiants et des erreurs HTTP. Aucune fonctionnalité
nouvelle, aucune migration. C'est un durcissement transversal de l'API.

### Audit initial — incohérences relevées

- les identifiants de chemin étaient lus via un helper local tolérant (`Number(valeur)` ou
  `parseInt`) : `abc` ⇒ `NaN` ⇒ 404/400 selon la route, `1abc` ⇒ `1` (silencieusement), `1.5`
  ⇒ parfois accepté, `0` / `-1` non rejetés systématiquement — incohérent entre les routes ;
- sur une donnée invalide, PostgreSQL pouvait renvoyer `22P02` (invalid_text_representation)
  et l'ancien handler renvoyait **500** avec un message générique ;
- les erreurs SQL (`23505` unique, `23503` FK, `23514` CHECK, `23502` NOT NULL, `22P02`
  invalid_text, `22003` numeric out of range) n'étaient pas toutes traduites ;
- le handler d'erreur final lisait `config` uniquement pour choisir un message prod/dev
  (supprimé : plus aucun détail interne, jamais de stack/requête exposés) ;
- quelques routes ne validaient pas leur `:id` avant la requête SQL (d'où un risque de 500).

### Helper central — `server/src/services/ids.js`

`parseIdPositif(valeur)` : accepte uniquement un entier **strictement positif** (chaîne
`/^\d+$/` ou nombre entier sûr > 0), sinon `null`. Rejette : `abc`, `1abc`, `1.5`, `0`, `-1`,
`""`, espaces, `1e2`, `0x10`, `12.0`, `NaN`, `Infinity`, nombres non entiers.

### Convention retenue

| Situation | Statut |
| --- | --- |
| non authentifié | **401** |
| authentifié mais rôle insuffisant | **403** |
| ID mal formé / corps vide / JSON mal formé / date invalide / relation invalide | **400** |
| ID valide mais ressource absente | **404** |
| conflit réel (référence unique, version déjà active…) | **409** |
| imprévu uniquement | **500** |

Ordre des gardes : **auth → authz → validation** (une route admin répond 403 avant de
révéler l'existence d'une ressource). Un ID invalide est refusé **avant** tout accès base.

### Routes corrigées

- `api.js` : `GET /referentiel/versions/:id`, `POST /referentiel/versions/:id/activer`,
  `PATCH /indicateurs/:id/non-applicable`, `GET/PATCH/DELETE /preuves/:id`,
  `POST /preuves/:id/fichiers`, `DELETE /preuves/:id/fichiers/:fichierId` (les deux ids),
  `PATCH /audits/:id`, `GET/PATCH /veille/:id`, les paramètres de requête `?indicateur=` /
  `?session=` de `GET /preuves`, et les identifiants de CORPS (`indicateur_id(s)`,
  `session_id`, `groupe_id`, `veille_id`, `stagiaire_id`, `periodicite_mois`) de
  `POST /preuves` et `PATCH /preuves` ;
- `gestion.js` : `PUT /formations/:id`, `GET /formations/:id/versions`, `GET /sessions/:id`,
  `POST /sessions/:id/groupes`, `POST /sessions/:id/stagiaires`, `DELETE /modeles/:id` — plus
  les identifiants de CORPS (`formation_id`, `stagiaire_id`, `groupe_id` de l'inscription,
  `modele_id`/`session_id`/`groupe_id` de la génération) et les champs numériques exposés
  (`duree_heures_reelle`, `duree_heures_defaut`, `tarif_ht`, dates de session) désormais
  validés AVANT l'écriture ;
- le helper local `identifiant` de `gestion.js` délègue à `parseIdPositif` (tous les appels
  existants sont donc couverts).

### Erreurs SQL traduites (handler global, `server/src/app.js`)

Une SEULE erreur SQL est traduite GLOBALEMENT : **`23505` (violation d'unicité) ⇒ 409
« existe déjà »**. Justification : toutes les contraintes UNIQUE de Vigie portent sur une clé
MÉTIER saisie par l'utilisateur (email, code interne, référence, nom de groupe, code de
version, couple preuve×fichier, modèle×portée…) — une violation d'unicité est donc TOUJOURS
un conflit de données, jamais un bug serveur.

Toutes les AUTRES erreurs SQL sont retirées du mapping global et tombent en **500 générique
« Erreur serveur. »** :

- `23503` FK : les routes la traduisent explicitement là où elle est issue d'un identifiant
  fourni (preuves, groupes) ; une FK non interceptée est inattendue ;
- `23514` CHECK, `23502` NOT NULL, `22P02` conversion, `22003` hors limites : elles peuvent
  provenir d'un bug de programmation (champ oublié, validation défaillante, valeur fabriquée
  par le serveur) — on ne les présente JAMAIS comme une erreur utilisateur. Les routes
  valident la saisie en amont pour qu'une erreur utilisateur réponde 400 au bon endroit.

**Aucun détail SQL, stack, chaîne de connexion ni message interne ne fuit vers le client**
(le détail est journalisé côté serveur uniquement).

### Corps de requête

- corps JSON mal formé ⇒ 400 sans détail interne (géré par `express.json`, intercepté par le
  handler final) ;
- **exception documentée** : `express.json()` analyse le corps AVANT tout middleware d'auth —
  un JSON mal formé répond donc **400 même anonyme** (le parseur global refuse avant
  l'authentification). Aucune ressource ni information sensible n'est exposée ;
- corps absent / non-objet : couvert par les gardes existantes (`req.body || {}`) — pas de
  réimplémentation de body-parser ;
- PATCH : corps vide ⇒ **400 « Rien à modifier. »** ; champs inconnus **ignorés** (extraction
  en liste blanche) ; si seuls des champs inconnus sont fournis ⇒ 400 « Rien à modifier. » ;
- aucune écriture partielle non transactionnelle : chaque PATCH valide puis exécute un unique
  `UPDATE … RETURNING` (les gardes métier L7 — période de session, seuils — s'exécutent avant).

### Tests

- `server/test/idsErreurs.test.js` : unitaire de `parseIdPositif` ; matrice 400 sur IDs mal
  formés (`abc`/`0`/`-1`/`1.5`) pour sessions, inscriptions, absences, évaluations,
  satisfactions, preuves, veille, versions — avec une fausse base qui **refuse toute requête**
  (preuve que les 400 ne touchent pas la base) ; 404 sur ID valide inexistant (fausse base
  vide) ; PATCH corps vide / champs inconnus ⇒ 400 ; anonyme 401, contributeur 403 sur route
  admin ; `23505` ⇒ 409 ; **erreurs SQL inattendues (`23503`/`23514`/`23502`/`22P02`/`22003`)
  ⇒ 500 générique** dont le corps est exactement `{ error: "Erreur serveur." }` (aucun code
  SQL, ni `detail`, ni stack, ni requête) ; JSON mal formé ⇒ 400 sans fuite (authentifié ET
  anonyme) ;
- non-régression L1–L7 : suite complète **328/328**.

### Limites restantes

1. Le PATCH avec champs **connus + inconnus** applique les champs connus et ignore
   silencieusement les inconnus (convention historique du projet, documentée ici ; pas de rejet
   explicite) ;
2. `PATCH /preuves/:id` valide le corps (400 « Rien à modifier. ») avant la recherche
   d'existence : un ID inexistant avec corps vide répond donc 400, pas 404 (comportement
   documenté, cohérent avec les autres PATCH) ;
3. l'audit transversal n'a pas prétendu couvrir chaque route du référentiel : les routes non
   citées n'avaient pas de paramètre `:id` exposé ;
4. les dates d'échéance des preuves (`date_echeance`, `date_derniere_revision`) ne sont pas
   encore validées en format : une saisie illisible y produisait déjà un 500 avant ce lot
   (code PostgreSQL 22007, non concerné par ce durcissement) — reste à traiter plus tard.

### Production — TERMINÉ

- **aucune migration** (durcissement sans schéma) ;
- commit : `32eca1b` — « API : fiabiliser les identifiants et erreurs HTTP » (poussé avec
  `d18397c` « Documentation : valider le lot evaluations ») ;
- tests : **328/328** ; build client OK ; `git diff --check` OK ;
- déploiement Railway **SUCCESS** (commitHash `32eca1bbd…`), `/api/health` **200** ;
- migration courante inchangée : **013_evaluations_qcm.sql** (13 migrations 001→013, aucune
  nouvelle) ;
- contrôles production lecture seule : IDs invalides ⇒ 400, ID valide absent ⇒ 404, anonyme
  ⇒ 401, JSON mal formé ⇒ 400 sans fuite, admin 200 sur sessions/référentiel/évaluations/
  satisfactions ; 403 contributeur non testable en prod (aucun compte contributeur) ;
- données métier inchangées (aucune écriture) ;
- **lot L8 TERMINÉ.**

---

## 7 decies. Lot L9 — robustesse de la génération Drive / Docs — TERMINÉ (déployé)

Objectif : fiabiliser le moteur EXISTANT de génération de documents Google Docs /
Drive, sans le reconstruire et sans refonte UX. Aucune migration.

### Audit initial — ordre réel d'une génération

1. la route `POST /generations` valide `modele_id` / `session_id` / `groupe_id` ;
2. `genererDocuments` charge le modèle (`modeles_documents WHERE actif`) ;
3. charge le contexte (session + groupe éventuel) et les cibles (stagiaires) ;
4. lit les documents déjà générés (409 si existants et non « remplacer ») ;
5. crée/trouve les dossiers Drive, copie le modèle puis remplace les marqueurs ;
6. écrit en base (générations, preuves, pièces jointes, documents_generes) ;
7. renvoie le résumé.

Points de panne identifiés : fichier Drive sans ligne DB, ligne DB sans fichier,
document partiellement rempli, doublon, génération annoncée réussie à tort.

### Décision — aucune migration

Le schéma (`generations` sans statut/erreur, `documents_generes` sans historique)
suffit : une génération ÉCHOUÉE n'écrit aucune ligne (l'INSERT vient en dernier),
les échecs sont journalisés côté serveur. Les deux besoins non couverts sont
DOCUMENTÉS comme limites (pas de blocage de robustesse) : pas de table d'historique
des documents (le lien Drive de l'ancien document est remplacé en base, l'ancien
fichier n'est que mis à la corbeille), pas d'audit des générations échouées.

### Comportements ajoutés

- **modèle vérifié sur Drive AVANT toute copie** (`files.get`) : absent / en
  corbeille ⇒ 400 clair, inaccessible ⇒ 400, ni Doc ni Sheet ⇒ 400 ;
- **Drive non connecté ⇒ 503**, lecture seule ⇒ 400 (convention des preuves) ;
- **erreurs Google** : traduites en message métier sûr (400/503), sans token ni
  détail (diagnostic complet masqué journalisé côté serveur uniquement) ;
- **marqueurs inconnus** détectés sur le modèle (déjà présent) ET **marqueurs non
  résolus** détectés par RELECTURE de chaque copie Doc après remplacement ;
- **double clic** : bouton désactivé (UI, déjà présent) + garde serveur en mémoire
  (une génération à la fois par modèle/session/groupe) ⇒ 409 ;
- **cohérence Drive/DB** : si la copie ou le remplacement échoue, la copie est mise
  à la corbeille (best-effort) ; si la DB échoue après les copies, toutes les
  copies sont mises à la corbeille (best-effort), l'erreur d'origine est conservée ;
- **nommage** : nom de fichier assaini (`nomSain`), jamais vide ni séparateur de
  chemin ;
- **régénération — ordre sûr** : nouveau Drive → Docs → DB (COMMIT) → PUIS
  ancien fichier à la corbeille. L'ancien reste INTACT tant que la base n'a pas
  confirmé le remplacement ; un échec d'archivage de l'ancien NE remet PAS en
  cause la génération (journalisé + `anciensNonArchives` renvoyé) ; `remplace_le`
  horodate le remplacement (l'ancien lien DB est remplacé, documenté comme limite).

### Droits

Inchangés : modèles = `requireAdmin` ; génération = `requireRedacteur` (admin +
contributeur) ; Drive = `requireAdmin`. Le contributeur ne gagne aucun accès Drive.

### Tests

- `generationRobuste.test.js` (nouveau, 14 tests) : modèle inexistant / introuvable
  (404) / inaccessible (403) / trashed / non Doc-Sheet ; groupe d'une autre session ;
  Drive absent ⇒ 503, lecture seule ⇒ 400 ; marqueur inconnu remonté, marqueur non
  résolu remonté ; échec de copie ⇒ 400 sans écriture, échec batchUpdate ⇒ copie à
  la corbeille sans écriture, échec DB ⇒ 500 sans fuite + copie à la corbeille ;
  deux générations simultanées ⇒ 409 ; régénération ⇒ nouveau créé, DB écrite,
  ancien trashé SEULEMENT après le commit ; régénération DB échoue ⇒ ancien intact
  + nouveau trashé + erreur conservée ; trash ancien échoue après DB ⇒ génération
  réussie + `anciensNonArchives` signalé ; contributeur 200, anonyme 401 ;
- `documents.test.js` : relecture post-remplacement des copies Doc (compteurs
  modèle/copie séparés) ;
- non-régression L1–L8 : suite complète **344/344**.

### Limites impossibles à rendre atomiques (Drive ↔ PostgreSQL)

1. l'ordre réel est « Drive d'abord, base ensuite » : si la base échoue APRÈS les
   copies, le nettoyage est best-effort — un fichier peut rester orphelin (mis à la
   corbeille si l'appel réussit, sinon signalé en log) ;
2. l'archivage de l'ancien fichier est fait APRÈS le commit DB, en best-effort :
   s'il échoue, la base pointe déjà vers le nouveau document et l'ancien reste dans
   le Drive (récupérable) — signalé par `anciensNonArchives`, sans rollback ;
3. la garde anti double clic est en MÉMOIRE (portée processus) : elle protège le
   double clic / retry sur l'instance courante, mais NE garantit PAS l'idempotence
   multi-instance ; la contrainte UNIQUE de `documents_generes` empêche néanmoins
   deux lignes divergentes (le dernier `ON CONFLICT DO UPDATE` l'emporte), mais deux
   instances parallèles peuvent chacune créer un fichier Drive et laisser un
   orphelin — dette technique documentée ;
4. l'ancien lien Drive d'un document régénéré n'est pas conservé en base (pas de
   table d'historique) — l'ancien fichier reste consultable dans la corbeille Drive.

### Production — TERMINÉ

- **aucune migration** ;
- commit : `39ac114` — « Documents : fiabiliser la génération Drive et Docs »
  (poussé avec `90acd03` « Documentation : valider le lot robustesse API ») ;
- tests : **344/344** ; build client OK ; `git diff --check` OK ;
- déploiement Railway **SUCCESS** (commitHash `39ac114…`), `/api/health` **200** ;
- migration courante inchangée : **013_evaluations_qcm.sql** (13 migrations, aucune nouvelle) ;
- production lecture seule (aucune écriture) : `modeles_documents` 2, `generations` 4,
  `documents_generes` 6, `preuve_fichiers source='generation'` 6 ; sessions/inscriptions/
  resultats_qcm/satisfactions intactes ;
- aucun test destructif Google en production (aucun document généré, aucun modèle
  temporaire, aucun fichier déplacé/trashé) ;
- **lot L9 TERMINÉ.**

---

## 7 undecies. Lot L10 — droits / données personnelles / sécurité applicative — TERMINÉ (déployé)

Objectif : auditer et durcir Vigie SANS changer son modèle fonctionnel (pas de refonte
auth, pas d'ACL par session, pas de nouvelle fonction). Aucune migration.

### Matrice de droits (résumé)

- **public** : `GET /health`, `GET /me` (état de session + booléen Google, rien d'autre),
  `/auth/google/*`, `POST /auth/logout` ;
- **requireAuth** (admin + contributeur, lecture) : référentiel/versions, indicateurs,
  preuves (liste + détail), sessions (liste + détail), formations (liste + versions),
  absences (lecture), prescripteurs, modèles (lecture), audits (lecture), veille (lecture),
  évaluations/satisfactions (lecture) ;
- **requireRedacteur** (admin + contributeur, saisie pédagogique) : stagiaires/inscriptions,
  absences (ajout/modif/suppression), fiche stagiaire, import CSV stagiaires/résultats,
  évaluations/satisfactions (écriture), génération de documents ;
- **requireAdmin** : tout le reste (formations/sessions/groupes en écriture, preuves,
  référentiel, veille en écriture, modèles, prescripteurs en écriture, audits, import
  classeur, Drive connexion/recherche/statut/déconnexion).

### Incohérences trouvées et corrigées

1. `GET /me` renvoyait `driveAccountEmail` (adresse interne du compte Drive) à TOUT
   visiteur, anonyme compris, alors que le client ne l'utilise pas (l'admin la voit déjà
   via `GET /drive/status`, admin-only) — **corrigé** : `driveAccountEmail` retiré de `/me`.
2. En-têtes de sécurité absents (`X-Content-Type-Options`, `Referrer-Policy`,
   `X-Frame-Options`) — **corrigé** : ajoutés en middleware, sans dépendance (helmet non
   introduit pour ne pas toucher Vite/OAuth/Google). `x-powered-by` était déjà désactivé.

### Vérifié conforme (aucun changement nécessaire)

- **mass assignment** : aucune route ne passe `req.body` en spread ni ne construit du SQL
  depuis des clés reçues ; tous les écritures passent par des listes blanches explicites
  (`champsAudit`, `champsVeille`, `champsEvaluation`, `champsSatisfaction`, `CHAMPS_VERSION`,
  appels `set(...)` colonne par colonne) — `role`, `created_by`, `created_at`, `est_active`
  et IDs internes ne sont jamais injectables ;
- **IDOR / cohérences relationnelles** : groupe↔session, inscription↔session,
  absence↔inscription/session, évaluation/satisfaction↔session, preuve↔session/groupe,
  génération↔portée/session/groupe, fichier↔preuve — toutes vérifiées côté serveur (déjà en
  place depuis L2→L9). Pas d'ACL par session (modèle à deux rôles globaux, assumé) ;
- **données personnelles** : nom/prénom/email/téléphone/entreprise/financeur/
  situation_handicap/besoins_adaptation exposées par `GET /sessions/:id` aux rôles
  authentifiés (pédagogique, assumé) ; pas de `SELECT *` exposant des colonnes inutiles ;
- **handicap/adaptation** : présents uniquement dans le détail de session et la fiche
  stagiaire (authentifié), jamais en log, jamais en message d'erreur, jamais injectés dans
  les documents (aucun marqueur `{{situation_handicap}}`/`{{besoins_adaptation}}`) ;
- **logs** : aucun token/cookie/secret/PII — les diagnostics Google masquent les champs
  sensibles (`nettoyer`), les erreurs SQL ne journalisent que le message (jamais de payload) ;
- **secrets** : `.env` gitignoré, aucun secret dans l'historique Git (`.env.example` = placeholders
  uniquement) ; `SESSION_SECRET`/`GOOGLE_CLIENT_SECRET`/`DATABASE_URL` via variables Railway ;
- **session/cookie** : HttpOnly, Secure en prod, SameSite=Lax, signature HMAC, logout,
  expiration — un cookie falsifié/expiré ⇒ 401 (jamais 500) ;
- **CSRF** : SameSite=Lax + corps JSON sur les écritures + `state` anti-CSRF OAuth ⇒ risque
  borné, pas de bibliothèque ajoutée ;
- **OAuth** : connexion admin-only via `ADMIN_EMAILS`, `state` vérifié, scopes limités,
  aucun token renvoyé au frontend ni journalisé ;
- **Drive** : recherche globale admin-only, `drive_file_id` (évaluation/satisfaction)
  admin-only, aucune élévation via body ;
- **suppressions** : modèles/prescripteurs en soft-delete (actif=false), preuves/fichiers
  en DELETE réel (cascade `preuve_fichiers` attendue, fichiers Drive non touchés) ;
- **frontend** : aucun secret/token en localStorage/sessionStorage/bundle/URL.

### Tests

- `securite.test.js` (nouveau, 7 tests) : `/me` sans adresse interne ; en-têtes de sécurité ;
  cookie falsifié ⇒ 401, expiré ⇒ 401 ; mass assignment (role/id/created_at non appliqués sur
  PATCH stagiaire, created_by/stagiaire_id non appliqués sur PATCH inscription) ; recherche
  Drive ⇒ 403 contributeur ;
- non-régression L1–L9 : suite complète **351/351**.

### Limites restantes

1. pas d'ACL par session (deux rôles globaux) : un contributeur voit TOUTES les sessions —
   assumé, pas un cloisonnement prévu ;
2. pas de CSP, pas de rotation automatique de secrets, pas d'audit de sécurité tiers —
   hors périmètre L10 (durcissement adapté à la taille de l'outil) ;
3. `Referrer-Policy: no-referrer` peut légèrement dégrader les statistiques de provenance —
   sans conséquence fonctionnelle.

### Production — TERMINÉ

- **aucune migration** ;
- commit : `597bc15` — « Securite : durcir les droits et donnees personnelles »
  (poussé avec `80de531` « Documentation : valider le lot generation documentaire ») ;
- tests : **351/351** ; build client OK ; `git diff --check` OK ;
- déploiement Railway **SUCCESS** (commitHash `597bc15…`), `/api/health` **200** ;
- migration courante inchangée : **013_evaluations_qcm.sql** ;
- en-têtes production : `X-Powered-By` absent, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` ;
- `/api/me` sans `driveAccountEmail` (anonyme et admin) ; cookies invalides/expirés ⇒ 401 ;
- aucun secret/token/PII sensible dans les logs récents ; données métier inchangées ;
- **lot L10 TERMINÉ.**

---


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

**Mise à jour 23/09/2026 (lot L5, §7 sexies)** : le rattachement d'un export EduSign à une session
est désormais **direct** (bloc « Documents / Assiduité » du détail de session), et les marqueurs
d'assiduité permettent de générer les documents de présence/attestation depuis les modèles Drive.
Le **modèle d'émargement** et le **classement Drive** restent les seuls points non tranchés ; la
signature et l'horodatage restent **entièrement délégués à EduSign**.

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
