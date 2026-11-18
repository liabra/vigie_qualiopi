// ─────────────────────────────────────────────────────────────
//  Vigie 2.0 : comptes et auditeur, registres (tâches, risques, partenaires, ressources), échéancier,
//  préparation d'audit et export, portail auditeur, enquêtes en ligne, RGPD. PostgreSQL réel, Drive SIMULÉ, données FICTIVES.
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

const PORT = 55510;
const DATA = path.join(os.tmpdir(), "vq-vigie20-" + process.pid);

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
  const lien = `MODELE_V20_${String(++numero).padStart(6, "0")}`;
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


import zlib from "node:zlib";
const U = (id) => ({ cookie: cookie(id) });
let contribId, auditeurId;

test("comptes : création, auditeur limité dans le temps, garde-fous sur soi-même et le dernier administrateur", async () => {
  const fin = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  assert.equal((await api("POST", "/api/comptes", { email: "pas-une-adresse", role: "contributeur" }, A())).statut, 400);
  assert.equal((await api("POST", "/api/comptes", { email: "audit@exemple.test", role: "auditeur" }, A())).statut, 400, "auditeur sans date de fin");
  assert.equal((await api("POST", "/api/comptes", { email: "audit@exemple.test", role: "auditeur", expire_le: "2099-01-01" }, A())).statut, 400, "plus de 90 jours");
  auditeurId = ok(await api("POST", "/api/comptes", { email: "Audit@Exemple.test", role: "auditeur", expire_le: fin, nom: "Auditeur Test" }, A()), 201).compte.id;
  contribId = ok(await api("POST", "/api/comptes", { email: "contrib@exemple.test", role: "contributeur" }, A()), 201).compte.id;
  assert.equal((await api("POST", "/api/comptes", { email: "audit@exemple.test", role: "contributeur" }, A())).statut, 409, "adresse en double (casse ignorée)");
  assert.equal((await api("PATCH", `/api/comptes/${adminId}`, { role: "contributeur" }, A())).statut, 400, "jamais se retirer ses droits");
  assert.equal((await api("GET", "/api/comptes", undefined, U(contribId))).statut, 403);
  const journal = ok(await api("GET", "/api/journal-securite", undefined, A())).evenements;
  assert.ok(journal.some((e) => e.evenement === "compte_cree"));
});

test("auditeur : seul le portail d'audit est accessible ; compte expiré = plus de session", async () => {
  assert.equal((await api("GET", "/api/me", undefined, U(auditeurId))).statut, 200);
  for (const chemin of ["/api/sessions", "/api/preuves", "/api/registres/taches", "/api/formations", `/api/sessions/${F.session}/stagiaires`]) {
    assert.equal((await api("GET", chemin, undefined, U(auditeurId))).statut, 403, chemin);
  }
  assert.equal((await api("POST", "/api/portail-audit/campagnes", {}, U(auditeurId))).statut, 403, "écriture refusée");
  assert.equal((await api("GET", "/api/portail-audit/campagnes", undefined, U(auditeurId))).statut, 200);
  assert.equal((await api("GET", "/api/portail-audit/campagnes", undefined, U(contribId))).statut, 403, "contributeur : pas de portail");
  const expire = (await pool.query("INSERT INTO utilisateurs (email, role, expire_le) VALUES ('vieux@exemple.test', 'auditeur', CURRENT_DATE - 1) RETURNING id")).rows[0].id;
  assert.equal((await api("GET", "/api/me", undefined, U(expire))).corps?.user ?? null, null, "session refusée après expiration");
});

