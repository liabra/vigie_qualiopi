// ─────────────────────────────────────────────────────────────
//  DOC-2 — Diagnostic d'un modèle (service pur, clients Google simulés).
//  Lecture seule : aucune écriture Drive, aucun contenu de document dans
//  la réponse — seulement des balises, des codes et des messages.
// ─────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ONGLETS, analyserModeleDrive } from "../src/services/diagnosticModele.js";
import { MAX_COLONNES, MAX_LIGNES } from "../src/services/classeur.js";

const DOC = "application/vnd.google-apps.document";
const SHEET = "application/vnd.google-apps.spreadsheet";
const MODELE = { id: 1, nom: "Convocation", drive_file_id: "FICHIER" };

const docAvec = (corps) => ({
  body: { content: [{ paragraph: { elements: [{ textRun: { content: corps } }] } }] },
  headers: {}, footers: {},
});

// Fausses API : drive.files.get (mime), docs.documents.get, sheets.*.
function fauxClients({ mime = DOC, document = docAvec(""), onglets = null, erreurDrive = null } = {}) {
  const appels = { driveGet: 0, docsGet: 0, sheetsMeta: 0, sheetsValeurs: 0 };
  return {
    appels,
    drive: { files: { get: async () => {
      appels.driveGet++;
      if (erreurDrive) { const e = new Error(erreurDrive.message); e.response = { status: erreurDrive.status }; throw e; }
      return { data: { id: "FICHIER", mimeType: mime } };
    } } },
    docs: { documents: { get: async () => { appels.docsGet++; return { data: document }; } } },
    sheets: { spreadsheets: {
      get: async () => { appels.sheetsMeta++; return { data: { sheets: onglets.map((o, i) => ({ properties: { title: o.titre, index: i, gridProperties: o.grid || { rowCount: 10, columnCount: 10 } } })) } }; },
      values: { get: async ({ range }) => {
        appels.sheetsValeurs++;
        const titre = range.slice(1, -1);
        const o = onglets.find((x) => x.titre === titre);
        return { data: { values: o?.grille || [] } };
      } },
    } },
  };
}

test("Google Doc canonique valide : état « valide », aucun avertissement", async () => {
  const r = await analyserModeleDrive(MODELE, fauxClients({ document: docAvec("{{formation_intitule}} {{session_date_debut}}") }));
  assert.equal(r.etat, "valide");
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.avertissements, []);
  assert.equal(r.type_fichier, "document");
  assert.equal(r.version_dictionnaire, "1.4");
  assert.equal(r.nombre_occurrences_balises, 2);
  assert.equal(r.nombre_balises_uniques, 2);
  assert.deepEqual(r.canoniques.sort(), ["formation_intitule", "session_date_debut"]);
});

test("Doc avec alias : valide_avec_avertissements, suggestion de migration", async () => {
  const r = await analyserModeleDrive(MODELE, fauxClients({ document: docAvec("{{nom_stagiaire}} {{civilite}}") }));
  assert.equal(r.etat, "valide_avec_avertissements");
  assert.deepEqual(r.alias.map((a) => a.alias).sort(), ["civilite", "nom_stagiaire"]);
  const sug = r.suggestions.find((s) => s.balise === "{{nom_stagiaire}}");
  assert.deepEqual(sug, { balise: "{{nom_stagiaire}}", type: "alias", cible_conseillee: "{{stagiaire_nom}}", cibles_alternatives: [] });
});

test("Doc avec marqueur historique : reconnu, suggestion vers la cible conseillée", async () => {
  const r = await analyserModeleDrive(MODELE, fauxClients({ document: docAvec("{{date_convocation}}") }));
  assert.equal(r.etat, "valide_avec_avertissements");
  assert.deepEqual(r.historiques, ["date_convocation"]);
  assert.deepEqual(r.suggestions, [{ balise: "{{date_convocation}}", type: "historique", cible_conseillee: "{{document_date_convocation}}", cibles_alternatives: [] }]);
});

