// Après VF — archivage / restauration / suppression des sessions.
// Contrat HTTP des routes PATCH /api/sessions/:id/archive, /restaure et
// DELETE /api/sessions/:id, plus le filtrage Actives/Archivées de
// GET /api/sessions et le refus des écritures sur session archivée.
//
// Même méthode que le reste de la suite : application Express RÉELLE,
// base SIMULÉE (setQueryExecutor) qui refuse toute requête inattendue.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { setQueryExecutor } from "../src/db.js";
import { encode } from "../src/session.js";

const ADMIN = { id: 1, email: "admin@exemple.fr", nom: "Mme Stark", role: "admin" };
const CONTRIBUTEUR = { id: 2, email: "tukui@exemple.fr", nom: "Tukui", role: "contributeur" };
const SQL_UTILISATEUR = "SELECT id, email, nom, role FROM utilisateurs WHERE id = $1 AND actif";
const sqlNormalise = (text) => String(text).replace(/\s+/g, " ").trim();

// Base simulée : UNE session (id 7), un drapeau `archivee`, et des compteurs
// de dépendances réglables. Elle capture les écritures réellement exécutées.
function baseSimulee({ archivee = false, dependances = {} } = {}) {
  const appels = [];
  const etat = {
    id: 7, reference: "SESS-1", date_debut: "2026-01-05", date_fin: "2026-03-05",
    lieu: "Cayenne", formateur: "Mme Carr", duree_heures_reelle: "28.00",
    horaire: null, statut: "planifiee", formation_id: 3, archivee_le: archivee ? "2026-09-29T10:00:00Z" : null, archivee_par: archivee ? 1 : null,
  };
  const comptes = {
    groupes: 0, inscriptions: 0, absences: 0, resultats_qcm: 0, satisfactions: 0,
    generations: 0, documents_generes: 0, preuves: 0, ...dependances,
  };
  const supprimee = { valeur: false };

  const executer = async (text, params) => {
    const sql = sqlNormalise(text);
    appels.push({ sql, params });
    if (sql === SQL_UTILISATEUR) {
      const u = [ADMIN, CONTRIBUTEUR].find((x) => x.id === params[0]);
      return { rows: u ? [u] : [] };
    }
    if (sql === "SELECT * FROM sessions WHERE id = $1") {
      return params[0] === etat.id ? { rows: [{ ...etat }] } : { rows: [] };
    }
    if (sql === "SELECT id FROM sessions WHERE id = $1") {
      return params[0] === etat.id ? { rows: [{ id: etat.id }] } : { rows: [] };
    }
    if (sql === "SELECT archivee_le FROM sessions WHERE id = $1") {
      return params[0] === etat.id ? { rows: [{ archivee_le: etat.archivee_le }] } : { rows: [] };
    }
    const mArchive = /^UPDATE sessions SET archivee_le = now\(\), archivee_par = \$2 WHERE id = \$1 RETURNING \*$/.exec(sql);
    if (mArchive) {
      if (params[0] !== etat.id) return { rows: [] };
      etat.archivee_le = "2026-09-29T10:00:00Z"; etat.archivee_par = params[1];
      return { rows: [{ ...etat }] };
    }
    const mRestaure = /^UPDATE sessions SET archivee_le = NULL, archivee_par = NULL WHERE id = \$1 RETURNING \*$/.exec(sql);
    if (mRestaure) {
      if (params[0] !== etat.id) return { rows: [] };
      etat.archivee_le = null; etat.archivee_par = null;
      return { rows: [{ ...etat }] };
    }
    if (sql.startsWith("SELECT (SELECT count(*) FROM groupes")) {
      return { rows: [{ ...comptes }] };
    }
    if (sql === "DELETE FROM sessions WHERE id = $1") {
      if (params[0] !== etat.id) return { rows: [], rowCount: 0 };
      supprimee.valeur = true;
      return { rows: [], rowCount: 1 };
    }
    // PATCH /sessions/:id (session restaurée modifiable) : UPDATE générique.
    const mMaj = /^UPDATE sessions SET (.+) WHERE id = \$1 RETURNING \*$/.exec(sql);
    if (mMaj) {
      if (params[0] !== etat.id) return { rows: [] };
      const colonnes = mMaj[1].split(",").map((c) => c.trim().split(" = ")[0]);
      colonnes.forEach((col, i) => { etat[col] = params[i + 1]; });
      return { rows: [{ ...etat }] };
    }
    // GET /api/sessions : liste, filtrée sur archivee_le.
    if (sql.startsWith("SELECT s.id, s.reference, s.date_debut")) {
      const archives = sql.includes("s.archivee_le IS NOT NULL");
      const visible = archives ? !!etat.archivee_le : !etat.archivee_le;
      return {
        rows: visible ? [{
          id: etat.id, reference: etat.reference, date_debut: etat.date_debut, date_fin: etat.date_fin,
          statut: etat.statut, lieu: etat.lieu, horaire: etat.horaire, archivee_le: etat.archivee_le,
          formation: "Atelier", nb_inscrits: 0, groupes: [],
        }] : [],
      };
    }
    throw new Error("Requête inattendue pour la base simulée : " + sql);
  };
  const base = {
    appels,
    etat: () => etat,
    supprimee: () => supprimee.valeur,
    ecritures: () => appels.filter((a) => a.sql.startsWith("UPDATE sessions") || a.sql.startsWith("DELETE FROM sessions")),
    installer: () => { setQueryExecutor(executer); return base; },
  };
  return base;
}

