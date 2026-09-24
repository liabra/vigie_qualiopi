// UX-5 : connexion et pages Paramètres (formations, prescripteurs, modèles,
// versions, Google Drive). API simulée ; aucune boîte native tolérée.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, champ, cliquer, demonter, dialogue, monter, saisir, texte, touche } from "./outils.jsx";

// Toute boîte native fait échouer le test.
beforeEach(() => {
  window.alert = () => { throw new Error("window.alert interdit"); };
  window.confirm = () => { throw new Error("window.confirm interdit"); };
});
afterEach(demonter);

const soumettre = async (id) => cliquer(document.querySelector(`button[type="submit"][form="${id}"]`));

// ── Connexion ────────────────────────────────────────────────

test("connexion : écran sobre, bouton Google, accès réservé, aucun détail technique", async () => {
  await monter("/accueil", null);
  await attendre(() => texte().includes("Se connecter avec Google"));
  assert.equal(document.querySelector("h1").textContent, "Vigie Qualiopi");
  assert.ok(texte().includes("Suivez vos sessions, vos preuves et votre démarche qualité."));
  assert.ok(texte().includes("Accès réservé aux utilisateurs autorisés."));
  assert.equal(bouton("Se connecter avec Google").getAttribute("href"), "/auth/google/login");
  assert.equal(document.title, "Connexion — Vigie Qualiopi");
  assert.ok(!/oauth|serveur|token/i.test(texte()));
});

test("connexion : Google non configuré ⇒ message simple, pas de bouton", async () => {
  await monter("/accueil", null, { "GET /api/me": { user: null, googleConfigured: false } });
  await attendre(() => texte().includes("La connexion n'est pas encore disponible."));
  assert.ok(!bouton("Se connecter avec Google"));
  assert.ok(!/oauth/i.test(texte()));
});

test("connexion : compte non autorisé ⇒ message clair, paramètre retiré de l'URL", async () => {
  await monter("/?erreur=non_autorise", null);
  await attendre(() => texte().includes("La connexion n'a pas abouti."));
  assert.ok(texte().includes("Ce compte Google n'est pas autorisé à accéder à Vigie Qualiopi."));
  assert.equal(window.location.search, "");
});

test("connexion : code d'erreur inconnu ⇒ message générique, jamais le code brut", async () => {
  await monter("/?erreur=%3Cscript%3Ealert(1)%3C%2Fscript%3E", null);
  await attendre(() => texte().includes("La connexion n'a pas abouti."));
  assert.ok(texte().includes("Erreur de connexion."));
  assert.ok(!texte().includes("script"));
  assert.equal(document.querySelector("script"), null);
});

test("connexion : serveur injoignable ⇒ message sans détail technique, bouton Réessayer", async () => {
  await monter("/accueil", null, { "GET /api/me": [500, { error: "ECONNREFUSED 10.0.0.3:5432 secret" }] });
  await attendre(() => texte().includes("Vigie est momentanément injoignable."));
  assert.ok(!texte().includes("ECONNREFUSED") && !texte().includes("secret"));
  assert.ok(bouton("Réessayer"));
});

test("connexion : un chemin de retour externe mémorisé est ignoré (retour à l'accueil)", async () => {
  window.sessionStorage.setItem("vq_retour_apres_connexion", "//site-externe.example/piege");
  await monter("/", "admin");
  await attendre(() => window.location.pathname === "/accueil");
  assert.equal(window.location.host, "localhost");
});

// ── Droits ───────────────────────────────────────────────────

test("contributeur : les 5 pages Paramètres affichent « Accès réservé » sans appeler leur API", async () => {
  for (const [chemin, api] of [["/formations", "GET /api/formations"], ["/modeles", "GET /api/modeles"],
    ["/prescripteurs", "GET /api/prescripteurs"], ["/versions", "GET /api/referentiel/versions"], ["/parametres/google", "GET /api/drive/status"]]) {
    const appels = await monter(chemin, "contributeur");
    await attendre(() => texte().includes("Cette page est réservée aux administrateurs."));
    assert.ok(!appels.some((a) => `${a.methode} ${a.chemin}` === api), `${chemin} n'appelle pas ${api}`);
    await demonter();
  }
});

