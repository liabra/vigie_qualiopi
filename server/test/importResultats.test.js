// Import CSV de résultats d'évaluation : APERÇU sans écriture puis
// CONFIRMATION transactionnelle. Rapprochement par email uniquement
// (jamais sur nom/prénom), ambiguïté signalée, inconnu invalidé, doublon
// exact signalé, pourcentage normalisé en score/100 et affiché.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { setPoolFactory } from "../src/db.js";
import { encode } from "../src/session.js";

const ADMIN = { id: 1, email: "admin@exemple.fr", nom: "Mme Stark", role: "admin" };
const SQL_UTILISATEUR = "SELECT id, email, nom, role FROM utilisateurs WHERE id = $1 AND actif";
const sqlNormalise = (text) => String(text).replace(/\s+/g, " ").trim();

function baseSimulee({ inscriptions = [], failOn = null, session = { date_debut: "2026-01-05", date_fin: "2026-03-05" } } = {}) {
  const etat = { inscriptions, resultats: [], prochainId: 1, appels: [] };

  const executer = async (text, params = []) => {
    const sql = sqlNormalise(text);
    etat.appels.push(sql);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql === SQL_UTILISATEUR) {
      return { rows: [ADMIN].filter((x) => x.id === params[0]) };
    }
    if (sql === "SELECT id FROM sessions WHERE id = $1") {
      return { rows: [{ id: params[0] }] };
    }
    if (sql === "SELECT date_debut, date_fin FROM sessions WHERE id = $1") {
      return { rows: [{ ...session }] };
    }
    if (sql.startsWith("SELECT i.id AS inscription_id")) {
      const rows = etat.inscriptions
        .filter((i) => i.session_id === params[0])
        .map((i) => ({ inscription_id: i.id, stagiaire_id: i.stagiaire_id, email: i.email, nom: i.nom, prenom: i.prenom }));
      return { rows };
    }
    if (sql.startsWith("INSERT INTO resultats_qcm")) {
      if (failOn && params.includes(failOn)) { const e = new Error("échec simulé"); throw e; }
      const id = etat.prochainId++;
      const cols = /\(([^)]+)\) VALUES/.exec(sql)[1].split(",").map((s) => s.trim());
      const vals = /VALUES \(([^)]+)\)/.exec(sql)[1].split(",").map((s) => s.trim());
      const row = { id };
      cols.forEach((c, i) => { const v = vals[i]; row[c] = /^\$\d+$/.test(v) ? params[Number(v.slice(1)) - 1] : null; });
      etat.resultats.push(row);
      return { rows: [row] };
    }
    throw new Error("Requête inattendue pour la base simulée : " + sql);
  };

  const pool = { query: executer, connect: async () => ({ query: executer, release: () => {} }) };
  return { etat, installer: () => { setPoolFactory(() => pool); return pool; } };
}

let serveur, origine;
before(async () => {
  serveur = createApp().listen(0);
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});
after(async () => {
  setPoolFactory(null);
  if (serveur) await new Promise((r) => serveur.close(r));
});

