// Import CSV de stagiaires (L3) : aperçu, confirmation transactionnelle,
// correction de fiche et d'inscription, droits. Application Express RÉELLE
// sur une base SIMULÉE (db.setPoolFactory) — aucun PostgreSQL nécessaire.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { setPoolFactory } from "../src/db.js";
import { encode } from "../src/session.js";

const ADMIN = { id: 1, email: "admin@exemple.fr", nom: "Mme Stark", role: "admin" };
const CONTRIBUTEUR = { id: 2, email: "tukui@exemple.fr", nom: "Tukui", role: "contributeur" };
const AUTRE = { id: 3, email: "autre@exemple.fr", nom: "Autre", role: "autre" };
const SQL_UTILISATEUR = "SELECT id, email, nom, role FROM utilisateurs WHERE id = $1 AND actif";
const sqlNormalise = (text) => String(text).replace(/\s+/g, " ").trim();

// En-têtes complets, dans le désordre, avec libellés tolérants.
const EN_TETES = ["civilité", "nom", "prénom", "E-mail", "téléphone", "entreprise", "financeur",
  "situation handicap", "besoins d'adaptation", "groupe", "prescripteur", "dossier complet"];
const csv = (lignes) => [EN_TETES.join(";"), ...lignes.map((l) => l.join(";"))].join("\n");

const ligneInseree = (sql, params) => {
  const cols = /INSERT INTO \w+ \(([^)]+)\)/.exec(sql)[1].split(",").map((s) => s.trim());
  const vals = /VALUES \(([^)]+)\)/.exec(sql)[1].split(",").map((s) => s.trim());
  return Object.fromEntries(cols.map((c, i) => [c, /^\$\d+$/.test(vals[i]) ? params[Number(vals[i].slice(1)) - 1] : vals[i]]));
};

// Miroir de la migration 011 : les codes historiques + CAP Emploi.
const PRESCRIPTEURS_DEFAUT = [
  { id: 1, code: "pole_emploi", nom: "Pôle Emploi", actif: true },
  { id: 2, code: "mission_locale", nom: "Mission Locale", actif: true },
  { id: 3, code: "of", nom: "Organisme de formation", actif: true },
  { id: 4, code: "autre", nom: "Autre", actif: true },
  { id: 5, code: "cap_emploi", nom: "CAP Emploi", actif: true },
];