// ── Formations ───────────────────────────────────────────────

const FORMATION = {
  id: 7, intitule: "Aide à domicile", code_interne: "AAD", actif: true, version_numero: 2, nb_versions: 2, nb_sessions: 3,
  duree_heures_defaut: "35.00", modalite: "presentiel", tarif_ht: "1200.00", objectifs: "Objectifs existants",
};

test("formations : liste lisible (version, durée, modalité, tarif, sessions)", async () => {
  await monter("/formations", "admin", { "GET /api/formations": { formations: [FORMATION] } });
  await attendre(() => texte().includes("Aide à domicile"));
  assert.equal(document.querySelector("h1").textContent, "Formations");
  for (const t of ["Code AAD", "Version 2", "2 versions au total", "35 h", "Présentiel", "HT"]) assert.ok(texte().includes(t), t);
  assert.ok(!document.querySelector("form"), "aucun formulaire permanent");
});

test("formations : aucune formation ⇒ état vide avec action de création", async () => {
  await monter("/formations", "admin", { "GET /api/formations": { formations: [] } });
  await attendre(() => texte().includes("Aucune formation"));
  assert.ok(bouton("+ Nouvelle formation"));
});

test("formations : création dans un panneau, intitulé obligatoire, corps envoyé", async () => {
  const appels = await monter("/formations", "admin", {
    "GET /api/formations": { formations: [FORMATION] },
    "POST /api/formations": [201, { formation: { id: 8 } }],
  });
  await attendre(() => texte().includes("Aide à domicile"));
  await cliquer(bouton("+ Nouvelle formation"));
  await attendre(() => dialogue()?.textContent.includes("Nouvelle formation"));
  await soumettre("form-formation");
  await attendre(() => texte().includes("Indiquez l'intitulé de la formation."));
  assert.equal(champ("Intitulé").getAttribute("aria-invalid"), "true");
  await saisir(champ("Intitulé"), "Assistant de vie");
  await saisir(champ("Durée par défaut (heures)"), "21");
  await soumettre("form-formation");
  await attendre(() => appels.some((a) => a.methode === "POST" && a.chemin === "/api/formations"));
  const corps = appels.find((a) => a.methode === "POST").corps;
  assert.equal(corps.intitule, "Assistant de vie");
  assert.equal(corps.duree_heures_defaut, "21");
  await attendre(() => texte().includes("Formation « Assistant de vie » créée."));
  assert.equal(dialogue(), null);
});

test("formations : réviser crée une nouvelle version sans perdre les champs non affichés", async () => {
  const appels = await monter("/formations", "admin", {
    "GET /api/formations": { formations: [FORMATION] },
    "PUT /api/formations/7": { ok: true },
  });
  await attendre(() => texte().includes("Aide à domicile"));
  await cliquer(bouton("Réviser"));
  await attendre(() => dialogue()?.textContent.includes("Enregistrer créera la version 3."));
  await saisir(champ("Durée par défaut (heures)"), "42");
  await soumettre("form-formation");
  await attendre(() => appels.some((a) => a.methode === "PUT"));
  const corps = appels.find((a) => a.methode === "PUT").corps;
  assert.equal(corps.duree_heures_defaut, "42");
  assert.equal(corps.objectifs, "Objectifs existants");
  assert.equal(corps.intitule, "Aide à domicile");
});

// ── Prescripteurs ────────────────────────────────────────────

const PRESCRIPTEURS = [
  { id: 1, code: "france_travail", nom: "France Travail", actif: true },
  { id: 2, code: "agefiph", nom: "Agefiph", actif: false },
];

