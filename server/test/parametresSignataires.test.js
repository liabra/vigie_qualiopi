// ─────────────────────────────────────────────────────────────
//  Paramètres de l'organisme et signataires : routes réelles, PostgreSQL réel, Drive SIMULÉ.
//  Droits, validation, désactivation d'un signataire utilisé, choix du signataire par modèle
//  (fixe / formateur concerné) et rendu réel dans les documents générés.
//  Données FICTIVES uniquement.
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
import { signatairePour, validerOrganisme, validerSignataire } from "../src/services/parametresOrganisme.js";
import { initialiserParametres } from "../src/services/parametresInitiaux.js";
import { clientDriveSimule as simulateur } from "./helpers/genererDrive.js";

const PORT = 55494;
const DATA = path.join(os.tmpdir(), "vq-parametres-signataires-" + process.pid);
const MODELE = "Signé : {{signataire_fonction}} {{signataire_nom}} — {{organisme_nom}}, {{organisme_adresse_ligne1}} {{organisme_code_postal}} {{organisme_ville}} — tél {{organisme_telephone}} / {{organisme_mobile}} — {{organisme_email}} — pour {{stagiaire_nom}}";

let cluster, pool, serveur, origine, adminId, contribId, formationId;
const F = {};
let numero = 0;

const cookie = (uid) => "vq_session=" + encode({ uid, exp: Date.now() + 60_000 });
const A = () => ({ cookie: cookie(adminId) });
const C = () => ({ cookie: cookie(contribId) });
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
// Drive simulé : tous les modèles de ce fichier lisent le même texte.
function drive() {
  const s = simulateur({ modeleTexte: MODELE });
  const lire = s.client.docs.documents.get;
  s.client.docs.documents.get = ({ documentId, ...reste }) => lire({ documentId: documentId.startsWith("MODELE_SIGN_") ? "MODELE" : documentId, ...reste });
  return s;
}
const nouveauModele = (extra = {}) => ({
  nom: `Document signé ${++numero}`, lien: `MODELE_SIGN_${String(numero).padStart(4, "0")}`, portee: "stagiaire", type_document: "autre",
  mode_generation: "manuel", indicateurs: [11], ...extra,
});
async function sessionAvecStagiaires(reference, stagiaires) {
  const session = ok(await api("POST", "/api/sessions", { formation_id: formationId, date_debut: "2026-12-01", date_fin: "2026-12-05", reference }, A())).session.id;
  const groupes = {};
  for (const nom of new Set(stagiaires.map((s) => s.groupe).filter(Boolean))) {
    groupes[nom] = ok(await api("POST", `/api/sessions/${session}/groupes`, { nom }, A())).groupe.id;
  }
  const inscriptions = [];
  for (const s of stagiaires) {
    inscriptions.push(ok(await api("POST", `/api/sessions/${session}/stagiaires`, { nom: s.nom, prenom: "Test", groupe_id: s.groupe ? groupes[s.groupe] : undefined }, A())).inscription);
  }
  return { session, groupes, inscriptions };
}
async function contenuGenere(trace, sessionId, modeleId) {
  const { rows } = await pool.query("SELECT drive_file_id, stagiaire_id FROM documents_generes WHERE session_id = $1 AND modele_id = $2 ORDER BY stagiaire_id", [sessionId, modeleId]);
  return rows.map((r) => trace.contenuCopies.get(r.drive_file_id));
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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@sg.local', 'Admin Test', 'admin') RETURNING id"));
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@sg.local', 'Contrib Test', 'contributeur') RETURNING id"));
  ({ rows: [{ id: formationId }] } = await pool.query("INSERT INTO formations (intitule, code_interne) VALUES ('Atelier fictif', 'SG-1') RETURNING id"));
  await pool.query("INSERT INTO formation_versions (formation_id, numero, duree_heures_defaut) VALUES ($1, 1, 21)", [formationId]);
  serveur = createApp().listen(0, "127.0.0.1");
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
  F.drive = drive();
  setDriveFactory(() => F.drive.client);
});

after(async () => {
  setDriveFactory(null);
  setPoolFactory(null);
  setQueryExecutor(null);
  if (serveur) await new Promise((r) => serveur.close(r));
  if (pool) await pool.end().catch(() => {});
  if (cluster) await cluster.stop().catch(() => {});
});

