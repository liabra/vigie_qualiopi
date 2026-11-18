// « Aujourd'hui » : une liste unique rangée (en retard / cette semaine / plus
// tard), filtres, tâche cochée (PATCH du registre), séances à venir, rôle
// contributeur, états de chargement / erreur / vide, ancienne adresse
// /accueil. API simulée, données fictives.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, monter, texte } from "./outils.jsx";
import { quand } from "../src/pages/Aujourdhui.jsx";

const el = (cle, groupe, categorie, titre, date, extra = {}) => ({ cle, groupe, categorie, titre, date, contexte: `Contexte ${cle}`, lien: "/sessions/1", action: "Ouvrir", ...extra });
const DONNEES = {
  aujourdhui: "2026-11-18", role: "admin",
  groupes: {
    retard: [el("tache:4", "retard", "qualiopi", "Relancer le prescripteur", "2026-11-10", { tache_id: 4, lien: "/taches" }),
      el("reclamation:2", "retard", "qualiopi", "Traiter la réclamation REC-2", "2026-11-06", { lien: "/signalements-qualite/2", action: "Traiter" })],
    semaine: [el("dossiers:1", "semaine", "formations", "Compléter 2 dossiers stagiaires", "2026-11-20", { lien: "/sessions/1/stagiaires", action: "Compléter" }),
      el("justificatif:9", "semaine", "equipe", "Diplôme à déposer — Thomas R.", null, { lien: "/justificatifs-intervenants" })],
    plus_tard: [el("audit:1", "plus_tard", "qualiopi", "Préparer l'audit : Surveillance", "2027-01-15", { lien: "/preparation-audit/1", action: "Préparer" })],
  },
  compteurs: { retard: 2, semaine: 2, plus_tard: 1 },
  seances: [{ id: 30, session_id: 1, date: "2026-11-19", heure_debut: "09:00:00", heure_fin: "12:00:00", lieu: "Salle 2", formation: "Remobilisation", reference: "S-1", inscrits: 8 }],
};
const URL = "GET /api/pilotage/aujourdhui";
const lien = (t) => [...document.querySelectorAll("a")].find((a) => a.textContent.trim() === t || a.getAttribute("aria-label")?.includes(t));

let natifs = 0;
beforeEach(() => { natifs = 0; window.confirm = () => { natifs++; return true; }; window.alert = () => { natifs++; }; });
afterEach(async () => { assert.equal(natifs, 0, "aucune boîte native"); await demonter(); });

test("pur : libellé de l'échéance relatif au jour métier", () => {
  assert.equal(quand(null, "2026-11-18"), "À traiter");
  assert.equal(quand("2026-11-08", "2026-11-18"), "Depuis 10 jours");
  assert.equal(quand("2026-11-17", "2026-11-18"), "Depuis hier");
  assert.equal(quand("2026-11-18", "2026-11-18"), "Aujourd'hui");
  assert.equal(quand("2026-11-19", "2026-11-18"), "Demain");
  assert.equal(quand("2026-11-20", "2026-11-18"), "Vendredi");
  assert.equal(quand("2027-01-15", "2026-11-18"), "Le 15 janv.");
});

test("« / » et l'ancienne adresse /accueil mènent à « Aujourd'hui »", async () => {
  await monter("/", "admin", { [URL]: DONNEES });
  await attendre(() => window.location.pathname === "/aujourdhui" && texte().includes("Relancer le prescripteur"));
  assert.equal(document.querySelector("h1").textContent, "Aujourd'hui");
  assert.equal(document.title, "Aujourd'hui — Vigie Qualiopi");
  await demonter();
  await monter("/accueil", "admin", { [URL]: DONNEES });
  await attendre(() => window.location.pathname === "/aujourdhui");
});

