// DOC-2 — Modèles de documents : diagnostic du fichier Drive affiché dans
// le Drawer « Détail » (badge d'état, occurrences/balises, suggestions de
// migration), une seule lecture par ouverture, « Réanalyser » explicite.
import "./dom.mjs";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, champ, cliquer, demonter, dialogue, monter, saisir, texte } from "./outils.jsx";

const soumettre = async (id) => cliquer(document.querySelector(`button[type="submit"][form="${id}"]`));

const MODELES = { modeles: [{ id: 3, nom: "Attestation", portee: "stagiaire", drive_url: "https://d/3", drive_mime: null, indicateurs: [] }], marqueurs: ["civilite"] };
const DIAG_VALIDE = {
  etat: "valide", version_dictionnaire: "1.1", type_fichier: "document", analyse_le: "2026-10-10T10:00:00Z",
  nombre_occurrences_balises: 2, nombre_balises_uniques: 2,
  canoniques: ["formation_intitule", "session_date_debut"], alias: [], historiques: [], blocs: [], champs_bloc: [], inconnues: [],
  erreurs: [], avertissements: [], suggestions: [],
};
const DIAG_AVERTISSEMENT = {
  ...DIAG_VALIDE, etat: "valide_avec_avertissements",
  alias: [{ alias: "nom_stagiaire", canonique: "stagiaire_nom" }],
  avertissements: [{ code: "ALIAS", message: "{{nom_stagiaire}} est un alias historique de {{stagiaire_nom}} : utilisez le nom canonique.", balise: "{{nom_stagiaire}}", position: 0 }],
  suggestions: [{ balise: "{{nom_stagiaire}}", type: "alias", cible_conseillee: "{{stagiaire_nom}}", cibles_alternatives: [] }],
};
const DIAG_INVALIDE = {
  ...DIAG_VALIDE, etat: "invalide",
  inconnues: ["note_phase1"],
  erreurs: [{ code: "VARIABLE_INCONNUE", message: "Variable inconnue : {{note_phase1}}.", balise: "{{note_phase1}}", position: 0 }],
};

afterEach(async () => { await demonter(); });

test("ouverture du détail : un diagnostic se charge, badge « Valide »", async () => {
  let appels = 0;
  await monter("/modeles", "admin", {
    "GET /api/modeles": MODELES,
    "GET /api/modeles/3/diagnostic": () => { appels++; return DIAG_VALIDE; },
  });
  await attendre(() => texte().includes("Attestation"));
  await cliquer(bouton("Détail"));
  await attendre(() => texte().includes("🟢 Valide"));
  assert.equal(appels, 1, "une seule analyse pour cette ouverture");
  assert.ok(texte().includes("2 occurrence(s) de balise"));
  assert.ok(texte().includes("Google Docs"));
});

test("avertissements : badge orange, suggestion de migration affichée", async () => {
  await monter("/modeles", "admin", { "GET /api/modeles": MODELES, "GET /api/modeles/3/diagnostic": DIAG_AVERTISSEMENT });
  await attendre(() => texte().includes("Attestation"));
  await cliquer(bouton("Détail"));
  await attendre(() => texte().includes("🟠 Avertissements"));
  assert.ok(texte().includes("{{nom_stagiaire}}"));
  assert.ok(texte().includes("cible conseillée"));
  assert.ok(texte().includes("{{stagiaire_nom}}"));
});

test("erreur : badge rouge, variable inconnue listée", async () => {
  await monter("/modeles", "admin", { "GET /api/modeles": MODELES, "GET /api/modeles/3/diagnostic": DIAG_INVALIDE });
  await attendre(() => texte().includes("Attestation"));
  await cliquer(bouton("Détail"));
  await attendre(() => texte().includes("🔴 Invalide"));
  assert.ok(texte().includes("note_phase1"));
});

test("« Réanalyser » force explicitement une nouvelle lecture", async () => {
  let appels = 0;
  await monter("/modeles", "admin", {
    "GET /api/modeles": MODELES,
    "GET /api/modeles/3/diagnostic": () => { appels++; return DIAG_VALIDE; },
  });
  await attendre(() => texte().includes("Attestation"));
  await cliquer(bouton("Détail"));
  await attendre(() => texte().includes("🟢 Valide"));
  assert.equal(appels, 1);
  await cliquer(bouton("Réanalyser"));
  await attendre(() => appels === 2);
});

