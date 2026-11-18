// Garde-fou « mode test Drive » — voir l'audit préalable :
//   - dossier() SANS parentId perd tout filtre de parent et peut retrouver
//     le vrai dossier de production « A2C Qualiopi » par son nom, avec le
//     même compte Google qu'en production ;
//   - un DRIVE_RACINE_ID simplement absent ne suffisait pas à couvrir un
//     identifiant ERRONÉ (qui pointerait, par erreur, vers le dossier de
//     production lui-même, ou vers un dossier nested dans sa hiérarchie).
//
// resoudreRacineDrive() est désormais le point d'entrée UNIQUE partagé par
// les quatre générateurs (dossierCible() pour Convocation/Attestation/
// Livret, et ficheEntretienDocument.js pour DOC-9E) :
//   - en mode test, VIGIE_DRIVE_TEST_ROOT_ID est OBLIGATOIRE — jamais de
//     repli vers DRIVE_RACINE_ID ;
//   - le dossier qu'il désigne est VALIDÉ par une seule lecture (jamais
//     une écriture) avant toute création/modification : dossier existant,
//     type dossier, non supprimé, nom explicite de test, posé à la racine
//     de Drive (aucun parent) — donc jamais À L'INTÉRIEUR d'une
//     arborescence de production ;
//   - toute non-conformité bloque AVANT le moindre appel d'écriture.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { dossier, dossierCible, resoudreRacineDrive, genererDocuments, verifierEnvironnementGeneration } from "../src/services/documents.js";
import { setPoolFactory } from "../src/db.js";

const JETON = { connu: true, aAccessToken: true, expiry: null, expire: false, secondesRestantes: null, scopes: [] };

const DRIVE_JAMAIS_APPELE = {
  files: {
    get: () => { throw new Error("drive.files.get ne doit jamais être appelé"); },
    list: () => { throw new Error("drive.files.list ne doit jamais être appelé"); },
    create: () => { throw new Error("drive.files.create ne doit jamais être appelé"); },
  },
};

// Drive simulé : `get` renvoie les métadonnées fournies pour l'ID demandé ;
// `list`/`create` tracent leurs appels (comportement normal, une fois la
// validation passée) sans jamais être atteints si la validation échoue.
function driveSimule(metaParId = {}, { dossierNonVide = false, contenuVigie = false } = {}) {
  const journal = [];
  return {
    journal,
    drive: {
      files: {
        get: async ({ fileId }) => {
          journal.push({ appel: "get", fileId });
          const meta = metaParId[fileId];
          if (!meta) throw Object.assign(new Error("File not found"), { response: { status: 404 } });
          return { data: meta };
        },
        list: async (params = {}) => {
          journal.push({ appel: "list" });
          // Contrôle du contenu du dossier de test : liste de ses enfants (sans filtre de nom).
          if (params.q && !params.q.includes("name =")) {
            return {
              data: {
                files: dossierNonVide
                  ? [{ id: "fichier-existant", name: "fichier existant" }]
                  : contenuVigie ? [{ id: "racine-vigie", name: "A2C Qualiopi" }] : [],
              },
            };
          }
          return { data: { files: [{ id: "dossier-trouve", name: "x" }] } };
        },
        create: async () => { journal.push({ appel: "create" }); return { data: { id: "dossier-cree" } }; },
      },
    },
  };
}

const GOOGLE_ORIGINAL = { ...config.google };
const ISPROD_ORIGINAL = config.isProd;
const RAILWAY_ORIGINAL = config.surRailway;
const RACINE_ORIGINALE = config.driveRacine;

afterEach(() => {
  config.driveModeTest = false;
  config.driveRacineId = "";
  config.driveTestRootId = "";
  config.google = { ...GOOGLE_ORIGINAL };
  config.isProd = ISPROD_ORIGINAL;
  config.surRailway = RAILWAY_ORIGINAL;
  config.driveRacine = RACINE_ORIGINALE;
});

// ── 1. Configuration absente ─────────────────────────────────