test("registres : tâches (validation, récurrence, droits contributeur), risques (criticité), partenaires, ressources", async () => {
  assert.equal((await api("POST", "/api/registres/inconnu", { titre: "x" }, A())).statut, 404);
  for (const nom of ["__proto__", "constructor", "toString"]) assert.equal((await api("GET", `/api/registres/${nom}`, undefined, A())).statut, 404, nom);
  assert.equal((await api("POST", "/api/registres/taches", {}, A())).statut, 400, "intitulé obligatoire");
  assert.equal((await api("POST", "/api/registres/taches", { titre: "x", echeance: "31/12/2026" }, A())).statut, 400);
  assert.equal((await api("POST", "/api/registres/taches", { titre: "x", indicateurs: [999] }, A())).statut, 400);
  assert.equal((await api("POST", "/api/registres/taches", { titre: "x", responsable_id: 99999 }, A())).statut, 400, "responsable inexistant");
  const t = ok(await api("POST", "/api/registres/taches", { titre: "Revue des preuves", echeance: "2027-01-31", recurrence: "mensuelle", indicateurs: [1, 2], responsable_id: contribId }, U(contribId)), 201).fiche;
  assert.deepEqual([t.statut, t.priorite, t.indicateurs, t.responsable_nom], ["a_faire", "normale", [1, 2], null]);
  const fait = ok(await api("PATCH", `/api/registres/taches/${t.id}`, { statut: "faite" }, U(contribId)));
  assert.ok(fait.suivante_id, "tâche suivante créée");
  assert.equal(fait.fiche.faite_le, new Date().toISOString().slice(0, 10));
  const { rows: [s] } = await pool.query("SELECT echeance, statut, precedente_id FROM taches_qualite WHERE id = $1", [fait.suivante_id]);
  assert.deepEqual([s.echeance, s.statut, s.precedente_id], ["2027-02-28", "a_faire", t.id], "fin de mois respectée");
  ok(await api("PATCH", `/api/registres/taches/${t.id}`, { statut: "en_cours" }, U(contribId)));
  ok(await api("PATCH", `/api/registres/taches/${t.id}`, { statut: "faite" }, U(contribId)));
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM taches_qualite WHERE precedente_id = $1", [t.id])).rows[0].n, 1, "jamais deux suivantes");
  const detail = ok(await api("GET", `/api/registres/taches/${t.id}`, undefined, A()));
  assert.ok(detail.historique.some((h) => h.champ === "statut"), "historique des changements");
  assert.equal((await api("POST", "/api/registres/risques", { titre: "Formateur indisponible" }, U(contribId))).statut, 403, "risques : administrateur");
  const r = ok(await api("POST", "/api/registres/risques", { titre: "Formateur indisponible", probabilite: 3, impact: 4, domaine: "humain" }, A()), 201).fiche;
  assert.equal(r.criticite, 12);
  assert.equal((await api("PATCH", `/api/registres/risques/${r.id}`, { probabilite: 5 }, A())).statut, 400);
  assert.equal((await api("POST", "/api/registres/partenaires", { nom: "Mission Locale", email: "x" }, A())).statut, 400);
  assert.equal((await api("POST", "/api/registres/ressources", { titre: "Support", lien: "javascript:alert(1)" }, A())).statut, 400, "lien non http refusé");
  ok(await api("POST", "/api/registres/partenaires", { nom: "Mission Locale", type: "prescripteur", convention_fin: "2027-01-15" }, A()), 201);
  ok(await api("POST", "/api/registres/ressources", { titre: "Support messagerie", categorie: "support", version: "2", lien: "https://docs.google.com/document/d/abc" }, A()), 201);
  const liste = ok(await api("GET", "/api/registres/taches?statut=ouverts&responsable=moi", undefined, U(contribId)));
  assert.ok(liste.fiches.every((f) => ["a_faire", "en_cours"].includes(f.statut)));
  const schema = ok(await api("GET", "/api/registres/risques/schema", undefined, A())).schema;
  assert.ok(schema.champs.find((c) => c.nom === "criticite").lectureSeule);
  assert.ok(!JSON.stringify(schema).includes("risques_qualite"), "aucun nom de table exposé");
});

test("tâches depuis les manques : une par indicateur sans preuve, sans doublon ; échéancier consolidé", async () => {
  const premiere = ok(await api("POST", "/api/taches/depuis-manques", {}, A()));
  assert.ok(premiere.crees > 0 && premiere.crees === premiere.indicateurs_sans_preuve + premiere.preuves_a_actualiser);
  assert.equal(ok(await api("POST", "/api/taches/depuis-manques", {}, A())).crees, 0, "idempotent");
  const e = ok(await api("GET", "/api/echeancier?du=2026-11-01&au=2027-12-31", undefined, A()));
  const types = new Set(e.evenements.map((x) => x.type));
  for (const t of ["tache", "session", "partenaire"]) assert.ok(types.has(t), t);
});

