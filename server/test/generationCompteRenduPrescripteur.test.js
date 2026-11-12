// DOC-10C — Pilote de la chaîne d'intégration des modèles : « Compte rendu
// d'entretien prescripteur / entreprise » (Drive
// 1sjn4Rfvut5Bnjp7XynCfnws4u41mG-PNt8FDpX0VXQ8), lu RÉELLEMENT via le
// connecteur Google Drive (lecture seule) le 2026-10-15.
//
// Ce modèle ne contient AUCUN tableau de données ni bloc répétable : son
// unique tableau est une mise en page statique (encadré), jamais une ligne
// à dupliquer. Les 4 marqueurs canoniques qu'il porte sont déjà résolus par
// le moteur existant (resolversCanoniques.js) — aucun nouveau résolveur,
// aucune adaptation de blocsTableaux.js n'est nécessaire. Portée "session" :
// un seul document est produit par session (cibles() ne boucle pas par
// stagiaire), réutilisable pour plusieurs entretiens prescripteur — les
// champs manuels (identité/coordonnées du prescripteur, date d'entretien,
// synthèse administrative) n'ont pas de balise et restent donc intacts.
//
// Ce test rejoue le TEXTE RÉEL du modèle (extrait du Drive, pas inventé)
// à travers le moteur via un client Google simulé (comme generationAssiduite
// .test.js) : aucune écriture Drive réelle n'est faite ici, ce n'est pas
// une validation en production.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { setPoolFactory } from "../src/db.js";
import { genererDocuments } from "../src/services/documents.js";
import { DRIVE_FILE } from "../src/services/google.js";
import { repondreDocuments } from "./helpers/documentsMock.js";

const DOC = "application/vnd.google-apps.document";
const sqlNormalise = (text) => String(text).replace(/\s+/g, " ").trim();

let compteur = 0;
function paragraphe(texte) {
  const contenu = texte.endsWith("\n") ? texte : texte + "\n";
  const debut = compteur;
  compteur += contenu.length;
  return {
    startIndex: debut, endIndex: compteur,
    paragraph: { elements: [{ startIndex: debut, endIndex: compteur, textRun: { content: contenu } }] },
  };
}

// Reproduction FIDÈLE (texte réel, mise en forme omise car non pertinente
// ici) des paragraphes du modèle Drive réel portant les 4 marqueurs et les
// champs manuels — pas de contenu inventé.
function corpsModeleReel() {
  compteur = 1;
  return [
    paragraphe("Compte rendu d'entretien avec le prescripteur / l'entreprise"),
    paragraphe("Orientation vers {{formation_intitule}}"),
    paragraphe("Nom de la personne avec qui a eu lieu l'entretien :"),
    paragraphe("Date de l'entretien :"),
    paragraphe("Durée de la formation : {{formation_duree_heures}} h"),
    paragraphe("Dates : du {{session_date_debut}} au {{session_date_fin}}"),
    paragraphe("SYNTHÈSE ADMINISTRATIVE"),
    paragraphe("Nom et fonction de l'interlocuteur – date de l'entretien"),
  ];
}

