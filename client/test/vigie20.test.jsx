// Vigie 2.0 côté interface : registres générés depuis le schéma, échéancier, préparation d'audit, enquêtes et
// questionnaire public, comptes et accès, portail auditeur. API simulée.
import "./dom.mjs";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, champ, cliquer, demonter, dialogue, monter, saisir, texte } from "./outils.jsx";
import { corpsDe } from "../src/pilotage/RegistrePage.jsx";

afterEach(async () => { await demonter(); });

const SCHEMA_TACHES = { nom: "taches", titre: "Tâches qualité", singulier: "tâche", feminin: true, description: "Ce qui doit être fait.", ecriture: "redacteur", statutsOuverts: ["a_faire", "en_cours"],
  champs: [
    { nom: "titre", libelle: "Intitulé", type: "texte", max: 200, requis: true, colonne: true },
    { nom: "echeance", libelle: "Échéance", type: "date", colonne: true },
    { nom: "statut", libelle: "Statut", type: "enum", valeurs: ["a_faire", "faite"], libelles: { a_faire: "À faire", faite: "Faite" }, defaut: "a_faire", colonne: true, filtre: true },
    { nom: "responsable_id", libelle: "Responsable", type: "utilisateur" },
    { nom: "indicateurs", libelle: "Indicateurs concernés", type: "indicateurs" },
    { nom: "faite_le", libelle: "Faite le", type: "date", lectureSeule: true },
  ] };

test("pur : le corps envoyé ne contient que les champs modifiés, numéros d'indicateurs convertis", () => {
  const initiales = { titre: "A", echeance: "", statut: "a_faire", responsable_id: "", indicateurs: "1, 2" };
  assert.deepEqual(corpsDe(SCHEMA_TACHES, { ...initiales, statut: "faite", indicateurs: "1, 2, 30" }, initiales), { statut: "faite", indicateurs: [1, 2, 30] });
  assert.deepEqual(corpsDe(SCHEMA_TACHES, { titre: "B", echeance: "", statut: "a_faire", responsable_id: "3", indicateurs: "" }, null),
    { titre: "B", echeance: null, statut: "a_faire", responsable_id: 3, indicateurs: [] });
});

test("tâches : tableau généré depuis le schéma, retard signalé, création envoyée à l'API", async () => {
  const appels = await monter("/taches", "contributeur", {
    "GET /api/registres/taches/schema": { schema: SCHEMA_TACHES },
    "GET /api/registres/taches": { fiches: [{ id: 1, titre: "Revue des preuves", echeance: "2020-01-31", statut: "a_faire", indicateurs: [1] }], ecriture: true },
    "GET /api/registres-utilisateurs": { utilisateurs: [{ id: 3, nom: "Lia" }] },
    "POST /api/registres/taches": { fiche: { id: 2 } },
  });
  await attendre(() => texte().includes("Revue des preuves"));
  assert.ok(texte().includes("(en retard)"));
  await cliquer(bouton("+ Nouvelle tâche"));
  await attendre(() => champ("Intitulé"));
  await saisir(champ("Intitulé"), "Mettre à jour le livret d'accueil");
  await saisir(champ("Responsable"), "3");
  await cliquer(bouton("Enregistrer"));
  await attendre(() => appels.some((a) => a.methode === "POST"));
  const corps = appels.find((a) => a.methode === "POST").corps;
  assert.equal(corps.titre, "Mettre à jour le livret d'accueil");
  assert.equal(corps.responsable_id, 3);
  assert.equal(corps.statut, "a_faire");
});

test("échéancier : regroupé par mois, alerte de retard", async () => {
  await monter("/echeancier", "admin", {
    "GET /api/echeancier": { du: "2026-11-01", au: "2027-05-01", en_retard: 2, evenements: [
      { type: "tache", id: 1, libelle: "Revue des preuves", date: "2026-12-05", statut: "a_faire", responsable: "Lia", lien: "/taches" },
      { type: "session", id: 4, libelle: "Atelier (début)", date: "2027-01-10", statut: "planifiee", lien: "/sessions/4" },
    ] },
  });
  await attendre(() => texte().includes("Revue des preuves"));
  assert.ok(texte().includes("2 élément(s) en retard"));
  assert.ok(texte().toLowerCase().includes("décembre 2026") && texte().toLowerCase().includes("janvier 2027"));
});

