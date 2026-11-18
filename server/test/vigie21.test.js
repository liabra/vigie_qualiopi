// ─────────────────────────────────────────────────────────────
//  Exports PDF, développement des intervenants, candidatures en ligne, portails stagiaire et formateur. PostgreSQL réel, Drive SIMULÉ, données FICTIVES.
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

const PORT = 55511;
const DATA = path.join(os.tmpdir(), "vq-vigie21-" + process.pid);

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
  const lien = `MODELE_V21_${String(++numero).padStart(6, "0")}`;
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


const U = (id) => ({ cookie: cookie(id) });
const P = (c) => ({ cookie: c });
async function pdf(chemin, entetes = A()) {
  const r = await fetch(origine + chemin, { headers: entetes });
  const b = Buffer.from(await r.arrayBuffer());
  return { statut: r.status, type: r.headers.get("content-type"), texte: b.toString("latin1") };
}
// Ouvre une session portail avec le lien et renvoie le cookie.
async function connecterPortail(chemin) {
  const jeton = chemin.split("/").pop();
  const r = await fetch(origine + "/api/portail/connexion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jeton }) });
  return { statut: r.status, cookie: (r.headers.get("set-cookie") || "").split(";")[0], corps: await r.json() };
}
let contribId, intervenantId, autreIntervenantId, sessionB;

test("développement des intervenants : fiche compétences, actions validées, plan global et PDF", async () => {
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, role) VALUES ('c21@x.test', 'contributeur') RETURNING id"));
  intervenantId = ok(await api("POST", "/api/intervenants", { nom: "Formatrice", prenom: "Anne", email: "anne@x.test", fonction: "formateur", nature: "salarie" }, A()), 201).intervenant.id;
  ok(await api("PATCH", `/api/intervenants/${intervenantId}/competences`, { specialites: "Numérique", diplomes_certifications: "Titre FPA", besoins_developpement: "IA générative", date_dernier_entretien: "2025-06-01" }, A()));
  assert.equal((await api("POST", `/api/intervenants/${intervenantId}/developpement`, {}, A())).statut, 400, "intitulé obligatoire");
  assert.equal((await api("POST", `/api/intervenants/${intervenantId}/developpement`, { intitule: "X", date_debut: "2026-05-02", date_fin: "2026-05-01" }, A())).statut, 400);
  assert.equal((await api("POST", `/api/intervenants/${intervenantId}/developpement`, { intitule: "X", lien_preuve: "javascript:alert(1)" }, A())).statut, 400);
  assert.equal((await api("POST", `/api/intervenants/${intervenantId}/developpement`, { intitule: "X" }, U(contribId))).statut, 403);
  const a = ok(await api("POST", `/api/intervenants/${intervenantId}/developpement`, { intitule: "Formation IA en pédagogie", type: "formation", organisme: "OF Fictif", date_debut: "2026-03-01", duree_heures: 14, statut: "realisee", evaluation_efficacite: "Utilisée en atelier" }, A()), 201).action;
  ok(await api("PATCH", `/api/developpement/${a.id}`, { duree_heures: 21 }, A()));
  const plan = ok(await api("GET", "/api/developpement", undefined, A()));
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.intervenants.find((i) => i.id === intervenantId).entretien_a_faire, true, "entretien de plus d'un an");
  const p1 = await pdf(`/api/pdf/intervenants/${intervenantId}/developpement`);
  assert.equal(p1.type, "application/pdf");
  assert.ok(p1.texte.startsWith("%PDF-1.4") && p1.texte.includes("%%EOF"));
  assert.ok(p1.texte.includes("Formation IA en p\xe9dagogie"), "texte encodé WinAnsi");
  assert.equal((await pdf("/api/pdf/developpement")).statut, 200);
});