test("admin : groupes rangés, compteurs, liens d'action, séances et tuile Qualiopi", async () => {
  await monter("/aujourdhui", "admin", { [URL]: DONNEES });
  await attendre(() => texte().includes("Relancer le prescripteur"));
  const t = texte();
  for (const x of ["Mercredi 18 novembre", "En retard · 2", "Cette semaine · 2", "Plus tard · 1", "Depuis 8 jours",
    "Prochaines séances", "Remobilisation", "09 h 00 – 12 h 00 · Salle 2 · 8 inscrits", "indicateurs maîtrisés"]) assert.ok(t.includes(x), x);
  assert.equal(lien("Traiter : Traiter la réclamation REC-2").getAttribute("href"), "/signalements-qualite/2");
  assert.equal(lien("Compléter : Compléter 2 dossiers stagiaires").getAttribute("href"), "/sessions/1/stagiaires");
  assert.ok(document.querySelector('a[href="/qualiopi"]'), "tuile Qualiopi");
  const titres = [...document.querySelectorAll(".ajd-groupe__titre")].map((h) => h.textContent);
  assert.deepEqual(titres, ["En retard · 2", "Cette semaine · 2", "Plus tard · 1"]);
});

test("filtres : seulement l'équipe, puis tout", async () => {
  await monter("/aujourdhui", "admin", { [URL]: DONNEES });
  await attendre(() => texte().includes("Relancer le prescripteur"));
  const filtre = (l) => [...document.querySelectorAll(".ajd-filtre")].find((b) => b.textContent === l);
  await cliquer(filtre("Équipe"));
  assert.equal(filtre("Équipe").getAttribute("aria-pressed"), "true");
  assert.ok(texte().includes("Diplôme à déposer — Thomas R."));
  assert.ok(!texte().includes("Relancer le prescripteur"));
  await cliquer(filtre("Tout"));
  assert.ok(texte().includes("Relancer le prescripteur"));
});

test("cocher une tâche : PATCH du registre, message, liste relue", async () => {
  let lectures = 0;
  const appels = await monter("/aujourdhui", "admin", {
    [URL]: () => (lectures++ === 0 ? DONNEES : { ...DONNEES, groupes: { ...DONNEES.groupes, retard: DONNEES.groupes.retard.slice(1) }, compteurs: { ...DONNEES.compteurs, retard: 1 } }),
    "PATCH /api/registres/taches/4": { fiche: { id: 4, statut: "faite" } },
  });
  await attendre(() => texte().includes("Relancer le prescripteur"));
  const caseTache = document.querySelector('input[type="checkbox"].ajd-element__case');
  await cliquer(caseTache);
  await attendre(() => texte().includes("« Relancer le prescripteur » est marquée comme faite."));
  const patch = appels.find((a) => a.methode === "PATCH");
  assert.equal(patch.chemin, "/api/registres/taches/4");
  assert.deepEqual(patch.corps, { statut: "faite" });
  await attendre(() => !document.querySelector(".ajd-elements")?.textContent.includes("Relancer le prescripteur"));
});

test("contributeur : pas de tuile Qualiopi, pas d'appel réservé à l'administrateur", async () => {
  const appels = await monter("/aujourdhui", "contributeur", { [URL]: { ...DONNEES, role: "contributeur" } });
  await attendre(() => texte().includes("Relancer le prescripteur"));
  assert.ok(!document.querySelector('a[href="/qualiopi"]'));
  assert.ok(texte().includes("Plus tard"));
  for (const interdit of ["/api/drive/status", "/api/referentiel"]) assert.ok(!appels.some((a) => a.chemin === interdit), interdit);
  assert.ok(!bouton("Candidatures"));
});

test("états : liste vide, erreur puis Réessayer", async () => {
  await monter("/aujourdhui", "admin");
  await attendre(() => texte().includes("Rien à faire pour le moment."));
  await demonter();
  let n = 0;
  await monter("/aujourdhui", "admin", { [URL]: () => (n++ === 0 ? [500, { error: "Erreur serveur." }] : DONNEES) });
  await attendre(() => texte().includes("La liste n'a pas pu être chargée."));
  await cliquer(bouton("Réessayer"));
  await attendre(() => texte().includes("Relancer le prescripteur"));
});
