// Q1-B3-B1 — Signalements : liste, compteurs, segments, filtres URL, retard,
// confidentialité et droits. Aucun window.alert/confirm. API simulée.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, champ, cliquer, demonter, liensNavigation, monter, saisir, texte } from "./outils.jsx";

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

const SIGNALEMENTS = [
  { id: 1, reference: "REC-2026-001", type: "reclamation", objet: "Retard de convocation", date_constat: "2026-09-28",
    statut: "ouverte", responsable_id: 2, formation_id: null, session_id: 1, date_echeance_cible: "2020-01-01",
    indicateurs: [{ id: 5, numero: 32, libelle: "Amélioration continue" }], causes: ["organisation"], nb_actions: 0 },
  { id: 2, reference: "INC-2026-001", type: "incident", objet: "Salle indisponible", date_constat: "2026-09-29",
    statut: "en_traitement", responsable_id: 1, formation_id: 7, session_id: null, date_echeance_cible: null,
    indicateurs: [], causes: ["logistique"], nb_actions: 1 },
  { id: 3, reference: "NC-2026-001", type: "non_conformite", objet: "Écart procédure", date_constat: "2026-09-30",
    statut: "resolue", responsable_id: null, formation_id: null, session_id: null, date_echeance_cible: null,
    indicateurs: [], causes: [], nb_actions: 0 },
  { id: 4, reference: "REC-2026-002", type: "reclamation", objet: "Délai de réponse", date_constat: "2026-09-25",
    statut: "cloturee", responsable_id: 2, formation_id: null, session_id: null, date_echeance_cible: "2020-01-01",
    indicateurs: [], causes: [], nb_actions: 0 },
  { id: 5, reference: "REC-2026-003", type: "reclamation", objet: "Facturation", date_constat: "2026-09-26",
    statut: "annulee", responsable_id: 1, formation_id: null, session_id: null, date_echeance_cible: "2020-01-01",
    indicateurs: [], causes: [], nb_actions: 0 },
];
const avecSignalements = () => ({ "GET /api/signalements": { signalements: SIGNALEMENTS, total: 5 } });

const compteur = (libelle) => {
  const el = [...document.querySelectorAll(".qualite-compteur")].find((c) => c.textContent.includes(libelle));
  return el ? el.querySelector(".qualite-compteur__n").textContent.trim() : null;
};

test("menu : « Signalements » visible pour l'admin, absent pour le contributeur", async () => {
  await monter("/accueil", "admin");
  await attendre(() => liensNavigation().length > 0);
  assert.ok(liensNavigation().includes("Signalements"));
  await demonter();
  await monter("/accueil", "contributeur");
  await attendre(() => liensNavigation().length > 0);
  assert.ok(!liensNavigation().includes("Signalements"), "entrée admin uniquement");
});

test("route admin : la liste de signalements se charge", async () => {
  await monter("/signalements-qualite", "admin", avecSignalements());
  await attendre(() => texte().includes("Retard de convocation"));
  assert.ok(texte().includes("Signalements"));
});

test("route contributeur : page réservée, AUCUN appel /api/signalements", async () => {
  const appels = await monter("/signalements-qualite", "contributeur");
  await attendre(() => texte().includes("Cette page est réservée aux administrateurs."));
  assert.ok(!appels.some((a) => a.chemin === "/api/signalements"), "aucune requête signalements émise");
});

test("état vide admin : message dédié", async () => {
  await monter("/signalements-qualite", "admin");
  await attendre(() => texte().includes("Aucun signalement pour le moment."));
});

test("liste : libellés lisibles, pas de valeur technique brute", async () => {
  await monter("/signalements-qualite", "admin", avecSignalements());
  await attendre(() => texte().includes("Retard de convocation"));
  assert.ok(texte().includes("REC-2026-001"));
  assert.ok(texte().includes("Réclamation"), "type en libellé");
  assert.ok(texte().includes("Incident"));
  assert.ok(texte().includes("Non-conformité"));
  assert.ok(texte().includes("En traitement"), "statut en libellé");
  assert.ok(!texte().includes("reclamation"), "aucune valeur technique brute");
  assert.ok(!texte().includes("en_traitement"));
});

test("mapping : responsable par nom, session par référence (jamais d'ID brut)", async () => {
  await monter("/signalements-qualite", "admin", avecSignalements());
  await attendre(() => texte().includes("Retard de convocation"));
  assert.ok(texte().includes("Tukui"), "nom du responsable");
  assert.ok(texte().includes("SESS-TEST"), "référence de session");
  assert.ok(!texte().includes("responsable_id"));
  assert.ok(!texte().includes("formation_id"));
});

test("compteurs : À traiter / En retard / Résolues / Clôturées", async () => {
  await monter("/signalements-qualite", "admin", avecSignalements());
  await attendre(() => texte().includes("Retard de convocation"));
  assert.equal(compteur("À traiter"), "2");
  assert.equal(compteur("En retard"), "1");
  assert.equal(compteur("Résolues"), "1");
  assert.equal(compteur("Clôturées"), "1");
});

