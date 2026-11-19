// ─────────────────────────────────────────────────────────────
//  Données complémentaires des documents A2C : fiche stagiaire/entreprise, domaines de handicap (admin), niveau de
//  positionnement, contact du prescripteur et indicateurs de session. PostgreSQL réel, Drive SIMULÉ, données FICTIVES.
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

const PORT = 55501;
const DATA = path.join(os.tmpdir(), "vq-donnees-documents2-" + process.pid);

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
  const lien = `MODELE_D2_${String(++numero).padStart(6, "0")}`;
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


import { calculerIndicateurs, chargerIndicateursSession } from "../src/services/indicateursSession.js";
const C = () => ({ cookie: cookie(contribId) });
let contribId;
test("indicateurs : méthodes de calcul (pur) — taux null sans donnée, jamais de 0 % inventé", () => {
  const vide = calculerIndicateurs({});
  assert.equal(vide.taux_satisfaction, null); assert.equal(vide.taux_assiduite, null); assert.equal(vide.taux_abandon, null); assert.equal(vide.taux_atteinte, null);
  assert.deepEqual([vide.repondants, vide.abandons, vide.reussites], [0, 0, 0]);
  const r = calculerIndicateurs({
    heuresPrevues: 20,
    inscriptions: [
      { id: 1, statut: "inscrit", heures_absence: 2, prescripteur: null, categorie_abandon: null },
      { id: 2, statut: "abandon", heures_absence: 0, prescripteur: "pole_emploi", categorie_abandon: "financement" },
      { id: 3, statut: "inscrit", heures_absence: 0, prescripteur: "mission_locale", categorie_abandon: null },
      { id: 4, statut: "abandon", heures_absence: 0, prescripteur: null, categorie_abandon: null },
    ],
    satisfactions: [{ type: "a_chaud", note_globale: 5, note_max: 5 }, { type: "a_chaud", note_globale: 3, note_max: 5 }, { type: "a_froid", note_globale: 1, note_max: 5 }, { type: "a_chaud", note_globale: 8, note_max: 10 }],
    qcm: [
      { id: 1, inscription_id: 1, type: "qcm", date_passage: "2026-12-01", score: 4, score_max: 20, seuil_reussite: null, resultat: "valide" },
      { id: 2, inscription_id: 1, type: "qcm", date_passage: "2026-12-05", score: 18, score_max: 20, seuil_reussite: 12, resultat: "non_determine" },
      { id: 3, inscription_id: 3, type: "qcm", date_passage: "2026-12-05", score: 4, score_max: 10, seuil_reussite: null, resultat: "non_determine" },
    ],
  });
  assert.equal(r.taux_assiduite, 95); assert.equal(r.taux_absence, 5);
  assert.equal(r.heures_absence, 2, "40 h prévues (2 inscrits actifs × 20 h) − 38 h suivies");
  assert.equal(r.au_terme, 2, "inscrits non en abandon");
  assert.equal(vide.heures_absence, null, "sans heures prévues : jamais un 0 h inventé"); assert.equal(vide.au_terme, 0);
  assert.equal(r.taux_abandon, 50); assert.equal(r.abandons, 2);
  assert.deepEqual(r.motifs, { personnel: 0, professionnel: 0, financement: 1, reorientation: 0, sans_nouvelles: 0, autre: 1 });
  assert.equal(r.repondants, 3, "seules les réponses « à chaud » comptent"); assert.equal(r.taux_satisfaction, 67);
  assert.deepEqual(r.niveaux, { 5: 1, 4: 1, 3: 1, 2: 0, 1: 0 });
  assert.deepEqual([r.reussites, r.echecs, r.taux_atteinte], [1, 1, 50], "dernier QCM par stagiaire ; 4/10 = échec, 18 ≥ seuil 12 = réussite");
  assert.deepEqual(r.prescripteurs, { pole_emploi: 0, mission_locale: 1, of: 0, autres: 1 }, "abandons exclus");
});

