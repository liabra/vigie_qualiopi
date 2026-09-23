// ─────────────────────────────────────────────────────────────
//  L9 — Robustesse de la génération de documents Drive / Docs.
//
//  L'application Express RÉELLE est montée : la base est remplacée
//  (db.setPoolFactory) et le client Google par un FAUX (google.setDriveFactory).
//  On vérifie ainsi le contrat HTTP complet (400/403/409/503) ET l'ordre
//  réel des appels Google (copies, relectures, mise à la corbeille).
// ─────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { setPoolFactory } from "../src/db.js";
import { setDriveFactory, DRIVE_FILE } from "../src/services/google.js";
import { encode } from "../src/session.js";

const DOC = "application/vnd.google-apps.document";
const ADMIN = { id: 1, email: "admin@exemple.fr", nom: "Mme Stark", role: "admin" };
const CONTRIBUTEUR = { id: 2, email: "tukui@exemple.fr", nom: "Tukui", role: "contributeur" };
const SQL_UTILISATEUR = "SELECT id, email, nom, role FROM utilisateurs WHERE id = $1 AND actif";
const sqlNormalise = (t) => String(t).replace(/\s+/g, " ").trim();

let serveur, origine;
before(async () => {
  serveur = createApp().listen(0);
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});
after(async () => {
  setPoolFactory(null);
  setDriveFactory(null);
  if (serveur) await new Promise((r) => serveur.close(r));
});

// ── Fausse base ─────────────────────────────────────────────
function baseSimulee({ modele = null, existants = [], echec = null, groupe = null, journal = null } = {}) {
  const appels = [];
  const noter = (evt) => { if (journal) journal.push(evt); };
  const session = {
    id: 1, reference: "SESS-1", date_debut: "2026-01-05", date_fin: "2026-03-05",
    lieu: "Cayenne", formateur: "Mme Carr", horaire: "8h30–12h00",
    duree_heures_reelle: 28, formation_id: 1, intitule: "Atelier numérique",
    duree_heures_defaut: 21, statut: "planifiee",
  };
  const modeleDefaut = { id: 1, nom: "Attestation", drive_file_id: "MODELE", drive_mime: DOC, portee: "stagiaire" };
  const executer = async (text, params) => {
    const sql = sqlNormalise(text);
    appels.push({ sql, params });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql === SQL_UTILISATEUR) {
      const u = [ADMIN, CONTRIBUTEUR].find((x) => x.id === params[0]);
      return { rows: u ? [u] : [] };
    }
    if (sql.startsWith("SELECT * FROM modeles_documents WHERE id = $1 AND actif")) {
      return { rows: modele === null ? [modeleDefaut] : (modele ? [modele] : []) };
    }
    if (sql.startsWith("SELECT indicateur_id FROM modele_indicateurs")) return { rows: [{ indicateur_id: 11 }] };
    if (sql.startsWith("SELECT s.*, f.id AS formation_id")) return { rows: [{ ...session }] };
    if (sql.startsWith("SELECT * FROM groupes WHERE id = $1 AND session_id = $2")) {
      return { rows: groupe ? [groupe] : [] };
    }
    if (sql.startsWith("SELECT s.id, s.civilite, s.nom, s.prenom, s.email")) {
      return { rows: [{ id: 1, civilite: "Mme", nom: "Stark", prenom: "Blandine", email: null, telephone: null,
        entreprise: null, financeur: null, prescripteur: "pole_emploi", prescripteur_nom: "Pôle Emploi",
        groupe_nom: "Soula", statut: "inscrit", heures_absence: "0" }] };
    }
    if (sql.startsWith("SELECT * FROM documents_generes")) return { rows: existants };
    if (echec && sql.startsWith(echec)) { const e = new Error("échec simulé " + echec); e.code = "23502"; throw e; }
    if (sql.startsWith("INSERT INTO generations")) { noter("DB:generations"); return { rows: [{ id: 99 }] }; }
    if (sql.startsWith("INSERT INTO preuves")) return { rows: [{ id: 10 }] };
    if (sql.startsWith("DELETE FROM preuve_fichiers")) return { rows: [] };
    if (sql.startsWith("INSERT INTO preuve_fichiers")) return { rows: [] };
    if (sql.startsWith("INSERT INTO documents_generes")) { noter("DB:documents_generes"); return { rows: [] }; }
    throw new Error("Requête inattendue pour la base simulée : " + sql);
  };
  const pool = {
    query: executer,
    connect: async () => ({
      query: async (t, p) => {
        const s = sqlNormalise(t);
        if (s === "COMMIT") { if (journal) journal.push("DB:COMMIT"); }
        return executer(t, p);
      },
      release: () => {},
    }),
  };
  return { appels, installer: () => { setPoolFactory(() => pool); return { appels }; } };
}