test("prescripteurs : nom, code, statut actif / inactif identifiable", async () => {
  await monter("/prescripteurs", "admin", { "GET /api/prescripteurs": { prescripteurs: PRESCRIPTEURS } });
  await attendre(() => texte().includes("France Travail"));
  assert.ok(texte().includes("france_travail") && texte().includes("agefiph"));
  const lignes = [...document.querySelectorAll("tbody tr")];
  assert.ok(lignes[0].textContent.includes("Actif"));
  assert.ok(lignes[1].textContent.includes("Inactif"));
  assert.ok(lignes[1].className.includes("estompee"));
  assert.ok(texte().includes("1 actif(s) sur 2"));
});

test("prescripteurs : création et renommage dans un panneau", async () => {
  const appels = await monter("/prescripteurs", "admin", {
    "GET /api/prescripteurs": { prescripteurs: PRESCRIPTEURS },
    "POST /api/prescripteurs": [201, { prescripteur: { id: 3 } }],
    "PATCH /api/prescripteurs/1": { prescripteur: {} },
  });
  await attendre(() => texte().includes("France Travail"));
  await cliquer(bouton("+ Nouveau prescripteur"));
  await attendre(() => dialogue());
  await soumettre("form-prescripteur");
  await attendre(() => texte().includes("Indiquez un nom."));
  await saisir(champ("Nom"), "OPCO Santé");
  await soumettre("form-prescripteur");
  await attendre(() => appels.some((a) => a.methode === "POST"));
  assert.deepEqual(appels.find((a) => a.methode === "POST").corps, { nom: "OPCO Santé" });
  await attendre(() => !dialogue());

  await cliquer(document.querySelector('button[aria-label="Renommer France Travail"]'));
  await attendre(() => dialogue()?.textContent.includes("france_travail"));
  assert.equal(champ("Nom").value, "France Travail");
  await saisir(champ("Nom"), "France Travail (ex-Pôle emploi)");
  await soumettre("form-prescripteur");
  await attendre(() => appels.some((a) => a.methode === "PATCH"));
  assert.deepEqual(appels.find((a) => a.methode === "PATCH").corps, { nom: "France Travail (ex-Pôle emploi)" });
});

test("prescripteurs : désactiver passe par une confirmation ; réactiver est direct", async () => {
  const appels = await monter("/prescripteurs", "admin", {
    "GET /api/prescripteurs": { prescripteurs: PRESCRIPTEURS },
    "DELETE /api/prescripteurs/1": { ok: true },
    "PATCH /api/prescripteurs/2": { prescripteur: {} },
  });
  await attendre(() => texte().includes("France Travail"));
  await cliquer(bouton("Désactiver"));
  await attendre(() => dialogue()?.getAttribute("role") === "alertdialog");
  assert.equal(document.activeElement.textContent, "Annuler", "focus sur Annuler");
  await touche("Escape");
  await attendre(() => !dialogue());
  assert.ok(!appels.some((a) => a.methode === "DELETE"), "Échap n'a rien supprimé");
  await cliquer(bouton("Désactiver"));
  await attendre(() => dialogue());
  await cliquer([...dialogue().querySelectorAll("button")].find((b) => b.textContent === "Désactiver"));
  await attendre(() => appels.some((a) => a.methode === "DELETE" && a.chemin === "/api/prescripteurs/1"));
  await attendre(() => texte().includes("« France Travail » est désactivé."));
  await cliquer(bouton("Réactiver"));
  await attendre(() => appels.some((a) => a.methode === "PATCH" && a.chemin === "/api/prescripteurs/2"));
  assert.deepEqual(appels.find((a) => a.methode === "PATCH").corps, { actif: true });
});

// ── Modèles ──────────────────────────────────────────────────

