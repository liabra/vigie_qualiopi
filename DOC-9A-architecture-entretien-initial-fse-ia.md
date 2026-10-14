# DOC-9A bis — Architecture finalisée de la fiche d'entretien initial FSE-IA

> **Statut** : architecture finalisée sur la base des **14 rubriques exactes**
> lues et validées par l'architecte fonctionnel. Aucun code, aucune migration,
> aucun changement en production, aucun push.
>
> Modèle de référence : `1UFNfiGHItkI8w8jsTGd2_07SvkQMbY8Y8j7cZbezVt0`.

---

## 1. Les 14 rubriques exactes ↔ cinq écrans de saisie

| # | Rubrique (modèle officiel) | Écran proposé | Source de la donnée |
|---|---|---|---|
| 1 | Identification et accueil du jeune | **Écran 1** | jeune / accueil |
| 2 | Prise en compte des besoins spécifiques et du handicap | **Écran 2** (sécurisée) | accompagnateur (admin) |
| 3 | Motif de la venue et attentes du jeune | **Écran 3** | jeune |
| 4 | Parcours scolaire, de formation et expériences | **Écran 3** | jeune |
| 5 | Compétences, qualités et ressources personnelles | **Écran 3** | jeune |
| 6 | Centres d'intérêt, motivation et posture | **Écran 4** | jeune + observation accompagnateur |
| 7 | Environnement, mobilité et freins à l'insertion | **Écran 4** | jeune |
| 8 | Questionnaire de positionnement — les 6 phases du parcours FSE-IA | **Écran 4** | questionnaire réel (6 phases) |
| 9 | Projet professionnel et projection dans l'avenir | **Écran 5** | jeune |
| 10 | Plan d'action individualisé | **Écran 5** | accompagnateur |
| 11 | Synthèse du premier entretien — réservée à l'accompagnateur | **Écran 5** | accompagnateur (masquée au jeune) |
| 12 | Suivi de l'évolution du jeune sur le parcours | **Hors entretien initial** (évolutive) | suivi continu |
| 13 | La parole du jeune | **Écran 5** | jeune (verbatim) |
| 14 | Engagement et signatures | **Écran 5** | signatures manuelles |

### Règle de regroupement

- **Écran 1** — rubrique 1 (identification/accueil) : complète `stagiaires`.
- **Écran 2** — rubrique 2 (handicap) : écran sécurisé dédié, cf. §6.
- **Écran 3** — rubriques 3, 4, 5 (motif, parcours, compétences).
- **Écran 4** — rubriques 6, 7, 8 (motivation, environnement, positionnement).
- **Écran 5** — rubriques 9, 10, 11, 13, 14 (projet, plan, synthèse, parole,
  engagement/signatures).

---

## 2. Séparation : entretien initial vs suivi pendant la formation

- **Entretien initial** = rubriques 1–11 + 13–14. C'est un **enregistrement**
  daté et validable, rattaché au stagiaire, rejouable (plusieurs entretiens).
- **Suivi pendant la formation** = rubrique 12. Elle est **évolutive** et ne
  doit **pas** être figée à la validation du premier entretien : elle s'alimente
  au fil du parcours via le module Accompagnement existant
  (`adaptations_parcours`, `suivis_inscription`, `suivi_seance` /
  `suivi_pedagogique`). Aucune nouvelle table dédiée n'est nécessaire pour la
  rubrique 12 tant qu'on s'appuie sur ces entités ; on la rend simplement
  **consultable** dans la vue de la fiche.

---

## 3. Inventaire des données

### Déjà stockées (réutilisables sans duplication)

| Donnée | Table / colonne | Rubrique |
|---|---|---|
| Civilité, nom, prénom, e-mail, téléphone | `stagiaires` | 1 |
| Entreprise, financeur | `stagiaires` | 1, 7 |
| Situation de handicap (bool), besoins d'adaptation (texte) | `stagiaires` (admin) | 2 |
| Prescripteur, date d'inscription | `inscriptions` | 3 |
| Attentes, objectifs personnels | `recueils_besoin` | 3, 9 |
| Prérequis vérifiés, conclusion | `recueils_besoin` | 4, 10 |
| Positionnement (test) | `resultats_qcm` (`positionnement`) | 8 |
| Mesures pédagogiques | `adaptations_parcours` | 10, 12 |

### Réellement manquantes (à modéliser)

- **Identité complémentaire** : date de naissance, âge, adresse, ville, code
  postal (aucune colonne — cf. DOC-3A).