test("validation pure : coordonnées, balises refusées, signataire", () => {
  assert.deepEqual(validerOrganisme({ telephone: " 05 94 00 00 00 ", email: "contact@exemple.fr" }).valeur, { telephone: "05 94 00 00 00", email: "contact@exemple.fr" });
  assert.deepEqual(validerOrganisme({ ville: "" }).valeur, { ville: null }, "vide = effacé");
  for (const mauvais of [{ telephone: "abc" }, { email: "pas-un-mail" }, { ville: "{{stagiaire_nom}}" }, { nom: "x".repeat(201) }, { adresse_ligne1: 5 }, {}]) {
    assert.ok(validerOrganisme(mauvais).erreur, JSON.stringify(mauvais));
  }
  assert.ok(validerSignataire({ nom: "A", fonction: "" }, { complet: true }).erreur);
  assert.ok(validerSignataire({ nom: "<b>x</b>", fonction: "F" }, { complet: true }).erreur);
  assert.deepEqual(validerSignataire({ actif: false }, { complet: false }).valeur, { actif: false });
});

test("signatairePour : fixe, formateur du groupe puis du groupe visé puis de la session, aucun", () => {
  const f = (nom, fonction = "formateur") => ({ civilite: "Mme", prenom: "Zoé", nom, fonction });
  const ctx = {
    signataireFixe: { nom: "Présidente Test", fonction: "Présidente" },
    formateursParGroupe: new Map([[5, [f("Bravo")]]]), formateursGroupe: [f("Charlie")], formateursSession: [f("Delta"), f("Echo")],
  };
  assert.deepEqual(signatairePour({ signataire_mode: "fixe" }, ctx), { nom: "Présidente Test", fonction: "Présidente" });
  assert.equal(signatairePour({ signataire_mode: "aucun" }, ctx), null);
  assert.equal(signatairePour({ signataire_mode: "formateur" }, ctx, { groupe_id: 5 }).nom, "Mme Zoé Bravo");
  assert.equal(signatairePour({ signataire_mode: "formateur" }, ctx, { groupe_id: 9 }).nom, "Mme Zoé Charlie");
  assert.equal(signatairePour({ signataire_mode: "formateur" }, { ...ctx, formateursGroupe: [] }, null).nom, "Mme Zoé Delta", "premier par ordre alphabétique");
  assert.equal(signatairePour({ signataire_mode: "formateur" }, { formateursSession: [] }), null);
  assert.equal(signatairePour({ signataire_mode: "formateur" }, { formateursSession: [f("Delta", "appui")] }).fonction, "Appui");
});

test("droits : paramètres et signataires réservés à l'administrateur", async () => {
  for (const [m, c, corps] of [["GET", "/api/parametres/organisme"], ["PUT", "/api/parametres/organisme", { ville: "X" }], ["GET", "/api/signataires"], ["POST", "/api/signataires", { nom: "A", fonction: "B" }], ["PATCH", "/api/signataires/1", { actif: false }]]) {
    assert.equal((await api(m, c, corps, C())).statut, 403, `${m} ${c} contributeur`);
    assert.equal((await api(m, c, corps)).statut, 401, `${m} ${c} anonyme`);
  }
});

test("organisme : table vide au départ, enregistrement partiel, effacement, validation", async () => {
  const vide = ok(await api("GET", "/api/parametres/organisme", undefined, A())).organisme;
  assert.deepEqual([vide.nom, vide.telephone, vide.mobile], [null, null, null]);
  assert.equal((await api("PUT", "/api/parametres/organisme", { telephone: "pas un numéro" }, A())).statut, 400);
  assert.equal((await api("PUT", "/api/parametres/organisme", { ville: "{{organisme_nom}}" }, A())).statut, 400);
  assert.equal((await api("PUT", "/api/parametres/organisme", {}, A())).statut, 400);
  const p = ok(await api("PUT", "/api/parametres/organisme", {
    nom: "Association Fictive", adresse_ligne1: "1 rue des Exemples", adresse_ligne2: "Cité Fictive", code_postal: "97300", ville: "Cayenne",
    telephone: "05 94 00 00 01", mobile: "06 94 00 00 02", email: "contact@fictif.example",
  }, A())).organisme;
  assert.equal(p.mobile, "06 94 00 00 02");
  ok(await api("PUT", "/api/parametres/organisme", { adresse_ligne2: "" }, A()));
  const relu = ok(await api("GET", "/api/parametres/organisme", undefined, A())).organisme;
  assert.deepEqual([relu.adresse_ligne2, relu.ville], [null, "Cayenne"], "champ vidé, autres inchangés");
  const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM parametres_organisme");
  assert.equal(n, 1, "une seule ligne de paramètres");
});

