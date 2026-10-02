// ─────────────────────────────────────────────────────────────
//  Q4-1 — Annuaire des intervenants : fiches, recherche, droits, projection
//  contributeur, rattachements sessions / groupes, historique conservé,
//  marqueur {{formateur}}. Base PostgreSQL RÉELLE et vierge + Express
//  réelle. Données entièrement fictives.
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
import { champsIntervenant, nomsFormateurs } from "../src/services/intervenants.js";
import { valeursMarqueurs } from "../src/services/marqueurs.js";
import { contexteGeneration } from "../src/services/documents.js";

const PORT = 55457; // distinct des autres fichiers (55445-55447, 55449-55456)
const DATA = path.join(os.tmpdir(), "vq-interv-" + process.pid);

let cluster, pool, serveur, origine, adminId, contribId;
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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@i.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@i.local', 'Tukui', 'contributeur') RETURNING id"));
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

test("pur : validation (données pro seules, listes fermées), noms des formateurs déterministes", () => {
  assert.equal(champsIntervenant({ nom: "", prenom: "A", nature: "salarie" }, { creation: true }).erreur, "Nom obligatoire.");
  assert.equal(champsIntervenant({ nom: "N", prenom: "P", nature: "benevole" }, { creation: true }).erreur, "Nature de l'intervention inconnue.");
  assert.equal(champsIntervenant({ nom: "N", prenom: "P", nature: "salarie", fonction: "directeur" }, { creation: true }).erreur, "Fonction inconnue.");
  assert.equal(champsIntervenant({ nom: "N", prenom: "P", nature: "salarie", email: "pas-un-mail" }, { creation: true }).erreur, "Adresse e-mail professionnelle invalide.");
  const c = champsIntervenant({ nom: " Durand ", prenom: "Léa", nature: "exterieur", email: "Lea@Exemple.FR", domaines: ["Bureautique", "bureautique", " ", "Accueil"],
    adresse: "1 rue fictive", date_naissance: "1980-01-01", iban: "FR76…" }, { creation: true }).champs;
  assert.deepEqual(c, { civilite: null, nom: "Durand", prenom: "Léa", email: "lea@exemple.fr", fonction: "formateur", nature: "exterieur", domaines: ["Bureautique", "Accueil"] });
  assert.equal(nomsFormateurs([{ id: 2, nom: "Martin", prenom: "Zoé", fonction: "formateur" }, { id: 1, nom: "Abel", prenom: "Luc", fonction: "formateur" },
    { id: 3, nom: "Appui", prenom: "Ana", fonction: "appui" }, { id: 4, nom: "Martin", prenom: "Ali", fonction: "formateur" }]), "Luc Abel, Ali Martin et Zoé Martin");
  assert.equal(nomsFormateurs([{ nom: "Seul", prenom: "Un", fonction: "formateur" }]), "Un Seul");
  assert.equal(nomsFormateurs([{ nom: "Ref", prenom: "Handi", fonction: "referent_handicap" }]), "", "référent handicap jamais dans {{formateur}}");
});

test("marqueur {{formateur}} : historique inchangé ; rattachement prioritaire ; groupe avant session ; appui ignoré", () => {
  const session = { formateur: "M. Durand" }, groupe = { formateur: "Mme Lopez" };
  assert.equal(valeursMarqueurs({ session }).formateur, "M. Durand", "session historique");
  assert.equal(valeursMarqueurs({ session, groupe }).formateur, "Mme Lopez", "groupe historique");
  assert.equal(valeursMarqueurs({ session, groupe: { formateur: null } }).formateur, "M. Durand");
  const fs = [{ nom: "Abel", prenom: "Luc", fonction: "formateur" }, { nom: "Martin", prenom: "Zoé", fonction: "formateur" }];
  assert.equal(valeursMarqueurs({ session, formateursSession: fs }).formateur, "Luc Abel et Zoé Martin");
  assert.equal(valeursMarqueurs({ session, groupe, formateursSession: fs }).formateur, "Mme Lopez", "texte du groupe prioritaire sur la session");
  assert.equal(valeursMarqueurs({ session, groupe, formateursGroupe: [fs[1]], formateursSession: fs }).formateur, "Zoé Martin");
  assert.equal(valeursMarqueurs({ session, formateursSession: [{ nom: "Appui", prenom: "Ana", fonction: "appui" }] }).formateur, "M. Durand", "personnel d'appui : rendu historique conservé");
});