test("questionnaire public : sans connexion, réponses envoyées, message de remerciement", async () => {
  const appels = await monter("/repondre/jeton_de_test_suffisamment_long", null, {
    "GET /api/public/enquetes/jeton_de_test_suffisamment_long": { enquete: { titre: "Satisfaction à chaud", introduction: "Merci", formation: "Atelier", organisme: "A2C" },
      questions: [{ id: 7, libelle: "Globalement satisfait ?", type: "echelle", options: [], obligatoire: true }, { id: 8, libelle: "Commentaire", type: "texte", options: [], obligatoire: false }] },
    "POST /api/public/enquetes/jeton_de_test_suffisamment_long/reponses": [201, { ok: true, message: "Merci ! Votre réponse a bien été enregistrée." }],
  });
  await attendre(() => texte().includes("Globalement satisfait ?"));
  assert.ok(!texte().includes("Se connecter"), "aucune connexion demandée");
  await cliquer([...document.querySelectorAll('input[name="q7"]')][3]);
  await saisir(document.querySelector("textarea"), "Très bien");
  await cliquer(bouton("Envoyer mes réponses"));
  await attendre(() => texte().includes("Réponse enregistrée"));
  assert.deepEqual(appels.find((a) => a.methode === "POST").corps, { reponses: { 7: 4, 8: "Très bien" } });
});

test("enquête : lien public affiché, résultats en barres, alerte d'insatisfaction", async () => {
  await monter("/enquetes/5", "admin", {
    "GET /api/enquetes/5": {
      enquete: { id: 5, titre: "Satisfaction à chaud", type: "a_chaud", jeton: "abcdefghijklmnopqrstuvwxyz12", active: true, reponses: 3, inscrits: 4, taux_reponse: 75, formation: "Atelier", session_reference: "S1", date_debut: "2026-12-01", session_fin: "2026-12-10" },
      questions: [{ id: 1, libelle: "Globalement", type: "echelle", obligatoire: true, globale: true, options: [] }],
      synthese: [{ question_id: 1, libelle: "Globalement", type: "echelle", reponses: 3, moyenne: 2.7, taux_satisfaits: 33, repartition: [0, 1, 1, 1, 0] }],
      alertes: ["Satisfaction globale en dessous de 70 % de satisfaits."], types: { a_chaud: "Satisfaction à chaud" }, types_question: { echelle: "Échelle de 1 à 5" },
    },
  });
  await attendre(() => texte().includes("Résultats"));
  assert.ok(document.querySelector('input[readonly]').value.endsWith("/repondre/abcdefghijklmnopqrstuvwxyz12"));
  assert.ok(texte().includes("33 %") && texte().includes("75 %"));
  assert.ok(texte().includes("en dessous de 70 %"));
});

test("comptes : ajout d'un auditeur avec date de fin", async () => {
  const appels = await monter("/parametres/comptes", "admin", {
    "GET /api/comptes": { comptes: [{ id: 1, email: "t@exemple.fr", nom: "Mme Test", role: "admin", actif: true }], roles: ["admin", "contributeur", "auditeur"] },
    "GET /api/journal-securite": { evenements: [] },
    "POST /api/comptes": [201, { compte: { id: 2 } }],
  });
  await attendre(() => bouton("+ Ajouter un compte"));
  await cliquer(bouton("+ Ajouter un compte"));
  await attendre(() => champ("Adresse Google"));
  await saisir(champ("Adresse Google"), "auditeur@certif.test");
  await saisir(champ("Rôle"), "auditeur");
  await saisir(champ("Accès jusqu'au"), "2027-03-31");
  await cliquer(bouton("Enregistrer"));
  await attendre(() => appels.some((a) => a.methode === "POST"));
  assert.deepEqual(appels.find((a) => a.methode === "POST").corps, { email: "auditeur@certif.test", nom: null, role: "auditeur", expire_le: "2027-03-31" });
});

test("auditeur : seule la page des dossiers d'audit, toute autre adresse y ramène", async () => {
  await monter("/sessions", "auditeur", {
    "GET /api/portail-audit/campagnes": { campagnes: [{ id: 3, titre: "Audit de surveillance", type: "surveillance", date_audit: "2027-03-01" }], types: { surveillance: "Audit de surveillance" } },
  });
  await attendre(() => texte().includes("Audit de surveillance"));
  assert.equal(window.location.pathname, "/portail-audit");
  assert.ok(!texte().includes("Sessions"), "aucune entrée de navigation interne");
  assert.ok(!dialogue());
});
