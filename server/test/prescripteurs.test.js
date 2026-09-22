// Gestion des prescripteurs (L3-bis) : liste configurable en base, CRUD,
// droits. Application Express réelle, couche `query()` remplacée par une
// base simulée (db.setQueryExecutor).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { setQueryExecutor } from "../src/db.js";
import { encode } from "../src/session.js";

const ADMIN = { id: 1, email: "admin@exemple.fr", nom: "Mme Stark", role: "admin" };
const CONTRIBUTEUR = { id: 2, email: "tukui@exemple.fr", nom: "Tukui", role: "contributeur" };
const SQL_UTILISATEUR = "SELECT id, email, nom, role FROM utilisateurs WHERE id = $1 AND actif";
const sqlNormalise = (text) => String(text).replace(/\s+/g, " ").trim();

// Miroir de la migration 011.
const SEED = [
  { id: 1, code: "pole_emploi", nom: "Pôle Emploi", actif: true },
  { id: 2, code: "mission_locale", nom: "Mission Locale", actif: true },
  { id: 3, code: "of", nom: "Organisme de formation", actif: true },
  { id: 4, code: "autre", nom: "Autre", actif: true },
  { id: 5, code: "cap_emploi", nom: "CAP Emploi", actif: true },
];

function basePrescripteurs({ prescripteurs = SEED } = {}) {
  const appels = [];
  const etat = prescripteurs.map((p) => ({ actif: true, ...p }));
  let prochain = 1 + Math.max(0, ...prescripteurs.map((p) => p.id));

  const executer = async (text, params = []) => {
    const sql = sqlNormalise(text);
    appels.push({ sql, params });

    if (sql === SQL_UTILISATEUR) {
      const u = [ADMIN, CONTRIBUTEUR].find((x) => x.id === params[0]);
      return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
    }
    if (sql.startsWith("SELECT id, code, nom, actif FROM prescripteurs")) {
      const rows = etat.map((p) => ({ id: p.id, code: p.code, nom: p.nom, actif: p.actif }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("SELECT 1 FROM prescripteurs WHERE code = $1")) {
      const n = etat.filter((p) => p.code === params[0]).length;
      return { rows: n ? [{ "?column?": 1 }] : [], rowCount: n };
    }
    if (sql.startsWith("INSERT INTO prescripteurs")) {
      const code = params[0];
      const nom = params[1];
      const id = prochain++;
      etat.push({ id, code, nom, actif: true });
      return { rows: [{ id, code, nom, actif: true }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE prescripteurs SET")) {
      const p = etat.find((x) => x.id === params[0]);
      if (!p) return { rows: [], rowCount: 0 };
      for (const clause of /UPDATE prescripteurs SET (.+) WHERE id = \$1/.exec(sql)[1].split(", ")) {
        const [col, jeton] = clause.split(" = ");
        if (col === "id") continue;
        p[col] = /^\$\d+$/.test(jeton) ? params[Number(jeton.slice(1)) - 1] : (jeton === "false" ? false : jeton);
      }
      return { rows: [{ id: p.id, code: p.code, nom: p.nom, actif: p.actif }], rowCount: 1 };
    }
    throw new Error("Requête inattendue pour la base simulée : " + sql);
  };

  const base = {
    appels,
    etat: () => etat.map((p) => ({ ...p })),
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
  setQueryExecutor(null);
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

test("la liste est lisible par admin et contributeur", async () => {
  basePrescripteurs().installer();
  assert.equal((await appel("GET", "/api/prescripteurs", undefined, ADMIN)).statut, 200);
  assert.equal((await appel("GET", "/api/prescripteurs", undefined, CONTRIBUTEUR)).statut, 200);
  const r = await appel("GET", "/api/prescripteurs", undefined, ADMIN);
  assert.equal(r.corps.total, 5);
  assert.ok(r.corps.prescripteurs.some((p) => p.code === "pole_emploi" && p.nom === "Pôle Emploi"));
});

test("la liste demande une session", async () => {
  basePrescripteurs().installer();
  assert.equal((await appel("GET", "/api/prescripteurs", undefined, null)).statut, 401);
});

test("un admin crée un prescripteur, code = nom normalisé", async () => {
  const base = basePrescripteurs().installer();
  const r = await appel("POST", "/api/prescripteurs", { nom: "  France Travail  " });
  assert.equal(r.statut, 201);
  assert.equal(r.corps.prescripteur.code, "francetravail");
  assert.equal(r.corps.prescripteur.nom, "France Travail");
  assert.equal(base.etat().length, 6);
});

test("un contributeur ne peut pas créer de prescripteur", async () => {
  basePrescripteurs().installer();
  const r = await appel("POST", "/api/prescripteurs", { nom: "Nouveau" }, CONTRIBUTEUR);
  assert.equal(r.statut, 403);
});

test("un nom vide est refusé à la création comme au renommage", async () => {
  basePrescripteurs().installer();
  assert.equal((await appel("POST", "/api/prescripteurs", { nom: "   " })).statut, 400);
  assert.equal((await appel("PATCH", "/api/prescripteurs/1", { nom: " " })).statut, 400);
});

test("un admin renomme un prescripteur sans changer son code", async () => {
  const base = basePrescripteurs().installer();
  const r = await appel("PATCH", "/api/prescripteurs/1", { nom: "Pôle Emploi (France Travail)" });
  assert.equal(r.statut, 200);
  const p = base.etat().find((x) => x.id === 1);
  assert.equal(p.nom, "Pôle Emploi (France Travail)");
  assert.equal(p.code, "pole_emploi", "le code ne bouge pas");
});

test("un admin désactive un prescripteur (sans le supprimer)", async () => {
  const base = basePrescripteurs().installer();
  const r = await appel("DELETE", "/api/prescripteurs/5");
  assert.equal(r.statut, 200);
  const p = base.etat().find((x) => x.id === 5);
  assert.equal(p.actif, false, "désactivé, pas supprimé");
  assert.equal(base.etat().length, 5, "toujours présent dans la liste");
});

test("un prescripteur désactivé peut être réactivé", async () => {
  const base = basePrescripteurs().installer();
  await appel("DELETE", "/api/prescripteurs/5");
  const r = await appel("PATCH", "/api/prescripteurs/5", { actif: true });
  assert.equal(r.statut, 200);
  assert.equal(base.etat().find((x) => x.id === 5).actif, true);
});

test("un contributeur ne peut ni renommer ni désactiver", async () => {
  basePrescripteurs().installer();
  assert.equal((await appel("PATCH", "/api/prescripteurs/1", { nom: "X" }, CONTRIBUTEUR)).statut, 403);
  assert.equal((await appel("DELETE", "/api/prescripteurs/1", undefined, CONTRIBUTEUR)).statut, 403);
});

test("identifiant invalide = 400, prescripteur introuvable = 404", async () => {
  basePrescripteurs().installer();
  assert.equal((await appel("PATCH", "/api/prescripteurs/abc", { nom: "X" })).statut, 400);
  assert.equal((await appel("DELETE", "/api/prescripteurs/abc")).statut, 400);
  assert.equal((await appel("PATCH", "/api/prescripteurs/999", { nom: "X" })).statut, 404);
  assert.equal((await appel("DELETE", "/api/prescripteurs/999")).statut, 404);
});

test("un PATCH vide est refusé", async () => {
  basePrescripteurs().installer();
  const r = await appel("PATCH", "/api/prescripteurs/1", {});
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /Rien à modifier/);
});