// ── Faux client Google ───────────────────────────────────────
// Trace : copies créées, fichiers mis à la corbeille, relectures.
function clientDriveSimule({ modeleGet = null, mimeModele = DOC, trashModele = false, echecGet = null,
  echecCopy = null, echecBatch = null, echecTrash = null, copieRelue = null, attente = null, journal = null } = {}) {
  const trace = { copies: 0, copiesCreees: [], corbeille: [], relectures: 0, remplacements: 0 };
  const noter = (evt) => { if (journal) journal.push(evt); };
  let n = 0;
  const client = {
    row: { scopes: DRIVE_FILE, expiry: Date.now() + 60_000, access_token: "x" },
    drive: {
      files: {
        get: async () => {
          if (echecGet) throw Object.assign(new Error(echecGet.message), { response: { status: echecGet.statut } });
          return { data: { id: "MODELE", name: "Attestation", mimeType: modeleGet || mimeModele, trashed: trashModele } };
        },
        list: async () => ({ data: { files: [] } }),
        create: async () => ({ data: { id: "dossier-" + ++n } }),
        copy: async ({ requestBody }) => {
          if (attente) await attente;
          if (echecCopy) throw Object.assign(new Error(echecCopy.message), { response: { status: echecCopy.statut } });
          trace.copies++;
          const id = "copie-" + trace.copies;
          trace.copiesCreees.push(id);
          noter("Drive:copy:" + id);
          return { data: { id, name: requestBody.name, webViewLink: "https://d/" + id, mimeType: mimeModele } };
        },
        update: async ({ fileId, requestBody }) => {
          if (requestBody?.trashed) {
            if (echecTrash) throw Object.assign(new Error(echecTrash.message), { response: { status: echecTrash.statut } });
            trace.corbeille.push(fileId);
            noter("Drive:trash:" + fileId);
          }
          return { data: {} };
        },
      },
    },
    docs: {
      documents: {
        get: async ({ documentId }) => {
          if (documentId !== "MODELE") {
            trace.relectures++;
            // Copie relue après remplacement : vide, sauf si le test veut
            // simuler un marqueur resté non remplacé.
            return { data: copieRelue || { body: { content: [] }, headers: {}, footers: {} } };
          }
          // Modèle original : avec un marqueur inconnu si demandé.
          return { data: { body: { content: [{ paragraph: { elements: [{ textRun: { content: "{{inconnu_x}}" } }] } }] }, headers: {}, footers: {} } };
        },
        batchUpdate: async () => {
          if (echecBatch) throw Object.assign(new Error(echecBatch.message), { response: { status: echecBatch.statut } });
          trace.remplacements++;
          return { data: {} };
        },
      },
    },
    sheets: { spreadsheets: { batchUpdate: async () => ({ data: {} }) } },
  };
  return { trace, client };
}

const generer = async (corps, utilisateur = ADMIN) => {
  const r = await fetch(origine + "/api/generations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(utilisateur ? { cookie: "vq_session=" + encode({ uid: utilisateur.id, exp: Date.now() + 60_000 }) } : {}),
    },
    body: JSON.stringify(corps),
  });
  return { statut: r.status, corps: await r.json().catch(() => null) };
};

const requete = { modele_id: 1, session_id: 1 };

// ── Validation avant appel Google ────────────────────────────

test("un modèle inexistant est refusé 400 avant tout appel Google", async () => {
  baseSimulee({ modele: false }).installer();
  const { trace, client } = clientDriveSimule();
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /Modèle introuvable/);
  assert.equal(trace.copies, 0, "aucune copie créée");
});

test("un modèle Drive introuvable (404) est refusé 400 sans copie", async () => {
  baseSimulee().installer();
  const { trace, client } = clientDriveSimule({ echecGet: { statut: 404, message: "Not Found" } });
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /introuvable ou a été supprimé/);
  assert.equal(trace.copies, 0);
});