test("Doc avec variable inconnue : état invalide", async () => {
  const r = await analyserModeleDrive(MODELE, fauxClients({ document: docAvec("{{stagiaire_prenom}} {{note_phase1}}") }));
  assert.equal(r.etat, "invalide");
  assert.deepEqual(r.inconnues, ["note_phase1"]);
  assert.equal(r.erreurs.length, 1);
  assert.equal(r.erreurs[0].code, "VARIABLE_INCONNUE");
});

test("Doc avec syntaxe invalide : état invalide, écho de la balise borné", async () => {
  const r = await analyserModeleDrive(MODELE, fauxClients({ document: docAvec("{{ stagiaire nom }}") }));
  assert.equal(r.etat, "invalide");
  assert.equal(r.erreurs[0].code, "SYNTAXE_INVALIDE");
});

test("modèle sans balise : valide_avec_avertissements, avertissement dédié", async () => {
  const r = await analyserModeleDrive(MODELE, fauxClients({ document: docAvec("Document entièrement statique, aucun champ de fusion.") }));
  assert.equal(r.etat, "valide_avec_avertissements");
  assert.equal(r.nombre_occurrences_balises, 0);
  assert.equal(r.nombre_balises_uniques, 0);
  assert.deepEqual(r.avertissements, [{ code: "AUCUNE_BALISE", message: "Aucune balise documentaire détectée dans ce modèle.", balise: null, position: null }]);
});

test("bloc répétable et champ local valides : comptés une fois dans « blocs », occurrences correctes", async () => {
  const corps = "{{#phases}}Phase {{phase_numero}}{{#objectifs_phase}}{{objectif_code}} {{critere_reussite}}{{/objectifs_phase}}{{/phases}}"
    + "{{#phases}}Phase {{phase_numero}} bis{{/phases}}"; // deux occurrences du même bloc
  const r = await analyserModeleDrive(MODELE, fauxClients({ document: docAvec(corps) }));
  assert.equal(r.etat, "valide");
  assert.deepEqual(r.blocs, ["phases", "objectifs_phase"], "un bloc répété n'apparaît qu'une fois");
  // DOC-6B : phase_numero (REF) placé dans son bloc compte aussi comme champ de bloc.
  assert.deepEqual(r.champs_bloc, ["phase_numero", "objectif_code", "critere_reussite"]);
  // phase_numero × 2, objectif_code × 1, critere_reussite × 1,
  // {{#phases}}×2 {{/phases}}×2 {{#objectifs_phase}}×1 {{/objectifs_phase}}×1 = 10
  assert.equal(r.nombre_occurrences_balises, 10);
  assert.equal(r.nombre_balises_uniques, 5); // phases, phase_numero, objectifs_phase, objectif_code, critere_reussite
});

test("Google Sheet, un onglet : analysé intégralement", async () => {
  const onglets = [{ titre: "Feuille 1", grille: [["{{session_reference}}", "{{session_statut_code}}"]] }];
  const r = await analyserModeleDrive(MODELE, fauxClients({ mime: SHEET, onglets }));
  assert.equal(r.etat, "valide");
  assert.equal(r.type_fichier, "feuille_calcul");
  assert.equal(r.onglets_total, 1);
  assert.equal(r.onglets_analyses, 1);
  assert.deepEqual(r.canoniques.sort(), ["session_reference", "session_statut_code"]);
  assert.ok(!r.avertissements.some((a) => a.code === "ANALYSE_PARTIELLE"));
});

