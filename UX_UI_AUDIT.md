# Vigie Qualiopi — Audit UX/UI et proposition de refonte

| Repère | Valeur |
| --- | --- |
| Date | 24/09/2026 |
| Base auditée | `4ad74a6` (production), client `client/src/**` |
| Nature | **Audit et proposition uniquement** — aucun code, aucun CSS, aucun composant modifié |
| Contrainte | aucune évolution backend imposée par le design ; ce qui en demanderait une est signalé |

Ce document décrit ce qui existe, ce qui gêne l'usage quotidien, et une cible réaliste
découpée en phases livrables séparément. Il s'appuie sur la lecture intégrale du client
(11 composants, ~3 900 lignes, une feuille `styles.css` de 305 lignes) et sur les routes
réellement exposées par le serveur.

---

## Sommaire

1. [État actuel](#1-état-actuel)
2. [Principaux problèmes](#2-principaux-problèmes)
3. [Architecture cible](#3-architecture-cible)
4. [Navigation cible](#4-navigation-cible)
5. [Design system proposé](#5-design-system-proposé)
6. [Détail des écrans](#6-détail-des-écrans)
7. [Proposition : détail d'une session](#7-proposition--détail-dune-session)
8. [Proposition : veille](#8-proposition--veille)
9. [Tableau de bord (Accueil)](#9-tableau-de-bord-accueil)
10. [Rôles admin / contributeur](#10-rôles-admin--contributeur)
11. [Responsive et accessibilité](#11-responsive-et-accessibilité)
12. [Plan d'implémentation par phases](#12-plan-dimplémentation-par-phases)
13. [Risques de régression à surveiller](#13-risques-de-régression-à-surveiller)

---

## 1. État actuel

### 1.1 Socle technique du client

| Élément | Constat |
| --- | --- |
| Framework | React 18 + Vite 5, **aucune bibliothèque d'interface**, aucun routeur |
| Navigation | un `useState("referentiel")` dans `App.jsx` : 6 boutons d'onglets, rendu conditionnel |
| URL | **toujours `/`** : pas de lien direct, bouton « Retour » du navigateur inopérant, un rechargement renvoie au tableau de bord |
| Mise en page | barre supérieure + colonne centrale `max-width: 920px` |
| Styles | un seul fichier `styles.css`, variables CSS (`--primary: #1f4e79`…), **mode sombre automatique** selon le système |
| Composants partagés | `RechercheDrive` (réutilisé 6 fois) ; `Bloc` et `Champ` définis localement dans `Sessions.jsx` seulement |
| Retours utilisateur | message d'erreur global par écran + **3 `window.alert` et 7 `window.confirm`** |
| Tests client | **aucun** (les 380 tests sont serveur) ; smoke navigateur manuel (L11) |

Le serveur sert déjà `client/dist` avec un repli `app.get("*") → index.html` : un routage
par URL côté client est donc possible **sans toucher au backend**, à condition de ne pas
utiliser les préfixes `/api` et `/auth`.

### 1.2 Écrans existants

```text
Connexion (Google)
└─ Application
   ├─ [bandeau admin permanent] Google Drive : connecté / déconnecter
   └─ Onglets : Tableau de bord · Preuves · Audits · Veille · Sessions* · Modèles**
      ├─ Tableau de bord = Référentiel V9 (jauge + 7 critères dépliables)
      │  ├─ vue « Indicateurs non applicables »
      │  └─ vue « Versions du référentiel »** (+ création de coquille)
      ├─ Preuves (liste de 144 cartes, création, import classeur**, sélection multiple**)
      ├─ Audits (historique + formulaire de saisie**)
      ├─ Veille (liste filtrée → détail → formulaire)
      ├─ Sessions*
      │  ├─ Formations** (bloc repliable : liste + création + révision)
      │  ├─ Prescripteurs** (bloc repliable : liste + ajout + renommer/désactiver)
      │  ├─ Sessions (liste + formulaire de création permanent**)
      │  └─ Détail de la session (affiché SOUS la liste)
      │     ├─ Modifier la session**
      │     ├─ Groupes (+ ajout**)
      │     ├─ Stagiaires (+ ajout, + panneaux Dossier / Absences dépliés dans la ligne)
      │     ├─ Importer des stagiaires (CSV)
      │     ├─ Évaluations & satisfaction (+ import CSV)
      │     └─ Documents / Assiduité (génération, documents externes EduSign**)
      └─ Modèles** (marqueurs, liste, enregistrement)

*  admin + contributeur      ** admin seulement
```

### 1.3 Ce qui fonctionne déjà bien (à préserver)

- vocabulaire métier juste, en français, sans jargon technique dans la plupart des libellés ;
- principes métier visibles : « présent par défaut », assiduité jamais inventée, aperçu avant
  import, confirmation avant remplacement de documents ;
- statuts de conformité doublés d'un texte (pas seulement la couleur) ;
- préservation du contexte : le référentiel garde ses critères dépliés après une modification,
  les preuves gardent la sélection et le défilement ;
- champs sensibles (handicap, besoins d'adaptation) visibles **uniquement** dans le dossier ;
- contrastes des couleurs de statut actuelles corrects (4,7 à 8,7:1).

---

## 2. Principaux problèmes

Classés par impact sur l'usage quotidien.

| # | Problème | Où | Impact |
| --- | --- | --- | --- |
| P1 | **Page Sessions « tout-en-un »** : formations, prescripteurs, liste, création et détail sur une seule page ; le détail s'ouvre sous la liste, avec 6 blocs empilés et des panneaux dépliés dans les lignes | Sessions | très fort — c'est l'écran le plus utilisé |
| P2 | **Aucune URL** : impossible de revenir en arrière, d'ouvrir une session dans un nouvel onglet, de partager un lien ; un rechargement perd l'écran courant | global | fort |
| P3 | **Navigation plate et trompeuse** : « Tableau de bord » affiche en réalité le référentiel ; formations et prescripteurs sont cachés dans Sessions ; versions et non-applicables cachés dans le référentiel ; pas de hiérarchie entre le quotidien et le paramétrage | global | fort |
| P4 | **Formulaires toujours ouverts** sous les listes (création de session, groupe, stagiaire, audit, modèle, prescripteur, formation) : la page ressemble à un back-office de base de données | Sessions, Audits, Modèles | fort |
| P5 | **Trois styles de formulaire différents** : `.champ` (libellé au-dessus), `<label>` nus non stylés (Veille, Versions), champs **sans libellé** avec placeholder seul (Évaluations, Satisfaction) | global | moyen, et accessibilité |
| P6 | **Densité des preuves** : chacune des 144 cartes affiche en permanence statut, mode, session, groupe, échéance, recherche Drive, Modifier, Supprimer | Preuves | fort pour l'admin |
| P7 | **Retours par boîtes de dialogue natives** : le résultat d'une génération (documents, marqueurs non résolus, archivage) est un `window.alert` de 10 lignes ; erreurs affichées en haut de page, loin du champ | Sessions, Preuves | moyen |
| P8 | **Pas de tableau de bord réel** : rien ne répond à « qu'est-ce qui demande mon attention ? » (sessions du jour, échéances, actions de veille) | Accueil | fort |
| P9 | **Hiérarchie visuelle faible** : tout est pastille (`pill`) au même poids, libellés de champs en gris 12,75 px, dates au format `2026-09-28`, jargon ponctuel (« portée stagiaire », « mode par_stagiaire ») | global | moyen |
| P10 | **Formulaire Veille brut** : 14 champs au même niveau, `select multiple` natif (Ctrl+clic) pour 32 indicateurs, bouton Enregistrer non principal | Veille | fort sur cet écran |
| P11 | **Ambiguïtés** : pastille « A » pour « À analyser » **et** « Analysée » ; le détail de veille affiche l'identifiant technique de l'indicateur (`indicateur 57`) au lieu de son numéro ; « Marquer non applicable » agit en un clic, sans confirmation | Veille, Référentiel | moyen |
| P12 | **Actions principales mal choisies** : « Importer le classeur » (rare) est le bouton principal des Preuves ; « Enregistrer » est secondaire dans Veille et Versions | Preuves, Veille | faible à moyen |
| P13 | **Bandeau Google Drive permanent** en tête de chaque écran admin, alors qu'il n'est utile que s'il y a un problème | global | faible |
| P14 | **Accessibilité** : aucun style de focus défini, bordure des champs à 1,29:1 (minimum 3:1), onglets sans rôle ARIA, `select multiple` natif, petites zones cliquables (~28 px) | global | moyen |
| P15 | **Mode sombre automatique** non spécifié ni testé écran par écran : chaque nouveau composant doit être dessiné deux fois | global | faible, mais coûteux pendant la refonte |
| P16 | **Fonctions backend sans écran** : `PATCH /api/audits/:id` (corriger un audit) n'a pas d'interface ; aucune suppression d'évaluation/satisfaction n'existe côté serveur | Audits, Évaluations | faible |

---

## 3. Architecture cible

### 3.1 Principes

1. **Une page = une tâche.** Liste d'un côté, détail sur sa propre page, création dans un
   panneau latéral (*drawer*) ou une page dédiée selon la longueur du formulaire.
2. **Chaque écran a une URL.** Retour arrière, lien direct, rechargement fiables.
3. **Lecture d'abord, édition à la demande.** Les formulaires ne sont plus ouverts par
   défaut ; on affiche l'information, puis on édite via un bouton explicite.
4. **Hiérarchie visible** : un titre de page, une action principale au plus par zone, des
   sections nommées, des statuts sous forme de badges sobres.
5. **Aucun changement métier, aucun endpoint nouveau** pour les phases UX-1 à UX-5 — sauf
   les compléments signalés « backend plus tard » (section 9).

### 3.2 Coque de l'application (*shell*)

```text
┌──────────────┬──────────────────────────────────────────────────────────┐
│ Vigie        │  Sessions › SESS-2026-09 A2C                (fil d'Ariane) │
│ Qualiopi     │ ─────────────────────────────────────────────────────────│
│              │  Titre de page                         [Action principale]│
│ Accueil      │  sous-titre / statut                                     │
│              │                                                          │
│ FORMATION    │  ┌────────────────────────────────────────────────────┐  │
│ Sessions     │  │ contenu (cartes, tableaux, onglets)                │  │
│ Formations*  │  │                                                    │  │
│              │  └────────────────────────────────────────────────────┘  │
│ QUALITÉ      │                                                          │
│ Indicateurs  │                                                          │
│ Preuves      │                                                          │
│ Veille       │                                                          │
│ Audits       │                                                          │
│              │                                                          │
│ PARAMÈTRES*  │                                                          │
│ Modèles      │                                                          │
│ Prescripteurs│                                                          │
│ Référentiels │                                                          │
│ Google Drive │                                                          │
│ ──────────── │                                                          │
│ Mme Stark    │                                                          │
│ Admin ▾      │                                                          │
└──────────────┴──────────────────────────────────────────────────────────┘
 * admin seulement
```

- barre latérale fixe de 240 px sur ordinateur, repliable en icônes sur tablette, tiroir
  sur mobile ;
- zone de contenu jusqu'à **1 200 px** (contre 920 px aujourd'hui) pour les listes et le
  détail de session ; **720 px** maximum pour les formulaires longs ;
- en-tête de page standard : fil d'Ariane (pages de niveau 2+), titre, sous-titre,
  actions à droite ;
- zone de notifications (*toasts*) en bas à droite pour les succès ; les erreurs restent
  dans la page, près de l'action qui a échoué.

### 3.3 Routage (URL)

**Décision (validée avant UX-1A) : React Router** (`react-router-dom`, version stable),
plutôt qu'un routeur maison — une dépendance éprouvée plutôt qu'un système d'historique
à maintenir. Les routes réellement créées sont listées en [UX-1A](#ux-1a--shell-et-routing-réalisé).

| URL | Écran |
| --- | --- |
| `/` | Accueil |
| `/sessions` | Liste des sessions (filtres dans la requête : `?statut=en_cours`) |
| `/sessions/:id` | Détail — Vue d'ensemble |
| `/sessions/:id/stagiaires` · `/assiduite` · `/evaluations` · `/satisfaction` · `/documents` | onglets du détail |
| `/formations` | Catalogue des formations (admin) |
| `/indicateurs` | Référentiel et conformité (ex-« Tableau de bord ») |
| `/indicateurs/non-applicables` | Indicateurs écartés |
| `/preuves` | Preuves (filtres dans la requête) |
| `/veille` · `/veille/nouvelle` · `/veille/:id` · `/veille/:id/modifier` | Veille |
| `/audits` · `/audits/:id` | Audits |
| `/parametres/modeles` · `/prescripteurs` · `/referentiels` · `/drive` | Paramètres (admin) |

Garde-fous : aucune route client sous `/api` ou `/auth` ; le retour OAuth (`/?erreur=…`,
`/?drive=ok`) continue d'être lu puis retiré de l'URL ; une URL admin ouverte par un
contributeur affiche un état « accès réservé » (le serveur refuse de toute façon).

### 3.4 Motifs d'écran réutilisables

| Motif | Usage | Exemple |
| --- | --- | --- |
| **Liste** | tableau ou cartes + barre de filtres + action « Nouveau » | Sessions, Veille, Preuves, Audits |
| **Détail** | en-tête d'objet + onglets ou sections + actions contextuelles | Session, Veille, Audit |
| **Panneau latéral** (*drawer*, 480–560 px) | création/édition courte **sans quitter la liste** | nouvelle session, dossier stagiaire, absence, groupe, prescripteur |
| **Page formulaire** (720 px max) | formulaire long en sections, barre d'actions collante en bas | veille, audit, nouvelle preuve |
| **Modale** | uniquement confirmation destructive ou choix bloquant | supprimer, remplacer des documents, marquer non applicable |
| **Assistant 2 étapes** | aperçu puis confirmation | imports CSV, import du classeur |

---

## 4. Navigation cible

### 4.1 Proposition

| Groupe | Entrée | Admin | Contributeur | Remarque |
| --- | --- | --- | --- | --- |
| — | **Accueil** | ✓ | ✓ | nouveau tableau de bord « à traiter » (section 9) |
| **Formation** | **Sessions** | ✓ | ✓ | le cœur opérationnel |
| | Formations | ✓ | — | sorti de la page Sessions |
| **Qualité** | **Indicateurs** | ✓ | ✓ (lecture) | l'actuel « Tableau de bord » = conformité au référentiel |
| | **Preuves** | ✓ | ✓ (lecture) | |
| | **Veille** | ✓ | ✓ (lecture) | |
| | **Audits** | ✓ | ✓ (lecture) | |
| **Paramètres** | Modèles de documents | ✓ | — | |
| | Prescripteurs | ✓ | — | sorti de la page Sessions |
| | Versions du référentiel | ✓ | — | sorti du tableau de bord |
| | Google Drive | ✓ | — | remplace le bandeau permanent |
| (pied de barre) | Nom, rôle, Déconnexion | ✓ | ✓ | |

- **Admin : 10 entrées en 3 groupes + Accueil** ; **contributeur : 6 entrées**, sans aucun
  groupe « Paramètres ».
- « Indicateurs » plutôt que « Référentiel » : c'est ce que l'utilisateur regarde (32
  indicateurs et leur statut) ; le mot « référentiel » reste dans le titre de page.
- **Pas d'entrée « Stagiaires » globale** pour l'instant : le serveur n'expose aucune
  liste transverse des stagiaires (`GET /api/stagiaires` n'existe pas). Les stagiaires se
  gèrent dans leur session. Une page transverse est une évolution **backend plus tard**.
- **Signal d'attention dans la barre** : petit compteur à côté de Veille (actions à
  réaliser) et de Preuves (périmées + à confirmer, admin), calculé avec les filtres déjà
  exposés par l'API.
- **Drive déconnecté** : alerte en haut de l'Accueil et bannière discrète sur les écrans
  qui en dépendent (Documents d'une session, Preuves), au lieu du bandeau permanent.

### 4.2 Parcours et gains

**Admin — préparer et suivre une session**

| Étape | Aujourd'hui | Cible |
| --- | --- | --- |
| Créer une formation | onglet Sessions → déplier « Formations » → formulaire en bas du bloc | Formations → « Nouvelle formation » (drawer) |
| Créer la session | faire défiler jusqu'au formulaire sous la liste ; le détail s'ouvre sous la liste | Sessions → « Nouvelle session » (drawer) → **redirection vers la page de la session** |
| Créer un groupe | détail → bloc Groupes → formulaire en ligne | Vue d'ensemble → carte Groupes → « Ajouter » (drawer) |
| Inscrire / importer | bloc Stagiaires (formulaire permanent) + bloc Import séparé | onglet Stagiaires → « Ajouter » ou « Importer un CSV » (assistant) |
| Compléter un dossier | bouton « Dossier » → panneau déplié **dans la ligne** | clic sur le stagiaire → drawer « Dossier » à sections |
| Suivre les absences | bouton « Absences (n) » par stagiaire, panneau dans la ligne | onglet Assiduité : tableau par stagiaire + « Saisir une absence » |
| Évaluations / satisfaction | un bloc fermé mêlant les deux, formulaires sans libellés | deux onglets distincts, formulaires en drawer |
| Documents | bloc en bas, résultat en `alert()` | onglet Documents, résultat affiché dans la page |
| Preuves / audit | changer d'onglet, perdre le contexte de la session | liens contextuels (« 3 preuves liées à cette session ») |

Clics et défilement évités : le détail n'est plus sous une liste, chaque sous-partie est à
un clic et possède son URL.

**Contributeur — gérer ses stagiaires**

Aujourd'hui le contributeur arrive sur le référentiel (qu'il ne peut pas modifier) et doit
aller dans Sessions. Cible : l'Accueil liste **ses sessions en cours et à venir** avec
leurs points d'attention (dossiers incomplets, assiduité) ; un clic ouvre la session.

**Veille → preuve → audit**

Aujourd'hui : liste → détail → Modifier (formulaire de 14 champs) → retour → rattacher une
preuve (formulaire avec `<label>` nus). Cible : fiche structurée en trois temps
(**S'informer → Analyser → Agir**), statut toujours visible, indicateurs choisis dans une
liste cochable avec recherche, preuve rattachée depuis la section « Agir ». Depuis un
indicateur, on voit ses preuves et les veilles qui le concernent.

---

## 5. Design system proposé

Objectif : **sobre, clair, rassurant**. Une couleur de marque, des neutres, cinq couleurs de
statut. Aucun dégradé, aucun effet de verre, animations limitées à des transitions de
150 ms (ouverture de drawer, survol).

### 5.1 Couleurs

Contrastes calculés (WCAG) — texte ≥ 4,5:1, composants (bordures de champ, focus) ≥ 3:1.

| Rôle | Jeton | Valeur | Contraste |
| --- | --- | --- | --- |
| Fond de l'application | `--bg` | `#F6F7F9` | — |
| Surface (cartes, tableaux) | `--surface` | `#FFFFFF` | — |
| Surface secondaire (en-têtes de tableau, zones) | `--surface-2` | `#F2F4F7` | — |
| Texte principal | `--text` | `#111827` | 16,5:1 sur `--bg` |
| Texte secondaire | `--text-2` | `#4B5563` | 7,6:1 sur blanc |
| Bordure de carte / séparateur | `--border` | `#E3E7ED` | décorative |
| **Bordure de champ** | `--border-input` | `#858F9E` | **3,3:1** (actuelle : 1,29:1) |
| **Primaire** (marque, actuelle) | `--primary` | `#1F4E79` | 8,7:1 sur blanc |
| Primaire survol | `--primary-hover` | `#173D61` | 11,2:1 |
| Primaire léger (sélection, onglet actif) | `--primary-soft` | `#EEF4FA` | texte primaire 7,8:1 |
| Anneau de focus | `--focus` | `#2563EB` | 5,2:1 |

Statuts : texte foncé sur fond clair, **toujours accompagnés d'un libellé ou d'une icône**.

| Statut | Texte | Fond | Contraste | Usage |
| --- | --- | --- | --- | --- |
| SUCCESS | `#067647` | `#ECFDF3` | 5,4:1 | Maîtrisé, dossier complet, validé, justifiée |
| WARNING | `#93370D` | `#FFFAEB` | 7,2:1 | À consolider, bientôt à revoir, à vérifier |
| ERROR | `#B42318` | `#FEF3F2` | 6,1:1 | À risque, périmé, non validé, invalide |
| INFO | `#1D4ED8` | `#EAF1FD` | 5,9:1 | À analyser, en cours, information |
| NEUTRAL | `#475467` | `#F2F4F7` | 7,0:1 | Non applicable, brouillon, sans objet |

Correspondance avec les statuts métier existants (inchangés) :
`maitrise` → success · `a_consolider` → warning · `a_risque` → error ·
`non_applicable` → neutral ; sessions : `planifiee` → neutral, `en_cours` → info,
`terminee` → success, `annulee` → neutral barré.

**Mode sombre** : proposé **hors périmètre** de la refonte. Recommandation : fixer
l'application en clair pendant UX-1 à UX-5 (`color-scheme: light`), garder les jetons
pour pouvoir réintroduire un thème sombre plus tard, dessiné et testé.

### 5.2 Typographie

Police système (aucun téléchargement) : `system-ui, -apple-system, "Segoe UI", Roboto,
sans-serif` ; chiffres tabulaires (`font-variant-numeric: tabular-nums`) dans les tableaux.

| Niveau | Taille / interligne | Graisse | Usage |
| --- | --- | --- | --- |
| Titre de page | 24 / 32 px | 600 | un par page |
| Titre de section | 18 / 26 px | 600 | cartes, onglets de détail |
| Sous-titre | 15 / 22 px | 600 | groupes de champs |
| Corps | 15 / 22 px | 400 | texte courant (inchangé) |
| Libellé de champ | 14 / 20 px | 500, **couleur texte** | au-dessus du champ (aujourd'hui gris 12,75 px) |
| Secondaire / aide | 13 / 18 px | 400, `--text-2` | aides, métadonnées |
| Badge | 12 / 16 px | 500 | statuts |

### 5.3 Espacements, rayons, ombres

- grille de 4 px : 4 · 8 · 12 · 16 · 24 · 32 · 48 ;
- marges internes : carte 20–24 px, cellule de tableau 12 × 16 px, drawer 24 px ;
- rayons : 6 px (champs, boutons), 10 px (cartes), 999 px (badges) ;
- une seule ombre légère pour les éléments flottants (drawer, menu, toast) ; les cartes ont
  une bordure, pas d'ombre.

### 5.4 Composants de base (UX-1)

| Composant | Règles |
| --- | --- |
| **Bouton** | 4 variantes : *primaire* (fond `--primary`), *secondaire* (bordure), *discret* (texte), *danger* (texte/bordure rouge ; fond rouge seulement dans la modale de confirmation). Hauteur 36 px (32 px en « compact » dans les tableaux). Libellé verbe + objet (« Créer la session »). État *en cours* : libellé « Création… » + bouton désactivé. **Une seule action primaire par zone.** |
| **Champ** (`Field`) | libellé au-dessus, **toujours présent** (jamais de placeholder seul) ; mention « facultatif » plutôt que des astérisques ; aide sous le champ ; erreur en rouge sous le champ avec `aria-describedby` ; hauteur 38 px ; bordure `--border-input`. |
| **Sélecteur multiple** | liste de cases à cocher avec recherche et regroupement (ex. indicateurs par critère), + « puces » des éléments choisis ; remplace les `select multiple` natifs. |
| **Date** | champ natif `type="date"` conservé (bonne accessibilité) ; **affichage** toujours en `JJ/MM/AAAA` ou « 28 sept. 2026 » via une fonction unique `formatDate`. |
| **Badge** | pastille + texte, couleur de statut ; réservé aux **statuts**. Les métadonnées (type, catégorie, compteur) deviennent du texte secondaire ou des « étiquettes » neutres. |
| **Alerte** | 4 variantes (info, succès, avertissement, erreur), icône + titre + texte + action éventuelle ; `role="alert"` pour les erreurs. |
| **Toast** | succès non bloquants (« Absence enregistrée »), 4 s, fermable, `aria-live="polite"`. |
| **Tableau** | en-tête collant, lignes de 48 px, colonne principale cliquable (lien), actions de ligne regroupées dans un menu « … » au-delà de 2, tri sur 1–2 colonnes utiles, état vide intégré. |
| **Onglets** | soulignés, `role="tablist"`/`tab`, flèches clavier, **chacun lié à une URL**. |
| **Drawer** | à droite, 480–560 px (plein écran sur mobile), titre + fermer, contenu défilant, **pied collant** Annuler / Enregistrer, piège du focus, Échap ferme (avec confirmation si des saisies sont en cours). |
| **Modale de confirmation** | remplace `window.confirm` ; titre explicite, conséquence en une phrase, bouton d'action nommé (« Supprimer l'absence »), focus initial sur Annuler pour les actions destructives. |
| **En-tête de page** | fil d'Ariane, titre, sous-titre, actions ; même structure partout. |
| **Carte de synthèse** | chiffre + libellé + lien « Voir » ; utilisée sur l'Accueil et la Vue d'ensemble. |
| **État vide** | illustration sobre ou icône, phrase utile, action principale (voir 5.6). |

### 5.5 Règles des formulaires

1. **Largeur** : 720 px maximum ; champs courts (dates, nombres, civilité) en grille de 2–3
   colonnes, champs texte longs sur toute la largeur.
2. **Sections nommées** : 3 à 7 champs par section ; ordre = ordre de la tâche réelle.
3. **Obligatoire vs facultatif** : les obligatoires en premier ; les champs rarement utilisés
   dans une section repliable « Plus d'options ».
4. **Validation** : au moment d'enregistrer, message sous le champ fautif + résumé en tête
   si plusieurs erreurs ; le texte d'erreur du serveur est affiché tel quel (il est déjà
   rédigé pour l'utilisateur).
5. **Boutons** : pied de formulaire, action primaire à droite (« Enregistrer … »), Annuler
   à côté ; barre collante sur les formulaires longs.
6. **Modifications non enregistrées** : avertissement si l'on quitte un drawer ou une page
   de formulaire modifiés.
7. **Textes longs** (`textarea`) : hauteur initiale 4 lignes, redimensionnable, compteur
   seulement si une limite existe.
8. **Aide contextuelle** : une phrase sous le champ, pas de paragraphe au-dessus du
   formulaire (ex. l'aide sur les colonnes CSV passe dans l'assistant d'import).
9. **Jamais de dump** : aucun champ technique visible (identifiants, codes internes) ;
   les listes affichent des libellés humains (« Un document par stagiaire » plutôt que
   « portée stagiaire »).

### 5.6 États d'interface

| État | Convention |
| --- | --- |
| **Chargement** | squelettes (lignes grises) pour listes et cartes ; bouton « … en cours » pour une action ; jamais d'écran blanc |
| **Vide** | message + action : « Aucune session pour le moment. » [Créer une session] (admin) / « Aucune session ne vous est encore accessible. » (contributeur) ; « Aucun résultat pour ces filtres. » [Effacer les filtres] |
| **Erreur de chargement** | alerte erreur dans la zone concernée + [Réessayer] ; le reste de la page reste utilisable (comportement actuel du référentiel, à généraliser) |
| **Erreur d'action** | message sous le champ ou dans le drawer, au plus près de l'action ; pas de disparition automatique |
| **Succès** | toast bref ; pour une action riche (génération, import), **résumé affiché dans la page** avec les détails (remplace les `alert`) |
| **Avertissement métier** | alerte warning persistante dans le contexte (statut incohérent avec les dates, documents peut-être obsolètes, absences > durée prévue) |
| **Donnée absente** | tiret cadratin « — » en tableau ; « Non renseigné » en fiche ; jamais de valeur inventée (principe déjà appliqué à l'assiduité) |
| **Permission insuffisante** | l'action n'est **pas affichée** au contributeur ; si une URL réservée est ouverte : page « Cette page est réservée aux administrateurs » + lien Accueil ; un 403 serveur est affiché comme tel |
| **Action en cours** | bouton désactivé + libellé d'état ; double clic impossible (déjà le cas pour la génération) |
| **Connexion Drive requise** | alerte info avec action « Connecter le Drive » (admin) ou « Demandez à un administrateur » (contributeur) |

---

## 6. Détail des écrans

Légende densité : ● faible · ●● correcte · ●●● trop dense.

### 6.1 Connexion

| | |
| --- | --- |
| Objectif | se connecter avec le compte Google autorisé |
| Informations / actions | titre, phrase, bouton Google ; messages d'erreur OAuth (`messages.js`) |
| Problèmes | correcte ; bouton sans logo Google, carte isolée sur fond uni |
| Densité / rôles | ● / identique |
| Cible | conserver ; ajouter le nom de l'organisme, le logo Google conforme, un pied « Accès réservé à l'équipe A2C ». Priorité basse (UX-5). |

### 6.2 Tableau de bord actuel → « Indicateurs »

| | |
| --- | --- |
| Objectif | voir la conformité au référentiel, indicateur par indicateur |
| Informations | score (n au vert sur N), jauge, 7 critères dépliables, 32 indicateurs avec statut, preuves, catégories, gradation |
| Actions | rechercher ; déplier ; admin : Marquer non applicable, Versions, voir les non applicables |
| Problèmes | mal nommé (« Tableau de bord ») ; badges nombreux au même poids (catégorie, spécifique, provisoire, NC majeure) ; « Marquer non applicable » sans confirmation ni motif ; aucun lien vers les preuves d'un indicateur ; bouton Versions à côté de la recherche |
| Densité / rôles | ●● / contributeur : lecture seule, cohérent |
| Cible | page « Indicateurs » : bandeau de synthèse (4 compteurs cliquables par statut), filtres par statut, critères en accordéon conservés ; ligne d'indicateur = numéro + libellé + badge statut + « n preuves » (lien vers `/preuves?indicateur=…`) ; détails secondaires (catégories, gradation, provisoire) dans un panneau au clic ; « Marquer non applicable » dans un menu « … » **avec modale de confirmation** ; Versions → Paramètres. |

### 6.3 Versions du référentiel (admin)

| | |
| --- | --- |
| Objectif | voir la version active, préparer la future (V10), activer une version |
| Problèmes | caché derrière un bouton du tableau de bord ; pastilles « A/F/H » ; formulaire en `<label>` nus ; « Activer » en un clic, sans confirmation alors qu'il change tout le référentiel affiché |
| Cible | Paramètres › Versions : tableau (code, libellé, application, statut Active/Future/Historique en toutes lettres) ; « Préparer une version » en drawer ; **modale de confirmation** pour « Activer ». |

### 6.4 Indicateurs non applicables

| | |
| --- | --- |
| Objectif | retrouver et réactiver les indicateurs écartés |
| Problèmes | accessible seulement via un bouton dans la ligne du score |
| Cible | onglet/filtre « Non applicables » dans Indicateurs ; motif affiché ; Réactiver avec confirmation. |

### 6.5 Preuves

| | |
| --- | --- |
| Objectif | admin : rattacher, corriger et tenir à jour les preuves ; contributeur : consulter |
| Informations | 144 preuves : indicateur, titre, fichiers Drive, statut, mode de fichiers, session/groupe, échéance, alerte |
| Actions | Ajouter, Aperçu/Import du classeur, filtres (à confirmer, statut, échéance, recherche), sélection multiple + statut en masse, et par carte : statut, mode, session, groupe, échéance, rattacher/remplacer/retirer un fichier, Modifier, Supprimer, Confirmer sans fichier |
| Problèmes | **trop de contrôles visibles par carte** ; pas de regroupement par indicateur ni pagination ; la recherche relance le serveur à chaque frappe ; import en action principale ; le mode « par stagiaire » exige de comprendre « fichiers attendus » |
| Densité / rôles | ●●● admin, ●● contributeur / cohérent |
| Cible | **tableau compact** : indicateur, titre (lien), fichiers (« 2/8 » + badge), échéance (badge), statut (badge) ; filtres en haut (statut, échéance, à confirmer, indicateur, recherche différée de 300 ms) ; clic → **drawer « Preuve »** à sections (*Document* : titre, description, indicateur · *Fichiers* : liste + ajouter depuis le Drive · *Échéance* · *Rattachement* : session/groupe) ; sélection multiple conservée ; « Ajouter une preuve » = action principale ; import du classeur dans un menu « Importer… » (assistant aperçu → confirmation). |

### 6.6 Sessions (liste)

| | |
| --- | --- |
| Objectif | trouver une session, en créer une |
| Informations | référence, formation, statut, dates, horaire, lieu, inscrits |
| Problèmes | liste mêlée aux blocs Formations et Prescripteurs ; formulaire de création **permanent** ; détail rendu sous la liste ; dates ISO |
| Cible | tableau : Session (référence + formation), Dates (« 28 sept. → 12 déc. 2026 »), Statut, Lieu, Inscrits ; segments **À venir / En cours / Terminées / Toutes** (calculés côté client à partir des dates et du statut) + recherche ; « Nouvelle session » (admin) → drawer à 2 sections (*Formation et dates* : obligatoires · *Organisation* : lieu, formateur, durée, horaire) → redirection vers la page de la session. |

### 6.7 Détail de session

Voir la proposition complète en [section 7](#7-proposition--détail-dune-session).
Problèmes actuels : 6 blocs repliables empilés sous la liste ; formulaires toujours
ouverts ; panneaux Dossier/Absences dépliés dans la ligne du stagiaire ; résultat de
génération en `alert` ; « Modifier la session » en bloc replié au milieu des données.

### 6.8 Groupes

| | |
| --- | --- |
| Objectif | organiser la session par lieu/formateur (souvent 1 à 3 groupes) |
| Problèmes | bloc à part, formulaire permanent (admin), aucune modification possible d'un groupe existant côté API |
| Cible | carte « Groupes » dans la Vue d'ensemble (nom, lieu, formateur, inscrits) + « Ajouter un groupe » (drawer, admin) ; filtre par groupe dans l'onglet Stagiaires. |

### 6.9 Stagiaires / inscriptions / dossier

| | |
| --- | --- |
| Objectif | inscrire, compléter les dossiers, gérer groupe/prescripteur/abandon |
| Informations | nom, groupe, prescripteur, dossier complet/incomplet, absences, assiduité, abandon |
| Actions | ajouter, importer CSV, civilité rapide (admin), Dossier, Absences, Abandon |
| Problèmes | formulaire d'ajout de 7 champs toujours visible ; « Dossier » ouvre deux formulaires (fiche + inscription) avec deux boutons Enregistrer distincts, dans la ligne ; sélecteur de civilité dans chaque ligne (admin) ; bouton « Abandon » rouge au même niveau que Dossier |
| Cible | onglet Stagiaires : tableau (Nom, Groupe, Prescripteur, Dossier ✓/incomplet, Assiduité, Statut) + filtres (groupe, dossier incomplet, abandons) ; « Ajouter un stagiaire » (drawer) et « Importer un CSV » (assistant) ; clic → **drawer Dossier** avec sections *Identité* · *Contact* · *Inscription* (groupe, prescripteur, dossier complet) · *Accessibilité* (handicap, besoins — section distincte, rappel de confidentialité) · *Absences* (résumé + lien vers l'onglet Assiduité) ; « Déclarer un abandon » dans le menu « … » avec modale (date + motif, champs déjà supportés par l'API). |

### 6.10 Absences / assiduité

| | |
| --- | --- |
| Objectif | saisir les absences (présence par défaut), suivre les taux |
| Problèmes | saisie stagiaire par stagiaire via un panneau déplié ; message « présent par défaut » en petit gris ; aucune vue d'ensemble de la session |
| Cible | onglet Assiduité : en-tête (durée prévue, source de la durée, total des absences) ; tableau par stagiaire (absences, heures, taux, badge ≥ 80 % / < 80 % / non calculé + raison) ; ligne dépliable = liste des absences ; « Saisir une absence » (drawer : stagiaire, date bornée à la session, demi-journée, durée, justifiée, motif) ; alerte « absences > durée prévue » conservée. |

### 6.11 Évaluations / QCM

| | |
| --- | --- |
| Objectif | saisir ou importer les résultats |
| Problèmes | mêlé à la satisfaction dans un bloc fermé ; **9 champs sans libellé** (placeholders seuls ; 6 de plus côté satisfaction) ; import CSV toujours affiché ; lien « fichier » construit en dur |
| Cible | onglet Évaluations : synthèse (validés / non validés / non déterminés) ; tableau (stagiaire, type, intitulé, date, score, résultat) ; « Ajouter un résultat » (drawer, libellés, sections *Stagiaire et épreuve* · *Résultat* · *Pièce Drive (admin)*) ; « Importer » (assistant). |

### 6.12 Satisfaction

| | |
| --- | --- |
| Objectif | enregistrer les réponses (à chaud, à froid, financeur…) |
| Problèmes | mêmes défauts que les évaluations ; moyenne affichée dans une pastille |
| Cible | onglet Satisfaction : carte « Moyenne x/5 » (ou message « échelles différentes »), répartition anonymes/nominatives, tableau des réponses, drawer d'ajout. |

### 6.13 Documents (génération, EduSign)

| | |
| --- | --- |
| Objectif | générer les documents d'une session, rattacher les pièces externes |
| Problèmes | résultat de génération en `alert` de plusieurs lignes ; 409 « déjà générés » via `confirm` ; « portée stagiaire » ; formulaire EduSign admin toujours ouvert |
| Cible | onglet Documents : section *Documents générés* (tableau : nom → Drive, modèle, groupe, date) + « Générer des documents » (drawer : modèle avec portée en clair, groupe, **résultat affiché dans le drawer** avec les avertissements de marqueurs) ; remplacement via **modale** explicite ; section *Documents externes (EduSign…)* + « Rattacher un document » (drawer, admin). |

### 6.14 Veille

Voir [section 8](#8-proposition--veille).

### 6.15 Audits

| | |
| --- | --- |
| Objectif | garder la mémoire des audits et de leurs non-conformités |
| Problèmes | formulaire de 12 champs toujours ouvert sous l'historique ; **aucune modification possible d'un audit** alors que l'API la permet (`PATCH /api/audits/:id`) ; seule la version active du référentiel est proposée |
| Cible | liste chronologique en cartes (type, date, organisme, résultat, NC majeures/mineures, rapport) ; « Enregistrer un audit » → page formulaire (*Audit* · *Résultat* · *Non-conformités* · *Rapport*) ; fiche d'audit avec « Modifier » (utilise l'API existante) ; lien « dernier audit » sur l'Accueil. |

### 6.16 Modèles de documents (admin)

| | |
| --- | --- |
| Objectif | déclarer les modèles Google Docs/Sheets et leurs marqueurs |
| Problèmes | marqueurs affichés en haut en permanence ; indicateurs saisis comme texte libre « 9, 11 » ; « Retirer » sans détail d'usage |
| Cible | tableau (nom → Drive, type, portée en clair, indicateurs) ; « Ajouter un modèle » (drawer, indicateurs via le sélecteur multiple) ; « Marqueurs disponibles » dans un panneau d'aide repliable avec copie en un clic. |

### 6.17 Prescripteurs (admin)

| | |
| --- | --- |
| Objectif | maintenir la liste des prescripteurs proposés à l'inscription |
| Problèmes | caché dans la page Sessions |
| Cible | Paramètres › Prescripteurs : tableau simple (nom, actif), ajouter/renommer en ligne, désactiver avec modale. |

### 6.18 Formations (admin)

| | |
| --- | --- |
| Objectif | catalogue des formations et de leurs versions |
| Problèmes | caché dans Sessions ; « Réviser » crée une nouvelle version sans que cela soit visible avant de cliquer |
| Cible | page Formations : tableau (intitulé, code, durée, modalité, version, nb sessions) ; « Nouvelle formation » (drawer) ; « Réviser » ouvre le drawer avec l'avertissement « crée la version n+1 » en tête ; l'historique des versions (`GET /api/formations/:id/versions`, déjà exposé) peut s'afficher dans le drawer. |

### 6.19 Google Drive / paramètres

| | |
| --- | --- |
| Objectif | connecter le compte Drive de l'organisme |
| Problèmes | bandeau permanent en tête de chaque écran admin |
| Cible | Paramètres › Google Drive : état, compte, droits, dernier import du classeur, Connecter/Déconnecter (modale) ; alerte sur l'Accueil seulement si déconnecté ou en erreur. |

---

## 7. Proposition : détail d'une session

Le détail devient une **vraie page** (`/sessions/:id`) avec un en-tête fixe et six onglets.

```text
Sessions › SESS-2026-09
┌────────────────────────────────────────────────────────────────────────────┐
│ Préparation aux métiers de l'aide à domicile            [En cours]         │
│ SESS-2026-09 · 28 sept. → 12 déc. 2026 · 8h30–12h / 13h–16h30              │
│ Lyon 7e · Formateur : M. Durand · 210 h prévues · version 2 de la formation│
│                                      [Générer des documents] [ … ▾ ]       │
├────────────────────────────────────────────────────────────────────────────┤
│ Vue d'ensemble │ Stagiaires 8 │ Assiduité │ Évaluations │ Satisfaction │ Documents 6 │
└────────────────────────────────────────────────────────────────────────────┘
  ⚠ Session « planifiée » dont la date de fin est passée (le statut n'est pas modifié automatiquement)
```

**Menu « … »** (admin) : Modifier la session (drawer à sections *Dates et statut* ·
*Organisation*), Ajouter un groupe. Contributeur : pas de menu d'administration.

### 7.1 Onglets

| Onglet | Contenu | Source (existante) |
| --- | --- | --- |
| **Vue d'ensemble** | cartes : *Stagiaires* (actifs / abandons), *Dossiers incomplets* (n → lien filtré), *Assiduité* (n sous 80 %, taux non calculés), *Évaluations* (validés / non validés), *Satisfaction* (moyenne), *Documents* (générés, externes) ; carte *Groupes* ; carte *Preuves liées* ; alertes métier | `GET /sessions/:id`, `/absences`, `/evaluations`, `/satisfactions`, `/preuves?session=` |
| **Stagiaires** | tableau + filtres ; Ajouter ; Importer (assistant) ; drawer Dossier | `/sessions/:id`, imports existants |
| **Assiduité** | synthèse durée/absences, tableau par stagiaire, saisie en drawer | `/sessions/:id/absences` |
| **Évaluations** | synthèse, tableau, ajout, import | `/sessions/:id/evaluations` |
| **Satisfaction** | moyenne, tableau, ajout | `/sessions/:id/satisfactions` |
| **Documents** | générés + externes, génération, rattachement | `/sessions/:id` (documents), `/preuves?session=` |

Le compteur d'onglet (Stagiaires 8, Documents 6) donne l'état d'un coup d'œil. Chaque
onglet a son URL : un rechargement garde l'onglet.

### 7.2 Choix et justification

- **Onglets plutôt que longue page à ancres** : 6 sujets indépendants, chacun avec ses
  propres actions ; la page ne défile plus sur 4 écrans.
- **Drawers pour les saisies** : on garde la liste des stagiaires visible pendant la
  saisie d'une absence ou d'un dossier — c'est ce que les panneaux dépliés essayaient de
  faire, sans casser la liste.
- **Vue d'ensemble = point d'entrée** : répond à « où en est cette session ? » sans rien
  ouvrir.
- **Aucune donnée nouvelle** : tous les compteurs se calculent à partir des 5 appels
  que le détail fait déjà (le chargement parallèle actuel est conservé).
- **Sur tablette/mobile** : en-tête condensé (titre + statut + menu), onglets défilants
  horizontalement, tableaux en cartes.

### 7.3 Liste des sessions (rappel)

```text
Sessions                                                     [+ Nouvelle session]
[ À venir 2 ] [ En cours 1 ] [ Terminées 5 ] [ Toutes ]        🔍 Rechercher…
┌──────────────────────────────────┬──────────────────────┬───────────┬──────────┬──────────┐
│ Session                          │ Dates                │ Statut    │ Lieu     │ Inscrits │
├──────────────────────────────────┼──────────────────────┼───────────┼──────────┼──────────┤
│ SESS-2026-09                     │ 28 sept. → 12 déc.   │ En cours  │ Lyon 7e  │ 8        │
│ Préparation aux métiers de l'aide│ 2026                 │           │          │          │
└──────────────────────────────────┴──────────────────────┴───────────┴──────────┴──────────┘
```

---

## 8. Proposition : veille

### 8.1 Liste

```text
Veille Qualiopi                                              [+ Nouvelle veille]
[ À analyser 3 ] [ Actions à réaliser 1 ] [ Traitées ] [ Toutes ]
Type ▾   Rupture réglementaire ☐   🔍 Rechercher…
┌──────────────────────────────────────────┬──────────────┬────────────┬───────────────┬────────────┐
│ Titre                                    │ Type         │ Publiée    │ Statut        │ Action     │
├──────────────────────────────────────────┼──────────────┼────────────┼───────────────┼────────────┤
│ Décret n° 2026-… modifiant l'indic. 23   │ Légale       │ 12/09/2026 │ ● À analyser  │ —          │
│ ⚑ Rupture réglementaire · Ind. 23, 24    │              │            │               │            │
└──────────────────────────────────────────┴──────────────┴────────────┴───────────────┴────────────┘
```

- segments calculés avec les filtres **déjà supportés** par l'API (`statut`,
  `statut_action`, `type`, `q`) ;
- statut et action en **badges textuels** (plus de pastille « A » ambiguë) ;
- rupture réglementaire signalée par une icône + texte ;
- l'indicateur est toujours affiché par son **numéro** (la correspondance id → numéro
  est disponible via `GET /api/indicateurs`, sans backend).

### 8.2 Fiche (détail)

```text
Veille › Décret n° 2026-…                                    [Modifier] (admin)
┌───────────────────────────────────────────────┬──────────────────────────────┐
│ 1. S'INFORMER                                 │ Statut      ● À analyser     │
│ Résumé …                                      │ Action      — Aucune         │
│                                               │ Type        Légale           │
│ 2. ANALYSER                                   │ Source      Légifrance ↗     │
│ Impact …                ⚑ Rupture signalée    │ Publiée     12/09/2026       │
│ Indicateurs concernés : [23] [24]             │ Effet       01/01/2027       │
│                                               │ Consultée   15/09/2026       │
│ 3. AGIR                                       │                              │
│ Action à mener …                              │ Preuves (1)                  │
│ Statut de l'action : À réaliser               │ • Procédure mise à jour ↗    │
│ [Rattacher une preuve] (admin)                │   Indicateur 23              │
└───────────────────────────────────────────────┴──────────────────────────────┘
```

### 8.3 Formulaire

Page formulaire (720 px), **trois sections alignées sur le cycle de veille**, barre
d'actions collante « Annuler · Enregistrer la veille » :

| Section | Champs | Remarques |
| --- | --- | --- |
| **S'informer** | Titre\*, Type\*, Source, Lien, Date de publication, Date d'effet, Date de consultation, Résumé | dates en grille 3 colonnes ; lien validé visuellement |
| **Analyser** | Statut de la veille, Analyse / impact, Rupture réglementaire, Indicateurs concernés | indicateurs via le **sélecteur multiple avec recherche**, groupé par critère |
| **Agir** | Action à mener, Statut de l'action, Date de réalisation (si « Réalisée ») | la date n'apparaît que si utile (déjà le cas) |

Le rattachement d'une preuve reste dans la fiche (section Agir) : drawer « Rattacher une
preuve » (indicateur parmi ceux de la veille, titre, fichier Drive).

Aucune règle métier ne change : les validations serveur (dates, cohérence du cycle
d'action) continuent d'être affichées telles quelles, sous le champ concerné quand c'est
possible.

---

## 9. Tableau de bord (Accueil)

Question à laquelle l'Accueil doit répondre en quelques secondes : **« Est-ce que quelque
chose nécessite mon attention ? »**

### 9.1 Contenu proposé

```text
Bonjour Mme Stark                                          jeudi 24 septembre 2026
┌─ À traiter ───────────────────────────────────────────────────────────────────┐
│ ⚠ 2 preuves périmées · 5 bientôt à revoir            → Voir les preuves        │
│ ● 3 veilles à analyser · 1 action à réaliser          → Voir la veille          │
│ ⚠ Session SESS-2026-09 : 3 dossiers incomplets        → Ouvrir la session       │
│ ⚠ Google Drive déconnecté                              → Connecter             │
└───────────────────────────────────────────────────────────────────────────────┘
┌─ Sessions ─────────────────────────┐ ┌─ Conformité ──────────────────────────┐
│ En cours : SESS-2026-09 (8)        │ │ 18 / 24 indicateurs maîtrisés          │
│ À venir (30 j) : SESS-2026-10      │ │ ███████████░░░  4 à consolider · 2 à    │
│                → Toutes les sessions│ │ risque               → Indicateurs     │
└────────────────────────────────────┘ └────────────────────────────────────────┘
┌─ Dernier audit ────────────────────┐ ┌─ Dernier import du classeur (admin) ──┐
│ Surveillance · 12/03/2026 · Maintenu│ │ 22/09/2026 · 144 preuves               │
└────────────────────────────────────┘ └────────────────────────────────────────┘
```

La zone « À traiter » n'affiche que les lignes non nulles ; si tout va bien : « Rien
d'urgent. » (état positif explicite).

### 9.2 Faisabilité

| Information | Source | Sans backend ? |
| --- | --- | --- |
| Sessions en cours / à venir (30 j) | `GET /api/sessions` (dates, statut, inscrits) | ✅ |
| Incohérences statut/dates | calcul client (déjà fait dans le détail) | ✅ |
| Preuves périmées / bientôt à revoir | `GET /api/preuves?alerte=perime` / `bientot` (compter les lignes) | ✅ |
| Preuves à confirmer (admin) | `GET /api/preuves?a_confirmer=1` | ✅ |
| Veilles à analyser / actions à réaliser / ruptures | `GET /api/veille?statut=a_analyser`, `?statut_action=a_realiser` | ✅ |
| Score de conformité | `GET /api/referentiel` (`score`) | ✅ |
| Dernier audit | `GET /api/audits` (premier élément) | ✅ |
| Dernier import du classeur (admin) | `GET /api/import/dernier` | ✅ |
| État du Drive (admin) | `GET /api/drive/status` | ✅ |
| Dossiers incomplets, assiduité < 80 % | détail par session (`/sessions/:id`, `/absences`) | ⚠️ possible **pour les sessions en cours seulement** (1–3 appels) ; un agrégat serveur serait préférable → **backend plus tard** |
| Documents obsolètes | `documentsObsoletes` n'est **pas persisté** (dette connue) | ❌ **backend plus tard** |
| Stagiaires toutes sessions confondues | aucune route de liste transverse | ❌ **backend plus tard** |

Coût : 6 à 9 requêtes légères à l'ouverture de l'Accueil, en parallèle. Acceptable à
l'échelle de l'organisme ; si besoin plus tard, une route `GET /api/accueil` agrégée.

### 9.3 Accueil contributeur

Mêmes cartes **sans** les éléments d'administration (import du classeur, Drive, preuves à
confirmer) ; la carte Sessions est mise en premier ; la veille et la conformité restent en
lecture.

---

## 10. Rôles admin / contributeur

Rappel : **le serveur fait foi** (`requireAuth` / `requireRedacteur` / `requireAdmin`) ;
l'interface se contente de ne pas proposer ce qui serait refusé. Aucun droit ne change.

| Écran / action | Admin | Contributeur |
| --- | --- | --- |
| Accueil | complet | sans éléments d'administration |
| Sessions : liste, détail | ✓ | ✓ |
| Créer / modifier une session, ajouter un groupe | ✓ | — |
| Stagiaires : ajouter, importer, dossier, abandon | ✓ | ✓ |
| Civilité rapide dans la liste | ✓ (raccourci) | via le dossier |
| Absences, évaluations, satisfaction : saisir / importer | ✓ | ✓ |
| Rattacher une pièce Drive à une évaluation/satisfaction | ✓ | — (recherche Drive réservée admin) |
| Générer des documents | ✓ | ✓ |
| Rattacher un document externe (EduSign) | ✓ | — |
| Formations | ✓ | — (non affiché) |
| Indicateurs | lecture + non applicable | lecture |
| Preuves | complet | lecture |
| Veille | complet | lecture |
| Audits | complet | lecture |
| Paramètres (modèles, prescripteurs, versions, Drive) | ✓ | — (groupe non affiché) |

Écart historique noté au handoff (« tableau de bord visible au contributeur ») : tranché
en L10 (lecture autorisée) ; la refonte le conserve sous le nom « Indicateurs ».

---

## 11. Responsive et accessibilité

### 11.1 Responsive

| Largeur | Comportement |
| --- | --- |
| **≥ 1 200 px** (ordinateur, cible principale) | barre latérale ouverte, tableaux complets, drawers de 560 px |
| **768–1 199 px** (tablette) | barre latérale réduite à des icônes (avec libellés en infobulle et au survol), tableaux avec colonnes secondaires masquées, drawers de 480 px |
| **< 768 px** (mobile, secondaire) | menu en tiroir (bouton ☰), tableaux transformés en **cartes empilées** (ligne principale + 2 métadonnées + statut), onglets défilants, drawers et formulaires plein écran, barre d'actions collante en bas |

Points précis : la jauge de conformité reste lisible (libellés sous la barre) ; les
aperçus d'import deviennent une liste de cartes ; aucun tableau à défilement horizontal
sauf l'aperçu d'import détaillé (acceptable, action rare).

### 11.2 Accessibilité — constats et règles

| Sujet | Constat actuel | Règle cible |
| --- | --- | --- |
| Contraste du texte | correct (texte secondaire 5,5:1, statuts 4,7–8,7:1) | conserver ≥ 4,5:1 (jetons de la section 5) |
| Contraste des composants | bordure de champ **1,29:1** | ≥ 3:1 (`#858F9E`, 3,3:1) |
| Libellés | 15 champs sans libellé (9 Évaluations + 6 Satisfaction) ; `<label>` nus ailleurs | tout champ a un libellé visible associé |
| Focus clavier | **aucun style de focus** défini (anneau du navigateur seulement, parfois peu visible) | `:focus-visible` : anneau 2 px `--focus` + décalage 2 px sur tous les éléments interactifs |
| Zones cliquables | boutons « petit » ~28 px | ≥ 32 px en compact, 36 px par défaut, 44 px sur mobile |
| Couleur seule | bon dans l'ensemble (texte + couleur) ; pastilles lettre « A/F/H » ambiguës | toujours un texte ou une icône avec la couleur |
| Onglets | boutons sans rôle | `role="tablist"`, `aria-selected`, flèches clavier |
| Accordéons | `aria-expanded` présent ✓ | conserver |
| Tableaux | listes `<ul>` imitant des tableaux | vrais `<table>` avec `<th scope>` et légende masquée |
| Boutons icônes | peu nombreux ; « retirer » avec `aria-label` ✓ | tout bouton icône a un `aria-label` |
| Modales / drawers | `window.confirm` natifs | `role="dialog"`, `aria-modal`, titre associé, piège du focus, retour du focus à l'élément d'origine, Échap |
| Erreurs | message global en haut de page | message sous le champ + `aria-invalid` + `aria-describedby` ; résumé `role="alert"` |
| Sélection multiple | `select multiple` natif (clavier + Ctrl) | cases à cocher avec recherche |
| Langue, titres | `lang="fr"` ✓ ; titre d'onglet fixe « Vigie Qualiopi » | `document.title` par page (« Sessions — Vigie Qualiopi ») |
| Mouvement | aucune animation | transitions ≤ 150 ms, désactivées si `prefers-reduced-motion` |

---

## 12. Plan d'implémentation par phases

Principe : **chaque phase est livrable seule**, testée, déployée et validée avant la
suivante. Pas de refonte « big bang » : le shell et les composants arrivent d'abord, les
écrans migrent un par un ; un écran non encore migré continue de fonctionner dans la
nouvelle coque.

### UX-1 — Fondations (shell, navigation, design system)

- jetons CSS (section 5), thème clair fixé, styles de focus, bordures conformes ;
- composants de base : Button, Field, Select, MultiSelect, Badge, Alert, Toast, Table,
  Tabs, Drawer, ConfirmDialog, PageHeader, EmptyState, Skeleton ; `formatDate` unique ;
- React Router + barre latérale + en-tête de page + titres de document ;
- les écrans existants sont **montés tels quels** dans la nouvelle coque, sous leur URL ;
  Formations et Prescripteurs deviennent des pages (même code) ; Versions passe dans
  Paramètres ; bandeau Drive → Paramètres › Google Drive ;
- remplacement des 10 `window.alert/confirm` par Toast / ConfirmDialog (même logique) ;
- **critère de fin** : toutes les fonctions actuelles atteignables par URL, retour arrière
  fonctionnel, contributeur ne voit aucune entrée admin, aucun écran blanc.

### UX-2 — Sessions et détail de session

- liste en tableau + segments + recherche ; création en drawer → redirection ;
- page de détail à 6 onglets (section 7) ; drawers Dossier, Absence, Groupe, Ajout
  stagiaire, Génération ; assistants d'import (stagiaires, évaluations) ;
- résultat de génération dans la page (plus d'`alert`) ;
- **critère de fin** : parcours admin et contributeur complets sans défilement long ;
  toutes les alertes métier conservées (voir section 13).

### UX-3 — Veille

- liste à segments, fiche en trois temps, formulaire en sections, sélecteur d'indicateurs,
  rattachement de preuve en drawer, numéros d'indicateurs partout.

### UX-4 — Qualité : Indicateurs, Preuves, Audits + Accueil

- Indicateurs (ex-tableau de bord) ; Preuves en tableau + drawer (réduction de densité) ;
  Audits avec fiche et modification (API existante) ;
- **Accueil** « À traiter » (section 9, uniquement les sources ✅) — placé ici car il pointe
  vers les écrans refondus en UX-2 à UX-4.

### UX-5 — Paramètres, connexion, finitions

- Modèles, Prescripteurs, Versions, Google Drive en pages de paramètres homogènes ;
- écran de connexion ;
- passe responsive complète (tablette, mobile) et passe accessibilité (clavier, lecteur
  d'écran sur les parcours principaux) ;
- décision sur le mode sombre (réintroduire ou non).

**Nombre de phases recommandé : 5.** Chaque phase ≈ un lot habituel du projet
(audit → implémentation → tests → smoke navigateur → déploiement → validation).

### Tests à prévoir pendant la refonte

- extraire la logique non visuelle en **fonctions pures testables** (format de dates,
  calcul des segments de sessions, compteurs de la Vue d'ensemble, correspondance
  indicateur id → numéro) et les couvrir par des tests `node --test` côté client ou
  partagés ;
- conserver la suite serveur (380 tests) inchangée à chaque phase ;
- **smoke navigateur scripté** par phase (admin + contributeur, liste d'écrans et
  d'actions) ; l'automatiser plus tard (Playwright) reste une option, soumise à
  l'examen d'une nouvelle dépendance de développement.

### Évolutions backend à envisager plus tard (hors refonte)

1. agrégat « à traiter » par session (dossiers incomplets, assiduité faible) ;
2. persistance de `documentsObsoletes` (dette déjà recensée) ;
3. liste transverse des stagiaires (page « Stagiaires ») ;
4. suppression d'une évaluation / d'une satisfaction ;
5. modification d'un groupe.

### UX-1A — Shell et routing (réalisé)

Première tranche d'UX-1 : la **coque** et la **navigation** autour des écrans
existants, sans les réécrire.

**Décisions prises**

| Sujet | Décision |
| --- | --- |
| Routeur | `react-router-dom` **7.18.4** (stable, compatible React 18, Node ≥ 20 ; 0 vulnérabilité) — `BrowserRouter` ; le serveur sert déjà `index.html` pour toute URL hors `/api` et `/auth` |
| Tests client | `node:test` (déjà utilisé côté serveur) + **jsdom 27.4.0** + chargeur JSX via **esbuild 0.21.5** (la version déjà utilisée par Vite, dédupliquée). **Vitest écarté** : la branche compatible Vite 5 (2.x) porte une vulnérabilité critique non corrigée, le correctif (Vitest 5) exige Vite ≥ 6.4 |
| Thème | mode sombre automatique **retiré** ; thème clair fixé (`color-scheme: light`) |
| Anciennes variables CSS | `--bg`, `--text`, `--primary`, `--ok`… **raccordées aux nouveaux jetons** : les écrans non refondus adoptent la palette sans être réécrits |
| Titres | les écrans existants gardent leur propre `<h1>` ; la coque n'ajoute qu'un **fil d'Ariane** au-dessus (pas de double titre). Les nouvelles pages utilisent `PageHeader` complet |
| Retour après connexion | la page demandée avant la connexion Google est mémorisée (`sessionStorage`) et rouverte après — **chemin interne uniquement** (jamais `//…`, `https:`, `/api`, `/auth`) |
| Session | `/sessions/:id` affiche **uniquement** le détail (+ « ← Toutes les sessions »), plus sous la liste ; les sous-pages (`/stagiaires`, `/assiduite`, `/evaluations`, `/satisfaction`, `/documents`) affichent le même détail jusqu'à UX-2 |
| Formations, Prescripteurs | sortis de la page Sessions vers leurs propres pages (même code) |
| Drive | bandeau permanent retiré ; état visible sur l'Accueil (admin) et dans Paramètres › Google Drive |

**Routes**

| URL | Écran | Accès |
| --- | --- | --- |
| `/` | redirection vers `/accueil` (ou la page mémorisée avant connexion) | connecté |
| `/accueil` | Accueil (squelette : raccourcis selon les droits) | tous |
| `/sessions`, `/sessions/:sessionId` | liste / détail de session | tous |
| `/sessions/:sessionId/stagiaires` · `assiduite` · `evaluations` · `satisfaction` · `documents` | détail (découpage en UX-2) | tous |
| `/indicateurs`, `/indicateurs/non-applicables` | ex-« Tableau de bord » (référentiel) | tous |
| `/preuves`, `/veille`, `/audits` | écrans existants | tous |
| `/formations` | catalogue des formations | admin |
| `/modeles`, `/prescripteurs`, `/versions`, `/parametres/google` | paramètres | admin |
| toute autre adresse | « Page introuvable » (dans la coque) | tous |

Écart assumé par rapport au nom des routes : `/indicateurs/non-applicables` ajoutée
(vue existante du référentiel, désormais adressable). Les routes admin gardent les noms
demandés (`/modeles`, `/prescripteurs`, `/versions`, `/parametres/google`).

**Coque** : barre latérale fixe (240 px) ≥ 1 024 px ; en dessous, barre supérieure avec
bouton « Ouvrir le menu » et tiroir (Échap et le voile referment, le focus revient au
bouton, le tiroir fermé sort de l'ordre de tabulation) ; lien d'évitement « Aller au
contenu » ; entrée active signalée par `aria-current`, un filet et la graisse ; titre de
l'onglet du navigateur par page. Un contributeur ne voit **aucune** entrée
d'administration ; une URL réservée lui affiche « Accès réservé » (le serveur refuse de
toute façon).

**Composants créés** : `AppShell`, `Sidebar`, `PageHeader`, `Button`, `Badge`, `Alert`,
`EmptyState`, `LoadingState` (pas de `Card` : non nécessaire à ce stade). Drawer, Modal et
Tabs viendront avec les écrans qui les utiliseront.

**Validation** : 380/380 serveur + 19/19 client (×2), build OK ; smoke navigateur réel
(Chrome, PostgreSQL jetable, vrai serveur) **43/43** — admin, contributeur, rafraîchissement
de `/sessions/:id`, précédent/suivant, URL inconnue, clavier, tablette (900 px) et mobile
(390 px) sans défilement horizontal, aucune erreur console.

**Reste à faire en UX-1** (UX-1B) : remplacer les `window.alert/confirm` par des
composants, champs de formulaire accessibles communs, format de date unique.

### UX-2 — Sessions (réalisé)

**Architecture finale**

```text
/sessions                     SessionsListe : en-tête + vues + recherche + tableau
                              └─ drawer « Nouvelle session » (admin) → /sessions/:id
/sessions/:id                 SessionDetail : fil d'Ariane, en-tête, onglets
  (Vue d'ensemble)            └─ drawer « Modifier la session » (admin)
/sessions/:id/stagiaires      groupes + stagiaires ; drawers groupe, ajout, import CSV, dossier (large)
/sessions/:id/assiduite       synthèse + tableau par stagiaire (absences dépliables) ; drawer absence
/sessions/:id/evaluations     synthèse + tableau ; drawers évaluation et import CSV
/sessions/:id/satisfaction    synthèse + tableau ; drawer recueil
/sessions/:id/documents       générés par Vigie (drawer génération) + externes / EduSign (drawer admin)
```

Fichiers : `client/src/sessions/` (`SessionsListe`, `SessionDetail`, `FormulaireSession`,
`VueEnsemble`, `OngletStagiaires`, `OngletAssiduite`, `OngletEvaluations`,
`OngletSatisfaction`, `OngletDocuments`, `format.js` pur, `sessions.css`). L'ancien
`Sessions.jsx` (1 187 lignes) et `Evaluations.jsx` sont supprimés ; Formations et
Prescripteurs (Paramètres) vivent dans `FormationsPrescripteurs.jsx`, code inchangé.

**Décisions**

| Sujet | Décision |
| --- | --- |
| Chargement | le détail charge en parallèle session, absences, preuves de la session, évaluations et satisfactions (5 appels existants), partagés par les onglets ; modèles, prescripteurs, indicateurs une fois |
| Vues de la liste | fondées sur le **statut déclaré** (À venir = planifiée, En cours, Terminées, Annulées, Toutes) — jamais déduites des dates (règle L4) ; vue et recherche dans l'URL (`?vue=…&q=…`) |
| Recherche | référence, formation, lieu, sans accents ni casse. **Le formateur n'est pas cherchable** : `GET /api/sessions` ne le renvoie pas (évolution backend d'une ligne, non faite) |
| Formulaires | `FormSection` + `Field` : libellé visible, « (facultatif) », aide et erreur liées au champ ; mêmes champs et mêmes contrôles qu'avant |
| Dossier stagiaire | **drawer large** (48 rem) : Identité, Contact, Entreprise et financement, Inscription, **Accessibilité (confidentiel)** en dernier ; un seul bouton, qui n'envoie que la partie modifiée (fiche et/ou inscription, deux appels comme avant) ; le tableau n'affiche jamais handicap ni besoins d'adaptation |
| Abandon | action « Abandon… » par ligne + `ConfirmDialog` (focus initial sur Annuler) |
| Alertes métier | `documentsObsoletes` et absences au-delà de la durée → **bandeaux d'avertissement dans la page** après modification ; succès → bandeau discret fermable ; erreurs → dans le drawer, au plus près de l'action |
| Génération | drawer ; bouton désactivé pendant l'appel (+ garde serveur) ; 409 « déjà générés » → `ConfirmDialog` → `remplacer: true` ; résultat détaillé dans le drawer (documents, remplacés, preuves, marqueurs inconnus / non résolus, détection indisponible, fichiers ni Doc ni Sheet, anciens non archivés) ; une génération déjà en cours reste une erreur |
| Natifs | **tous** les `window.alert/confirm` de Sessions remplacés (3 alert, 3 confirm) ; ceux des autres écrans restent (hors périmètre) |
| Onglets | liens de navigation (`aria-current="page"`), défilement horizontal interne sous 768 px, compteurs (stagiaires actifs, résultats, réponses, documents) |
| Responsive | tableaux → cartes empilées sous 768 px (libellé de colonne affiché au-dessus de chaque valeur) ; drawers plein écran sous 768 px, boutons du pied pleine largeur ; métadonnées de session en 2 colonnes sur mobile |

**Composants ajoutés** (`client/src/ui/`) : `Drawer` (portail, `role="dialog"`,
`aria-modal`, Échap, piège du Tab, retour du focus, blocage du défilement, non fermable
pendant une opération), `ConfirmDialog` (`role="alertdialog"`), mécanique commune
`dialogue.js` (pile : une confirmation ouverte depuis un drawer se ferme seule), `Tabs`,
`Field` / `Checkbox` / `FormSection`. Styles : `ui.css`, `sessions/sessions.css` (jetons
uniquement).

**Validation** : 380/380 serveur + **41/41 client** (×2) — dont 17 tests Sessions et 6
tests de fonctions pures ; 4 mutations volontaires détectées. Smoke Chrome réel
(PostgreSQL jetable, jeu de données réaliste) **27/27** : admin, contributeur (absence et
recueil à froid réellement enregistrés, génération sans Drive → erreur lisible), mobile
390 px, aucune erreur console, aucune boîte native.

**Limites** : formateur non cherchable (voir ci-dessus) ; pas de suppression
d'évaluation / satisfaction ni de modification de groupe (inexistantes côté API) ; la
civilité rapide dans la liste (admin) passe désormais par le dossier ; le résultat d'une
génération et les bandeaux ne survivent pas à un rechargement de la page.

### UX-3 — Veille (réalisé)

**Architecture**

```text
/veille                   VeilleListe : segments + recherche / type / indicateur + tableau
/veille/nouvelle          VeilleFormulaire (admin) — page dédiée, 3 sections
/veille/:id               VeilleFiche : S'informer / Analyser / Agir + colonne de métadonnées
                          └─ drawer « Rattacher une preuve » (admin, capacité conservée)
/veille/:id/modifier      VeilleFormulaire (admin), prérempli
```

Fichiers : `client/src/veille/` (`VeilleListe`, `VeilleFiche`, `VeilleFormulaire`,
`SelecteurIndicateurs`, `format.js` pur, `veille.css`). L'ancien `Veille.jsx` est supprimé.
Aucune API, aucun droit, aucune migration ni règle métier modifiés.

**Mapping des segments** (valeurs serveur inchangées)

| Segment | Règle exacte |
| --- | --- |
| À analyser | `statut = a_analyser` |
| Actions à réaliser | `statut_action = a_realiser`, **quel que soit le statut** (une action décidée n'est jamais masquée) |
| Traitées | `statut ∈ {analysee, integree, sans_impact}` **et** `statut_action ≠ a_realiser` |
| Toutes | tout |

Toute entrée appartient à au moins un des trois premiers segments (vérifié sur les 12
combinaisons) ; seule une entrée « à analyser » dont l'action est déjà « à réaliser »
figure dans les deux premiers. Vue par défaut : Toutes (rien n'est jamais masqué au
chargement), compteurs visibles sur chaque segment.

**Liste** : filtrage client sur la liste complète déjà renvoyée par `GET /api/veille`
(recherche sans accents sur titre / source / résumé, type, indicateur) — segment et
filtres dans l'URL. Colonnes : veille (titre, source, drapeau « Rupture réglementaire »),
type, date de publication, statut, action, indicateurs compacts (« Ind. 11, 23, 24 +2 »,
liste complète dans l'étiquette accessible et la fiche). Statuts **en toutes lettres** avec
Badge (plus de pastille « A » ambiguë) : À analyser · Analysée · Intégrée · Sans impact ;
Aucune action · Action à réaliser · Action réalisée.

**Fiche** : trois étapes numérotées. *S'informer* : source, lien externe (http(s)
seulement, `target=_blank`, `rel="noopener noreferrer"`, annoncé « site externe »),
résumé ; *Analyser* : bandeau rupture réglementaire, analyse d'impact (texte lisible,
paragraphes conservés, ~70 caractères), indicateurs avec libellés ; *Agir* : statut et
date de réalisation, action décidée mise en avant (filet d'attention si « à réaliser »),
**preuves liées** (déjà renvoyées par `GET /api/veille/:id` : titre, numéro d'indicateur
retrouvé via le référentiel, fichiers Drive, lien vers l'écran Preuves). Colonne de
métadonnées courtes sur ordinateur ; en tête, en grille, sous 1 024 px.

**Formulaire** (page, 720 px) : *S'informer* (titre, type, source, lien, 3 dates, résumé),
*Analyser* (analyse d'impact, rupture réglementaire en question Oui / Non, statut de la
veille, indicateurs), *Agir* (statut de l'action en boutons radio expliqués, action, date
de réalisation seulement si « réalisée »). Barre d'actions collante ; erreurs serveur
affichées **au-dessus des boutons** ; succès ⇒ retour à la fiche avec message. Mêmes champs
qu'avant ; **une seule correction** : la date de réalisation n'est envoyée que pour une
action réalisée (sinon `null`) — l'ancien formulaire la renvoyait toujours et se faisait
refuser par la règle serveur L6.

**Sélecteur d'indicateurs** : remplace le `select multiple` natif. Critères du référentiel
actif (`GET /api/referentiel`) en groupes repliables avec compteur « n choisi(s) », zone de
24 rem défilante, recherche (texte du libellé, ou **numéro exact** : « 1 » ne trouve pas le
11), puces retirables, « Tout désélectionner », compteur annoncé (`aria-live`). Les
indicateurs déjà liés hors référentiel actif restent visibles dans un groupe dédié (jamais
retirés en silence). Valeur envoyée inchangée (`indicateur_ids`).

**Droits** : contributeur en lecture (liste, filtres, fiche) ; ni « Nouvelle veille », ni
« Modifier », ni « Rattacher une preuve » ; `/veille/nouvelle` et `/veille/:id/modifier` ⇒
« Accès réservé ».

**Sécurité** : l'ancienne fiche plaçait l'URL saisie directement dans `href` (une URL
`javascript:` devenait cliquable) ; désormais seul `http(s)` produit un lien, le reste
s'affiche en texte.

**Correctif transverse** : un champ de recherche contrôlé directement par l'URL perdait des
caractères en saisie rapide (React Router applique la mise à jour de l'URL de façon
différée — constaté en Chrome : « agefiph » devenait « aiph »). Hook `useTexteUrl` (état
local immédiat, URL synchronisée ensuite) appliqué à la Veille **et à la liste des Sessions
(UX-2, même défaut)** ; les changements de vue partent désormais des paramètres les plus
récents (une recherche en cours n'est plus écrasée).

**Validation** : 380/380 serveur + **61/61 client** (×2) — dont 14 tests Veille et 7 tests
de fonctions pures ; 4 mutations détectées. Smoke Chrome réel (PostgreSQL jetable, jeu de
veille réaliste) **28/28**, dont saisie clavier rapide sur Veille et Sessions.

**Limites** : recherche par sous-chaîne (pas de recherche par mots séparés) ; liste
plafonnée à 500 entrées par l'API ; le lien « Voir l'écran Preuves » ouvre l'écran complet
(pas de filtre par veille, l'écran Preuves n'étant pas encore refondu) ; « Rattacher une
preuve » n'est proposé que si la veille a au moins un indicateur (comme avant, un
indicateur est obligatoire).

---

## 13. Risques de régression à surveiller

| Risque | Garde-fou |
| --- | --- |
| **Droits** : un bouton admin réapparaît pour le contributeur | matrice de la section 10 vérifiée au smoke de chaque phase ; le serveur refuse de toute façon (401/403), mais l'interface ne doit rien proposer d'interdit |
| **Champs sensibles** (handicap, besoins d'adaptation) affichés hors du dossier | ne les exposer que dans la section *Accessibilité* du drawer Dossier ; jamais dans les tableaux, cartes, exports ou toasts |
| **Régénération** : le flux 409 « déjà générés » → confirmation → `remplacer: true` | conserver exactement l'enchaînement, via ConfirmDialog |
| **Avertissements métier** perdus en passant de `alert` à l'interface : documents peut-être obsolètes après modification de session, absences > durée prévue, marqueurs inconnus / non résolus, anciens fichiers non archivés | liste de contrôle explicite dans UX-2 ; chaque message actuel doit avoir son emplacement cible |
| **Imports** : l'aperçu doit rester sans écriture, la confirmation doit renvoyer le **même texte** que l'aperçu | l'assistant garde le texte en mémoire comme aujourd'hui (`texteRef`) |
| **Contraintes de saisie** : dates d'absence et d'évaluation bornées à la session (`min`/`max`), durée d'absence > 0, 29 février, formats `AAAA-MM-JJ` envoyés au serveur | l'affichage passe en JJ/MM/AAAA, **les valeurs envoyées restent ISO** |
| **Contexte préservé** : critères dépliés et défilement du référentiel après une modification de preuve, sélection des preuves remise à zéro au rechargement | reproduire le mécanisme `rafraichir` ; tester explicitement |
| **Routage** : collision d'une route client avec `/api` ou `/auth` ; retour OAuth `/?erreur=…` / `/?drive=ok` | préfixes interdits ; lecture du flash conservée au démarrage |
| **Lien direct** vers une page admin ouvert par un contributeur | page « accès réservé » côté client ; 403 serveur conservé |
| **Performance** : l'Accueil multiplie les appels ; la recherche des preuves relance le serveur à chaque frappe | appels parallèles, recherche différée (300 ms) |
| **Taille du bundle** (252 Ko aujourd'hui) | aucune bibliothèque UI lourde ; icônes en SVG inline ou set minimal |
| **Mode sombre** : composants nouveaux illisibles en sombre si le mode automatique reste actif | thème clair fixé pendant la refonte (section 5.1) |
| **Absence de tests client** | fonctions pures testées + smoke scripté à chaque phase (section 12) |
| **Principes métier** : « présent par défaut », aucun taux d'assiduité inventé (abandon, durée inconnue), statut de session jamais changé automatiquement | textes et règles d'affichage repris tels quels dans les nouveaux composants |

---

## 14. UX-4 — Accueil, Indicateurs, Preuves, Audits

### 14.1 Architecture

Refonte strictement frontend. Aucune API, aucune migration, aucun droit et
aucune règle métier modifiés. Deux modules purs ajoutés (testables seuls) :

- `client/src/accueil/format.js` — `construireAccueil(...)` : agrégation en
  lecture seule des listes déjà fournies par les API existantes
  (`/api/referentiel`, `/api/preuves`, `/api/veille`, `/api/sessions`,
  `/api/audits`) ;
- `client/src/preuves/format.js` — `grouperParIndicateur`, `filtrerPreuves`,
  `filtresActifs`, libellés `SOURCES`/`ALERTES`.

Composants refondus : `pages/Accueil.jsx`, `Preuves.jsx`, `AuditsHistory.jsx`,
`Referentiel.jsx` (ajout du détail). Styles ajoutés dans `styles.css`.

### 14.2 Accueil

- **Admin** : blocs sobres « À traiter » (preuves à confirmer / périmées /
  bientôt, veille avec action à réaliser), « Activité formation » (sessions en
  cours + prochaines), « Qualité » (indicateurs au vert, preuves rattachées,
  dernier audit) et « Raccourcis » (Sessions, Preuves, Veille, Audits).
- **Contributeur** : sessions utiles + raccourcis en lecture (Sessions,
  Indicateurs, Preuves, Veille, Audits). Aucune alerte ni action admin.
- **Google Drive** : plus de gros bloc permanent ; un petit bandeau admin
  n'apparaît que si une action est requise (non connecté, reconnexion requise,
  erreur). La logique OAuth est inchangée.
- Aucune nouvelle API : tout est déduit des données déjà chargées.

### 14.3 Preuves — vue « par indicateur »

- Deux vues : **Par indicateur** (défaut) et **Toutes les preuves**, la vue est
  conservée dans l'URL (`?vue=toutes`).
- Vue par indicateur : Critère → Indicateur → preuves liées. Les indicateurs
  **sans preuve** restent visibles (« Aucune preuve rattachée ») ; les
  indicateurs marqués non applicables sont signalés, jamais masqués.
- Ligne compacte : titre, source (Manuelle / Import Drive / Génération),
  statut, échéance, nombre de fichiers, actions principales. Les réglages
  avancés (mode de fichiers, session/groupe, échéance, confirmation,
  correction, suppression) vivent dans un **panneau latéral** (`Drawer`).
- Création en panneau (plus de formulaire ouvert en permanence).
- Filtres : recherche, source, statut, échéance, indicateur — dans l'URL.
  Deep-link supporté : `/preuves?indicateur=<numero>` (utilisé depuis le détail
  d'un indicateur).
- Toutes les capacités existantes sont conservées : import du classeur, aperçu
  sans écriture, sélection multiple + changement de statut en masse, recherche
  Drive, échéances (périmée / bientôt), confirmation sans fichier.

### 14.4 Indicateurs

- Regroupement par critère conservé, critères repliables, recherche
  numéro/texte.
- Nouveau **détail en panneau** par indicateur : libellé, critère,
  applicabilité, nombre de preuves, catégories, et lien
  `Voir les preuves de cet indicateur` → `/preuves?indicateur=<numero>`.
- `/indicateurs/non-applicables` reste fonctionnel, métier inchangé.

### 14.5 Audits

- Liste lisible (type, date, organisme, résultat, non-conformités) + bouton
  Ouvrir.
- **Fiche en panneau** : synthèse (date, contexte, résultat), constats
  (non-conformités), suivi (commentaires), rapport Drive.
- **Formulaire d'enregistrement en panneau** (plus ouvert en permanence).
  Aucune boîte `alert`/`confirm` native dans le périmètre Audits.

### 14.6 Limites backend (aucune évolution requise)

- **Lien Veille → Preuves filtré** : impossible sans nouvelle API — l'API
  `/api/preuves` n'accepte pas de filtre par `veille_id`. Le lien existant vers
  l'écran Preuves reste global (documenté, pas de backend créé).
- Le filtre « indicateur » de `/api/preuves` porte sur le **numéro** (pas
  l'identifiant interne) ; le client s'appuie dessus pour les deep-links.
- Les preuves sont chargées en une passe (≤ 1000, plafond serveur) et filtrées
  côté client, ce qui permet la vue groupée et n'importe quelle combinaison de
  filtres sans nouvel appel.

### 14.7 Responsive

- Desktop prioritaire ; mobile : critères/indicateurs en sections empilées,
  preuves condensées, filtres empilés, aucun scroll horizontal global (vérifié
  en 1440 / 900 / 390 px).

### 14.8 Tests

- Modules purs : `preuves-format.test.js`, `accueil-format.test.js`.
- Intégration (harness node:test + jsdom existant) : `preuves.test.jsx`,
  `audits.test.jsx`, `accueil.test.jsx`, `indicateurs.test.jsx`.
- Serveur inchangé : 380/380 attendus.

## 15. UX-5 — Finalisation

Dernière phase UX principale : écrans restants, nettoyage des boîtes natives,
passe responsive / accessibilité / cohérence. **Aucun changement** d'API, de
droit, de migration, de règle métier ni de configuration Railway.

### 15.1 Écrans finalisés

Nouveau dossier `client/src/parametres/` (+ `parametres.css`, jetons seulement) ;
anciens `Modeles.jsx`, `DriveStatus.jsx`, `FormationsPrescripteurs.jsx`,
`pages/ParametresPages.jsx`, `pages/GoogleDrivePage.jsx` supprimés.

- **Connexion** (`Login.jsx`) : carte sobre « Vigie Qualiopi », phrase d'accroche,
  bouton « Se connecter avec Google » (« Connexion… » au départ, réactivé au retour
  arrière), « Accès réservé aux utilisateurs autorisés. ». États : chargement
  (« Chargement de Vigie… »), Google non configuré (message simple, sans « OAuth »),
  erreur de retour Google (message de `messages.js`, code inconnu ⇒ message
  générique, jamais le code brut), serveur injoignable (sans détail technique,
  bouton Réessayer). Retour à la page demandée inchangé (`cheminRetourValide` :
  chemin interne uniquement).
- **Formations** : liste d'abord (intitulé, code, version courante et nombre de
  versions, durée par défaut, modalité, tarif HT, sessions, « Inactive » si
  désactivée) ; création et révision dans un panneau (Identité / Paramètres) ; la
  révision annonce « Enregistrer créera la version N+1 » et renvoie toute la
  version courante (objectifs, public… non affichés) pour n'en rien perdre. Le
  tarif HT, déjà accepté par l'API, devient saisissable.
- **Prescripteurs** : tableau nom / code / statut (badge Actif / Inactif + ligne
  estompée) ; création et renommage dans un panneau étroit (le code ne change
  jamais) ; désactivation par ConfirmDialog, réactivation directe.
- **Modèles de documents** : liste compacte (nom + description, usage, indicateurs,
  lien Drive + type de fichier) ; détail en panneau (libellés des indicateurs) ;
  marqueurs reconnus dans un panneau dédié ; création en panneau large avec le
  **sélecteur d'indicateurs de la Veille réutilisé tel quel** (identifiants
  convertis en numéros pour l'API) ; retrait par ConfirmDialog. Lien Drive rendu
  seulement s'il est http(s).
- **Versions du référentiel** : page propre (la vue « versions » de
  `Referentiel.jsx`, devenue inaccessible, est retirée ; le bouton « Versions »
  d'Indicateurs mène toujours à `/versions`). Version active en premier (filet +
  badge), autres versions en cartes : type (Active / Future / Historique), dates
  de publication et d'application, source, note, **nombre de critères et
  d'indicateurs** (lu via `GET /api/referentiel/versions/:id`, lecture seule). Une
  coquille (0 critère ou 0 indicateur) **n'offre aucun bouton d'activation**
  (« Activation impossible tant que le contenu n'est pas importé. ») ; le serveur
  la refuse de toute façon (409). Activation par ConfirmDialog explicite
  (« V10 remplacera V9… »), avertissement serveur relayé ; préparation d'une
  coquille en panneau.
- **Google Drive** : carte « État de la connexion » (Connecté / Non connecté /
  Connecté mais ne répond pas), compte connecté ou compte attendu de l'organisme,
  autorisations en clair (lecture, création de documents, classeur). **Jamais** de
  portée OAuth, de jeton ni de message d'erreur Google brut. Reconnexion proposée
  si une autorisation manque ; déconnexion par ConfirmDialog.

### 15.2 Boîtes natives

`window.alert` / `window.confirm` / `prompt` : **il n'en reste aucune** dans
`client/src` (les 3 dernières — Drive, prescripteurs, modèles — sont remplacées
par ConfirmDialog). Les deux seules mentions restantes sont des commentaires.
Un test échoue si une boîte native est appelée sur les pages Paramètres.

### 15.3 Corrections globales mineures

- Preuves (mobile) : « À confirmer d'abord » ne se casse plus mot par mot (la case
  prenait la largeur de `.champ input`) — CSS seul, règle métier inchangée.
- Indicateurs : pendant une bascule, les boutons affichent « Réactivation… » /
  « Enregistrement… » au lieu d'un « … » sans nom accessible.

### 15.4 Responsive, zoom, accessibilité

- Smoke Chrome (PostgreSQL jetable + vrai serveur) sur les 19 écrans admin et 7
  écrans contributeur, en 1440 / 900 / 390 px : aucun défilement horizontal
  global, aucun contrôle hors écran (les onglets de session défilent dans leur
  propre barre, comme prévu en UX-2), aucune erreur console.
- Zoom 200 % (1440 px ⇒ 720 px CSS, densité 2) : Accueil, Sessions, Preuves,
  Veille, Formations, Connexion utilisables.
- Tableaux Paramètres : `.sess-table` (cartes empilées sous 768 px) ; panneaux
  plein écran sous 768 px, pied d'actions visible.
- Clavier : « Aller au contenu » premier arrêt ; dialogues `role="dialog"` /
  `alertdialog`, piège du focus, Échap, retour du focus au déclencheur (vérifiés
  en navigateur réel) ; focus initial sur « Annuler » dans les confirmations.
- Formulaires : libellés visibles (`Field`), erreurs reliées (`aria-invalid`,
  `aria-describedby`), champs facultatifs signalés ; statuts toujours avec un
  libellé (badges), jamais la couleur seule ; un H1 par page, H2 de section.

### 15.5 Limites

- Les écrans UX-4 (Indicateurs, Preuves, Audits) gardent une partie des classes
  du prototype (`btn`, `pill`, `flash`) : validés tels quels, non refaits.
- Création de preuve : le `<select multiple>` natif des indicateurs subsiste
  (écran validé) ; le sélecteur de la Veille pourrait le remplacer plus tard.
- Pas de modification d'un modèle (l'API ne sait que créer / retirer) ni
  d'historique des versions d'une formation à l'écran (l'API existe, non exposée).
- Le compte des critères d'une version coûte une requête par version (quelques
  versions au plus).
- Mode sombre : toujours retiré (thème clair uniquement), décision reportée.
- Contrôle d'accessibilité manuel et scripté, sans audit WCAG exhaustif.

### 15.6 Tests

- `client/test/parametres.test.jsx` (26 tests) : connexion (rendu, Google non
  configuré, erreur connue / inconnue, serveur injoignable sans fuite, retour
  externe ignoré), droits contributeur sur les 5 pages (sans appel API),
  formations, prescripteurs, modèles, versions, Google Drive, confirmations
  (Échap, focus), absence de boîte native.
- Serveur inchangé.

## 16. Après VF — backlog

Idées déjà identifiées, **non commencées** :

1. savoir qui est connecté (sessions actives visibles par l'administrateur) ;
2. durée de connexion / historique des connexions (`derniere_connexion` existe déjà) ;
3. historique des modifications / journal d'activité (qui a changé quoi, quand) ;
4. déconnexion automatique après inactivité ;
5. sauvegarde externe PostgreSQL chiffrée (`pg_dump` planifié hors Railway —
   dette n° 2 de `PROJECT_HANDOFF.md`) ;
6. dettes techniques encore pertinentes (`PROJECT_HANDOFF.md`, « Dettes
   consolidées ») : `NODE_ENV` implicite (n° 4), devDependencies en image et
   `npm install` (n° 5), Vite 5 (n° 6), `@googleapis/drive` 8 (n° 7), marqueurs
   non relus dans les Sheets (n° 8), `documentsObsoletes` non persisté (n° 9),
   smoke navigateur non automatisé (n° 15) ;
7. finitions UX notées en §15.5 (classes du prototype sur les écrans UX-4,
   sélecteur d'indicateurs dans la création de preuve, mode sombre) ;
8. import du contenu **V10** du référentiel (coquille prête, application au
   01/11/2026).

---

*Fin du document.*
