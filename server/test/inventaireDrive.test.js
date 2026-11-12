// ─────────────────────────────────────────────────────────────
//  Inventaire Drive : parcours du périmètre, pagination, profondeur, limite, LECTURE SEULE stricte.
//  Faux client Drive : aucun réseau. Toute méthode d'écriture lève une erreur.
// ─────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { inventorierPerimetre } from "../src/services/inventaireDrive.js";

const DOC = "application/vnd.google-apps.document";
const SHEET = "application/vnd.google-apps.spreadsheet";
const DOSSIER = "application/vnd.google-apps.folder";
const PDF = "application/pdf";

// Arborescence : racine → Modèles (dossier), Modèles → Sous (dossier), et des fichiers à chaque niveau.
function arbre(extra = {}) {
  return {
    RACINE_TEST_000: [
      { id: "DOSSIER_MODELES_A", name: "Modèles", mimeType: DOSSIER },
      { id: "FICHIER_ROOT_DOC01", name: "Charte.docx", mimeType: DOC },
      { id: "FICHIER_ROOT_PDF01", name: "Scan.pdf", mimeType: PDF },
    ],
    DOSSIER_MODELES_A: [
      { id: "FICHIER_MOD_DOC001", name: "Convocation.docx", mimeType: DOC, modifiedTime: "2026-10-02T10:00:00Z", webViewLink: "https://docs.google.com/document/d/FICHIER_MOD_DOC001/edit" },
      { id: "FICHIER_MOD_SHT01", name: "Émargement.xlsx", mimeType: SHEET },
      { id: "DOSSIER_SOUS_BBBB01", name: "Archives", mimeType: DOSSIER },
    ],
    DOSSIER_SOUS_BBBB01: [
      { id: "FICHIER_SOUS_DOC01", name: "Attestation 2024.docx", mimeType: DOC },
    ],
    ...extra,
  };
}

// Client Drive simulé : files.list seulement (lecture). Pagination possible via `pages`.
function clientLecture({ enfants, pages = {} } = {}) {
  const appels = [];
  const ecritures = [];
  const ecriture = (nom) => async () => { ecritures.push(nom); throw new Error("écriture interdite : " + nom); };
  const drive = {
    files: {
      list: async ({ q, pageToken }) => {
        appels.push(q);
        const id = /'([^']+)' in parents/.exec(q)?.[1];
        const tous = enfants[id] || [];
        if (pages[id] && !pageToken) return { data: { files: tous.slice(0, 1), nextPageToken: "P2" } };
        if (pageToken === "P2") return { data: { files: tous.slice(1) } };
        return { data: { files: tous } };
      },
      get: async () => { throw new Error("hors inventaire"); },
      create: ecriture("files.create"),
      update: ecriture("files.update"),
      delete: ecriture("files.delete"),
      copy: ecriture("files.copy"),
      emptyTrash: ecriture("files.emptyTrash"),
    },
    permissions: { create: ecriture("permissions.create"), update: ecriture("permissions.update"), delete: ecriture("permissions.delete") },
  };
  return { drive, appels, ecritures };
}

test("parcours : fichiers Docs et Sheets seulement, chemins d'emplacement, tri stable", async () => {
  const { drive, ecritures } = clientLecture({ enfants: arbre() });
  const r = await inventorierPerimetre({ drive, racineId: "RACINE_TEST_000", nomRacine: "A2C Qualiopi" });
  // Tri par emplacement puis nom : racine, dossier Modèles, sous-dossier Archives.
  assert.deepEqual(r.fichiers.map((f) => f.nom), ["Charte.docx", "Convocation.docx", "Émargement.xlsx", "Attestation 2024.docx"]);
  const attestation = r.fichiers.find((f) => f.nom === "Attestation 2024.docx");
  assert.equal(attestation.emplacement, "A2C Qualiopi / Modèles / Archives");
  assert.equal(attestation.type, "document");
  const emargement = r.fichiers.find((f) => f.nom === "Émargement.xlsx");
  assert.equal(emargement.type, "feuille");
  assert.equal(r.fichiers.some((f) => f.nom === "Scan.pdf"), false, "PDF exclu du périmètre des modèles");
  assert.equal(r.tronque, false);
  assert.deepEqual(ecritures, [], "aucune écriture");
});

test("métadonnées : identifiant, MIME, URL et date de modification restitués", async () => {
  const { drive } = clientLecture({ enfants: arbre() });
  const r = await inventorierPerimetre({ drive, racineId: "RACINE_TEST_000", nomRacine: "A2C Qualiopi" });
  const f = r.fichiers.find((x) => x.id === "FICHIER_MOD_DOC001");
  assert.equal(f.mime, DOC);
  assert.equal(f.modifie_le, "2026-10-02T10:00:00Z");
  assert.equal(f.url, "https://docs.google.com/document/d/FICHIER_MOD_DOC001/edit");
});

test("requête : fichiers non supprimés seulement, pagination suivie jusqu'au bout", async () => {
  const { drive, appels } = clientLecture({ enfants: arbre(), pages: { RACINE_TEST_000: true } });
  const r = await inventorierPerimetre({ drive, racineId: "RACINE_TEST_000", nomRacine: "A2C Qualiopi" });
  assert.ok(appels.every((q) => q.includes("trashed = false")), "corbeille exclue");
  assert.ok(r.fichiers.some((f) => f.nom === "Charte.docx"), "premier lot lu");
  assert.equal(r.fichiers.length, 4, "second lot lu aussi");
});

test("limite : au-delà du nombre maximal, l'inventaire est marqué tronqué", async () => {
  const { drive } = clientLecture({ enfants: arbre() });
  const r = await inventorierPerimetre({ drive, racineId: "RACINE_TEST_000", nomRacine: "A2C Qualiopi", limite: 2 });
  assert.equal(r.fichiers.length, 2);
  assert.equal(r.tronque, true);
});

test("profondeur : les dossiers au-delà de la profondeur bornée sont signalés, jamais lus", async () => {
  const { drive, appels } = clientLecture({ enfants: arbre() });
  const r = await inventorierPerimetre({ drive, racineId: "RACINE_TEST_000", nomRacine: "A2C Qualiopi", profondeur: 1 });
  assert.equal(appels.some((q) => q.includes("DOSSIER_SOUS_BBBB01")), false, "sous-dossier non interrogé");
  assert.equal(r.tronque, true);
  assert.equal(r.dossiers_non_parcourus, 1);
});

test("sécurité : un identifiant de dossier inattendu n'est jamais injecté dans une requête", async () => {
  const enfants = arbre({ "x'; drop": [{ id: "FICHIER_INJ_DOC01", name: "Piège.docx", mimeType: DOC }] });
  const { drive, appels } = clientLecture({ enfants });
  await inventorierPerimetre({ drive, racineId: "RACINE_TEST_000", nomRacine: "A2C Qualiopi" });
  assert.equal(appels.some((q) => q.includes("drop")), false);
});

test("racine invalide refusée avant toute requête", async () => {
  const { drive, appels } = clientLecture({ enfants: arbre() });
  await assert.rejects(inventorierPerimetre({ drive, racineId: "x'; --", nomRacine: "A2C" }), /Identifiant de racine invalide/);
  assert.equal(appels.length, 0);
});

test("lecture seule stricte : aucune méthode d'écriture appelée, quel que soit le parcours", async () => {
  const { drive, ecritures } = clientLecture({ enfants: arbre(), pages: { DOSSIER_MODELES_A: true } });
  await inventorierPerimetre({ drive, racineId: "RACINE_TEST_000", nomRacine: "A2C Qualiopi" });
  assert.deepEqual(ecritures, []);
});
