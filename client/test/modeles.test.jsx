// DOC-2 — Modèles de documents : diagnostic du fichier Drive affiché dans
// le Drawer « Détail » (badge d'état, occurrences/balises, suggestions de
// migration), une seule lecture par ouverture, « Réanalyser » explicite.
import "./dom.mjs";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, monter, texte } from "./outils.jsx";

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