test("la liste des modèles ne déclenche aucun appel de diagnostic", async () => {
  let appels = 0;
  await monter("/modeles", "admin", {
    "GET /api/modeles": MODELES,
    "GET /api/modeles/3/diagnostic": () => { appels++; return DIAG_VALIDE; },
  });
  await attendre(() => texte().includes("Attestation"));
  assert.equal(appels, 0, "aucune lecture Drive au simple affichage de la liste");
});

// ── Bibliothèque : type, mode de génération, modification, réactivation ──
const MODELE_BIBLIO = {
  id: 7, nom: "Convocation session", portee: "session", description: "", type_document: "convocation",
  mode_generation: "conditionnel", condition_generation: "Si la session est en intra-entreprise",
  declencheur: "inscription", condition_code: "situation_handicap",
  drive_url: "https://docs.google.com/document/d/CONV1234567890/edit", drive_mime: "application/vnd.google-apps.document",
  indicateurs: [{ id: 111, numero: 11 }],
};
const REFERENTIEL_BIBLIO = {
  version: { id: 1, code: "V9" }, totalIndicateurs: 2,
  score: { maitrise: 0, a_consolider: 0, a_risque: 0, non_applicable: 0, total: 2, preuves: 0, a_confirmer: 0 },
  criteres: [{ id: 3, numero: 3, libelle: "Adaptation", indicateurs: [
    { id: 109, numero: 9, libelle: "Information" }, { id: 111, numero: 11, libelle: "Évaluation" },
  ] }],
};

test("liste : le type de document et le mode conditionnel sont visibles", async () => {
  await monter("/modeles", "admin", {
    "GET /api/modeles": { modeles: [MODELE_BIBLIO], marqueurs: [] },
    "GET /api/referentiel": REFERENTIEL_BIBLIO,
  });
  await attendre(() => texte().includes("Convocation session"));
  assert.ok(texte().includes("Convocation"), "type de document affiché");
  assert.ok(texte().includes("génération conditionnelle"), "mode affiché hors mode manuel");
});

test("modification : le détail ouvre le formulaire prérempli, seuls les champs changés partent", async () => {
  const appels = await monter("/modeles", "admin", {
    "GET /api/modeles": { modeles: [MODELE_BIBLIO], marqueurs: [] },
    "GET /api/referentiel": REFERENTIEL_BIBLIO,
    "GET /api/modeles/7/diagnostic": DIAG_VALIDE,
    "PATCH /api/modeles/7": { ok: true, modele: MODELE_BIBLIO },
  });
  await attendre(() => texte().includes("Convocation session"));
  await cliquer(document.querySelector('button[aria-label="Voir le détail du modèle Convocation session"]'));
  await attendre(() => texte().includes("Si la session est en intra-entreprise"));
  await cliquer(bouton("Modifier"));
  await attendre(() => dialogue()?.textContent.includes("Modifier le modèle"));
  assert.equal(champ("Nom").value, "Convocation session");
  assert.equal(champ("Type de document").value, "convocation");
  assert.equal(champ("Mode de génération").value, "conditionnel");
  await saisir(champ("Nom"), "Convocation intra");
  await soumettre("form-modele");
  await attendre(() => appels.some((a) => a.methode === "PATCH"));
  const corps = appels.find((a) => a.methode === "PATCH").corps;
  assert.equal(corps.nom, "Convocation intra");
  assert.equal(corps.lien, undefined, "lien inchangé : non renvoyé");
  assert.equal(corps.condition_generation, "Si la session est en intra-entreprise");
  assert.equal(corps.declencheur, "inscription", "déclencheur conservé");
  assert.equal(corps.condition_code, "situation_handicap", "condition conservée");
});

