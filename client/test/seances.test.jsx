// DOC-7C — Onglet « Planning / séances » : liste, filtre par groupe,
// création/modification/suppression, validation des horaires, et suivi
// pédagogique individuel (accordéon, sauvegarde, « Suivi renseigné »).
// API simulée ; aucune boîte de dialogue native ; aucune donnée sensible
// handicap/adaptation affichée.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { attendre, bouton, champ, cliquer, demonter, dialogue, monter, saisir, texte } from "./outils.jsx";

let natifs = 0;
beforeEach(() => {
  natifs = 0;
  window.alert = () => { natifs++; };
  window.confirm = () => { natifs++; return true; };
});
afterEach(async () => {
  assert.equal(natifs, 0, "aucun window.alert / window.confirm");
  await demonter();
});

const lignes = () => [...document.querySelectorAll(".sess-table tbody tr")].map((tr) => tr.textContent);
const surcharges = (s) => ({ ...s });

test("planning : liste vide → message explicite", async () => {
  await monter("/sessions/1/planning", "admin", { "GET /api/sessions/1/seances": { archivee: false, seances: [] } });
  await attendre(() => texte().includes("Aucune séance planifiée pour cette session."));
});

test("planning : chargement et ordre date → heure → id ; session entière vs groupe", async () => {
  await monter("/sessions/1/planning");
  await attendre(() => lignes().length === 2);
  const l = lignes();
  assert.ok(l[0].includes("08/09/2026") && l[0].includes("09:00 – 12:00") && l[0].includes("Groupe A") && l[0].includes("Phase 1") && l[0].includes("Accueil") && l[0].includes("Lyon 7e"));
  assert.ok(l[1].includes("10/09/2026") && l[1].includes("Session entière") && l[1].includes("Bilan"));
  assert.ok(texte().includes("Planning / séances"));
  // Le contributeur peut aussi créer (rédacteur).
  await demonter();
  await monter("/sessions/1/planning", "contributeur");
  await attendre(() => bouton("Ajouter une séance"));
});

test("planning : filtre par groupe visible seulement si plusieurs groupes", async () => {
  await monter("/sessions/1/planning", "admin", {
    "GET /api/sessions/1": { session: { id: 1, reference: "SESS-TEST", formation: "Formation test", statut: "en_cours", date_debut: "2026-09-01", date_fin: "2026-12-15", lieu: "Lyon", horaire: null, formateur: null, version_numero: 1, duree_heures_reelle: "35.00", duree_heures_defaut: "35.00" }, groupes: [{ id: 5, nom: "Groupe A", nb_inscrits: 1 }, { id: 6, nom: "Groupe B", nb_inscrits: 1 }], stagiaires: [], documents: [] },
  });
  await attendre(() => [...document.querySelectorAll(".sess-vue")].some((b) => b.textContent.includes("Groupe A")));
  await cliquer([...document.querySelectorAll(".sess-vue")].find((b) => b.textContent.includes("Groupe B")));
  // Séance 30 (Groupe A) masquée ; séance 31 (Session entière) reste visible.
  await attendre(() => lignes().length === 1 && lignes()[0].includes("Session entière"));
});

test("création : formulaire complet, validation horaire, POST", async () => {
  const appels = await monter("/sessions/1/planning", "admin", { "POST /api/sessions/1/seances": (c) => [201, { seance: { id: 99, ...c } }] });
  await attendre(() => bouton("Ajouter une séance"));
  await cliquer(bouton("Ajouter une séance"));
  await attendre(() => dialogue()?.textContent.includes("Nouvelle séance"));

  // Heure de fin ≤ début refusée.
  await saisir(champ("Date"), "2026-09-20");
  await saisir(champ("Heure de début"), "10:00");
  await saisir(champ("Heure de fin"), "09:00");
  await cliquer(bouton("Créer la séance"));
  await attendre(() => texte().includes("L'heure de fin doit être postérieure à l'heure de début."));
  assert.equal(appels.filter((a) => a.methode === "POST").length, 0, "aucun POST tant que l'horaire est invalide");

  // Correction puis envoi.
  await saisir(champ("Heure de fin"), "12:00");
  await saisir(champ("Phase"), "2");
  await saisir(champ("Thème"), "Communication");
  await saisir(document.querySelector(".seance-champs input"), "autonomie");
  await cliquer(bouton("Ajouter"));
  await saisir(champ("Activités / exercices"), "Jeu de rôle");
  await cliquer(bouton("Créer la séance"));
  await attendre(() => appels.some((a) => a.methode === "POST" && a.chemin === "/api/sessions/1/seances"));
  const corps = appels.find((a) => a.methode === "POST").corps;
  assert.equal(corps.date_seance, "2026-09-20");
  assert.equal(corps.heure_debut, "10:00");
  assert.equal(corps.heure_fin, "12:00");
  assert.equal(corps.phase_numero, 2);
  assert.deepEqual(corps.competences, ["autonomie"]);
  assert.equal(corps.activites, "Jeu de rôle");
  assert.equal(corps.groupe_id, null, "séance commune à la session");
});