test("Google Sheet à plus de 20 onglets : analyse partielle, avertissement et compteurs", async () => {
  const onglets = Array.from({ length: 25 }, (_, i) => ({ titre: `Onglet ${i}`, grille: i === 0 ? [["{{formation_intitule}}"]] : [] }));
  const clients = fauxClients({ mime: SHEET, onglets });
  const r = await analyserModeleDrive(MODELE, clients);
  assert.equal(r.etat, "valide_avec_avertissements");
  assert.equal(r.onglets_total, 25);
  assert.equal(r.onglets_analyses, MAX_ONGLETS);
  assert.equal(clients.appels.sheetsValeurs, MAX_ONGLETS, "pas un appel par onglet au-delà de la limite");
  const av = r.avertissements.find((a) => a.code === "ANALYSE_PARTIELLE");
  assert.ok(av);
  assert.match(av.message, /20 premiers onglets sur 25/);
});

test("onglet trop volumineux : refusé avant toute lecture des cellules", async () => {
  const onglets = [{ titre: "Immense", grid: { rowCount: MAX_LIGNES + 1, columnCount: 5 } }];
  const clients = fauxClients({ mime: SHEET, onglets });
  await assert.rejects(analyserModeleDrive(MODELE, clients), (e) => {
    assert.equal(e.statut, 400);
    assert.equal(e.code, "classeur_trop_volumineux");
    return true;
  });
  assert.equal(clients.appels.sheetsValeurs, 0, "aucune lecture de cellules pour un onglet hors limite");
});

test("mime non pris en charge : erreur explicite format_non_supporte, aucune tentative d'analyse", async () => {
  const clients = fauxClients({ mime: "application/pdf" });
  await assert.rejects(analyserModeleDrive(MODELE, clients), (e) => {
    assert.equal(e.statut, 400);
    assert.equal(e.code, "format_non_supporte");
    return true;
  });
});

test("erreur d'accès Drive (fichier introuvable) : propagée, pas masquée en diagnostic silencieux", async () => {
  const clients = fauxClients({ erreurDrive: { status: 404, message: "File not found" } });
  await assert.rejects(analyserModeleDrive(MODELE, clients));
});

test("confidentialité : une balise invalide porteuse d'une donnée sensible fictive n'apparaît nulle part dans le diagnostic", async () => {
  const SECRET = "SECRET_CONFIDENTIEL_123";
  const r = await analyserModeleDrive(MODELE, fauxClients({ document: docAvec(`{{nom invalide ${SECRET}}} {{formation_intitule}}`) }));
  assert.equal(r.etat, "invalide");
  const serialise = JSON.stringify(r);
  assert.ok(!serialise.includes(SECRET), "le secret ne doit apparaître nulle part dans le diagnostic");
  assert.ok(!serialise.includes("nom invalide"));
  assert.ok(r.erreurs.some((e) => e.code === "SYNTAXE_INVALIDE" && e.balise === "{{…}}"));
  // Le reste du diagnostic continue de fonctionner normalement.
  assert.deepEqual(r.canoniques, ["formation_intitule"]);
});

test("confidentialité : aucun contenu du document — seulement les balises — n'apparaît dans la réponse", async () => {
  const SECRET = "Numero-de-dossier-confidentiel-XJ42";
  const corps = `Texte libre contenant ${SECRET} et {{formation_intitule}} et {{nom_stagiaire}}.`;
  const r = await analyserModeleDrive(MODELE, fauxClients({ document: docAvec(corps) }));
  const serialise = JSON.stringify(r);
  assert.ok(!serialise.includes(SECRET), "le texte libre du document ne doit jamais apparaître dans le diagnostic");
  assert.ok(!serialise.includes("Texte libre contenant"));
  assert.ok(serialise.includes("formation_intitule"));
});

test("confidentialité (Sheet) : le contenu des cellules n'apparaît jamais, seules les balises ressortent", async () => {
  const SECRET = "Commentaire-cellule-fictif-confidentiel";
  const onglets = [{ titre: "Feuille 1", grille: [[SECRET, "{{session_reference}}"]] }];
  const r = await analyserModeleDrive(MODELE, fauxClients({ mime: SHEET, onglets }));
  const serialise = JSON.stringify(r);
  assert.ok(!serialise.includes(SECRET));
  assert.ok(serialise.includes("session_reference"));
});