let serveur, origine;
before(async () => {
  serveur = createApp().listen(0, "127.0.0.1"); // fix : même pile que l'origine (aucun port partagé avec un autre fichier)
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});
after(async () => {
  setQueryExecutor(null);
  if (serveur) await new Promise((r) => serveur.close(r));
});

const appeler = async (methode, chemin, utilisateur = ADMIN, corps = undefined) => {
  const r = await fetch(origine + chemin, {
    method: methode,
    headers: {
      "content-type": "application/json",
      ...(utilisateur ? { cookie: "vq_session=" + encode({ uid: utilisateur.id, exp: Date.now() + 60_000 }) } : {}),
    },
    ...(corps !== undefined ? { body: JSON.stringify(corps) } : {}),
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};

// ── Archivage ────────────────────────────────────────────────

test("un admin archive une session : archivee_le posé, archivee_par tracé", async () => {
  const b = baseSimulee().installer();
  const r = await appeler("PATCH", "/api/sessions/7/archive", ADMIN);
  assert.equal(r.statut, 200);
  assert.ok(r.corps.session.archivee_le, "la date d'archivage est renseignée");
  assert.equal(r.corps.session.archivee_par, 1, "l'admin qui a archivé est tracé");
  const ecr = b.ecritures();
  assert.equal(ecr.length, 1);
  assert.match(ecr[0].sql, /archivee_le = now\(\)/);
});

test("un contributeur ne peut pas archiver (403), un anonyme non plus (401)", async () => {
  baseSimulee().installer();
  assert.equal((await appeler("PATCH", "/api/sessions/7/archive", CONTRIBUTEUR)).statut, 403);
  assert.equal((await appeler("PATCH", "/api/sessions/7/archive", null)).statut, 401);
});

test("un admin restaure une session archivée : archivee_le revient à NULL", async () => {
  const b = baseSimulee({ archivee: true }).installer();
  const r = await appeler("PATCH", "/api/sessions/7/restaure", ADMIN);
  assert.equal(r.statut, 200);
  assert.equal(r.corps.session.archivee_le, null);
  assert.equal(b.etat().archivee_le, null);
});

test("archiver une session inexistante répond 404, un identifiant invalide 400", async () => {
  baseSimulee().installer();
  assert.equal((await appeler("PATCH", "/api/sessions/999/archive", ADMIN)).statut, 404);
  assert.equal((await appeler("PATCH", "/api/sessions/abc/archive", ADMIN)).statut, 400);
});

// ── Lecture seule sur session archivée ───────────────────────

test("une session archivée refuse une modification (PATCH)", async () => {
  baseSimulee({ archivee: true }).installer();
  const r = await appeler("PATCH", "/api/sessions/7", ADMIN, { statut: "terminee" });
  assert.equal(r.statut, 409);
  assert.match(r.corps.error, /archivée/);
});

test("une session restaurée redevient modifiable", async () => {
  const b = baseSimulee({ archivee: true }).installer();
  await appeler("PATCH", "/api/sessions/7/restaure", ADMIN);
  const r = await appeler("PATCH", "/api/sessions/7", ADMIN, { statut: "terminee" });
  assert.equal(r.statut, 200);
  assert.equal(b.etat().statut, "terminee");
});

test("une session archivée refuse l'ajout d'un groupe (écriture enfant refusée)", async () => {
  baseSimulee({ archivee: true }).installer();
  const r = await appeler("POST", "/api/sessions/7/groupes", ADMIN, { nom: "Groupe A" });
  assert.equal(r.statut, 409);
  assert.match(r.corps.error, /archivée/);
});

// ── Suppression définitive ───────────────────────────────────

test("une session réellement vide peut être supprimée", async () => {
  const b = baseSimulee().installer();
  const r = await appeler("DELETE", "/api/sessions/7", ADMIN);
  assert.equal(r.statut, 200);
  assert.equal(r.corps.ok, true);
  assert.ok(b.supprimee(), "le DELETE est bien exécuté");
});

test("une session avec des stagiaires/évaluations refuse la suppression (409, aucune cascade)", async () => {
  const b = baseSimulee({ dependances: { inscriptions: 3, absences: 1, resultats_qcm: 2 } }).installer();
  const r = await appeler("DELETE", "/api/sessions/7", ADMIN);
  assert.equal(r.statut, 409);
  assert.match(r.corps.error, /Archivez-la plutôt/);
  assert.ok(!b.supprimee(), "aucun DELETE exécuté : pas de suppression partielle ni de cascade");
});

test("une session avec des documents générés ou des preuves refuse la suppression", async () => {
  baseSimulee({ dependances: { documents_generes: 1, preuves: 2 } }).installer();
  const r = await appeler("DELETE", "/api/sessions/7", ADMIN);
  assert.equal(r.statut, 409);
});

test("supprimer une session inexistante répond 404, un identifiant invalide 400", async () => {
  baseSimulee().installer();
  assert.equal((await appeler("DELETE", "/api/sessions/999", ADMIN)).statut, 404);
  assert.equal((await appeler("DELETE", "/api/sessions/abc", ADMIN)).statut, 400);
});

test("un contributeur ne peut pas supprimer (403)", async () => {
  baseSimulee().installer();
  assert.equal((await appeler("DELETE", "/api/sessions/7", CONTRIBUTEUR)).statut, 403);
});

// ── Liste Actives / Archivées ────────────────────────────────

test("GET /sessions renvoie les actives par défaut, les archivées avec ?etat=archivees", async () => {
  baseSimulee({ archivee: true }).installer();
  const actives = await appeler("GET", "/api/sessions", ADMIN);
  assert.equal(actives.corps.sessions.length, 0, "la session archivée ne pollue pas la liste active");
  const archives = await appeler("GET", "/api/sessions?etat=archivees", ADMIN);
  assert.equal(archives.corps.sessions.length, 1, "la session archivée est consultable via la vue Archivées");
  assert.ok(archives.corps.sessions[0].archivee_le);
});

test("un contributeur consulte la liste des archivées (lecture), sans action", async () => {
  baseSimulee({ archivee: true }).installer();
  const archives = await appeler("GET", "/api/sessions?etat=archivees", CONTRIBUTEUR);
  assert.equal(archives.statut, 200);
  assert.equal(archives.corps.sessions.length, 1);
  assert.equal((await appeler("PATCH", "/api/sessions/7/archive", CONTRIBUTEUR)).statut, 403);
});
