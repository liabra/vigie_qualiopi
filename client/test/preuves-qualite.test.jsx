// Q1-B4 — Preuves liées aux actions qualité et aux signalements : section
// « Preuves », sélecteur (recherche serveur), rattachement, retrait du LIEN
// (jamais de la preuve), droits. API simulée ; aucune boîte native.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, dialogue, monter, saisir, texte, touche } from "./outils.jsx";

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

const PREUVE_LIEE = {
  id: 60, titre: "Feuille d'émargement EduSign", statut: "maitrise", statut_effectif: "maitrise", indicateur_id: 11, indicateur: 11,
  indicateur_libelle: "Atteinte des objectifs", session_id: 5, session_reference: "ADVF-2026-09", alerte_statut: null,
  fichiers: [{ id: 1, url: "https://drive.google.com/file/d/ABC/view", nom: "Emargement.pdf", mime: "application/pdf" }],
};
const action = (sur = {}) => ({
  id: 1, reference: "AQ-2026-001", titre: "Relancer les convocations", constat: null, origine: "manuel", priorite: "haute",
  statut: "en_cours", responsable_id: 2, responsable_nom: "Tukui", cree_par_nom: "Mme Stark", echeance: null, action_prevue: null,
  date_mise_en_oeuvre: null, resultat: null, controle_efficacite: null, date_controle_efficacite: null, date_cloture: null,
  cloture_par_nom: null, signalement_id: null, formation_id: null, session_id: null, indicateurs: [], ...sur,
});
const detailAction = (sur = {}, preuves = [], historique = []) => ({ action: action(sur), historique, preuves });
const signalement = (sur = {}) => ({
  id: 1, reference: "REC-2026-001", type: "reclamation", objet: "Convocation tardive", statut: "en_traitement", date_constat: "2026-09-28",
  responsable_id: 2, responsable_nom: "Tukui", cree_par_nom: "Mme Stark", formation_id: null, session_id: null, inscription_id: null,
  indicateurs: [], causes: [], nb_actions: 0, ...sur,
});
const RESULTATS = { preuves: [
  { ...PREUVE_LIEE, description: "Description interne privée" },
  { id: 61, titre: "Émargement session B", statut: "a_consolider", statut_effectif: "a_consolider", indicateur: 11, session_reference: "SST-2025-01", description: "Autre description privée", fichiers: [] },
], total: 2 };
const lienRattacher = () => bouton("Rattacher une preuve");
const appelsDe = (appels, methode, chemin) => appels.filter((a) => a.methode === methode && a.chemin === chemin);

// ── ACTION ───────────────────────────────────────────────────

test("action : section Preuves, état vide, bouton admin et lien vers l'écran Preuves", async () => {
  await monter("/actions-qualite/1", "admin", { "GET /api/actions-qualite/1": detailAction() });
  await attendre(() => texte().includes("Aucune preuve liée."));
  assert.equal(document.getElementById("action-preuves").textContent, "Preuves");
  assert.ok(lienRattacher());
  assert.equal([...document.querySelectorAll("a")].find((a) => a.textContent === "Créer / importer une preuve").getAttribute("href"), "/preuves");
});

test("action : preuve liée affichée (indicateur propre, session, lien Drive existant), « Retirer le lien » et non « Supprimer »", async () => {
  await monter("/actions-qualite/1", "admin", { "GET /api/actions-qualite/1": detailAction({}, [PREUVE_LIEE]) });
  await attendre(() => texte().includes("Feuille d'émargement EduSign"));
  for (const t of ["Indicateur 11 — Atteinte des objectifs", "Session ADVF-2026-09", "Maîtrisé"]) assert.ok(texte().includes(t), t);
  const lien = [...document.querySelectorAll("a")].find((a) => a.textContent === "Emargement.pdf");
  assert.equal(lien.getAttribute("href"), "https://drive.google.com/file/d/ABC/view");
  assert.equal(lien.getAttribute("rel"), "noopener noreferrer");
  assert.ok(bouton("Retirer le lien"));
  assert.ok(![...document.querySelectorAll("button")].some((b) => /supprimer la preuve/i.test(b.textContent)));
});

