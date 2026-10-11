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
const SHEET = "application/vnd.google-apps.spreadsheet";
const ADMIN = { id: 1, email: "admin@exemple.fr", nom: "Mme Stark", role: "admin" };
const CONTRIBUTEUR = { id: 2, email: "tukui@exemple.fr", nom: "Tukui", role: "contributeur" };
const SQL_UTILISATEUR = "SELECT id, email, nom, role FROM utilisateurs WHERE id = $1 AND actif";
const sqlNormalise = (t) => String(t).replace(/\s+/g, " ").trim();

let serveur, origine;
before(async () => {
  serveur = createApp().listen(0, "127.0.0.1"); // fix : même pile que l'origine (aucun port partagé avec un autre fichier)
  await new Promise((r) => serveur.once("listening", r));
  origine = "http://127.0.0.1:" + serveur.address().port;
});
after(async () => {
  setPoolFactory(null);
  setDriveFactory(null);
  if (serveur) await new Promise((r) => serveur.close(r));
});

// ── Fausse base ─────────────────────────────────────────────
function baseSimulee({ modele = null, existants = [], echec = null, groupe = null, journal = null, nbStagiaires = 1 } = {}) {
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
    if (sql === "SELECT archivee_le FROM sessions WHERE id = $1") {
      return { rows: [{ archivee_le: null }] };
    }
    if (sql.startsWith("SELECT * FROM modeles_documents WHERE id = $1 AND actif")) {
      return { rows: modele === null ? [modeleDefaut] : (modele ? [modele] : []) };
    }
    if (sql.startsWith("SELECT indicateur_id FROM modele_indicateurs")) return { rows: [{ indicateur_id: 11 }] };
    if (sql.startsWith("SELECT s.*, f.id AS formation_id")) return { rows: [{ ...session }] };
    // DOC-3B : comptage inscrits/terminés de la session, une requête à part.
    if (sql.startsWith("SELECT count(*) FILTER (WHERE statut <> 'abandon')")) return { rows: [{ inscrits: 1, termines: 0 }] };
    if (sql.startsWith("SELECT * FROM groupes WHERE id = $1 AND session_id = $2")) {
      return { rows: groupe ? [groupe] : [] };
    }
    if (sql.startsWith("SELECT s.id, s.civilite, s.nom, s.prenom, s.email")) {
      // UNE seule requête pour TOUS les stagiaires ciblés, quel qu'en soit
      // le nombre : c'est précisément ce que le test anti-N+1 vérifie.
      return { rows: Array.from({ length: nbStagiaires }, (_, i) => ({
        id: i + 1, civilite: "Mme", nom: "Stark" + i, prenom: "Blandine", email: null, telephone: null,
        entreprise: null, financeur: null, prescripteur: "pole_emploi", prescripteur_nom: "Pôle Emploi",
        groupe_nom: "Soula", statut: "inscrit", heures_absence: "0",
        date_inscription: "2026-01-02", date_abandon: null, motif_abandon: null, relance_derniere_date: null,
      })) };
    }
    if (sql.startsWith("SELECT * FROM documents_generes")) return { rows: existants };
    if (echec && sql.startsWith(echec)) { const e = new Error("échec simulé " + echec); e.code = "23502"; throw e; }
    if (sql.startsWith("INSERT INTO generations")) { noter("DB:generations"); return { rows: [{ id: 99 }] }; }
    if (sql.startsWith("INSERT INTO preuves")) return { rows: [{ id: 10 }] };
    if (sql.startsWith("DELETE FROM preuve_fichiers")) return { rows: [] };
    if (sql.startsWith("INSERT INTO preuve_fichiers")) return { rows: [] };
    if (sql.startsWith("INSERT INTO documents_generes")) { noter("DB:documents_generes"); return { rows: [] }; }
    // Q4-1 : intervenants rattachés — aucun (cas historique, rendu inchangé).
    if (sql.startsWith("SELECT i.id, i.nom, i.prenom, i.fonction FROM intervenants_")) return { rows: [] };
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
// DOC-3C : `modeleTexte` est le contenu ORIGINAL du modèle, désormais
// précontrôlé (analyserModele) avant toute copie. Par défaut, un marqueur
// historique connu (« nom_stagiaire ») — précontrôle propre — pour que les
// tests qui ne portent PAS sur le contenu du modèle (verrou, échecs Drive/DB,
// droits…) ne soient pas bloqués par une variable inconnue sans rapport.
// Simulateur FIDÈLE : copie identique au modèle, application RÉELLE des
// replaceAllText/findReplace, relecture du contenu résultant. Un marqueur
// volontairement ignoré (remplacementIgnorer) reste donc réellement visible.
function clientDriveSimule({ modeleGet = null, mimeModele = DOC, trashModele = false, echecGet = null,
  echecCopy = null, echecBatch = null, echecTrash = null, attente = null, journal = null,
  modeleTexte = "{{nom_stagiaire}}", modeleGrille = null, remplacementIgnorer = [] } = {}) {
  const trace = { copies: 0, copiesCreees: [], corbeille: [], relectures: 0, relecturesSheet: 0, remplacements: 0, dossiersCrees: 0, ciblesReplacees: [] };
  const noter = (evt) => { if (journal) journal.push(evt); };
  const contenuCopies = new Map(); // copie-Id → texte (Doc), initialisé à l'identique du modèle
  const grilleCopies = new Map();  // copie-Id → grille (Sheet), idem
  trace.contenuCopies = contenuCopies;
  trace.grilleCopies = grilleCopies;
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
        create: async () => { trace.dossiersCrees++; return { data: { id: "dossier-" + ++n } }; },
        copy: async ({ requestBody }) => {
          if (attente) await attente;
          if (echecCopy) throw Object.assign(new Error(echecCopy.message), { response: { status: echecCopy.statut } });
          trace.copies++;
          const id = "copie-" + trace.copies;
          trace.copiesCreees.push(id);
          contenuCopies.set(id, modeleTexte);
          grilleCopies.set(id, (modeleGrille || []).map((r) => [...r]));
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
            const texte = contenuCopies.get(documentId) ?? "";
            return { data: { body: { content: [{ paragraph: { elements: [{ textRun: { content: texte } }] } }] }, headers: {}, footers: {} } };
          }
          return { data: { body: { content: [{ paragraph: { elements: [{ textRun: { content: modeleTexte } }] } }] }, headers: {}, footers: {} } };
        },
        batchUpdate: async ({ documentId, requestBody }) => {
          if (echecBatch) throw Object.assign(new Error(echecBatch.message), { response: { status: echecBatch.statut } });
          trace.remplacements++;
          let resultat = contenuCopies.get(documentId) ?? modeleTexte;
          for (const r of requestBody?.requests || []) {
            const cible = r.replaceAllText?.containsText?.text;
            if (!cible || remplacementIgnorer.includes(cible)) continue;
            trace.ciblesReplacees.push({ cible, remplacement: r.replaceAllText?.replaceText ?? "" });
            resultat = resultat.split(cible).join(r.replaceAllText?.replaceText ?? "");
          }
          contenuCopies.set(documentId, resultat);
          return { data: {} };
        },
      },
    },
    sheets: { spreadsheets: {
      get: async ({ spreadsheetId }) => {
        if (spreadsheetId !== "MODELE") trace.relecturesSheet++;
        return { data: { sheets: [{ properties: { title: "Feuille 1", index: 0, gridProperties: { rowCount: 5, columnCount: 5 } } }] } };
      },
      values: { get: async ({ spreadsheetId }) => {
        const grille = spreadsheetId === "MODELE" ? (modeleGrille || []) : (grilleCopies.get(spreadsheetId) || []);
        return { data: { values: grille } };
      } },
      batchUpdate: async ({ spreadsheetId, requestBody }) => {
        if (echecBatch) throw Object.assign(new Error(echecBatch.message), { response: { status: echecBatch.statut } });
        trace.remplacements++;
        const grille = (grilleCopies.get(spreadsheetId) || []).map((r) => [...r]);
        for (const req of requestBody?.requests || []) {
          const fr = req.findReplace;
          if (!fr || remplacementIgnorer.includes(fr.find)) continue;
          trace.ciblesReplacees.push({ cible: fr.find, remplacement: fr.replacement ?? "" });
          for (const ligne of grille) for (let i = 0; i < ligne.length; i++) {
            if (typeof ligne[i] === "string") ligne[i] = ligne[i].split(fr.find).join(fr.replacement ?? "");
          }
        }
        grilleCopies.set(spreadsheetId, grille);
        return { data: {} };
      },
    } },
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
  // DOC-3C : message générique erreurGoogle() (verifierModeleDrive fusionné
  // dans analyserModeleDrive) — même code d'accès refusé, texte uniformisé.
  assert.match(r2.corps.error, /refuse l'accès/);
  assert.equal(b.trace.copies, 0);
});

