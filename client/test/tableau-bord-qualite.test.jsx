// Q1-B5 — Tableau de bord qualité : navigation, droits, KPI, priorités,
// vue par indicateur, activité récente, états vides, erreur. API simulée.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, cliquer, demonter, liensNavigation, monter, saisir, texte } from "./outils.jsx";
import { aujourdhuiISO } from "../src/qualite/format.js";
import { filtrerIndicateurs, libelleActivite, lienObjet } from "../src/qualite/tableau-bord-format.js";

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

// La page envoie la date LOCALE : seule cette URL exacte est simulée.
const URL_TDB = () => `GET /api/qualite/tableau-de-bord?aujourdhui=${aujourdhuiISO()}`;
const DONNEES = {
  aujourdhui: "2030-01-15",
  kpis: {
    actions: { ouvertes: 3, en_retard: 1, efficacite_a_verifier: 1, cloturees: 4, ouvertes_avec_preuve: 1, ouvertes_sans_preuve: 2 },
    signalements: { a_traiter: 2, reclamations_en_retard: 1, resolus_a_cloturer: 1, clotures: 5, actifs_avec_preuve: 1, actifs_sans_preuve: 2 },
    preuves: { total: 144 },
  },
  priorites: [
    { type: "action", id: 7, reference: "AQ-2026-007", titre: "Relancer les convocations", echeance: "2030-01-10", raison: "action_en_retard", raison_libelle: "Action en retard" },
    { type: "signalement", id: 3, reference: "REC-2026-003", titre: "Convocation tardive", echeance: "2030-01-05", raison: "reclamation_en_retard", raison_libelle: "Réclamation en retard" },
    { type: "action", id: 8, reference: "AQ-2026-008", titre: "Réviser la procédure", echeance: null, raison: "efficacite_a_verifier", raison_libelle: "Efficacité à vérifier" },
    { type: "signalement", id: 4, reference: "INC-2026-001", titre: "Salle indisponible", echeance: null, raison: "resolu_a_cloturer", raison_libelle: "Résolu, à clôturer" },
    { type: "action", id: 9, reference: "AQ-2026-009", titre: "Former les formateurs", echeance: null, raison: "action_sans_preuve", raison_libelle: "Action ouverte sans preuve liée" },
  ],
  indicateurs: [
    { id: 101, numero: 1, libelle: "Information du public", critere: 1, preuves: 4, actions_actives: 0, signalements_actifs: 0 },
    { id: 111, numero: 11, libelle: "Atteinte des objectifs", critere: 2, preuves: 0, actions_actives: 2, signalements_actifs: 1 },
    { id: 131, numero: 31, libelle: "Traitement des réclamations", critere: 7, preuves: 1, actions_actives: 1, signalements_actifs: 3 },
  ],
  activite_recente: [
    { id: 50, type: "signalement", objet_id: 3, evenement: "creation", cree_le: "2030-01-14T09:00:00Z", acteur_nom: "Mme Stark", reference: "REC-2026-003" },
    { id: 49, type: "action", objet_id: 7, evenement: "preuve_rattachee", cree_le: "2030-01-13T09:00:00Z", acteur_nom: null, reference: "AQ-2026-007" },
  ],
};
const VIDE = {
  aujourdhui: "2030-01-15",
  kpis: {
    actions: { ouvertes: 0, en_retard: 0, efficacite_a_verifier: 0, cloturees: 0, ouvertes_avec_preuve: 0, ouvertes_sans_preuve: 0 },
    signalements: { a_traiter: 0, reclamations_en_retard: 0, resolus_a_cloturer: 0, clotures: 0, actifs_avec_preuve: 0, actifs_sans_preuve: 0 },
    preuves: { total: 0 },
  },
  priorites: [], indicateurs: [], activite_recente: [],
};
const tuile = (libelle) => {
  const el = [...document.querySelectorAll(".qualite-compteur")].find((c) => c.querySelector(".qualite-compteur__l").textContent === libelle);
  return el ? el.querySelector(".qualite-compteur__n").textContent : null;
};
const appelsTdb = (appels) => appels.filter((a) => a.chemin === "/api/qualite/tableau-de-bord");

// ── Fonctions pures ──────────────────────────────────────────