function baseSimulee({ stagiaires = [], inscriptions = [], groupes = [], prescripteurs = PRESCRIPTEURS_DEFAUT, echecInsertion = 0 } = {}) {
  const appels = [];
  const etat = {
    stagiaires: stagiaires.map((s) => ({
      civilite: null, email: null, telephone: null, entreprise: null,
      financeur: null, situation_handicap: false, besoins_adaptation: null, ...s,
    })),
    inscriptions: inscriptions.map((i) => ({
      groupe_id: null, prescripteur: null, dossier_complet: false, date_abandon: null, statut: "inscrit", ...i,
    })),
    groupes: groupes.map((g) => ({ ...g })),
    prescripteurs: prescripteurs.map((p) => ({ actif: true, ...p })),
    prochainStagiaire: 1 + Math.max(0, ...stagiaires.map((s) => s.id)),
    prochainInscription: 1 + Math.max(0, ...inscriptions.map((i) => i.id)),
    prochainPrescripteur: 1 + Math.max(0, ...prescripteurs.map((p) => p.id)),
  };
  let compteurInsertion = 0;
  let sauvegarde = null;
  const instantane = () => JSON.parse(JSON.stringify(etat));

  const executer = async (text, params = []) => {
    const sql = sqlNormalise(text);
    appels.push({ sql, params });

    if (sql === "BEGIN") { sauvegarde = instantane(); return { rows: [] }; }
    if (sql === "ROLLBACK") { if (sauvegarde) Object.assign(etat, sauvegarde); sauvegarde = null; return { rows: [] }; }
    if (sql === "COMMIT") { sauvegarde = null; return { rows: [] }; }

    if (sql === SQL_UTILISATEUR) {
      const u = [ADMIN, CONTRIBUTEUR, AUTRE].find((x) => x.id === params[0]);
      return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
    }
    if (sql === "SELECT id FROM sessions WHERE id = $1") {
      const ok = params[0] === 7;
      return { rows: ok ? [{ id: 7 }] : [], rowCount: ok ? 1 : 0 };
    }
    if (sql.startsWith("SELECT id, nom FROM groupes WHERE session_id = $1")) {
      const rows = etat.groupes.filter((g) => g.session_id === params[0]).map((g) => ({ id: g.id, nom: g.nom }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("SELECT id FROM stagiaires WHERE lower(trim(email)) = $1")) {
      const rows = etat.stagiaires.filter((s) => (s.email || "").toLowerCase() === params[0]).map((s) => ({ id: s.id }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("SELECT id FROM stagiaires WHERE lower(trim(nom)) = $1 AND lower(trim(prenom)) = $2")) {
      const rows = etat.stagiaires.filter((s) =>
        (s.nom || "").toLowerCase() === String(params[0]).toLowerCase() &&
        (s.prenom || "").toLowerCase() === String(params[1]).toLowerCase()).map((s) => ({ id: s.id }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("SELECT 1 FROM inscriptions WHERE stagiaire_id = $1 AND session_id = $2")) {
      const n = etat.inscriptions.filter((i) => i.stagiaire_id === params[0] && i.session_id === params[1]).length;
      return { rows: n ? [{ "?column?": 1 }] : [], rowCount: n };
    }
    if (sql.startsWith("SELECT 1 FROM groupes g JOIN inscriptions")) {
      const g = etat.groupes.find((x) => x.id === params[0]);
      const i = etat.inscriptions.find((x) => x.id === params[1]);
      const ok = !!(g && i && g.session_id === i.session_id);
      return { rows: ok ? [{ "?column?": 1 }] : [], rowCount: ok ? 1 : 0 };
    }
    if (sql.startsWith("SELECT id, code, nom, actif FROM prescripteurs")) {
      const rows = etat.prescripteurs.map((p) => ({ id: p.id, code: p.code, nom: p.nom, actif: p.actif }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("SELECT code, nom, actif FROM prescripteurs")) {
      const rows = etat.prescripteurs.map((p) => ({ code: p.code, nom: p.nom, actif: p.actif }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith("SELECT 1 FROM prescripteurs WHERE code = $1")) {
      const n = etat.prescripteurs.filter((p) => p.code === params[0]).length;
      return { rows: n ? [{ "?column?": 1 }] : [], rowCount: n };
    }
    if (sql.startsWith("INSERT INTO prescripteurs")) {
      const row = ligneInseree(sql, params);
      const id = etat.prochainPrescripteur++;
      etat.prescripteurs.push({ id, actif: true, ...row });
      return { rows: [{ id, code: row.code, nom: row.nom, actif: true }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE prescripteurs SET")) {
      const p = etat.prescripteurs.find((x) => x.id === params[0]);
      if (!p) return { rows: [], rowCount: 0 };
      for (const clause of /UPDATE prescripteurs SET (.+) WHERE id = \$1/.exec(sql)[1].split(", ")) {
        const [col, jeton] = clause.split(" = ");
        if (col === "id") continue;
        p[col] = /^\$\d+$/.test(jeton) ? params[Number(jeton.slice(1)) - 1] : (jeton === "false" ? false : jeton);
      }
      return { rows: [{ id: p.id, code: p.code, nom: p.nom, actif: p.actif }], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO stagiaires")) {
      compteurInsertion++;
      if (echecInsertion && compteurInsertion === echecInsertion) throw new Error("échec d'insertion simulé");
      const row = ligneInseree(sql, params);
      const id = etat.prochainStagiaire++;
      etat.stagiaires.push({ id, ...row });
      return { rows: [{ id }], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO inscriptions")) {
      const row = ligneInseree(sql, params);
      const deja = etat.inscriptions.find((i) => i.stagiaire_id === row.stagiaire_id && i.session_id === row.session_id);
      if (deja) return { rows: [], rowCount: 0 };
      const id = etat.prochainInscription++;
      etat.inscriptions.push({ id, statut: "inscrit", ...row });
      return { rows: [{ id }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE stagiaires SET")) {
      const s = etat.stagiaires.find((x) => x.id === params[0]);
      if (!s) return { rows: [], rowCount: 0 };
      for (const [, col, rang] of sql.matchAll(/([a-z_]+) = \$(\d+)/g)) s[col] = params[Number(rang) - 1];
      return { rows: [{ id: s.id }], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE inscriptions SET")) {
      const i = etat.inscriptions.find((x) => x.id === params[0]);
      if (!i) return { rows: [], rowCount: 0 };
      for (const [, col, rang] of sql.matchAll(/([a-z_]+) = \$(\d+)/g)) i[col] = params[Number(rang) - 1];
      return { rows: [{ id: i.id }], rowCount: 1 };
    }
    throw new Error("Requête inattendue pour la base simulée : " + sql);
  };

  // Le client de transaction exige que `query` soit appelé AVEC sa liaison :
  // un `cx.query` passé nu (référence perdue) ferait échouer le test, comme
  // il échoue contre le vrai client pg.
  const pool = {
    query: executer,
    connect: async () => {
      const client = { release: () => {} };
      client.query = function (sql, params) {
        if (this !== client) throw new Error("cx.query appelé sans son client (liaison perdue)");
        return executer(sql, params);
      };
      return client;
    },
  };
  const base = { etat, appels, installer: () => { setPoolFactory(() => pool); return base; } };
  return base;
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

const apercu = (texte, utilisateur = ADMIN) =>
  appel("POST", "/api/sessions/7/stagiaires/import-apercu", { texte }, utilisateur);
const importer = (texte, utilisateur = ADMIN) =>
  appel("POST", "/api/sessions/7/stagiaires/import", { texte }, utilisateur);

// ── Aperçu ───────────────────────────────────────────────────

test("l'aperçu classe un nouveau stagiaire sans rien écrire", async () => {
  const base = baseSimulee({ groupes: [{ id: 3, session_id: 7, nom: "Soula" }] }).installer();
  const r = await apercu(csv([["Mme", "Tonate", "Noé", "noe@exemple.fr", "", "", "", "non", "", "Soula", "Pôle Emploi", "oui"]]));
  assert.equal(r.statut, 200);
  assert.equal(r.corps.resume.nouveaux, 1);
  assert.equal(r.corps.lignes[0].statut, "pret");
  assert.equal(r.corps.lignes[0].prescripteur, "pole_emploi");
  assert.equal(base.etat.stagiaires.length, 0, "aucune fiche écrite");
  assert.equal(base.etat.inscriptions.length, 0, "aucune inscription écrite");
  assert.equal(base.appels.some((a) => a.sql.startsWith("INSERT INTO")), false);
});

test("un CSV à virgules est accepté", async () => {
  baseSimulee().installer();
  const texte = "nom,prenom,email\nStark,Blandine,blandine@exemple.fr";
  const r = await apercu(texte);
  assert.equal(r.statut, 200);
  assert.equal(r.corps.resume.nouveaux, 1);
});

test("les accents UTF-8 passent", async () => {
  baseSimulee().installer();
  const r = await apercu(csv([["Mme", "García", "Mélodie", "melodie@exemple.fr", "", "", "", "", "", "", "", ""]]));
  assert.equal(r.statut, 200);
  assert.equal(r.corps.lignes[0].nom, "García");
});

test("un stagiaire existant est rapproché par email unique", async () => {
  baseSimulee({
    stagiaires: [{ id: 1, nom: "Stark", prenom: "Blandine", email: "Blandine@Exemple.FR" }],
  }).installer();
  const r = await apercu(csv([["Mme", "Stark", "Blandine", "blandine@exemple.fr", "", "", "", "", "", "", "", ""]]));
  assert.equal(r.statut, 200);
  assert.equal(r.corps.resume.existants, 1);
  assert.equal(r.corps.lignes[0].statut, "existant");
});

test("un stagiaire déjà inscrit est signalé", async () => {
  baseSimulee({
    stagiaires: [{ id: 1, nom: "Stark", prenom: "Blandine", email: "blandine@exemple.fr" }],
    inscriptions: [{ id: 11, stagiaire_id: 1, session_id: 7 }],
  }).installer();
  const r = await apercu(csv([["Mme", "Stark", "Blandine", "blandine@exemple.fr", "", "", "", "", "", "", "", ""]]));
  assert.equal(r.corps.lignes[0].statut, "deja_inscrit");
  assert.equal(r.corps.resume.dejaInscrits, 1);
});

test("un email partagé par plusieurs stagiaires est « à vérifier »", async () => {
  baseSimulee({
    stagiaires: [
      { id: 1, nom: "Stark", prenom: "Blandine", email: "a@exemple.fr" },
      { id: 2, nom: "Jones", prenom: "Amy", email: "a@exemple.fr" },
    ],
  }).installer();
  const r = await apercu(csv([["", "Stark", "Blandine", "a@exemple.fr", "", "", "", "", "", "", "", ""]]));
  assert.equal(r.corps.lignes[0].statut, "a_verifier");
  assert.equal(r.corps.resume.doublons, 1);
});

test("un nom déjà connu sans email est un doublon possible, jamais fusionné", async () => {
  baseSimulee({ stagiaires: [{ id: 1, nom: "Stark", prenom: "Blandine", email: null }] }).installer();
  const r = await apercu(csv([["", "Stark", "Blandine", "", "", "", "", "", "", "", "", ""]]));
  assert.equal(r.corps.lignes[0].statut, "doublon_possible");
});

test("un doublon dans le fichier lui-même est refusé", async () => {
  baseSimulee().installer();
  const r = await apercu(csv([
    ["Mme", "Dupont", "Jean", "jean@exemple.fr", "", "", "", "", "", "", "", ""],
    ["M.", "Dupont", "Jean", "jean@exemple.fr", "", "", "", "", "", "", "", ""],
  ]));
  assert.equal(r.statut, 200);
  assert.equal(r.corps.lignes[0].statut, "pret");
  assert.equal(r.corps.lignes[1].statut, "invalide");
  assert.match(r.corps.lignes[1].motif, /doublon dans le fichier/);
});

test("un groupe inconnu rend la ligne invalide", async () => {
  baseSimulee({ groupes: [{ id: 3, session_id: 7, nom: "Soula" }] }).installer();
  const r = await apercu(csv([["", "Dupont", "Jean", "", "", "", "", "", "", "Inconnu", "", ""]]));
  assert.equal(r.corps.lignes[0].statut, "invalide");
  assert.match(r.corps.lignes[0].motif, /groupe inconnu/);
});

test("un prescripteur invalide rend la ligne invalide", async () => {
  baseSimulee().installer();
  const r = await apercu(csv([["", "Dupont", "Jean", "", "", "", "", "", "", "", "Trésor public", ""]]));
  assert.equal(r.corps.lignes[0].statut, "invalide");
  assert.match(r.corps.lignes[0].motif, /prescripteur inconnu : Trésor public/);
});

test("un CSV sans colonne prescripteur est accepté", async () => {
  baseSimulee().installer();
  const texte = "nom;prenom;email\nDupont;Jean;jean@exemple.fr";
  const r = await apercu(texte);
  assert.equal(r.statut, 200);
  assert.equal(r.corps.resume.nouveaux, 1);
  assert.equal(r.corps.lignes[0].statut, "pret");
  assert.equal(r.corps.lignes[0].prescripteur, null);
});

test("une cellule prescripteur vide est acceptée, prescripteur non renseigné", async () => {
  const base = baseSimulee().installer();
  const r = await importer(csv([["Mme", "Dupont", "Jean", "jean@exemple.fr", "", "", "", "", "", "", "", ""]]));
  assert.equal(r.statut, 200);
  assert.equal(r.corps.bilan.crees, 1);
  assert.equal(base.etat.inscriptions[0].prescripteur, null);
});

test("un prescripteur connu est rattaché (libellé toléré)", async () => {
  const base = baseSimulee().installer();
  const r = await importer(csv([["Mme", "Dupont", "Jean", "jean@exemple.fr", "", "", "", "", "", "", "CAP Emploi", ""]]));
  assert.equal(r.statut, 200);
  assert.equal(base.etat.inscriptions[0].prescripteur, "cap_emploi");
});

test("un prescripteur désactivé est refusé à l'import", async () => {
  baseSimulee({ prescripteurs: [
    { id: 1, code: "pole_emploi", nom: "Pôle Emploi", actif: true },
    { id: 5, code: "cap_emploi", nom: "CAP Emploi", actif: false },
  ] }).installer();
  const r = await apercu(csv([["", "Dupont", "Jean", "", "", "", "", "", "", "", "CAP Emploi", ""]]));
  assert.equal(r.corps.lignes[0].statut, "invalide");
  assert.match(r.corps.lignes[0].motif, /prescripteur inactif/);
});

test("après création du prescripteur, le même CSV est réanalysé et accepté", async () => {
  const base = baseSimulee().installer();
  const texte = csv([["", "Dupont", "Jean", "", "", "", "", "", "", "", "Trésor public", ""]]);
  // D'abord refusé : prescripteur inconnu.
  assert.equal((await apercu(texte)).corps.lignes[0].statut, "invalide");
  // L'admin crée le prescripteur.
  const cree = await appel("POST", "/api/prescripteurs", { nom: "Trésor public" }, ADMIN);
  assert.equal(cree.statut, 201);
  // Le même CSV est désormais accepté et rattaché.
  const r = await importer(texte);
  assert.equal(r.statut, 200);
  assert.equal(r.corps.bilan.crees, 1);
  assert.equal(base.etat.inscriptions[0].prescripteur, cree.corps.prescripteur.code);
});

test("une donnée obligatoire manquante rend la ligne invalide", async () => {
  baseSimulee().installer();
  const r = await apercu(csv([["", "Dupont", "", "", "", "", "", "", "", "", "", ""]]));
  assert.equal(r.corps.lignes[0].statut, "invalide");
  assert.match(r.corps.lignes[0].motif, /nom et prénom obligatoires/);
});

test("un email invalide rend la ligne invalide", async () => {
  baseSimulee().installer();
  const r = await apercu(csv([["", "Dupont", "Jean", "pas-un-email", "", "", "", "", "", "", "", ""]]));
  assert.equal(r.corps.lignes[0].statut, "invalide");
  assert.match(r.corps.lignes[0].motif, /email invalide/);
});

test("une ligne vide est ignorée sans casser les autres", async () => {
  baseSimulee().installer();
  const r = await apercu(csv([
    ["Mme", "Stark", "Blandine", "blandine@exemple.fr", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", ""],
  ]));
  assert.equal(r.statut, 200);
  assert.equal(r.corps.resume.vides, 1);
  assert.equal(r.corps.resume.nouveaux, 1);
});

test("des colonnes obligatoires absentes sont refusées au niveau du fichier", async () => {
  baseSimulee().installer();
  const r = await apercu("nom,email\nDupont,jean@exemple.fr");
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /nom.*prénom|prénom.*nom/);
});

test("des en-têtes ambigus sont refusés au niveau du fichier", async () => {
  baseSimulee().installer();
  const r = await apercu("nom,prenom,email,mail\nDupont,Jean,a@b.fr,c@d.fr");
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /ambiguë/);
});

test("un fichier vide est refusé", async () => {
  baseSimulee().installer();
  const r = await apercu("   ");
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /vide/);
});

test("un mauvais encodage est refusé", async () => {
  baseSimulee().installer();
  const r = await apercu("nom;prenom\nStark;Bl\uFFFDndine");
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /Encodage/);
});

test("un identifiant de session invalide donne 400", async () => {
  baseSimulee().installer();
  const r = await appel("POST", "/api/sessions/abc/stagiaires/import-apercu", { texte: "nom;prenom" });
  assert.equal(r.statut, 400);
});

// ── Confirmation ─────────────────────────────────────────────

test("la confirmation crée les nouveaux et les inscrit", async () => {
  const base = baseSimulee({ groupes: [{ id: 3, session_id: 7, nom: "Soula" }] }).installer();
  const r = await importer(csv([
    ["Mme", "Tonate", "Noé", "noe@exemple.fr", "0694 00 00 00", "Soula SARL", "OPCO", "non", "aucun", "Soula", "Mission Locale", "oui"],
  ]));
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps.bilan, { crees: 1, reutilises: 0, inscrits: 1, dejaInscrits: 0, ignores: [] });
  assert.equal(base.etat.stagiaires.length, 1);
  assert.equal(base.etat.stagiaires[0].nom, "Tonate");
  assert.equal(base.etat.stagiaires[0].situation_handicap, false);
  assert.equal(base.etat.inscriptions.length, 1);
  assert.equal(base.etat.inscriptions[0].groupe_id, 3);
  assert.equal(base.etat.inscriptions[0].dossier_complet, true);
});

test("la confirmation réutilise un stagiaire existant par email", async () => {
  const base = baseSimulee({
    stagiaires: [{ id: 1, nom: "Stark", prenom: "Blandine", email: "blandine@exemple.fr" }],
  }).installer();
  const r = await importer(csv([["Mme", "Stark", "Blandine", "blandine@exemple.fr", "", "", "", "", "", "", "pole_emploi", ""]]));
  assert.equal(r.statut, 200);
  assert.equal(r.corps.bilan.reutilises, 1);
  assert.equal(r.corps.bilan.inscrits, 1);
  assert.equal(base.etat.stagiaires.length, 1, "aucune fiche recréée");
  assert.equal(base.etat.inscriptions.length, 1);
});

test("la confirmation n'écrit pas de doublon d'inscription", async () => {
  const base = baseSimulee({
    stagiaires: [{ id: 1, nom: "Stark", prenom: "Blandine", email: "blandine@exemple.fr" }],
    inscriptions: [{ id: 11, stagiaire_id: 1, session_id: 7 }],
  }).installer();
  const r = await importer(csv([["Mme", "Stark", "Blandine", "blandine@exemple.fr", "", "", "", "", "", "", "", ""]]));
  assert.equal(r.statut, 200);
  assert.equal(r.corps.bilan.dejaInscrits, 1);
  assert.equal(base.etat.inscriptions.length, 1, "toujours une seule inscription");
});

test("les lignes douteuses sont ignorées, les autres importées", async () => {
  const base = baseSimulee({
    stagiaires: [{ id: 1, nom: "Stark", prenom: "Blandine", email: null }],
  }).installer();
  const r = await importer(csv([
    ["Mme", "Stark", "Blandine", "", "", "", "", "", "", "", "", ""],   // doublon possible
    ["M.", "Dupont", "Jean", "jean@exemple.fr", "", "", "", "", "", "", "", ""],  // prêt
  ]));
  assert.equal(r.statut, 200);
  assert.equal(r.corps.bilan.crees, 1);
  assert.equal(r.corps.bilan.ignores.length, 1);
  assert.equal(r.corps.bilan.ignores[0].statut, "doublon_possible");
  assert.equal(base.etat.stagiaires.length, 2, "l'ancien + le nouveau, pas de fusion");
});

test("une erreur en cours d'import annule tout (rollback)", async () => {
  const base = baseSimulee({ echecInsertion: 2 }).installer();
  const r = await importer(csv([
    ["Mme", "A", "Un", "a@exemple.fr", "", "", "", "", "", "", "", ""],
    ["M.", "B", "Deux", "b@exemple.fr", "", "", "", "", "", "", "", ""],
    ["Mme", "C", "Trois", "c@exemple.fr", "", "", "", "", "", "", "", ""],
  ]));
  assert.equal(r.statut, 500, "l'échec d'insertion remonte comme erreur serveur");
  assert.equal(base.etat.stagiaires.length, 0, "aucun demi-import : tout est annulé");
  assert.equal(base.etat.inscriptions.length, 0);
});

// ── Fiche stagiaire ──────────────────────────────────────────

test("un contributeur corrige une fiche stagiaire", async () => {
  const base = baseSimulee({
    stagiaires: [{ id: 1, nom: "Stark", prenom: "Blandine", email: "blandine@exemple.fr" }],
  }).installer();
  const r = await appel("PATCH", "/api/stagiaires/1", {
    nom: "Stark-Bisset", email: "blandine.stark@exemple.fr", entreprise: "A2C", financeur: "OPCO", situation_handicap: true, besoins_adaptation: "salle au calme",
  }, CONTRIBUTEUR);
  assert.equal(r.statut, 200);
  assert.equal(base.etat.stagiaires[0].nom, "Stark-Bisset");
  assert.equal(base.etat.stagiaires[0].entreprise, "A2C");
  assert.equal(base.etat.stagiaires[0].situation_handicap, true);
});

test("la civilité seule reste corrigeable (non-régression)", async () => {
  const base = baseSimulee({ stagiaires: [{ id: 1, nom: "Stark", prenom: "Blandine", email: null }] }).installer();
  const r = await appel("PATCH", "/api/stagiaires/1", { civilite: "Mme" }, ADMIN);
  assert.equal(r.statut, 200);
  assert.equal(base.etat.stagiaires[0].civilite, "Mme");
});

test("un email invalide sur une fiche est refusé", async () => {
  baseSimulee({ stagiaires: [{ id: 1, nom: "Stark", prenom: "Blandine" }] }).installer();
  const r = await appel("PATCH", "/api/stagiaires/1", { email: "pas-un-email" });
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /Email invalide/);
});

test("une fiche inexistante donne 404, un identifiant invalide 400", async () => {
  baseSimulee().installer();
  assert.equal((await appel("PATCH", "/api/stagiaires/999", { nom: "X" })).statut, 404);
  assert.equal((await appel("PATCH", "/api/stagiaires/abc", { nom: "X" })).statut, 400);
});

// ── Inscription ──────────────────────────────────────────────

test("un contributeur change groupe, prescripteur et dossier", async () => {
  const base = baseSimulee({
    stagiaires: [{ id: 1, nom: "Stark", prenom: "Blandine" }],
    inscriptions: [{ id: 11, stagiaire_id: 1, session_id: 7 }],
    groupes: [{ id: 3, session_id: 7, nom: "Soula" }],
  }).installer();
  const r = await appel("PATCH", "/api/inscriptions/11", { groupe_id: 3, prescripteur: "of", dossier_complet: true }, CONTRIBUTEUR);
  assert.equal(r.statut, 200);
  assert.equal(base.etat.inscriptions[0].groupe_id, 3);
  assert.equal(base.etat.inscriptions[0].prescripteur, "of");
  assert.equal(base.etat.inscriptions[0].dossier_complet, true);
});

test("un groupe d'une autre session est refusé", async () => {
  baseSimulee({
    stagiaires: [{ id: 1, nom: "Stark", prenom: "Blandine" }],
    inscriptions: [{ id: 11, stagiaire_id: 1, session_id: 7 }],
    groupes: [{ id: 9, session_id: 8, nom: "Ailleurs" }],
  }).installer();
  const r = await appel("PATCH", "/api/inscriptions/11", { groupe_id: 9 });
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /n'appartient pas/);
});

test("l'abandon reste intact (non-régression L2)", async () => {
  const base = baseSimulee({
    stagiaires: [{ id: 1, nom: "Stark", prenom: "Blandine" }],
    inscriptions: [{ id: 11, stagiaire_id: 1, session_id: 7 }],
  }).installer();
  const r = await appel("PATCH", "/api/inscriptions/11", { statut: "abandon", date_abandon: "2026-09-01" });
  assert.equal(r.statut, 200);
  assert.equal(base.etat.inscriptions[0].statut, "abandon");
  assert.equal(base.etat.inscriptions[0].date_abandon, "2026-09-01");
});

test("un identifiant d'inscription invalide donne 400", async () => {
  baseSimulee().installer();
  const r = await appel("PATCH", "/api/inscriptions/abc", { dossier_complet: true });
  assert.equal(r.statut, 400);
});

// ── Droits ───────────────────────────────────────────────────

test("l'import et l'aperçu demandent une session", async () => {
  baseSimulee().installer();
  assert.equal((await apercu(csv([["Mme", "A", "Un", "", "", "", "", "", "", "", "", ""]]), null)).statut, 401);
  assert.equal((await importer(csv([["Mme", "A", "Un", "", "", "", "", "", "", "", "", ""]]), null)).statut, 401);
});

test("un rôle non autorisé n'importe pas", async () => {
  baseSimulee().installer();
  assert.equal((await apercu(csv([["Mme", "A", "Un", "", "", "", "", "", "", "", "", ""]]), AUTRE)).statut, 403);
  assert.equal((await importer(csv([["Mme", "A", "Un", "", "", "", "", "", "", "", "", ""]]), AUTRE)).statut, 403);
});

test("un contributeur importe un stagiaire", async () => {
  const base = baseSimulee().installer();
  const r = await importer(csv([["M.", "Dupont", "Jean", "jean@exemple.fr", "", "", "", "", "", "", "", ""]]), CONTRIBUTEUR);
  assert.equal(r.statut, 200);
  assert.equal(r.corps.bilan.crees, 1);
  assert.equal(base.etat.stagiaires.length, 1);
  assert.equal(base.etat.inscriptions.length, 1);
});

test("le contributeur gagne la fiche et l'inscription, rien d'autre", async () => {
  // Les routes d'administration restent fermées au contributeur.
  baseSimulee().installer();
  assert.equal((await appel("POST", "/api/sessions", { formation_id: 1, date_debut: "2026-01-05", date_fin: "2026-03-05" }, CONTRIBUTEUR)).statut, 403);
  assert.equal((await appel("PUT", "/api/formations/1", { intitule: "X" }, CONTRIBUTEUR)).statut, 403);
  assert.equal((await appel("POST", "/api/preuves", { titre: "X", statut: "maitrise" }, CONTRIBUTEUR)).statut, 403);
  assert.equal((await appel("DELETE", "/api/modeles/1", undefined, CONTRIBUTEUR)).statut, 403);
});