- **Parcours scolaire / expériences** (rubrique 4) : diplômes, parcours.
- **Compétences / qualités / ressources** (rubrique 5) : texte libre structuré.
- **Centres d'intérêt / motivation / posture** (rubrique 6).
- **Environnement / mobilité / freins** (rubrique 7).
- **Questionnaire 6 phases** (rubrique 8) : à modéliser **depuis les vraies
  questions**, sans inventer d'évaluation (cf. §7).
- **Plan d'action individualisé** (rubrique 10) : items actionnables datés.
- **Synthèse accompagnateur** (rubrique 11) : réservée accompagnateur.
- **La parole du jeune** (rubrique 13) : verbatim, jamais reformulé.

---

## 4. Schéma minimal proposé (plusieurs entretiens possibles)

> Clé d'architecture : **un stagiaire peut avoir plusieurs entretiens**. Aucune
> contrainte UNIQUE sur `stagiaire_id`.

```
stagiaires (existant)
  1 ─── N entretiens
          ├─ entretien (entête : date, type, statut, auteur)
          │     └─ 1:N entretien_reponses (rubrique, champ, valeur, source)
          ├─ 1:1 entretien_handicap  (sécurisée, admin)
          └─ 1:N entretien_positionnement (6 phases, questions réelles)
```

### Tables nouvelles (à créer en phase d'implémentation)

1. **`entretiens`** — entête réutilisable (plusieurs par stagiaire) :
   `id`, `stagiaire_id` (FK, indexé, **non unique**), `type` (`initial` /
   `suivi`), `date_entretien`, `statut` (`brouillon` / `validee`),
   `realise_par`, `cree_le`, `mis_a_jour_le`.

2. **`entretien_reponses`** — les réponses par rubrique, en distinguant la
   **source** : `entretien_id`, `rubrique` (1–14), `champ`, `valeur`,
   `source` (`jeune` / `accompagnateur`). Rubriques 11 (`accompagnateur`) et 13
   (`jeune`) ont une source imposée.

   > Alternative : colonnes typées sur `entretiens` pour les champs structurés
   > (dates, énumérations) + une table libre pour les textes longs. À trancher à
   > l'implémentation selon le volume réel de champs fermés.

3. **`entretien_handicap`** — 1:1 sécurisée (cf. §6), réservée admin.

4. **`entretien_positionnement`** — 1:N, une ligne par question réelle des 6
   phases (rubrique 8) : `entretien_id`, `phase` (1–6), `question`, `reponse`.
   Les questions sont portées par un **référentiel** (code + libellé), jamais
   inventées.

### Réutilisation des entités existantes (aucune nouvelle table)

- Rubrique 12 (suivi) : `adaptations_parcours` + `suivis_inscription`.
- Positionnement test (si le parcours en a un) : `resultats_qcm`
  (`type = 'positionnement'`), déjà relié à `recueils_besoin.positionnement_id`.

---

## 5. Parcours de saisie, sauvegarde et inscription ultérieure

### Saisie

1. Le jeune est **créé dans `stagiaires`** (hors session) via une nouvelle route
   `POST /stagiaires` + recherche `GET /stagiaires?q=…`.
2. Un **entretien** (`entretiens`, `type = initial`) est ouvert : saisie par les
   5 écrans, chacun **sauvegardé indépendamment** (brouillon).
3. Les rubriques 11 et 13 sont **distinguées à la saisie** (champs accompagnateur
   vs champs jeune) ; l'écran 2 (handicap) est réservé admin.

### Sauvegarde progressive et reprise

- Chaque écran enregistre sa sous-partie (pas de sauvegarde globale en fin).
- `statut = brouillon` tant que la fiche n'est pas `validee`.
- Reprise : liste des entretiens en cours, réouverture au dernier écran atteint.
- `validee` fige l'entretien **initial** (mais jamais la rubrique 12, évolutive).

### Inscription ultérieure (sans doublon)

- L'inscription n'est créée **qu'après la décision humaine** (`POST /sessions/:id/stagiaires`
  en sélectionnant le stagiaire existant, ou une route d'inscription dédiée).
- L'unicité `(stagiaire_id, session_id)` garantit l'absence de doublon.
- Déduplication : recherche nom/prénom/e-mail avant toute création.

### Réutilisation au recueil (à l'inscription)