test("un modèle ni Doc ni Sheet est refusé 400", async () => {
  baseSimulee().installer();
  const { trace, client } = clientDriveSimule({ mimeModele: "application/pdf" });
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /[Ff]ormat.*non pris en charge/);
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

// DOC-3C : une variable INCONNUE du catalogue bloque désormais TOUTE la
// génération avant toute copie — ce n'est plus un simple signalement a
// posteriori (comportement d'avant DOC-3C, remplacé intentionnellement).
test("DOC-3C : un marqueur inconnu du catalogue bloque la génération, aucune copie", async () => {
  baseSimulee().installer();
  const { trace, client } = clientDriveSimule({ modeleTexte: "{{inconnu_x}}" });
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 400);
  assert.ok(r.corps.precontrole);
  assert.equal(r.corps.precontrole.autorise, false);
  assert.ok(r.corps.precontrole.erreurs.some((e) => e.code === "VARIABLE_INCONNUE" && e.nom === "inconnu_x"));
  assert.equal(trace.copies, 0, "aucune copie Drive");
});

// Règle 6 : sur tout échec du précontrôle, AUCUN effet de bord — ni copie,
// ni dossier, ni écriture en base.
test("DOC-3C : refus du précontrôle — zéro copie, zéro dossier créé, zéro écriture DB", async () => {
  const journal = [];
  baseSimulee({ journal }).installer();
  const { trace, client } = clientDriveSimule({ modeleTexte: "{{inconnu_x}}", journal });
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 400);
  assert.equal(trace.copies, 0, "aucune copie");
  assert.equal(trace.dossiersCrees, 0, "aucun dossier Drive créé");
  assert.deepEqual(journal, [], "aucune écriture (documents_generes, preuves, generations)");
});