test("un modèle en corbeille ou inaccessible est refusé clairement", async () => {
  baseSimulee().installer();
  const a = clientDriveSimule({ trashModele: true });
  setDriveFactory(() => a.client);
  assert.equal((await generer(requete)).statut, 400);

  const b = clientDriveSimule({ echecGet: { statut: 403, message: "Forbidden" } });
  setDriveFactory(() => b.client);
  const r2 = await generer(requete);
  assert.equal(r2.statut, 400);
  assert.match(r2.corps.error, /pas accessible/);
  assert.equal(b.trace.copies, 0);
});

test("un modèle ni Doc ni Sheet est refusé 400", async () => {
  baseSimulee().installer();
  const { trace, client } = clientDriveSimule({ mimeModele: "application/pdf" });
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /ni un Google Doc ni un Google Sheet/);
  assert.equal(trace.copies, 0);
});

test("Drive non connecté ⇒ 503, lecture seule ⇒ 400", async () => {
  baseSimulee().installer();
  setDriveFactory(() => null);
  const r = await generer(requete);
  assert.equal(r.statut, 503);
  assert.match(r.corps.error, /indisponible ou non connecté/);

  const { client } = clientDriveSimule();
  client.row.scopes = "";   // sans drive.file : lecture seule
  setDriveFactory(() => client);
  const r2 = await generer(requete);
  assert.equal(r2.statut, 400);
  assert.match(r2.corps.error, /lecture seule/);
});

test("un groupe d'une autre session est refusé avant copie", async () => {
  baseSimulee({ groupe: null }).installer();
  const { trace, client } = clientDriveSimule();
  setDriveFactory(() => client);
  const r = await generer({ ...requete, groupe_id: 9 });
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /Groupe introuvable/);
  assert.equal(trace.copies, 0);
});

// ── Marqueurs ────────────────────────────────────────────────

test("un marqueur inconnu est remonté, pas silencieux", async () => {
  baseSimulee().installer();
  const { client } = clientDriveSimule();
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps.marqueursInconnus, ["inconnu_x"]);
});

test("un marqueur resté non remplacé est remonté", async () => {
  baseSimulee().installer();
  const copieRelue = { body: { content: [{ paragraph: { elements: [{ textRun: { content: "Bonjour {{nom_stagiaire}}" } }] } }] }, headers: {}, footers: {} };
  const { client } = clientDriveSimule({ copieRelue });
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 200);
  assert.ok(r.corps.marqueursNonResolus.includes("nom_stagiaire"), "le marqueur restant est signalé");
});

// ── Échecs Google ────────────────────────────────────────────

test("un échec de copie ne laisse ni fichier ni ligne DB, erreur exploitable", async () => {
  const b = baseSimulee().installer();
  const { trace, client } = clientDriveSimule({ echecCopy: { statut: 403, message: "Forbidden" } });
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 400);
  assert.equal(trace.copies, 0);
  assert.ok(!b.appels.some((a) => a.sql.startsWith("INSERT INTO generations")), "aucune génération enregistrée");
});

test("un échec batchUpdate après copie met la copie à la corbeille et n'écrit rien", async () => {
  const b = baseSimulee().installer();
  const { trace, client } = clientDriveSimule({ echecBatch: { statut: 500, message: "Internal" } });
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 503);
  assert.equal(trace.copies, 1, "la copie a bien été créée");
  assert.deepEqual(trace.corbeille, ["copie-1"], "puis mise à la corbeille");
  assert.ok(!b.appels.some((a) => a.sql.startsWith("INSERT INTO generations")), "aucune génération enregistrée");
});

test("un échec DB après copie nettoie (best-effort) et répond 500 sans fuite", async () => {
  const b = baseSimulee({ echec: "INSERT INTO generations" }).installer();
  const { trace, client } = clientDriveSimule();
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 500);
  assert.deepEqual(r.corps, { error: "Erreur serveur." }, "aucun détail SQL ne fuit");
  assert.deepEqual(trace.corbeille, ["copie-1"], "la copie orpheline est mise à la corbeille");
  assert.ok(b.appels.some((a) => a.sql === "ROLLBACK"), "la transaction est annulée");
});

