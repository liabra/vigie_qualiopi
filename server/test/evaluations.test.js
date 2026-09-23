// Contrat HTTP des évaluations / QCM et de la satisfaction (lot L7).
// Création/modification, validation des scores (paire score/score_max,
// bornes), résultat explicite, types historiques et nouveaux, satisfaction
// nominative/anonyme, agrégations homogènes, droits, et fichier Drive.
//
// Application Express réelle + base simulée (setPoolFactory) : aucun
// PostgreSQL nécessaire. La base simulée REFUSE toute requête inconnue.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { setPoolFactory } from "../src/db.js";
import { setDriveFactory } from "../src/services/google.js";
import { encode } from "../src/session.js";

const ADMIN = { id: 1, email: "admin@exemple.fr", nom: "Mme Stark", role: "admin" };
const CONTRIBUTEUR = { id: 2, email: "tukui@exemple.fr", nom: "Tukui", role: "contributeur" };
const SQL_UTILISATEUR = "SELECT id, email, nom, role FROM utilisateurs WHERE id = $1 AND actif";
const sqlNormalise = (text) => String(text).replace(/\s+/g, " ").trim();

function baseSimulee({ sessions = { 1: { date_debut: "2026-01-05", date_fin: "2026-03-05" } },
                       inscriptions = { 10: { session_id: 1, stagiaire_id: 100 } },
                       stagiaires = { 100: { nom: "Stark", prenom: "Blandine", email: "blandine@exemple.fr" } },
                       evaluations = [], satisfactions = [] } = {}) {
  const etat = {
    sessions, inscriptions, stagiaires,
    evaluations: new Map(evaluations.map((e) => [e.id, {
      resultat: "non_determine", score: null, score_max: null, seuil_reussite: null,
      commentaire: null, drive_file_id: null, intitule: null, ...e,
    }])),
    satisfactions: new Map(satisfactions.map((f) => [f.id, {
      note_max: 5, note_globale: null, commentaires: null, reponses: {}, drive_file_id: null,
      inscription_id: null, ...f,
    }])),
  };
  const prochain = {
    eval: Math.max(0, ...evaluations.map((e) => e.id)) + 1,
    sat: Math.max(0, ...satisfactions.map((f) => f.id)) + 1,
  };

  const ligneInseree = (sql, params) => {
    const cols = /INSERT INTO \w+ \(([^)]+)\)/.exec(sql)[1].split(",").map((s) => s.trim());
    const vals = /VALUES \(([^)]+)\)/.exec(sql)[1].split(",").map((s) => s.trim());
    return Object.fromEntries(cols.map((c, i) => {
      const v = vals[i];
      return [c, /^\$\d+$/.test(v) ? params[Number(v.slice(1)) - 1] : (v === "NULL" ? null : v.replace(/^'|'$/g, ""))];
    }));
  };

  const executer = async (text, params = []) => {
    const sql = sqlNormalise(text);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };

    if (sql === SQL_UTILISATEUR) {
      const u = [ADMIN, CONTRIBUTEUR].find((x) => x.id === params[0]);
      return { rows: u ? [u] : [] };
    }

    if (sql === "SELECT id, date_debut, date_fin FROM sessions WHERE id = $1") {
      const s = etat.sessions[params[0]];
      return { rows: s ? [{ id: params[0], ...s }] : [] };
    }

    if (sql === "SELECT id FROM sessions WHERE id = $1") {
      const s = etat.sessions[params[0]];
      return { rows: s ? [{ id: params[0] }] : [] };
    }

    if (sql === "SELECT id, session_id FROM inscriptions WHERE id = $1") {
      const ins = etat.inscriptions[params[0]];
      return { rows: ins ? [{ id: params[0], session_id: ins.session_id }] : [] };
    }

    // ── Évaluations ──────────────────────────────────────────
    if (sql.startsWith("SELECT e.id, e.inscription_id")) {
      const rows = [...etat.evaluations.values()]
        .filter((e) => etat.inscriptions[e.inscription_id]?.session_id === params[0])
        .map((e) => {
          const ins = etat.inscriptions[e.inscription_id] || {};
          const s = etat.stagiaires[ins.stagiaire_id] || {};
          return { ...e, stagiaire_id: ins.stagiaire_id, nom: s.nom, prenom: s.prenom, email: s.email };
        })
        .sort((a, b) => String(b.date_passage || "").localeCompare(String(a.date_passage || "")) || b.id - a.id);
      return { rows };
    }

    if (sql.startsWith("SELECT e.*, i.session_id")) {
      const e = etat.evaluations.get(params[0]);
      if (!e) return { rows: [] };
      const ins = etat.inscriptions[e.inscription_id] || {};
      const s = etat.sessions[ins.session_id] || {};
      return { rows: [{ ...e, session_id: ins.session_id, date_debut: s.date_debut, date_fin: s.date_fin }] };
    }

    if (sql.startsWith("INSERT INTO resultats_qcm")) {
      const row = ligneInseree(sql, params);
      const id = prochain.eval++;
      etat.evaluations.set(id, { id, resultat: "non_determine", score: null, score_max: null, seuil_reussite: null, commentaire: null, drive_file_id: null, intitule: null, ...row });
      return { rows: [{ ...etat.evaluations.get(id) }] };
    }

    if (sql.startsWith("UPDATE resultats_qcm SET")) {
      const e = etat.evaluations.get(params[0]);
      if (!e) return { rows: [] };
      const sets = /UPDATE resultats_qcm SET (.+) WHERE id = \$1/.exec(sql)[1].split(", ");
      for (const clause of sets) {
        const [col, jeton] = clause.split(" = ");
        e[col] = /^\$\d+$/.test(jeton) ? params[Number(jeton.slice(1)) - 1] : jeton;
      }
      return { rows: [{ ...e }] };
    }

    // ── Satisfaction ─────────────────────────────────────────
    if (sql.startsWith("SELECT f.id, f.session_id")) {
      const rows = [...etat.satisfactions.values()]
        .filter((f) => f.session_id === params[0])
        .map((f) => {
          const ins = etat.inscriptions[f.inscription_id];
          const s = ins ? etat.stagiaires[ins.stagiaire_id] : {};
          return { ...f, nom: s.nom ?? null, prenom: s.prenom ?? null };
        })
        .sort((a, b) => String(b.date_recueil || "").localeCompare(String(a.date_recueil || "")) || b.id - a.id);
      return { rows };
    }

    if (sql === "SELECT * FROM satisfactions WHERE id = $1") {
      const f = etat.satisfactions.get(params[0]);
      return { rows: f ? [{ ...f }] : [] };
    }

    if (sql.startsWith("INSERT INTO satisfactions")) {
      const row = ligneInseree(sql, params);
      const id = prochain.sat++;
      etat.satisfactions.set(id, { id, note_max: 5, note_globale: null, commentaires: null, reponses: {}, drive_file_id: null, inscription_id: null, ...row });
      return { rows: [{ ...etat.satisfactions.get(id) }] };
    }

    if (sql.startsWith("UPDATE satisfactions SET")) {
      const f = etat.satisfactions.get(params[0]);
      if (!f) return { rows: [] };
      const sets = /UPDATE satisfactions SET (.+) WHERE id = \$1/.exec(sql)[1].split(", ");
      for (const clause of sets) {
        const [col, jeton] = clause.split(" = ");
        f[col] = /^\$\d+$/.test(jeton) ? params[Number(jeton.slice(1)) - 1] : jeton;
      }
      return { rows: [{ ...f }] };
    }

    throw new Error("Requête inattendue pour la base simulée : " + sql);
  };

  const pool = { query: executer, connect: async () => ({ query: executer, release: () => {} }) };
  return { etat, installer: () => { setPoolFactory(() => pool); return pool; } };
}