test("configuration absente : VIGIE_DRIVE_TEST_ROOT_ID vide bloque avant tout appel Google, DRIVE_RACINE_ID n'est jamais utilisé comme repli", async () => {
  config.driveModeTest = true;
  config.driveTestRootId = "";
  config.driveRacineId = "id-production-reel"; // présent mais ne doit JAMAIS être utilisé ici
  await assert.rejects(
    resoudreRacineDrive(DRIVE_JAMAIS_APPELE, JETON),
    /VIGIE_DRIVE_TEST_ROOT_ID est obligatoire/,
  );
});

// ── 2. Dossier invalide (pas un dossier / supprimé / nom non explicite) ──

test("dossier invalide : type Document (pas un dossier) → bloqué après lecture, avant toute écriture", async () => {
  config.driveModeTest = true;
  config.driveTestRootId = "id-test";
  const { drive, journal } = driveSimule({ "id-test": { id: "id-test", name: "Test fichier", mimeType: "application/vnd.google-apps.document", trashed: false, parents: [] } });
  await assert.rejects(resoudreRacineDrive(drive, JETON), /ne pointe pas vers un dossier/);
  assert.deepEqual(journal.map((j) => j.appel), ["get"], "une seule lecture, aucune écriture");
});

test("dossier invalide : à la corbeille → bloqué", async () => {
  config.driveModeTest = true;
  config.driveTestRootId = "id-test";
  const { drive, journal } = driveSimule({ "id-test": { id: "id-test", name: "Dossier test", mimeType: "application/vnd.google-apps.folder", trashed: true, parents: [] } });
  await assert.rejects(resoudreRacineDrive(drive, JETON), /corbeille/);
  assert.deepEqual(journal.map((j) => j.appel), ["get"]);
});

test("dossier invalide : nom sans mention explicite de test → bloqué", async () => {
  config.driveModeTest = true;
  config.driveTestRootId = "id-test";
  const { drive, journal } = driveSimule({ "id-test": { id: "id-test", name: "Dossier quelconque", mimeType: "application/vnd.google-apps.folder", trashed: false, parents: [] } });
  await assert.rejects(resoudreRacineDrive(drive, JETON), /nom explicite de test/);
  assert.deepEqual(journal.map((j) => j.appel), ["get"]);
});

test("identifiant introuvable ou inaccessible (ex. erreur de configuration) → bloqué, message exploitable", async () => {
  config.driveModeTest = true;
  config.driveTestRootId = "id-inexistant";
  const { drive, journal } = driveSimule({}); // aucune entrée : drive.files.get échoue (404)
  await assert.rejects(resoudreRacineDrive(drive, JETON), /introuvable ou inaccessible/);
  assert.deepEqual(journal.map((j) => j.appel), ["get"]);
});

test("Latest ne satisfait pas le mot entier « test »", async () => {
  config.driveModeTest = true;
  config.driveTestRootId = "id-latest";
  const { drive, journal } = driveSimule({
    "id-latest": {
      id: "id-latest",
      name: "Latest",
      mimeType: "application/vnd.google-apps.folder",
      trashed: false,
      parents: [],
    },
  });

  await assert.rejects(resoudreRacineDrive(drive, JETON), /nom explicite de test/);
  assert.deepEqual(journal.map((j) => j.appel), ["get"]);
});

// ── 3. « Dossier de production » (nested / confondu avec la production) ──

test("dossier nommé « test » mais NESTÉ dans une arborescence (parents non vide) → bloqué, jamais confondu avec la production", async () => {
  config.driveModeTest = true;
  config.driveTestRootId = "id-test-nested";
  const { drive, journal } = driveSimule({
    "id-test-nested": { id: "id-test-nested", name: "Sous-dossier test", mimeType: "application/vnd.google-apps.folder", trashed: false, parents: ["id-dossier-parent-quelconque"] },
    "root": { id: "id-racine-drive", name: "Mon Drive", mimeType: "application/vnd.google-apps.folder", trashed: false, parents: [] },
  });
  await assert.rejects(resoudreRacineDrive(drive, JETON), /racine de Drive/);
  assert.deepEqual(journal.map((j) => j.appel), ["get", "get"]);
});

