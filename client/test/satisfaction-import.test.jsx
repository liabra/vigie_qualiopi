// Q3-1 — Satisfaction : import des réponses Google Forms (admin : aperçu,
// colonnes, questionnaire anonyme ou nominatif, échelle conservée,
// confirmation), publics prescripteur / partenaire, restitution REGROUPÉE au
// contributeur (seuil de 5). API simulée, données fictives.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { attendre, bouton, cliquer, demonter, dialogue, monter, saisir, texte } from "./outils.jsx";

const vanne = () => { let ouvrir; const p = new Promise((r) => { ouvrir = r; }); return { attendre: () => p, ouvrir }; };

let natifs = 0;
beforeEach(() => {
  natifs = 0;
  window.alert = () => { natifs++; };
  window.confirm = () => { natifs++; return true; };
});
afterEach(async () => {
  assert.equal(natifs, 0, "aucun window.alert / window.confirm");
  await demonter();
});

const IMPORTER = "Importer des réponses (CSV Google Forms)";
const CSV = "Horodateur,Adresse e-mail,Note globale,Commentaires\n\"01/10/2026 18:12:05\",alice@exemple.fr,5,Très bien\n";
const APERCU = (sur = {}) => ({
  enTetes: ["Horodateur", "Adresse e-mail", "Note globale", "Commentaires"], horodateur: true, rapprochement: false,
  colonneEmailPresente: true, colonnesEcartees: ["Adresse e-mail"], colonne_horodateur: 0, colonne_note: 2, colonne_commentaire: 3, note_max: 5,
  resume: { importables: 1, invalides: 1, aVerifier: 0, doublons: 0 },
  lignes: [
    { index: 0, statut: "pret", motif: null, stagiaire: null, date: "2026-10-01", note: 5, commentaire: "Très bien" },
    { index: 1, statut: "invalide", motif: "note hors de l'échelle 0 à 5", stagiaire: null, date: "2026-10-01", note: null, commentaire: null },
  ],
  ...sur,
});
const REGROUPE = (sur = {}) => ({
  restreint: true, seuil: 5,
  agregation: { reponses: 9, insuffisant: false, moyenne: 4.2, echelleHomogene: 5 },
  groupes: [{ type: "a_chaud", insuffisant: true }, { type: "prescripteur", insuffisant: false, reponses: 6, moyenne: 3.5, echelle: 5 }],
  ...sur,
});
const champ = (libelle) => {
  const racine = dialogue() || document;
  const l = [...racine.querySelectorAll("label")].find((x) => x.textContent.replace(/\s*\(facultatif\)/, "").trim().startsWith(libelle));
  return l ? (document.getElementById(l.htmlFor) || l.querySelector("input")) : null;
};
async function choisirFichier(input, contenu, nom = "reponses.csv") {
  Object.defineProperty(input, "files", { value: [{ name: nom, text: async () => contenu }], configurable: true });
  await act(async () => { input.dispatchEvent(new window.Event("change", { bubbles: true })); });
}
const apercus = (appels) => appels.filter((a) => a.chemin === "/api/sessions/1/satisfactions/import-apercu");
const imports = (appels) => appels.filter((a) => a.chemin === "/api/sessions/1/satisfactions/import");
async function ouvrirImport(sur = {}) {
  const appels = await monter("/sessions/1/satisfaction", "admin", sur);
  await attendre(() => bouton(IMPORTER));
  await cliquer(bouton(IMPORTER));
  await attendre(() => dialogue()?.textContent.includes("Afficher dans Sheets"));
  return appels;
}

test("import (admin) : questionnaire anonyme par défaut, public et échelle, aperçu sans écriture, colonnes d'identité signalées", async () => {
  const appels = await ouvrirImport({ "POST /api/sessions/1/satisfactions/import-apercu": () => APERCU() });
  assert.equal(champ("Anonyme (recommandé)").checked, true, "anonyme par défaut");
  assert.equal(champ("Nominatif").checked, false);
  assert.ok(dialogue().textContent.includes("Un commentaire peut permettre de reconnaître son auteur"), "prudence sur les commentaires libres");
  assert.equal(champ("Échelle de la note").value, "5");
  await saisir(champ("Public interrogé"), "prescripteur");
  await choisirFichier(dialogue().querySelector('input[type="file"]'), CSV);
  await attendre(() => dialogue().textContent.includes("Aperçu — rien n'a encore été enregistré."));
  assert.deepEqual(apercus(appels).at(-1).corps, { texte: CSV, type: "prescripteur", rapprocher_email: false, note_max: 5 });
  const t = dialogue().textContent;
  for (const x of ["1 à importer", "1 invalide(s)", "sauf les colonnes d'identité (Adresse e-mail)", "Anonyme", "5 / 5", "note hors de l'échelle 0 à 5"]) assert.ok(t.includes(x), x);
  assert.equal(champ("Note globale (sur 5)").value, "2", "question de note proposée");
  assert.ok(![...champ("Note globale (sur 5)").options].some((o) => o.textContent === "Adresse e-mail"), "colonne d'identité jamais proposée");
  assert.equal(imports(appels).length, 0);
});

