// Après VF — Archivage / restauration / suppression des sessions (client).
// API simulée ; aucune boîte de dialogue native. Vérifie : vues Actives /
// Archivées, bandeau « Session archivée », actions admin, lecture seule des
// onglets, suppression (vide OK / refusée 409), rôles.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, dialogue, monter, saisir, texte } from "./outils.jsx";
import { SESSION } from "./outils.jsx";

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

const ARCHIVEE = { ...SESSION, archivee_le: "2026-09-29T10:00:00Z" };
const detailDe = (archivee) => ({
  session: archivee ? ARCHIVEE : SESSION,
  groupes: [{ id: 5, nom: "Groupe A", lieu: "Lyon 7e", formateur: null, nb_inscrits: 1 }],
  stagiaires: [],
  documents: [],
});
const SESSION_ARCHIVEE_LISTE = {
  ...ARCHIVEE, formation: "Formation test", nb_inscrits: 0, groupes: [],
};

// Bouton situé DANS une boîte de dialogue (modale), pour lever l'ambiguïté
// avec le bouton d'ouverture de la page qui porte le même libellé.
const boutonDialogue = (libelle) => [...document.querySelectorAll('[role="alertdialog"] button')]
  .find((b) => b.textContent.trim() === libelle);

// ── Liste : Actives / Archivées ──────────────────────────────

test("liste : bascule Actives / Archivées, les archivées ne polluent pas la vue active", async () => {
  await monter("/sessions", "admin", {
    "GET /api/sessions?etat=archivees": { sessions: [SESSION_ARCHIVEE_LISTE], total: 1 },
  });
  await attendre(() => [...document.querySelectorAll(".sess-table tbody tr")].length === 3);
  assert.ok(bouton("Actives") && bouton("Archivées"), "bascule Actives / Archivées présente");
  assert.equal(document.querySelector(".sess-etat--active").textContent.trim(), "Actives");
  const badgesActifs = [...document.querySelectorAll(".ui-badge")].map((b) => b.textContent.trim());
  assert.ok(!badgesActifs.includes("Archivée"), "aucun badge Archivée dans la vue active par défaut");

  await cliquer(bouton("Archivées"));
  await attendre(() => window.location.search.includes("etat=archivees"));
  await attendre(() => [...document.querySelectorAll(".sess-table tbody tr")].length === 1);
  const badgesArchives = [...document.querySelectorAll(".ui-badge")].map((b) => b.textContent.trim());
  assert.ok(badgesArchives.includes("Archivée"), "badge Archivée affiché");
  assert.ok(!document.querySelector(".sess-vues"), "les vues par statut ne concernent que les actives");
});

test("liste : ?etat=archivees est conservé dans l'URL au rechargement", async () => {
  await monter("/sessions?etat=archivees", "admin", {
    "GET /api/sessions?etat=archivees": { sessions: [SESSION_ARCHIVEE_LISTE], total: 1 },
  });
  await attendre(() => [...document.querySelectorAll(".sess-table tbody tr")].length === 1);
  assert.equal(document.querySelector(".sess-etat--active").textContent.trim(), "Archivées");
  const badges = [...document.querySelectorAll(".ui-badge")].map((b) => b.textContent.trim());
  assert.ok(badges.includes("Archivée"), "badge Archivée affiché");
});

// ── Détail : bandeau et actions ──────────────────────────────

test("détail : une session archivée affiche le bandeau et les actions Restaurer / Supprimer", async () => {
  await monter("/sessions/1", "admin", { "GET /api/sessions/1": detailDe(true) });
  await attendre(() => texte().includes("Session archivée"));
  assert.ok(bouton("Restaurer la session"), "action Restaurer visible");
  assert.ok(bouton("Supprimer définitivement"), "action Supprimer visible");
  assert.ok(!bouton("Modifier la session"), "pas de modification sur session archivée");
  assert.ok(!bouton("Archiver la session"), "pas d'archivage d'une session déjà archivée");
});

test("détail : une session active propose Modifier et Archiver", async () => {
  await monter("/sessions/1", "admin");
  await attendre(() => bouton("Modifier la session"));
  assert.ok(bouton("Archiver la session"), "action Archiver visible");
  assert.ok(!bouton("Restaurer la session"));
  assert.ok(!bouton("Supprimer définitivement"));
});

