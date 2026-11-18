// ─────────────────────────────────────────────────────────────
//  Plusieurs documents par session (modèle generation_multiple, ex. compte rendu prescripteur) : création,
//  libellé obligatoire, remplacement par libellé identique uniquement. PostgreSQL réel, Drive SIMULÉ, données FICTIVES.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import os from "node:os";
import path from "node:path";
import pg from "pg";

import { setPoolFactory, setQueryExecutor } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { seedReferentiel } from "../src/seed.js";
import { createApp } from "../src/app.js";
import { encode } from "../src/session.js";
import { setDriveFactory } from "../src/services/google.js";
import { clientDriveSimule as simulateur } from "./helpers/genererDrive.js";

const PORT = 55497;
const DATA = path.join(os.tmpdir(), "vq-generation-multiple-" + process.pid);

let cluster, pool, serveur, origine, adminId;
const F = {};
let numero = 0;
const TEXTES = new Map();

const cookie = (uid) => "vq_session=" + encode({ uid, exp: Date.now() + 60_000 });
const A = () => ({ cookie: cookie(adminId) });
async function api(methode, chemin, corps, enTetes = {}) {
  const r = await fetch(origine + chemin, {
    method: methode, headers: { "Content-Type": "application/json", ...enTetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}
function ok(r, statut = [200, 201]) {
  assert.ok([].concat(statut).includes(r.statut), `${r.statut} ${JSON.stringify(r.corps)}`);
  return r.corps;
}
function drive() {
  const s = simulateur({ modeleTexte: "" });
  const lire = s.client.docs.documents.get;
  const copier = s.client.drive.files.copy;
  s.client.drive.files.copy = async (args) => {
    const r = await copier(args);
    s.trace.contenuCopies.set(r.data.id, TEXTES.get(args.fileId) ?? "");
    return r;
  };
  s.client.docs.documents.get = async ({ documentId, ...reste }) => {
    if (TEXTES.has(documentId)) return { data: { body: { content: [{ paragraph: { elements: [{ textRun: { content: TEXTES.get(documentId) } }] } }] }, headers: {}, footers: {} } };
    return lire({ documentId, ...reste });
  };
  return s;
}
async function modele(texte, extra = {}) {
  const lien = `MODELE_GM_${String(++numero).padStart(6, "0")}`;
  TEXTES.set(lien, texte);
  return ok(await api("POST", "/api/modeles", { nom: `Modèle QA ${numero}`, lien, portee: "stagiaire", type_document: "autre", mode_generation: "manuel", indicateurs: [5], ...extra }, A()), 201).modele.id;
}
async function documents(sessionId, modeleId) {
  const { rows } = await pool.query("SELECT drive_file_id, stagiaire_id FROM documents_generes WHERE session_id = $1 AND modele_id = $2 ORDER BY stagiaire_id", [sessionId, modeleId]);
  return rows.map((r) => ({ stagiaire_id: r.stagiaire_id, texte: (F.drive.trace.contenuCopies.get(r.drive_file_id) || "").replace(/\s+/g, " ").trim() }));
}

before(async () => {
  cluster = new EmbeddedPostgres({ databaseDir: DATA, port: PORT, user: "postgres", password: "postgres", persistent: false, onLog: () => {}, onError: () => {} });
  await cluster.initialise();
  await cluster.start();
  const racine = cluster.getPgClient("postgres");
  await racine.connect();
  await racine.query("CREATE DATABASE vq");
  await racine.end();
  pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/vq`, ssl: false, max: 8 });
  setPoolFactory(() => pool);
  setQueryExecutor((text, params) => pool.query(text, params));
  await migrate({ log: () => {} });
  await seedReferentiel();
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@qa.local', 'Admin Test', 'admin') RETURNING id"));
  serveur = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
  F.drive = drive();
  setDriveFactory(() => F.drive.client);
  F.formation = ok(await api("POST", "/api/formations", { intitule: "Atelier fictif", duree_heures_defaut: 20, modalite: "presentiel" }, A()), 201).formation.id;
  F.session = ok(await api("POST", "/api/sessions", { formation_id: F.formation, date_debut: "2026-12-01", date_fin: "2026-12-10", reference: "QA-1" }, A()), 201).session.id;
  F.inscrits = {};
  for (const nom of ["Alpha", "Bravo", "Charlie", "Delta"]) {
    F.inscrits[nom] = ok(await api("POST", `/api/sessions/${F.session}/stagiaires`, { nom, prenom: "Test" }, A()), 201).inscription;
  }
});

after(async () => {
  setDriveFactory(null);
  setPoolFactory(null);
  setQueryExecutor(null);
  if (serveur) await new Promise((r) => serveur.close(r));
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
});

test("création : plusieurs documents par session refusé pour un usage stagiaire et hors génération manuelle", async () => {
  const lien = "MODELE_GM_REFUS_0001";
  TEXTES.set(lien, "CR");
  const base = { nom: "CR refusé", lien, indicateurs: [5], type_document: "autre" };
  assert.equal((await api("POST", "/api/modeles", { ...base, portee: "stagiaire", mode_generation: "manuel", generation_multiple: true }, A())).statut, 400);
  assert.equal((await api("POST", "/api/modeles", { ...base, portee: "session", mode_generation: "automatique", declencheur: "fin_session", generation_multiple: true }, A())).statut, 400);
});

test("compte rendu prescripteur : un document par libellé, remplacement du même libellé seulement après confirmation", async () => {
  const lien = "MODELE_GM_CR_0001";
  TEXTES.set(lien, "COMPTE RENDU {{formation_intitule}}");
  const m = ok(await api("POST", "/api/modeles", { nom: "Compte rendu prescripteur", lien, portee: "session", type_document: "autre", mode_generation: "manuel", indicateurs: [5], generation_multiple: true }, A()), 201).modele;
  assert.equal(m.generation_multiple, true);
  const gen = (corps) => api("POST", "/api/generations", { modele_id: m.id, session_id: F.session, ...corps }, A());
  assert.equal((await gen({})).statut >= 400, true, "libellé obligatoire");
  ok(await gen({ libelle: "Prescripteur A" }));
  ok(await gen({ libelle: "Prescripteur B" }));
  const { rows } = await pool.query("SELECT libelle FROM documents_generes WHERE modele_id = $1 ORDER BY libelle", [m.id]);
  assert.deepEqual(rows.map((r) => r.libelle), ["Prescripteur A", "Prescripteur B"], "deux documents indépendants");
  assert.equal((await gen({ libelle: "Prescripteur A" })).statut, 409, "même libellé sans confirmation : bloqué");
  ok(await gen({ libelle: "Prescripteur A", remplacer: true }));
  const { rows: apres } = await pool.query("SELECT libelle FROM documents_generes WHERE modele_id = $1", [m.id]);
  assert.equal(apres.length, 2, "remplacé, pas dupliqué");
  const copie = [...F.drive.trace.contenuCopies.values()].filter((t) => t.includes("COMPTE RENDU Atelier fictif"));
  assert.ok(copie.length >= 2, "formation injectée dans les copies");
});
