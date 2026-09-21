// Règle de normalisation de l'horaire d'une session, partagée par la
// création (POST /api/sessions) et la correction (PATCH /api/sessions/:id),
// puis contrat HTTP de cette correction.
// Les deux chemins DOIVENT stocker la même chose : sinon un horaire saisi
// puis corrigé ne s'imprimerait pas pareil dans {{horaire}}. La fonction est
// exportée par routes/gestion.js, comme extraireFileId l'est déjà.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { setQueryExecutor } from "../src/db.js";
import { encode } from "../src/session.js";
import { normaliserHoraire } from "../src/routes/gestion.js";

test("les espaces autour de l'horaire sont rognés", () => {
  assert.equal(normaliserHoraire("  8h30–12h00  "), "8h30–12h00");
  assert.equal(normaliserHoraire("\n9h00–12h30 / 14h00–17h00\t"), "9h00–12h30 / 14h00–17h00");
});

test("horaire vide, fait d'espaces, ou absent : NULL en base", () => {
  assert.equal(normaliserHoraire(""), null);
  assert.equal(normaliserHoraire("   "), null);
  assert.equal(normaliserHoraire("\t\n "), null);
  assert.equal(normaliserHoraire(null), null);
  assert.equal(normaliserHoraire(undefined), null);
});

test("l'horaire reste du texte libre : rien n'est reformaté ni validé", () => {
  // Tiret simple, deux-points, virgules : rien de tout cela n'est corrigé.
  assert.equal(normaliserHoraire("8h30-12h00, 13h-16h"), "8h30-12h00, 13h-16h");
  assert.equal(normaliserHoraire("09:00 → 17:00"), "09:00 → 17:00");
  assert.equal(normaliserHoraire("le matin"), "le matin");
  // Une valeur qui n'est pas une chaîne ne fait pas échouer la route.
  assert.equal(normaliserHoraire(9), "9");
});

// ── Contrat HTTP de PATCH /api/sessions/:id ──────────────────
// La route est éprouvée sur l'application Express RÉELLE, avec la couche
// base remplacée par une base simulée (db.setQueryExecutor) : aucun
// PostgreSQL n'est nécessaire, et `npm test` reste hermétique. La base
// simulée refuse toute requête qu'elle ne connaît pas : si la route se met
// un jour à écrire ailleurs, ces tests échouent au lieu de passer à vide.

const ADMIN = { id: 1, email: "admin@exemple.fr", nom: "Mme Stark", role: "admin" };
const CONTRIBUTEUR = { id: 2, email: "tukui@exemple.fr", nom: "Tukui", role: "contributeur" };
const SQL_UTILISATEUR = "SELECT id, email, nom, role FROM utilisateurs WHERE id = $1 AND actif";
const sqlNormalise = (text) => String(text).replace(/\s+/g, " ").trim();

