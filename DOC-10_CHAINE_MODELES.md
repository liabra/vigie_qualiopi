# DOC-10 — Chaîne d'intégration des modèles Qualiopi A2C

> Tableau de pilotage de l'automatisation documentaire. Mis à jour par l'agent
> à chaque lot. Aucun document n'est « validé » sans test réel sur Google Docs.

---

## 0. État des lieux au démarrage

- **Git** : arbre propre au commit `2b981fc` (5 commits locaux DOC-9B/9C/9D non
  poussés). Aucun conflit, aucune modification non commitée.
- **Moteur documentaire** : opérationnel et complet — catalogue canonique
  (v1.4, 164 variables), 46 résolveurs scalaires, 10 blocs répétables,
  marqueurs historiques (23), précontrôle, génération Google Docs (tableaux
  inclus) et Google Sheets. **Ne pas le réécrire.**
- **Accès Google Drive** : **INDISPONIBLE dans cet environnement** (aucun
  `.env`, `GOOGLE_CLIENT_ID/SECRET` et compte de service non configurés
  localement). Les fichiers Drive ne peuvent donc être **ni lus, ni copiés, ni
  testés réellement** ici.

### Modèles fonctionnels déjà validés (hors périmètre, ne pas dupliquer)

| Modèle | Portée | Statut | Références tests |
|---|---|---|---|
| Convocation | stagiaire | **Terminé, testé réellement** | `migrationConvocation.test.js`, `generationRobuste.test.js` |
| Attestation de formation | stagiaire | **Terminé, testé réellement** | `migrationAttestation.test.js`, `documents.test.js` |
| Livret de suivi pédagogique FSE-IA | stagiaire | **Terminé, testé réellement** | `blocsTableaux.test.js`, `seances.test.js`, `suivi.test.js` |

---

## 1. Contrainte bloquante transversale

L'intégration d'un modèle requiert de **lire le modèle Drive** (pour connaître
ses balises `{{…}}` et sa structure de tableaux), de **l'enregistrer** (avec un
`drive_file_id`) puis de **tester la génération réelle** sur une copie. Ces
trois étapes sont impossibles sans accès Google autorisé.

Conformément aux consignes : **aucune tentative de contournement de
l'authentification**, aucun contenu inventé, aucune modification des modèles
Drive officiels.

→ **Résultat d'exécution (DOC-10B)** : l'absence d'accès Drive ne bloque plus que
la lecture/l'écriture distante. Les marqueurs déjà résolus sont confirmés et
testés ; les adaptations indépendantes de Drive (résolveurs, blocs) sont déjà
complètes. L'intégration effective reste en attente de (a) l'enregistrement
Drive des modèles, (b) DOC-9D2, (c) décisions métier sur les données manquantes.

---

## 2. Inventaire de pilotage

Légende : ✅ Terminé · 🟡 À compléter · 🔒 Bloqué (accès Drive) · ❓ Validation
métier requise · ⛔ Hors périmètre · ∅ Fichier Drive vide / non fonctionnel.

