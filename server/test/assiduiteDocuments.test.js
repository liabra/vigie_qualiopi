// L5 — Assiduité / EduSign : contrats HTTP légers et non-régression du
// calcul d'assiduité réutilisé. La génération documentaire complète (Drive)
// est couverte par documents.test.js et la vérification navigateur ; ici,
// on fige ce qui est testable sans Google :
//   - GET /api/indicateurs (pour le select du rattachement EduSign) ;
//   - GET /api/preuves?session=… filtre réellement sur la session ;
//   - calculerAssiduite réutilisé depuis services/assiduite.js (mêmes règles).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { setQueryExecutor } from "../src/db.js";
import { encode } from "../src/session.js";
import { calculerAssiduite } from "../src/services/assiduite.js";

const ADMIN = { id: 1, email: "admin@exemple.fr", nom: "Mme Stark", role: "admin" };
const SQL_UTILISATEUR = "SELECT id, email, nom, role FROM utilisateurs WHERE id = $1 AND actif";
const sqlNormalise = (text) => String(text).replace(/\s+/g, " ").trim();

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

const cookie = (uid) => "vq_session=" + encode({ uid, exp: Date.now() + 60_000 });

test("GET /api/indicateurs renvoie les indicateurs du référentiel actif", async () => {
  setQueryExecutor(async (text, params) => {
    const sql = sqlNormalise(text);
    if (sql === SQL_UTILISATEUR) return { rows: [ADMIN] };
    if (sql.includes("FROM indicateurs i")) {
      return { rows: [{ id: 1, numero: 11, libelle: "Obtention des certifications" }] };
    }
    throw new Error("Requête inattendue : " + sql);
  });
  const r = await fetch(`${origine}/api/indicateurs`, { headers: { cookie: cookie(1) } });
  assert.equal(r.status, 200);
  const corps = await r.json();
  assert.equal(corps.total, 1);
  assert.equal(corps.indicateurs[0].numero, 11);
});

test("GET /api/indicateurs refuse l'anonyme", async () => {
  setQueryExecutor(async () => { throw new Error("ne doit pas être appelé"); });
  const r = await fetch(`${origine}/api/indicateurs`);
  assert.equal(r.status, 401);
});

test("GET /api/preuves?session filtre réellement sur la session", async () => {
  const appels = [];
  setQueryExecutor(async (text, params) => {
    const sql = sqlNormalise(text);
    appels.push({ sql, params });
    if (sql === SQL_UTILISATEUR) return { rows: [ADMIN] };
    if (sql.includes("FROM preuves_enrichies p")) return { rows: [] };
    throw new Error("Requête inattendue : " + sql);
  });
  const r = await fetch(`${origine}/api/preuves?session=7`, { headers: { cookie: cookie(1) } });
  assert.equal(r.status, 200);
  const liste = appels.find((a) => a.sql.includes("FROM preuves_enrichies p"));
  assert.ok(liste, "la liste des preuves a bien été interrogée");
  assert.ok(liste.sql.includes("p.session_id = $"), "le filtre session est dans la requête");
  assert.ok(liste.params.includes(7), "l'identifiant de session est passé en paramètre");
});

// ── Assiduité : UN seul calcul, celui du lot L2 ───────────────

test("calculerAssiduite réutilisé : mêmes résultats que le contrat L2", () => {
  assert.deepEqual(calculerAssiduite({ heuresPrevues: 14, heuresAbsence: 3.5, statut: "inscrit" }), {
    heures_absence: 3.5, heures_prevues: 14, heures_suivies: 10.5, taux: 75,
    fiable: true, raison: null, depassement: false,
  });
  assert.equal(calculerAssiduite({ heuresPrevues: 14, heuresAbsence: 3, statut: "abandon" }).raison, "abandon");
  assert.equal(calculerAssiduite({ heuresPrevues: null, heuresAbsence: 3, statut: "inscrit" }).raison, "duree_inconnue");
  assert.equal(calculerAssiduite({ heuresPrevues: 14, heuresAbsence: 20, statut: "inscrit" }).depassement, true);
  assert.equal(calculerAssiduite({ heuresPrevues: 14, heuresAbsence: 0, statut: "inscrit" }).taux, 100);
});