test("VIGIE_DRIVE_TEST_ROOT_ID pointant par erreur vers le dossier de production réel (nom sans « test ») → bloqué par le nom, jamais utilisé", async () => {
  config.driveModeTest = true;
  config.driveTestRootId = "id-production-par-erreur";
  const { drive, journal } = driveSimule({
    "id-production-par-erreur": { id: "id-production-par-erreur", name: "A2C Qualiopi", mimeType: "application/vnd.google-apps.folder", trashed: false, parents: [] },
  });
  await assert.rejects(resoudreRacineDrive(drive, JETON), /nom explicite de test/);
  assert.deepEqual(journal.map((j) => j.appel), ["get"], "aucune écriture dans le dossier de production, même par erreur de configuration");
});

test("dossier de test non vide : blocage avant toute écriture", async () => {
  config.driveModeTest = true;
  config.driveTestRootId = "id-test-non-vide";

  const { drive, journal } = driveSimule({
    "id-test-non-vide": {
      id: "id-test-non-vide",
      name: "TEST — Vigie",
      mimeType: "application/vnd.google-apps.folder",
      trashed: false,
      parents: ["id-racine-drive"],
    },
    "root": {
      id: "id-racine-drive",
      name: "Mon Drive",
      mimeType: "application/vnd.google-apps.folder",
      trashed: false,
      parents: [],
    },
  }, { dossierNonVide: true });

  await assert.rejects(resoudreRacineDrive(drive, JETON), /ne doit contenir que l'arborescence créée par Vigie/);
  assert.deepEqual(journal.map((j) => j.appel), ["get", "get", "list"]);
});

test("dossier de test contenant seulement l'arborescence créée par Vigie lors d'un essai précédent : accepté (essais successifs)", async () => {
  config.driveModeTest = true;
  config.driveTestRootId = "id-test-reutilise";
  config.driveRacine = "A2C Qualiopi";
  const { drive } = driveSimule({
    "id-test-reutilise": { id: "id-test-reutilise", name: "TEST Vigie", mimeType: "application/vnd.google-apps.folder", trashed: false, parents: ["id-racine-drive"] },
    "root": { id: "id-racine-drive", name: "Mon Drive", mimeType: "application/vnd.google-apps.folder", trashed: false, parents: [] },
  }, { contenuVigie: true });
  assert.equal(await resoudreRacineDrive(drive, JETON), "dossier-trouve");
});

// ── 4. Dossier de test valide ────────────────────────────────

test("dossier de test valide (dossier, non supprimé, nom explicite, racine) : aucun blocage, Google appelé normalement", async () => {
  config.driveModeTest = true;
  config.driveTestRootId = "id-test-ok";
  const { drive, journal } = driveSimule({
    "id-test-ok": { id: "id-test-ok", name: "TEST — Vigie — à supprimer", mimeType: "application/vnd.google-apps.folder", trashed: false, parents: ["id-racine-drive"] },
    "root": { id: "id-racine-drive", name: "Mon Drive", mimeType: "application/vnd.google-apps.folder", trashed: false, parents: [] },
  });
  const id = await resoudreRacineDrive(drive, JETON);
  assert.equal(id, "dossier-trouve");
  assert.deepEqual(journal.map((j) => j.appel), ["get", "get", "list", "list"], "validation en lecture seule puis résolution du dossier de test");
});

test("via dossierCible() (chemin réellement utilisé par les générateurs) : un dossier de test valide fonctionne de bout en bout", async () => {
  config.driveModeTest = true;
  config.driveTestRootId = "id-test-ok";
  const { drive } = driveSimule({
    "id-test-ok": { id: "id-test-ok", name: "TEST — Vigie", mimeType: "application/vnd.google-apps.folder", trashed: false, parents: ["id-racine-drive"] },
    "root": { id: "id-racine-drive", name: "Mon Drive", mimeType: "application/vnd.google-apps.folder", trashed: false, parents: [] },
  });
  const ctx = {
    formation: { intitule: "Formation test" },
    session: { date_debut: "2026-01-05", date_fin: "2026-03-05", reference: "SESS-TEST" },
    groupe: null,
  };
  const id = await dossierCible(drive, ctx, JETON);
  assert.equal(id, "dossier-trouve", "la résolution descend bien jusqu'au dossier de session, sans erreur");
});

// ── 5. Mode test désactivé (comportement de production, non-régression) ──

test("mode test désactivé (défaut production) : VIGIE_DRIVE_TEST_ROOT_ID n'est jamais consulté, comportement actuel inchangé", async () => {
  config.driveModeTest = false;
  config.driveTestRootId = "";
  config.driveRacineId = "";
  const { drive, journal } = driveSimule();
  const id = await resoudreRacineDrive(drive, JETON);
  assert.equal(id, "dossier-trouve");
  assert.deepEqual(journal.map((j) => j.appel), ["list"], "aucune validation de dossier de test en mode production : comportement inchangé");
});

// ── Garde-fou générique dossier() conservé comme filet de sécurité ──

test("dossier() appelé directement sans parentId en mode test reste bloqué (filet de sécurité, indépendant de resoudreRacineDrive)", async () => {
  config.driveModeTest = true;
  await assert.rejects(
    dossier(DRIVE_JAMAIS_APPELE, "A2C Qualiopi", null, JETON),
    /dossier racine de test validé est obligatoire/,
  );
});

test("un sous-dossier (parentId déjà résolu) n'est jamais bloqué par ce filet, même en mode test", async () => {
  config.driveModeTest = true;
  const { drive, journal } = driveSimule();
  const id = await dossier(drive, "Formation test", "parent-deja-resolu", JETON);
  assert.equal(id, "dossier-trouve");
  assert.deepEqual(journal.map((j) => j.appel), ["list"]);
});

// ── Dernier garde-fou : environnement non productif + Google réellement
// configuré + mode test inactif ─────────────────────────────────────

const GOOGLE_CONFIGURE = { clientId: "id-factice", clientSecret: "secret-factice", redirectUri: "https://localhost/cb" };
const POOL_JAMAIS_INTERROGE = { query: () => { throw new Error("aucune requête DB ne doit être exécutée"); }, connect: () => { throw new Error("aucune connexion DB ne doit être ouverte"); } };

test("environnement local + Google configuré + mode test inactif : génération bloquée", () => {
  config.isProd = false;
  config.driveModeTest = false;
  config.google = { ...GOOGLE_CONFIGURE };
  config.surRailway = false;
  assert.throws(verifierEnvironnementGeneration, /environnement local/);
});

test("environnement local + Google configuré + mode test actif : non bloqué par ce garde-fou (le dossier reste validé séparément)", () => {
  config.isProd = false;
  config.driveModeTest = true;
  config.google = { ...GOOGLE_CONFIGURE };
  assert.doesNotThrow(verifierEnvironnementGeneration);
});

test("environnement local SANS Google réellement configuré (cas de la suite de tests) : jamais bloqué, aucune régression", () => {
  config.isProd = false;
  config.driveModeTest = false;
  config.google = { clientId: "", clientSecret: "", redirectUri: "" };
  assert.doesNotThrow(verifierEnvironnementGeneration);
});

test("exécution sur Railway sans NODE_ENV : jamais bloquée (le garde-fou ne vise que les postes locaux)", () => {
  config.isProd = false;
  config.surRailway = true;
  config.driveModeTest = false;
  config.google = { ...GOOGLE_CONFIGURE };
  assert.doesNotThrow(verifierEnvironnementGeneration);
});

test("environnement de PRODUCTION : jamais bloqué, quel que soit le mode test ou la configuration Google", () => {
  config.isProd = true;
  config.driveModeTest = false;
  config.google = { ...GOOGLE_CONFIGURE };
  assert.doesNotThrow(verifierEnvironnementGeneration);
  config.driveModeTest = true;
  assert.doesNotThrow(verifierEnvironnementGeneration);
});

// Intégration : genererDocuments() lui-même bloque avant tout appel DB ou
// Google — pas seulement le garde isolé.
test("genererDocuments() : bloqué dès le premier appel, avant toute requête DB et tout client Google", async () => {
  config.isProd = false;
  config.surRailway = false;
  config.driveModeTest = false;
  config.google = { ...GOOGLE_CONFIGURE };
  setPoolFactory(() => POOL_JAMAIS_INTERROGE);
  try {
    await assert.rejects(
      genererDocuments({ modeleId: 1, sessionId: 1, client: DRIVE_JAMAIS_APPELE }),
      /environnement local/,
    );
  } finally {
    setPoolFactory(null);
  }
});
