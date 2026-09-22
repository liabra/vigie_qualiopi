// Absences et assiduité d'un stagiaire (lot L2).
//
// Principe métier : un stagiaire est PRÉSENT par défaut, on n'enregistre que
// ses ABSENCES. Elles sont portées par l'INSCRIPTION, jamais par la personne.
//
// La couche base est remplacée par une base SIMULÉE (db.setQueryExecutor) :
// aucun PostgreSQL n'est nécessaire et `npm test` reste hermétique. La base
// simulée refuse toute requête qu'elle ne connaît pas — si une route se met à
// écrire ailleurs, ces tests échouent au lieu de passer à vide.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { setQueryExecutor } from "../src/db.js";
import { encode } from "../src/session.js";
import { calculerAssiduite, estDateValide } from "../src/routes/gestion.js";

// ── Règles pures ─────────────────────────────────────────────

test("une date d'absence doit être une date réelle au format AAAA-MM-JJ", () => {
  assert.equal(estDateValide("2026-09-14"), true);
  assert.equal(estDateValide("2024-02-29"), true, "2024 est bissextile");
  // Le 30 février n'existe pas : il doit être refusé, pas reporté au 2 mars.
  assert.equal(estDateValide("2026-02-30"), false);
  assert.equal(estDateValide("2026-02-29"), false, "2026 n'est pas bissextile");
  assert.equal(estDateValide("2026-13-01"), false);
  assert.equal(estDateValide("14/09/2026"), false);
  assert.equal(estDateValide("2026-9-14"), false);
  assert.equal(estDateValide(""), false);
  assert.equal(estDateValide(null), false);
  assert.equal(estDateValide(20260914), false);
});

test("l'assiduité n'est calculée que lorsqu'elle est fiable", () => {
  // 14 h prévues, 3,5 h d'absence : 10,5 h suivies, 75 %.
  assert.deepEqual(calculerAssiduite({ heuresPrevues: 14, heuresAbsence: 3.5, statut: "inscrit" }), {
    heures_absence: 3.5, heures_prevues: 14, heures_suivies: 10.5,
    taux: 75, fiable: true, raison: null, depassement: false,
  });
  // Les numériques de PostgreSQL arrivent en chaînes : le calcul doit tenir.
  assert.equal(calculerAssiduite({ heuresPrevues: "14.00", heuresAbsence: "3.50", statut: "en_cours" }).taux, 75);
});

test("l'assiduité est bornée entre 0 % et 100 %, et jamais inventée", () => {
  const abandon = calculerAssiduite({ heuresPrevues: 14, heuresAbsence: 3, statut: "abandon" });
  assert.equal(abandon.taux, null, "un abandon ne produit pas de taux");
  assert.equal(abandon.raison, "abandon");
  assert.equal(abandon.heures_absence, 3, "les absences connues restent affichées");

  const sansDuree = calculerAssiduite({ heuresPrevues: null, heuresAbsence: 3, statut: "inscrit" });
  assert.equal(sansDuree.taux, null);
  assert.equal(sansDuree.raison, "duree_inconnue");
  assert.equal(sansDuree.heures_absence, 3);

  assert.equal(calculerAssiduite({ heuresPrevues: 0, heuresAbsence: 3, statut: "inscrit" }).raison, "duree_inconnue");

  // Plus d'absences que d'heures prévues : on plancher à 0 % et on le signale
  // au lieu d'afficher un taux négatif.
  const depassement = calculerAssiduite({ heuresPrevues: 14, heuresAbsence: 20, statut: "inscrit" });
  assert.equal(depassement.taux, 0);
  assert.equal(depassement.heures_suivies, 0);
  assert.equal(depassement.depassement, true);

  // Aucune absence : 100 %, pas 100,0001.
  assert.equal(calculerAssiduite({ heuresPrevues: 14, heuresAbsence: 0, statut: "inscrit" }).taux, 100);
});

// ── Contrat HTTP ─────────────────────────────────────────────