const REFERENTIEL = {
  version: { id: 1, code: "V9" }, totalIndicateurs: 2,
  score: { maitrise: 0, a_consolider: 0, a_risque: 0, non_applicable: 0, total: 2, preuves: 0, a_confirmer: 0 },
  criteres: [{ id: 3, numero: 3, libelle: "Adaptation aux publics", indicateurs: [
    { id: 109, numero: 9, libelle: "Information des publics sur les conditions de déroulement" },
    { id: 111, numero: 11, libelle: "Évaluation de l'atteinte des objectifs" },
  ] }],
};
const MODELE = {
  id: 3, nom: "Attestation de fin", portee: "stagiaire", description: "Remise en fin de formation",
  drive_url: "https://drive.google.com/open?id=abcdefghijk", drive_mime: "application/vnd.google-apps.document",
  indicateurs: [{ id: 111, numero: 11 }],
};

test("modèles : liste compacte (usage, indicateurs, fichier Google)", async () => {
  await monter("/modeles", "admin", {
    "GET /api/modeles": { modeles: [MODELE], marqueurs: ["nom_stagiaire"] },
    "GET /api/referentiel": REFERENTIEL,
  });
  await attendre(() => texte().includes("Attestation de fin"));
  assert.equal(document.querySelector("h1").textContent, "Modèles de documents");
  for (const t of ["Par stagiaire", "Ind. 11", "Ouvrir sur le Drive", "Google Docs"]) assert.ok(texte().includes(t), t);
  const lien = [...document.querySelectorAll("a")].find((a) => a.textContent === "Ouvrir sur le Drive");
  assert.equal(lien.getAttribute("rel"), "noopener noreferrer");
  assert.ok(!texte().includes("{{nom_stagiaire}}"), "marqueurs hors de la liste");
  await cliquer(bouton("Marqueurs reconnus"));
  await attendre(() => dialogue()?.textContent.includes("{{nom_stagiaire}}"));
});

test("modèles : lien Drive non http(s) jamais rendu cliquable", async () => {
  await monter("/modeles", "admin", {
    "GET /api/modeles": { modeles: [{ ...MODELE, drive_url: "javascript:alert(1)" }], marqueurs: [] },
  });
  await attendre(() => texte().includes("Attestation de fin"));
  assert.ok(![...document.querySelectorAll("a")].some((a) => (a.getAttribute("href") || "").startsWith("javascript")));
});

test("modèles : détail dans un panneau avec les libellés d'indicateurs", async () => {
  await monter("/modeles", "admin", {
    "GET /api/modeles": { modeles: [MODELE], marqueurs: [] },
    "GET /api/referentiel": REFERENTIEL,
  });
  await attendre(() => texte().includes("Attestation de fin"));
  await cliquer(bouton("Détail"));
  await attendre(() => dialogue()?.textContent.includes("Évaluation de l'atteinte des objectifs"));
  assert.ok(dialogue().textContent.includes("Un document par stagiaire"));
});

test("modèles : création avec le sélecteur d'indicateurs (numéros envoyés)", async () => {
  const appels = await monter("/modeles", "admin", {
    "GET /api/modeles": { modeles: [MODELE], marqueurs: [] },
    "GET /api/referentiel": REFERENTIEL,
    "POST /api/modeles": [201, { modele: { id: 4 } }],
  });
  await attendre(() => texte().includes("Attestation de fin"));
  await cliquer(bouton("+ Nouveau modèle"));
  await attendre(() => dialogue()?.textContent.includes("Critère 3"));
  await soumettre("form-modele");
  await attendre(() => texte().includes("Sélectionnez au moins un indicateur."));
  assert.ok(texte().includes("Donnez un nom au modèle."));
  await saisir(champ("Nom"), "Convocation");
  await saisir(champ("Usage"), "session");
  await saisir(champ("Lien ou identifiant du fichier Drive"), "https://docs.google.com/document/d/abcdefghijk/edit");
  await cliquer(dialogue().querySelector(".indic-groupe__tete"));
  await cliquer([...dialogue().querySelectorAll("label")].find((l) => l.textContent.includes("Indicateur 9")).querySelector("input"));
  await soumettre("form-modele");
  await attendre(() => appels.some((a) => a.methode === "POST"));
  const corps = appels.find((a) => a.methode === "POST").corps;
  assert.deepEqual(corps.indicateurs, [9]);
  assert.equal(corps.portee, "session");
  await attendre(() => texte().includes("Modèle « Convocation » enregistré."));
});