| Document | Statut | Portée pressentie | Variables disponibles | Manques | Action restante |
|---|---|---|---|---|---|
| Convocation | ✅ | stagiaire | historique + canoniques | — | — (déjà fait) |
| Attestation de formation | ✅ | stagiaire | historique + canoniques | — | — (déjà fait) |
| Livret FSE-IA | ✅ | stagiaire | bloc `suivi_pedagogique` | — | — (déjà fait) |
| Analyse des besoins FSE-IA | 🔒🟡 | stagiaire | aucune (données `entretiens` non résolues) | résolveurs entretien + DOC-9D2 | form DOC-9D2 + résolveurs + Drive |
| Compte rendu prescripteur/entreprise | 🟡 (techniquement prêt, multi-générations OK, test réel restant) | session (`generation_multiple`) | `formation_intitule`, `formation_duree_heures`, `session_date_debut`, `session_date_fin` (4 marqueurs confirmés, lus réellement sur Drive le 15/10/2026) | champs manuels (prescripteur, interlocuteur, date entretien, synthèse) — volontairement non résolus | enregistrer le modèle (`POST /api/modeles`, avec `generation_multiple: true`) + test réel de génération (OAuth Vigie) |
| Convention de formation | 🗒️ Proposition à valider (§10.2) | session/formation | `formation_intitule`, `formation_objectif_general`, `session_date_*`, `session_lieu`, `session_horaires` | signature, articles juridiques (7/9) à relire par A2C | validation A2C puis templatisation du document réel |
| Livret d'accueil | 🗒️ Proposition à valider (structure seule, §10.3) | formation | `organisme_nom`, `formation_*`, `session_lieu/horaires` | tout le texte de présentation + `referent_handicap_*` (n'existe pas en base) | A2C rédige le contenu sur cette structure |
| Emploi du temps | 🗒️ Proposition à valider (§10.1) | session | bloc `seances` complet (date/heure/theme/lieu/compétences/activités) déjà suivi par Vigie | aucun | créer le fichier Drive avec ces balises (A2C) |
| Certificat de réalisation | 🗒️ Proposition à valider (§10.4) | stagiaire | `stagiaire_nom_complet`, `formation_intitule`, `session_date_*`, `document_date` | référence/version document, signataire, mention Qualiopi exacte | validation A2C de la mention consacrée |
| Bilan de session | 🗒️ Proposition (contexte §10.5 seulement) + ❓🔒 (sections 3-5) | session | contexte (§10.5) | `bilan_*` (BIL-01..05, aucun résolveur) | décision métier sur la méthode (l'exemple ne suffit pas) |
| Indicateurs de résultats | ❓🔒 (exemple réel trouvé, formule non explicite) | formation | — | `indicateur_*` (IND-01..04, aucune formule) | décision métier sur la formule (l'exemple ne suffit pas) |
| Feuille d'émargement | ⛔ | — | — | — | géré par **EduSign**, ne pas recréer |
| Quiz de positionnement | ⛔ | — | — | — | Google Forms existant |
| Résultats de quiz | ⛔ | — | — | — | Google Forms existant |
| Satisfaction stagiaire/formateur | ⛔ | — | — | — | Google Forms existant |
| Suivi inscrits/abandons | ❓ | session | `abandon_*`, `presence_*`, `absence_*` | agrégation session (aucune formule officielle) | décision métier |
| Fichiers génériques vides (Drive) | ∅ | — | — | — | ignorés (non fonctionnels) |

---

## 3. Analyse détaillée par modèle (résumé des écarts)

### Lot 1 — Documents d'entrée
- **Analyse des besoins FSE-IA** : dépend des données `entretiens`/
  `entretien_reponses` (DOC-9C) qui n'ont **aucune variable canonique ni
  résolveur**. Le formulaire DOC-9D2 n'existe pas encore. → préparé, intégration
  reportée.
- **Compte rendu prescripteur/entreprise** (DOC-10B) : le modèle existe et
  contient **4 marqueurs réels, tous déjà résolus** — `{{formation_intitule}}`,
  `{{formation_duree_heures}}`, `{{session_date_debut}}`, `{{session_date_fin}}`.
  Les champs manuels (prescripteur, interlocuteur, date d'entretien, synthèse
  administrative) restent **non résolubles** (jamais inventés). → préparé :
  l'intégration ne requiert plus que l'enregistrement Drive + ces champs manuels.

### Lot 2 — Documents de session
- **Convention** : données financeur/prescripteur absentes.
- **Livret d'accueil** : données organisme (`organisme_*`, `referent_handicap_*`)
  absentes — seule `organisme_nom` est résolue.
- **Emploi du temps** : techniquement faisable via le bloc `seances` (date,
  heure, thème, lieu, phase, groupe, compétences, activités) ; nécessite la
  lecture du modèle pour confirmer la structure de tableau.

### Lot 3 — Évaluations et résultats
- **Positionnement / résultats de quiz** : hors périmètre (Google Forms) ;
  `evaluations` (bloc) résout intitulé/date/score/score_max/pourcentage, mais
  `evaluation_moment/methode/niveau` n'ont pas de colonne.

### Lot 4 — Fin de formation
- **Certificat de réalisation** : métadonnées documentaires (`document_*`,
  `signataire_*`) non résolues.
- **Bilan de session** / **Indicateurs de résultats** : aucun résolveur, aucune
  formule officielle définie (exclusion explicite en DOC-3A/DOC-6A).

---

## 4. Blocages et plan de reprise

### Blocages (à lever AVANT tout lot d'intégration)
1. **Accès Google Drive** (bloquant) : configurer `GOOGLE_CLIENT_ID/SECRET/
   REDIRECT_URI` + compte de service pour lire/copier les modèles.
2. **DOC-9D2** (formulaire d'entretien) : conditionne la fiche d'analyse des
   besoins et le compte rendu d'entretien.
3. **Décisions métier** : portée et contenu des modèles génériques (convention,
   livret d'accueil, certificat, bilan, indicateurs) ; données financeur/
   prescripteur/organisme manquantes.

### Ordre de reprise prévu (une fois l'accès Drive rétabli)
1. Lire chaque modèle Drive → relever ses balises et tableaux.
2. Pour chaque modèle, ne créer que les **résolveurs réellement nécessaires**
   (jamais de donnée inventée).
3. Enregistrer (`POST /api/modeles`) avec `portee` et `indicateurs`.
4. Tester la génération sur copie (fictives, tableaux, multi-personnes).
5. Valider « techniquement » uniquement après test réel réussi.

---

## 5. Interdictions respectées
Aucun push/déploiement, aucune modification de modèles Drive officiels, aucune
suppression/réinitialisation de données, aucune modification du référentiel
Qualiopi, aucune donnée sensible réelle en test, aucun document déclaré validé
sans validation humaine.

---

## 6. Marqueurs confirmés (DOC-10B)

**Compte rendu d'entretien prescripteur / entreprise** (Drive
`1sjn4Rfvut5Bnjp7XynCfnws4u41mG-PNt8FDpX0VXQ8`) : les 4 marqueurs suivants y
figurent réellement et sont **déjà couverts par le catalogue + les résolveurs** :

| Marqueur | Variable canonique | Résolveur | Source |
|---|---|---|---|
| `{{formation_intitule}}` | `formation_intitule` | ✅ | `formation.intitule` |
| `{{formation_duree_heures}}` | `formation_duree_heures` | ✅ | `version.duree_heures_defaut` |
| `{{session_date_debut}}` | `session_date_debut` | ✅ | `session.date_debut` |
| `{{session_date_fin}}` | `session_date_fin` | ✅ | `session.date_fin` |

**Aucun nouveau résolveur requis.** Les valeurs exactes sont déjà assertées dans
`server/test/resolversCanoniques.test.js` (`formation_intitule`="Aide à
 domicile", `formation_duree_heures`=400, `session_date_debut`="05/01/2026",
`session_date_fin`="05/03/2026").

Les champs **manuels** (prescripteur, interlocuteur, date d'entretien, synthèse
administrative) sont volontairement **non résolubles** : jamais inventés, laissés
à la saisie humaine dans le document.

---

## 7. Dépendances restantes (format attendu, variables manquantes, décisions)

### Travaux réalisés hors ligne (A)

- Moteur documentaire complet et testé pour toutes les données résolubles
  (164 variables, 46 résolveurs, 10 blocs).
- « Compte rendu prescripteur » : 4 marqueurs **confirmés et déjà résolus** —
  aucune adaptation technique supplémentaire nécessaire.
- « Emploi du temps » : bloc `seances` prêt (date, heure, thème, lieu,
  compétences, activités) — la structure exacte du tableau reste à lire sur le
  modèle.

### Dépendances restantes (B)

| Modèle | Format attendu | Variables manquantes | Décision métier nécessaire |
|---|---|---|---|
| Compte rendu prescripteur | accès Google (copie) ou texte/DOCX | aucune (4 marqueurs OK) — champs manuels | portée à confirmer (session) |
| Analyse des besoins FSE-IA | accès Google + DOC-9D2 | résolveurs `entretiens` (14 rubriques) | — (dépend du form DOC-9D2) |
| Emploi du temps | accès Google (copie) ou texte | `seance_numero`, `seance_duree_heures` (bloc) | structure de tableau |
| Convention de formation | accès Google | `financeur_nom`, `convention_reference`, `prescripteur_contact_*` | données financeur/prescripteur |
| Livret d'accueil | accès Google | `organisme_*`, `referent_handicap_*` | données organisme + référent handicap |
| Certificat de réalisation | accès Google | `document_reference/version/redacteur/approbateur`, `signataire_*` | métadonnées document + signataires |
| Bilan de session | accès Google | `bilan_*` (BIL-01..05) | formule/indicateurs du bilan |
| Indicateurs de résultats | accès Google | `indicateur_*` (IND-01..04) | formule officielle |

---

## 8. DOC-10C — Connecteur Google Drive natif disponible + pilote

### Levée du blocage d'accès Drive

Un connecteur Google Drive natif (`claude.ai Google Drive`) est disponible et
autorisé dans l'environnement d'exécution de cette session — distinct de la
méthode indirecte (identifiants Railway/production) utilisée en DOC-2.5/DOC-7E.
Il permet la **lecture réelle** de n'importe quel modèle Drive (métadonnées,
texte intégral) sans configuration supplémentaire.

**Limite constatée** : ce connecteur n'expose que `search`, `get_metadata`,
`read_content`, `download_content`, `copy`, `create`, `update` (titre/parent),
`trash` — **aucune opération `docs.documents.batchUpdate`** (remplacement de
texte, style, tableaux). Il ne peut donc **pas** rejouer le chemin de code réel
de Vigie (`genererDocuments` → `copierEtRemplir`, qui appelle directement
`batchUpdate`). Une copie faite avec ce connecteur ne prouverait rien sur le
moteur de génération lui-même. La validation réelle du moteur reste donc
conditionnée à l'OAuth propre de Vigie (compte Drive connecté dans
l'application), testé par l'autrice en conditions réelles — jamais recréée ici
avec des identifiants de production à la chaîne pour chaque modèle.

### Pilote : Compte rendu prescripteur / entreprise

- Modèle relu intégralement (texte réel, y compris son unique tableau — une
  mise en page statique, sans ligne à dupliquer, donc hors périmètre du moteur
  de blocs `blocsTableaux.js`).
- Les 4 marqueurs canoniques confirmés en DOC-10B sont vérifiés par un test
  d'intégration (`server/test/generationCompteRenduPrescripteur.test.js`) qui
  rejoue le texte réel du modèle à travers `genererDocuments()` avec un client
  Google simulé : un seul document produit par session (portée `session`, pas
  par stagiaire), les 4 marqueurs correctement substitués, aucune balise
  envoyée pour les champs manuels (texte libre, jamais inventé).
- **Aucun code moteur modifié** : les résolveurs et le moteur de blocs
  couvrent déjà ce modèle sans adaptation.
- **Reste à faire avant un usage réel** : enregistrer le modèle en base
  (`POST /api/modeles`, action humaine via l'interface, hors périmètre de ce
  chantier technique) et laisser l'autrice réaliser un test de génération réel
  dans l'application (OAuth Vigie), sur une session de test, jamais sur un
  dossier de stagiaire réel.

### Lot A relu (Emploi du temps, Convention, Livret d'accueil)

Le dossier Drive des modèles officiels A2C (`1IBuxEq-wgkg3vwUCaaETfHoSDuxCF1nF`)
a été entièrement listé (lecture seule, métadonnées + contenu). Constat :

- `MODELE_Emploi_Du_Temps`, `MODELE_Convention_Formation`, `MODELE_Livret_Accueil`,
  `MODELE_Certificat_Realisation`, `MODELE_Analyse_Besoins`, `MODELE_Reglement_Interieur`,
  `MODELE_Compte_Rendu_Entretien`, `MODELE_Emargement`, `MODELE_Quiz_Positionnement`,
  `MODELE_Resultats_Quiz`, `MODELE_Satisfaction_Stagiaire`, `MODELE_Satisfaction_Formateur`,
  `MODELE_Livret_Suivi_Pedagogique`, `MODELE_Preuve_Remise_Supports`,
  `MODELE_Attestation_Fin_Formation` sont **tous vides (0 caractère, taille Drive
  identique de 1024 octets)**. → **∅**, confirmés, aucun contenu à inventer.
  (`MODELE_Livret_Suivi_Pedagogique` est un doublon vide sans rapport avec le
  Livret FSE-IA déjà fonctionnel, trouvé ailleurs sur le Drive.)
- Une « Convention individuelle de formation » RÉELLE et complète existe
  ailleurs sur le Drive (hors dossier officiel), mais **ne contient aucune
  balise `{{…}}`** : c'est un document figé à usage manuel (champs de
  signature en blanc), pas un modèle exploitable par le moteur de
  substitution sans décision métier (faut-il le templatiser ? avec quelles
  variables ?). Reste ❓🔒.
- `MODELE_Indicateurs_Resultats` (classeur) et `MODELE_Bilan_Session` (document)
  existent et sont non vides, mais il s'agit d'un **exemple réel rempli pour
  une session passée (2024, « Café numérique e-Senior »)**, pas d'un gabarit
  générique à balises : aucune formule de calcul exploitable n'y est écrite
  (les chiffres sont déjà calculés, pas la méthode). Confirme la structure
  attendue (satisfaction / assiduité / atteinte des objectifs pédagogiques /
  abandon) mais ne lève PAS le besoin de décision métier sur la formule
  officielle `IND-01..04` ni `bilan_*`. Reste ❓🔒.

### ⚠️ Alerte confidentialité (à signaler, pas une action technique)

Une recherche Drive générique sur « besoins » a fait remonter un fichier
dont le TITRE contient « Modèle » mais dont le CONTENU est un formulaire
**rempli avec l'identité et des informations de handicap d'une personne
réelle** (pas un gabarit vide). Ce fichier n'a été ni copié, ni modifié, ni
cité ici avec son contenu détaillé — seule son existence et sa nature sont
signalées. Point d'attention pour l'autrice : vérifier le rangement / les
droits d'accès de ce fichier sur le Drive (un formulaire rempli ne devrait
pas être dans un dossier de modèles vierges). Aucune autre exploration large
par mot-clé n'a été tentée après cette découverte, pour éviter de faire
remonter d'autres données personnelles sans nécessité.

