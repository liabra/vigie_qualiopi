// Organisme et signataires (admin) : coordonnées, signataires (création, modification, désactivation),
// choix du signataire dans le formulaire de modèle.
import "./dom.mjs";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, champ, cliquer, demonter, dialogue, monter, saisir, texte } from "./outils.jsx";

afterEach(demonter);

const ORGANISME = { organisme: { nom: "Association Test", adresse_ligne1: "1 rue Exemple", adresse_ligne2: null, code_postal: "97300", ville: "Cayenne", telephone: null, mobile: "06 94 00 00 02", email: null } };
const SIGNATAIRES = { signataires: [
  { id: 1, nom: "Marie Test", fonction: "Présidente", actif: true },
  { id: 2, nom: "Ancien Test", fonction: "Intérim", actif: false },
], total: 2 };

test("coordonnées : préremplies, enregistrées par PUT, champs vides envoyés pour effacement", async () => {
  const appels = await monter("/parametres/organisme", "admin", {
    "GET /api/parametres/organisme": ORGANISME, "GET /api/signataires": SIGNATAIRES,
    "PUT /api/parametres/organisme": { ok: true, organisme: ORGANISME.organisme },
  });
  await attendre(() => champ("Nom de l'organisme"));
  assert.equal(champ("Nom de l'organisme").value, "Association Test");
  assert.equal(champ("Téléphone mobile").value, "06 94 00 00 02");
  assert.equal(champ("Téléphone fixe").value, "", "valeur absente = champ vide");
  await saisir(champ("Téléphone fixe"), "05 94 00 00 01");
  await saisir(champ("Ville"), "");
  await cliquer(bouton("Enregistrer les coordonnées"));
  await attendre(() => appels.some((a) => a.methode === "PUT"));
  const corps = appels.find((a) => a.methode === "PUT").corps;
  assert.equal(corps.telephone, "05 94 00 00 01");
  assert.equal(corps.ville, "", "champ vidé envoyé : le serveur l'efface");
  await attendre(() => texte().includes("Coordonnées enregistrées"));
});

test("coordonnées : erreur du serveur affichée, rien de faux n'est annoncé", async () => {
  await monter("/parametres/organisme", "admin", {
    "GET /api/parametres/organisme": ORGANISME, "GET /api/signataires": SIGNATAIRES,
    "PUT /api/parametres/organisme": [400, { error: "Téléphone fixe : numéro invalide." }],
  });
  await attendre(() => champ("Nom de l'organisme"));
  await saisir(champ("Téléphone fixe"), "abc");
  await cliquer(bouton("Enregistrer les coordonnées"));
  await attendre(() => texte().includes("numéro invalide"));
  assert.ok(!texte().includes("Coordonnées enregistrées"));
});

test("signataires : liste avec statut, ajout, désactivation confirmée, refus affiché", async () => {
  const appels = await monter("/parametres/organisme", "admin", {
    "GET /api/parametres/organisme": ORGANISME, "GET /api/signataires?inactifs=1": SIGNATAIRES,
    "POST /api/signataires": [201, { signataire: { id: 3 } }],
    "PATCH /api/signataires/1": [409, { error: "Ce signataire est utilisé par : Convocation. Changez leur signataire d'abord.", code: "signataire_utilise" }],
  });
  await attendre(() => texte().includes("Marie Test"));
  assert.ok(texte().includes("Désactivé") && texte().includes("Actif"));

  await cliquer(bouton("+ Nouveau signataire"));
  await attendre(() => dialogue()?.textContent.includes("Nouveau signataire"));
  await cliquer(dialogue().querySelector('button[type="submit"]'));
  await attendre(() => dialogue().textContent.includes("Indiquez le nom."));
  await saisir(champ("Nom"), "Lia Test");
  await saisir(champ("Fonction"), "Référente Qualiopi");
  await cliquer(dialogue().querySelector('button[type="submit"]'));
  await attendre(() => appels.some((a) => a.methode === "POST" && a.chemin === "/api/signataires"));
  assert.deepEqual(appels.find((a) => a.methode === "POST").corps, { nom: "Lia Test", fonction: "Référente Qualiopi" });

  await cliquer(document.querySelector('button[aria-label="Désactiver Marie Test"]'));
  await attendre(() => dialogue()?.textContent.includes("Désactiver ce signataire"));
  assert.ok(!appels.some((a) => a.methode === "PATCH"), "rien avant confirmation");
  await cliquer([...dialogue().querySelectorAll("button")].find((b) => b.textContent === "Désactiver"));
  await attendre(() => texte().includes("est utilisé par : Convocation"));
});

test("modèle : choix du signataire fixe parmi les signataires actifs, envoyé à l'enregistrement", async () => {
  const modele = { id: 7, nom: "Convocation", portee: "stagiaire", description: "", type_document: "convocation", mode_generation: "manuel", condition_generation: null,
    declencheur: null, condition_code: null, signataire_mode: "aucun", signataire_id: null, drive_url: "https://docs.google.com/document/d/CONV1234567890/edit",
    drive_mime: "application/vnd.google-apps.document", indicateurs: [{ id: 111, numero: 11 }] };
  const appels = await monter("/modeles", "admin", {
    "GET /api/modeles": { modeles: [modele], marqueurs: [] },
    "GET /api/signataires": { signataires: [SIGNATAIRES.signataires[0]] },
    "GET /api/referentiel": { version: { id: 1, code: "V9" }, totalIndicateurs: 1, score: { maitrise: 0, a_consolider: 0, a_risque: 0, non_applicable: 0, total: 1, preuves: 0, a_confirmer: 0 },
      criteres: [{ id: 3, numero: 3, libelle: "Adaptation", indicateurs: [{ id: 111, numero: 11, libelle: "Évaluation" }] }] },
    "GET /api/modeles/7/diagnostic": { etat: "valide", version_dictionnaire: "1.5", type_fichier: "document", analyse_le: "2026-10-10T10:00:00Z",
      nombre_occurrences_balises: 0, nombre_balises_uniques: 0, canoniques: [], alias: [], historiques: [], blocs: [], champs_bloc: [], inconnues: [], erreurs: [], avertissements: [], suggestions: [] },
    "PATCH /api/modeles/7": { ok: true, modele },
  });
  await attendre(() => texte().includes("Convocation"));
  await cliquer(document.querySelector('button[aria-label="Voir le détail du modèle Convocation"]'));
  await attendre(() => texte().includes("Aucun signataire"));
  await cliquer(bouton("Modifier"));
  await attendre(() => dialogue()?.textContent.includes("Modifier le modèle"));
  await attendre(() => champ("Signataire"));
  await saisir(champ("Signataire"), "fixe");
  await cliquer(dialogue().querySelector('button[type="submit"]'));
  await attendre(() => dialogue().textContent.includes("Choisissez le signataire."));
  assert.ok(!appels.some((a) => a.methode === "PATCH"), "signataire fixe sans choix : refusé avant envoi");
  await saisir(champ("Signataire fixe"), "1");
  await cliquer(dialogue().querySelector('button[type="submit"]'));
  await attendre(() => appels.some((a) => a.methode === "PATCH"));
  const corps = appels.find((a) => a.methode === "PATCH").corps;
  assert.deepEqual([corps.signataire_mode, corps.signataire_id], ["fixe", 1]);
});
