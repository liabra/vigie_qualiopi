// Contrat HTTP des preuves : création manuelle, correction du titre, de la
// description et de l'indicateur, remplacement du fichier d'une preuve
// « un seul fichier », suppression d'une preuve confirmée, et non-régression
// du mécanisme multi-fichiers existant.
//
// L'application Express réelle est montée, et la couche base est remplacée
// par une base simulée (db.setPoolFactory) : aucun PostgreSQL n'est
// nécessaire, `npm test` reste hermétique. La base simulée REFUSE toute
// requête qu'elle ne connaît pas : si une route se met à écrire ailleurs,
// ces tests échouent au lieu de passer à vide.
//
// Ce qui n'est PAS exercé ici : les calculs de la vue `preuves_enrichies`
// (comptage attendu, `incomplet`, alertes) appartiennent au SQL, et les
// colonnes lues par GET /api/preuves (description, indicateur_id) sont
// vérifiées contre un vrai PostgreSQL, hors de cette suite.
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

// ── Base simulée ─────────────────────────────────────────────
// Petit magasin en mémoire : les preuves, leurs pièces jointes et les
// indicateurs du référentiel actif. Elle journalise chaque requête reçue,
// ce qui permet d'asserter ce qui a été ÉCRIT, pas seulement la réponse.
function baseSimulee({ indicateurs = { 10: 1, 11: 2, 30: 27 }, preuves = [], fichiers = [], collision = false,
                       sessions = { 7: true }, groupes = { 2: 7 } } = {}) {
  const appels = [];
  const etat = {
    preuves: new Map(preuves.map((p) => [p.id, { description: null, type_alerte: null, ...p }])),
    fichiers: fichiers.map((f) => ({ ...f })),
    prochainId: Math.max(0, ...preuves.map((p) => p.id)) + 1,
    prochainFichierId: Math.max(0, ...fichiers.map((f) => f.id)) + 1,
  };

  const etatApres = (id) => {
    const p = etat.preuves.get(id);
    if (!p) return null;
    const nb = etat.fichiers.filter((f) => f.preuve_id === id).length;
    const incomplet = p.mode_fichiers !== "unique" && p.statut !== "non_applicable" && nb === 0;
    return {
      statut: p.statut, statut_effectif: incomplet && p.statut === "maitrise" ? "a_consolider" : p.statut,
      mode_fichiers: p.mode_fichiers, nb_fichiers: nb, fichiers_attendus: null, incomplet,
      type_alerte: p.type_alerte, periodicite_mois: p.periodicite_mois ?? null,
      date_echeance: p.date_echeance ?? null, date_derniere_revision: null, alerte_statut: null,
    };
  };

  // INSERT ... (colonnes) VALUES ($1, $2…) : les jetons sont dans l'ordre
  // des colonnes, on les résout depuis les paramètres.
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
    appels.push({ sql, params });

    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };

    if (sql === SQL_UTILISATEUR) {
      const u = [ADMIN, CONTRIBUTEUR].find((x) => x.id === params[0]);
      return { rows: u ? [u] : [] };
    }

    if (sql === "SELECT 1 FROM sessions WHERE id = $1") {
      return { rows: sessions[params[0]] ? [{ "?column?": 1 }] : [], rowCount: sessions[params[0]] ? 1 : 0 };
    }
    if (sql === "SELECT session_id FROM groupes WHERE id = $1") {
      return groupes[params[0]] !== undefined ? { rows: [{ session_id: groupes[params[0]] }] } : { rows: [] };
    }

    if (sql.startsWith("SELECT i.id, i.numero FROM indicateurs")) {
      const demandes = params[0] || [];
      const rows = demandes.filter((id) => indicateurs[id] !== undefined)
        .map((id) => ({ id, numero: indicateurs[id] }))
        .sort((a, b) => a.numero - b.numero);
      return { rows };
    }

    if (sql.startsWith("SELECT 1 FROM indicateurs")) {
      return { rows: indicateurs[params[0]] !== undefined ? [{ "?column?": 1 }] : [], rowCount: indicateurs[params[0]] !== undefined ? 1 : 0 };
    }

    if (sql.startsWith("INSERT INTO preuves")) {
      const row = ligneInseree(sql, params);
      const id = etat.prochainId++;
      etat.preuves.set(id, { id, mode_fichiers: "unique", statut: "a_risque", ...row });
      return { rows: [{ id }] };
    }

    if (sql.startsWith("INSERT INTO preuve_fichiers")) {
      const row = ligneInseree(sql, params);
      const deja = etat.fichiers.find((f) => f.preuve_id === row.preuve_id && f.drive_file_id === row.drive_file_id);
      if (deja && sql.includes("DO NOTHING")) return { rows: [] };
      if (deja) return { rows: [{ id: deja.id, ...deja }], rowCount: 1 };
      const id = etat.prochainFichierId++;
      const f = { id, ...row };
      etat.fichiers.push(f);
      return { rows: [{ id, drive_file_id: f.drive_file_id, url: f.drive_url, nom: f.drive_nom, mime: f.drive_mime, source: f.source }], rowCount: 1 };
    }

    if (sql === "DELETE FROM preuve_fichiers WHERE preuve_id = $1") {
      const avant = etat.fichiers.length;
      etat.fichiers = etat.fichiers.filter((f) => f.preuve_id !== params[0]);
      return { rows: [], rowCount: avant - etat.fichiers.length };
    }

    if (sql === "DELETE FROM preuve_fichiers WHERE id = $1 AND preuve_id = $2") {
      const avant = etat.fichiers.length;
      etat.fichiers = etat.fichiers.filter((f) => !(f.id === params[0] && f.preuve_id === params[1]));
      return { rows: [], rowCount: avant - etat.fichiers.length };
    }

    if (sql.startsWith("UPDATE preuves SET")) {
      if (collision) { const e = new Error("doublon"); e.code = "23505"; throw e; }
      const p = etat.preuves.get(params[0]);
      if (!p) return { rows: [], rowCount: 0 };
      const sets = /UPDATE preuves SET (.+) WHERE id = \$1/.exec(sql)[1].split(", ");
      for (const clause of sets) {
        const [col, jeton] = clause.split(" = ");
        assert.ok(/^[a-z_]+$/.test(col), "UPDATE simulé : clause inattendue « " + clause + " »");
        p[col] = /^\$\d+$/.test(jeton) ? params[Number(jeton.slice(1)) - 1]
          : (jeton === "false" ? false : jeton);
      }
      return { rows: [{ id: p.id }], rowCount: 1 };
    }

    if (sql.startsWith("SELECT mode_fichiers FROM preuves WHERE id = $1")) {
      const p = etat.preuves.get(params[0]);
      return { rows: p ? [{ mode_fichiers: p.mode_fichiers }] : [] };
    }

    if (sql === "DELETE FROM preuves WHERE id = $1") {
      const existait = etat.preuves.delete(params[0]);
      etat.fichiers = etat.fichiers.filter((f) => f.preuve_id !== params[0]);   // ON DELETE CASCADE
      return { rows: [], rowCount: existait ? 1 : 0 };
    }

    if (sql.startsWith("SELECT statut, statut_effectif, mode_fichiers")) {
      const a = etatApres(params[0]);
      return { rows: a ? [a] : [] };
    }

    throw new Error("Requête inattendue pour la base simulée : " + sql);
  };

  const pool = { query: executer, connect: async () => ({ query: executer, release: () => {} }) };
  return {
    etat,
    appels,
    ecritures: (motif) => appels.filter((a) => a.sql.includes(motif)),
    installer: () => { setPoolFactory(() => pool); return pool; },
  };
}