**DOC-10D : consigne appliquée.** Le document sensible n'a pas été rouvert,
pas modifié, pas extrait. Seule la vérification de rangement/permissions
reste à faire, par A2C — aucune action technique ne peut la remplacer.

---

## 9. DOC-10D — Plusieurs documents par session (compte rendu prescripteur)

### Constat

Le besoin métier confirmé par l'autrice : une session peut donner lieu à
**plusieurs entretiens prescripteur/entreprise**, chacun devant produire SON
propre document — sans qu'un deuxième entretien écrase le premier.
`documents_generes` imposait jusqu'ici UN SEUL document vivant par
(modèle, session, groupe, stagiaire) : un index unique conçu pour les
documents liés à une entité précise (« régénérer remplace »), inadapté à un
document réutilisable par occurrence.

### Solution technique (migration 028, additive)

- `modeles_documents.generation_multiple` (booléen, `false` par défaut) :
  active, PAR MODÈLE, la possibilité de produire plusieurs documents
  indépendants pour la même session. Refusé pour la portée `stagiaire`
  (chaque stagiaire a déjà son document propre).
- `documents_generes.libelle` (texte libre, nullable) : distingue deux
  générations du même modèle pour la même session (ex. le prescripteur
  concerné). Jamais interprété par le moteur de substitution, jamais une
  donnée obligatoire pour les modèles existants.