// DOC-10D : `generes` persiste les lignes `documents_generes` ENTRE deux
// appels de `genererDocuments` dans un même test (comme la vraie table) —
// nécessaire pour vérifier qu'un libellé différent n'écrase jamais un
// document précédent, et qu'un même libellé continue, lui, à le remplacer.
function baseSimulee({ generationMultiple = false } = {}) {
  const session = {
    id: 1, reference: "SESS-CR1", date_debut: "2026-01-05", date_fin: "2026-03-05",
    lieu: "Cayenne", formateur: "Mme Carr", horaire: "8h30–12h00",
    duree_heures_reelle: null, formation_id: 1, intitule: "Aide à domicile",
    duree_heures_defaut: 400, statut: "planifiee",
  };
  const generes = [];
  const executer = async (text, params = []) => {
    const sql = sqlNormalise(text);
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
    if (sql.startsWith("SELECT * FROM modeles_documents WHERE id = $1 AND actif")) {
      return { rows: [{ id: 2, nom: "Compte rendu prescripteur", drive_file_id: "CR1", drive_mime: DOC, portee: "session", generation_multiple: generationMultiple }] };
    }
    if (sql.startsWith("SELECT indicateur_id FROM modele_indicateurs")) return { rows: [] };
    if (sql.startsWith("SELECT s.*, f.id AS formation_id")) return { rows: [{ ...session }] };
    if (sql.startsWith("SELECT count(*) FILTER (WHERE statut <> 'abandon')")) return { rows: [{ inscrits: 4, termines: 0 }] };
    if (sql.startsWith("SELECT i.id, i.civilite, i.nom, i.prenom, i.email, i.fonction FROM intervenants_")) return { rows: [] };
    if (sql.startsWith("SELECT * FROM documents_generes")) {
      const [modeleId, sessionId, groupeId, libelle] = params;
      return { rows: generes.filter((g) =>
        g.modele_id === modeleId && (g.session_id ?? 0) === sessionId && (g.groupe_id ?? 0) === groupeId
        && (g.libelle ?? "") === (libelle ?? "")) };
    }
    if (sql.startsWith("INSERT INTO generations")) return { rows: [{ id: 50 }] };
    if (sql.startsWith("DELETE FROM preuve_fichiers")) return { rows: [] };
    if (sql.startsWith("INSERT INTO preuve_fichiers")) return { rows: [] };
    if (sql.startsWith("INSERT INTO documents_generes")) {
      const [modeleId, sessionId, groupeId, stagiaireId, generationId, driveFileId, driveUrl, nom, preuveId, libelle] = params;
      const i = generes.findIndex((g) =>
        g.modele_id === modeleId && (g.session_id ?? 0) === (sessionId ?? 0) && (g.groupe_id ?? 0) === (groupeId ?? 0)
        && (g.libelle ?? "") === (libelle ?? ""));
      const ligne = { modele_id: modeleId, session_id: sessionId, groupe_id: groupeId, stagiaire_id: stagiaireId, drive_file_id: driveFileId, nom, libelle };
      if (i === -1) generes.push(ligne); else generes[i] = ligne;
      return { rows: [] };
    }
    const documents = repondreDocuments(sql, params); if (documents) return documents;
    throw new Error("Requête inattendue pour la base simulée : " + sql);
  };
  const pool = { query: executer, connect: async () => ({ query: executer, release: () => {} }) };
  setPoolFactory(() => pool);
  return { generes };
}

function clientGoogleSimule() {
  const requetes = [];
  let n = 0;
  return {
    requetes,
    client: {
      row: { scopes: DRIVE_FILE, expiry: Date.now() + 60_000, access_token: "x" },
      drive: {
        files: {
          get: async () => ({ data: { id: "CR1", name: "Compte rendu prescripteur", mimeType: DOC, trashed: false } }),
          list: async () => ({ data: { files: [] } }),
          create: async () => ({ data: { id: "dossier-" + ++n } }),
          copy: async ({ requestBody }) => ({ data: { id: "copie-" + ++n, name: requestBody.name, webViewLink: "https://d/c", mimeType: DOC } }),
        },
      },
      docs: {
        documents: {
          get: async () => ({ data: { body: { content: corpsModeleReel() }, headers: {}, footers: {} } }),
          batchUpdate: async ({ requestBody }) => { requetes.push(...requestBody.requests); return { data: {} }; },
        },
      },
      sheets: { spreadsheets: { batchUpdate: async () => ({ data: {} }) } },
    },
  };
}

after(() => setPoolFactory(null));

test("DOC-10C : le compte rendu prescripteur produit UN SEUL document par session (pas par stagiaire)", async () => {
  baseSimulee();
  const { client } = clientGoogleSimule();
  const r = await genererDocuments({ modeleId: 2, sessionId: 1, utilisateurId: 1, client });
  assert.equal(r.documents, 1, "portée session : un document, pas un par stagiaire inscrit");
  assert.equal(r.marqueursInconnus.length, 0);
});