// Règle 1 : lot de plusieurs stagiaires, erreur bloquante au niveau du
// modèle ⇒ AUCUN document pour AUCUNE cible, jamais un lot partiel.
test("DOC-3C : lot de 3 stagiaires, une erreur bloquante au niveau du modèle empêche tout le lot", async () => {
  baseSimulee({ nbStagiaires: 3 }).installer();
  const { trace, client } = clientDriveSimule({ modeleTexte: "{{stagiaire_besoins_specifiques}}" });
  setDriveFactory(() => client);
  const r = await generer(requete, CONTRIBUTEUR);
  assert.equal(r.statut, 400);
  assert.equal(r.corps.precontrole.erreurs[0].code, "VARIABLE_RESTREINTE_REFUSEE");
  assert.equal(trace.copies, 0, "aucune des 3 cibles n'a produit de copie");
});

// Règle 6/8 : une variable restreinte refuse un contributeur, même si le
// modèle serait par ailleurs valide pour un admin.
test("DOC-3C : contributeur + variable restreinte dans le modèle → refus, admin → autre blocage (non_resoluble)", async () => {
  baseSimulee().installer();
  const { trace, client } = clientDriveSimule({ modeleTexte: "{{stagiaire_besoins_specifiques}}" });
  setDriveFactory(() => client);
  const rContrib = await generer(requete, CONTRIBUTEUR);
  assert.equal(rContrib.statut, 400);
  assert.equal(rContrib.corps.precontrole.erreurs[0].code, "VARIABLE_RESTREINTE_REFUSEE");
  assert.equal(trace.copies, 0);

  const { trace: traceAdmin, client: clientAdmin } = clientDriveSimule({ modeleTexte: "{{stagiaire_besoins_specifiques}}" });
  setDriveFactory(() => clientAdmin);
  const rAdmin = await generer(requete, ADMIN);
  assert.equal(rAdmin.statut, 400);
  assert.equal(rAdmin.corps.precontrole.erreurs[0].code, "CANONIQUE_NON_RESOLUBLE");
  assert.equal(traceAdmin.copies, 0);
});

