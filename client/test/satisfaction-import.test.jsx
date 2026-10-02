// Q3-1 — Satisfaction : import des réponses Google Forms (aperçu, colonnes,
// anonymat par défaut, rapprochement par e-mail sur option, confirmation),
// publics prescripteur / partenaire, note sur 5. API simulée, données fictives.
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

const CSV = "Horodateur,Adresse e-mail,Note globale,Commentaires\n\"01/10/2026 18:12:05\",alice@exemple.fr,5,Très bien\n";
const APERCU = (sur = {}) => ({
  enTetes: ["Horodateur", "Adresse e-mail", "Note globale", "Commentaires"], horodateur: true, rapprochement: false,
  colonneEmailPresente: true, colonnesEcartees: ["Adresse e-mail"], colonne_horodateur: 0, colonne_note: 2, colonne_commentaire: 3,
  resume: { importables: 1, invalides: 1, aVerifier: 0, doublons: 0 },
  lignes: [
    { index: 0, statut: "pret", motif: null, stagiaire: null, date: "2026-10-01", note: 5, commentaire: "Très bien" },
    { index: 1, statut: "invalide", motif: "note hors de l'échelle 0 à 5", stagiaire: null, date: "2026-10-01", note: null, commentaire: null },
  ],
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
async function ouvrirImport(role = "admin", sur = {}) {
  const appels = await monter("/sessions/1/satisfaction", role, sur);
  await attendre(() => bouton("Importer des réponses Google Forms"));
  await cliquer(bouton("Importer des réponses Google Forms"));
  await attendre(() => dialogue()?.textContent.includes("Importer des réponses Google Forms"));
  return appels;
}

test("import : anonyme par défaut, public choisi, aperçu sans écriture, colonnes d'identité signalées", async () => {
  const appels = await ouvrirImport("contributeur", { "POST /api/sessions/1/satisfactions/import-apercu": () => APERCU() });
  assert.ok(dialogue().textContent.includes("Afficher dans Sheets"), "mode d'emploi Google Forms");
  assert.equal(champ("Rapprocher les réponses").checked, false, "anonyme par défaut");
  assert.ok(dialogue().textContent.includes("L'adresse e-mail n'est jamais conservée."));
  await saisir(champ("Public interrogé"), "prescripteur");
  await choisirFichier(dialogue().querySelector('input[type="file"]'), CSV);
  await attendre(() => dialogue().textContent.includes("Aperçu — rien n'a encore été enregistré."));
  assert.deepEqual(apercus(appels).at(-1).corps, { texte: CSV, type: "prescripteur", rapprocher_email: false });
  const t = dialogue().textContent;
  for (const x of ["1 à importer", "1 invalide(s)", "sauf les colonnes d'identité (Adresse e-mail)", "Anonyme", "5 / 5", "Très bien", "note hors de l'échelle 0 à 5"]) assert.ok(t.includes(x), x);
  assert.equal(champ("Note globale (sur 5)").value, "2", "question de note proposée");
  assert.ok(![...champ("Note globale (sur 5)").options].some((o) => o.textContent === "Adresse e-mail"), "colonne d'identité jamais proposée");
  assert.equal(imports(appels).length, 0);
  assert.equal(bouton("Importer 1 réponse(s)").disabled, false);
});

test("import : réglages relancés (question de note, rapprochement par e-mail), confirmation avec le même corps", async () => {
  const appels = await ouvrirImport("admin", {
    "POST /api/sessions/1/satisfactions/import-apercu": (c) => APERCU({ colonne_note: "colonne_note" in c ? c.colonne_note : 2, rapprochement: c.rapprocher_email === true,
      lignes: [{ index: 0, statut: "pret", motif: null, stagiaire: c.rapprocher_email ? { nom: "Martin", prenom: "Alice" } : null, date: "2026-10-01", note: null, commentaire: null }],
      resume: { importables: 1, invalides: 0, aVerifier: 0, doublons: 0 } }),
    "POST /api/sessions/1/satisfactions/import": () => ({ bilan: { importees: 1, anonymes: 0, nominatives: 1, ignorees: [] } }),
  });
  await choisirFichier(dialogue().querySelector('input[type="file"]'), CSV);
  await attendre(() => champ("Note globale (sur 5)"));
  await saisir(champ("Note globale (sur 5)"), "");
  await attendre(() => apercus(appels).length === 2);
  assert.equal(apercus(appels)[1].corps.colonne_note, null, "« Aucune » question de note");
  await cliquer(champ("Rapprocher les réponses"));
  await attendre(() => apercus(appels).length === 3 && dialogue().textContent.includes("Martin Alice"));
  assert.equal(apercus(appels)[2].corps.rapprocher_email, true);
  await cliquer(bouton("Importer 1 réponse(s)"));
  await attendre(() => !dialogue());
  assert.deepEqual(imports(appels)[0].corps, { texte: CSV, type: "a_chaud", rapprocher_email: true, colonne_note: null, colonne_commentaire: 3 });
  await attendre(() => texte().includes("1 réponse(s) importée(s) : 0 anonyme(s), 1 nominative(s)."));
});

test("import : erreur d'aperçu affichée ; rien à importer ⇒ bouton désactivé ; date du recueil sans horodateur", async () => {
  let n = 0;
  const appels = await ouvrirImport("admin", {
    "POST /api/sessions/1/satisfactions/import-apercu": (c) => (n++ === 0
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

test("import : double clic ⇒ un seul import ; erreur serveur ⇒ panneau ouvert", async () => {
  const v = vanne();
  const appels = await ouvrirImport("admin", {
    "POST /api/sessions/1/satisfactions/import-apercu": () => APERCU(),
    "POST /api/sessions/1/satisfactions/import": async () => { await v.attendre(); return [409, { error: "Cette session est archivée : elle est en lecture seule." }]; },
  });
  await choisirFichier(dialogue().querySelector('input[type="file"]'), CSV);
  await attendre(() => bouton("Importer 1 réponse(s)"));
  const b = bouton("Importer 1 réponse(s)");
  await cliquer(b); await cliquer(b);
  v.ouvrir();
  await attendre(() => dialogue()?.textContent.includes("Cette session est archivée"));
  assert.equal(imports(appels).length, 1);
});

test("saisie manuelle : publics prescripteur et partenaire, note « sur 5 » sans champ d'échelle, corps sans note_max", async () => {
  const appels = await monter("/sessions/1/satisfaction", "admin", { "POST /api/sessions/1/satisfactions": (c) => [201, { satisfaction: { id: 41, ...c } }] });
  await attendre(() => bouton("Ajouter un recueil"));
  await cliquer(bouton("Ajouter un recueil"));
  await attendre(() => champ("Public interrogé"));
  const libelles = [...champ("Public interrogé").options].map((o) => o.textContent);
  assert.ok(libelles.includes("Prescripteur") && libelles.includes("Partenaire"));
  assert.ok(champ("Note (sur 5)"), "note sur 5");
  assert.equal(champ("Note maximale"), null, "plus de champ d'échelle");
  await saisir(champ("Public interrogé"), "partenaire");
  await saisir(champ("Date du recueil"), "2026-10-01");
  await saisir(champ("Note (sur 5)"), "6");
  await cliquer(document.querySelector('button[type="submit"][form="form-satisfaction"]'));
  await attendre(() => dialogue().textContent.includes("Note entre 0 et 5."));
  await saisir(champ("Note (sur 5)"), "4");
  await cliquer(document.querySelector('button[type="submit"][form="form-satisfaction"]'));
  await attendre(() => appels.some((a) => a.methode === "POST" && a.chemin === "/api/sessions/1/satisfactions"));
  const corps = appels.find((a) => a.methode === "POST" && a.chemin === "/api/sessions/1/satisfactions").corps;
  assert.equal(corps.type, "partenaire"); assert.equal(corps.note_globale, 4);
  assert.ok(!("note_max" in corps), "l'échelle n'est plus envoyée");
});

test("réponse historique sur 10 : échelle d'origine affichée et conservée (PATCH sans note_max)", async () => {
  const appels = await monter("/sessions/1/satisfaction", "admin", {
    "GET /api/sessions/1/satisfactions": { agregation: { reponses: 1, anonymes: 1, nominatives: 0, moyenne: 8, echelleHomogene: 10 },
      satisfactions: [{ id: 40, type: "a_chaud", date_recueil: "2026-09-15", note_globale: "8.00", note_max: "10.00", commentaires: "Bien" }] },
    "PATCH /api/satisfactions/40": (c) => ({ satisfaction: { id: 40, ...c } }),
  });
  await attendre(() => bouton("Modifier"));
  assert.ok(document.querySelector("tbody").textContent.includes("8 / 10"), "notes affichées sans décimales inutiles (« 8 / 10 », pas « 8.00 / 10.00 »)");
  await cliquer(bouton("Modifier"));
  await attendre(() => champ("Note (sur 10)"));
  assert.ok(dialogue().textContent.includes("Réponse historique : son échelle d'origine est conservée."));
  await saisir(champ("Note (sur 10)"), "9");
  await cliquer(document.querySelector('button[type="submit"][form="form-satisfaction"]'));
  await attendre(() => appels.some((a) => a.methode === "PATCH"));
  const corps = appels.find((a) => a.methode === "PATCH").corps;
  assert.equal(corps.note_globale, 9);
  assert.ok(!("note_max" in corps));
});

test("session archivée : pas d'import ni d'ajout ; contributeur : import disponible", async () => {
  await monter("/sessions/1/satisfaction", "contributeur");
  await attendre(() => bouton("Importer des réponses Google Forms"));
  await demonter();
  const SESSION_ARCHIVEE = { id: 1, reference: "SESS-TEST", archivee_le: "2026-12-20T00:00:00Z", date_debut: "2026-09-01", date_fin: "2026-12-15", formation: "Formation test" };
  await monter("/sessions/1/satisfaction", "admin", { "GET /api/sessions/1": { session: SESSION_ARCHIVEE, groupes: [], stagiaires: [], documents: [] } });
  await attendre(() => texte().includes("Satisfaction"));
  assert.ok(!bouton("Importer des réponses Google Forms") && !bouton("Ajouter un recueil"));
});