test("import (admin) : échelle sur 10, question de note, questionnaire nominatif, confirmation avec le même corps", async () => {
  const appels = await ouvrirImport({
    "POST /api/sessions/1/satisfactions/import-apercu": (c) => APERCU({ colonne_note: "colonne_note" in c ? c.colonne_note : 2, note_max: c.note_max, rapprochement: c.rapprocher_email === true,
      lignes: [{ index: 0, statut: "pret", motif: null, stagiaire: c.rapprocher_email ? { nom: "Martin", prenom: "Alice" } : null, date: "2026-10-01", note: 8, commentaire: null }],
      resume: { importables: 1, invalides: 0, aVerifier: 0, doublons: 0 } }),
    "POST /api/sessions/1/satisfactions/import": () => ({ bilan: { importees: 1, anonymes: 0, nominatives: 1, ignorees: [] } }),
  });
  await choisirFichier(dialogue().querySelector('input[type="file"]'), CSV);
  await attendre(() => champ("Note globale"));
  await saisir(champ("Échelle de la note"), "10");
  await attendre(() => apercus(appels).at(-1).corps.note_max === 10 && champ("Note globale (sur 10)"));
  assert.ok(dialogue().textContent.includes("8 / 10"), "échelle du formulaire conservée");
  await cliquer(champ("Nominatif"));
  await attendre(() => apercus(appels).at(-1).corps.rapprocher_email === true && dialogue().textContent.includes("Martin Alice"));
  await cliquer(bouton("Importer 1 réponse(s)"));
  await attendre(() => !dialogue());
  assert.deepEqual(imports(appels)[0].corps, { texte: CSV, type: "a_chaud", rapprocher_email: true, note_max: 10, colonne_note: 2, colonne_commentaire: 3 });
  await attendre(() => texte().includes("1 réponse(s) importée(s) : 0 anonyme(s), 1 nominative(s)."));
});

test("import : erreur de colonnes affichée ; rien à importer ⇒ bouton désactivé ; date du recueil sans horodateur", async () => {
  let n = 0;
  const appels = await ouvrirImport({
    "POST /api/sessions/1/satisfactions/import-apercu": () => (n++ === 0
      ? [400, { error: "Le fichier n'a pas d'horodateur : indiquez la date du recueil." }]
      : APERCU({ horodateur: false, colonne_horodateur: null, resume: { importables: 0, invalides: 1, aVerifier: 0, doublons: 0 }, lignes: [] })),
  });
  await choisirFichier(dialogue().querySelector('input[type="file"]'), "Note\n4\n");
  await attendre(() => dialogue().textContent.includes("Le fichier n'a pas d'horodateur"));
  await saisir(champ("Public interrogé"), "partenaire");
  await attendre(() => champ("Date du recueil"));
  assert.ok(dialogue().textContent.includes("un nouvel import du même fichier créerait des doublons"));
  await saisir(champ("Date du recueil"), "2026-09-30");
  await attendre(() => apercus(appels).at(-1).corps.date_defaut === "2026-09-30");
  assert.equal(bouton("Importer 0 réponse(s)").disabled, true);
  assert.equal(imports(appels).length, 0);
});

test("import : doublons signalés ; double clic ⇒ un seul import ; erreur serveur ⇒ panneau ouvert", async () => {
  const v = vanne();
  const appels = await ouvrirImport({
    "POST /api/sessions/1/satisfactions/import-apercu": () => APERCU({ resume: { importables: 1, invalides: 0, aVerifier: 0, doublons: 1 },
      lignes: [{ index: 0, statut: "doublon", motif: "réponse déjà importée", stagiaire: null, date: "2026-10-01", note: 4, commentaire: null },
        { index: 1, statut: "pret", motif: null, stagiaire: null, date: "2026-10-01", note: 5, commentaire: null }] }),
    "POST /api/sessions/1/satisfactions/import": async () => { await v.attendre(); return [409, { error: "Cette session est archivée : elle est en lecture seule." }]; },
  });
  await choisirFichier(dialogue().querySelector('input[type="file"]'), CSV);
  await attendre(() => bouton("Importer 1 réponse(s)"));
  assert.ok(dialogue().textContent.includes("1 déjà importée(s)") && dialogue().textContent.includes("réponse déjà importée"));
  const b = bouton("Importer 1 réponse(s)");
  await cliquer(b); await cliquer(b);
  v.ouvrir();
  await attendre(() => dialogue()?.textContent.includes("Cette session est archivée"));
  assert.equal(imports(appels).length, 1);
});

