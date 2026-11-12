// Documents partagés — liste, fiche, corbeille administrateur, droits et retours d'erreur.
// API simulée ; le serveur reste seul juge des droits (ici, il renvoie déjà ce que le rôle voit).
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, dialogue, monter, saisir, texte } from "./outils.jsx";

const DOC_PUBLIC = {
  id: 5, drive_nom: "Attestation Martin.pdf", drive_mime: "application/pdf", drive_url: "https://drive.google.com/file/d/A/view",
  source: "generation", confidentiel: false, version_courante: 2, archive_le: null, nb_liens: 2,
};
const DOC_CONFIDENTIEL = { ...DOC_PUBLIC, id: 6, drive_nom: "Convention.pdf", confidentiel: true, version_courante: 1, nb_liens: 1 };

const LIENS = [
  { preuve_id: 81, origine: "manuel", titre: "Livret d'accueil v3", statut: "maitrise", indicateur: 11, en_attente_revalidation: true },
  { preuve_id: 82, origine: "generation", titre: "Attestations de fin de formation", statut: "maitrise", indicateur: 23, en_attente_revalidation: false },
];
const FORMATIONS = [{ formation_id: 1, intitule: "Formation test", origine: "manuel", valide: false }];

// Fiche vue par un contributeur : pas de versions, liens et formations limités à ce qu'il voit.
const FICHE_CONTRIBUTEUR = { document: DOC_PUBLIC, liens: [LIENS[1]], formations: [] };
// Fiche vue par l'administrateur : tout, y compris les versions.
const FICHE_ADMIN = {
  document: DOC_PUBLIC, liens: LIENS, formations: FORMATIONS,
  versions: [
    { numero: 1, drive_file_id: "V1", drive_url: "https://drive.google.com/file/d/V1/view", drive_nom: "Attestation v1.pdf", introduite_le: "2026-09-01", remplacee_le: "2026-09-10", corbeille_le: null },
    { numero: 2, drive_file_id: "V2", drive_url: "https://drive.google.com/file/d/V2/view", drive_nom: "Attestation v2.pdf", introduite_le: "2026-09-10", remplacee_le: null, corbeille_le: null },
  ],
};
const OPERATIONS = [
  { id: 9, document_id: 5, numero: 1, drive_file_id: "V1", statut: "bloquee", tentatives: 0, motif: "fichier_introuvable", derniere_erreur: "Fichier introuvable côté Drive", cree_le: "2026-09-10", bloquee_le: "2026-09-11" },
  { id: 10, document_id: 6, numero: 1, drive_file_id: "W1", statut: "en_attente", tentatives: 2, motif: null, derniere_erreur: "Drive : indisponible", cree_le: "2026-09-12", bloquee_le: null },
];

let natifs = 0;
beforeEach(() => { natifs = 0; window.alert = () => { natifs++; }; window.confirm = () => { natifs++; return true; }; });
afterEach(async () => { assert.equal(natifs, 0, "aucune boîte native"); await demonter(); });

const appelsVers = (appels, methode, chemin) => appels.filter((a) => a.methode === methode && a.chemin === chemin);
const boutonDans = (racine, libelle) => [...racine.querySelectorAll("button")].find((b) => b.textContent.trim() === libelle);

test("contributeur : la liste ne montre que les documents reçus, sans section corbeille", async () => {
  const appels = await monter("/documents", "contributeur", { "GET /api/documents": { documents: [DOC_PUBLIC] } });
  await attendre(() => texte().includes("Attestation Martin.pdf"));
  assert.equal(texte().includes("Convention.pdf"), false);
  assert.equal(texte().includes("Corbeille"), false);
  assert.equal(appels.some((a) => a.chemin === "/api/corbeille/en-attente"), false, "aucune requête administrateur");
});