// Règle 3 : rien à produire ⇒ comportement actuel inchangé — en particulier,
// AUCUNE lecture Drive supplémentaire (le précontrôle n'a aucune raison
// de s'exécuter si aucun document ne sera produit).
test("DOC-3C : non-régression — aucun stagiaire à produire, aucune lecture Drive, erreur claire", async () => {
  baseSimulee({ nbStagiaires: 0 }).installer();
  const { appels: _ignored, client } = clientDriveSimule();
  let driveGetAppele = 0;
  client.drive.files.get = async (...a) => { driveGetAppele++; throw new Error("ne doit jamais être appelé"); };
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 400);
  assert.match(r.corps.error, /Aucun stagiaire inscrit/);
  assert.equal(driveGetAppele, 0, "aucune lecture Drive quand il n'y a rien à produire");
});

test("un marqueur resté non remplacé (après copie) est remonté", async () => {
  baseSimulee().installer();
  const { client } = clientDriveSimule({ remplacementIgnorer: ["{{nom_stagiaire}}"] });
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 200);
  assert.ok(r.corps.marqueursNonResolus.includes("nom_stagiaire"), "le marqueur restant est signalé");
});

// DOC-3D : une variable canonique résolue passe le précontrôle, est rendue,
// et ne laisse aucun marqueur résiduel dans la copie relue.
test("DOC-3D : une variable canonique résolue est rendue, sans blocage ni résidu", async () => {
  baseSimulee().installer();
  const { client } = clientDriveSimule({ modeleTexte: "{{stagiaire_nom}}" });
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps.marqueursNonResolus, []);
  assert.deepEqual(r.corps.marqueursInconnus, []);
});

// DOC-3D : rendu Sheet multi-cibles — un batchUpdate par copie, mais UNE
// SEULE relecture post-rendu, indépendante du nombre de stagiaires.
test("DOC-3D : Sheet multi-cibles — un batchUpdate par copie, une seule relecture post-rendu", async () => {
  baseSimulee({ nbStagiaires: 3 }).installer();
  const { trace, client } = clientDriveSimule({
    mimeModele: SHEET,
    modeleGrille: [["{{stagiaire_nom}}"]],
  });
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 200);
  assert.equal(r.corps.documents, 3);
  assert.equal(trace.remplacements, 3, "un batchUpdate de rendu par copie");
  assert.equal(trace.relecturesSheet, 1, "une seule relecture post-rendu Sheet, indépendante du nombre de cibles");
});

// ── DOC-3D non-régression : modèles Drive actuels (non migrés) ──

