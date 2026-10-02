// ─────────────────────────────────────────────────────────────
//  Q4-2 — Justificatifs professionnels des intervenants : pièces attendues,
//  rattachement de preuves existantes, états (dates et alertes des preuves),
//  sous-traitance, pilotage, et CONFIDENTIALITÉ par tous les chemins
//  d'accès aux preuves. Base PostgreSQL RÉELLE et vierge + Express réelle.
//  Données entièrement fictives.
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";

import { setPoolFactory, setQueryExecutor } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { seedReferentiel } from "../src/seed.js";
import { createApp } from "../src/app.js";
import { encode } from "../src/session.js";
import { dateMetierAujourdhui } from "../src/services/dates.js";
import { lignesDossier } from "../src/services/justificatifs.js";

const PORT = 55458; // distinct des autres fichiers (55445-55447, 55449-55457)
const DATA = path.join(os.tmpdir(), "vq-justif-" + process.pid);
const CV = "CV-confidentiel-fictif";

let cluster, pool, serveur, origine, adminId, contribId, indicateurId;
const F = {};

before(async () => {
  cluster = new EmbeddedPostgres({ databaseDir: DATA, port: PORT, user: "postgres", password: "postgres", persistent: false, onLog: () => {}, onError: () => {} });
  await cluster.initialise();
  await cluster.start();
  const racine = cluster.getPgClient("postgres");
  await racine.connect();
  await racine.query("CREATE DATABASE vq");
  await racine.end();
  pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/vq`, ssl: false });
  setPoolFactory(() => pool);
  setQueryExecutor((text, params) => pool.query(text, params));
  await migrate({ log: () => {} });
  await seedReferentiel();
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@j.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@j.local', 'Tukui', 'contributeur') RETURNING id"));
  ({ rows: [{ id: indicateurId }] } = await pool.query("SELECT i.id FROM indicateurs i WHERE i.numero = 21 ORDER BY i.id LIMIT 1"));
  serveur = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});

after(async () => {
  setPoolFactory(null);
  setQueryExecutor(null);
  if (serveur) await new Promise((r) => serveur.close(r));
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
  await fs.rm(DATA, { recursive: true, force: true }).catch(() => {});
});

const cookie = (uid) => "vq_session=" + encode({ uid, exp: Date.now() + 60_000 });
const A = () => ({ cookie: cookie(adminId) });
const C = () => ({ cookie: cookie(contribId) });
const api = async (methode, chemin, corps, enTetes = {}) => {
  const r = await fetch(origine + chemin, { method: methode, headers: { "content-type": "application/json", ...enTetes }, ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};
const ok = (r) => { assert.ok(r.statut < 300, JSON.stringify(r.corps)); return r.corps; };
const plusJours = (n) => { const d = new Date(`${dateMetierAujourdhui()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// Preuve fictive avec un fichier Drive simulé (aucun appel Drive).
async function preuve(titre, echeance = null, extra = {}) {
  const { rows: [p] } = await pool.query(
    `INSERT INTO preuves (indicateur_id, titre, type_alerte, date_echeance, session_id, veille_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [indicateurId, titre, echeance ? "echeance_fixe" : null, echeance, extra.session ?? null, extra.veille ?? null]);
  await pool.query("INSERT INTO preuve_fichiers (preuve_id, drive_file_id, drive_url, drive_nom) VALUES ($1, $2, $3, $4)",
    [p.id, `DRV-${p.id}`, `https://drive.google.com/file/d/DRV-${p.id}/view`, `${titre}.pdf`]);
  return p.id;
}

test("pur : états par catégorie — disponible > bientôt > périmé ; manquant seulement si attendue", () => {
  const l = lignesDossier(["cv", "diplome", "contrat"], [
    { categorie: "cv", alerte_statut: "perime" }, { categorie: "cv", alerte_statut: null },
    { categorie: "attestation", alerte_statut: "bientot" }, { categorie: "contrat", alerte_statut: "perime" }]);
  const e = Object.fromEntries(l.map((x) => [x.categorie, [x.attendue, x.etat]]));
  assert.deepEqual(e, { cv: [true, "disponible"], diplome: [true, "manquant"], attestation: [false, "bientot"], certification: [false, null], contrat: [true, "perime"], autre: [false, null] });
});

test("préparation : intervenants (salarié, sous-traitant, inactif), preuves avec dates, session, veille, action", async () => {
  const f = ok(await api("POST", "/api/formations", { intitule: "Formation fictive", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation;
  F.session = ok(await api("POST", "/api/sessions", { formation_id: f.id, reference: "S-JUST", date_debut: "2026-09-01", date_fin: "2026-12-15" }, A())).session.id;
  F.zoe = ok(await api("POST", "/api/intervenants", { nom: "Martin", prenom: "Zoé", nature: "salarie" }, A())).intervenant.id;
  F.sam = ok(await api("POST", "/api/intervenants", { nom: "Soustraitant", prenom: "Sam", nature: "sous_traitant" }, A())).intervenant.id;
  F.ina = ok(await api("POST", "/api/intervenants", { nom: "Inactive", prenom: "Ina", nature: "exterieur" }, A())).intervenant.id;
  F.veille = ok(await api("POST", "/api/veille", { type: "autre", titre: "Veille fictive", date_publication: "2026-09-01", indicateur_ids: [indicateurId] }, A())).veille.id;
  F.pCv = await preuve(CV, "2099-12-31", { session: F.session, veille: F.veille });
  F.pDiplome = await preuve("Diplôme fictif", plusJours(10));
  F.pAttest = await preuve("Attestation fictive", "2020-01-01");
  F.pContrat = await preuve("Contrat de sous-traitance fictif", plusJours(400));
  F.pPublique = await preuve("Procédure d'accueil (publique)", null, { session: F.session, veille: F.veille });
  F.action = ok(await api("POST", "/api/actions-qualite", { titre: "Action fictive", responsable_id: contribId }, A())).action.id;
  ok(await api("POST", `/api/actions-qualite/${F.action}/preuves`, { preuve_id: F.pCv }, A()));
  ok(await api("POST", `/api/actions-qualite/${F.action}/preuves`, { preuve_id: F.pPublique }, A()));
});

test("pièces attendues : définies par l'admin, catégorie inconnue refusée ; facultatives jamais « manquantes »", async () => {
  let d = ok(await api("GET", `/api/intervenants/${F.zoe}/justificatifs`, undefined, A()));
  assert.ok(d.lignes.every((l) => l.etat === null), "rien d'attendu : aucune pièce manquante");
  d = ok(await api("PUT", `/api/intervenants/${F.zoe}/justificatifs/attendus`, { categories: ["cv", "diplome", "certification", "cv"] }, A()));
  assert.deepEqual(d.attendus.sort(), ["certification", "cv", "diplome"]);
  assert.deepEqual(d.lignes.filter((l) => l.etat === "manquant").map((l) => l.categorie), ["cv", "diplome", "certification"]);
  assert.equal((await api("PUT", `/api/intervenants/${F.zoe}/justificatifs/attendus`, { categories: ["casier"] }, A())).statut, 400);
  d = ok(await api("PUT", `/api/intervenants/${F.zoe}/justificatifs/attendus`, { categories: ["cv", "diplome"] }, A()));
  assert.deepEqual(d.attendus.sort(), ["cv", "diplome"], "remplacement complet");
});

test("rattachement : preuve existante (aucune copie), états d'après les dates de la preuve ; doublon 409 ; erreurs 400 / 404", async () => {
  ok(await api("POST", `/api/intervenants/${F.zoe}/justificatifs`, { preuve_id: F.pCv, categorie: "cv" }, A()));
  ok(await api("POST", `/api/intervenants/${F.zoe}/justificatifs`, { preuve_id: F.pDiplome, categorie: "diplome", date_document: "2015-06-30" }, A()));
  const d = ok(await api("POST", `/api/intervenants/${F.zoe}/justificatifs`, { preuve_id: F.pAttest, categorie: "attestation" }, A()));
  const e = Object.fromEntries(d.lignes.map((l) => [l.categorie, l.etat]));
  assert.deepEqual([e.cv, e.diplome, e.attestation, e.certification], ["disponible", "bientot", "perime", null]);
  const dip = d.justificatifs.find((j) => j.categorie === "diplome");
  assert.deepEqual([dip.date_document, dip.titre, dip.fichiers.length], ["2015-06-30", "Diplôme fictif", 1]);
  assert.equal((await pool.query("SELECT count(*)::int n FROM preuve_fichiers WHERE drive_file_id = $1", [`DRV-${F.pCv}`])).rows[0].n, 1, "aucune copie de fichier");
  assert.equal((await api("POST", `/api/intervenants/${F.zoe}/justificatifs`, { preuve_id: F.pCv, categorie: "cv" }, A())).statut, 409);
  assert.equal((await api("POST", `/api/intervenants/${F.zoe}/justificatifs`, { preuve_id: 999999, categorie: "cv" }, A())).statut, 404);
  assert.equal((await api("POST", `/api/intervenants/${F.zoe}/justificatifs`, { preuve_id: F.pContrat, categorie: "casier" }, A())).statut, 400);
  assert.equal((await api("POST", `/api/intervenants/${F.zoe}/justificatifs`, { preuve_id: F.pContrat, categorie: "contrat", date_document: "2026-02-31" }, A())).statut, 400);
  assert.equal((await api("POST", `/api/intervenants/999999/justificatifs`, { preuve_id: F.pContrat, categorie: "contrat" }, A())).statut, 404);
  const { rows } = await pool.query("SELECT preuve_id FROM preuves_confidentielles ORDER BY preuve_id");
  assert.deepEqual(rows.map((r) => r.preuve_id), [F.pCv, F.pDiplome, F.pAttest], "preuves rattachées devenues confidentielles");
});

test("sous-traitant : contrat (référence Drive, date, échéance, état) ; aucun bloc pour un salarié", async () => {
  ok(await api("PUT", `/api/intervenants/${F.sam}/justificatifs/attendus`, { categories: ["contrat"] }, A()));
  let d = ok(await api("GET", `/api/intervenants/${F.sam}/justificatifs`, undefined, A()));
  assert.deepEqual([d.sous_traitance.contrat_attendu, d.sous_traitance.etat, d.sous_traitance.contrats.length], [true, "manquant", 0]);
  d = ok(await api("POST", `/api/intervenants/${F.sam}/justificatifs`, { preuve_id: F.pContrat, categorie: "contrat", date_document: "2026-09-01" }, A()));
  const c = d.sous_traitance.contrats[0];
  assert.deepEqual([d.sous_traitance.etat, c.date_document, c.date_echeance, c.fichiers[0].url], ["disponible", "2026-09-01", plusJours(400), `https://drive.google.com/file/d/DRV-${F.pContrat}/view`]);
  assert.equal(ok(await api("GET", `/api/intervenants/${F.zoe}/justificatifs`, undefined, A())).sous_traitance, null);
});

test("pilotage : manquants, bientôt, périmés, intervenants concernés ; inactif exclu des alertes mais dossier conservé ; tableau de bord", async () => {
  ok(await api("PUT", `/api/intervenants/${F.ina}/justificatifs/attendus`, { categories: ["cv"] }, A()));
  ok(await api("PATCH", `/api/intervenants/${F.ina}`, { actif: false }, A()));
  const a = ok(await api("GET", "/api/justificatifs-intervenants", undefined, A()));
  assert.deepEqual(a.resume, { manquants: 0, bientot: 1, perimes: 1, intervenants: 1 });
  assert.deepEqual(a.elements.map((x) => [x.intervenant.prenom, x.categorie, x.etat]), [["Zoé", "diplome", "bientot"], ["Zoé", "attestation", "perime"]]);
  ok(await api("PUT", `/api/intervenants/${F.zoe}/justificatifs/attendus`, { categories: ["cv", "diplome", "certification"] }, A()));
  assert.equal(ok(await api("GET", "/api/justificatifs-intervenants", undefined, A())).resume.manquants, 1);
  assert.deepEqual(ok(await api("GET", `/api/intervenants/${F.ina}/justificatifs`, undefined, A())).attendus, ["cv"], "inactif : dossier conservé");
  const t = ok(await api("GET", "/api/qualite/tableau-de-bord?aujourdhui=2026-10-02", undefined, A()));
  assert.deepEqual(t.justificatifs_intervenants, { manquants: 1, bientot: 1, perimes: 1, intervenants: 1 });
  assert.ok(t.kpis && t.satisfaction, "tableau de bord existant conservé");
});

test("retrait : seul le rattachement disparaît — preuve, fichier Drive et confidentialité conservés", async () => {
  const d = ok(await api("GET", `/api/intervenants/${F.zoe}/justificatifs`, undefined, A()));
  const lien = d.justificatifs.find((j) => j.preuve_id === F.pAttest).id;
  assert.equal((await api("DELETE", `/api/intervenants/${F.sam}/justificatifs/${lien}`, undefined, A())).statut, 404, "rattachement d'un autre intervenant");
  ok(await api("DELETE", `/api/intervenants/${F.zoe}/justificatifs/${lien}`, undefined, A()));
  const { rows: [r] } = await pool.query(`SELECT (SELECT count(*) FROM preuves WHERE id = $1)::int AS p, (SELECT count(*) FROM preuve_fichiers WHERE preuve_id = $1)::int AS f,
    (SELECT count(*) FROM preuves_confidentielles WHERE preuve_id = $1)::int AS c`, [F.pAttest]);
  assert.deepEqual({ ...r }, { p: 1, f: 1, c: 1 });
  assert.equal((await api("DELETE", `/api/intervenants/${F.zoe}/justificatifs/${lien}`, undefined, A())).statut, 404);
});

test("CONFIDENTIALITÉ : contributeur refusé sur toutes les routes documentaires (403)", async () => {
  for (const [m, ch, b] of [["GET", `/api/intervenants/${F.zoe}/justificatifs`], ["PUT", `/api/intervenants/${F.zoe}/justificatifs/attendus`, { categories: [] }],
    ["POST", `/api/intervenants/${F.zoe}/justificatifs`, { preuve_id: F.pPublique, categorie: "autre" }], ["DELETE", `/api/intervenants/${F.zoe}/justificatifs/1`],
    ["GET", "/api/justificatifs-intervenants"], ["GET", "/api/qualite/tableau-de-bord"]]) {
    const r = await api(m, ch, b, C());
    assert.equal(r.statut, 403, `${m} ${ch}`);
    assert.ok(!JSON.stringify(r.corps).includes(CV));
  }
  assert.equal((await api("GET", `/api/intervenants/${F.zoe}/justificatifs`)).statut, 401);
});

test("CONFIDENTIALITÉ : accès direct par identifiant, liste, recherche, session, veille, action qualité — rien pour le contributeur ; l'admin voit tout", async () => {
  const fuite = (o) => JSON.stringify(o).includes(CV) || JSON.stringify(o).includes(`DRV-${F.pCv}`);
  for (const id of [F.pCv, F.pDiplome, F.pAttest]) assert.equal((await api("GET", `/api/preuves/${id}`, undefined, C())).statut, 404, `preuve ${id} par identifiant`);
  const liste = ok(await api("GET", "/api/preuves", undefined, C()));
  assert.ok(!fuite(liste) && !liste.preuves.some((p) => [F.pCv, F.pDiplome, F.pAttest].includes(p.id)));
  assert.equal(ok(await api("GET", `/api/preuves?q=${encodeURIComponent("CV-confidentiel")}`, undefined, C())).total, 0, "recherche par titre");
  assert.equal(ok(await api("GET", "/api/preuves?alerte=perime", undefined, C())).preuves.some((p) => p.id === F.pAttest), false, "filtre d'alerte");
  const parSession = ok(await api("GET", `/api/preuves?session=${F.session}`, undefined, C()));
  assert.deepEqual(parSession.preuves.map((p) => p.id), [F.pPublique], "preuves d'une session : la publique seulement");
  const veille = ok(await api("GET", `/api/veille/${F.veille}`, undefined, C()));
  assert.deepEqual(veille.preuves.map((p) => p.id), [F.pPublique]);
  const action = ok(await api("GET", `/api/actions-qualite/${F.action}`, undefined, C()));
  assert.deepEqual(action.preuves.map((p) => p.id), [F.pPublique], "action du contributeur : justificatif masqué");
  assert.ok(!fuite(action) && !fuite(veille) && !fuite(parSession));
  // Admin : accès complet, preuves historiques intactes.
  assert.equal(ok(await api("GET", `/api/preuves/${F.pCv}`, undefined, A())).preuve.titre, CV);
  assert.deepEqual(ok(await api("GET", `/api/actions-qualite/${F.action}`, undefined, A())).preuves.map((p) => p.id).sort((a, b) => a - b), [F.pCv, F.pPublique].sort((a, b) => a - b));
  assert.equal(ok(await api("GET", `/api/veille/${F.veille}`, undefined, A())).preuves.length, 2);
  // Une preuve jamais rattachée reste visible du contributeur (historique conservé).
  assert.equal(ok(await api("GET", `/api/preuves/${F.pPublique}`, undefined, C())).preuve.id, F.pPublique);
});

test("CONFIDENTIALITÉ : document généré d'une session devenu justificatif — masqué au contributeur dans le détail de session", async () => {
  const { rows: [m] } = await pool.query("INSERT INTO modeles_documents (nom, drive_file_id, portee) VALUES ('Attestation', 'DRV-MODELE', 'session') RETURNING id");
  const pGen = await preuve("Attestation-generee-fictive", null, { session: F.session });
  await pool.query("INSERT INTO documents_generes (modele_id, session_id, drive_file_id, drive_url, nom, preuve_id) VALUES ($1,$2,'DRV-GEN','https://drive.google.com/file/d/DRV-GEN/view','Attestation-generee-fictive',$3)", [m.id, F.session, pGen]);
  assert.equal(ok(await api("GET", `/api/sessions/${F.session}`, undefined, C())).documents.length, 1, "avant rattachement : visible");
  ok(await api("POST", `/api/intervenants/${F.zoe}/justificatifs`, { preuve_id: pGen, categorie: "attestation" }, A()));
  const c = ok(await api("GET", `/api/sessions/${F.session}`, undefined, C()));
  assert.equal(c.documents.length, 0);
  assert.ok(!JSON.stringify(c).includes("DRV-GEN"));
  assert.equal(ok(await api("GET", `/api/sessions/${F.session}`, undefined, A())).documents.length, 1, "admin : inchangé");
});

test("non-régression Q4-1 : annuaire contributeur inchangé, sans données documentaires", async () => {
  const c = ok(await api("GET", `/api/intervenants/${F.zoe}`, undefined, C()));
  assert.deepEqual(Object.keys(c.intervenant).sort(), ["actif", "civilite", "domaines", "fonction", "id", "nom", "prenom"]);
  assert.ok(!JSON.stringify(c).includes(CV));
  const l = ok(await api("GET", "/api/intervenants", undefined, C()));
  assert.ok(!JSON.stringify(l).includes("justificatif"));
});