test("contributeur : la fiche présente liens et formations, sans version ni action administrateur", async () => {
  await monter("/documents/5", "contributeur", { "GET /api/documents/5": FICHE_CONTRIBUTEUR });
  await attendre(() => texte().includes("Attestations de fin de formation"));
  assert.equal(texte().includes("Livret d'accueil v3"), false, "lien non visible non affiché");
  assert.equal(document.querySelector("#versions-titre"), null, "pas de section versions");
  assert.equal(boutonDans(document, "Détacher"), undefined);
  assert.equal(boutonDans(document, "Remplacer"), undefined);
  const lien = document.querySelector('a[href^="https://drive.google.com/"]');
  assert.ok(lien, "lien Drive présenté");
  assert.equal(lien.getAttribute("rel"), "noopener noreferrer");
});

test("administrateur : la version courante est identifiée, la corbeille n'est proposée que pour les anciennes", async () => {
  await monter("/documents/5", "admin", { "GET /api/documents/5": FICHE_ADMIN });
  await attendre(() => document.querySelector("#versions-titre"));
  const courante = document.querySelector('tr[aria-current="true"]');
  assert.ok(courante && courante.textContent.includes("Version courante"), "version courante identifiée");
  const corbeilles = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Mettre à la corbeille");
  assert.equal(corbeilles.length, 1, "une seule ancienne version concernée");
});

test("administrateur : mise à la corbeille après confirmation explicite (POST confirmer=true)", async () => {
  const appels = await monter("/documents/5", "admin", {
    "GET /api/documents/5": FICHE_ADMIN,
    "POST /api/documents/5/versions/1/corbeille": { ok: true, statut: "confirmee", operationId: 3 },
  });
  await attendre(() => document.querySelector("#versions-titre"));
  const declencheur = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Mettre à la corbeille");
  await cliquer(declencheur);
  await attendre(() => dialogue());
  assert.equal(appelsVers(appels, "POST", "/api/documents/5/versions/1/corbeille").length, 0, "rien avant confirmation");
  await cliquer(boutonDans(dialogue(), "Mettre à la corbeille"));
  await attendre(() => texte().includes("Version n°1 mise à la corbeille"));
  const envoi = appelsVers(appels, "POST", "/api/documents/5/versions/1/corbeille");
  assert.equal(envoi.length, 1);
  assert.deepEqual(envoi[0].corps, { confirmer: true });
});