test("modèles : retirer passe par une confirmation", async () => {
  const appels = await monter("/modeles", "admin", {
    "GET /api/modeles": { modeles: [MODELE], marqueurs: [] },
    "DELETE /api/modeles/3": { ok: true },
  });
  await attendre(() => texte().includes("Attestation de fin"));
  await cliquer(bouton("Retirer"));
  await attendre(() => dialogue()?.textContent.includes("Les documents déjà générés ne sont pas touchés"));
  await cliquer([...dialogue().querySelectorAll("button")].find((b) => b.textContent === "Retirer"));
  await attendre(() => appels.some((a) => a.methode === "DELETE" && a.chemin === "/api/modeles/3"));
});

// ── Versions ─────────────────────────────────────────────────

const VERSIONS = { versions: [
  { id: 1, code: "V9", libelle: "Référentiel national qualité V9", type: "active", est_active: true, date_application: "2022-01-01", source: "Guide de lecture" },
  { id: 2, code: "V10", libelle: "Référentiel V10", type: "future", est_active: false, date_application: "2026-11-01" },
  { id: 3, code: "V11", libelle: "Coquille", type: "future", est_active: false },
] };
const contenu = (n) => ({ version: {}, criteres: n ? [{ id: 1, indicateurs: Array.from({ length: n }, (_, i) => ({ id: i })) }] : [] });

test("versions : active / future lisibles, une coquille n'est pas activable", async () => {
  await monter("/versions", "admin", {
    "GET /api/referentiel/versions": VERSIONS,
    "GET /api/referentiel/versions/1": contenu(32), "GET /api/referentiel/versions/2": contenu(31), "GET /api/referentiel/versions/3": contenu(0),
  });
  await attendre(() => texte().includes("1 critère(s) · 31 indicateur(s)") && texte().includes("Contenu non importé"));
  const cartes = [...document.querySelectorAll("article")];
  assert.ok(cartes[0].textContent.includes("V9") && cartes[0].textContent.includes("Active"));
  assert.ok(cartes[1].textContent.includes("V10") && cartes[1].textContent.includes("Future") && cartes[1].textContent.includes("01/11/2026"));
  assert.ok(cartes[1].querySelector('button[aria-label="Activer la version V10"]'));
  assert.ok(!cartes[2].querySelector("button"), "coquille : aucun bouton d'activation");
  assert.ok(cartes[2].textContent.includes("Activation impossible tant que le contenu n'est pas importé."));
  assert.ok(!cartes[0].querySelector("button"), "la version active n'a pas d'action");
});

test("versions : activer exige une confirmation explicite, avertissement relayé", async () => {
  const appels = await monter("/versions", "admin", {
    "GET /api/referentiel/versions": VERSIONS,
    "GET /api/referentiel/versions/1": contenu(32), "GET /api/referentiel/versions/2": contenu(31), "GET /api/referentiel/versions/3": contenu(0),
    "POST /api/referentiel/versions/2/activer": { ok: true, avertissement: "Cette version a une date d'application future." },
  });
  await attendre(() => document.querySelector('button[aria-label="Activer la version V10"]'));
  await cliquer(document.querySelector('button[aria-label="Activer la version V10"]'));
  await attendre(() => dialogue()?.textContent.includes("remplacera V9"));
  assert.ok(!appels.some((a) => a.methode === "POST"), "rien avant confirmation");
  await cliquer(bouton("Activer cette version"));
  await attendre(() => appels.some((a) => a.methode === "POST" && a.chemin === "/api/referentiel/versions/2/activer"));
  await attendre(() => texte().includes("Cette version a une date d'application future."));
});