test("pur : liens vers les fiches, libellés d'activité, recherche et tri des indicateurs", () => {
  assert.equal(lienObjet("action", 7), "/actions-qualite/7");
  assert.equal(lienObjet("signalement", 3), "/signalements-qualite/3");
  assert.equal(libelleActivite({ type: "signalement", evenement: "cloturer" }), "Signalement clôturé");
  assert.equal(libelleActivite({ type: "action", evenement: "preuve_detachee" }), "Lien avec une preuve retiré");
  const l = DONNEES.indicateurs;
  assert.deepEqual(filtrerIndicateurs(l, { q: "1" }).map((i) => i.numero), [1], "numéro exact (1 ne trouve pas 11)");
  assert.deepEqual(filtrerIndicateurs(l, { q: "reclamation" }).map((i) => i.numero), [31], "mot-clé sans accent");
  assert.deepEqual(filtrerIndicateurs(l, { tri: "preuves" }).map((i) => i.numero), [11, 31, 1]);
  assert.deepEqual(filtrerIndicateurs(l, { tri: "activite" }).map((i) => i.numero), [31, 11, 1]);
});

// ── Navigation et droits ─────────────────────────────────────

test("navigation : « Tableau de bord » avant Actions qualité et Signalements pour l'admin ; absent pour le contributeur", async () => {
  await monter("/accueil", "admin");
  await attendre(() => liensNavigation().length > 0);
  const liens = liensNavigation();
  const i = liens.indexOf("Tableau de bord");
  assert.ok(i >= 0);
  assert.deepEqual(liens.slice(i, i + 3), ["Tableau de bord", "Actions qualité", "Signalements"]);
  await demonter();
  await monter("/accueil", "contributeur");
  await attendre(() => liensNavigation().length > 0);
  assert.ok(!liensNavigation().includes("Tableau de bord"));
});

test("contributeur : accès direct bloqué AVANT tout appel à l'API", async () => {
  const appels = await monter("/tableau-de-bord-qualite", "contributeur", { [URL_TDB()]: DONNEES });
  await attendre(() => texte().includes("Cette page est réservée aux administrateurs."));
  assert.equal(appelsTdb(appels).length, 0);
});

// ── Contenu ──────────────────────────────────────────────────

test("KPI : actions, signalements et preuves (chiffres du serveur)", async () => {
  const appels = await monter("/tableau-de-bord-qualite", "admin", { [URL_TDB()]: DONNEES });
  await attendre(() => tuile("Actions ouvertes") !== null);
  assert.equal(appelsTdb(appels).length, 1, "un seul appel agrégé");
  assert.equal(document.querySelector("h1").textContent, "Tableau de bord qualité");
  const attendu = {
    "Actions ouvertes": "3", "Actions en retard": "1", "Efficacité à vérifier": "1", "Actions clôturées": "4",
    "Signalements à traiter": "2", "Réclamations en retard": "1", "Résolus à clôturer": "1", "Signalements clôturés": "5",
    "Preuves enregistrées": "144", "Actions ouvertes avec preuve liée": "1", "Actions ouvertes sans preuve liée": "2",
    "Signalements actifs avec preuve liée": "1", "Signalements actifs sans preuve liée": "2",
  };
  for (const [l, n] of Object.entries(attendu)) assert.equal(tuile(l), n, l);
  assert.ok(texte().includes("« Sans preuve liée » est un repère de pilotage, pas une non-conformité."));
  assert.ok(!/conforme|score|%|audit (prêt|réussi)/i.test(document.querySelector(".tdb").textContent.replace("non-conformité", "")), "aucun score ni diagnostic");
});

test("priorités : raisons, références, échéances et liens vers la bonne fiche", async () => {
  await monter("/tableau-de-bord-qualite", "admin", { [URL_TDB()]: DONNEES });
  await attendre(() => document.querySelector(".tdb-priorites"));
  const items = [...document.querySelectorAll(".tdb-priorite")];
  assert.equal(items.length, 5);
  const attendus = [
    ["Action en retard", "Action AQ-2026-007", "Relancer les convocations", "/actions-qualite/7", "10/01/2030"],
    ["Réclamation en retard", "Signalement REC-2026-003", "Convocation tardive", "/signalements-qualite/3", "05/01/2030"],
    ["Efficacité à vérifier", "Action AQ-2026-008", "Réviser la procédure", "/actions-qualite/8", null],
    ["Résolu, à clôturer", "Signalement INC-2026-001", "Salle indisponible", "/signalements-qualite/4", null],
    ["Action ouverte sans preuve liée", "Action AQ-2026-009", "Former les formateurs", "/actions-qualite/9", null],
  ];
  attendus.forEach(([raison, ref, titre, href, ech], k) => {
    const t = items[k].textContent;
    assert.ok(t.includes(raison) && t.includes(ref), `${k} : ${raison}`);
    const a = items[k].querySelector("a");
    assert.equal(a.textContent, titre);
    assert.equal(a.getAttribute("href"), href);
    if (ech) assert.ok(t.includes(`Échéance : ${ech}`));
    else assert.ok(!t.includes("Échéance"));
  });
  await cliquer(items[1].querySelector("a"));
  await attendre(() => window.location.pathname === "/signalements-qualite/3");
});