test("détail : archiver ouvre une confirmation, puis la session devient archivée", async () => {
  let archivee = false;
  await monter("/sessions/1", "admin", {
    "GET /api/sessions/1": () => detailDe(archivee),
    "PATCH /api/sessions/1/archive": () => { archivee = true; return { session: ARCHIVEE }; },
  });
  await attendre(() => bouton("Archiver la session"));
  await cliquer(bouton("Archiver la session"));
  await attendre(() => dialogue());
  assert.ok(texte().includes("restera consultable"), "message explicite de non-suppression");
  await cliquer(boutonDialogue("Archiver la session"));
  await attendre(() => texte().includes("Session archivée"));
  assert.ok(bouton("Restaurer la session"));
});

test("détail : restaurer une session archivée la rend de nouveau active", async () => {
  let archivee = true;
  await monter("/sessions/1", "admin", {
    "GET /api/sessions/1": () => detailDe(archivee),
    "PATCH /api/sessions/1/restaure": () => { archivee = false; return { session: SESSION }; },
  });
  await attendre(() => bouton("Restaurer la session"));
  await cliquer(bouton("Restaurer la session"));
  await attendre(() => dialogue());
  await cliquer(boutonDialogue("Restaurer la session"));
  await attendre(() => bouton("Modifier la session"));
  assert.ok(!texte().includes("Session archivée"));
});

// ── Suppression ──────────────────────────────────────────────

test("détail : la suppression d'une session vide exige de taper SUPPRIMER puis navigue", async () => {
  await monter("/sessions/1", "admin", {
    "GET /api/sessions/1": detailDe(true),
    "DELETE /api/sessions/1": { ok: true },
  });
  await attendre(() => bouton("Supprimer définitivement"));
  await cliquer(bouton("Supprimer définitivement"));
  await attendre(() => dialogue());
  const confirmer = boutonDialogue("Supprimer définitivement");
  assert.ok(confirmer.disabled, "confirmation désactivée tant que SUPPRIMER n'est pas tapé");
  await saisir(document.querySelector('[role="alertdialog"] input'), "SUPPRIMER");
  await attendre(() => !boutonDialogue("Supprimer définitivement").disabled);
  await cliquer(boutonDialogue("Supprimer définitivement"));
  await attendre(() => window.location.pathname === "/sessions");
});

test("détail : une suppression refusée (409) affiche l'erreur du serveur", async () => {
  await monter("/sessions/1", "admin", {
    "GET /api/sessions/1": detailDe(true),
    "DELETE /api/sessions/1": [409, { error: "Cette session contient des données de suivi et ne peut pas être supprimée. Archivez-la plutôt." }],
  });
  await attendre(() => bouton("Supprimer définitivement"));
  await cliquer(bouton("Supprimer définitivement"));
  await attendre(() => dialogue());
  await saisir(document.querySelector('[role="alertdialog"] input'), "SUPPRIMER");
  await attendre(() => !boutonDialogue("Supprimer définitivement").disabled);
  await cliquer(boutonDialogue("Supprimer définitivement"));
  await attendre(() => texte().includes("Archivez-la plutôt"));
});

// ── Lecture seule des onglets ────────────────────────────────

test("onglets : une session archivée masque les actions de saisie", async () => {
  await monter("/sessions/1/stagiaires", "admin", { "GET /api/sessions/1": detailDe(true) });
  await attendre(() => texte().includes("Stagiaires"));
  assert.ok(!bouton("Ajouter un stagiaire"), "pas d'ajout de stagiaire");
  assert.ok(!bouton("Importer un CSV"), "pas d'import");
  assert.ok(!bouton("Ajouter un groupe"), "pas d'ajout de groupe");
});

// ── Rôles ────────────────────────────────────────────────────

test("contributeur : consulte une session archivée, sans aucune action d'administration", async () => {
  await monter("/sessions/1", "contributeur", { "GET /api/sessions/1": detailDe(true) });
  await attendre(() => texte().includes("Session archivée"));
  assert.ok(!bouton("Restaurer la session"));
  assert.ok(!bouton("Supprimer définitivement"));
  assert.ok(!bouton("Modifier la session"));
  assert.ok(!bouton("Archiver la session"));
});