test("modification : PATCH avec les champs existants", async () => {
  const appels = await monter("/sessions/1/planning", "admin", { "PATCH /api/seances/31": (c) => ({ seance: { id: 31, ...c } }) });
  await attendre(() => lignes().length === 2);
  const ligneBilan = [...document.querySelectorAll(".sess-table tbody tr")].find((tr) => tr.textContent.includes("Bilan"));
  await cliquer([...ligneBilan.querySelectorAll("button")].find((b) => b.textContent === "Modifier"));
  await attendre(() => dialogue()?.textContent.includes("Modifier la séance"));
  await saisir(champ("Thème"), "Bilan modifié");
  await cliquer(bouton("Enregistrer"));
  await attendre(() => appels.some((a) => a.methode === "PATCH" && a.chemin === "/api/seances/31"));
  assert.equal(appels.find((a) => a.methode === "PATCH").corps.theme, "Bilan modifié");
});

test("suppression : confirmation puis DELETE", async () => {
  const appels = await monter("/sessions/1/planning", "admin", { "DELETE /api/seances/30": { ok: true } });
  await attendre(() => lignes().length === 2);
  await cliquer([...document.querySelectorAll(".sess-table tbody tr")].find((tr) => tr.textContent.includes("Groupe A")).querySelector(".ui-btn--danger"));
  await attendre(() => document.querySelector('[role="alertdialog"]'));
  assert.ok(dialogue().textContent.includes("Supprimer cette séance"));
  await cliquer(bouton("Supprimer la séance"));
  await attendre(() => appels.some((a) => a.methode === "DELETE" && a.chemin === "/api/seances/30"));
});

test("suivi : liste des stagiaires, suivi absent/existant, « Suivi renseigné », aucune donnée handicap", async () => {
  await monter("/sessions/1/planning");
  await attendre(() => lignes().length === 2);
  await cliquer([...document.querySelectorAll('button[aria-label^="Ouvrir le suivi pédagogique"]')][0]);
  await attendre(() => dialogue()?.textContent.includes("Suivi pédagogique"));
  const corps = dialogue().textContent;
  assert.ok(corps.includes("Alice Martin"));
  assert.ok(corps.includes("Paul Bernard"));
  assert.ok(corps.includes("Suivi renseigné"), "indicateur sur le stagiaire avec suivi");
  // Aucune donnée handicap / besoins spécifiques.
  assert.ok(!corps.includes("handicap") && !corps.includes("Poste adapté") && !corps.includes("Accessibilité"), "rien de sensible");
});

test("suivi : accordéon + sauvegarde individuelle d'un stagiaire (PUT)", async () => {
  const appels = await monter("/sessions/1/planning", "admin", { "PUT /api/seances/30/suivi/11": (c) => ({ suivi: { seance_id: 30, inscription_id: 11, ...c } }) });
  await attendre(() => lignes().length === 2);
  await cliquer([...document.querySelectorAll('button[aria-label^="Ouvrir le suivi pédagogique"]')][0]);
  await attendre(() => dialogue()?.textContent.includes("Suivi pédagogique"));
  // Alice (sans suivi) : bouton « Renseigner ».
  await cliquer([...document.querySelectorAll(".suivi-item__tete button")].find((b) => b.textContent.includes("Renseigner")));
  await attendre(() => champ("Accompagnement mis en place"));
  await saisir(champ("Accompagnement mis en place"), "Accompagnement individuel");
  await saisir(champ("Difficultés"), "Quelques difficultés");
  await cliquer(bouton("Enregistrer le suivi"));
  await attendre(() => appels.some((a) => a.methode === "PUT" && a.chemin === "/api/seances/30/suivi/11"));
  const corps = appels.find((a) => a.methode === "PUT").corps;
  assert.equal(corps.accompagnement, "Accompagnement individuel");
  assert.equal(corps.difficultes, "Quelques difficultés");
  assert.equal(corps.impressions, null);
  assert.equal(corps.observations, null);
});

test("erreurs API visibles : chargement et sauvegarde", async () => {
  await monter("/sessions/1/planning", "admin", { "GET /api/sessions/1/seances": [500, { error: "Google est momentanément indisponible." }] });
  await attendre(() => texte().includes("Le planning n'a pas pu être chargé."));
  await demonter();
  const appels = await monter("/sessions/1/planning", "admin", { "PUT /api/seances/30/suivi/12": [400, { error: "Ce stagiaire n'appartient pas au groupe de cette séance." }] });
  await attendre(() => lignes().length === 2);
  await cliquer([...document.querySelectorAll('button[aria-label^="Ouvrir le suivi pédagogique"]')][0]);
  await attendre(() => dialogue()?.textContent.includes("Suivi pédagogique"));
  await cliquer([...document.querySelectorAll(".suivi-item__tete button")].find((b) => b.textContent.includes("Consulter")));
  await attendre(() => champ("Accompagnement mis en place"));
  await cliquer(bouton("Enregistrer le suivi"));
  await attendre(() => texte().includes("Ce stagiaire n'appartient pas au groupe de cette séance."));
});