test("signataires : création, doublon refusé, modification, désactivation", async () => {
  F.presidente = ok(await api("POST", "/api/signataires", { nom: "Marie Fictive", fonction: "Présidente" }, A()), 201).signataire.id;
  F.referente = ok(await api("POST", "/api/signataires", { nom: "Lia Fictive", fonction: "Référente Qualiopi" }, A()), 201).signataire.id;
  assert.equal((await api("POST", "/api/signataires", { nom: " marie fictive ", fonction: "présidente" }, A())).statut, 409, "doublon (casse ignorée)");
  assert.equal((await api("POST", "/api/signataires", { nom: "", fonction: "X" }, A())).statut, 400);
  ok(await api("PATCH", `/api/signataires/${F.referente}`, { fonction: "Référente Qualiopi A2C" }, A()));
  F.temporaire = ok(await api("POST", "/api/signataires", { nom: "Temp Fictif", fonction: "Intérim" }, A()), 201).signataire.id;
  ok(await api("PATCH", `/api/signataires/${F.temporaire}`, { actif: false }, A()));
  const actifs = ok(await api("GET", "/api/signataires", undefined, A())).signataires.map((s) => s.nom);
  assert.deepEqual(actifs.sort(), ["Lia Fictive", "Marie Fictive"], "le désactivé n'est plus proposé");
  assert.equal((await api("PATCH", "/api/signataires/999999", { fonction: "X" }, A())).statut, 404);
});

test("modèle : mode de signataire contrôlé (fixe exige un signataire actif, autre mode n'en admet pas)", async () => {
  assert.equal((await api("POST", "/api/modeles", nouveauModele({ signataire_mode: "fixe" }), A())).statut, 400, "fixe sans signataire");
  assert.equal((await api("POST", "/api/modeles", nouveauModele({ signataire_mode: "fixe", signataire_id: F.temporaire }), A())).statut, 400, "signataire désactivé");
  assert.equal((await api("POST", "/api/modeles", nouveauModele({ signataire_mode: "fixe", signataire_id: 999999 }), A())).statut, 400, "signataire inconnu");
  assert.equal((await api("POST", "/api/modeles", nouveauModele({ signataire_mode: "formateur", signataire_id: F.presidente }), A())).statut, 400, "identifiant interdit hors mode fixe");
  assert.equal((await api("POST", "/api/modeles", nouveauModele({ signataire_mode: "inconnu" }), A())).statut, 400);
  const defaut = ok(await api("POST", "/api/modeles", nouveauModele(), A()), 201).modele;
  assert.deepEqual([defaut.signataire_mode, defaut.signataire_id], ["aucun", null], "comportement historique par défaut");
  F.fixe = ok(await api("POST", "/api/modeles", nouveauModele({ signataire_mode: "fixe", signataire_id: F.presidente }), A()), 201).modele.id;
  F.formateur = ok(await api("POST", "/api/modeles", nouveauModele({ signataire_mode: "formateur" }), A()), 201).modele.id;
  const m = ok(await api("PATCH", `/api/modeles/${F.formateur}`, { signataire_mode: "fixe", signataire_id: F.referente }, A())).modele;
  assert.equal(m.signataire_id, F.referente);
  const retour = ok(await api("PATCH", `/api/modeles/${F.formateur}`, { signataire_mode: "formateur" }, A())).modele;
  assert.deepEqual([retour.signataire_mode, retour.signataire_id], ["formateur", null], "identifiant retiré avec le mode");
});

test("désactiver un signataire utilisé par un modèle actif est refusé, avec les modèles cités", async () => {
  const r = await api("PATCH", `/api/signataires/${F.presidente}`, { actif: false }, A());
  assert.equal(r.statut, 409);
  assert.equal(r.corps.code, "signataire_utilise");
  assert.match(r.corps.error, /Document signé/);
});

test("génération : signataire fixe et coordonnées de l'organisme dans le document", async () => {
  const { session } = await sessionAvecStagiaires("SG-FIXE", [{ nom: "Alpha" }]);
  ok(await api("POST", "/api/generations", { modele_id: F.fixe, session_id: session }, A()));
  const [contenu] = await contenuGenere(F.drive.trace, session, F.fixe);
  assert.equal(contenu, "Signé : Présidente Marie Fictive — Association Fictive, 1 rue des Exemples 97300 Cayenne — tél 05 94 00 00 01 / 06 94 00 00 02 — contact@fictif.example — pour Alpha");
});