test("vue par indicateur : « Aucune preuve enregistrée », recherche, tri, lien vers les preuves", async () => {
  await monter("/tableau-de-bord-qualite", "admin", { [URL_TDB()]: DONNEES });
  await attendre(() => document.querySelector(".tdb-table"));
  const lignes = () => [...document.querySelectorAll(".tdb-table tbody tr")];
  assert.equal(lignes().length, 3);
  const l11 = lignes().find((tr) => tr.textContent.includes("Indicateur 11"));
  assert.ok(l11.textContent.includes("Aucune preuve enregistrée"));
  assert.equal(l11.querySelector("a").getAttribute("href"), "/preuves?indicateur=11");
  const recherche = document.querySelector('.tdb-outils input[type="search"]');
  await saisir(recherche, "31");
  assert.deepEqual(lignes().map((tr) => tr.querySelector("a").textContent), ["Indicateur 31"]);
  await saisir(recherche, "");
  await saisir(document.querySelector(".tdb-outils select"), "activite");
  assert.deepEqual(lignes().map((tr) => tr.querySelector("a").textContent), ["Indicateur 31", "Indicateur 11", "Indicateur 1"]);
  await saisir(recherche, "zzz");
  assert.ok(texte().includes("Aucun indicateur ne correspond."));
});

test("activité récente : libellé, référence cliquable, acteur (ou « Utilisateur indisponible »)", async () => {
  await monter("/tableau-de-bord-qualite", "admin", { [URL_TDB()]: DONNEES });
  await attendre(() => texte().includes("Signalement créé"));
  const items = [...document.querySelectorAll(".qualite-historique__item")];
  assert.ok(items[0].textContent.includes("Mme Stark") && items[0].textContent.includes("Signalement créé : REC-2026-003"));
  assert.equal(items[0].querySelector("a").getAttribute("href"), "/signalements-qualite/3");
  assert.ok(items[1].textContent.includes("Utilisateur indisponible") && items[1].textContent.includes("Preuve rattachée : AQ-2026-007"));
  assert.equal(items[1].querySelector("a").getAttribute("href"), "/actions-qualite/7");
});

test("états vides : messages factuels, aucun « conforme »", async () => {
  await monter("/tableau-de-bord-qualite", "admin", { [URL_TDB()]: VIDE });
  await attendre(() => texte().includes("Aucune priorité actuellement."));
  assert.ok(texte().includes("Aucune activité récente."));
  assert.ok(texte().includes("Aucun indicateur ne correspond."));
  assert.equal(tuile("Actions en retard"), "0");
  assert.ok(!/vous êtes conforme/i.test(texte()));
});

test("erreur API : message propre et bouton Réessayer qui recharge", async () => {
  let n = 0;
  const appels = await monter("/tableau-de-bord-qualite", "admin", { [URL_TDB()]: () => (n++ === 0 ? [500, { error: "Erreur serveur." }] : DONNEES) });
  await attendre(() => texte().includes("Le tableau de bord n'a pas pu être chargé."));
  await cliquer([...document.querySelectorAll("button")].find((b) => b.textContent === "Réessayer"));
  await attendre(() => tuile("Actions ouvertes") === "3");
  assert.equal(appelsTdb(appels).length, 2);
});

test("structure responsive : sections dans l'ordre, tableau d'indicateurs avec libellés de cellule (cartes mobiles)", async () => {
  await monter("/tableau-de-bord-qualite", "admin", { [URL_TDB()]: DONNEES });
  await attendre(() => document.querySelector(".tdb-table"));
  const titres = [...document.querySelectorAll(".tdb h2")].map((h) => h.textContent);
  assert.deepEqual(titres, ["Actions qualité", "Signalements", "Preuves", "Priorités du moment", "Vue par indicateur Qualiopi", "Activité qualité récente"]);
  const td = [...document.querySelector(".tdb-table tbody tr").querySelectorAll("td")].map((c) => c.getAttribute("data-label"));
  assert.deepEqual(td, ["Indicateur", "Preuves", "Actions actives", "Signalements actifs"]);
});