test("préparation d'audit : campagne, appréciations, signaux, échantillon tracé, plan d'action, export ZIP sans donnée nominative", async () => {
  const c = ok(await api("POST", "/api/campagnes-audit", { titre: "Audit blanc 2027", type: "audit_blanc", date_audit: "2027-03-01" }, A()), 201).campagne;
  const d = ok(await api("GET", `/api/campagnes-audit/${c.id}`, undefined, A()));
  assert.ok(d.indicateurs.length >= 30);
  assert.ok(d.indicateurs[0].signaux.includes("Aucune preuve rattachée"));
  const ind = d.indicateurs[0].indicateur_id;
  assert.equal((await api("PUT", `/api/campagnes-audit/${c.id}/indicateurs/${ind}`, { appreciation: "parfait" }, A())).statut, 400);
  ok(await api("PUT", `/api/campagnes-audit/${c.id}/indicateurs/${ind}`, { appreciation: "non_conforme", observation: "Pas de preuve de diffusion" }, A()));
  ok(await api("POST", `/api/campagnes-audit/${c.id}/echantillon`, { aleatoire: true, nombre: 2 }, A()));
  const ech = ok(await api("GET", `/api/campagnes-audit/${c.id}`, undefined, A())).echantillon;
  assert.ok(ech.length >= 1 && /Tirage aléatoire du/.test(ech[0].motif));
  assert.equal(ok(await api("POST", `/api/campagnes-audit/${c.id}/taches`, {}, A())).crees, 1);
  assert.equal(ok(await api("POST", `/api/campagnes-audit/${c.id}/taches`, {}, A())).crees, 0, "sans doublon");
  const r = await fetch(origine + `/api/campagnes-audit/${c.id}/export`, { headers: A() });
  assert.equal(r.headers.get("content-type"), "application/zip");
  const zip = Buffer.from(await r.arrayBuffer());
  assert.equal(zip.readUInt32LE(0), 0x04034b50, "archive ZIP valide");
  // Premier fichier : index.html (deflate) ; aucune donnée nominative des stagiaires de test.
  const nomLong = zip.readUInt16LE(26); const taille = zip.readUInt32LE(18);
  const html = zlib.inflateRawSync(zip.subarray(30 + nomLong, 30 + nomLong + taille)).toString("utf8");
  assert.match(html, /Audit blanc 2027/);
  assert.doesNotMatch(html, /Alpha|Bravo|Charlie/, "aucun nom de stagiaire");
  assert.ok(ok(await api("GET", "/api/journal-securite", undefined, A())).evenements.some((x) => x.evenement === "export_dossier_audit"));
  // Portail : invisible tant que non partagé, puis sans appréciation interne.
  assert.equal((await api("GET", `/api/portail-audit/campagnes/${c.id}`, undefined, U(auditeurId))).statut, 404);
  ok(await api("PATCH", `/api/campagnes-audit/${c.id}`, { partage_auditeur: true }, A()));
  const vue = ok(await api("GET", `/api/portail-audit/campagnes/${c.id}`, undefined, U(auditeurId)));
  assert.ok(!JSON.stringify(vue).includes("Pas de preuve de diffusion"), "observation interne non exposée");
  assert.ok(!JSON.stringify(vue).includes("appreciation"));
  assert.equal((await api("DELETE", `/api/campagnes-audit/${c.id}`, undefined, A())).statut, 200, "supprimable en préparation");
});

test("enquêtes en ligne : modèle, lien public, validation des réponses, synthèse, questions verrouillées, clôture", async () => {
  const modeles = ok(await api("GET", "/api/enquetes/modeles", undefined, A())).modeles;
  assert.ok(modeles.some((m) => m.code === "satisfaction_chaud") && modeles.some((m) => m.code === "suivi_froid"));
  assert.equal((await api("POST", "/api/enquetes", { modele: "satisfaction_chaud", session_id: 99999 }, A())).statut, 400);
  const e = ok(await api("POST", "/api/enquetes", { modele: "satisfaction_chaud", session_id: F.session }, A()), 201).enquete;
  assert.ok(e.jeton.length >= 24 && e.active);
  assert.equal((await api("GET", "/api/public/enquetes/court")).statut, 404);
  const pub = ok(await api("GET", `/api/public/enquetes/${e.jeton}`));
  assert.ok(!JSON.stringify(pub).includes("session_id") && !JSON.stringify(pub).includes("globale"), "rien d'interne exposé");
  const [g, accueil] = pub.questions; const recommande = pub.questions.find((q) => q.type === "oui_non"); const texte = pub.questions.find((q) => q.type === "texte");
  assert.equal((await api("POST", `/api/public/enquetes/${e.jeton}/reponses`, { reponses: {} })).statut, 400, "question obligatoire");
  assert.equal((await api("POST", `/api/public/enquetes/${e.jeton}/reponses`, { reponses: { [g.id]: 7 } })).statut, 400, "note hors échelle");
  for (const [note, oui] of [[5, "oui"], [4, "oui"], [2, "non"], [2, "non"]]) {
    ok(await api("POST", `/api/public/enquetes/${e.jeton}/reponses`, { reponses: { [g.id]: note, [accueil.id]: 4, [recommande.id]: oui, [texte.id]: "Très bien" } }), 201);
  }
  const d = ok(await api("GET", `/api/enquetes/${e.id}`, undefined, A()));
  const sg = d.synthese.find((s) => s.question_id === g.id);
  assert.deepEqual([sg.reponses, sg.moyenne, sg.taux_satisfaits, sg.repartition], [4, 3.3, 50, [0, 2, 0, 1, 1]]);
  assert.equal(d.enquete.taux_reponse, 100, "4 réponses pour 4 inscrits");
  assert.ok(d.alertes.some((a) => /70 %/.test(a)), "alerte d'insatisfaction");
  const { rows: [sat] } = await pool.query("SELECT note_globale, type, inscription_id FROM satisfactions WHERE enquete_id = $1 LIMIT 1", [e.id]);
  assert.deepEqual([Number(sat.note_globale), sat.type, sat.inscription_id], [5, "a_chaud", null], "anonyme, exploitable par la synthèse");
  assert.equal((await api("PUT", `/api/enquetes/${e.id}/questions`, { questions: [{ libelle: "Q", type: "texte" }] }, A())).statut, 409);
  assert.equal((await api("DELETE", `/api/enquetes/${e.id}`, undefined, A())).statut, 409);
  ok(await api("POST", `/api/enquetes/${e.id}/tache`, {}, A()), 201);
  assert.equal((await api("POST", `/api/enquetes/${e.id}/tache`, {}, A())).statut, 409);
  ok(await api("PATCH", `/api/enquetes/${e.id}`, { ouverte: false, analyse: "Organisation à revoir : horaires." }, A()));
  assert.equal((await api("GET", `/api/public/enquetes/${e.jeton}`)).statut, 410, "close");
  const relue = ok(await api("GET", `/api/enquetes/${e.id}`, undefined, A())).enquete;
  assert.ok(relue.analysee_le && relue.analyse.startsWith("Organisation"));
  const r = await fetch(origine + `/api/enquetes/${e.id}/export`, { headers: A() });
  assert.match(await r.text(), /Très bien/);
  assert.equal((await api("POST", "/api/enquetes", { titre: "X", type: "a_chaud", session_id: F.session, questions: [{ libelle: "A", type: "texte", globale: true }] }, A())).statut, 400, "globale = échelle");
});