test("versions : préparer une nouvelle version (code et libellé obligatoires)", async () => {
  const appels = await monter("/versions", "admin", {
    "GET /api/referentiel/versions": VERSIONS,
    "POST /api/referentiel/versions": [201, { version: { id: 4 } }],
  });
  await attendre(() => bouton("Préparer une nouvelle version"));
  await cliquer(bouton("Préparer une nouvelle version"));
  await attendre(() => dialogue());
  await soumettre("form-version");
  await attendre(() => texte().includes("Indiquez un code (ex. V10)."));
  await saisir(champ("Code"), "V12");
  await saisir(champ("Libellé"), "Référentiel V12");
  await soumettre("form-version");
  await attendre(() => appels.some((a) => a.methode === "POST"));
  assert.equal(appels.find((a) => a.methode === "POST").corps.code, "V12");
});

// ── Google Drive ─────────────────────────────────────────────

test("Google Drive : connecté ⇒ compte et autorisations en clair, jamais de portée brute", async () => {
  await monter("/parametres/google", "admin", {
    "GET /api/drive/status": {
      configured: true, connected: true, compte: "drive@exemple.fr", verifie: "drive@exemple.fr",
      lectureSeule: true, ecritureAutorisee: true, sheetsAutorise: false, reconnexionRequise: true,
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    },
  });
  await attendre(() => texte().includes("État de la connexion"));
  assert.ok(texte().includes("Vigie utilise Google Drive pour les modèles, les preuves et les documents générés."));
  assert.ok(texte().includes("Connecté") && texte().includes("drive@exemple.fr"));
  assert.ok(texte().includes("Lire le classeur de suivi : non autorisé"));
  assert.ok(texte().includes("Certaines autorisations manquent."));
  assert.ok(!texte().includes("googleapis"), "aucune portée OAuth affichée");
});

test("Google Drive : erreur Google ⇒ message simple, jamais le message brut", async () => {
  await monter("/parametres/google", "admin", {
    "GET /api/drive/status": { configured: true, connected: true, compte: "drive@exemple.fr", erreur: "invalid_grant: Token has been expired or revoked." },
  });
  await attendre(() => texte().includes("Le Drive ne répond pas."));
  assert.ok(!texte().includes("invalid_grant") && !texte().includes("Token"));
  assert.equal(bouton("Reconnecter le Drive").getAttribute("href"), "/auth/google/drive");
});

test("Google Drive : non connecté ⇒ bouton de connexion ; non configuré ⇒ alerte", async () => {
  await monter("/parametres/google", "admin", { "GET /api/drive/status": { configured: true, connected: false, compte: "drive@exemple.fr" } });
  await attendre(() => texte().includes("Non connecté"));
  assert.equal(bouton("Connecter le Drive").getAttribute("href"), "/auth/google/drive");
  await demonter();
  await monter("/parametres/google", "admin", { "GET /api/drive/status": { configured: false, connected: false } });
  await attendre(() => texte().includes("La connexion Google n'est pas disponible."));
  assert.ok(!bouton("Connecter le Drive"));
});

test("Google Drive : déconnexion confirmée par une boîte de dialogue", async () => {
  let connecte = true;
  const appels = await monter("/parametres/google", "admin", {
    "GET /api/drive/status": () => ({ configured: true, connected: connecte, compte: "drive@exemple.fr", verifie: connecte ? "drive@exemple.fr" : undefined, lectureSeule: true }),
    "POST /api/drive/disconnect": () => { connecte = false; return { ok: true }; },
  });
  await attendre(() => bouton("Déconnecter"));
  await cliquer(bouton("Déconnecter"));
  await attendre(() => dialogue()?.textContent.includes("Aucun fichier n'est supprimé du Drive."));
  await cliquer([...dialogue().querySelectorAll("button")].find((b) => b.textContent === "Déconnecter"));
  await attendre(() => appels.some((a) => a.methode === "POST" && a.chemin === "/api/drive/disconnect"));
  await attendre(() => texte().includes("Google Drive déconnecté.") && texte().includes("Non connecté"));
});
