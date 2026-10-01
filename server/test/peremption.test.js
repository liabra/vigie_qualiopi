// ─────────────────────────────────────────────────────────────
//  TIME-2 — Péremption des preuves (vue preuves_enrichies) au jour civil
//  de Cayenne, quel que soit le fuseau de la session PostgreSQL.
//  Base PostgreSQL RÉELLE et vierge. Données fictives.
//
//  Instants fixes : la définition RÉELLEMENT installée de la vue
//  (pg_get_viewdef) est réévaluée en remplaçant l'instant courant par un
//  instant donné — `now()` ⇒ l'instant, `CURRENT_DATE` ⇒ sa date dans le
//  fuseau de la session (sémantique PostgreSQL exacte). Aucun crochet de
//  test n'est ajouté en production.
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
import { dateMetierAujourdhui } from "../src/services/dates.js";

const PORT = 55454; // distinct des autres fichiers (55445-55447, 55449-55453)
const DATA = path.join(os.tmpdir(), "vq-peremption-" + process.pid);
const FUSEAUX_SESSION = ["UTC", "Asia/Tokyo", "Pacific/Kiritimati", "America/Cayenne", "America/Los_Angeles"];
// Colonnes exposées AVANT TIME-2 (34) : la migration ne doit rien changer.
const COLONNES = "id:integer, indicateur_id:integer, formation_id:integer, session_id:integer, titre:text, description:text, type_alerte:text, periodicite_mois:smallint, date_echeance:date, date_derniere_revision:date, veille_id:integer, statut:text, created_by:integer, created_at:timestamp with time zone, updated_at:timestamp with time zone, source:text, a_confirmer:boolean, motif_confirmation:text, candidats:jsonb, modele_nom:text, tache:text, etat_source:text, occurrences:smallint, lignes_source:integer[], import_id:integer, validee_le:timestamp with time zone, validee_par:integer, mode_fichiers:text, groupe_id:integer, nb_fichiers:integer, fichiers_attendus:integer, incomplet:boolean, statut_effectif:text, alerte_statut:text";

let cluster, pool, serveur, origine, adminId, indicateurId;
const P = {};

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
  ({ rows: [{ id: adminId }] } = await pool.query("INSERT INTO utilisateurs (email, nom, role) VALUES ('admin@p.local', 'Mme Stark', 'admin') RETURNING id"));
  ({ rows: [{ id: indicateurId }] } = await pool.query("SELECT id FROM indicateurs ORDER BY id LIMIT 1"));
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

const preuve = async (titre, champs) => {
  const cols = ["indicateur_id", "titre", ...Object.keys(champs)];
  const vals = [indicateurId, titre, ...Object.values(champs)];
  const { rows: [p] } = await pool.query(
    `INSERT INTO preuves (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, vals);
  return p.id;
};

// Évalue la définition installée de la vue à un instant donné, dans un
// fuseau de session donné.
async function statutsA(instant, fuseau) {
  const def = (await pool.query("SELECT pg_get_viewdef('preuves_enrichies'::regclass, true) AS d")).rows[0].d.trim().replace(/;$/, "");
  const fige = `'${instant}'::timestamptz`;
  const sql = def.replace(/\bnow\(\)/g, fige).replace(/\bCURRENT_DATE\b/g, `(${fige})::date`);
  assert.ok(!/\bnow\(\)|\bCURRENT_DATE\b/.test(sql), "toutes les références à l'instant courant sont figées");
  const c = await pool.connect();
  try {
    await c.query(`SET TimeZone = '${fuseau}'`);
    const { rows } = await c.query(`SELECT id, alerte_statut FROM (${sql}) v WHERE id = ANY($1)`, [Object.values(P)]);
    return Object.fromEntries(rows.map((r) => [Object.keys(P).find((k) => P[k] === r.id), r.alerte_statut]));
  } finally { c.release(); }
}

test("préparation : preuves à échéance fixe et à révision périodique autour du 2 octobre 2026", async () => {
  P.echeance2oct = await preuve("Échéance 02/10", { type_alerte: "echeance_fixe", date_echeance: "2026-10-02" });
  P.echeance1nov = await preuve("Échéance 01/11", { type_alerte: "echeance_fixe", date_echeance: "2026-11-01" });
  P.revision2oct = await preuve("Révision due 02/10", { type_alerte: "revision_periodique", periodicite_mois: 1, date_derniere_revision: "2026-09-02" });
  // Créée le 1er septembre à 22 h à Cayenne (2 septembre en UTC), jamais révisée : due le 1er octobre.
  P.creee1sept = await preuve("Créée le 01/09 au soir", { type_alerte: "revision_periodique", periodicite_mois: 1, created_at: "2026-09-02T01:00:00Z" });
  P.sansAlerte = await preuve("Sans alerte", {});
});

test("01/10 21 h 30 à Cayenne (2026-10-02T00:30Z) : rien n'est périmé prématurément, quel que soit le fuseau de session", async () => {
  for (const tz of FUSEAUX_SESSION) {
    const s = await statutsA("2026-10-02 00:30:00+00", tz);
    assert.equal(s.echeance2oct, "bientot", `${tz} : l'échéance du 02/10 n'est pas encore passée`);
    assert.equal(s.revision2oct, "bientot", `${tz} : la révision due le 02/10 n'est pas encore passée`);
    assert.equal(s.echeance1nov, "ok", `${tz} : 01/11 > 01/10 + 30 jours`);
    assert.equal(s.creee1sept, "perime", `${tz} : base = jour de création à Cayenne (01/09)`);
    assert.equal(s.sansAlerte, null);
  }
});