test("filtre type dans l'URL", async () => {
  await monter("/signalements-qualite", "admin", avecSignalements());
  await attendre(() => texte().includes("Retard de convocation"));
  await saisir(champ("Type"), "incident");
  await attendre(() => !texte().includes("Retard de convocation"));
  assert.ok(texte().includes("Salle indisponible"));
});

test("filtre responsable (côté client)", async () => {
  await monter("/signalements-qualite", "admin", avecSignalements());
  await attendre(() => texte().includes("Retard de convocation"));
  await saisir(champ("Responsable"), "2");
  await attendre(() => !texte().includes("Salle indisponible"));
  assert.ok(texte().includes("Retard de convocation"));
});

test("filtre indicateur (côté client)", async () => {
  await monter("/signalements-qualite", "admin", avecSignalements());
  await attendre(() => texte().includes("Retard de convocation"));
  await saisir(champ("Indicateur"), "5");
  await attendre(() => !texte().includes("Salle indisponible"));
  assert.ok(texte().includes("Ind. 32"));
});

test("reset filtres", async () => {
  await monter("/signalements-qualite?type=incident", "admin", avecSignalements());
  await attendre(() => texte().includes("Salle indisponible"));
  await attendre(() => !texte().includes("Retard de convocation"));
  const btn = bouton("Réinitialiser les filtres");
  await cliquer(btn);
  await attendre(() => texte().includes("Retard de convocation"));
  assert.ok(texte().includes("Salle indisponible"));
});

test("valeur URL invalide neutralisée : la liste ne se vide pas", async () => {
  await monter("/signalements-qualite?statut=inconnu", "admin", avecSignalements());
  await attendre(() => texte().includes("Retard de convocation"));
  assert.ok(texte().includes("Salle indisponible"), "statut inconnu ignoré, liste complète");
});

test("recherche : sur la référence et l'objet uniquement", async () => {
  await monter("/signalements-qualite", "admin", avecSignalements());
  await attendre(() => texte().includes("Retard de convocation"));
  const champRecherche = document.querySelector('.veille-filtres input[type="search"]');
  await saisir(champRecherche, "convocation");
  await attendre(() => !texte().includes("Salle indisponible"));
  assert.ok(texte().includes("Retard de convocation"));
});

test("retard : réclamation active dépassée signalée, les autres non", async () => {
  await monter("/signalements-qualite?etat=tous", "admin", avecSignalements());
  await attendre(() => texte().includes("Retard de convocation"));
  const lignes = [...document.querySelectorAll("tbody tr")];
  const badgeDe = (tr) => tr.textContent.includes("En retard");
  const parObjet = (obj) => lignes.find((tr) => tr.textContent.includes(obj));
  assert.ok(badgeDe(parObjet("Retard de convocation")), "réclamation ouverte dépassée");
  assert.ok(!badgeDe(parObjet("Salle indisponible")), "incident sans échéance");
  assert.ok(!badgeDe(parObjet("Délai de réponse")), "clôturée");
  assert.ok(!badgeDe(parObjet("Facturation")), "annulée");
});

test("retard (règle PO) : réclamation résolue dépassée ⇒ dans « Actifs », sans badge ni compteur En retard", async () => {
  await monter("/signalements-qualite", "admin", {
    "GET /api/signalements": { signalements: [
      { id: 6, reference: "REC-2026-004", type: "reclamation", objet: "Réponse tardive", date_constat: "2026-09-20",
        statut: "resolue", responsable_id: 2, formation_id: null, session_id: null, date_echeance_cible: "2020-01-01",
        indicateurs: [], causes: [], nb_actions: 0 },
    ], total: 1 },
  });
  await attendre(() => texte().includes("Réponse tardive"));
  const ligne = [...document.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes("Réponse tardive"));
  assert.ok(ligne, "visible dans le segment « Actifs » par défaut");
  assert.ok(!ligne.textContent.includes("En retard"), "aucun badge « En retard »");
  assert.equal(compteur("En retard"), "0");
});

test("aucune donnée réclamant n'est affichée dans la liste", async () => {
  await monter("/signalements-qualite", "admin", {
    "GET /api/signalements": {
      signalements: [{
        id: 1, reference: "REC-2026-001", type: "reclamation", objet: "Objet neutre", date_constat: "2026-09-28",
        statut: "ouverte", responsable_id: 2, formation_id: null, session_id: null, date_echeance_cible: null,
        indicateurs: [], causes: [],
        reclamant_nom: "Dupont", reclamant_email: "dupont@x.fr", reclamant_entreprise: "ACME",
        personne_concernee_libelle: "Mme X", description: "Description détaillée", synthese_reponse: "Réponse envoyée",
      }],
      total: 1,
    },
  });
  await attendre(() => texte().includes("Objet neutre"));
  assert.ok(!texte().includes("Dupont"));
  assert.ok(!texte().includes("dupont@x.fr"));
  assert.ok(!texte().includes("ACME"));
  assert.ok(!texte().includes("Mme X"));
  assert.ok(!texte().includes("Description détaillée"));
  assert.ok(!texte().includes("Réponse envoyée"));
});
