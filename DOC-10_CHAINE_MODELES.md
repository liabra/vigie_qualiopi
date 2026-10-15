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
| Compte rendu prescripteur/entreprise | 🟡 (techniquement prêt, test réel restant) | session | `formation_intitule`, `formation_duree_heures`, `session_date_debut`, `session_date_fin` (4 marqueurs confirmés, lus réellement sur Drive le 15/10/2026) | champs manuels (prescripteur, interlocuteur, date entretien, synthèse) — volontairement non résolus | enregistrer le modèle (`POST /api/modeles`) + test réel de génération (OAuth Vigie) |
| Convention de formation | ❓🔒 | session/formation | `formation_*`, `session_*`, `prescripteur_nom` | `financeur_nom`, `convention_reference`, `prescripteur_contact_*` | données financeur + Drive |
| Livret d'accueil | ❓🔒 | formation | `organisme_nom` (ORG-01) | `organisme_*`, `referent_handicap_*` | données organisme + Drive |
| Emploi du temps | 🟡 (préparé) | session | bloc `seances` (date/heure/theme/lieu/compétences/activités) | `seance_numero`, `seance_duree_heures` | lecture modèle + Drive |
| Certificat de réalisation | ❓🔒 | stagiaire | `document_date` | `document_reference/version/redacteur/approbateur`, `signataire_*` | métadonnées document + Drive |
| Bilan de session | ❓🔒 | session | — | `bilan_*` (BIL-01..05, aucun résolveur) | définition métier + Drive |
| Indicateurs de résultats | ❓🔒 | formation | — | `indicateur_*` (IND-01..04, aucune formule) | formule officielle + Drive |
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
