// Contrat HTTP de la veille Qualiopi : consultation filtrée, création,
// analyse (a_analyser → analysee → integree / sans_impact), cycle d'ACTION
// séparé (aucune → a_realiser → realisee), rattachement aux indicateurs et
// aux preuves Drive, cohérence des dates et permissions par rôle.
//
// Application Express réelle + base simulée (setPoolFactory) : aucun
// PostgreSQL nécessaire, et la base simulée REFUSE toute requête inconnue.
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

function baseSimulee({ veilles = [], indicateurs = { 10: 1, 11: 2 }, liens = [], preuves = [], fichiers = [] } = {}) {
  const etat = {
    veilles: new Map(veilles.map((v) => [v.id, {
      type: "autre", statut: "a_analyser", statut_action: "aucune", rupture_reglementaire: false,
      source: null, url: null, resume: null, analyse_impact: null, action: null,
      date_publication: null, date_effet: null, date_consultation: null, action_realisee_le: null, ...v,
    }])),
    indicateurs, liens: liens.map((l) => ({ ...l })),
    preuves: new Map(preuves.map((p) => [p.id, { mode_fichiers: "unique", statut: "a_risque", session_id: null, ...p }])),
    fichiers: fichiers.map((f) => ({ ...f })),
  };
  const prochain = {
    veille: Math.max(0, ...veilles.map((v) => v.id)) + 1,
    preuve: Math.max(0, ...preuves.map((p) => p.id)) + 1,
    fichier: Math.max(0, ...fichiers.map((f) => f.id)) + 1,
  };

  const libelles = new Map(Object.entries(indicateurs).map(([id, numero]) => [Number(id), `Indicateur ${numero}`]));
  const avecLiens = (v) => ({
    ...v,
    indicateurs: etat.liens.filter((l) => l.veille_id === v.id)
      .map((l) => ({ id: l.indicateur_id, numero: indicateurs[l.indicateur_id], libelle: libelles.get(l.indicateur_id) }))
      .sort((a, b) => a.numero - b.numero),
  });

  const ligneInseree = (sql, params) => {
    const cols = /INSERT INTO \w+ \(([^)]+)\)/.exec(sql)[1].split(",").map((s) => s.trim());
    const vals = /VALUES \(([^)]+)\)/.exec(sql)[1].split(",").map((s) => s.trim());
    assert.equal(cols.length, vals.length, "INSERT simulé : colonnes et valeurs de tailles différentes");
    return Object.fromEntries(cols.map((c, i) => {
      const v = vals[i];
      return [c, /^\$\d+$/.test(v) ? params[Number(v.slice(1)) - 1] : v.replace(/^'|'$/g, "")];
    }));
  };

  const executer = async (text, params = []) => {
    const sql = sqlNormalise(text);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };

    if (sql === SQL_UTILISATEUR) {
      const u = [ADMIN, CONTRIBUTEUR].find((x) => x.id === params[0]);
      return { rows: u ? [u] : [] };
    }

    // Veille : liste + détail (requête enrichie des indicateurs liés).
    if (sql.startsWith("SELECT v.*, COALESCE((SELECT json_agg")) {
      if (sql.includes("WHERE v.id = $1")) {
        const v = etat.veilles.get(params[0]);
        return { rows: v ? [avecLiens(v)] : [] };
      }
      let rows = [...etat.veilles.values()];
      const pos = (m) => { const r = sql.match(m); return r ? Number(r[1]) : null; };
      const pType = pos(/v\.type = \$(\d+)/);
      const pStatut = pos(/v\.statut = \$(\d+)/);
      const pAction = pos(/v\.statut_action = \$(\d+)/);
      const pQ = pos(/v\.titre ILIKE \$(\d+)/);
      if (pType) rows = rows.filter((v) => v.type === params[pType - 1]);
      if (pStatut) rows = rows.filter((v) => v.statut === params[pStatut - 1]);
      if (pAction) rows = rows.filter((v) => v.statut_action === params[pAction - 1]);
      if (pQ) rows = rows.filter((v) => v.titre.toLowerCase().includes(String(params[pQ - 1]).replace(/%/g, "").toLowerCase()));
      rows = rows.sort((a, b) => (b.date_publication || "").localeCompare(a.date_publication || "") || b.id - a.id);
      return { rows: rows.map(avecLiens) };
    }

    if (sql === "SELECT * FROM veille WHERE id = $1") {
      const v = etat.veilles.get(params[0]);
      return { rows: v ? [{ ...v }] : [] };
    }

    if (sql === "SELECT 1 FROM veille WHERE id = $1") {
      return { rows: etat.veilles.has(params[0]) ? [{ "?column?": 1 }] : [], rowCount: etat.veilles.has(params[0]) ? 1 : 0 };
    }

    // L'INSERT de liens doit être testé AVANT l'INSERT de veille :
    // « INSERT INTO veille_indicateurs » commence aussi par
    // « INSERT INTO veille ».
    if (sql.startsWith("INSERT INTO veille_indicateurs")) {
      const row = ligneInseree(sql, params);
      if (!etat.liens.some((l) => l.veille_id === row.veille_id && l.indicateur_id === row.indicateur_id)) {
        etat.liens.push({ veille_id: row.veille_id, indicateur_id: row.indicateur_id });
      }
      return { rows: [] };
    }

    if (sql === "DELETE FROM veille_indicateurs WHERE veille_id = $1") {
      const avant = etat.liens.length;
      etat.liens = etat.liens.filter((l) => l.veille_id !== params[0]);
      return { rows: [], rowCount: avant - etat.liens.length };
    }

    if (sql.startsWith("INSERT INTO veille")) {
      const row = ligneInseree(sql, params);
      const id = prochain.veille++;
      const v = {
        id, type: "autre", statut: "a_analyser", statut_action: "aucune", rupture_reglementaire: false,
        source: null, url: null, resume: null, analyse_impact: null, action: null,
        date_publication: null, date_effet: null, date_consultation: null, action_realisee_le: null, ...row,
      };
      etat.veilles.set(id, v);
      return { rows: [{ ...v }] };
    }

    if (sql.startsWith("UPDATE veille SET")) {
      const v = etat.veilles.get(params[0]);
      if (!v) return { rows: [], rowCount: 0 };
      const sets = /UPDATE veille SET (.+) WHERE id = \$1/.exec(sql)[1].split(", ");
      for (const clause of sets) {
        const [col, jeton] = clause.split(" = ");
        assert.ok(/^[a-z_]+$/.test(col), "UPDATE simulé : clause inattendue « " + clause + " »");
        v[col] = /^\$\d+$/.test(jeton) ? params[Number(jeton.slice(1)) - 1] : (jeton === "false" ? false : jeton);
      }
      return { rows: [{ id: v.id }], rowCount: 1 };
    }

    if (sql === "SELECT id FROM indicateurs WHERE id = ANY($1::int[])") {
      const rows = (params[0] || []).filter((id) => indicateurs[id] !== undefined).map((id) => ({ id }));
      return { rows };
    }

    // Preuves liées à la veille (détail) + création d'une preuve Drive.
    if (sql.startsWith("SELECT p.id, p.titre")) {
      const rows = [...etat.preuves.values()].filter((p) => p.veille_id === params[0])
        .map((p) => ({
          id: p.id, titre: p.titre, statut: p.statut, mode_fichiers: p.mode_fichiers,
          session_id: p.session_id, indicateur_id: p.indicateur_id,
          fichiers: etat.fichiers.filter((f) => f.preuve_id === p.id)
            .map((f) => ({ id: f.id, drive_file_id: f.drive_file_id, url: f.drive_url, nom: f.drive_nom, mime: f.drive_mime })),
        })).sort((a, b) => a.id - b.id);
      return { rows };
    }

    if (sql.startsWith("SELECT i.id, i.numero FROM indicateurs")) {
      const rows = (params[0] || []).filter((id) => indicateurs[id] !== undefined)
        .map((id) => ({ id, numero: indicateurs[id] })).sort((a, b) => a.numero - b.numero);
      return { rows };
    }

    if (sql.startsWith("INSERT INTO preuves")) {
      const row = ligneInseree(sql, params);
      const id = prochain.preuve++;
      etat.preuves.set(id, { id, mode_fichiers: "unique", statut: "a_risque", ...row });
      return { rows: [{ id }] };
    }

    if (sql.startsWith("INSERT INTO preuve_fichiers")) {
      const row = ligneInseree(sql, params);
      const id = prochain.fichier++;
      const f = { id, ...row };
      etat.fichiers.push(f);
      return { rows: [{ id, drive_file_id: f.drive_file_id, url: f.drive_url, nom: f.drive_nom, mime: f.drive_mime, source: f.source }], rowCount: 1 };
    }

    throw new Error("Requête inattendue pour la base simulée : " + sql);
  };

  const pool = { query: executer, connect: async () => ({ query: executer, release: () => {} }) };
  return { etat, installer: () => { setPoolFactory(() => pool); return pool; } };
}