test("exports PDF : catalogue selon le rôle, registres, indicateurs, actions, réclamations sans identité, veille, session", async () => {
  const cat = ok(await api("GET", "/api/pdf/catalogue", undefined, U(contribId))).exports;
  assert.ok(cat.length && cat.every((e) => !e.admin), "le contributeur ne voit que les registres");
  ok(await api("POST", "/api/registres/risques", { titre: "Panne informatique", probabilite: 2, impact: 3, mesures: "Ordinateurs de secours" }, A()), 201);
  const r = await pdf("/api/pdf/registres/risques", U(contribId));
  assert.equal(r.statut, 200); assert.ok(r.texte.includes("Panne informatique") && r.texte.includes("Ordinateurs de secours"));
  assert.equal((await pdf("/api/pdf/registres/__proto__")).statut, 404);
  ok(await api("POST", "/api/signalements", { type: "reclamation", objet: "Horaires modifiés", reclamant_nom: "Jean Secret", reclamant_email: "secret@x.test", date_constat: "2026-11-02" }, A()), 201);
  const s = await pdf("/api/pdf/signalements");
  assert.equal(s.statut, 200); assert.ok(s.texte.includes("Horaires modifi\xe9s"));
  assert.ok(!s.texte.includes("Jean Secret") && !s.texte.includes("secret@x.test"), "identité du réclamant jamais exportée");
  for (const c of ["/api/pdf/indicateurs", "/api/pdf/actions-qualite", "/api/pdf/veille", "/api/pdf/enquetes", `/api/pdf/sessions/${F.session}/bilan`, `/api/pdf/sessions/${F.session}/assiduite`]) {
    const x = await pdf(c);
    assert.equal(x.statut, 200, c); assert.ok(x.texte.startsWith("%PDF"), c);
  }
  assert.equal((await pdf("/api/pdf/indicateurs", U(contribId))).statut, 403);
  assert.equal((await pdf("/api/pdf/sessions/99999/bilan")).statut, 404);
});

test("candidatures : formulaire public limité aux formations ouvertes, validation, piège anti-robot, consentement", async () => {
  assert.equal(ok(await api("GET", "/api/public/candidature")).formations.length, 0, "aucune formation ouverte par défaut");
  ok(await api("PATCH", `/api/formations/${F.formation}/candidature`, { candidature_ouverte: true, pieces_attendues: ["Pièce d'identité", "CV"] }, A()));
  const pub = ok(await api("GET", "/api/public/candidature"));
  assert.equal(pub.formations.length, 1);
  assert.deepEqual(pub.formations[0].pieces_attendues, ["Pièce d'identité", "CV"]);
  assert.ok(pub.formations[0].sessions.some((x) => x.id === F.session), "session à venir proposée");
  const base = { formation_id: F.formation, nom: "Candidat", prenom: "Paul", email: "paul@x.test", consentement: true, session_souhaitee_id: F.session };
  assert.equal((await api("POST", "/api/public/candidatures", { ...base, consentement: false })).statut, 400);
  assert.equal((await api("POST", "/api/public/candidatures", { ...base, email: "", telephone: "" })).statut, 400, "un moyen de contact");
  assert.equal((await api("POST", "/api/public/candidatures", { ...base, nom: "<script>" })).statut, 400);
  assert.equal((await api("POST", "/api/public/candidatures", { ...base, formation_id: 99999 })).statut, 400);
  assert.equal((await api("POST", "/api/public/candidatures", { ...base, site_web: "http://spam" })).statut, 201, "robot : réponse neutre");
  ok(await api("POST", "/api/public/candidatures", { ...base, besoins_amenagement: "Fauteuil roulant" }), 201);
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM candidatures");
  assert.equal(rows[0].n, 1, "le robot n'a rien enregistré");
});

test("candidatures : étude, pièces reçues, affectation (fiche réutilisée par e-mail), doublon refusé", async () => {
  const liste = ok(await api("GET", "/api/candidatures", undefined, A())).candidatures;
  const c = liste[0];
  assert.equal(c.statut, "nouvelle");
  assert.equal((await api("GET", "/api/candidatures", undefined, U(contribId))).statut, 403);
  assert.equal((await api("PATCH", `/api/candidatures/${c.id}`, { statut: "acceptee" }, A())).statut, 400, "acceptation = affectation");
  ok(await api("PATCH", `/api/candidatures/${c.id}`, { statut: "en_etude", pieces_recues: ["CV"], notes: "Entretien le 20/11" }, A()));
  const aff = ok(await api("POST", `/api/candidatures/${c.id}/affecter`, { session_id: F.session }, A()));
  assert.equal(aff.fiche_existante, false);
  const { rows: [st] } = await pool.query("SELECT nom, email, besoins_adaptation FROM stagiaires WHERE id = $1", [aff.stagiaire_id]);
  assert.deepEqual(st, { nom: "Candidat", email: "paul@x.test", besoins_adaptation: "Fauteuil roulant" });
  assert.equal((await api("POST", `/api/candidatures/${c.id}/affecter`, { session_id: F.session }, A())).statut, 409);
  assert.equal((await api("PATCH", `/api/candidatures/${c.id}`, { notes: "x" }, A())).statut, 409, "acceptée : figée");
  assert.equal((await api("DELETE", `/api/candidatures/${c.id}`, undefined, A())).statut, 409);
  ok(await api("POST", "/api/public/candidatures", { formation_id: F.formation, nom: "Candidat", prenom: "Paul", email: "PAUL@x.test", consentement: true }), 201);
  const c2 = ok(await api("GET", "/api/candidatures?statut=nouvelle", undefined, A())).candidatures[0];
  assert.equal((await api("POST", `/api/candidatures/${c2.id}/affecter`, { session_id: F.session }, A())).statut, 409, "déjà inscrit à cette session (même personne, e-mail en casse différente)");
});