test("action : rattacher via la recherche serveur ; preuve déjà liée exclue ; aucune donnée superflue ; détail rechargé", async () => {
  let liee = false;
  const appels = await monter("/actions-qualite/1", "admin", {
    "GET /api/actions-qualite/1": () => detailAction({}, liee ? [PREUVE_LIEE, { ...PREUVE_LIEE, id: 61, titre: "Émargement session B", fichiers: [] }] : [PREUVE_LIEE]),
    "GET /api/preuves?q=emarg": RESULTATS,
    "POST /api/actions-qualite/1/preuves": () => { liee = true; return [201, { preuves: [] }]; },
  });
  await attendre(() => lienRattacher());
  await cliquer(lienRattacher());
  await attendre(() => dialogue()?.textContent.includes("Rattacher une preuve"));
  assert.equal(appelsDe(appels, "GET", "/api/preuves").length, 0, "rien chargé avant la recherche");
  await saisir(dialogue().querySelector('input[type="search"]'), "emarg");
  await attendre(() => dialogue().textContent.includes("Émargement session B"));
  assert.equal(appelsDe(appels, "GET", "/api/preuves").length, 1, "recherche serveur");
  const choix = [...dialogue().querySelectorAll(".preuve-choix")].map((li) => li.textContent);
  assert.equal(choix.length, 1, "la preuve déjà liée est exclue");
  assert.ok(!document.body.innerHTML.includes("description privée"), "description jamais affichée");
  const avant = appelsDe(appels, "GET", "/api/actions-qualite/1").length;
  await cliquer(dialogue().querySelector('button[aria-label="Rattacher la preuve Émargement session B"]'));
  await attendre(() => !dialogue());
  assert.deepEqual(appelsDe(appels, "POST", "/api/actions-qualite/1/preuves")[0].corps, { preuve_id: 61 });
  assert.equal(appelsDe(appels, "GET", "/api/actions-qualite/1").length - avant, 1, "détail rechargé une fois");
  await attendre(() => texte().includes("Émargement session B"));
});

test("action : double clic ⇒ un seul rattachement ; erreur 409 affichée dans le panneau", async () => {
  const appels = await monter("/actions-qualite/1", "admin", {
    "GET /api/actions-qualite/1": detailAction(),
    "GET /api/preuves?q=emarg": RESULTATS,
    "POST /api/actions-qualite/1/preuves": () => new Promise((r) => setTimeout(() => r([409, { error: "Cette preuve est déjà liée." }]), 30)),
  });
  await attendre(() => lienRattacher());
  await cliquer(lienRattacher());
  await attendre(() => dialogue());
  await saisir(dialogue().querySelector('input[type="search"]'), "emarg");
  await attendre(() => dialogue().querySelector('button[aria-label="Rattacher la preuve Émargement session B"]'));
  const b = dialogue().querySelector('button[aria-label="Rattacher la preuve Émargement session B"]');
  await cliquer(b); await cliquer(b);
  await attendre(() => dialogue()?.textContent.includes("Cette preuve est déjà liée."));
  assert.equal(appelsDe(appels, "POST", "/api/actions-qualite/1/preuves").length, 1);
  assert.ok(dialogue(), "panneau resté ouvert");
});

test("action : retirer le lien avec confirmation (Échap n'enlève rien), puis rechargement", async () => {
  let liee = true;
  const appels = await monter("/actions-qualite/1", "admin", {
    "GET /api/actions-qualite/1": () => detailAction({}, liee ? [PREUVE_LIEE] : []),
    "DELETE /api/actions-qualite/1/preuves/60": () => { liee = false; return { preuves: [] }; },
  });
  await attendre(() => bouton("Retirer le lien"));
  await cliquer(bouton("Retirer le lien"));
  await attendre(() => dialogue()?.getAttribute("role") === "alertdialog");
  assert.ok(dialogue().textContent.includes("La preuve elle-même, ses fichiers sur Google Drive et son indicateur restent inchangés."));
  await touche("Escape");
  await attendre(() => !dialogue());
  assert.equal(appelsDe(appels, "DELETE", "/api/actions-qualite/1/preuves/60").length, 0);
  await cliquer(bouton("Retirer le lien"));
  await attendre(() => dialogue());
  await cliquer([...dialogue().querySelectorAll("button")].find((x) => x.textContent === "Retirer le lien"));
  await attendre(() => texte().includes("Aucune preuve liée."));
  assert.equal(appelsDe(appels, "DELETE", "/api/actions-qualite/1/preuves/60").length, 1);
});

test("action : erreur 404 au retrait affichée proprement", async () => {
  await monter("/actions-qualite/1", "admin", {
    "GET /api/actions-qualite/1": detailAction({}, [PREUVE_LIEE]),
    "DELETE /api/actions-qualite/1/preuves/60": [404, { error: "Cette preuve n'est pas liée." }],
  });
  await attendre(() => bouton("Retirer le lien"));
  await cliquer(bouton("Retirer le lien"));
  await attendre(() => dialogue());
  await cliquer([...dialogue().querySelectorAll("button")].find((x) => x.textContent === "Retirer le lien"));
  await attendre(() => texte().includes("Cette preuve n'est pas liée."));
  assert.ok(texte().includes("Le lien n'a pas été retiré."));
});