test("indicateurs : atteinte des objectifs = au moins 50 % des compétences évaluées acquises ; QCM à défaut", () => {
  const ins = (id, statut = "inscrit") => ({ id, statut, heures_absence: 0, prescripteur: null, categorie_abandon: null });
  const comp = (inscription_id, ...statuts) => statuts.map((statut) => ({ inscription_id, statut }));
  const r = calculerIndicateurs({
    inscriptions: [ins(1), ins(2), ins(3), ins(4), ins(5, "abandon")],
    competences: [
      ...comp(1, "acquis", "acquis", "en_cours", "non_acquis"),       // 2/4 = 50 % → atteint (seuil inclus)
      ...comp(2, "acquis", "en_cours", "non_acquis"),                  // 1/3 → non atteint
      ...comp(3, "acquis", "non_evalue", null, undefined),             // non évalué exclu : 1/1 → atteint
      ...comp(5, "acquis"),                                            // abandon : ignoré
    ],
    qcm: [{ id: 1, inscription_id: 4, type: "qcm", date_passage: "2026-12-01", score: 9, score_max: 10, seuil_reussite: null, resultat: "non_determine" },
          { id: 2, inscription_id: 2, type: "qcm", date_passage: "2026-12-01", score: 10, score_max: 10, seuil_reussite: null, resultat: "valide" }],
  });
  assert.deepEqual([r.reussites, r.echecs, r.taux_atteinte], [3, 1, 75], "stagiaire 4 sans compétence évaluée : QCM 9/10 ; stagiaire 2 : la règle des compétences prime sur son QCM validé");
  assert.deepEqual(calculerIndicateurs({ inscriptions: [ins(1)], competences: comp(1, null) }).taux_atteinte, null, "aucune compétence évaluée ni QCM : pas de 0 % inventé");
});