const driveValide = () => ({
  drive: { files: { get: async ({ fileId }) => ({ data: { id: fileId, name: "Preuve.pdf", mimeType: "application/pdf", webViewLink: "https://drive.google.com/file/d/" + fileId + "/view" } }) } },
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

// ── Création ─────────────────────────────────────────────────

test("un admin crée une veille avec rattachement aux indicateurs", async () => {
  const b = baseSimulee();
  b.installer();
  const r = await appel("/api/veille", {
    methode: "POST",
    corps: {
      type: "legale_reglementaire", titre: "  Nouveau décret  ", source: "Légifrance",
      url: "https://legifrance.gouv.fr/x", resume: "Un résumé", indicateur_ids: [10, 11],
    },
  });
  assert.equal(r.statut, 201);
  assert.equal(r.corps.veille.titre, "Nouveau décret", "titre rogné");
  assert.equal(r.corps.veille.statut, "a_analyser", "cycle de veille au départ");
  assert.equal(r.corps.veille.statut_action, "aucune", "cycle d'action au départ");
  assert.equal(r.corps.veille.created_by, ADMIN.id);
  assert.deepEqual(b.etat.liens, [
    { veille_id: 1, indicateur_id: 10 },
    { veille_id: 1, indicateur_id: 11 },
  ], "les indicateurs sont rattachés, sans doublon");
});

test("créer une veille sans titre est refusé", async () => {
  baseSimulee().installer();
  const r = await appel("/api/veille", { methode: "POST", corps: { type: "autre" } });
  assert.equal(r.statut, 400);
});

test("un type inconnu est refusé", async () => {
  baseSimulee().installer();
  const r = await appel("/api/veille", { methode: "POST", corps: { titre: "X", type: "n_importe" } });
  assert.equal(r.statut, 400);
});

test("un indicateur rattaché doit exister", async () => {
  baseSimulee().installer();
  const r = await appel("/api/veille", { methode: "POST", corps: { titre: "X", indicateur_ids: [999] } });
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /999/);
});

// ── Consultation et filtres ──────────────────────────────────

test("la liste se filtre par statut, statut d'action et recherche", async () => {
  const b = baseSimulee({
    veilles: [
      { id: 1, titre: "Décret handicap", type: "handicap", statut: "a_analyser", statut_action: "a_realiser", date_publication: "2025-01-01" },
      { id: 2, titre: "Guide innovation", type: "innovations_pedagogiques", statut: "integree", statut_action: "aucune", date_publication: "2025-02-01" },
    ],
  });
  b.installer();
  const r = await appel("/api/veille?statut=a_analyser&statut_action=a_realiser&q=handicap", { utilisateur: CONTRIBUTEUR });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.total, 1);
  assert.equal(r.corps.veilles[0].id, 1);
});