test("saisie manuelle (admin) : nouveaux publics, échelle conservée (champ « Note maximale »), anciens publics toujours proposés", async () => {
  const appels = await monter("/sessions/1/satisfaction", "admin", { "POST /api/sessions/1/satisfactions": (c) => [201, { satisfaction: { id: 41, ...c } }] });
  await attendre(() => bouton("Ajouter un recueil"));
  assert.ok(texte().includes("Le contributeur ne voit que des résultats regroupés."), "explication de la confidentialité");
  await cliquer(bouton("Ajouter un recueil"));
  await attendre(() => champ("Public interrogé"));
  const libelles = [...champ("Public interrogé").options].map((o) => o.textContent);
  assert.deepEqual(libelles, ["À chaud", "À froid", "Financeur", "Entreprise", "Formateur", "Prescripteur", "Partenaire"]);
  assert.equal(champ("Note maximale").value, "5");
  await saisir(champ("Public interrogé"), "partenaire");
  await saisir(champ("Date du recueil"), "2026-10-01");
  await saisir(champ("Note maximale"), "10");
  await saisir(champ("Note"), "8");
  await cliquer(document.querySelector('button[type="submit"][form="form-satisfaction"]'));
  await attendre(() => appels.some((a) => a.methode === "POST" && a.chemin === "/api/sessions/1/satisfactions"));
  const corps = appels.find((a) => a.methode === "POST" && a.chemin === "/api/sessions/1/satisfactions").corps;
  assert.deepEqual([corps.type, corps.note_globale, corps.note_max], ["partenaire", 8, 10]);
});

test("contributeur : résultats regroupés seulement, groupe < 5 masqué, aucun nom, commentaire, fichier ni import", async () => {
  const appels = await monter("/sessions/1/satisfaction", "contributeur", { "GET /api/sessions/1/satisfactions": REGROUPE() });
  await attendre(() => texte().includes("Résultats regroupés par public."));
  const t = texte();
  assert.ok(t.includes("Prescripteur") && t.includes("3.5 / 5") && t.includes("6"));
  assert.ok(t.includes("Résultats insuffisants pour une restitution regroupée"), "groupe « À chaud » de moins de 5 réponses");
  assert.ok(t.includes("ne garantit pas à elle seule l'anonymat"));
  for (const x of ["Anonyme", "Commentaire", "Répondant", "Pièce"]) assert.ok(!t.includes(x), x);
  assert.ok(!bouton(IMPORTER), "import réservé à l'admin");
  assert.ok(bouton("Ajouter un recueil"), "saisie manuelle conservée");
  assert.ok(!appels.some((a) => a.chemin.includes("import")));
});

test("contributeur : session de 1 à 4 réponses ⇒ message seul, onglet sans compteur ; vue d'ensemble cohérente", async () => {
  const peu = REGROUPE({ agregation: { reponses: null, insuffisant: true, moyenne: null, echelleHomogene: null }, groupes: [{ type: "a_chaud", insuffisant: true }] });
  await monter("/sessions/1/satisfaction", "contributeur", { "GET /api/sessions/1/satisfactions": peu });
  await attendre(() => texte().includes("Résultats insuffisants pour une restitution regroupée."));
  assert.ok(!document.querySelector("table"), "aucun tableau");
  const onglet = [...document.querySelectorAll('nav[aria-label="Sections de la session"] a')].find((a) => a.textContent.startsWith("Satisfaction"));
  assert.equal(onglet.querySelector(".ui-onglets__compteur"), null, "aucun compteur révélé");
  await demonter();
  await monter("/sessions/1", "contributeur", { "GET /api/sessions/1/satisfactions": peu });
  await attendre(() => texte().includes("Résultats insuffisants pour une restitution regroupée."));
});

test("session archivée : ni import ni ajout", async () => {
  const SESSION_ARCHIVEE = { id: 1, reference: "SESS-TEST", archivee_le: "2026-12-20T00:00:00Z", date_debut: "2026-09-01", date_fin: "2026-12-15", formation: "Formation test" };
  await monter("/sessions/1/satisfaction", "admin", { "GET /api/sessions/1": { session: SESSION_ARCHIVEE, groupes: [], stagiaires: [], documents: [] } });
  await attendre(() => texte().includes("Satisfaction"));
  assert.ok(!bouton(IMPORTER) && !bouton("Ajouter un recueil"));
});