const appel = async (chemin, { methode = "POST", corps } = {}) => {
  const r = await fetch(origine + chemin, {
    method: methode,
    headers: { "content-type": "application/json", cookie: "vq_session=" + encode({ uid: ADMIN.id, exp: Date.now() + 60_000 }) },
    body: JSON.stringify(corps),
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};
const apercu = (texte) => appel("/api/sessions/1/evaluations/import-apercu", { corps: { texte } });
const confirmer = (texte) => appel("/api/sessions/1/evaluations/import", { corps: { texte } });

const STAGIAIRES = [
  { id: 10, stagiaire_id: 100, session_id: 1, email: "blandine@exemple.fr", nom: "Stark", prenom: "Blandine" },
  { id: 11, stagiaire_id: 101, session_id: 1, email: "noe@exemple.fr", nom: "Tonate", prenom: "Noé" },
];

test("l'aperçu n'écrit rien", async () => {
  const b = baseSimulee({ inscriptions: STAGIAIRES }); b.installer();
  const r = await apercu("email;type;intitule;date;score;score_max;resultat\nblandine@exemple.fr;qcm;QCM 1;2026-03-02;12;20;valide");
  assert.equal(r.statut, 200);
  assert.equal(b.etat.resultats.length, 0, "aucune écriture pendant l'aperçu");
  assert.equal(r.corps.resume.importables, 1);
  assert.equal(r.corps.lignes[0].statut, "pret");
  assert.equal(r.corps.lignes[0].stagiaire.nom, "Stark");
});

test("email exact normalisé => importable ; email inconnu => invalide ; ambigu => à vérifier", async () => {
  const b = baseSimulee({
    inscriptions: [
      ...STAGIAIRES,
      { id: 12, stagiaire_id: 102, session_id: 1, email: "blandine@exemple.fr", nom: "Autre", prenom: "Blandine" },
    ],
  });
  b.installer();
  const texte = [
    "email;type;intitule;date;score;score_max;resultat",
    "BLANDINE@EXEMPLE.FR;qcm;QCM 1;2026-03-02;12;20;valide",
    "inconnu@exemple.fr;qcm;QCM 2;2026-03-02;10;20;valide",
    "blandine@exemple.fr;qcm;QCM 3;2026-03-02;9;20;valide",
  ].join("\n");
  const r = await apercu(texte);
  assert.equal(r.statut, 200);
  const statuts = r.corps.lignes.map((l) => l.statut);
  assert.equal(statuts[0], "a_verifier", "email partagé => à vérifier");
  assert.equal(statuts[1], "invalide");
  assert.match(r.corps.lignes[1].motif, /inconnu/);
  assert.equal(statuts[2], "a_verifier");
  assert.equal(r.corps.resume.aVerifier, 2);
  assert.equal(r.corps.resume.invalides, 1);
});

test("un doublon exact dans le fichier est signalé, jamais fusionné", async () => {
  baseSimulee({ inscriptions: STAGIAIRES }).installer();
  const texte = [
    "email;type;intitule;date;resultat",
    "blandine@exemple.fr;qcm;QCM 1;2026-03-02;valide",
    "blandine@exemple.fr;qcm;QCM 1;2026-03-02;valide",
  ].join("\n");
  const r = await apercu(texte);
  assert.equal(r.corps.lignes[0].statut, "pret");
  assert.equal(r.corps.lignes[1].statut, "doublon");
  assert.equal(r.corps.resume.doublons, 1);
});

test("un pourcentage seul est normalisé en score/100 et affiché", async () => {
  baseSimulee({ inscriptions: STAGIAIRES }).installer();
  const r = await apercu("email;type;intitule;date;pourcentage;resultat\nblandine@exemple.fr;qcm;QCM pct;2026-03-02;75;valide");
  assert.equal(r.statut, 200);
  const l = r.corps.lignes[0];
  assert.equal(l.score, 75);
  assert.equal(l.score_max, 100);
  assert.equal(l.normalisePourcentage, true);
});

test("une ligne hors période de session est invalide dans l'aperçu", async () => {
  baseSimulee({ inscriptions: STAGIAIRES }).installer();
  const texte = [
    "email;type;intitule;date;resultat",
    "blandine@exemple.fr;qcm;QCM avant;2026-01-01;valide",
    "blandine@exemple.fr;qcm;QCM après;2026-04-01;valide",
    "blandine@exemple.fr;qcm;QCM ok;2026-03-02;valide",
  ].join("\n");
  const r = await apercu(texte);
  assert.equal(r.corps.lignes[0].statut, "invalide");
  assert.match(r.corps.lignes[0].motif, /Hors période de session/);
  assert.equal(r.corps.lignes[1].statut, "invalide");
  assert.equal(r.corps.lignes[2].statut, "pret");
});

test("la confirmation n'importe pas les lignes hors période", async () => {
  const b = baseSimulee({ inscriptions: STAGIAIRES }); b.installer();
  const texte = [
    "email;type;intitule;date;resultat",
    "blandine@exemple.fr;qcm;QCM avant;2026-01-01;valide",
    "blandine@exemple.fr;qcm;QCM ok;2026-03-02;valide",
  ].join("\n");
  const r = await confirmer(texte);
  assert.equal(r.statut, 200);
  assert.equal(r.corps.bilan.importes, 1);
  assert.equal(b.etat.resultats.length, 1);
});

test("la confirmation importe les lignes prêtes et ignore les autres", async () => {
  const b = baseSimulee({ inscriptions: STAGIAIRES }); b.installer();
  const texte = [
    "email;type;intitule;date;score;score_max;resultat",
    "blandine@exemple.fr;qcm;QCM 1;2026-03-02;12;20;valide",
    "inconnu@exemple.fr;qcm;QCM 2;2026-03-02;10;20;valide",
    "noe@exemple.fr;validation_etape;Étape 1;2026-03-02;;;valide",
  ].join("\n");
  const r = await confirmer(texte);
  assert.equal(r.statut, 200);
  assert.equal(r.corps.bilan.importes, 2);
  assert.equal(b.etat.resultats.length, 2);
  assert.equal(b.etat.resultats[0].resultat, "valide");
});

test("un échec en cours d'import annule tout (rollback)", async () => {
  const b = baseSimulee({ inscriptions: STAGIAIRES, failOn: 12 }); b.installer();
  const texte = [
    "email;type;intitule;date;score;score_max;resultat",
    "blandine@exemple.fr;qcm;QCM 1;2026-03-02;12;20;valide",
    "noe@exemple.fr;qcm;QCM 2;2026-03-02;13;20;valide",
  ].join("\n");
  const r = await confirmer(texte);
  assert.equal(r.statut, 500, "l'échec simulé remonte");
  assert.equal(b.etat.resultats.length, 0, "aucun résultat partiellement importé");
});