test("le détail renvoie la veille et ses preuves", async () => {
  const b = baseSimulee({
    veilles: [{ id: 1, titre: "Décret", statut: "analysee" }],
    liens: [{ veille_id: 1, indicateur_id: 10 }],
    preuves: [{ id: 5, veille_id: 1, indicateur_id: 10, titre: "Arrêté signé" }],
    fichiers: [{ id: 9, preuve_id: 5, drive_file_id: "DRV-1", drive_url: "https://drive/DRV-1", drive_nom: "Arrêté.pdf", drive_mime: "application/pdf", source: "manuel" }],
  });
  b.installer();
  const r = await appel("/api/veille/1");
  assert.equal(r.statut, 200);
  assert.equal(r.corps.veille.statut, "analysee");
  assert.equal(r.corps.veille.indicateurs.length, 1);
  assert.equal(r.corps.preuves.length, 1);
  assert.equal(r.corps.preuves[0].fichiers[0].drive_file_id, "DRV-1");
});

// ── Cycle d'action et cohérence ──────────────────────────────

test("une action passe de a_realiser à realisee avec sa date", async () => {
  const b = baseSimulee({ veilles: [{ id: 1, titre: "Décret", statut: "analysee", statut_action: "a_realiser", action: "Mettre à jour la procédure" }] });
  b.installer();
  const r = await appel("/api/veille/1", { methode: "PATCH", corps: { statut_action: "realisee", action_realisee_le: "2025-03-01" } });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.veille.statut_action, "realisee");
  assert.equal(r.corps.veille.action_realisee_le, "2025-03-01");
});