test("portail stagiaire : lien à usage personnel, données propres seulement, documents protégés, signalement, révocation", async () => {
  const alpha = F.inscrits.Alpha; const bravo = F.inscrits.Bravo;
  assert.equal((await api("POST", "/api/acces-portail", { type: "stagiaire", stagiaire_id: alpha.stagiaire_id, duree_jours: 400 }, A())).statut, 400);
  assert.equal((await api("POST", "/api/acces-portail", { type: "stagiaire", stagiaire_id: alpha.stagiaire_id }, U(contribId))).statut, 403);
  const cree = ok(await api("POST", "/api/acces-portail", { type: "stagiaire", stagiaire_id: alpha.stagiaire_id, duree_jours: 30 }, A()), 201);
  assert.match(cree.chemin, /^\/portail\/[A-Za-z0-9_-]{43}$/);
  const { rows: [a] } = await pool.query("SELECT jeton_hash FROM acces_portail WHERE id = $1", [cree.acces.id]);
  assert.ok(!cree.chemin.includes(a.jeton_hash), "seule l'empreinte est stockée");
  assert.equal((await connecterPortail("/portail/" + "x".repeat(43))).statut, 401);
  const { cookie: c } = await connecterPortail(cree.chemin);
  assert.ok(c.startsWith("vq_portail="));
  assert.equal((await api("GET", "/api/portail/stagiaire")).statut, 401, "sans cookie");
  assert.equal((await api("GET", "/api/sessions", undefined, P(c))).statut, 401, "aucun accès à l'application interne");
  assert.equal((await api("GET", "/api/portail/formateur", undefined, P(c))).statut, 401, "pas le portail formateur");
  ok(await api("POST", "/api/enquetes", { modele: "satisfaction_chaud", session_id: F.session }, A()), 201);
  const v = ok(await api("GET", "/api/portail/stagiaire", undefined, P(c)));
  assert.equal(v.inscriptions.length, 1);
  assert.equal(v.inscriptions[0].enquetes.length, 1, "enquête ouverte proposée");
  assert.ok(!JSON.stringify(v).includes("Bravo"), "jamais les données d'un autre stagiaire");
  assert.ok(!JSON.stringify(v).includes("besoins") && !JSON.stringify(v).includes("handicap"), "jamais de donnée de santé");
  const { rows: [docBravo] } = await pool.query("INSERT INTO documents_generes (modele_id, session_id, stagiaire_id, drive_file_id, nom) SELECT id, $1, $2, 'DOC_BRAVO', 'Convocation Bravo' FROM modeles_documents LIMIT 1 RETURNING id", [F.session, bravo.stagiaire_id]).catch(() => ({ rows: [] }));
  if (docBravo) assert.equal((await api("GET", `/api/portail/stagiaire/documents/${docBravo.id}/pdf`, undefined, P(c))).statut, 404, "document d'un autre : introuvable");
  assert.equal((await api("POST", "/api/portail/stagiaire/signalement", { objet: "" }, P(c))).statut, 400);
  const sig = ok(await api("POST", "/api/portail/stagiaire/signalement", { type: "reclamation", objet: "Salle trop froide", inscription_id: alpha.id }, P(c)), 201);
  assert.match(sig.reference, /^REC-/);
  const { rows: [s] } = await pool.query("SELECT type, inscription_id, reclamant_nom, date_echeance_cible IS NOT NULL AS echeance FROM signalements_qualite WHERE reference = $1", [sig.reference]);
  assert.deepEqual(s, { type: "reclamation", inscription_id: alpha.id, reclamant_nom: "Test Alpha", echeance: true });
  assert.equal((await api("POST", "/api/portail/stagiaire/signalement", { objet: "x", inscription_id: bravo.id }, P(c))).statut, 400, "inscription d'un autre refusée");
  ok(await api("DELETE", `/api/acces-portail/${cree.acces.id}`, undefined, A()));
  assert.equal((await api("GET", "/api/portail/stagiaire", undefined, P(c))).statut, 401, "révoqué : effet immédiat");
  assert.equal((await connecterPortail(cree.chemin)).statut, 401);
  assert.ok(ok(await api("GET", "/api/journal-securite", undefined, A())).evenements.some((e) => e.evenement === "acces_portail_revoque"));
});