test("DOC-3D non-régression : le modèle de Convocation actuel génère sans modification, aucun marqueur actuel ne reste", async () => {
  baseSimulee().installer();
  const modeleConvocation = "{{intitule_formation}} {{civilite}} {{prenom_stagiaire}} {{nom_stagiaire}} {{date_convocation}} {{date_debut}} {{date_fin}} {{horaire}}";
  const { trace, client } = clientDriveSimule({ modeleTexte: modeleConvocation });
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 200);
  // date_convocation est réellement remplacé (compatibilité historique).
  const conv = trace.ciblesReplacees.find((c) => c.cible === "{{date_convocation}}");
  assert.ok(conv, "une requête de remplacement est émise pour {{date_convocation}}");
  assert.match(conv.remplacement, /^\d{2}\/\d{2}\/\d{4}$/, "la date injectée a le format JJ/MM/AAAA");
  const copie = trace.contenuCopies.get("copie-1");
  assert.ok(!copie.includes("{{date_convocation}}"), "la balise date_convocation ne reste pas dans la copie");
  assert.deepEqual(r.corps.marqueursNonResolus, [], "aucun marqueur actuel ne reste par erreur");
  assert.deepEqual(r.corps.marqueursInconnus, [], "aucun marqueur inconnu");
});

// DOC-3D : si le rendu est volontairement ignoré pour date_convocation, la
// balise reste réellement visible et est détectée comme résiduelle.
test("DOC-3D : remplacement de {{date_convocation}} ignoré → balise détectée comme résiduelle", async () => {
  baseSimulee().installer();
  const { client } = clientDriveSimule({
    modeleTexte: "{{intitule_formation}} {{date_convocation}}",
    remplacementIgnorer: ["{{date_convocation}}"],
  });
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 200);
  assert.ok(r.corps.marqueursNonResolus.includes("date_convocation"), "la balise ignorée reste et est signalée");
});

test("DOC-3D non-régression : le modèle d'Attestation actuel génère sans modification, aucun marqueur actuel ne reste", async () => {
  baseSimulee().installer();
  const modeleAttestation = "{{intitule_formation}} {{civilite}} {{prenom_stagiaire}} {{nom_stagiaire}} {{date_debut}} {{date_fin}} {{duree}} {{date_attestation}}";
  const { client } = clientDriveSimule({ modeleTexte: modeleAttestation });
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps.marqueursNonResolus, []);
  assert.deepEqual(r.corps.marqueursInconnus, []);
});

// DOC-3D : une canonique supportée mais absente est autorisée, remplacée par
// vide, et ne reste pas sous forme {{variable}} dans le document final.
test("DOC-3D : canonique absente → génération autorisée, balise remplacée par vide, aucun résidu", async () => {
  baseSimulee().installer();
  const { client } = clientDriveSimule({ modeleTexte: "{{stagiaire_email}}" });
  setDriveFactory(() => client);
  const r = await generer(requete);
  assert.equal(r.statut, 200);
  assert.deepEqual(r.corps.marqueursNonResolus, [], "la balise absente ne reste pas dans le document final");
});

// DOC-3B : les enrichissements SQL (formation/version, comptage de
// session, dernière relance) doivent rester des requêtes UNIQUES, jamais
// une par stagiaire. Compare le nombre de lectures (hors BEGIN/COMMIT/
// ROLLBACK/INSERT, propres à chaque document produit) pour 1 puis 3
// stagiaires : il doit être STRICTEMENT identique.
test("DOC-3B : aucun N+1 SQL — le nombre de LECTURES ne dépend pas du nombre de stagiaires", async () => {
  const lectures = (appels) => appels.filter((a) =>
    a.sql.startsWith("SELECT") && !a.sql.startsWith("SELECT id, email, nom, role")).length;

  const b1 = baseSimulee({ nbStagiaires: 1 }).installer();
  setDriveFactory(() => clientDriveSimule().client);
  const r1 = await generer(requete);
  assert.equal(r1.statut, 200);
  assert.equal(r1.corps.documents, 1);
  const n1 = lectures(b1.appels);

  const b3 = baseSimulee({ nbStagiaires: 3 }).installer();
  setDriveFactory(() => clientDriveSimule().client);
  const r3 = await generer(requete);
  assert.equal(r3.statut, 200);
  assert.equal(r3.corps.documents, 3);
  const n3 = lectures(b3.appels);

  assert.equal(n3, n1, `${n3} lectures pour 3 stagiaires contre ${n1} pour 1 : une requête par stagiaire s'est glissée quelque part`);
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