test("génération : formateur concerné = celui du groupe du stagiaire, repli session, jamais d'invention", async () => {
  const { session, groupes } = await sessionAvecStagiaires("SG-FORM", [{ nom: "Alpha", groupe: "Soula" }, { nom: "Bravo", groupe: "Tonate" }, { nom: "Charlie" }]);
  const intervenant = async (nom, fonction = "formateur") => ok(await api("POST", "/api/intervenants", { civilite: "Mme", nom, prenom: "Zoé", fonction, nature: "salarie" }, A()), 201).intervenant.id;
  const soula = await intervenant("Formsoula");
  const session1 = await intervenant("Formsession");
  ok(await api("POST", `/api/sessions/${session}/groupes/${groupes.Soula}/intervenants`, { intervenant_id: soula }, A()), 201);
  ok(await api("POST", `/api/sessions/${session}/intervenants`, { intervenant_id: session1 }, A()), 201);

  ok(await api("POST", "/api/generations", { modele_id: F.formateur, session_id: session }, A()));
  const contenus = await contenuGenere(F.drive.trace, session, F.formateur);
  const parStagiaire = Object.fromEntries(contenus.map((c) => [/pour (\w+)$/.exec(c)[1], /Signé : (.*?) — /.exec(c)[1]]));
  assert.equal(parStagiaire.Alpha, "Formateur Mme Zoé Formsoula", "groupe Soula");
  assert.equal(parStagiaire.Bravo, "Formateur Mme Zoé Formsession", "groupe Tonate sans formateur : repli sur la session");
  assert.equal(parStagiaire.Charlie, "Formateur Mme Zoé Formsession", "sans groupe : formateur de la session");

  // Session sans aucun formateur : document généré, signataire vide, aucune valeur inventée.
  const sans = await sessionAvecStagiaires("SG-VIDE", [{ nom: "Delta" }]);
  ok(await api("POST", "/api/generations", { modele_id: F.formateur, session_id: sans.session }, A()));
  const [c] = await contenuGenere(F.drive.trace, sans.session, F.formateur);
  assert.match(c, /^Signé :\s+— Association Fictive/);
});

test("génération : modèle sans signataire ni paramètres saisis → blancs, nom de l'organisme de repli", async () => {
  await pool.query("UPDATE parametres_organisme SET nom = NULL, adresse_ligne1 = NULL, code_postal = NULL, ville = NULL, telephone = NULL, mobile = NULL, email = NULL WHERE id = 1");
  const aucun = ok(await api("POST", "/api/modeles", nouveauModele(), A()), 201).modele.id;
  const { session } = await sessionAvecStagiaires("SG-AUCUN", [{ nom: "Echo" }]);
  ok(await api("POST", "/api/generations", { modele_id: aucun, session_id: session }, A()));
  const [c] = await contenuGenere(F.drive.trace, session, aucun);
  assert.equal(c.replace(/\s+/g, " "), "Signé : — A2C, — tél / — — pour Echo", "blancs partout, nom de repli = configuration");
});

test("initialisation depuis un fichier : renseigne les champs vides, ne remplace rien, ne recrée pas les signataires", async () => {
  await pool.query("UPDATE parametres_organisme SET nom = NULL, telephone = NULL, mobile = '06 94 99 99 99', ville = NULL WHERE id = 1");
  const donnees = { organisme: { nom: "Association Initiale", telephone: "05 94 00 00 03", mobile: "06 94 00 00 04", ville: "Cayenne" }, signataires: [{ nom: "Marie Fictive", fonction: "Présidente" }, { nom: "Nouveau Fictif", fonction: "Formateur" }] };
  const b = await initialiserParametres(donnees);
  assert.deepEqual(b.champs_renseignes.sort(), ["nom", "telephone", "ville"]);
  assert.deepEqual(b.champs_deja_presents, ["mobile"], "valeur existante conservée");
  assert.deepEqual([b.signataires_crees, b.signataires_existants], [["Nouveau Fictif"], ["Marie Fictive"]]);
  const { rows: [p] } = await pool.query("SELECT mobile, telephone FROM parametres_organisme");
  assert.deepEqual([p.mobile, p.telephone], ["06 94 99 99 99", "05 94 00 00 03"]);
  const second = await initialiserParametres(donnees);
  assert.deepEqual([second.champs_renseignes, second.signataires_crees], [[], []], "idempotent");
  await assert.rejects(initialiserParametres({ organisme: { email: "faux" } }), /Organisme : E-mail/);
  await assert.rejects(initialiserParametres({ signataires: [{ nom: "", fonction: "X" }] }), /Signataire n°1/);
});
