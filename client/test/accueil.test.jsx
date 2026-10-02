// Q5 — Poste de pilotage (Accueil) : vue admin « Vue d'ensemble A2C », vue
// contributeur « Mon espace de travail », priorités et liens, états de
// chargement / erreur / vide, Drive, accessibilité. API simulée, données fictives.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, monter, texte } from "./outils.jsx";

const PRIORITES = {
  lignes: [
    { cle: "actions_retard", nombre: 2, libelle: "2 actions qualité en retard", to: "/actions-qualite", ton: "error" },
    { cle: "efficacite", nombre: 1, libelle: "1 action dont l'efficacité est à vérifier", to: "/actions-qualite?statut=efficacite_a_verifier", ton: "warning" },
    { cle: "dossiers:1", nombre: 3, libelle: "3 dossiers stagiaires à compléter — SESS-TEST", to: "/sessions/1/stagiaires", ton: "warning" },
    { cle: "mesures:1", nombre: 2, libelle: "2 mesures pédagogiques à mettre en œuvre — SESS-TEST", to: "/sessions/1/parcours", ton: "warning" },
  ],
  reste: 2, voir_davantage: { libelle: "Voir toutes les sessions", to: "/sessions" },
};
const SESSIONS = { en_cours: 2, a_venir: [{ id: 2, reference: "SESS-AVENIR", formation: "Aide à domicile", date_debut: "2026-11-02" }], en_cours_liste: [],
  inscrits_actifs: 17, dossiers_incomplets: 3, recueils_a_faire: 4, mesures_prevues: 2 };
const ADMIN = {
  aujourdhui: "2026-10-01", role: "admin", sessions: SESSIONS, sessions_suivi: [], priorites: PRIORITES,
  qualite: { actions_ouvertes: 5, actions_en_retard: 2, efficacite_a_verifier: 1, reclamations_en_cours: 1, reclamations_en_retard: 0, signalements_a_traiter: 2 },
  preuves: { perimees: 1, bientot: 2, a_confirmer: 0 }, justificatifs: { manquants: 1, bientot: 1, perimes: 0, intervenants: 1 },
  satisfaction: { reponses: 12 }, veille_actions: 0, dernier_audit: { type: "surveillance", date_audit: "2026-09-01", resultat: "certifie" },
};
const CONTRIB = {
  aujourdhui: "2026-10-01", role: "contributeur", sessions: SESSIONS, sessions_suivi: [],
  priorites: { lignes: [{ cle: "actions_retard", nombre: 1, libelle: "1 action qualité en retard (attribuée(s) à vous)", to: "/actions-qualite/7", ton: "error" }], reste: 0, voir_davantage: null },
  mes_actions: { ouvertes: 2, en_retard: 1, liste: [
    { id: 7, reference: "AQ-2026-007", titre: "Relancer les convocations", echeance: "2026-09-30", statut: "a_faire", en_retard: true },
    { id: 8, reference: "AQ-2026-008", titre: "Mettre à jour le livret", echeance: null, statut: "en_cours", en_retard: false }] },
};
const URL = "GET /api/pilotage/accueil";
const lien = (texteLien) => [...document.querySelectorAll("a")].find((a) => a.textContent.includes(texteLien));

let natifs = 0;
beforeEach(() => { natifs = 0; window.confirm = () => { natifs++; return true; }; window.alert = () => { natifs++; }; });
afterEach(async () => { assert.equal(natifs, 0, "aucune boîte native"); await demonter(); });

test("admin : « Vue d'ensemble A2C », résumé, priorités cliquables, sessions, qualité et justificatifs, raccourcis — une seule lecture agrégée", async () => {
  const appels = await monter("/accueil", "admin", { [URL]: ADMIN });
  await attendre(() => texte().includes("À traiter en priorité"));
  assert.equal(document.querySelector("h1").textContent, "Vue d'ensemble A2C");
  assert.equal(document.title, "Vue d'ensemble A2C — Vigie Qualiopi");
  const t = texte();
  for (const x of ["Sessions en cours", "17", "Points à traiter", "6", "Actions qualité en retard", "Dossiers stagiaires à compléter", "Recueils du besoin à réaliser",
    "Prochaines sessions", "SESS-AVENIR", "dès le 02/11/2026", "Qualité et justificatifs", "Réclamations en cours", "Preuves périmées",
    "Justificatifs d'intervenants manquants ou à renouveler", "Réponses de satisfaction", "Dernier audit : Surveillance · 01/09/2026", "Certifié", "Actualisé à"]) assert.ok(t.includes(x), x);
  assert.equal(lien("3 dossiers stagiaires à compléter").getAttribute("href"), "/sessions/1/stagiaires");
  assert.equal(lien("1 action dont l'efficacité").getAttribute("href"), "/actions-qualite?statut=efficacite_a_verifier");
  assert.equal(lien("Voir toutes les sessions").getAttribute("href"), "/sessions");
  assert.ok(t.includes("Et 2 autre(s) point(s)."));
  assert.equal(lien("Ouvrir le tableau de bord qualité").getAttribute("href"), "/tableau-de-bord-qualite");
  assert.equal(document.querySelectorAll('ol[aria-label="Priorités"] li').length, 4);
  for (const x of ["Sessions", "Intervenants", "Indicateurs", "Preuves", "Actions qualité", "Tableau de bord qualité"]) assert.ok(bouton(x), `raccourci ${x}`);
  const lectures = appels.filter((a) => a.methode === "GET" && a.chemin !== "/api/me" && a.chemin !== "/api/drive/status");
  assert.deepEqual(lectures.map((a) => a.chemin), ["/api/pilotage/accueil"], "aucune liste complète téléchargée (preuves, inscriptions…)");
});

