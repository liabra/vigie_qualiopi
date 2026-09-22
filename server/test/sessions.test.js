// L4 — Sessions corrigeables et cycle de vie.
// Contrat HTTP de PATCH /api/sessions/:id : un ADMIN peut reprendre les
// champs d'une session (référence, dates, lieu, formateur, durée, horaire,
// statut), jamais toucher aux documents déjà générés — la route signale
// seulement qu'ils peuvent être obsolètes. Le contributeur reste en
// lecture, l'anonyme est refusé, et chaque saisie invalide répond 400.
//
// La route est éprouvée sur l'application Express RÉELLE, la couche base
// remplacée par une base SIMULÉE (db.setQueryExecutor) : aucun PostgreSQL
// nécessaire, `npm test` reste hermétique. La base simulée refuse toute
// requête qu'elle ne connaît pas — si la route se mettait un jour à écrire
// dans `generations` ou `documents_generes`, ces tests échoueraient.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { setQueryExecutor } from "../src/db.js";
import { encode } from "../src/session.js";

const ADMIN = { id: 1, email: "admin@exemple.fr", nom: "Mme Stark", role: "admin" };
const CONTRIBUTEUR = { id: 2, email: "tukui@exemple.fr", nom: "Tukui", role: "contributeur" };
const SQL_UTILISATEUR = "SELECT id, email, nom, role FROM utilisateurs WHERE id = $1 AND actif";
const SQL_SESSION = "SELECT * FROM sessions WHERE id = $1";
const sqlNormalise = (text) => String(text).replace(/\s+/g, " ").trim();

const sessionDefaut = {
  id: 7, reference: "SESS-1", date_debut: "2026-01-05", date_fin: "2026-03-05",
  lieu: "Cayenne", formateur: "Mme Carr", duree_heures_reelle: "28.00",
  horaire: null, statut: "planifiee", formation_id: 3,
};

