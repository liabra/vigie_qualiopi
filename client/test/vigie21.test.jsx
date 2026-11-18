// Candidatures (formulaire public et gestion), portails stagiaire et formateur, accès, développement des
// intervenants, preuves PDF. API simulée.
import "./dom.mjs";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, champ, cliquer, demonter, monter, saisir, texte } from "./outils.jsx";

afterEach(async () => { await demonter(); });

test("candidature publique : sans connexion, formation choisie, consentement exigé côté interface, envoi", async () => {
  const appels = await monter("/candidater?formation=4", null, {
    "GET /api/public/candidature": { organisme: { nom: "A2C" }, situations: ["Demandeur d'emploi", "Autre"], formations: [
      { id: 4, intitule: "Initiation au numérique", objectifs: "Autonomie", pieces_attendues: ["CV"], sessions: [{ id: 9, date_debut: "2027-01-10", date_fin: "2027-01-20", lieu: "Cayenne" }] }] },
    "POST /api/public/candidatures": [201, { ok: true, message: "Merci, votre candidature a bien été reçue." }],
  });
  await attendre(() => texte().includes("Candidater à une formation"));
  assert.ok(!texte().includes("Se connecter"));
  assert.equal(champ("Formation souhaitée").value, "4", "formation présélectionnée par le lien");
  assert.ok(texte().includes("Pièces à prévoir : CV"));
  await saisir(champ("Nom"), "Martin");
  await saisir(champ("Prénom"), "Léa");
  await saisir(champ("E-mail"), "lea@exemple.fr");
  await saisir(champ("Session souhaitée"), "9");
  await cliquer(document.querySelector('.ui-case input[type="checkbox"]'));
  await cliquer(bouton("Envoyer ma candidature"));
  await attendre(() => texte().includes("Candidature envoyée"));
  const corps = appels.find((a) => a.methode === "POST").corps;
  assert.deepEqual([corps.formation_id, corps.session_souhaitee_id, corps.nom, corps.consentement], [4, 9, "Martin", true]);
  assert.equal(corps.site_web, undefined, "champ piège vide : non envoyé");
});

test("portail : le lien ouvre l'espace (jeton retiré de l'adresse), vue stagiaire avec documents et enquêtes", async () => {
  const appels = await monter("/portail/" + "a".repeat(43), null, {
    "POST /api/portail/connexion": { type: "stagiaire" },
    "GET /api/portail/moi": { type: "stagiaire", personne: { prenom: "Léa", nom: "Martin" }, organisme: { nom: "A2C", telephone: "05 94 27 23 18" } },
    "GET /api/portail/stagiaire": { inscriptions: [{ inscription_id: 11, formation: "Initiation au numérique", date_debut: "2026-12-01", date_fin: "2026-12-10", horaire: "9h-12h", lieu: "Cayenne",
      assiduite: 95, objectif: "Autonomie", objectifs_operationnels: ["Envoyer un e-mail"], prochaines_seances: [], documents: [{ id: 7, nom: "Convocation", genere_le: "2026-11-20" }],
      enquetes: [{ titre: "Satisfaction à chaud", chemin: "/repondre/xyz" }], evaluations: [], competences: [{ competence: "AT01", statut: "acquis" }] }] },
  });
  await attendre(() => texte().includes("Bonjour Léa"));
  assert.equal(window.location.pathname, "/espace");
  assert.deepEqual(appels.find((a) => a.chemin === "/api/portail/connexion").corps, { jeton: "a".repeat(43) });
  await attendre(() => texte().includes("Mes documents"));
  assert.equal(document.querySelector('a[href="/api/portail/stagiaire/documents/7/pdf"]').textContent, "Convocation");
  assert.ok(texte().includes("Assiduité : 95 %") && texte().includes("AT01 — Acquis") && texte().includes("Satisfaction à chaud"));
});

test("portail : lien invalide → message clair, aucun espace", async () => {
  await monter("/portail/" + "b".repeat(43), null, { "POST /api/portail/connexion": [401, { error: "Ce lien d'accès est invalide, expiré ou a été désactivé." }] });
  await attendre(() => texte().includes("Accès impossible"));
  assert.ok(texte().includes("expiré"));
});