const driveValide = () => ({
  drive: { files: { get: async ({ fileId }) => ({ data: { id: fileId, name: "Resultat.pdf", mimeType: "application/pdf", webViewLink: "https://drive.google.com/file/d/" + fileId + "/view" } }) } },
});
const driveInconnu = () => ({
  drive: { files: { get: async () => { const e = new Error("Not Found"); e.response = { status: 404 }; throw e; } } },
});
const driveRecherche = () => ({
  drive: {
    files: {
      get: async ({ fileId }) => ({ data: { id: fileId, name: "F.pdf", mimeType: "application/pdf", webViewLink: "https://drive/" + fileId } }),
      list: async () => ({ data: { files: [{ id: "F1", name: "Fiche.pdf", mimeType: "application/pdf", webViewLink: "https://drive/F1" }] } }),
    },
  },
});

let serveur, origine;
before(async () => {
  setDriveFactory(driveValide);
  serveur = createApp().listen(0);
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});
after(async () => {
  setPoolFactory(null);
  setDriveFactory(null);
  if (serveur) await new Promise((r) => serveur.close(r));
});

const appel = async (chemin, { methode = "GET", corps, utilisateur = ADMIN } = {}) => {
  const r = await fetch(origine + chemin, {
    method: methode,
    headers: {
      "content-type": "application/json",
      ...(utilisateur ? { cookie: "vq_session=" + encode({ uid: utilisateur.id, exp: Date.now() + 60_000 }) } : {}),
    },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};

const creerEvaluation = (corps, utilisateur = ADMIN) => appel("/api/sessions/1/evaluations", { methode: "POST", corps, utilisateur });
const creerSatisfaction = (corps, utilisateur = ADMIN) => appel("/api/sessions/1/satisfactions", { methode: "POST", corps, utilisateur });

// ── Évaluations : création et validation ─────────────────────

test("un rédacteur crée une évaluation avec score", async () => {
  const b = baseSimulee(); b.installer();
  const r = await creerEvaluation({
    inscription_id: 10, type: "qcm", intitule: "QCM fin séance 1", date_passage: "2026-03-02",
    score: 12, score_max: 20, seuil_reussite: 10, resultat: "valide",
  });
  assert.equal(r.statut, 201);
  assert.equal(r.corps.evaluation.type, "qcm");
  assert.equal(r.corps.evaluation.score, 12);
  assert.equal(r.corps.evaluation.resultat, "valide");
});

test("une évaluation sans score est acceptée (résultat qualitatif)", async () => {
  const b = baseSimulee(); b.installer();
  const r = await creerEvaluation({
    inscription_id: 10, type: "validation_etape", intitule: "Étape 2", date_passage: "2026-03-02",
    resultat: "valide", commentaire: "Mise en situation réussie",
  });
  assert.equal(r.statut, 201);
  assert.equal(r.corps.evaluation.score, null);
  assert.equal(r.corps.evaluation.score_max, null);
  assert.equal(r.corps.evaluation.resultat, "valide");
});

test("les types historiques et nouveaux sont acceptés", async () => {
  const b = baseSimulee(); b.installer();
  for (const type of ["positionnement", "intermediaire", "evaluation_finale", "qcm", "validation_etape", "autre"]) {
    const r = await creerEvaluation({ inscription_id: 10, type, date_passage: "2026-03-02" });
    assert.equal(r.statut, 201, "type accepté : " + type);
  }
});

test("un type inconnu est refusé", async () => {
  baseSimulee().installer();
  const r = await creerEvaluation({ inscription_id: 10, type: "n_importe", date_passage: "2026-03-02" });
  assert.equal(r.statut, 400);
});

test("un résultat inconnu est refusé", async () => {
  baseSimulee().installer();
  const r = await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-02", resultat: "peut_etre" });
  assert.equal(r.statut, 400);
});

test("un score négatif est refusé", async () => {
  baseSimulee().installer();
  const r = await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-02", score: -1, score_max: 20 });
  assert.equal(r.statut, 400);
});

test("un score maximum invalide est refusé", async () => {
  baseSimulee().installer();
  assert.equal((await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-02", score: 5, score_max: 0 })).statut, 400);
  assert.equal((await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-02", score: 5, score_max: -2 })).statut, 400);
});

test("un score supérieur au maximum est refusé", async () => {
  baseSimulee().installer();
  const r = await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-02", score: 25, score_max: 20 });
  assert.equal(r.statut, 400);
});

test("un score sans maximum (ou l'inverse) est refusé", async () => {
  baseSimulee().installer();
  assert.equal((await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-02", score: 5 })).statut, 400);
  assert.equal((await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-02", score_max: 20 })).statut, 400);
});

test("un seuil de réussite valide est accepté", async () => {
  baseSimulee().installer();
  const r = await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-02", score: 12, score_max: 20, seuil_reussite: 10 });
  assert.equal(r.statut, 201);
  assert.equal(r.corps.evaluation.seuil_reussite, 10);
});

test("un seuil de réussite négatif est refusé", async () => {
  baseSimulee().installer();
  const r = await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-02", score: 12, score_max: 20, seuil_reussite: -1 });
  assert.equal(r.statut, 400);
});

test("un seuil supérieur au score maximum est refusé", async () => {
  baseSimulee().installer();
  const r = await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-02", score: 12, score_max: 20, seuil_reussite: 25 });
  assert.equal(r.statut, 400);
});

test("un seuil sans score maximum est refusé", async () => {
  baseSimulee().installer();
  const r = await creerEvaluation({ inscription_id: 10, type: "validation_etape", date_passage: "2026-03-02", seuil_reussite: 10, resultat: "valide" });
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /sans score maximum/);
});

// ── Date de passage bornée à la période de la session ────────

test("une évaluation à la date de début de session est acceptée", async () => {
  baseSimulee().installer();
  const r = await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-01-05" });
  assert.equal(r.statut, 201);
});

test("une évaluation à la date de fin de session est acceptée", async () => {
  baseSimulee().installer();
  const r = await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-05" });
  assert.equal(r.statut, 201);
});

test("une évaluation avant la session est refusée", async () => {
  baseSimulee().installer();
  const r = await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-01-04" });
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /doit être comprise entre le 05\/01\/2026 et le 05\/03\/2026/);
});

test("une évaluation après la session est refusée", async () => {
  baseSimulee().installer();
  const r = await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-06" });
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /doit être comprise entre/);
});

test("modifier vers une date valide est accepté", async () => {
  baseSimulee({ evaluations: [{ id: 1, inscription_id: 10, type: "qcm", date_passage: "2026-02-10" }] }).installer();
  const r = await appel("/api/evaluations/1", { methode: "PATCH", corps: { date_passage: "2026-02-15" } });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.evaluation.date_passage, "2026-02-15");
});

test("modifier vers une date avant la session est refusé", async () => {
  baseSimulee({ evaluations: [{ id: 1, inscription_id: 10, type: "qcm", date_passage: "2026-02-10" }] }).installer();
  const r = await appel("/api/evaluations/1", { methode: "PATCH", corps: { date_passage: "2026-01-01" } });
  assert.equal(r.statut, 400);
});

test("modifier vers une date après la session est refusé", async () => {
  baseSimulee({ evaluations: [{ id: 1, inscription_id: 10, type: "qcm", date_passage: "2026-02-10" }] }).installer();
  const r = await appel("/api/evaluations/1", { methode: "PATCH", corps: { date_passage: "2026-04-01" } });
  assert.equal(r.statut, 400);
});

test("une ancienne ligne hors période est corrigeable avec une date valide", async () => {
  const b = baseSimulee({ evaluations: [{ id: 1, inscription_id: 10, type: "qcm", date_passage: "2024-12-31", resultat: "non_determine" }] });
  b.installer();
  const r = await appel("/api/evaluations/1", { methode: "PATCH", corps: { date_passage: "2026-02-15", resultat: "valide" } });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.evaluation.date_passage, "2026-02-15");
  assert.equal(r.corps.evaluation.resultat, "valide");
});

// ── Satisfaction non bornée par la session ───────────────────

test("une satisfaction a_froid après la date de fin reste autorisée", async () => {
  baseSimulee().installer();
  const r = await creerSatisfaction({ type: "a_froid", date_recueil: "2026-06-01", note_globale: 4, note_max: 5 });
  assert.equal(r.statut, 201);
});

test("plusieurs évaluations pour un même stagiaire sont acceptées", async () => {
  const b = baseSimulee(); b.installer();
  assert.equal((await creerEvaluation({ inscription_id: 10, type: "qcm", intitule: "QCM 1", date_passage: "2026-03-02" })).statut, 201);
  assert.equal((await creerEvaluation({ inscription_id: 10, type: "qcm", intitule: "QCM 2", date_passage: "2026-03-03" })).statut, 201);
  assert.equal(b.etat.evaluations.size, 2);
});

test("une inscription d'une autre session est refusée", async () => {
  baseSimulee({ inscriptions: { 10: { session_id: 1, stagiaire_id: 100 }, 11: { session_id: 2, stagiaire_id: 101 } } }).installer();
  const r = await creerEvaluation({ inscription_id: 11, type: "qcm", date_passage: "2026-03-02" });
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /n'appartient pas à la session/);
});

test("une modification met à jour un résultat", async () => {
  const b = baseSimulee({ evaluations: [{ id: 1, inscription_id: 10, type: "qcm", date_passage: "2026-03-02", score: 10, score_max: 20, resultat: "non_determine" }] });
  b.installer();
  const r = await appel("/api/evaluations/1", { methode: "PATCH", corps: { resultat: "valide", commentaire: "Repris en main" } });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.evaluation.resultat, "valide");
  assert.equal(r.corps.evaluation.commentaire, "Repris en main");
  assert.equal(r.corps.evaluation.score, 10, "le score existant est conservé");
});

// ── Satisfaction ─────────────────────────────────────────────

test("une satisfaction nominative est créée", async () => {
  const b = baseSimulee(); b.installer();
  const r = await creerSatisfaction({ type: "a_chaud", inscription_id: 10, date_recueil: "2026-03-05", note_globale: 4, note_max: 5, commentaires: "Très bien" });
  assert.equal(r.statut, 201);
  assert.equal(r.corps.satisfaction.inscription_id, 10);
  assert.equal(r.corps.satisfaction.note_globale, 4);
});

test("une satisfaction anonyme est créée (inscription NULL)", async () => {
  const b = baseSimulee(); b.installer();
  const r = await creerSatisfaction({ type: "a_chaud", date_recueil: "2026-03-05", note_globale: 3, note_max: 5 });
  assert.equal(r.statut, 201);
  assert.equal(r.corps.satisfaction.inscription_id, null);
});

test("une note négative ou dépassant le maximum est refusée", async () => {
  baseSimulee().installer();
  assert.equal((await creerSatisfaction({ type: "a_chaud", date_recueil: "2026-03-05", note_globale: -1, note_max: 5 })).statut, 400);
  assert.equal((await creerSatisfaction({ type: "a_chaud", date_recueil: "2026-03-05", note_globale: 6, note_max: 5 })).statut, 400);
});

test("une satisfaction nominative d'une autre session est refusée", async () => {
  baseSimulee({ inscriptions: { 10: { session_id: 1, stagiaire_id: 100 }, 11: { session_id: 2, stagiaire_id: 101 } } }).installer();
  const r = await creerSatisfaction({ type: "a_chaud", inscription_id: 11, date_recueil: "2026-03-05" });
  assert.equal(r.statut, 400);
});

test("l'agrégation homogène calcule la moyenne", async () => {
  const b = baseSimulee({
    satisfactions: [
      { id: 1, session_id: 1, note_globale: 4, note_max: 5 },
      { id: 2, session_id: 1, note_globale: 3, note_max: 5, inscription_id: 10 },
    ],
  });
  b.installer();
  const r = await appel("/api/sessions/1/satisfactions");
  assert.equal(r.statut, 200);
  assert.equal(r.corps.agregation.reponses, 2);
  assert.equal(r.corps.agregation.anonymes, 1);
  assert.equal(r.corps.agregation.moyenne, 3.5);
  assert.equal(r.corps.agregation.echelleHomogene, 5);
});

test("l'agrégation hétérogène ne fabrique pas de fausse moyenne", async () => {
  baseSimulee({
    satisfactions: [
      { id: 1, session_id: 1, note_globale: 8, note_max: 10 },
      { id: 2, session_id: 1, note_globale: 4, note_max: 5 },
    ],
  }).installer();
  const r = await appel("/api/sessions/1/satisfactions");
  assert.equal(r.corps.agregation.moyenne, null, "pas de moyenne sur des échelles différentes");
  assert.deepEqual([...r.corps.agregation.echelles].sort((a, b) => a - b), [5, 10]);
});

// ── Drive ────────────────────────────────────────────────────

test("un fichier Drive valide est accepté", async () => {
  baseSimulee().installer();
  const r = await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-02", drive_file_id: "DRV-1" });
  assert.equal(r.statut, 201);
});

test("un fichier Drive inconnu est refusé", async () => {
  setDriveFactory(driveInconnu);
  baseSimulee().installer();
  const r = await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-02", drive_file_id: "DRV-X" });
  assert.equal(r.statut, 400);
  setDriveFactory(driveValide);
});

test("un Drive indisponible est refusé (503)", async () => {
  setDriveFactory(null);
  baseSimulee().installer();
  const r = await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-02", drive_file_id: "DRV-1" });
  assert.equal(r.statut, 503);
  setDriveFactory(driveValide);
});

test("la recherche Drive est réservée à l'admin", async () => {
  setDriveFactory(driveRecherche);
  baseSimulee().installer();
  assert.equal((await appel("/api/drive/recherche?q=fiche", { utilisateur: CONTRIBUTEUR })).statut, 403, "contributeur refusé");
  assert.equal((await appel("/api/drive/recherche?q=fiche", { utilisateur: null })).statut, 401, "anonyme refusé");
  const r = await appel("/api/drive/recherche?q=fiche", { utilisateur: ADMIN });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.fichiers[0].id, "F1");
  setDriveFactory(driveValide);
});

test("le contributeur n'obtient ni status ni déconnexion Drive", async () => {
  baseSimulee().installer();
  assert.equal((await appel("/api/drive/status", { utilisateur: CONTRIBUTEUR })).statut, 403);
  assert.equal((await appel("/api/drive/disconnect", { methode: "POST", utilisateur: CONTRIBUTEUR })).statut, 403);
});

test("un contributeur ne peut pas rattacher un fichier Drive à une évaluation", async () => {
  baseSimulee().installer();
  const r = await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-02", drive_file_id: "DRV-1" }, CONTRIBUTEUR);
  assert.equal(r.statut, 403);
  assert.match(r.corps.error, /réservé aux administrateurs/);
});

// ── Droits ───────────────────────────────────────────────────

test("un contributeur consulte, crée et modifie", async () => {
  baseSimulee({ evaluations: [{ id: 1, inscription_id: 10, type: "qcm", date_passage: "2026-03-02" }] }).installer();
  assert.equal((await appel("/api/sessions/1/evaluations", { utilisateur: CONTRIBUTEUR })).statut, 200);
  assert.equal((await appel("/api/sessions/1/satisfactions", { utilisateur: CONTRIBUTEUR })).statut, 200);
  assert.equal((await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-02" }, CONTRIBUTEUR)).statut, 201);
  assert.equal((await appel("/api/evaluations/1", { methode: "PATCH", corps: { resultat: "valide" }, utilisateur: CONTRIBUTEUR })).statut, 200);
  assert.equal((await creerSatisfaction({ type: "a_chaud", date_recueil: "2026-03-05" }, CONTRIBUTEUR)).statut, 201);
});

test("un visiteur anonyme est refusé partout (401)", async () => {
  baseSimulee().installer();
  assert.equal((await appel("/api/sessions/1/evaluations", { utilisateur: null })).statut, 401);
  assert.equal((await appel("/api/sessions/1/satisfactions", { utilisateur: null })).statut, 401);
  assert.equal((await creerEvaluation({ inscription_id: 10, type: "qcm", date_passage: "2026-03-02" }, null)).statut, 401);
  assert.equal((await creerSatisfaction({ type: "a_chaud", date_recueil: "2026-03-05" }, null)).statut, 401);
});