// Enregistre chaque requête reçue et rejoue fidèlement l'UPDATE (plusieurs
// colonnes) : les tests vérifient ainsi ce que la route a RÉELLEMENT écrit.
function baseSimulee({ session = {}, doublonReference = null, absences = [] } = {}) {
  const appels = [];
  let etat = { ...sessionDefaut, ...session };
  const executer = async (text, params) => {
    const sql = sqlNormalise(text);
    appels.push({ sql, params });
    if (sql === SQL_UTILISATEUR) {
      const u = [ADMIN, CONTRIBUTEUR].find((x) => x.id === params[0]);
      return { rows: u ? [u] : [] };
    }
    if (sql === SQL_SESSION) {
      return params[0] === etat.id ? { rows: [{ ...etat }] } : { rows: [] };
    }
    if (sql.startsWith("SELECT count(*)::int AS n FROM absences")) {
      const [, debut, fin] = params;   // id, debut, fin
      return { rows: [{ n: absences.filter((a) => a.date_absence < debut || a.date_absence > fin).length }] };
    }
    if (sql.startsWith("SELECT COALESCE(sum(a.duree_heures)")) {
      const total = absences.reduce((s, a) => s + (Number(a.duree_heures) || 0), 0);
      return { rows: [{ total }] };
    }
    const m = /^UPDATE sessions SET (.+) WHERE id = \$1 RETURNING \*$/.exec(sql);
    if (m) {
      if (params[0] !== etat.id) return { rows: [] };
      const colonnes = m[1].split(",").map((c) => c.trim().split(" = ")[0]);
      const prochaine = { ...etat };
      colonnes.forEach((col, i) => { prochaine[col] = params[i + 1]; });
      if (doublonReference !== null && prochaine.reference === doublonReference) {
        const e = new Error("référence en double");
        e.code = "23505";
        throw e;
      }
      etat = prochaine;
      return { rows: [{ ...etat }] };
    }
    throw new Error("Requête inattendue pour la base simulée : " + sql);
  };
  const base = {
    appels,
    etat: () => etat,
    ecritures: () => appels.filter((a) => a.sql.startsWith("UPDATE sessions SET")),
  };
  base.installer = () => { setQueryExecutor(executer); return base; };
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

const patcher = async (id, corps, utilisateur = ADMIN) => {
  const r = await fetch(`${origine}/api/sessions/${id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(utilisateur ? { cookie: "vq_session=" + encode({ uid: utilisateur.id, exp: Date.now() + 60_000 }) } : {}),
    },
    body: JSON.stringify(corps),
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};

// ── Champs modifiables ────────────────────────────────────────

test("l'admin corrige la référence, les dates, le lieu et le formateur", async () => {
  const b = baseSimulee().installer();
  const r = await patcher(7, {
    reference: "SESS-2", date_debut: "2026-01-12", date_fin: "2026-03-19",
    lieu: "  Kourou  ", formateur: "M. Jones",
  });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.session.reference, "SESS-2");
  assert.equal(r.corps.session.date_debut, "2026-01-12");
  assert.equal(r.corps.session.date_fin, "2026-03-19");
  assert.equal(r.corps.session.lieu, "Kourou", "les espaces sont rognés");
  assert.equal(r.corps.session.formateur, "M. Jones");
  assert.equal(r.corps.documentsObsoletes, true, "ces champs sont imprimés sur les documents");
});

test("l'admin corrige la durée et l'horaire, un texte vide efface", async () => {
  const b = baseSimulee().installer();
  const r = await patcher(7, { duree_heures_reelle: 30, horaire: " 8h30–12h00 " });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.session.duree_heures_reelle, 30);
  assert.equal(r.corps.session.horaire, "8h30–12h00", "horaire normalisé");
  assert.equal(r.corps.documentsObsoletes, true);

  const r2 = await patcher(7, { horaire: "", lieu: "" });
  assert.equal(r2.statut, 200);
  assert.equal(r2.corps.session.horaire, null);
  assert.equal(r2.corps.session.lieu, null);
});

test("l'admin change le statut, sans effet sur les documents", async () => {
  const b = baseSimulee().installer();
  const r = await patcher(7, { statut: "terminee" });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.session.statut, "terminee");
  assert.equal(r.corps.documentsObsoletes, false, "le statut n'est pas imprimé sur les documents");
  assert.equal(b.etat().statut, "terminee");
});

test("une modification multi-champs applique tout en une écriture", async () => {
  const b = baseSimulee().installer();
  const r = await patcher(7, { reference: "SESS-3", lieu: "Soula", statut: "en_cours" });
  assert.equal(r.statut, 200);
  assert.equal(b.ecritures().length, 1);
  assert.deepEqual(b.etat(), { ...sessionDefaut, reference: "SESS-3", lieu: "Soula", statut: "en_cours" });
});

test("une correction sans changement réel ne marque pas les documents obsolètes", async () => {
  const b = baseSimulee().installer();
  const r = await patcher(7, { lieu: "Cayenne", reference: "SESS-1" });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.documentsObsoletes, false);
});

test("« 28 » égale « 28.00 » pour la durée : pas d'obsolescence factice", async () => {
  const b = baseSimulee().installer();
  const r = await patcher(7, { duree_heures_reelle: "28" });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.documentsObsoletes, false);
});

// ── Règles de saisie ──────────────────────────────────────────

test("un corps vide répond 400 « Rien à modifier »", async () => {
  const b = baseSimulee().installer();
  const r = await patcher(7, {});
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /rien à modifier/i);
  assert.equal(b.ecritures().length, 0);
});

test("les dates invalides ou croisées sont refusées", async () => {
  for (const corps of [{ date_debut: "2026-02-31" }, { date_debut: "01/05/2026" }, { date_fin: "31-12-2026" }]) {
    const r = await patcher(7, corps);
    assert.equal(r.statut, 400, JSON.stringify(corps));
    assert.match(r.corps.error, /date/i);
  }
  // fin avant début — y compris contre la date restée en base
  const croise = await patcher(7, { date_debut: "2026-04-01" });
  assert.equal(croise.statut, 400);
  assert.match(croise.corps.error, /précède/i);
});

test("une durée nulle, négative ou non numérique est refusée", async () => {
  for (const mauvaise of [0, -5, "abc", "12,5"]) {
    const r = await patcher(7, { duree_heures_reelle: mauvaise });
    assert.equal(r.statut, 400, JSON.stringify(mauvaise));
    assert.match(r.corps.error, /durée prévue invalide/i);
  }
});

test("un statut hors liste est refusé avant toute écriture", async () => {
  const b = baseSimulee().installer();
  const r = await patcher(7, { statut: "suspendue" });
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /statut de session inconnu/i);
  assert.equal(b.ecritures().length, 0);
});

test("une référence vide est refusée, mais null l'efface", async () => {
  const vide = await patcher(7, { reference: "   " });
  assert.equal(vide.statut, 400);
  assert.match(vide.corps.error, /référence ne peut pas être vide/i);

  const efface = await patcher(7, { reference: null });
  assert.equal(efface.statut, 200);
  assert.equal(efface.corps.session.reference, null);
});

test("une référence déjà prise par une autre session répond 409", async () => {
  baseSimulee({ doublonReference: "DEJA-PRISE" }).installer();
  const r = await patcher(7, { reference: "DEJA-PRISE" });
  assert.equal(r.statut, 409);
  assert.match(r.corps.error, /référence est déjà utilisée/i);
});

// ── Identifiants et accès ─────────────────────────────────────

test("un identifiant non numérique répond 400", async () => {
  const r = await patcher("abc", { statut: "terminee" });
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /identifiant de session invalide/i);
});

test("une session inexistante répond 404 sans rien écrire", async () => {
  const b = baseSimulee().installer();
  const r = await patcher(999999, { statut: "annulee" });
  assert.equal(r.statut, 404);
  assert.match(r.corps.error, /introuvable/i);
  assert.equal(b.ecritures().length, 0, "la lecture échoue avant toute écriture");
});

test("le contributeur ne peut pas corriger une session", async () => {
  const b = baseSimulee().installer();
  const r = await patcher(7, { statut: "annulee" }, CONTRIBUTEUR);
  assert.equal(r.statut, 403);
  assert.equal(b.ecritures().length, 0);
  assert.equal(b.appels.some((a) => a.sql === SQL_SESSION), false, "la session n'est même pas lue");
});

test("sans connexion, la correction est refusée", async () => {
  const b = baseSimulee().installer();
  const r = await patcher(7, { statut: "annulee" }, null);
  assert.equal(r.statut, 401);
  assert.equal(b.ecritures().length, 0);
});

// ── Les documents ne sont jamais régénérés ────────────────────

test("corriger un champ imprimé n'écrit ni generation ni document", async () => {
  const b = baseSimulee().installer();
  const r = await patcher(7, { reference: "SESS-4", date_debut: "2026-01-19", duree_heures_reelle: 35 });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.documentsObsoletes, true);
  // La base simulée aurait levé sur toute requête hors des trois connues :
  // aucune INSERT/UPDATE sur generations ou documents_generes n'a pu passer.
  for (const a of b.appels) {
    const connu =
      a.sql === SQL_UTILISATEUR || a.sql === SQL_SESSION ||
      /^UPDATE sessions SET /.test(a.sql) ||
      a.sql.startsWith("SELECT count(*)::int AS n FROM absences") ||
      a.sql.startsWith("SELECT COALESCE(sum(a.duree_heures)");
    assert.ok(connu, "requête inattendue : " + a.sql);
  }
});

// ── Dates vs absences existantes ──────────────────────────────

test("corriger les dates sans absence hors période est accepté", async () => {
  const b = baseSimulee({ absences: [{ date_absence: "2026-02-10", duree_heures: 3.5 }] }).installer();
  const r = await patcher(7, { date_debut: "2026-01-10", date_fin: "2026-02-28" });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.session.date_debut, "2026-01-10");
  assert.equal(r.corps.session.date_fin, "2026-02-28");
});

test("un date_debut qui exclut une absence répond 400", async () => {
  const b = baseSimulee({ absences: [{ date_absence: "2026-02-10", duree_heures: 3.5 }] }).installer();
  const r = await patcher(7, { date_debut: "2026-02-15" });
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /1 absence tomberait hors/);
  assert.equal(b.ecritures().length, 0, "aucune écriture");
});

test("un date_fin qui exclut une absence répond 400", async () => {
  const b = baseSimulee({ absences: [{ date_absence: "2026-02-10", duree_heures: 3.5 }] }).installer();
  const r = await patcher(7, { date_fin: "2026-02-01" });
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /1 absence tomberait hors/);
  assert.equal(b.ecritures().length, 0);
});

test("les deux dates qui excluent une absence répondent 400", async () => {
  const b = baseSimulee({ absences: [{ date_absence: "2026-02-10", duree_heures: 3.5 }] }).installer();
  const r = await patcher(7, { date_debut: "2026-02-01", date_fin: "2026-02-05" });
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /1 absence tomberait hors/);
});

test("plusieurs absences hors période sont comptées, sans écriture partielle", async () => {
  const b = baseSimulee({
    absences: [
      { date_absence: "2026-02-10", duree_heures: 3.5 },
      { date_absence: "2026-02-20", duree_heures: 2 },
    ],
  }).installer();
  const r = await patcher(7, { date_debut: "2026-03-01", reference: "AUTRE" });
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /2 absences tomberaient hors/);
  assert.equal(b.ecritures().length, 0, "aucune écriture partielle");
  assert.equal(b.etat().reference, "SESS-1", "la référence n'a pas bougé");
  assert.equal(b.etat().date_debut, "2026-01-05", "la date n'a pas bougé");
});

// ── Durée prévue vs absences ─────────────────────────────────

test("réduire la durée sous le total d'absences signale le dépassement", async () => {
  const b = baseSimulee({
    absences: [
      { date_absence: "2026-01-06", duree_heures: 3 },
      { date_absence: "2026-01-07", duree_heures: 7 },
    ],
  }).installer();
  const r = await patcher(7, { duree_heures_reelle: 7 });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.absencesDepassentDuree, true);
  assert.equal(r.corps.total_heures_absence, 10);
});

test("une durée au-dessus du total d'absences ne signale rien", async () => {
  const b = baseSimulee({ absences: [{ date_absence: "2026-01-06", duree_heures: 3 }] }).installer();
  const r = await patcher(7, { duree_heures_reelle: 10 });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.absencesDepassentDuree, undefined);
  assert.equal(r.corps.total_heures_absence, undefined);
});

test("effacer la durée prévue ne signale pas de dépassement", async () => {
  const b = baseSimulee({ absences: [{ date_absence: "2026-01-06", duree_heures: 30 }] }).installer();
  const r = await patcher(7, { duree_heures_reelle: "" });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.session.duree_heures_reelle, null);
  assert.equal(r.corps.absencesDepassentDuree, undefined);
});