const PREUVE_CONFIRMEE = {
  id: 7, indicateur_id: 10, titre: "CGV A2C", statut: "maitrise", mode_fichiers: "unique",
  a_confirmer: false, description: null,
};
const FICHIER_EXISTANT = { id: 3, preuve_id: 7, drive_file_id: "ANCIEN", source: "manuel" };

// Drive simulé « connecté et fonctionnel » par défaut : les tests de
// création avec fichier passent ainsi la vérification sans configurer
// Google. Les cas « fichier absent » ou « Drive non connecté » le
// remplacent ponctuellement.
const driveValide = () => ({
  drive: { files: { get: async ({ fileId }) => ({ data: { id: fileId, name: "Fiche.pdf", mimeType: "application/pdf", webViewLink: "https://drive.google.com/file/d/" + fileId + "/view" } }) } },
});

let serveur, origine;
before(async () => {
  setDriveFactory(driveValide);
  serveur = createApp().listen(0);
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});
after(async () => {
  setPoolFactory(null);   // rétablit la vraie couche base
  setDriveFactory(null);  // rétablit le vrai client Drive
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
const creer = (corps, utilisateur = ADMIN) => appel("/api/preuves", { methode: "POST", corps, utilisateur });
const fichierDrive = { drive_file_id: "EDUSIGN-1", drive_url: "https://drive.google.com/file/d/EDUSIGN-1/view", drive_nom: "Emargement.pdf", drive_mime: "application/pdf" };

// ── Création manuelle ────────────────────────────────────────

test("un admin crée une preuve rattachée à un fichier du Drive", async () => {
  const b = baseSimulee(); b.installer();
  const r = await creer({ indicateur_id: 10, titre: "  Export EduSign  ", description: " émargements ",
    statut: "maitrise", mode_fichiers: "unique", ...fichierDrive });
  assert.equal(r.statut, 201);
  assert.deepEqual(r.corps.preuves, [{ id: 1, indicateur: 1 }]);
  const [p] = [...b.etat.preuves.values()];
  assert.equal(p.titre, "Export EduSign", "titre rogné");
  assert.equal(p.description, "émargements");
  assert.equal(p.indicateur_id, 10);
  assert.equal(p.statut, "maitrise");
  assert.equal(p.created_by, ADMIN.id);
  assert.deepEqual(b.etat.fichiers.map((f) => f.drive_file_id), ["EDUSIGN-1"]);
  assert.equal(b.etat.fichiers[0].source, "manuel");
});

test("un document externe (EduSign) se rattache à une session sans copier le fichier", async () => {
  const b = baseSimulee(); b.installer();
  const r = await creer({
    indicateur_id: 11, titre: "Feuille d'émargement EduSign", session_id: 7, groupe_id: 2,
    mode_fichiers: "multiple", ...fichierDrive,
  });
  assert.equal(r.statut, 201);
  const [p] = [...b.etat.preuves.values()];
  assert.equal(p.session_id, 7, "la preuve est rattachée à la session");
  assert.equal(p.groupe_id, 2);
  assert.equal(p.mode_fichiers, "multiple", "plusieurs pièces EduSign possibles");
  // Seul l'identifiant Drive est stocké : aucun contenu, aucun appel Google.
  assert.deepEqual(b.etat.fichiers.map((f) => f.drive_file_id), ["EDUSIGN-1"]);
  assert.equal(b.etat.fichiers[0].source, "manuel", "source externe, jamais « generation »");
  for (const a of b.appels) {
    assert.ok(
      ["BEGIN", "COMMIT", "ROLLBACK"].includes(a.sql) ||
      a.sql === SQL_UTILISATEUR ||
      a.sql === "SELECT 1 FROM sessions WHERE id = $1" ||
      a.sql === "SELECT session_id FROM groupes WHERE id = $1" ||
      a.sql.startsWith("SELECT i.id, i.numero FROM indicateurs") ||
      a.sql.startsWith("INSERT INTO preuves") ||
      a.sql.startsWith("INSERT INTO preuve_fichiers"),
      "la route n'écrit que des métadonnées (aucun contenu, aucune copie) : " + a.sql
    );
  }
});

test("une preuve rattachée à une session reste facultative sur la session", async () => {
  const b = baseSimulee(); b.installer();
  const r = await creer({ indicateur_id: 11, titre: "Rapport EduSign" });
  assert.equal(r.statut, 201);
  const [p] = [...b.etat.preuves.values()];
  assert.equal(p.session_id, null, "sans session fournie, rien n'est rattaché");
});

test("un fichier Drive inexistant ou inaccessible est refusé avant toute écriture", async () => {
  setDriveFactory(() => ({
    drive: { files: { get: async () => { const e = new Error("not found"); e.response = { status: 404 }; throw e; } } },
  }));
  try {
    const b = baseSimulee(); b.installer();
    const r = await creer({ indicateur_id: 11, titre: "Export EduSign", drive_file_id: "ABSENT" });
    assert.equal(r.statut, 400);
    assert.match(r.corps.error, /introuvable|inaccessible/i);
    assert.equal(b.etat.preuves.size, 0, "aucune preuve créée");
    assert.equal(b.etat.fichiers.length, 0, "aucune pièce cassée");
  } finally {
    setDriveFactory(driveValide);
  }
});

test("un fichier Drive réel est vérifié, et son nom/URL récupérés", async () => {
  const b = baseSimulee(); b.installer();
  const r = await creer({ indicateur_id: 11, titre: "Export EduSign", drive_file_id: "REEL-1" });
  assert.equal(r.statut, 201);
  assert.equal(b.etat.fichiers[0].drive_nom, "Fiche.pdf", "nom réel récupéré du Drive");
});

test("Drive non connecté : un rattachement avec drive_file_id est refusé (503)", async () => {
  setDriveFactory(null);
  try {
    const b = baseSimulee(); b.installer();
    const r = await creer({ indicateur_id: 11, titre: "Export EduSign", drive_file_id: "QUELCONQUE" });
    assert.equal(r.statut, 503);
    assert.match(r.corps.error, /indisponible|non connecté/i);
    assert.equal(b.etat.preuves.size, 0, "aucune preuve créée");
    assert.equal(b.etat.fichiers.length, 0, "aucune pièce cassée");
  } finally {
    setDriveFactory(driveValide);
  }
});

test("session ou groupe inexistants, ou groupe d'une autre session : 400", async () => {
  // session 7 existe, groupe 2 appartient à 7 ; groupe 99 inconnu, groupe 3 appartient à la session 8.
  const cas = [
    [{ indicateur_id: 11, titre: "x", session_id: 999 }, /Session introuvable/],
    [{ indicateur_id: 11, titre: "x", groupe_id: 99 }, /Groupe introuvable/],
    [{ indicateur_id: 11, titre: "x", session_id: 7, groupe_id: 3 }, /n'appartient pas/],
  ];
  for (const [corps, motif] of cas) {
    const b = baseSimulee({ groupes: { 2: 7, 3: 8 } }); b.installer();
    const r = await creer(corps);
    assert.equal(r.statut, 400, JSON.stringify(corps));
    assert.match(r.corps.error, motif);
    assert.equal(b.etat.preuves.size, 0, "aucune preuve créée");
  }
});

test("le fichier est facultatif : une preuve sans fichier reste valide", async () => {
  const b = baseSimulee(); b.installer();
  const r = await creer({ indicateur_id: 10, titre: "Convention à signer" });
  assert.equal(r.statut, 201);
  assert.equal(b.etat.fichiers.length, 0);
  assert.equal([...b.etat.preuves.values()][0].statut, "a_risque", "statut par défaut du modèle");
});

test("plusieurs indicateurs donnent N preuves partageant le MÊME fichier", async () => {
  const b = baseSimulee(); b.installer();
  const r = await creer({ indicateur_ids: [10, 11, 30], titre: "Veille réglementaire", ...fichierDrive });
  assert.equal(r.statut, 201);
  assert.equal(r.corps.total, 3);
  assert.deepEqual(r.corps.preuves.map((p) => p.indicateur), [1, 2, 27]);
  assert.equal(b.etat.preuves.size, 3);
  assert.deepEqual([...b.etat.preuves.values()].map((p) => p.indicateur_id).sort(), [10, 11, 30]);
  assert.deepEqual(b.etat.fichiers.map((f) => f.drive_file_id), ["EDUSIGN-1", "EDUSIGN-1", "EDUSIGN-1"],
    "le même document est rattaché à chacune des preuves");
  assert.equal(new Set(b.etat.fichiers.map((f) => f.preuve_id)).size, 3, "une pièce par preuve, aucune confusion");
});

test("un indicateur répété ne crée qu'une seule preuve", async () => {
  const b = baseSimulee(); b.installer();
  const r = await creer({ indicateur_ids: [10, 10, 10], titre: "Doublon évité" });
  assert.equal(r.statut, 201);
  assert.equal(r.corps.total, 1);
  assert.equal(b.etat.preuves.size, 1);
});

test("un indicateur hors référentiel actif est refusé, sans rien créer", async () => {
  const b = baseSimulee(); b.installer();
  const r = await creer({ indicateur_ids: [10, 99], titre: "Mixte", ...fichierDrive });
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /99/);
  assert.equal(b.etat.preuves.size, 0, "aucune preuve créée : tout ou rien");
  assert.equal(b.etat.fichiers.length, 0);
  assert.ok(b.appels.some((a) => a.sql === "ROLLBACK"));
});

test("titre vide, statut inconnu, mode inconnu, échéance incomplète : 400", async () => {
  const cas = [
    [{ indicateur_id: 10, titre: "   " }, /Titre/],
    [{ indicateur_id: 10, titre: "x", statut: "peut_etre" }, /Statut/],
    [{ indicateur_id: 10, titre: "x", mode_fichiers: "beaucoup" }, /Mode/],
    [{ indicateur_id: 10, titre: "x", type_alerte: "tous_les_mois" }, /échéance/],
    [{ indicateur_id: 10, titre: "x", type_alerte: "revision_periodique" }, /périodicité/],
    [{ indicateur_id: 10, titre: "x", type_alerte: "echeance_fixe" }, /date d'échéance/],
    [{ titre: "x" }, /indicateur/],
  ];
  for (const [corps, motif] of cas) {
    const b = baseSimulee(); b.installer();
    const r = await creer(corps);
    assert.equal(r.statut, 400, JSON.stringify(corps));
    assert.match(r.corps.error, motif);
    assert.equal(b.etat.preuves.size, 0);
  }
});

test("échéance : périodicité et date d'échéance sont écrites avec le bon type", async () => {
  const b1 = baseSimulee(); b1.installer();
  await creer({ indicateur_id: 10, titre: "Veille", type_alerte: "revision_periodique", periodicite_mois: 12 });
  const p1 = [...b1.etat.preuves.values()][0];
  assert.equal(p1.type_alerte, "revision_periodique");
  assert.equal(p1.periodicite_mois, 12);
  assert.equal(p1.date_echeance, null, "aucune date d'échéance sur une révision périodique");

  const b2 = baseSimulee(); b2.installer();
  await creer({ indicateur_id: 10, titre: "Contrat", type_alerte: "echeance_fixe", date_echeance: "2027-06-30" });
  const p2 = [...b2.etat.preuves.values()][0];
  assert.equal(p2.date_echeance, "2027-06-30");
  assert.equal(p2.periodicite_mois, null);
});

test("un contributeur ne peut pas créer de preuve", async () => {
  const b = baseSimulee(); b.installer();
  const r = await creer({ indicateur_id: 10, titre: "Par le contributeur" }, CONTRIBUTEUR);
  assert.equal(r.statut, 403);
  assert.equal(b.etat.preuves.size, 0);
  assert.equal(b.ecritures("INSERT INTO preuves").length, 0);
  const anonyme = await appel("/api/preuves", { methode: "POST", corps: { indicateur_id: 10, titre: "x" }, utilisateur: null });
  assert.equal(anonyme.statut, 401);
  assert.equal(b.etat.preuves.size, 0);
});

// ── Correction d'une preuve existante ────────────────────────

test("un admin peut corriger le titre et la description", async () => {
  const b = baseSimulee({ preuves: [PREUVE_CONFIRMEE] }); b.installer();
  const r = await appel("/api/preuves/7", { methode: "PATCH", corps: { titre: "  CGV A2C 2026 ", description: " version signée " } });
  assert.equal(r.statut, 200);
  const p = b.etat.preuves.get(7);
  assert.equal(p.titre, "CGV A2C 2026");
  assert.equal(p.description, "version signée");
});

test("un titre vide est refusé, et rien n'est écrit", async () => {
  const b = baseSimulee({ preuves: [PREUVE_CONFIRMEE] }); b.installer();
  const r = await appel("/api/preuves/7", { methode: "PATCH", corps: { titre: "   " } });
  assert.equal(r.statut, 400);
  assert.equal(b.etat.preuves.get(7).titre, "CGV A2C");
  assert.equal(b.ecritures("UPDATE preuves").length, 0);
});

test("un admin peut rattacher la preuve au bon indicateur", async () => {
  const b = baseSimulee({ preuves: [PREUVE_CONFIRMEE] }); b.installer();
  const r = await appel("/api/preuves/7", { methode: "PATCH", corps: { indicateur_id: 30 } });
  assert.equal(r.statut, 200);
  assert.equal(b.etat.preuves.get(7).indicateur_id, 30, "preuve classée sur le nouvel indicateur");
});

test("changer d'indicateur vers un indicateur inexistant est refusé", async () => {
  const b = baseSimulee({ preuves: [PREUVE_CONFIRMEE] }); b.installer();
  const r = await appel("/api/preuves/7", { methode: "PATCH", corps: { indicateur_id: 99 } });
  assert.equal(r.statut, 400);
  assert.equal(b.etat.preuves.get(7).indicateur_id, 10);
  assert.equal(b.ecritures("UPDATE preuves").length, 0);
  const r2 = await appel("/api/preuves/7", { methode: "PATCH", corps: { indicateur_id: "abc" } });
  assert.equal(r2.statut, 400, "identifiant non numérique refusé proprement");
});

test("un titre déjà pris par un import répond 409, pas 500", async () => {
  const b = baseSimulee({ preuves: [PREUVE_CONFIRMEE], collision: true }); b.installer();
  const r = await appel("/api/preuves/7", { methode: "PATCH", corps: { titre: "Preuve importée" } });
  assert.equal(r.statut, 409);
  assert.match(r.corps.error, /existe déjà/);
});

test("remplacer le fichier d'une preuve « un seul fichier » DÉJÀ confirmée", async () => {
  const b = baseSimulee({ preuves: [PREUVE_CONFIRMEE], fichiers: [FICHIER_EXISTANT] }); b.installer();
  const r = await appel("/api/preuves/7", { methode: "PATCH", corps: { drive_file_id: "NOUVEAU", drive_nom: "Bon fichier.pdf" } });
  assert.equal(r.statut, 200);
  assert.deepEqual(b.etat.fichiers.map((f) => f.drive_file_id), ["NOUVEAU"], "l'ancien fichier est remplacé");
  assert.equal(b.etat.fichiers[0].source, "manuel");
});

test("modifier une preuve inexistante répond 404", async () => {
  const b = baseSimulee(); b.installer();
  const r = await appel("/api/preuves/999", { methode: "PATCH", corps: { titre: "x" } });
  assert.equal(r.statut, 404);
});

// ── Suppression ──────────────────────────────────────────────

test("un admin peut supprimer une preuve CONFIRMÉE, pas seulement « à confirmer »", async () => {
  const b = baseSimulee({ preuves: [PREUVE_CONFIRMEE], fichiers: [FICHIER_EXISTANT] }); b.installer();
  assert.equal(b.etat.preuves.get(7).a_confirmer, false);
  const r = await appel("/api/preuves/7", { methode: "DELETE" });
  assert.equal(r.statut, 200);
  assert.equal(b.etat.preuves.size, 0);
  assert.equal(b.etat.fichiers.length, 0, "les pièces jointes partent avec la preuve (cascade)");
});

test("supprimer une preuve inexistante répond 404", async () => {
  const b = baseSimulee(); b.installer();
  const r = await appel("/api/preuves/999", { methode: "DELETE" });
  assert.equal(r.statut, 404);
});

test("un contributeur ne peut ni corriger ni supprimer une preuve", async () => {
  const b = baseSimulee({ preuves: [PREUVE_CONFIRMEE], fichiers: [FICHIER_EXISTANT] }); b.installer();
  const r1 = await appel("/api/preuves/7", { methode: "PATCH", corps: { titre: "pirate" }, utilisateur: CONTRIBUTEUR });
  const r2 = await appel("/api/preuves/7", { methode: "DELETE", utilisateur: CONTRIBUTEUR });
  assert.equal(r1.statut, 403);
  assert.equal(r2.statut, 403);
  assert.equal(b.etat.preuves.get(7).titre, "CGV A2C");
  assert.equal(b.etat.preuves.size, 1);
});

// ── Non-régression du mode multi-fichiers ────────────────────

test("le mode multi-fichiers continue d'ajouter des pièces sans remplacer", async () => {
  const b = baseSimulee({
    preuves: [{ ...PREUVE_CONFIRMEE, mode_fichiers: "multiple" }],
    fichiers: [FICHIER_EXISTANT],
  }); b.installer();
  const r = await appel("/api/preuves/7/fichiers", { methode: "POST", corps: { drive_file_id: "DEUXIEME" } });
  assert.equal(r.statut, 200);
  assert.deepEqual(b.etat.fichiers.map((f) => f.drive_file_id).sort(), ["ANCIEN", "DEUXIEME"]);
});

test("en mode « un seul fichier », l'ajout de pièce reste refusé comme avant", async () => {
  const b = baseSimulee({ preuves: [PREUVE_CONFIRMEE], fichiers: [FICHIER_EXISTANT] }); b.installer();
  const r = await appel("/api/preuves/7/fichiers", { methode: "POST", corps: { drive_file_id: "EN_TROP" } });
  assert.equal(r.statut, 409);
  assert.deepEqual(b.etat.fichiers.map((f) => f.drive_file_id), ["ANCIEN"]);
});

test("retirer une pièce jointe reste possible", async () => {
  const b = baseSimulee({ preuves: [PREUVE_CONFIRMEE], fichiers: [FICHIER_EXISTANT] }); b.installer();
  const r = await appel("/api/preuves/7/fichiers/3", { methode: "DELETE" });
  assert.equal(r.statut, 200);
  assert.equal(b.etat.fichiers.length, 0);
});