test("fiche stagiaire : champs validés, domaines de handicap réservés à l'administrateur", async () => {
  ({ rows: [{ id: contribId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('contrib@d2.local', 'Contrib Test', 'contributeur') RETURNING id"));
  const ins = F.inscrits.Alpha;
  const url = `/api/stagiaires/${ins.stagiaire_id}`;
  const corps = { date_naissance: "1980-06-15", adresse: "3 rue Test", code_postal: "97300", ville: "Cayenne", profession: "Aide-soignante",
    entreprise: "Société Fictive", entreprise_adresse: "5 avenue Test", entreprise_siret: "123 456 789 00010", entreprise_ape: "8899B", entreprise_effectifs: "12",
    entreprise_responsable: "Paul Exemple", entreprise_opca: "OPCO Fictif" };
  assert.equal((await api("PATCH", url, { date_naissance: "pas une date" }, A())).statut, 400);
  assert.equal((await api("PATCH", url, { date_naissance: "2999-01-01" }, A())).statut, 400, "date future");
  assert.equal((await api("PATCH", url, { entreprise_siret: "ABC" }, A())).statut, 400);
  assert.equal((await api("PATCH", url, { ville: "x".repeat(101) }, A())).statut, 400);
  assert.equal((await api("PATCH", url, { adresse: 12 }, A())).statut, 400);
  ok(await api("PATCH", url, corps, C()));
  assert.equal((await api("PATCH", url, { domaines_handicap: ["moteur"] }, C())).statut, 403, "contributeur refusé");
  assert.equal((await api("PATCH", url, { domaines_handicap: ["inconnu"] }, A())).statut, 400);
  ok(await api("PATCH", url, { domaines_handicap: ["moteur", "visuel", "moteur"] }, A()));
  const { rows: [s] } = await pool.query("SELECT domaines_handicap, ville, date_naissance::text AS n FROM stagiaires WHERE id = $1", [ins.stagiaire_id]);
  assert.deepEqual([s.domaines_handicap, s.ville, s.n], [["moteur", "visuel"], "Cayenne", "1980-06-15"]);
  const relu = ok(await api("PATCH", url, { profession: "" }, C())).stagiaire;
  assert.equal(relu.profession, null, "effacement par chaîne vide");
  assert.equal("domaines_handicap" in relu, false, "jamais renvoyé à un contributeur");
  ok(await api("PATCH", url, { profession: "Aide-soignante" }, A()));
});

test("recueil : niveau de positionnement enregistré, conservé si le corps l'omet, refusé si inconnu", async () => {
  const id = F.inscrits.Alpha.id;
  const base = { statut: "realise", date_recueil: "2026-11-20", attentes: "Messagerie", conclusion: "parcours_adapte" };
  assert.equal((await api("PUT", `/api/inscriptions/${id}/recueil`, { ...base, niveau_positionnement: "expert" }, A())).statut, 400);
  ok(await api("PUT", `/api/inscriptions/${id}/recueil`, { ...base, niveau_positionnement: "debutant" }, A()));
  const r2 = ok(await api("PUT", `/api/inscriptions/${id}/recueil`, base, A())).recueil;
  assert.equal(r2.niveau_positionnement, "debutant", "ancien client : valeur conservée");
  const r3 = ok(await api("PUT", `/api/inscriptions/${id}/recueil`, { ...base, niveau_positionnement: null }, A())).recueil;
  assert.equal(r3.niveau_positionnement, null, "effacement explicite");
  ok(await api("PUT", `/api/inscriptions/${id}/recueil`, { ...base, niveau_positionnement: "debutant" }, A()));
});

test("génération : fiche, entreprise, prescripteur et indicateurs de session injectés ; handicap réservé", async () => {
  const [a, b, c] = [F.inscrits.Alpha, F.inscrits.Bravo, F.inscrits.Charlie];
  await pool.query("UPDATE prescripteurs SET adresse = '9 place Test', contact_nom = 'Anne Contact', contact_fonction = 'Conseillère', contact_email = 'a@pe.test', contact_telephone = '0594111111' WHERE code = 'pole_emploi'");
  await pool.query("UPDATE inscriptions SET prescripteur = 'pole_emploi' WHERE id = $1", [a.id]);
  await pool.query("UPDATE inscriptions SET prescripteur = 'mission_locale' WHERE id = $1", [c.id]);
  await pool.query("UPDATE inscriptions SET statut = 'abandon', categorie_abandon = 'financement', date_abandon = '2026-12-03' WHERE id = $1", [b.id]);
  await pool.query("INSERT INTO absences (inscription_id, date_absence, duree_heures) VALUES ($1, '2026-12-02', 2)", [a.id]);
  await pool.query("INSERT INTO satisfactions (session_id, type, date_recueil, note_globale, note_max) VALUES ($1, 'a_chaud', '2026-12-10', 5, 5), ($1, 'a_chaud', '2026-12-10', 3, 5)", [F.session]);
  await pool.query("INSERT INTO resultats_qcm (inscription_id, type, intitule, date_passage, score, score_max, resultat) VALUES ($1, 'qcm', 'QCM final', '2026-12-09', 17, 20, 'valide'), ($2, 'qcm', 'QCM final', '2026-12-09', 3, 20, 'non_valide')", [a.id, c.id]);
  const m = await modele("FICHE {{stagiaire_nom_complet}} né(e) le {{stagiaire_date_naissance}} ({{stagiaire_age}} ans) — {{stagiaire_adresse}}, {{stagiaire_code_postal}} {{stagiaire_ville}} — {{stagiaire_profession}} — ENTREPRISE {{stagiaire_entreprise_nom}} {{stagiaire_entreprise_siret}} {{stagiaire_entreprise_opca}} — NIVEAU {{stagiaire_niveau_positionnement}} — PRESCRIPTEUR {{prescripteur_nom}} {{prescripteur_contact_nom}} {{prescripteur_telephone}} | SESSION satisfaction {{indicateur_taux_satisfaction}} % ({{indicateur_nombre_repondants_satisfaction}}) assiduité {{indicateur_taux_assiduite}} % abandon {{indicateur_taux_abandon}} % ({{indicateur_abandons_financement}} financement) objectifs {{indicateur_taux_atteinte_objectifs}} % ML {{indicateur_inscrits_mission_locale}}");
  ok(await api("POST", "/api/generations", { modele_id: m, session_id: F.session }, C()));
  const docs = await documents(F.session, m);
  const alpha = docs.find((d) => d.stagiaire_id === a.stagiaire_id).texte;
  assert.match(alpha, /^FICHE Test Alpha né\(e\) le 15\/06\/1980 \(46 ans\) — 3 rue Test, 97300 Cayenne — Aide-soignante — ENTREPRISE Société Fictive 123 456 789 00010 OPCO Fictif — NIVEAU Débutant — PRESCRIPTEUR Pôle Emploi Anne Contact 0594111111 \|/);
  assert.match(alpha, /satisfaction 50 % \(2\) assiduité 97 % abandon 25 % \(1 financement\) objectifs 50 % ML 1$/, "4 inscrits dont Delta sans absence : (18+20+20)/60");
  assert.equal(docs.length, 3, "Alpha, Charlie et Delta : l'abandon (Bravo) n'a pas de document");
  const sensible = await modele("HANDICAP {{stagiaire_domaines_handicap}}");
  const refus = await api("POST", "/api/generations", { modele_id: sensible, session_id: F.session }, C());
  assert.equal(refus.statut, 400);
  ok(await api("POST", "/api/generations", { modele_id: sensible, session_id: F.session }, A()));
  const h = (await documents(F.session, sensible)).find((d) => d.stagiaire_id === a.stagiaire_id).texte;
  assert.equal(h, "HANDICAP Moteur, Visuel");
});

test("compétences : liste (formation puis séances), statuts saisis, refus des compétences inconnues, effacement", async () => {
  const a = F.inscrits.Alpha.id;
  await pool.query("UPDATE formation_versions SET competences = ARRAY['AT01 allumer un PC', 'AT02 ouvrir un logiciel'] WHERE formation_id = $1", [F.formation]);
  await pool.query("INSERT INTO seances (session_id, date_seance, heure_debut, heure_fin, competences) VALUES ($1, '2026-12-02', '09:00', '12:00', ARRAY['AT02 ouvrir un logiciel', 'AT03 envoyer un message'])", [F.session]);
  const liste = ok(await api("GET", `/api/inscriptions/${a}/competences`, undefined, C())).competences;
  assert.deepEqual(liste.map((c) => c.competence), ["AT01 allumer un PC", "AT02 ouvrir un logiciel", "AT03 envoyer un message"], "sans doublon, ordre formation puis séances");
  assert.equal((await api("PUT", `/api/inscriptions/${a}/competences`, { competences: [{ competence: "Inventée", statut: "acquis" }] }, A())).statut, 400);
  assert.equal((await api("PUT", `/api/inscriptions/${a}/competences`, { competences: [{ competence: "AT01 allumer un PC", statut: "parfait" }] }, A())).statut, 400);
  assert.equal((await api("PUT", `/api/inscriptions/${a}/competences`, { competences: "x" }, A())).statut, 400);
  ok(await api("PUT", `/api/inscriptions/${a}/competences`, { competences: [{ competence: "AT01 allumer un PC", statut: "acquis" }, { competence: "AT02 ouvrir un logiciel", statut: "en_cours" }, { competence: "AT03 envoyer un message", statut: "non_acquis" }] }, C()));
  ok(await api("PUT", `/api/inscriptions/${a}/competences`, { competences: [{ competence: "AT03 envoyer un message", statut: null }] }, C()));
  const relu = ok(await api("GET", `/api/inscriptions/${a}/competences`, undefined, C())).competences;
  assert.deepEqual(relu.map((c) => c.statut), ["acquis", "en_cours", null], "une ligne effacée, les autres conservées");
});

test("génération : grille des compétences (X par colonne) et liste des inscrits de la session (modèle de portée session)", async () => {
  const grille = await modele("{{#competences_stagiaire}}[{{competence_libelle}}|{{competence_acquis}}|{{competence_en_cours}}|{{competence_non_acquis}}|{{competence_statut}}]{{/competences_stagiaire}}");
  ok(await api("POST", "/api/generations", { modele_id: grille, session_id: F.session }, C()));
  const docs = await documents(F.session, grille);
  const alpha = docs.find((d) => d.stagiaire_id === F.inscrits.Alpha.stagiaire_id).texte;
  assert.equal(alpha, "[AT01 allumer un PC|X|||Acquis][AT02 ouvrir un logiciel||X||En cours d'acquisition][AT03 envoyer un message||||Non évalué]");
  const charlie = docs.find((d) => d.stagiaire_id === F.inscrits.Charlie.stagiaire_id).texte;
  assert.match(charlie, /^\[AT01 allumer un PC\|\|\|\|Non évalué\]/, "jamais de statut inventé");

  const liste = await modele("{{#inscrits_session}}<{{inscrit_nom_complet}}|{{inscrit_statut}}|{{inscrit_prescripteur}}|{{inscrit_heures_absence}}|{{inscrit_taux_absence}}|{{inscrit_dossier_complet}}>{{/inscrits_session}}", { portee: "session" });
  ok(await api("POST", "/api/generations", { modele_id: liste, session_id: F.session }, C()));
  const [doc] = await documents(F.session, liste);
  assert.match(doc.texte, /<Test Alpha\|Inscrit\|Pôle Emploi\|2 h\|10 %\|Non>/, "taux d'absence = 2/20");
  assert.match(doc.texte, /<Test Bravo\|Abandon\|[^|]*\|0 h\|\|Non>/, "abandon : taux non calculable, vide");
  assert.equal((doc.texte.match(/</g) || []).length, 4, "les 4 inscrits, abandon compris");
});

test("indicateurs (base réelle) : les compétences saisies priment sur le QCM pour l'atteinte des objectifs", async () => {
  const avant = await chargerIndicateursSession(F.session, 10);
  const a = F.inscrits.Alpha; // QCM final validé (cf. test de génération) ; 1 compétence acquise sur 3 → objectif non atteint
  await pool.query("INSERT INTO competences_stagiaires (inscription_id, competence, statut) VALUES ($1, 'C1', 'acquis'), ($1, 'C2', 'non_acquis'), ($1, 'C3', 'en_cours')", [a.id]);
  const apres = await chargerIndicateursSession(F.session, 10);
  assert.equal(apres.reussites, avant.reussites - 1, "Alpha n'est plus compté parmi les réussites");
  assert.equal(apres.echecs, avant.echecs + 1, "… mais parmi les échecs (1/3 < 50 %)");
});

test("génération : séquence pédagogique (modules, séquence, résultat du stagiaire, cases à cocher) depuis la base", async () => {
  const { rows: [v] } = await pool.query("SELECT id FROM formation_versions WHERE formation_id = $1 ORDER BY numero DESC LIMIT 1", [F.formation]);
  const mod = async (ordre, code, intitule, comps) => {
    const { rows: [m] } = await pool.query("INSERT INTO formation_modules (formation_version_id, ordre, code, intitule, duree_minutes, evaluation_minutes) VALUES ($1,$2,$3,$4,300,20) RETURNING id", [v.id, ordre, code, intitule]);
    for (const [i, [cc, lib]] of comps.entries()) await pool.query("INSERT INTO formation_competences (module_id, ordre, code, libelle, titre, duree_minutes, activites) VALUES ($1,$2,$3,$4,$5,40,'Activité fictive')", [m.id, i + 1, cc, lib, "Titre " + cc]);
  };
  await mod(1, "C1", "Prise en main", [["AT01", "allumer un PC"], ["AT02", "ouvrir un logiciel"]]);
  await mod(2, "C2", "Messagerie", [["AT03", "envoyer un message"]]);
  const m = await modele("{{formation_nombre_modules}} modules ; {{stagiaire_modules_valides}} validé ; {{stagiaire_resultat_objectifs}} ; {{stagiaire_niveau_autonomie}} ; {{stagiaire_case_objectifs_atteints}}{{stagiaire_case_objectifs_partiels}}{{stagiaire_case_objectifs_non_atteints}} {{stagiaire_case_autonome}}{{stagiaire_case_en_progression}}{{stagiaire_case_accompagnement_renforce}} "
    + "{{#modules_formation}}<{{module_code}}|{{module_intitule}}|{{module_duree}}|{{module_evaluation_duree}}|{{module_nombre_competences}}|{{module_statut}}|{{module_acquis}}>{{/modules_formation}} "
    + "{{#sequence_formation}}({{sequence_module_code}}/{{sequence_competence_code}}/{{sequence_competence_titre}}/{{sequence_duree}}/{{sequence_activites}}){{/sequence_formation}} "
    + "{{#competences_stagiaire}}[{{competence_module_code}}:{{competence_module_statut}}]{{/competences_stagiaire}}");
  ok(await api("POST", "/api/generations", { modele_id: m, session_id: F.session }, C()));
  const docs = await documents(F.session, m);
  const alpha = docs.find((d) => d.stagiaire_id === F.inscrits.Alpha.stagiaire_id).texte;
  // Alpha : AT01 acquis, AT02 en cours → C1 = 50 % acquis ; AT03 non évalué → C2 non évalué ; 1 module sur 2 → partiellement atteints.
  assert.match(alpha, /^2 modules ; 1 validé ; Objectifs partiellement atteints ; En progression ; ☐☒☐ ☐☒☐ /);
  assert.match(alpha, /<C1\|Prise en main\|5 h\|20 min\|2\|Acquis\|X><C2\|Messagerie\|5 h\|20 min\|1\|\|>/, "C2 non évalué : statut vide, jamais inventé");
  assert.match(alpha, /\(C1\/AT01\/Titre AT01\/40 min\/Activité fictive\)\(C1\/AT02\/Titre AT02\/40 min\/Activité fictive\)\(C2\/AT03\/Titre AT03\/40 min\/Activité fictive\)/);
  assert.match(alpha, /\[C1:Acquis\]\[C1:Acquis\]\[C2:\]/);
  const charlie = docs.find((d) => d.stagiaire_id === F.inscrits.Charlie.stagiaire_id).texte;
  assert.match(charlie, /^2 modules ; 0 validé ; ; ; ☐☐☐ ☐☐☐ /, "aucune compétence évaluée : pas de niveau déduit, aucune case cochée");
});