test("préparation : deux formations, deux sessions (formateurs historiques en texte), deux groupes, une session archivée", async () => {
  F.f1 = ok(await api("POST", "/api/formations", { intitule: "Aide à domicile", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation.id;
  F.f2 = ok(await api("POST", "/api/formations", { intitule: "Agent de propreté", duree_heures_defaut: 35, modalite: "presentiel" }, A())).formation.id;
  F.s1 = ok(await api("POST", "/api/sessions", { formation_id: F.f1, reference: "ADVF-1", date_debut: "2026-09-01", date_fin: "2026-12-15", formateur: "M. Durand" }, A())).session.id;
  F.s2 = ok(await api("POST", "/api/sessions", { formation_id: F.f2, reference: "APH-1", date_debut: "2026-10-01", date_fin: "2026-12-15" }, A())).session.id;
  F.arch = ok(await api("POST", "/api/sessions", { formation_id: F.f2, reference: "ARCH-1", date_debut: "2025-01-01", date_fin: "2025-03-01" }, A())).session.id;
  F.g1 = ok(await api("POST", `/api/sessions/${F.s1}/groupes`, { nom: "Soula", formateur: "Mme Lopez" }, A())).groupe.id;
  F.g2 = ok(await api("POST", `/api/sessions/${F.s1}/groupes`, { nom: "Tonate" }, A())).groupe.id;
  F.gAutre = ok(await api("POST", `/api/sessions/${F.s2}/groupes`, { nom: "Kourou" }, A())).groupe.id;
});

test("création et modification (admin) ; e-mail unique ; aucune donnée sensible stockée ; contributeur refusé (403)", async () => {
  const a = ok(await api("POST", "/api/intervenants", { civilite: "Mme", nom: "Martin", prenom: "Zoé", email: "zoe.martin@a2c.fictif", fonction: "formateur", nature: "salarie",
    domaines: ["Aide à la personne"], formation_ids: [F.f1, F.f2], date_naissance: "1980-01-01", adresse: "1 rue fictive" }, A())).intervenant;
  assert.deepEqual(a.formations.map((f) => f.intitule), ["Agent de propreté", "Aide à domicile"]);
  const { rows: [cols] } = await pool.query("SELECT row_to_json(i)::text AS t FROM intervenants i WHERE id = $1", [a.id]);
  assert.ok(!cols.t.includes("1980-01-01") && !cols.t.includes("rue fictive"), "aucune donnée hors liste blanche");
  F.zoe = a.id;
  F.luc = ok(await api("POST", "/api/intervenants", { nom: "Abel", prenom: "Luc", fonction: "formateur", nature: "exterieur", domaines: ["Bureautique"] }, A())).intervenant.id;
  F.ana = ok(await api("POST", "/api/intervenants", { nom: "Appui", prenom: "Ana", fonction: "appui", nature: "salarie" }, A())).intervenant.id;
  F.ref = ok(await api("POST", "/api/intervenants", { nom: "Handi", prenom: "Rémi", fonction: "referent_handicap", nature: "salarie" }, A())).intervenant.id;
  assert.equal((await api("POST", "/api/intervenants", { nom: "Autre", prenom: "Zoé", nature: "salarie", email: "ZOE.MARTIN@a2c.fictif" }, A())).statut, 409, "e-mail déjà pris (casse ignorée)");
  // Homonyme sans e-mail : une autre personne, jamais fusionnée.
  F.homonyme = ok(await api("POST", "/api/intervenants", { nom: "Martin", prenom: "Zoé", nature: "sous_traitant" }, A())).intervenant.id;
  assert.notEqual(F.homonyme, F.zoe);
  const m = ok(await api("PATCH", `/api/intervenants/${F.luc}`, { domaines: ["Bureautique", "Numérique"], formation_ids: [F.f2], nature: "porte" }, A())).intervenant;
  assert.deepEqual([m.domaines, m.nature, m.formations.map((f) => f.id)], [["Bureautique", "Numérique"], "porte", [F.f2]]);
  assert.equal((await api("PATCH", `/api/intervenants/${F.luc}`, { formation_ids: [999999] }, A())).statut, 400);
  assert.equal((await api("PATCH", `/api/intervenants/${F.luc}`, {}, A())).statut, 400);
  for (const [m2, ch, b] of [["POST", "/api/intervenants", { nom: "X", prenom: "Y", nature: "salarie" }], ["PATCH", `/api/intervenants/${F.luc}`, { actif: false }],
    ["POST", `/api/sessions/${F.s1}/intervenants`, { intervenant_id: F.luc }], ["DELETE", `/api/sessions/${F.s1}/intervenants/${F.luc}`]]) {
    assert.equal((await api(m2, ch, b, C())).statut, 403, `${m2} ${ch}`);
  }
  assert.equal((await api("GET", "/api/intervenants")).statut, 401);
});

test("listes et recherche ; projection contributeur (ni e-mail, ni nature, ni formations, ni historique)", async () => {
  const tous = ok(await api("GET", "/api/intervenants", undefined, A()));
  assert.deepEqual(tous.intervenants.map((i) => `${i.prenom} ${i.nom}`), ["Luc Abel", "Ana Appui", "Rémi Handi", "Zoé Martin", "Zoé Martin"]);
  assert.equal(ok(await api("GET", "/api/intervenants?q=zoe.martin", undefined, A())).total, 1, "admin : recherche par e-mail");
  assert.equal(ok(await api("GET", "/api/intervenants?q=Luc%20Abel", undefined, A())).total, 1, "recherche « Prénom Nom »");
  assert.equal(ok(await api("GET", "/api/intervenants?fonction=formateur", undefined, A())).total, 3);
  assert.equal(ok(await api("GET", "/api/intervenants?nature=salarie", undefined, A())).total, 3);
  assert.equal((await api("GET", "/api/intervenants?fonction=directeur", undefined, A())).statut, 400);
  const c = ok(await api("GET", "/api/intervenants", undefined, C()));
  assert.equal(c.total, 5);
  for (const i of c.intervenants) assert.deepEqual(Object.keys(i).sort(), ["actif", "civilite", "domaines", "fonction", "id", "nom", "prenom"]);
  assert.equal(ok(await api("GET", "/api/intervenants?q=zoe.martin", undefined, C())).total, 0, "contributeur : aucune recherche par e-mail");
  const d = ok(await api("GET", `/api/intervenants/${F.zoe}`, undefined, C()));
  assert.ok(!("sessions" in d) && !("email" in d.intervenant) && !("nature" in d.intervenant));
});

test("rattachements : plusieurs intervenants par session, une personne sur plusieurs sessions et groupes, cohérence groupe ↔ session, doublons refusés", async () => {
  ok(await api("POST", `/api/sessions/${F.s1}/intervenants`, { intervenant_id: F.zoe }, A()));
  const r = ok(await api("POST", `/api/sessions/${F.s1}/intervenants`, { intervenant_id: F.luc }, A()));
  assert.deepEqual(r.session.map((i) => i.nom), ["Abel", "Martin"]);
  ok(await api("POST", `/api/sessions/${F.s2}/intervenants`, { intervenant_id: F.zoe }, A()));
  ok(await api("POST", `/api/sessions/${F.s1}/groupes/${F.g1}/intervenants`, { intervenant_id: F.zoe }, A()));
  const g = ok(await api("POST", `/api/sessions/${F.s1}/groupes/${F.g2}/intervenants`, { intervenant_id: F.zoe }, A()));
  assert.deepEqual([g.groupes[F.g1].map((i) => i.id), g.groupes[F.g2].map((i) => i.id)], [[F.zoe], [F.zoe]]);
  ok(await api("POST", `/api/sessions/${F.s1}/intervenants`, { intervenant_id: F.ana }, A()));
  assert.equal((await api("POST", `/api/sessions/${F.s1}/intervenants`, { intervenant_id: F.zoe }, A())).statut, 409, "doublon");
  assert.equal((await api("POST", `/api/sessions/${F.s1}/groupes/${F.g1}/intervenants`, { intervenant_id: F.zoe }, A())).statut, 409);
  assert.equal((await api("POST", `/api/sessions/${F.s1}/groupes/${F.gAutre}/intervenants`, { intervenant_id: F.luc }, A())).statut, 404, "groupe d'une autre session");
  assert.equal((await api("POST", `/api/sessions/${F.s1}/intervenants`, { intervenant_id: 999999 }, A())).statut, 404);
  assert.equal((await api("POST", `/api/sessions/${F.s1}/intervenants`, {}, A())).statut, 400);
  await pool.query("UPDATE sessions SET archivee_le = now() WHERE id = $1", [F.arch]);
  assert.equal((await api("POST", `/api/sessions/${F.arch}/intervenants`, { intervenant_id: F.luc }, A())).statut, 409, "session archivée");
  const h = ok(await api("GET", `/api/intervenants/${F.zoe}`, undefined, A()));
  assert.deepEqual(h.sessions.map((s) => [s.reference, s.groupes]), [["APH-1", []], ["ADVF-1", ["Soula", "Tonate"]]]);
});

test("textes historiques conservés ; détail de session et réponses contributeur limitées", async () => {
  const { rows: [s] } = await pool.query("SELECT formateur FROM sessions WHERE id = $1", [F.s1]);
  const { rows: [g] } = await pool.query("SELECT formateur FROM groupes WHERE id = $1", [F.g1]);
  assert.deepEqual([s.formateur, g.formateur], ["M. Durand", "Mme Lopez"], "aucune réécriture des anciens formateurs");
  const a = ok(await api("GET", `/api/sessions/${F.s1}/intervenants`, undefined, A()));
  assert.deepEqual(a.historique, { session: "M. Durand", groupes: [{ id: F.g1, nom: "Soula", formateur: "Mme Lopez" }, { id: F.g2, nom: "Tonate", formateur: null }] });
  assert.equal(a.session.find((i) => i.id === F.zoe).email, "zoe.martin@a2c.fictif");
  const c = ok(await api("GET", `/api/sessions/${F.s1}/intervenants`, undefined, C()));
  assert.ok(!JSON.stringify(c).includes("@a2c.fictif") && !JSON.stringify(c).includes("\"nature\""), "contributeur : ni e-mail ni nature");
  assert.deepEqual(c.session.map((i) => i.nom), ["Abel", "Appui", "Martin"]);
  // Le détail de session existant reste inchangé.
  const d = ok(await api("GET", `/api/sessions/${F.s1}`, undefined, A()));
  assert.equal(d.session.formateur, "M. Durand");
});

test("documents : contexte de génération — groupe rattaché, session rattachée (appui exclu), session jamais rattachée inchangée", async () => {
  const ctxG1 = await contexteGeneration(F.s1, F.g1);
  assert.equal(valeursMarqueurs(ctxG1).formateur, "Zoé Martin", "groupe rattaché : nom confirmé");
  const ctxS1 = await contexteGeneration(F.s1, null);
  assert.equal(valeursMarqueurs(ctxS1).formateur, "Luc Abel et Zoé Martin", "plusieurs formateurs ; Ana (appui) exclue");
  const ctxArch = await contexteGeneration(F.arch, null);
  assert.equal(valeursMarqueurs(ctxArch).formateur, "", "jamais rattachée, sans texte : vide comme avant");
  await pool.query("UPDATE sessions SET formateur = 'Mme Historique' WHERE id = $1", [F.arch]);
  assert.equal(valeursMarqueurs(await contexteGeneration(F.arch, null)).formateur, "Mme Historique", "jamais rattachée : texte historique");
});

test("désactivation sans perte d'historique ; réactivation ; nouveau rattachement refusé tant qu'inactif ; aucune suppression", async () => {
  ok(await api("PATCH", `/api/intervenants/${F.zoe}`, { actif: false }, A()));
  assert.equal(ok(await api("GET", "/api/intervenants?actif=true", undefined, A())).intervenants.some((i) => i.id === F.zoe), false);
  const h = ok(await api("GET", `/api/intervenants/${F.zoe}`, undefined, A()));
  assert.equal(h.sessions.length, 2, "historique conservé");
  assert.equal(valeursMarqueurs(await contexteGeneration(F.s1, F.g1)).formateur, "Zoé Martin", "documents : l'intervenant historique reste");
  const { rows: [g3] } = await pool.query("INSERT INTO groupes (session_id, nom) VALUES ($1, 'Macouria') RETURNING id", [F.s1]);
  assert.equal((await api("POST", `/api/sessions/${F.s1}/groupes/${g3.id}/intervenants`, { intervenant_id: F.zoe }, A())).statut, 400, "inactif : pas de nouveau rattachement");
  ok(await api("PATCH", `/api/intervenants/${F.zoe}`, { actif: true }, A()));
  ok(await api("POST", `/api/sessions/${F.s1}/groupes/${g3.id}/intervenants`, { intervenant_id: F.zoe }, A()));
  assert.equal((await api("DELETE", `/api/intervenants/${F.zoe}`, undefined, A())).statut, 404, "aucune route de suppression");
  await assert.rejects(pool.query("DELETE FROM intervenants WHERE id = $1", [F.zoe]), "une personne déjà rattachée ne peut pas être supprimée");
  // Retrait explicite d'un rattachement par l'admin (correction) : la fiche reste.
  ok(await api("DELETE", `/api/sessions/${F.s1}/intervenants/${F.ana}`, undefined, A()));
  assert.equal((await api("DELETE", `/api/sessions/${F.s1}/intervenants/${F.ana}`, undefined, A())).statut, 404);
  assert.equal((await pool.query("SELECT count(*)::int n FROM intervenants WHERE id = $1", [F.ana])).rows[0].n, 1);
});

test("une session avec des intervenants rattachés n'est pas supprimable (aucune perte d'historique par cascade)", async () => {
  const vide = ok(await api("POST", "/api/sessions", { formation_id: F.f1, reference: "VIDE-1", date_debut: "2026-11-01", date_fin: "2026-11-30" }, A())).session.id;
  ok(await api("POST", `/api/sessions/${vide}/intervenants`, { intervenant_id: F.luc }, A()));
  const r = await api("DELETE", `/api/sessions/${vide}`, undefined, A());
  assert.equal(r.statut, 409);
  assert.match(r.corps.error, /ne peut pas être supprimée/);
  assert.equal((await pool.query("SELECT count(*)::int n FROM intervenants_sessions WHERE session_id = $1", [vide])).rows[0].n, 1);
  ok(await api("DELETE", `/api/sessions/${vide}/intervenants/${F.luc}`, undefined, A()));
  assert.ok((await api("DELETE", `/api/sessions/${vide}`, undefined, A())).statut < 300, "sans rattachement : suppression exceptionnelle possible comme avant");
});
