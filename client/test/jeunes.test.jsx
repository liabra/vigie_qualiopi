// DOC-9D1 — Page « Jeunes » : liste, ajout hors session, doublons, sans suite,
// réouverture, suppression (admin, avec confirmation), droits. API simulée.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, champ, cliquer, demonter, dialogue, monter, saisir, texte, touche } from "./outils.jsx";

beforeEach(() => {
  window.alert = () => { throw new Error("window.alert interdit"); };
  window.confirm = () => { throw new Error("window.confirm interdit"); };
});
afterEach(demonter);

const soumettre = async (id) => cliquer(document.querySelector(`button[type="submit"][form="${id}"]`));

const JEUNE = {
  id: 1, civilite: "Mme", nom: "Durand", prenom: "Élodie", email: "elodie.durand@exemple.fr", telephone: "0600000000",
  sans_suite_le: null, nb_inscriptions: 0, nb_entretiens: 1, entretiens_en_cours: 1, entretiens_valides: 0,
};
const INSCRIT = { ...JEUNE, id: 2, nom: "Martin", prenom: "Alice", email: "alice.martin@exemple.fr", nb_inscriptions: 1, nb_entretiens: 0, entretiens_en_cours: 0, entretiens_valides: 0 };
const SANS_SUITE = { ...JEUNE, id: 3, nom: "Bernard", prenom: "Paul", email: null, sans_suite_le: "2026-10-01T00:00:00Z", nb_entretiens: 0, entretiens_en_cours: 0, entretiens_valides: 0 };

const LISTE = { stagiaires: [JEUNE, INSCRIT, SANS_SUITE], total: 3 };

test("jeunes : liste lisible (état, entretiens, contact) sans données médicales", async () => {
  await monter("/jeunes", "admin", { "GET /api/stagiaires": LISTE });
  await attendre(() => texte().includes("Durand"));
  assert.equal(document.querySelector("h1").textContent, "Jeunes");
  assert.ok(texte().includes("Entretien en cours"), "badge entretien");
  assert.ok(texte().includes("Inscrit"), "badge inscrit");
  assert.ok(texte().includes("Sans suite"), "badge sans suite");
  assert.ok(texte().includes("0600000000"));
  assert.ok(!/handicap|besoins d'adaptation|médical/i.test(texte()), "aucune donnée médicale affichée");
});

test("jeunes : ajouter un jeune hors session (identité + contact)", async () => {
  const appels = await monter("/jeunes", "admin", {
    "GET /api/stagiaires": { stagiaires: [], total: 0 },
    "POST /api/stagiaires": [201, { stagiaire: { id: 9 }, correspondances: [] }],
  });
  await attendre(() => texte().includes("Aucun jeune"));
  await cliquer(bouton("+ Ajouter un jeune"));
  await attendre(() => dialogue()?.textContent.includes("Ajouter un jeune"));
  await soumettre("form-jeune");
  await attendre(() => texte().includes("Indiquez le nom."));
  await saisir(champ("Nom"), "Lefebvre");
  await saisir(champ("Prénom"), "Noah");
  await saisir(champ("E-mail"), "noah@exemple.fr");
  await soumettre("form-jeune");
  await attendre(() => appels.some((a) => a.methode === "POST" && a.chemin === "/api/stagiaires"));
  assert.deepEqual(appels.find((a) => a.methode === "POST").corps, {
    civilite: null, nom: "Lefebvre", prenom: "Noah", email: "noah@exemple.fr", telephone: null,
  });
  await attendre(() => texte().includes("Lefebvre"));
});

test("jeunes : doublons possibles signalés après création, sans blocage", async () => {
  const appels = await monter("/jeunes", "admin", {
    "GET /api/stagiaires": { stagiaires: [], total: 0 },
    "POST /api/stagiaires": [201, { stagiaire: { id: 9 }, correspondances: [{ id: 1, civilite: null, nom: "Lefebvre", prenom: "Noah", email: "noah@exemple.fr" }] }],
  });
  await attendre(() => bouton("+ Ajouter un jeune"));
  await cliquer(bouton("+ Ajouter un jeune"));
  await attendre(() => dialogue());
  await saisir(champ("Nom"), "Lefebvre");
  await saisir(champ("Prénom"), "Noah");
  await soumettre("form-jeune");
  await attendre(() => appels.some((a) => a.methode === "POST"));
  await attendre(() => texte().includes("Des dossiers similaires existent déjà"));
  assert.ok(texte().includes("Noah"), "le doublon est présenté");
});

test("jeunes : classer sans suite puis rouvrir", async () => {
  const appels = await monter("/jeunes", "admin", {
    "GET /api/stagiaires": LISTE,
    "POST /api/stagiaires/1/sans-suite": { stagiaire: {} },
    "POST /api/stagiaires/3/rouvrir": { stagiaire: {} },
  });
  await attendre(() => texte().includes("Durand"));
  await cliquer(bouton("Sans suite"));
  await attendre(() => appels.some((a) => a.methode === "POST" && a.chemin === "/api/stagiaires/1/sans-suite"));
  await attendre(() => texte().includes("est classé sans suite"));
  await cliquer(bouton("Rouvrir"));
  await attendre(() => appels.some((a) => a.methode === "POST" && a.chemin === "/api/stagiaires/3/rouvrir"));
});

test("jeunes : suppression (admin) passe par une confirmation explicite", async () => {
  const appels = await monter("/jeunes", "admin", {
    "GET /api/stagiaires": LISTE,
    "DELETE /api/stagiaires/1": { ok: true },
  });
  await attendre(() => texte().includes("Durand"));
  await cliquer(document.querySelector('button[aria-label^="Supprimer"]'));
  await attendre(() => dialogue()?.getAttribute("role") === "alertdialog");
  assert.equal(document.activeElement.textContent, "Annuler", "focus sur Annuler");
  await cliquer([...dialogue().querySelectorAll("button")].find((b) => b.textContent === "Supprimer"));
  await attendre(() => appels.some((a) => a.methode === "DELETE" && a.chemin === "/api/stagiaires/1"));
  await attendre(() => texte().includes("a été supprimé"));
});

test("jeunes : contributeur ne voit pas l'action Supprimer", async () => {
  await monter("/jeunes", "contributeur", { "GET /api/stagiaires": LISTE });
  await attendre(() => texte().includes("Durand"));
  assert.ok(![...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Supprimer"), "pas de bouton Supprimer");
  assert.ok(bouton("Sans suite"), "le contributeur peut classer sans suite");
});

test("jeunes : filtre par état (serveur) — la vue inscrits ne montre que les inscrits", async () => {
  await monter("/jeunes", "admin", {
    "GET /api/stagiaires": LISTE,
    "GET /api/stagiaires?etat=inscrits": { stagiaires: [INSCRIT], total: 1 },
  });
  await attendre(() => texte().includes("Durand"));
  await saisir(document.querySelector('select'), "inscrits");
  await attendre(() => texte().includes("Alice") && !texte().includes("Élodie"));
});

test("jeunes : Échap annule la suppression, rien n'est supprimé", async () => {
  const appels = await monter("/jeunes", "admin", {
    "GET /api/stagiaires": LISTE,
    "DELETE /api/stagiaires/1": { ok: true },
  });
  await attendre(() => texte().includes("Durand"));
  await cliquer(document.querySelector('button[aria-label^="Supprimer"]'));
  await attendre(() => dialogue());
  await touche("Escape");
  await attendre(() => !dialogue());
  assert.ok(!appels.some((a) => a.methode === "DELETE"), "Échap n'a rien supprimé");
});