- L'index unique inclut désormais `COALESCE(libelle, '')` : deux libellés
  différents ne se remplacent JAMAIS ; le même libellé continue de se
  remplacer, exactement comme avant pour tous les autres modèles (libellé
  `NULL` partout ⇒ comportement identique à l'ancien index, aucune
  régression sur Convocation/Attestation/Livret).
- `POST /api/generations` accepte un `libelle` optionnel (200 caractères
  max) ; `genererDocuments()` l'exige si `generation_multiple` est vrai, le
  refuse sinon — jamais de valeur inventée à sa place.
- `POST /api/modeles` accepte `generation_multiple` à la création.

### Tests

`server/test/generationCompteRenduPrescripteur.test.js` (+4, total 7) :
un libellé différent crée un nouveau document sans toucher aux précédents ;
le même libellé sans confirmation est bloqué (409, comportement inchangé) ;
un modèle `generation_multiple` exige un libellé ; un modèle ordinaire
refuse un libellé inattendu. `transversal.test.js`/`qualite.test.js` : compteurs
de migrations 27 → 28.

### Validation

Backend **821/821**, frontend **359/359**, build OK, `git diff --check` propre.

### Reste à faire

Enregistrer réellement le modèle avec `generation_multiple: true` (action
humaine via l'interface) et vérifier le parcours de génération multiple dans
l'application elle-même (OAuth Vigie) — non testé en conditions réelles ici.

---

## 10. DOC-10D — Propositions de modèles pour les documents vides

**Aucune de ces propositions n'est un document officiel.** Elles ne
s'appuient QUE sur des sources déjà lues dans ce chantier (sans nouvelle
recherche Drive) : la convention réelle trouvée en DOC-10C, l'exemple réel
de bilan de session (DOC-10C), les champs déjà suivis par Vigie (blocs
`seances`/`absences`/`evaluations`, variables canoniques), et les règles
métier déjà documentées (`PROJECT_HANDOFF.md`). Aucune formule d'indicateur,
aucune signature, aucune décision administrative n'est inventée.

