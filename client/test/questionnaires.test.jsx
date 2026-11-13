// Questionnaires de formation (administration) : choix de la formation, ajout d'une question
// à choix, réorganisation et retrait avec confirmation.
import "./dom.mjs";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, champ, cliquer, demonter, dialogue, monter, saisir, texte } from "./outils.jsx";

afterEach(demonter);

const FORMATIONS = { formations: [{ id: 1, intitule: "Aide à domicile" }, { id: 2, intitule: "Agent de propreté" }] };
const QUESTIONS = {
  questionnaire: { id: 9, formation_id: 1, nom: "Questionnaire — Aide à domicile", actif: true },
  questions: [
    { id: 5, ordre: 1, libelle: "Votre objectif ?", type: "texte_libre", options: [], obligatoire: true, archivee: false },
    { id: 6, ordre: 2, libelle: "Votre niveau ?", type: "choix_unique", options: ["Débutant", "Confirmé"], obligatoire: false, archivee: false },
  ],
};

test("ajout d'une question à choix : options envoyées, formation choisie", async () => {
  const appels = await monter("/questionnaires", "admin", {
    "GET /api/formations": FORMATIONS,
    "GET /api/formations/1/questionnaire": QUESTIONS,
    "POST /api/formations/1/questionnaire/questions": [201, { question: { id: 7 } }],
  });
  await attendre(() => texte().includes("Votre niveau ?"));
  await cliquer(bouton("+ Ajouter une question"));
  await attendre(() => dialogue()?.textContent.includes("Nouvelle question"));
  await saisir(champ("Libellé"), "Disposez-vous du permis ?");
  await saisir(champ("Type de réponse"), "choix_unique");
  await attendre(() => champ("Option 1"));
  await saisir(champ("Option 1"), "Oui");
  await saisir(champ("Option 2"), "Non");
  await cliquer(dialogue().querySelector('button[type="submit"]'));
  await attendre(() => appels.some((a) => a.methode === "POST"));
  assert.deepEqual(appels.find((a) => a.methode === "POST").corps,
    { libelle: "Disposez-vous du permis ?", type: "choix_unique", obligatoire: false, options: ["Oui", "Non"] });
});

test("réorganiser puis retirer une question (confirmation)", async () => {
  const appels = await monter("/questionnaires", "admin", {
    "GET /api/formations": FORMATIONS,
    "GET /api/formations/1/questionnaire": QUESTIONS,
    "PUT /api/formations/1/questionnaire/questions/ordre": { ok: true },
    "DELETE /api/questionnaire-questions/6": { ok: true },
  });
  await attendre(() => texte().includes("Votre niveau ?"));
  await cliquer(document.querySelector('button[aria-label="Descendre « Votre objectif ? »"]'));
  await attendre(() => appels.some((a) => a.methode === "PUT"));
  assert.deepEqual(appels.find((a) => a.methode === "PUT").corps, { ordre: [6, 5] });
  const retirer = [...document.querySelectorAll("button")].filter((b) => b.textContent === "Retirer");
  await cliquer(retirer[1]);
  await attendre(() => dialogue());
  assert.ok(!appels.some((a) => a.methode === "DELETE"), "rien avant confirmation");
  const confirmer = [...dialogue().querySelectorAll("button")].find((b) => b.textContent !== "Annuler");
  await cliquer(confirmer);
  await attendre(() => appels.some((a) => a.methode === "DELETE" && a.chemin === "/api/questionnaire-questions/6"));
});