test("portail formateur : sessions, saisie du suivi d'une séance", async () => {
  const appels = await monter("/espace", null, {
    "GET /api/portail/moi": { type: "formateur", personne: { prenom: "Anne", nom: "Formatrice" }, organisme: { nom: "A2C" } },
    "GET /api/portail/formateur": { justificatifs: [], sessions: [{ id: 3, formation: "Atelier", reference: "S1", date_debut: "2026-12-01", date_fin: "2026-12-10",
      seances: [{ id: 21, date_seance: "2026-12-02", heure_debut: "09:00:00", heure_fin: "12:00:00", theme: "Messagerie" }], stagiaires: [{ inscription_id: 11, prenom: "Léa", nom: "Martin" }], ressources: [] }] },
    "GET /api/portail/formateur/seances/21": { seance: { id: 21, date_seance: "2026-12-02", theme: "Messagerie" }, archivee: false, suivis: [{ inscription_id: 11, prenom: "Léa", nom: "Martin" }] },
    "PUT /api/portail/formateur/seances/21/suivi/11": { ok: true },
  });
  await attendre(() => texte().includes("Bonjour Anne"));
  await attendre(() => bouton("Suivi de la séance"));
  await cliquer(bouton("Suivi de la séance"));
  await attendre(() => champ("Observations"));
  await saisir(champ("Observations"), "Très investie");
  await cliquer(bouton("Enregistrer"));
  await attendre(() => appels.some((a) => a.methode === "PUT"));
  assert.equal(appels.find((a) => a.methode === "PUT").corps.observations, "Très investie");
});

test("accès aux portails : le lien n'est affiché qu'à la création", async () => {
  const appels = await monter("/acces-portails", "admin", {
    "GET /api/acces-portail": { acces: [] },
    "GET /api/intervenants": { intervenants: [{ id: 5, prenom: "Anne", nom: "Formatrice", actif: true }] },
    "POST /api/acces-portail": [201, { acces: { id: 1, expire_le: "2027-02-16" }, chemin: "/portail/" + "c".repeat(43) }],
  });
  await attendre(() => bouton("+ Créer un accès"));
  await cliquer(bouton("+ Créer un accès"));
  await attendre(() => champ("Espace"));
  await saisir(champ("Espace"), "formateur");
  await attendre(() => champ("Formateur"));
  await saisir(champ("Formateur"), "5");
  await cliquer(bouton("Créer le lien"));
  await attendre(() => texte().includes("copiez le lien maintenant"));
  assert.ok(document.querySelector('input[aria-label="Lien d\'accès"]').value.endsWith("/portail/" + "c".repeat(43)));
  assert.deepEqual(appels.find((a) => a.methode === "POST").corps, { type: "formateur", duree_jours: 90, intervenant_id: 5 });
});

test("développement des intervenants : plan, entretien à planifier signalé, PDF disponible", async () => {
  await monter("/developpement-intervenants", "admin", {
    "GET /api/developpement": { actions: [], types: {}, statuts: {}, intervenants: [{ id: 5, prenom: "Anne", nom: "Formatrice", realisees: 1, prevues: 0, entretien_a_faire: true, besoins_developpement: "IA" }] },
  });
  await attendre(() => texte().includes("Anne Formatrice"));
  assert.ok(texte().includes("À planifier"));
  assert.ok(document.querySelector('a[href="/api/pdf/developpement"]'));
});

test("preuves PDF : catalogue filtré par le serveur, liens de téléchargement", async () => {
  await monter("/preuves-pdf", "contributeur", {
    "GET /api/pdf/catalogue": { exports: [{ id: "registre-risques", titre: "Risques qualité", description: "Registre", chemin: "/api/pdf/registres/risques" }] },
  });
  await attendre(() => texte().includes("Risques qualité"));
  assert.ok(document.querySelector('a[href="/api/pdf/registres/risques"][download]'));
  assert.ok(!texte().includes("Par session"), "sections administrateur masquées");
});