const ADMIN = { id: 1, email: "admin@exemple.fr", nom: "Mme Stark", role: "admin" };
const CONTRIBUTEUR = { id: 2, email: "tukui@exemple.fr", nom: "Tukui", role: "contributeur" };
const AUTRE = { id: 3, email: "autre@exemple.fr", nom: "Autre", role: "autre" };
const SQL_UTILISATEUR = "SELECT id, email, nom, role FROM utilisateurs WHERE id = $1 AND actif";
const sqlNormalise = (text) => String(text).replace(/\s+/g, " ").trim();

// 14 h déclarées en dur sur la session, 21 h par défaut sur la formation :
// de quoi vérifier que la durée RÉELLE de la session prime.
const SESSION = {
  id: 7, date_debut: "2026-09-14", date_fin: "2026-09-16",
  duree_heures_reelle: "14.00", duree_heures_defaut: "21.00",
};
const INSCRIPTIONS = [
  { id: 11, session_id: 7, statut: "inscrit", civilite: "Mme", nom: "Stark", prenom: "Blandine" },
  { id: 12, session_id: 7, statut: "en_cours", civilite: "M.", nom: "Tonate", prenom: "Noé" },
  { id: 13, session_id: 7, statut: "abandon", civilite: null, nom: "Jones", prenom: "Amy" },
];

function baseSimulee({ absences = [], session = SESSION, inscriptions = INSCRIPTIONS } = {}) {
  const appels = [];
  const etat = absences.map((a) => ({
    id: a.id, inscription_id: a.inscription_id, date_absence: a.date_absence,
    demi_journee: a.demi_journee ?? null, duree_heures: a.duree_heures ?? null,
    justifiee: a.justifiee === true, motif: a.motif ?? null,
  }));
  let prochain = 1 + etat.reduce((n, a) => Math.max(n, a.id), 0);
  // Comme node-postgres : `rowCount` accompagne toujours les lignes.
  const res = (rows) => ({ rows, rowCount: rows.length });

  const executer = async (text, params) => {
    const sql = sqlNormalise(text);
    appels.push({ sql, params });

    if (sql === SQL_UTILISATEUR) {
      const u = [ADMIN, CONTRIBUTEUR, AUTRE].find((x) => x.id === params[0]);
      return res(u ? [u] : []);
    }

    // ── GET /api/sessions/:id/absences ──
    if (sql.startsWith("SELECT s.id, s.date_debut, s.date_fin, s.duree_heures_reelle")) {
      return res(params[0] === session.id ? [{ ...session }] : []);
    }
    if (sql.startsWith("SELECT i.id AS inscription_id")) {
      return res(inscriptions
        .filter((i) => i.session_id === params[0])
        .map((i) => ({
          inscription_id: i.id, statut: i.statut, stagiaire_id: i.id + 100,
          civilite: i.civilite, nom: i.nom, prenom: i.prenom,
        })));
    }
    if (sql.startsWith("SELECT a.id, a.inscription_id") && sql.includes("i.session_id = $1")) {
      const ids = new Set(inscriptions.filter((i) => i.session_id === params[0]).map((i) => i.id));
      return res(etat.filter((a) => ids.has(a.inscription_id)).map((a) => ({ ...a })));
    }

    // ── POST /api/inscriptions/:id/absences ──
    if (sql.startsWith("SELECT i.id, s.date_debut, s.date_fin")) {
      const i = inscriptions.find((x) => x.id === params[0]);
      return res(i ? [{ id: i.id, date_debut: session.date_debut, date_fin: session.date_fin }] : []);
    }
    if (sql.startsWith("SELECT 1 FROM absences") && !sql.includes("id <>")) {
      const [inscription_id, date, demi] = params;
      const trouve = etat.some((a) => a.inscription_id === inscription_id
        && a.date_absence === date && a.demi_journee === (demi ?? null));
      return res(trouve ? [{ existe: 1 }] : []);
    }
    if (sql.startsWith("INSERT INTO absences")) {
      const [inscription_id, date_absence, demi_journee, duree_heures, justifiee, motif] = params;
      const a = {
        id: prochain++, inscription_id, date_absence, demi_journee,
        duree_heures: Number(duree_heures).toFixed(2), justifiee, motif,
      };
      etat.push(a);
      return res([{ ...a }]);
    }

    // ── PATCH /api/absences/:id ──
    if (sql.startsWith("SELECT a.id, a.inscription_id") && sql.includes("a.id = $1")) {
      const a = etat.find((x) => x.id === params[0]);
      return res(a ? [{ ...a, date_debut: session.date_debut, date_fin: session.date_fin }] : []);
    }
    if (sql.startsWith("SELECT 1 FROM absences") && sql.includes("id <>")) {
      const [inscription_id, date, demi, id] = params;
      const trouve = etat.some((a) => a.inscription_id === inscription_id
        && a.date_absence === date && a.demi_journee === (demi ?? null) && a.id !== id);
      return res(trouve ? [{ existe: 1 }] : []);
    }
    if (sql.startsWith("UPDATE absences SET")) {
      const a = etat.find((x) => x.id === params[0]);
      if (!a) return res([]);
      // Les colonnes touchées sont lues dans le SQL : le test vérifie ainsi
      // ce qui a réellement été écrit, pas ce que la route prétend.
      for (const [, col, rang] of sql.matchAll(/([a-z_]+) = \$(\d+)/g)) {
        const v = params[Number(rang) - 1];
        // numeric(5,2) : PostgreSQL rend « 4.00 », jamais 4.
        a[col] = col === "duree_heures" && v !== null ? Number(v).toFixed(2) : v;
      }
      return res([{ ...a }]);
    }

    // ── DELETE /api/absences/:id ──
    if (sql.startsWith("DELETE FROM absences")) {
      const i = etat.findIndex((x) => x.id === params[0]);
      if (i < 0) return { rows: [], rowCount: 0 };
      etat.splice(i, 1);
      return { rows: [], rowCount: 1 };
    }

    throw new Error("Requête inattendue pour la base simulée : " + sql);
  };

  const base = {
    appels,
    absences: () => etat.map((a) => ({ ...a })),
    ecritures: () => appels.filter((a) => a.sql.startsWith("INSERT INTO absences")
      || a.sql.startsWith("UPDATE absences SET") || a.sql.startsWith("DELETE FROM absences")),
    installer: () => { setQueryExecutor(executer); return base; },
  };
  return base;
}