test("action clôturée ou en efficacité à vérifier : preuves toujours visibles ; clôturée = lecture seule", async () => {
  await monter("/actions-qualite/1", "admin", { "GET /api/actions-qualite/1": detailAction({ statut: "efficacite_a_verifier" }, [PREUVE_LIEE]) });
  await attendre(() => texte().includes("Feuille d'émargement EduSign"));
  assert.ok(lienRattacher(), "rattachement possible pendant le contrôle d'efficacité");
  await demonter();
  await monter("/actions-qualite/1", "admin", { "GET /api/actions-qualite/1": detailAction({ statut: "cloturee" }, [PREUVE_LIEE]) });
  await attendre(() => texte().includes("Feuille d'émargement EduSign"));
  assert.ok(!lienRattacher() && !bouton("Retirer le lien"), "clôturée : lecture seule");
});

test("contributeur : preuves de SON action en lecture seule, aucun bouton, aucune recherche", async () => {
  const appels = await monter("/actions-qualite/1", "contributeur", { "GET /api/actions-qualite/1": detailAction({}, [PREUVE_LIEE]) });
  await attendre(() => texte().includes("Feuille d'émargement EduSign"));
  assert.ok(!lienRattacher() && !bouton("Retirer le lien"));
  assert.ok(![...document.querySelectorAll("a")].some((a) => a.textContent === "Créer / importer une preuve"));
  assert.equal(appelsDe(appels, "GET", "/api/preuves").length, 0);
});

test("historique : preuve rattachée / lien retiré traduits (titre si connue, sinon ID interne)", async () => {
  await monter("/actions-qualite/1", "admin", { "GET /api/actions-qualite/1": detailAction({}, [PREUVE_LIEE], [
    { id: 1, evenement: "preuve_rattachee", champ: "preuve_id", ancienne_valeur: null, nouvelle_valeur: "60", par: 1, acteur_nom: "Mme Stark", cree_le: "2026-10-01T09:00:00Z" },
    { id: 2, evenement: "preuve_detachee", champ: "preuve_id", ancienne_valeur: "77", nouvelle_valeur: null, par: 1, acteur_nom: "Mme Stark", cree_le: "2026-10-01T10:00:00Z" },
  ]) });
  await attendre(() => texte().includes("Preuve rattachée"));
  const h = document.querySelector(".qualite-historique").textContent;
  assert.ok(h.includes("Preuve rattachée : Feuille d'émargement EduSign"));
  assert.ok(h.includes("Lien avec une preuve retiré : Preuve (ID interne 77)"));
});

// ── SIGNALEMENT ──────────────────────────────────────────────

test("signalement : section Preuves, rattacher puis retirer le lien", async () => {
  let liee = false;
  const appels = await monter("/signalements-qualite/1", "admin", {
    "GET /api/signalements/1": () => ({ signalement: signalement(), actions: [], historique: [], preuves: liee ? [PREUVE_LIEE] : [] }),
    "GET /api/preuves?q=emarg": RESULTATS,
    "POST /api/signalements/1/preuves": () => { liee = true; return [201, { preuves: [] }]; },
    "DELETE /api/signalements/1/preuves/60": () => { liee = false; return { preuves: [] }; },
  });
  await attendre(() => document.getElementById("sig-preuves") && texte().includes("Aucune preuve liée."));
  await cliquer(lienRattacher());
  await attendre(() => dialogue());
  await saisir(dialogue().querySelector('input[type="search"]'), "emarg");
  await attendre(() => dialogue().querySelector('button[aria-label="Rattacher la preuve Feuille d\'émargement EduSign"]'));
  await cliquer(dialogue().querySelector('button[aria-label="Rattacher la preuve Feuille d\'émargement EduSign"]'));
  await attendre(() => !dialogue() && texte().includes("Feuille d'émargement EduSign"));
  assert.deepEqual(appelsDe(appels, "POST", "/api/signalements/1/preuves")[0].corps, { preuve_id: 60 });
  await cliquer(bouton("Retirer le lien"));
  await attendre(() => dialogue());
  await cliquer([...dialogue().querySelectorAll("button")].find((x) => x.textContent === "Retirer le lien"));
  await attendre(() => texte().includes("Aucune preuve liée."));
  assert.equal(appelsDe(appels, "DELETE", "/api/signalements/1/preuves/60").length, 1);
});

test("signalement annulé : preuves visibles, aucun bouton", async () => {
  await monter("/signalements-qualite/1", "admin", {
    "GET /api/signalements/1": { signalement: signalement({ statut: "annulee" }), actions: [], historique: [], preuves: [PREUVE_LIEE] },
  });
  await attendre(() => texte().includes("Feuille d'émargement EduSign"));
  assert.ok(!lienRattacher() && !bouton("Retirer le lien"));
});