test("contributeur : « Mon espace de travail », ses actions seulement, aucune carte qualité globale ni raccourci admin", async () => {
  await monter("/accueil", "contributeur", { [URL]: CONTRIB });
  await attendre(() => texte().includes("Mes actions qualité"));
  assert.equal(document.querySelector("h1").textContent, "Mon espace de travail");
  const t = texte();
  for (const x of ["Mes actions qualité ouvertes", "AQ-2026-007 — Relancer les convocations (échéance 30/09/2026)", "En retard", "AQ-2026-008", "Dossiers stagiaires à compléter"]) assert.ok(t.includes(x), x);
  for (const x of ["Qualité et justificatifs", "Preuves périmées", "Réponses de satisfaction", "Réclamations", "Justificatifs", "Dernier audit"]) assert.ok(!t.includes(x), `pas de « ${x} »`);
  assert.ok(!bouton("Tableau de bord qualité"));
  assert.equal(lien("1 action qualité en retard").getAttribute("href"), "/actions-qualite/7");
  assert.equal(lien("AQ-2026-008").getAttribute("href"), "/actions-qualite/8");
});

test("états : aucune priorité, aucune action attribuée ; erreur API ⇒ message et Réessayer", async () => {
  await monter("/accueil", "contributeur", { [URL]: { ...CONTRIB, priorites: { lignes: [], reste: 0, voir_davantage: null }, mes_actions: { ouvertes: 0, en_retard: 0, liste: [] } } });
  await attendre(() => texte().includes("Rien d'urgent : aucun point en attente."));
  assert.ok(texte().includes("Aucune action qualité ne vous est attribuée."));
  await demonter();
  let n = 0;
  await monter("/accueil", "admin", { [URL]: () => (n++ === 0 ? [500, { error: "Erreur serveur." }] : ADMIN) });
  await attendre(() => texte().includes("Le tableau de pilotage n'a pas pu être chargé."));
  assert.ok(bouton("Sessions"), "raccourcis toujours disponibles");
  await cliquer(bouton("Réessayer"));
  await attendre(() => texte().includes("À traiter en priorité"));
});

test("admin : bandeau Drive uniquement quand une action est requise", async () => {
  await monter("/accueil", "admin", { [URL]: ADMIN, "GET /api/drive/status": { configured: true, connected: false, compte: "drive@exemple.fr" } });
  await attendre(() => texte().includes("Google Drive"));
  assert.ok(bouton("Paramètres Drive"));
  await demonter();
  await monter("/accueil", "admin", { [URL]: ADMIN });
  await attendre(() => texte().includes("À traiter en priorité"));
  assert.ok(!bouton("Paramètres Drive"));
});

test("accessibilité : titres hiérarchisés, sections étiquetées, liens explicites", async () => {
  await monter("/accueil", "admin", { [URL]: ADMIN });
  await attendre(() => texte().includes("À traiter en priorité"));
  assert.equal(document.querySelectorAll("h1").length, 1);
  for (const s of document.querySelectorAll("section[aria-labelledby]")) {
    assert.ok(document.getElementById(s.getAttribute("aria-labelledby"))?.textContent.trim(), "section titrée");
  }
  for (const a of document.querySelectorAll("main a, .accueil-liste a")) assert.ok(a.textContent.trim().length > 3, "lien au texte explicite");
});

test("indicateurs : note discrète pour le contributeur sur le statut (toutes les preuves comptent), absente pour l'admin", async () => {
  const REF = (p) => ({ version: { id: 1, code: "V9" }, totalIndicateurs: 1, perimetre_preuves: p, criteres: [],
    score: { maitrise: 0, a_consolider: 0, a_risque: 1, non_applicable: 0, total: 1, preuves: 2, a_confirmer: 0 } });
  const NOTE = "Le statut de l'indicateur tient compte de toutes les preuves enregistrées, y compris celles réservées à l'administration.";
  await monter("/indicateurs", "contributeur", { "GET /api/referentiel": REF("accessibles") });
  await attendre(() => texte().includes(NOTE));
  await demonter();
  await monter("/indicateurs", "admin", { "GET /api/referentiel": REF("toutes") });
  await attendre(() => texte().includes("preuve(s) rattachée(s)"));
  assert.ok(!texte().includes(NOTE));
});
