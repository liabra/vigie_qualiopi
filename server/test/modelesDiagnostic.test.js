// ─────────────────────────────────────────────────────────────
//  DOC-2 — GET /api/modeles/:id/diagnostic : autorisation, accès Drive,
//  modèle introuvable. Application RÉELLE, base et Drive SIMULÉS (comme
//  generationRobuste.test.js). Aucune donnée réelle.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { setPoolFactory } from "../src/db.js";
import { setDriveFactory, DRIVE_FILE } from "../src/services/google.js";
import { encode } from "../src/session.js";

const DOC = "application/vnd.google-apps.document";
const ADMIN = { id: 1, email: "admin@exemple.fr", nom: "Mme Stark", role: "admin" };
const CONTRIBUTEUR = { id: 2, email: "tukui@exemple.fr", nom: "Tukui", role: "contributeur" };
const MODELE = { id: 1, nom: "Convocation", drive_file_id: "FICHIER" };
const sqlNormalise = (t) => String(t).replace(/\s+/g, " ").trim();

let serveur, origine;
before(async () => {
  serveur = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});
after(async () => {
  setPoolFactory(null);
  setDriveFactory(null);
  if (serveur) await new Promise((r) => serveur.close(r));
});

function baseSimulee({ modele = MODELE } = {}) {
  const executer = async (text, params) => {
    const sql = sqlNormalise(text);
    if (sql === "SELECT id, email, nom, role FROM utilisateurs WHERE id = $1 AND actif") {
      const u = [ADMIN, CONTRIBUTEUR].find((x) => x.id === params[0]);
      return { rows: u ? [u] : [] };
    }
    if (sql === "SELECT id, nom, drive_file_id FROM modeles_documents WHERE id = $1") {
      return { rows: modele && modele.id === params[0] ? [modele] : [] };
    }
    throw new Error("Requête inattendue pour la base simulée : " + sql);
  };
  setPoolFactory(() => ({ query: executer, connect: async () => ({ query: executer, release: () => {} }) }));
}

function driveSimule({ connecte = true, mime = DOC, document = { body: { content: [] }, headers: {}, footers: {} }, echecGet = null } = {}) {
  setDriveFactory(() => {
    if (!connecte) return null;
    return {
      row: { scopes: DRIVE_FILE, expiry: Date.now() + 60_000, access_token: "x" },
      drive: { files: { get: async () => {
        if (echecGet) throw Object.assign(new Error(echecGet.message), { response: { status: echecGet.statut } });
        return { data: { id: "FICHIER", mimeType: mime } };
      } } },
      docs: { documents: { get: async () => ({ data: document }) } },
      sheets: { spreadsheets: { get: async () => ({ data: { sheets: [] } }), values: { get: async () => ({ data: { values: [] } }) } } },
    };
  });
}

const appeler = async (id, utilisateur) => {
  const r = await fetch(origine + `/api/modeles/${id}/diagnostic`, {
    headers: utilisateur ? { cookie: "vq_session=" + encode({ uid: utilisateur.id, exp: Date.now() + 60_000 }) } : {},
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};

test("anonyme : 401", async () => {
  baseSimulee(); driveSimule();
  const r = await appeler(1, null);
  assert.equal(r.statut, 401);
});

test("contributeur : 403, réservé aux administrateurs", async () => {
  baseSimulee(); driveSimule();
  const r = await appeler(1, CONTRIBUTEUR);
  assert.equal(r.statut, 403);
});

test("admin, modèle inexistant : 404", async () => {
  baseSimulee({ modele: null }); driveSimule();
  const r = await appeler(99, ADMIN);
  assert.equal(r.statut, 404);
});

test("identifiant invalide : 400", async () => {
  baseSimulee(); driveSimule();
  const r = await appeler("abc", ADMIN);
  assert.equal(r.statut, 400);
});

test("admin, Drive non connecté : 503, aucun contenu attendu", async () => {
  baseSimulee(); driveSimule({ connecte: false });
  const r = await appeler(1, ADMIN);
  assert.equal(r.statut, 503);
  assert.ok(!r.corps.etat);
});

test("admin, fichier Drive introuvable : 400, message sans détail technique brut", async () => {
  baseSimulee(); driveSimule({ echecGet: { statut: 404, message: "File not found: FICHIER" } });
  const r = await appeler(1, ADMIN);
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /introuvable ou inaccessible/);
});

test("admin, modèle valide : 200, diagnostic complet avec analyse_le", async () => {
  baseSimulee();
  driveSimule({ document: { body: { content: [{ paragraph: { elements: [{ textRun: { content: "{{formation_intitule}}" } }] } }] }, headers: {}, footers: {} } });
  const r = await appeler(1, ADMIN);
  assert.equal(r.statut, 200);
  assert.equal(r.corps.etat, "valide");
  assert.ok(r.corps.analyse_le);
  assert.equal(r.corps.type_fichier, "document");
});

test("admin, mime non pris en charge : 400 avec code format_non_supporte", async () => {
  baseSimulee(); driveSimule({ mime: "application/pdf" });
  const r = await appeler(1, ADMIN);
  assert.equal(r.statut, 400);
  assert.equal(r.corps.code, "format_non_supporte");
});