test("portail formateur : seulement ses sessions et groupes, saisie du suivi et des compétences, incident", async () => {
  autreIntervenantId = ok(await api("POST", "/api/intervenants", { nom: "Autre", prenom: "Bob", fonction: "formateur", nature: "salarie" }, A()), 201).intervenant.id;
  sessionB = ok(await api("POST", "/api/sessions", { formation_id: F.formation, date_debut: "2027-01-10", date_fin: "2027-01-20", reference: "B-1" }, A()), 201).session.id;
  ok(await api("POST", `/api/sessions/${sessionB}/stagiaires`, { nom: "Hors", prenom: "Perimetre" }, A()), 201);
  ok(await api("POST", `/api/sessions/${F.session}/intervenants`, { intervenant_id: intervenantId }, A()));
  ok(await api("POST", `/api/sessions/${sessionB}/intervenants`, { intervenant_id: autreIntervenantId }, A()));
  await pool.query("UPDATE formation_versions SET competences = ARRAY['AT01 allumer un PC'] WHERE formation_id = $1", [F.formation]);
  const { rows: [seA] } = await pool.query("INSERT INTO seances (session_id, date_seance, heure_debut, heure_fin, theme) VALUES ($1, '2026-12-02', '09:00', '12:00', 'Messagerie') RETURNING id", [F.session]);
  const { rows: [seB] } = await pool.query("INSERT INTO seances (session_id, date_seance, heure_debut, heure_fin, theme) VALUES ($1, '2027-01-11', '09:00', '12:00', 'Hors') RETURNING id", [sessionB]);
  const cree = ok(await api("POST", "/api/acces-portail", { type: "formateur", intervenant_id: intervenantId }, A()), 201);
  const { cookie: c } = await connecterPortail(cree.chemin);
  assert.equal((await api("GET", "/api/portail/stagiaire", undefined, P(c))).statut, 401);
  const v = ok(await api("GET", "/api/portail/formateur", undefined, P(c)));
  assert.deepEqual(v.sessions.map((s) => s.id), [F.session], "seulement sa session");
  assert.ok(!JSON.stringify(v).includes("Perimetre"));
  const alpha = F.inscrits.Alpha;
  assert.equal((await api("GET", `/api/portail/formateur/seances/${seB.id}`, undefined, P(c))).statut, 404, "séance d'une autre session");
  const sea = ok(await api("GET", `/api/portail/formateur/seances/${seA.id}`, undefined, P(c)));
  assert.ok(sea.suivis.some((x) => x.inscription_id === alpha.id));
  ok(await api("PUT", `/api/portail/formateur/seances/${seA.id}/suivi/${alpha.id}`, { observations: "Très investie", difficultes: "" }, P(c)));
  const { rows: [su] } = await pool.query("SELECT observations, difficultes FROM suivi_seance WHERE seance_id = $1 AND inscription_id = $2", [seA.id, alpha.id]);
  assert.deepEqual(su, { observations: "Très investie", difficultes: null });
  const { rows: [horsInsc] } = await pool.query("SELECT id FROM inscriptions WHERE session_id = $1", [sessionB]);
  assert.equal((await api("PUT", `/api/portail/formateur/seances/${seA.id}/suivi/${horsInsc.id}`, { observations: "x" }, P(c))).statut, 404);
  assert.equal((await api("PUT", `/api/portail/formateur/competences/${horsInsc.id}`, { competences: [] }, P(c))).statut, 404, "stagiaire hors périmètre");
  ok(await api("PUT", `/api/portail/formateur/competences/${alpha.id}`, { competences: [{ competence: "AT01 allumer un PC", statut: "acquis" }] }, P(c)));
  assert.equal((await pool.query("SELECT statut FROM competences_stagiaires WHERE inscription_id = $1", [alpha.id])).rows[0].statut, "acquis");
  assert.equal((await api("POST", "/api/portail/formateur/incident", { objet: "Vidéoprojecteur en panne", session_id: sessionB }, P(c))).statut, 400, "session d'un autre formateur");
  const inc = ok(await api("POST", "/api/portail/formateur/incident", { objet: "Vidéoprojecteur en panne", session_id: F.session }, P(c)), 201);
  assert.match(inc.reference, /^INC-/);
  await pool.query("UPDATE acces_portail SET expire_le = CURRENT_DATE - 1 WHERE id = $1", [cree.acces.id]);
  assert.equal((await api("GET", "/api/portail/formateur", undefined, P(c))).statut, 401, "expiré");
});