// Elle enregistre les requêtes reçues : les tests vérifient ainsi ce que la
// route a RÉELLEMENT écrit, et pas seulement ce qu'elle a répondu.
function baseSimulee({ session = { id: 7, reference: "SESS", horaire: null } } = {}) {
  const appels = [];
  let etat = { ...session };
  const executer = async (text, params) => {
    const sql = sqlNormalise(text);
    appels.push({ sql, params });
    if (sql === SQL_UTILISATEUR) {
      const u = [ADMIN, CONTRIBUTEUR].find((x) => x.id === params[0]);
      return { rows: u ? [u] : [] };
    }
    if (sql.startsWith("UPDATE sessions SET")) {
      if (params[0] !== etat.id) return { rows: [] };   // identifiant inconnu
      etat = { ...etat, horaire: params[1] };
      return { rows: [{ ...etat }] };
    }
    throw new Error("Requête inattendue pour la base simulée : " + sql);
  };
  const base = {
    appels,
    etat: () => etat,
    ecritures: () => appels.filter((a) => a.sql.startsWith("UPDATE sessions SET")),
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

test("un admin peut renseigner l'horaire d'une session", async () => {
  const b = baseSimulee().installer();
  const r = await patcher(7, { horaire: "8h30–12h00 / 13h00–16h30" });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.session.horaire, "8h30–12h00 / 13h00–16h30");
  assert.equal(b.etat().horaire, "8h30–12h00 / 13h00–16h30", "valeur réellement écrite");
});

test("un admin peut remplacer un horaire déjà renseigné", async () => {
  const b = baseSimulee({ session: { id: 7, horaire: "ancien horaire" } }).installer();
  const r = await patcher(7, { horaire: "nouvel horaire" });
  assert.equal(r.statut, 200);
  assert.equal(b.etat().horaire, "nouvel horaire");
  assert.equal(b.ecritures().length, 1, "une seule écriture, pas d'empilement");
});

test("un horaire vide, fait d'espaces, ou réduit à rien vaut NULL", async () => {
  for (const valeur of ["", "   ", "\t\n ", "  9h00–12h00  "]) {
    const b = baseSimulee().installer();
    const r = await patcher(7, { horaire: valeur });
    assert.equal(r.statut, 200, JSON.stringify(valeur));
    const attendu = valeur.trim() || null;
    assert.equal(b.etat().horaire, attendu, JSON.stringify(valeur) + " → " + JSON.stringify(attendu));
    assert.equal(r.corps.session.horaire, attendu);
  }
});

test("un contributeur ne peut pas modifier l'horaire", async () => {
  const b = baseSimulee({ session: { id: 7, horaire: "horaire d'origine" } }).installer();
  const r = await patcher(7, { horaire: "par le contributeur" }, CONTRIBUTEUR);
  assert.equal(r.statut, 403);
  assert.equal(b.ecritures().length, 0, "aucune écriture ne doit être tentée");
  assert.equal(b.etat().horaire, "horaire d'origine");
});

test("sans connexion, la correction est refusée", async () => {
  const b = baseSimulee().installer();
  const r = await patcher(7, { horaire: "anonyme" }, null);
  assert.equal(r.statut, 401);
  assert.equal(b.ecritures().length, 0);
});

test("une session inexistante répond 404", async () => {
  // La session simulée porte l'id 7 : l'update sur 999999 ne trouve rien.
  const b = baseSimulee().installer();
  const r = await patcher(999999, { horaire: "8h30–12h00" });
  assert.equal(r.statut, 404);
  assert.match(r.corps.error, /introuvable/i);
  assert.equal(b.ecritures().length, 1, "l'écriture est tentée, c'est la base qui ne trouve rien");
  assert.equal(b.etat().horaire, null, "rien n'a été écrit");
});

test("un corps sans clé horaire répond 400 « Rien à modifier »", async () => {
  for (const corps of [{}, { date_debut: "2030-01-01" }, { horaire: undefined }]) {
    const b = baseSimulee().installer();
    const r = await patcher(7, corps);
    assert.equal(r.statut, 400, JSON.stringify(corps));
    assert.match(r.corps.error, /rien à modifier/i);
    assert.equal(b.ecritures().length, 0);
  }
});

test("aucun autre champ de la session ne peut être modifié", async () => {
  const b = baseSimulee({ session: { id: 7, horaire: null } }).installer();
  const r = await patcher(7, {
    horaire: "8h30–12h00", date_debut: "2030-01-01", date_fin: "2031-01-01",
    reference: "PIRATE", lieu: "ailleurs", formateur: "quelqu'un",
    duree_heures_reelle: 999, formation_version_id: 42, modalite: "distanciel",
  });
  assert.equal(r.statut, 200);
  const [ecriture] = b.ecritures();
  // La clause SET ne porte QUE sur horaire, et les paramètres non plus.
  assert.equal(/UPDATE sessions SET (.+) WHERE id = \$1 RETURNING \*/.exec(ecriture.sql)[1], "horaire = $2");
  assert.deepEqual(ecriture.params, [7, "8h30–12h00"]);
  for (const colonne of ["date_debut", "date_fin", "reference", "lieu", "formateur",
                         "duree_heures_reelle", "formation_version_id", "modalite"]) {
    assert.ok(!ecriture.sql.includes(colonne), colonne + " ne doit pas figurer dans la requête");
  }
  // Un seul champ en base a bougé : l'horaire.
  assert.deepEqual(b.etat(), { id: 7, horaire: "8h30–12h00" });
});