test("une action réalisée sans libellé d'action est refusée", async () => {
  baseSimulee({ veilles: [{ id: 1, titre: "Décret" }] }).installer();
  const r = await appel("/api/veille/1", { methode: "PATCH", corps: { statut_action: "realisee" } });
  assert.equal(r.statut, 400);
});

test("une date de réalisation sans statut realisee est refusée", async () => {
  baseSimulee({ veilles: [{ id: 1, titre: "Décret", action: "Procédure" }] }).installer();
  const r = await appel("/api/veille/1", { methode: "PATCH", corps: { statut_action: "a_realiser", action_realisee_le: "2025-03-01" } });
  assert.equal(r.statut, 400);
});

test("repasser de realisee à a_realiser retire la date de réalisation", async () => {
  const b = baseSimulee({ veilles: [{ id: 1, titre: "Décret", statut: "analysee", statut_action: "realisee", action: "Procédure", action_realisee_le: "2025-03-01" }] });
  b.installer();
  const r = await appel("/api/veille/1", { methode: "PATCH", corps: { statut_action: "a_realiser" } });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.veille.statut_action, "a_realiser");
  assert.equal(r.corps.veille.action_realisee_le, null, "aucune date de réalisation orpheline");
});

test("une date invalide est refusée", async () => {
  baseSimulee({ veilles: [{ id: 1, titre: "Décret" }] }).installer();
  const r = await appel("/api/veille/1", { methode: "PATCH", corps: { date_consultation: "03/01/2025" } });
  assert.equal(r.statut, 400);
});

// ── Rattachement aux indicateurs et aux preuves ──────────────

test("la modification remplace les indicateurs rattachés", async () => {
  const b = baseSimulee({
    veilles: [{ id: 1, titre: "Décret" }],
    liens: [{ veille_id: 1, indicateur_id: 10 }],
  });
  b.installer();
  const r = await appel("/api/veille/1", { methode: "PATCH", corps: { indicateur_ids: [11] } });
  assert.equal(r.statut, 200);
  assert.deepEqual(b.etat.liens, [{ veille_id: 1, indicateur_id: 11 }]);
});

test("une preuve Drive se rattache à une veille en réutilisant la vérification", async () => {
  const b = baseSimulee({ veilles: [{ id: 1, titre: "Décret", statut: "analysee" }] });
  b.installer();
  const r = await appel("/api/preuves", {
    methode: "POST",
    corps: { indicateur_id: 10, veille_id: 1, titre: "Preuve d'action", mode_fichiers: "unique",
             drive_file_id: "DRV-ACTION", drive_url: "https://drive/DRV-ACTION", drive_nom: "Preuve.pdf", drive_mime: "application/pdf" },
  });
  assert.equal(r.statut, 201);
  const [p] = [...b.etat.preuves.values()];
  assert.equal(p.veille_id, 1, "la preuve est rattachée à la veille");
  assert.equal(p.indicateur_id, 10);
  assert.equal(b.etat.fichiers[0].drive_file_id, "DRV-ACTION");
});

test("une preuve rattachée à une veille inconnue est refusée", async () => {
  baseSimulee().installer();
  const r = await appel("/api/preuves", { methode: "POST", corps: { indicateur_id: 10, veille_id: 42, titre: "X" } });
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /Veille introuvable/);
});

// ── Permissions ──────────────────────────────────────────────

test("un contributeur consulte mais ne crée pas", async () => {
  baseSimulee({ veilles: [{ id: 1, titre: "Décret" }] }).installer();
  assert.equal((await appel("/api/veille", { utilisateur: CONTRIBUTEUR })).statut, 200);
  assert.equal((await appel("/api/veille/1", { utilisateur: CONTRIBUTEUR })).statut, 200);
  assert.equal((await appel("/api/veille", { methode: "POST", corps: { titre: "X" }, utilisateur: CONTRIBUTEUR })).statut, 403);
  assert.equal((await appel("/api/veille/1", { methode: "PATCH", corps: { statut: "analysee" }, utilisateur: CONTRIBUTEUR })).statut, 403);
});

test("un visiteur anonyme n'accède pas à la veille", async () => {
  baseSimulee().installer();
  assert.equal((await appel("/api/veille", { utilisateur: null })).statut, 401);
});