test("mode conditionnel : moment et condition obligatoires avant envoi, puis envoyés", async () => {
  const appels = await monter("/modeles", "admin", {
    "GET /api/modeles": { modeles: [MODELE_BIBLIO], marqueurs: [] },
    "GET /api/referentiel": REFERENTIEL_BIBLIO,
    "POST /api/modeles": [201, { modele: { id: 8 } }],
  });
  await attendre(() => texte().includes("Convocation session"));
  await cliquer(bouton("+ Nouveau modèle"));
  await attendre(() => dialogue()?.textContent.includes("Critère 3"));
  await saisir(champ("Mode de génération"), "conditionnel");
  await saisir(champ("Nom"), "Attestation conditionnelle");
  await saisir(champ("Type de document"), "attestation");
  await saisir(champ("Lien ou identifiant du fichier Drive"), "https://docs.google.com/document/d/ABCDEFGHIJKLMN/edit");
  await cliquer(dialogue().querySelector(".indic-groupe__tete"));
  await cliquer([...dialogue().querySelectorAll("label")].find((l) => l.textContent.includes("Indicateur 9")).querySelector("input"));
  await soumettre("form-modele");
  await attendre(() => texte().includes("Choisissez quand le document est généré."));
  assert.ok(texte().includes("Choisissez la condition."));
  assert.equal(appels.filter((a) => a.methode === "POST").length, 0);

  await saisir(champ("Moment de la génération"), "inscription");
  await saisir(champ("Condition"), "besoin_adaptation");
  await soumettre("form-modele");
  await attendre(() => appels.some((a) => a.methode === "POST"));
  const corps = appels.find((a) => a.methode === "POST").corps;
  assert.deepEqual([corps.mode_generation, corps.declencheur, corps.condition_code, corps.condition_generation],
    ["conditionnel", "inscription", "besoin_adaptation", null], "précision facultative : libellé repris par le serveur");
});

test("mode manuel : ni moment ni condition envoyés", async () => {
  const appels = await monter("/modeles", "admin", {
    "GET /api/modeles": { modeles: [MODELE_BIBLIO], marqueurs: [] },
    "GET /api/referentiel": REFERENTIEL_BIBLIO,
    "POST /api/modeles": [201, { modele: { id: 8 } }],
  });
  await attendre(() => texte().includes("Convocation session"));
  await cliquer(bouton("+ Nouveau modèle"));
  await attendre(() => dialogue()?.textContent.includes("Critère 3"));
  assert.equal(champ("Moment de la génération"), null);
  await saisir(champ("Nom"), "Attestation manuelle");
  await saisir(champ("Type de document"), "attestation");
  await saisir(champ("Lien ou identifiant du fichier Drive"), "https://docs.google.com/document/d/ABCDEFGHIJKLMN/edit");
  await cliquer(dialogue().querySelector(".indic-groupe__tete"));
  await cliquer([...dialogue().querySelectorAll("label")].find((l) => l.textContent.includes("Indicateur 9")).querySelector("input"));
  await soumettre("form-modele");
  await attendre(() => appels.some((a) => a.methode === "POST"));
  const corps = appels.find((a) => a.methode === "POST").corps;
  assert.deepEqual([corps.mode_generation, corps.declencheur, corps.condition_code], ["manuel", null, null]);
});

test("modèles désactivés : liste dédiée et réactivation", async () => {
  const desactive = { ...MODELE_BIBLIO, id: 9, nom: "Ancien émargement", mode_generation: "manuel", condition_generation: null };
  const appels = await monter("/modeles", "admin", {
    "GET /api/modeles": { modeles: [MODELE_BIBLIO], marqueurs: [] },
    "GET /api/modeles?inactifs=1": { modeles: [desactive] },
    "GET /api/referentiel": REFERENTIEL_BIBLIO,
    "POST /api/modeles/9/reactiver": { ok: true, modele: { id: 9 } },
  });
  await attendre(() => texte().includes("Convocation session"));
  await cliquer(bouton("Afficher les modèles désactivés"));
  await attendre(() => texte().includes("Ancien émargement"));
  await cliquer(document.querySelector('button[aria-label="Réactiver le modèle Ancien émargement"]'));
  await attendre(() => texte().includes("réactivé"));
  assert.equal(appels.filter((a) => a.methode === "POST" && a.chemin === "/api/modeles/9/reactiver").length, 1);
});