test("DOC-10C : les 4 marqueurs canoniques réels sont remplacés par les bonnes valeurs", async () => {
  baseSimulee();
  const { requetes, client } = clientGoogleSimule();
  await genererDocuments({ modeleId: 2, sessionId: 1, utilisateurId: 1, client });

  const valeurs = new Map();
  for (const req of requetes) {
    if (req.replaceAllText) valeurs.set(req.replaceAllText.containsText.text, req.replaceAllText.replaceText);
  }
  assert.equal(valeurs.get("{{formation_intitule}}"), "Aide à domicile");
  assert.equal(valeurs.get("{{formation_duree_heures}}"), "400");
  assert.equal(valeurs.get("{{session_date_debut}}"), "05/01/2026");
  assert.equal(valeurs.get("{{session_date_fin}}"), "05/03/2026");
});

test("DOC-10C : aucune balise n'est envoyée pour les champs manuels (jamais de valeur inventée)", async () => {
  baseSimulee();
  const { requetes, client } = clientGoogleSimule();
  await genererDocuments({ modeleId: 2, sessionId: 1, utilisateurId: 1, client });

  const cibles = requetes.filter((r) => r.replaceAllText).map((r) => r.replaceAllText.containsText.text);
  // Les champs manuels ("Nom de la personne…", "Date de l'entretien…",
  // "SYNTHÈSE ADMINISTRATIVE"…) ne portent aucune balise {{…}} dans le
  // modèle réel : aucune requête de remplacement ne doit les cibler.
  for (const c of cibles) assert.match(c, /^\{\{.*\}\}$/, "seules des balises {{…}} sont remplacées, jamais du texte libre");
});

// DOC-10D : une session peut donner lieu à plusieurs entretiens avec des
// prescripteurs différents — chacun doit pouvoir produire SON document,
// sans écraser les précédents ni exiger un remplacement explicite.
test("DOC-10D : un libellé différent crée un NOUVEAU document, sans toucher aux précédents", async () => {
  const { generes } = baseSimulee({ generationMultiple: true });
  const { client: c1 } = clientGoogleSimule();
  const r1 = await genererDocuments({ modeleId: 2, sessionId: 1, utilisateurId: 1, libelle: "Pôle Emploi", client: c1 });
  assert.equal(r1.documents, 1);
  assert.equal(r1.remplaces, 0, "premier entretien : rien à remplacer");

  const { client: c2 } = clientGoogleSimule();
  const r2 = await genererDocuments({ modeleId: 2, sessionId: 1, utilisateurId: 1, libelle: "Mission Locale", client: c2 });
  assert.equal(r2.documents, 1);
  assert.equal(r2.remplaces, 0, "deuxième entretien : nouveau document, pas un remplacement");

  assert.equal(generes.length, 2, "les deux documents coexistent, aucun n'a été écrasé");
  assert.deepEqual(generes.map((g) => g.libelle).sort(), ["Mission Locale", "Pôle Emploi"]);
});

test("DOC-10D : le MÊME libellé sans confirmation de remplacement est bloqué (409)", async () => {
  baseSimulee({ generationMultiple: true });
  const { client: c1 } = clientGoogleSimule();
  await genererDocuments({ modeleId: 2, sessionId: 1, utilisateurId: 1, libelle: "Pôle Emploi", client: c1 });

  const { client: c2 } = clientGoogleSimule();
  await assert.rejects(
    genererDocuments({ modeleId: 2, sessionId: 1, utilisateurId: 1, libelle: "Pôle Emploi", client: c2 }),
    (e) => { assert.equal(e.dejaGeneres, 1); return true; }
  );
});

test("DOC-10D : un modèle generation_multiple exige un libellé (jamais de champ inventé à sa place)", async () => {
  baseSimulee({ generationMultiple: true });
  const { client } = clientGoogleSimule();
  await assert.rejects(
    genererDocuments({ modeleId: 2, sessionId: 1, utilisateurId: 1, client }),
    /libellé/i
  );
});

test("DOC-10D : un modèle ordinaire (generation_multiple=false) refuse un libellé inattendu", async () => {
  baseSimulee({ generationMultiple: false });
  const { client } = clientGoogleSimule();
  await assert.rejects(
    genererDocuments({ modeleId: 2, sessionId: 1, utilisateurId: 1, libelle: "Pôle Emploi", client }),
    /un seul document/i
  );
});