test("Drive indisponible (503) : message clair, rien présenté comme effectué", async () => {
  await monter("/documents/5", "admin", {
    "GET /api/documents/5": FICHE_ADMIN,
    "POST /api/documents/5/versions/1/corbeille": [503, { error: "Drive indisponible.", code: "corbeille_echec" }],
  });
  await attendre(() => document.querySelector("#versions-titre"));
  await cliquer([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Mettre à la corbeille"));
  await attendre(() => dialogue());
  await cliquer(boutonDans(dialogue(), "Mettre à la corbeille"));
  await attendre(() => texte().includes("n'a pas abouti sur Drive"));
  assert.equal(texte().includes("mise à la corbeille."), false);
});

test("revalidation d'un lien : appel serveur puis confirmation à l'écran", async () => {
  const appels = await monter("/documents/5", "admin", {
    "GET /api/documents/5": FICHE_ADMIN,
    "POST /api/preuves/81/documents/5/revalider": { ok: true },
  });
  await attendre(() => document.querySelector("#liens-titre"));
  await cliquer(boutonDans(document, "Revalider"));
  await attendre(() => texte().includes("Lien revalidé"));
  assert.equal(appelsVers(appels, "POST", "/api/preuves/81/documents/5/revalider").length, 1);
});

test("document introuvable ou non accessible : message clair et retour à la liste", async () => {
  await monter("/documents/99", "contributeur", { "GET /api/documents/99": [404, { error: "Document introuvable." }] });
  await attendre(() => texte().includes("Ce document n'est pas disponible"));
  assert.ok(texte().includes("Élément introuvable"));
  assert.ok(bouton("Retour à la liste"));
});

test("administrateur : corbeille en attente ou bloquée avec motif, relance et reprise", async () => {
  const appels = await monter("/documents", "admin", {
    "GET /api/documents": { documents: [DOC_PUBLIC] },
    "GET /api/corbeille/en-attente": { operations: OPERATIONS },
    "POST /api/corbeille/operations/9/relancer": { ok: true, operationId: 9, statut: "en_attente" },
    "POST /api/corbeille/reprise": { ok: true, reprises: [{ operationId: 10, statut: "confirmee" }] },
  });
  await attendre(() => texte().includes("Fichier introuvable sur Drive"));
  assert.ok(texte().includes("Bloquée : décision requise"));
  assert.ok(texte().includes("En attente de reprise"));

  await cliquer(boutonDans(document, "Relancer"));
  await attendre(() => texte().includes("Opération remise en attente"));
  assert.equal(appelsVers(appels, "POST", "/api/corbeille/operations/9/relancer").length, 1);

  await cliquer(bouton("Lancer la reprise"));
  await attendre(() => texte().includes("Reprise terminée : 1 confirmée(s)"));
});

test("abandon : motif obligatoire, puis envoi du motif écrit", async () => {
  const appels = await monter("/documents", "admin", {
    "GET /api/documents": { documents: [DOC_PUBLIC] },
    "GET /api/corbeille/en-attente": { operations: OPERATIONS },
    "POST /api/corbeille/operations/9/abandonner": { ok: true, operationId: 9, statut: "abandonnee" },
  });
  await attendre(() => texte().includes("Fichier introuvable sur Drive"));
  await cliquer(boutonDans(document, "Abandonner…"));
  await attendre(() => dialogue());

  await cliquer(boutonDans(dialogue(), "Abandonner"));
  assert.ok(texte().includes("Un motif est obligatoire."));
  assert.equal(appelsVers(appels, "POST", "/api/corbeille/operations/9/abandonner").length, 0, "rien envoyé sans motif");

  await saisir(dialogue().querySelector("textarea"), "Fichier retrouvé hors Drive");
  await cliquer(boutonDans(dialogue(), "Abandonner"));
  await attendre(() => texte().includes("Opération abandonnée"));
  const envoi = appelsVers(appels, "POST", "/api/corbeille/operations/9/abandonner");
  assert.deepEqual(envoi[0].corps, { motif: "Fichier retrouvé hors Drive" });
});

test("relance refusée (409) : le message du serveur est traduit, aucune fausse réussite", async () => {
  await monter("/documents", "admin", {
    "GET /api/documents": { documents: [] },
    "GET /api/corbeille/en-attente": { operations: OPERATIONS },
    "POST /api/corbeille/operations/9/relancer": [409, { error: "Seule une opération bloquée peut être relancée.", code: "operation_non_bloquee" }],
  });
  await attendre(() => texte().includes("Fichier introuvable sur Drive"));
  await cliquer(boutonDans(document, "Relancer"));
  await attendre(() => texte().includes("Cette opération n'est pas bloquée"));
  assert.equal(texte().includes("remise en attente"), false);
});

test("administrateur : ajout d'un rattachement de formation, sans doublon proposé", async () => {
  const appels = await monter("/documents/5", "admin", {
    "GET /api/documents/5": FICHE_ADMIN,
    "GET /api/formations": { formations: [{ id: 1, intitule: "Formation test" }, { id: 2, intitule: "Formation Aide" }] },
    "POST /api/documents/5/formations": [201, { ok: true }],
  });
  await attendre(() => document.querySelector("#formations-titre"));
  const select = [...document.querySelectorAll("select")].find((s) => s.closest(".docs-ajout") && s.parentElement.textContent.includes("formation"));
  assert.ok(select, "sélecteur de formation présent");
  const options = [...select.options].map((o) => o.textContent);
  assert.equal(options.includes("Formation test"), false, "formation déjà rattachée non proposée");
  await saisir(select, "2");
  await cliquer(boutonDans(select.closest(".docs-ajout"), "Rattacher"));
  await attendre(() => texte().includes("Document rattaché à la formation"));
  assert.deepEqual(appelsVers(appels, "POST", "/api/documents/5/formations")[0].corps, { formation_id: 2 });
});