// ── Double requête / doublon ─────────────────────────────────

test("deux générations simultanées : la seconde est refusée 409", async () => {
  baseSimulee().installer();
  let liberer;
  const attente = new Promise((r) => { liberer = r; });
  const { client } = clientDriveSimule({ attente });
  setDriveFactory(() => client);

  const premiere = generer(requete);
  // Laisse la première atteindre la copie (en attente)…
  await new Promise((r) => setTimeout(r, 30));
  const seconde = await generer(requete);
  assert.equal(seconde.statut, 409);
  assert.match(seconde.corps.error, /déjà en cours/);

  liberer();
  const fin = await premiere;
  assert.equal(fin.statut, 200);
});

// ── Régénération ─────────────────────────────────────────────

const existantsRegen = () => [
  { id: 5, modele_id: 1, session_id: 1, groupe_id: null, stagiaire_id: 1,
    drive_file_id: "ancien-fichier", drive_url: "https://d/ancien", nom: "Attestation - Stark" },
];

test("régénérer : nouveau créé, DB écrite, ancien trashé SEULEMENT après le commit", async () => {
  const journal = [];
  baseSimulee({ existants: existantsRegen(), journal }).installer();
  const { trace, client } = clientDriveSimule({ journal });
  setDriveFactory(() => client);
  const r = await generer({ ...requete, remplacer: true });
  assert.equal(r.statut, 200);
  assert.equal(r.corps.remplaces, 1);
  assert.deepEqual(r.corps.anciensNonArchives, []);
  assert.deepEqual(trace.copiesCreees, ["copie-1"], "un nouveau fichier est créé");
  assert.ok(trace.corbeille.includes("ancien-fichier"), "l'ancien fichier est mis à la corbeille");
  const iCommit = journal.indexOf("DB:COMMIT");
  const iTrash = journal.indexOf("Drive:trash:ancien-fichier");
  assert.ok(iCommit >= 0 && iTrash > iCommit, "l'ancien n'est trashé qu'APRÈS le commit DB");
});

test("régénérer, DB échoue : ancien intact, nouveau trashé, erreur conservée", async () => {
  const journal = [];
  baseSimulee({ existants: existantsRegen(), echec: "INSERT INTO generations", journal }).installer();
  const { trace, client } = clientDriveSimule({ journal });
  setDriveFactory(() => client);
  const r = await generer({ ...requete, remplacer: true });
  assert.equal(r.statut, 500);
  assert.deepEqual(r.corps, { error: "Erreur serveur." }, "erreur originale non déguisée, sans fuite");
  assert.ok(!trace.corbeille.includes("ancien-fichier"), "l'ancien fichier n'est PAS trashé");
  assert.deepEqual(trace.corbeille, ["copie-1"], "seule la nouvelle copie est mise à la corbeille (best-effort)");
  assert.ok(!journal.includes("DB:COMMIT"), "aucun commit n'a eu lieu");
  assert.ok(!journal.includes("DB:documents_generes"), "l'ancien enregistrement n'est pas réécrit");
});

test("régénérer, trash de l'ancien échoue après DB : génération réussie, avertissement", async () => {
  baseSimulee({ existants: existantsRegen() }).installer();
  const { trace, client } = clientDriveSimule({ echecTrash: { statut: 500, message: "Internal" } });
  setDriveFactory(() => client);
  const r = await generer({ ...requete, remplacer: true });
  assert.equal(r.statut, 200, "la génération reste réussie");
  assert.equal(r.corps.remplaces, 1);
  assert.deepEqual(r.corps.anciensNonArchives, ["ancien-fichier"], "l'échec d'archivage est signalé");
  assert.deepEqual(trace.copiesCreees, ["copie-1"], "le nouveau fichier est bien créé");
  assert.ok(!trace.corbeille.includes("ancien-fichier"), "l'ancien n'a pas été trashé (échec)");
});

// ── Droits ───────────────────────────────────────────────────

test("droits : contributeur autorisé, anonyme 401", async () => {
  baseSimulee().installer();
  const { client } = clientDriveSimule();
  setDriveFactory(() => client);
  assert.equal((await generer(requete, CONTRIBUTEUR)).statut, 200);
  assert.equal((await generer(requete, null)).statut, 401);
});