### 10.1 Emploi du temps (à partir du planning réel déjà suivi)

Vigie suit déjà, par séance (`seances`), tout ce qu'un emploi du temps
affiche : `date_seance`, `heure_debut`, `heure_fin`, `theme`, `competences`,
`activites`, `lieu`, `phase_numero`, `groupe_nom` (bloc déjà rendu en
tableau par `blocsTableaux.js` pour le Livret FSE-IA).

- **Automatique** : toutes les colonnes ci-dessus, pour chaque séance de la
  session (bloc `seances`), + `formation_intitule`, `session_date_debut`,
  `session_date_fin`, `session_lieu`.
- **Manuel** : aucun — un emploi du temps n'a normalement pas de champ à
  remplir à la main.
- **Validation nécessaire** : la mise en page exacte (un modèle Google Doc
  ou Sheet doit être créé par A2C avec ce tableau de colonnes et les
  marqueurs correspondants ; Vigie ne peut pas créer ce fichier Drive
  elle-même).
- **Statut** : techniquement prêt dès qu'un fichier Drive portant ces
  balises existe — **Proposition à valider**.

### 10.2 Convention de formation (à partir de la convention réelle trouvée)

La « Convention individuelle de formation » réelle (lue en DOC-10C, 11
articles) ne contient aucune balise, mais sa structure est réutilisable :