test("01/10 23 h 59 min 59 s à Cayenne (2026-10-02T02:59:59Z) : toujours le 01/10", async () => {
  for (const tz of FUSEAUX_SESSION) {
    const s = await statutsA("2026-10-02 02:59:59+00", tz);
    assert.equal(s.echeance2oct, "bientot", tz);
    assert.equal(s.revision2oct, "bientot", tz);
    assert.equal(s.echeance1nov, "ok", tz);
  }
});

test("minuit à Cayenne (2026-10-02T03:00:00Z) : passage au 02/10", async () => {
  for (const tz of FUSEAUX_SESSION) {
    const s = await statutsA("2026-10-02 03:00:00+00", tz);
    assert.equal(s.echeance2oct, "perime", `${tz} : échéance atteinte le jour même (règle <= conservée)`);
    assert.equal(s.revision2oct, "perime", tz);
    assert.equal(s.echeance1nov, "bientot", `${tz} : 01/11 = 02/10 + 30 jours`);
  }
});

test("vue réelle, instant courant : jour de Cayenne même avec une session PostgreSQL en Pacific/Kiritimati (UTC+14)", async () => {
  const jour = dateMetierAujourdhui();
  const demain = new Date(`${jour}T00:00:00Z`); demain.setUTCDate(demain.getUTCDate() + 1);
  const ids = {
    aujourdhui: await preuve("Échéance aujourd'hui (Cayenne)", { type_alerte: "echeance_fixe", date_echeance: jour }),
    demain: await preuve("Échéance demain (Cayenne)", { type_alerte: "echeance_fixe", date_echeance: demain.toISOString().slice(0, 10) }),
  };
  const c = await pool.connect();
  try {
    await c.query("SET TimeZone = 'Pacific/Kiritimati'");
    const { rows } = await c.query("SELECT id, alerte_statut FROM preuves_enrichies WHERE id = ANY($1)", [Object.values(ids)]);
    const st = Object.fromEntries(rows.map((r) => [r.id, r.alerte_statut]));
    assert.equal(st[ids.aujourdhui], "perime");
    assert.equal(st[ids.demain], "bientot", "pas périmée avant le jour d'échéance à Cayenne");
  } finally { c.release(); }
});

test("colonnes et types de la vue inchangés ; vue préservée ; consommateurs backend fonctionnels", async () => {
  const cols = (await pool.query("SELECT attname, format_type(atttypid, atttypmod) t FROM pg_attribute WHERE attrelid = 'preuves_enrichies'::regclass AND attnum > 0 ORDER BY attnum")).rows;
  assert.equal(cols.map((c) => `${c.attname}:${c.t}`).join(", "), COLONNES);
  const def = (await pool.query("SELECT pg_get_viewdef('preuves_enrichies'::regclass, true) AS d")).rows[0].d;
  assert.ok(!/CURRENT_DATE/.test(def), "plus de CURRENT_DATE (fuseau de session)");
  assert.ok(/America\/Cayenne/.test(def), "date de référence explicite à Cayenne");
  const cookie = "vq_session=" + encode({ uid: adminId, exp: Date.now() + 60_000 });
  const get = async (ch) => { const r = await fetch(origine + ch, { headers: { cookie } }); assert.equal(r.status, 200, ch); return r.json(); };
  const liste = await get("/api/preuves");
  const p = (liste.preuves || []).find((x) => x.id === P.echeance1nov);
  assert.ok(p && "alerte_statut" in p, "liste des preuves : alerte_statut exposé");
  assert.ok(Array.isArray((await get("/api/preuves?alerte=perime")).preuves), "filtre par alerte");
  await get(`/api/preuves/${P.echeance1nov}`);
  await get("/api/indicateurs");
});