test("RGPD : export des données d'une personne, anonymisation confirmée et irréversible", async () => {
  const p = F.inscrits.Delta;
  const r = await fetch(origine + `/api/rgpd/personnes/${p.stagiaire_id}/export`, { headers: A() });
  const json = JSON.parse(await r.text());
  assert.equal(json.personne.nom, "Delta");
  assert.equal((await api("POST", `/api/rgpd/personnes/${p.stagiaire_id}/anonymiser`, {}, A())).statut, 400, "confirmation exigée");
  await pool.query("UPDATE sessions SET date_fin = '2020-01-10', date_debut = '2020-01-01' WHERE id = $1", [F.session]);
  ok(await api("POST", `/api/rgpd/personnes/${p.stagiaire_id}/anonymiser`, { confirmation: "ANONYMISER" }, A()));
  const { rows: [s] } = await pool.query("SELECT nom, email, anonymise_le FROM stagiaires WHERE id = $1", [p.stagiaire_id]);
  assert.deepEqual([s.nom, s.email, !!s.anonymise_le], ["Anonyme", null, true]);
  assert.equal((await api("POST", `/api/rgpd/personnes/${p.stagiaire_id}/anonymiser`, { confirmation: "ANONYMISER" }, A())).statut, 409);
  ok(await api("PUT", "/api/rgpd/duree", { annees: 3 }, A()));
  const syn = ok(await api("GET", "/api/rgpd/synthese", undefined, A()));
  assert.equal(syn.duree_conservation_annees, 3);
  assert.ok(syn.au_terme.some((x) => x.nom === "Alpha"), "session finie en 2020 : au terme");
  assert.equal(syn.anonymises, 1);
  assert.equal((await api("GET", "/api/rgpd/synthese", undefined, U(contribId))).statut, 403);
});

test("organisme : SIRET, NDA, site web et référent handicap validés et injectés dans les documents", async () => {
  assert.equal((await api("PUT", "/api/parametres/organisme", { siret: "123" }, A())).statut, 400);
  assert.equal((await api("PUT", "/api/parametres/organisme", { site_web: "javascript:x" }, A())).statut, 400);
  ok(await api("PUT", "/api/parametres/organisme", { nom: "Organisme Test", siret: "123 456 789 00010", nda: "03973000000", site_web: "https://exemple.test", referent_handicap_nom: "Lia Test", referent_handicap_email: "rh@exemple.test" }, A()));
  const m = await modele("NDA {{organisme_nda}} SIRET {{organisme_siret}} — handicap : {{referent_handicap_nom}} {{referent_handicap_email}} {{organisme_site_web}}", { portee: "session" });
  ok(await api("POST", "/api/generations", { modele_id: m, session_id: F.session }, A()));
  const [doc] = await documents(F.session, m);
  assert.equal(doc.texte, "NDA 03973000000 SIRET 123 456 789 00010 — handicap : Lia Test rh@exemple.test https://exemple.test");
});