| Article | Automatique (variable canonique) | Manuel |
|---|---|---|
| 1 — Objet | `formation_intitule` | — |
| 2 — Objectifs | `formation_objectif_general` | programme détaillé (document séparé, déjà le cas) |
| 4 — Organisation | `session_date_debut`, `session_date_fin`, `session_lieu`, `session_horaires` | — |
| 8 — Conditions financières | — | gratuité déjà actée dans le texte réel ; `financeur_nom` si jamais facturé |
| 11 — Signature | — | nom/qualité/signature A2C + stagiaire (manuscrite, jamais générée) |

- **Validation nécessaire** : articles 7 (règlement intérieur) et 9 (RGPD)
  engagent juridiquement l'association — toute reformulation doit être
  relue par A2C avant usage, je ne propose aucun changement de leur texte.
- **Statut** : **Proposition à valider** (templatiser la convention réelle
  avec ces 5 marqueurs, le reste du texte inchangé).

### 10.3 Livret d'accueil

Aucun contenu réel non nominatif n'a été trouvé pour ce modèle (le fichier
officiel est vide ; le seul autre « livret d'accueil » trouvé sur le Drive
est un document sans rapport, un registre d'accessibilité). Je ne propose
donc qu'une **structure**, pas un texte :

- **Automatique** : `organisme_nom`, `formation_intitule`,
  `formation_public_vise`, `formation_prerequis`, `formation_accessibilite`,
  `session_lieu`, `session_horaires`.