- Pré-remplir `recueils_besoin` depuis le dernier entretien validé :
  `attentes` ← rubrique 3, `objectifs_personnels` ← rubrique 9,
  `prerequis_verifies` ← rubrique 4, `conclusion` ← rubrique 10 (plan/action),
  `positionnement_id` ← test éventuel.
- Reprendre les mesures en `adaptations_parcours` (une ligne par catégorie).

---

## 6. Confidentialité et génération documentaire

### Handicap (rubrique 2) — conception sécurisée spécifique

- **Minimisation** : reconnaissance (RQTH oui/non), aménagements **nécessaires à
  la formation** — jamais de diagnostic, d'antécédents ni de compte rendu médical.
- **Accès** : réservé admin (extension de `CHAMPS_RESERVES_ADMIN`), en lecture et
  en écriture, via `entretien_handicap`.
- **Mineurs** : traitement adapté à valider (consentement du représentant légal,
  accès encore plus restreint, conservation réduite).
- **Export documentaire** : n'exporter que les **aménagements**, jamais le motif
  médical.
- **Ne pas modifier silencieusement le modèle officiel** : la génération ne
  réécrit jamais le contenu type du Google Doc ; elle injecte uniquement les
  champs de données validés.

### Autres règles

- **Rubrique 11 (synthèse accompagnateur)** : jamais exposée au jeune ; visible
  accompagnateur/admin seulement.
- **Rubrique 13 (parole du jeune)** : verbatim, jamais reformulé ni tronqué.
- **Signatures (rubrique 14)** : **manuelles**, zones laissées vides à la
  génération (jamais pré-remplies).

### Génération du Google Doc

- Depuis les données **validées** de l'entretien, via le moteur de blocs et
  variables canoniques existant.
- Le document est une **copie** du modèle officiel (jamais le modèle lui-même),
  remplie par variables ; les signatures restent des emplacements vides.

---

## 7. Découpage technique révisé (première étape testable)

1. **Étape A (première, implémentable)** — `POST /stagiaires` + `GET /stagiaires`
   (créer et rechercher un jeune hors session) + tests : droits
   (`requireRedacteur`/admin), dédoublonnage, absence de session obligatoire.
2. **Étape B** — Migration `entretiens` + `entretien_reponses` (entête +
   réponses sourceées) + API brouillon/reprise + tests.
3. **Étape C** — Formulaire 5 écrans (frontend), sauvegarde par écran + tests.
4. **Étape D** — `entretien_handicap` (admin) + `entretien_positionnement`
   (6 phases, questions réelles) + tests de confidentialité.
5. **Étape E** — Réutilisation dans `recueils_besoin` à l'inscription + tests.
6. **Étape F** — Génération du Google Doc final (variables + signatures vides) +
   test réel sur copie isolée.

### Description précise de l'Étape A

- **Objectif** : permettre d'enregistrer un jeune dans `stagiaires` **sans**
  session, condition préalable à tout entretien.
- **API** :
  - `POST /stagiaires` (corps : civilité, nom, prénom, e-mail, téléphone,
    entreprise, financeur — les champs handicap restent admin) → 201 avec le
    stagiaire.
  - `GET /stagiaires?q=…` (recherche, `requireAuth`) → liste paginée, sans les
    champs réservés pour les non-admins.
- **Règles** : un stagiaire n'est créé que si aucun correspondant (nom/prénom/
  e-mail) n'existe ; la projection `projeterStagiaire` s'applique déjà.
- **Tests attendus** : création hors session (201), recherche, droits
  (contributeur vs admin sur les champs handicap), refus de doublon, aucune
  inscription créée implicitement.
- **Livrable de validation** : backend + frontend verts, build OK, `git diff
  --check` propre — avant d'aborder l'Étape B.

---

## 8. Changements minimaux résumés

| Niveau | Changement |
|---|---|
| **Base** | `entretiens` (1:N), `entretien_reponses` (source jeune/accompagnateur), `entretien_handicap` (admin), `entretien_positionnement` (6 phases) ; éventuellement colonnes identité (`date_naissance`, adresse…) |
| **API** | `POST/GET /stagiaires` (hors session), `GET/PUT /stagiaires/:id/entretiens`, route handicap admin |
| **Interface** | page « Entretiens » + formulaire 5 écrans + sélection de stagiaire à l'inscription |
| **Sécurité** | extension `CHAMPS_RESERVES_ADMIN` (handicap), séparation jeune/accompagnateur, verbatim parole du jeune, signatures manuelles |

Aucune donnée Qualiopi, aucun modèle Drive, aucune permission n'est modifié par
cette architecture.