let serveur, origine;
before(async () => {
  serveur = createApp().listen(0);
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});
after(async () => {
  setQueryExecutor(null);   // rétablit la vraie couche base
  if (serveur) await new Promise((r) => serveur.close(r));
});

async function appel(methode, chemin, corps, utilisateur = ADMIN) {
  const r = await fetch(origine + chemin, {
    method: methode,
    headers: {
      "content-type": "application/json",
      ...(utilisateur ? { cookie: "vq_session=" + encode({ uid: utilisateur.id, exp: Date.now() + 60_000 }) } : {}),
    },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
}

const ajouter = (inscriptionId, corps, utilisateur = ADMIN) =>
  appel("POST", `/api/inscriptions/${inscriptionId}/absences`, corps, utilisateur);
const modifier = (absenceId, corps, utilisateur = ADMIN) =>
  appel("PATCH", `/api/absences/${absenceId}`, corps, utilisateur);
const supprimer = (absenceId, utilisateur = ADMIN) =>
  appel("DELETE", `/api/absences/${absenceId}`, undefined, utilisateur);
const lire = (sessionId = 7, utilisateur = ADMIN) =>
  appel("GET", `/api/sessions/${sessionId}/absences`, undefined, utilisateur);

// ── Lecture ──────────────────────────────────────────────────

test("un admin lit les absences d'une session", async () => {
  baseSimulee({ absences: [
    { id: 1, inscription_id: 11, date_absence: "2026-09-15", demi_journee: "matin", duree_heures: "3.50", justifiee: true },
  ] }).installer();
  const r = await lire();
  assert.equal(r.statut, 200);
  assert.equal(r.corps.total_heures_absence, 3.5);
  assert.equal(r.corps.session.heures_prevues, 14, "la durée réelle de la session prime sur celle de la formation");
  assert.equal(r.corps.session.source_heures_prevues, "duree_heures_reelle");
  assert.equal(r.corps.stagiaires.length, 3);
  const blandine = r.corps.stagiaires.find((s) => s.inscription_id === 11);
  assert.equal(blandine.absences.length, 1);
  assert.equal(blandine.total_heures_absence, 3.5);
  assert.equal(blandine.assiduite.taux, 75, "10,5 h suivies sur 14 h");
});

test("un contributeur lit les absences d'une session", async () => {
  baseSimulee().installer();
  const r = await lire(7, CONTRIBUTEUR);
  assert.equal(r.statut, 200);
});

test("la lecture est refusée sans authentification", async () => {
  baseSimulee().installer();
  const r = await lire(7, null);
  assert.equal(r.statut, 401);
});

test("une session inexistante ne donne pas 500", async () => {
  baseSimulee().installer();
  const r = await lire(999);
  assert.equal(r.statut, 404);
  assert.match(r.corps.error, /Session introuvable/);
});

test("un identifiant de session invalide ne donne pas 500", async () => {
  baseSimulee().installer();
  const r = await appel("GET", "/api/sessions/abc/absences", undefined, ADMIN);
  assert.equal(r.statut, 400);
});

test("le total d'heures d'absence additionne toutes les absences d'un stagiaire", async () => {
  baseSimulee({ absences: [
    { id: 1, inscription_id: 11, date_absence: "2026-09-14", demi_journee: "matin", duree_heures: "3.50" },
    { id: 2, inscription_id: 11, date_absence: "2026-09-14", demi_journee: "apres_midi", duree_heures: "3.50" },
    { id: 3, inscription_id: 12, date_absence: "2026-09-15", demi_journee: "journee", duree_heures: "7.00" },
  ] }).installer();
  const r = await lire();
  assert.equal(r.corps.total_heures_absence, 14);
  const blandine = r.corps.stagiaires.find((s) => s.inscription_id === 11);
  assert.equal(blandine.total_heures_absence, 7);
  assert.equal(blandine.assiduite.taux, 50, "7 h suivies sur 14 h");
  const noe = r.corps.stagiaires.find((s) => s.inscription_id === 12);
  assert.equal(noe.assiduite.taux, 50);
});

test("un abandon affiche ses absences mais aucun taux", async () => {
  baseSimulee({ absences: [
    { id: 1, inscription_id: 13, date_absence: "2026-09-14", demi_journee: "journee", duree_heures: "7.00" },
  ] }).installer();
  const r = await lire();
  const amy = r.corps.stagiaires.find((s) => s.inscription_id === 13);
  assert.equal(amy.assiduite.taux, null);
  assert.equal(amy.assiduite.raison, "abandon");
  assert.equal(amy.total_heures_absence, 7, "les absences connues restent visibles");
});

test("sans durée prévue, seul le total d'absences est rendu", async () => {
  baseSimulee({
    session: { ...SESSION, duree_heures_reelle: null, duree_heures_defaut: null },
    absences: [{ id: 1, inscription_id: 11, date_absence: "2026-09-14", demi_journee: "matin", duree_heures: "3.00" }],
  }).installer();
  const r = await lire();
  assert.equal(r.corps.session.heures_prevues, null);
  assert.equal(r.corps.session.source_heures_prevues, null);
  const blandine = r.corps.stagiaires.find((s) => s.inscription_id === 11);
  assert.equal(blandine.assiduite.taux, null);
  assert.equal(blandine.assiduite.raison, "duree_inconnue");
  assert.equal(blandine.total_heures_absence, 3);
});

// ── Ajout ────────────────────────────────────────────────────

test("un admin ajoute une absence", async () => {
  const base = baseSimulee().installer();
  const r = await ajouter(11, {
    date_absence: "2026-09-15", demi_journee: "matin", duree_heures: 3.5, justifiee: true, motif: "  rendez-vous médical  ",
  });
  assert.equal(r.statut, 201);
  assert.equal(base.absences().length, 1);
  const ecrite = base.absences()[0];
  assert.equal(ecrite.inscription_id, 11);
  assert.equal(ecrite.date_absence, "2026-09-15");
  assert.equal(ecrite.demi_journee, "matin");
  assert.equal(ecrite.duree_heures, "3.50", "arrondi au centième, comme numeric(5,2)");
  assert.equal(ecrite.justifiee, true);
  assert.equal(ecrite.motif, "rendez-vous médical", "motif rogné");
});

test("un contributeur ajoute une absence", async () => {
  const base = baseSimulee().installer();
  const r = await ajouter(12, { date_absence: "2026-09-14", duree_heures: 7 }, CONTRIBUTEUR);
  assert.equal(r.statut, 201);
  assert.equal(base.absences().length, 1);
});

test("une absence non justifiée est enregistrée comme telle", async () => {
  const base = baseSimulee().installer();
  const r = await ajouter(11, { date_absence: "2026-09-16", duree_heures: 3.5 });
  assert.equal(r.statut, 201);
  assert.equal(r.corps.absence.justifiee, false);
  assert.equal(base.absences()[0].justifiee, false);
});

test("la durée accepte la virgule décimale", async () => {
  const base = baseSimulee().installer();
  const r = await ajouter(11, { date_absence: "2026-09-14", duree_heures: "3,5" });
  assert.equal(r.statut, 201);
  assert.equal(base.absences()[0].duree_heures, "3.50");
});

test("une absence peut ne pas préciser sa demi-journée", async () => {
  const base = baseSimulee().installer();
  const r = await ajouter(11, { date_absence: "2026-09-14", duree_heures: 2 });
  assert.equal(r.statut, 201);
  assert.equal(base.absences()[0].demi_journee, null);
});

test("une inscription inexistante donne 404, pas 500", async () => {
  const base = baseSimulee().installer();
  const r = await ajouter(999, { date_absence: "2026-09-14", duree_heures: 2 });
  assert.equal(r.statut, 404);
  assert.match(r.corps.error, /Inscription introuvable/);
  assert.equal(base.absences().length, 0, "rien n'a été écrit");
});

test("un identifiant d'inscription invalide donne 400", async () => {
  baseSimulee().installer();
  for (const id of ["abc", "0", "-3", "1.5"]) {
    const r = await appel("POST", `/api/inscriptions/${id}/absences`, { date_absence: "2026-09-14", duree_heures: 2 });
    assert.equal(r.statut, 400, `identifiant ${id}`);
  }
});

test("une date d'absence invalide est refusée", async () => {
  const base = baseSimulee().installer();
  for (const date of ["", "14/09/2026", "2026-02-30", "2026-09-14T00:00:00Z", "hier"]) {
    const r = await ajouter(11, { date_absence: date, duree_heures: 2 });
    assert.equal(r.statut, 400, `date « ${date} »`);
  }
  assert.equal(base.absences().length, 0);
});

test("une date hors des dates de la session est refusée", async () => {
  const base = baseSimulee().installer();
  for (const date of ["2026-09-13", "2026-09-17"]) {
    const r = await ajouter(11, { date_absence: date, duree_heures: 2 });
    assert.equal(r.statut, 400, `date « ${date} »`);
    assert.match(r.corps.error, /dates de la session/);
  }
  // Les bornes exactes, elles, passent.
  assert.equal((await ajouter(11, { date_absence: "2026-09-14", duree_heures: 2 })).statut, 201);
  assert.equal((await ajouter(11, { date_absence: "2026-09-16", duree_heures: 2 })).statut, 201);
  assert.equal(base.absences().length, 2);
});

test("une durée invalide est refusée", async () => {
  const base = baseSimulee().installer();
  for (const duree of [0, -2, "", null, "abc", 24.5, 100, NaN]) {
    const r = await ajouter(11, { date_absence: "2026-09-14", duree_heures: duree });
    assert.equal(r.statut, 400, `durée ${String(duree)}`);
  }
  // La durée est obligatoire : on ne la déduit jamais d'une demi-journée.
  const sansDuree = await ajouter(11, { date_absence: "2026-09-14", demi_journee: "matin" });
  assert.equal(sansDuree.statut, 400);
  assert.equal(base.absences().length, 0);
});

test("une demi-journée hors des valeurs du CHECK SQL est refusée", async () => {
  const base = baseSimulee().installer();
  for (const demi of ["soir", "MATIN", "apres-midi", "jour"]) {
    const r = await ajouter(11, { date_absence: "2026-09-14", demi_journee: demi, duree_heures: 2 });
    assert.equal(r.statut, 400, `demi-journée « ${demi} »`);
  }
  assert.equal(base.absences().length, 0);
  // Les trois valeurs admises passent.
  for (const demi of ["matin", "apres_midi", "journee"]) {
    const r = await ajouter(11, { date_absence: "2026-09-14", demi_journee: demi, duree_heures: 2 });
    assert.equal(r.statut, 201, `demi-journée « ${demi} »`);
  }
});

test("un motif trop long est refusé", async () => {
  baseSimulee().installer();
  const r = await ajouter(11, { date_absence: "2026-09-14", duree_heures: 2, motif: "x".repeat(501) });
  assert.equal(r.statut, 400);
});

test("un doublon stagiaire / date / demi-journée est refusé", async () => {
  const base = baseSimulee({ absences: [
    { id: 1, inscription_id: 11, date_absence: "2026-09-15", demi_journee: "matin", duree_heures: "3.50" },
  ] }).installer();
  const r = await ajouter(11, { date_absence: "2026-09-15", demi_journee: "matin", duree_heures: 4 });
  assert.equal(r.statut, 409);
  assert.equal(base.absences().length, 1, "aucune seconde ligne");
});

test("le doublon tient compte de l'absence de demi-journée", async () => {
  // Deux absences « non précisée » le même jour seraient indiscernables,
  // alors qu'une le matin et une l'après-midi sont légitimes.
  const base = baseSimulee({ absences: [
    { id: 1, inscription_id: 11, date_absence: "2026-09-15", demi_journee: null, duree_heures: "3.50" },
  ] }).installer();
  assert.equal((await ajouter(11, { date_absence: "2026-09-15", duree_heures: 4 })).statut, 409);
  assert.equal((await ajouter(11, { date_absence: "2026-09-15", demi_journee: "matin", duree_heures: 4 })).statut, 201);
  assert.equal(base.absences().length, 2);
});

test("la même date est acceptée pour deux stagiaires différents", async () => {
  const base = baseSimulee({ absences: [
    { id: 1, inscription_id: 11, date_absence: "2026-09-15", demi_journee: "matin", duree_heures: "3.50" },
  ] }).installer();
  const r = await ajouter(12, { date_absence: "2026-09-15", demi_journee: "matin", duree_heures: 3.5 });
  assert.equal(r.statut, 201);
  assert.equal(base.absences().length, 2);
});

// ── Modification ─────────────────────────────────────────────

test("un admin modifie une absence", async () => {
  const base = baseSimulee({ absences: [
    { id: 1, inscription_id: 11, date_absence: "2026-09-15", demi_journee: "matin", duree_heures: "3.50", justifiee: false, motif: null },
  ] }).installer();
  const r = await modifier(1, { duree_heures: 4, justifiee: true, motif: "certificat" });
  assert.equal(r.statut, 200);
  const e = base.absences()[0];
  assert.equal(e.duree_heures, "4.00");
  assert.equal(e.justifiee, true);
  assert.equal(e.motif, "certificat");
  assert.equal(e.date_absence, "2026-09-15", "les champs absents du corps sont intacts");
  assert.equal(e.demi_journee, "matin");
  assert.equal(base.ecritures().filter((a) => a.sql.startsWith("UPDATE absences")).length, 1);
});

test("un contributeur modifie une absence", async () => {
  const base = baseSimulee({ absences: [
    { id: 1, inscription_id: 12, date_absence: "2026-09-15", demi_journee: "matin", duree_heures: "3.50" },
  ] }).installer();
  const r = await modifier(1, { justifiee: true }, CONTRIBUTEUR);
  assert.equal(r.statut, 200);
  assert.equal(base.absences()[0].justifiee, true);
});

test("une absence inexistante donne 404 à la modification", async () => {
  baseSimulee().installer();
  const r = await modifier(999, { duree_heures: 2 });
  assert.equal(r.statut, 404);
});

test("une modification vide est refusée", async () => {
  baseSimulee({ absences: [
    { id: 1, inscription_id: 11, date_absence: "2026-09-15", duree_heures: "3.50" },
  ] }).installer();
  const r = await modifier(1, {});
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /Rien à modifier/);
});

test("la modification valide les nouvelles valeurs", async () => {
  baseSimulee({ absences: [
    { id: 1, inscription_id: 11, date_absence: "2026-09-15", demi_journee: "matin", duree_heures: "3.50" },
  ] }).installer();
  assert.equal((await modifier(1, { date_absence: "2026-02-30" })).statut, 400);
  assert.equal((await modifier(1, { date_absence: "2026-09-20" })).statut, 400, "hors session");
  assert.equal((await modifier(1, { duree_heures: -1 })).statut, 400);
  assert.equal((await modifier(1, { duree_heures: 48 })).statut, 400);
  assert.equal((await modifier(1, { demi_journee: "soir" })).statut, 400);
  assert.equal((await modifier(1, { motif: "x".repeat(501) })).statut, 400);
});

test("déplacer une absence sur une autre est refusé", async () => {
  const base = baseSimulee({ absences: [
    { id: 1, inscription_id: 11, date_absence: "2026-09-15", demi_journee: "matin", duree_heures: "3.50" },
    { id: 2, inscription_id: 11, date_absence: "2026-09-16", demi_journee: "matin", duree_heures: "3.50" },
  ] }).installer();
  const r = await modifier(2, { date_absence: "2026-09-15" });
  assert.equal(r.statut, 409);
  assert.equal(base.absences().find((a) => a.id === 2).date_absence, "2026-09-16", "aucune écriture");
});

test("modifier une absence sur elle-même n'est pas un doublon", async () => {
  baseSimulee({ absences: [
    { id: 1, inscription_id: 11, date_absence: "2026-09-15", demi_journee: "matin", duree_heures: "3.50" },
  ] }).installer();
  const r = await modifier(1, { date_absence: "2026-09-15", demi_journee: "matin", duree_heures: 4 });
  assert.equal(r.statut, 200);
});

test("une absence peut passer de justifiée à non justifiée", async () => {
  const base = baseSimulee({ absences: [
    { id: 1, inscription_id: 11, date_absence: "2026-09-15", duree_heures: "3.50", justifiee: true },
  ] }).installer();
  const r = await modifier(1, { justifiee: false });
  assert.equal(r.statut, 200);
  assert.equal(base.absences()[0].justifiee, false);
});

test("un identifiant d'absence invalide donne 400", async () => {
  baseSimulee().installer();
  for (const id of ["abc", "0", "-1"]) {
    assert.equal((await modifier(id, { duree_heures: 2 })).statut, 400, `PATCH ${id}`);
    assert.equal((await supprimer(id)).statut, 400, `DELETE ${id}`);
  }
});

// ── Suppression ──────────────────────────────────────────────

test("un admin supprime une absence", async () => {
  const base = baseSimulee({ absences: [
    { id: 1, inscription_id: 11, date_absence: "2026-09-15", duree_heures: "3.50" },
  ] }).installer();
  const r = await supprimer(1);
  assert.equal(r.statut, 200);
  assert.equal(base.absences().length, 0);
});

test("un contributeur supprime une absence", async () => {
  const base = baseSimulee({ absences: [
    { id: 1, inscription_id: 11, date_absence: "2026-09-15", duree_heures: "3.50" },
  ] }).installer();
  const r = await supprimer(1, CONTRIBUTEUR);
  assert.equal(r.statut, 200);
  assert.equal(base.absences().length, 0);
});

test("une absence inexistante donne 404 à la suppression", async () => {
  baseSimulee().installer();
  const r = await supprimer(999);
  assert.equal(r.statut, 404);
});

test("la suppression ne touche qu'une seule absence", async () => {
  const base = baseSimulee({ absences: [
    { id: 1, inscription_id: 11, date_absence: "2026-09-15", duree_heures: "3.50" },
    { id: 2, inscription_id: 12, date_absence: "2026-09-15", duree_heures: "7.00" },
  ] }).installer();
  assert.equal((await supprimer(1)).statut, 200);
  assert.deepEqual(base.absences().map((a) => a.id), [2]);
});

// ── Authentification, droits, non-régression ─────────────────

test("aucune route d'absence n'est accessible sans authentification", async () => {
  baseSimulee().installer();
  assert.equal((await ajouter(11, { date_absence: "2026-09-14", duree_heures: 2 }, null)).statut, 401);
  assert.equal((await modifier(1, { duree_heures: 2 }, null)).statut, 401);
  assert.equal((await supprimer(1, null)).statut, 401);
});

test("un rôle non autorisé peut lire mais pas écrire", async () => {
  baseSimulee().installer();
  // L'écriture est réservée aux admins et aux contributeurs…
  assert.equal((await ajouter(11, { date_absence: "2026-09-14", duree_heures: 2 }, AUTRE)).statut, 403);
  assert.equal((await modifier(1, { duree_heures: 2 }, AUTRE)).statut, 403);
  assert.equal((await supprimer(1, AUTRE)).statut, 403);
  // …la lecture suit le reste du projet : tout compte authentifié y a accès.
  assert.equal((await lire(7, AUTRE)).statut, 200);
});

test("un cookie désignant un compte absent ne vaut pas une session", async () => {
  baseSimulee().installer();
  const fantome = { id: 99, email: "fantome@exemple.fr", nom: "Fantôme", role: "admin" };
  assert.equal((await lire(7, fantome)).statut, 401);
  assert.equal((await ajouter(11, { date_absence: "2026-09-14", duree_heures: 2 }, fantome)).statut, 401);
  assert.equal((await supprimer(1, fantome)).statut, 401);
});

test("les absences n'ouvrent aucun droit nouveau ailleurs", async () => {
  // Le contributeur gère les absences, et rien de plus : formations, sessions,
  // groupes, modèles restent hors de sa portée. Ces routes répondent AVANT
  // toute requête base — la base simulée n'a donc rien à connaître d'elles.
  baseSimulee().installer();
  assert.equal((await appel("POST", "/api/sessions", { formation_id: 1, date_debut: "2026-09-14", date_fin: "2026-09-15" }, CONTRIBUTEUR)).statut, 403);
  assert.equal((await appel("PUT", "/api/formations/1", { intitule: "X" }, CONTRIBUTEUR)).statut, 403);
  assert.equal((await appel("POST", "/api/sessions/7/groupes", { nom: "Groupe A" }, CONTRIBUTEUR)).statut, 403);
  assert.equal((await appel("PATCH", "/api/sessions/7", { horaire: "8h-12h" }, CONTRIBUTEUR)).statut, 403);
  assert.equal((await appel("DELETE", "/api/modeles/1", undefined, CONTRIBUTEUR)).statut, 403);
});

test("les droits existants sur les inscriptions restent inchangés", async () => {
  // La route qui existait avant L2 doit continuer de répondre comme avant :
  // un corps vide est refusé, un identifiant inconnu donne 404.
  baseSimulee().installer();
  const vide = await appel("PATCH", "/api/inscriptions/11", {}, ADMIN);
  assert.equal(vide.statut, 400);
});