- **Manuel / à rédiger par A2C** : présentation de l'association, règlement
  intérieur (déjà un document séparé), contact du référent handicap
  (`referent_handicap_*` n'existe dans aucune table Vigie actuellement —
  décision métier : faut-il l'ajouter ?).
- **Validation nécessaire** : tout le texte de présentation (ton, contenu)
  — je n'écris aucune phrase de présentation à la place d'A2C.
- **Statut** : **Proposition à valider** (structure seulement, contenu à
  rédiger par A2C).

### 10.4 Certificat de réalisation

- **Automatique** : `stagiaire_nom_complet`, `formation_intitule`,
  `session_date_debut`, `session_date_fin`, `session_duree_heures` (ou
  `presence_heures_realisees` si le certificat doit indiquer les heures
  réellement suivies plutôt que prévues — décision métier), `document_date`.
- **Manuel** : `document_reference`/`document_version` (numérotation
  qualité, aucune règle connue dans Vigie), `signataire_nom`/`signataire_qualite`
  (jamais une signature générée).
- **Validation nécessaire** : la mention exacte attendue par Qualiopi
  (« certificat de réalisation » a un format consacré) — je ne rédige pas
  cette mention, c'est un texte à valeur de preuve Qualiopi.
- **Statut** : **Proposition à valider**.

### 10.5 Bilan de session (à partir de l'exemple réel 2024)

L'exemple réel trouvé en DOC-10C donne une structure exploitable (sections
1 à 7). Proposition de template à partir de cette structure, **sans aucune
formule inventée** :

| Section | Automatique | Reste bloqué |
|---|---|---|
| 2 — Contexte | `formation_intitule`, `formation_public_vise`, `session_date_debut`, `session_date_fin`, `session_nombre_inscrits`, `session_nombre_termines` | — |
| 3.1 — Satisfaction | — | aucune formule officielle de taux global (le bloc `evaluations` donne des scores individuels, pas un agrégat session) |
| 3.2 — Assiduité | — | `presence_taux`/`absence_taux` sont calculés PAR STAGIAIRE (lot L2) ; aucune formule d'agrégation session validée |
| 3.3 — Objectifs pédagogiques | — | aucune notion de « compétence acquise/en cours/non acquise » dans les tables Vigie actuelles |
| 3.4 — Abandons | `abandon_statut` par stagiaire, comptable | formule du taux (nombre/nombre inscrits ?) non validée officiellement |
| 4/5 — Analyse | — | texte rédactionnel, jamais généré automatiquement (analyse pédagogique humaine) |

- **Validation nécessaire** : la méthode de calcul de CHAQUE taux (3.1 à
  3.4) avant tout résolveur — exactement le blocage déjà identifié en
  DOC-10/DOC-10B/DOC-10C, confirmé à nouveau par la lecture de l'exemple
  réel (qui donne des résultats déjà calculés, jamais la méthode).
- **Statut** : **Proposition à valider** pour la structure et le contexte
  (section 2) ; **bloqué** pour les sections 3/4/5 tant que la méthode de
  calcul n'est pas validée par A2C.
