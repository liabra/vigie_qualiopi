// Q4-1 — Annuaire des intervenants (page, filtres, fiche, désactivation)
// et bloc « Intervenants » d'une session (rattachements, rapprochement
// manuel d'un formateur historique). API simulée, données fictives.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, dialogue, monter, saisir, texte } from "./outils.jsx";
import { corpsFiche, domainesDepuisTexte, filtrerIntervenants } from "../src/intervenants/format.js";

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

const I = (sur) => ({ civilite: null, email: null, domaines: [], formations: [], actif: true, nb_sessions: 0, ...sur });
const ANNUAIRE = [
  I({ id: 1, nom: "Abel", prenom: "Luc", fonction: "formateur", nature: "exterieur", domaines: ["Bureautique"], formations: [{ id: 7, intitule: "Formation test" }] }),
  I({ id: 2, civilite: "Mme", nom: "Martin", prenom: "Zoé", email: "zoe.martin@a2c.fictif", fonction: "formateur", nature: "salarie", domaines: ["Aide à la personne"] }),
  I({ id: 3, nom: "Handi", prenom: "Rémi", fonction: "referent_handicap", nature: "salarie" }),
  I({ id: 4, nom: "Ancien", prenom: "Paul", fonction: "formateur", nature: "porte", actif: false }),
];
const champ = (libelle) => {
  const racine = document.querySelector('[role="alertdialog"]') || dialogue() || document;
  const l = [...racine.querySelectorAll("label")].find((x) => x.textContent.replace(/\s*\(facultatif\)/, "").trim().startsWith(libelle));
  return l ? (document.getElementById(l.htmlFor) || l.querySelector("input")) : null;
};
const lignes = () => [...document.querySelectorAll("tbody tr")];
const ecritures = (appels, m) => appels.filter((a) => a.methode === m && a.chemin.startsWith("/api/intervenants"));

test("pur : domaines, filtres locaux (nom, e-mail, domaine, fonction, nature, statut), corps de fiche", () => {
  assert.deepEqual(domainesDepuisTexte("Bureautique, Accueil ; Bureautique\n"), ["Bureautique", "Accueil"]);
  assert.deepEqual(filtrerIntervenants(ANNUAIRE, {}).map((i) => i.id), [1, 2, 3], "actifs par défaut");
  assert.deepEqual(filtrerIntervenants(ANNUAIRE, { statut: "inactifs" }).map((i) => i.id), [4]);
  assert.deepEqual(filtrerIntervenants(ANNUAIRE, { q: "zoe" }).map((i) => i.id), [2], "sans accents");
  assert.deepEqual(filtrerIntervenants(ANNUAIRE, { q: "bureau" }).map((i) => i.id), [1], "domaine");
  assert.deepEqual(filtrerIntervenants(ANNUAIRE, { fonction: "referent_handicap" }).map((i) => i.id), [3]);
  assert.deepEqual(filtrerIntervenants(ANNUAIRE, { nature: "salarie", statut: "tous" }).map((i) => i.id), [2, 3]);
  assert.deepEqual(corpsFiche({ civilite: "", nom: " Durand ", prenom: "Léa", email: " ", fonction: "formateur", nature: "exterieur", domaines: "A, B", formation_ids: [7] }),
    { civilite: null, nom: "Durand", prenom: "Léa", email: null, fonction: "formateur", nature: "exterieur", domaines: ["A", "B"], formation_ids: [7] });
});

test("annuaire (admin) : colonnes, recherche et filtres en un seul appel, inactifs, 390 px", async () => {
  const appels = await monter("/intervenants", "admin", { "GET /api/intervenants": { intervenants: ANNUAIRE, total: 4 } });
  await attendre(() => lignes().length === 3);
  const t = texte();
  for (const x of ["Mme Zoé Martin", "zoe.martin@a2c.fictif", "Salarié", "Intervenant extérieur", "Référent handicap", "Bureautique", "Formation test"]) assert.ok(t.includes(x), x);
  await saisir(champ("Recherche"), "martin");
  assert.deepEqual(lignes().map((tr) => tr.querySelector("td").textContent), ["Mme Zoé Martinzoe.martin@a2c.fictif"]);
  await saisir(champ("Recherche"), "");
  await saisir(champ("Nature"), "salarie");
  assert.equal(lignes().length, 2);
  await saisir(champ("Statut"), "inactifs");
  assert.equal(lignes().length, 0);
  await saisir(champ("Nature"), "");
  assert.ok(lignes()[0].textContent.includes("Paul Ancien") && lignes()[0].textContent.includes("Inactif"));
  assert.equal(appels.filter((a) => a.chemin === "/api/intervenants").length, 1, "filtres appliqués localement");
  for (const tr of lignes()) assert.ok([...tr.querySelectorAll("td:not(.sess-table__actions)")].every((td) => td.getAttribute("data-label")));
});

test("création : champs obligatoires, aucune donnée personnelle demandée, corps exact ; erreur 409 ⇒ saisie conservée ; double clic ⇒ un seul POST", async () => {
  const v = vanne();
  const appels = await monter("/intervenants", "admin", {
    "GET /api/intervenants": { intervenants: ANNUAIRE, total: 4 },
    "POST /api/intervenants": async () => { await v.attendre(); return [409, { error: "Cette adresse e-mail professionnelle est déjà utilisée par une autre fiche." }]; },
  });
  await attendre(() => bouton("Nouvel intervenant"));
  await cliquer(bouton("Nouvel intervenant"));
  await attendre(() => champ("Nom"));
  const d = dialogue().textContent;
  assert.ok(d.includes("ni adresse personnelle, ni date de naissance, ni numéro de sécurité sociale, ni coordonnées bancaires"));
  for (const interdit of ["Adresse postale", "Date de naissance", "IBAN", "Sécurité sociale :"]) assert.ok(!champ(interdit), interdit);
  await cliquer(document.querySelector('button[type="submit"][form="form-intervenant"]'));
  await attendre(() => dialogue().textContent.includes("Indiquez le nom."));
  assert.ok(dialogue().textContent.includes("Choisissez la nature de l'intervention."));
  assert.equal(ecritures(appels, "POST").length, 0);
  await saisir(champ("Nom"), "Durand");
  await saisir(champ("Prénom"), "Léa");
  await saisir(champ("E-mail professionnel"), "zoe.martin@a2c.fictif");
  await saisir(champ("Fonction"), "appui");
  await saisir(champ("Nature de l'intervention"), "sous_traitant");
  await saisir(champ("Domaines de compétence"), "Accueil, Secrétariat");
  await attendre(() => champ("Formation test"));
  await cliquer(champ("Formation test"));
  const b = document.querySelector('button[type="submit"][form="form-intervenant"]');
  await cliquer(b); await cliquer(b);
  v.ouvrir();
  await attendre(() => dialogue()?.textContent.includes("déjà utilisée par une autre fiche"));
  assert.equal(ecritures(appels, "POST").length, 1);
  assert.deepEqual(ecritures(appels, "POST")[0].corps, { civilite: null, nom: "Durand", prenom: "Léa", email: "zoe.martin@a2c.fictif", fonction: "appui", nature: "sous_traitant", domaines: ["Accueil", "Secrétariat"], formation_ids: [7] });
  assert.equal(champ("Nom").value, "Durand", "saisie conservée");
});

test("modification : fiche préremplie, historique des interventions, PATCH ; désactivation confirmée (Échap n'envoie rien)", async () => {
  const appels = await monter("/intervenants", "admin", {
    "GET /api/intervenants": { intervenants: ANNUAIRE, total: 4 },
    "GET /api/intervenants/2": { intervenant: ANNUAIRE[1], sessions: [{ id: 1, reference: "SESS-TEST", formation: "Formation test", date_debut: "2026-09-01", date_fin: "2026-12-15", groupes: ["Soula"] }] },
    "PATCH /api/intervenants/2": (c) => ({ intervenant: { ...ANNUAIRE[1], ...c } }),
  });
  await attendre(() => document.querySelector('button[aria-label="Modifier la fiche de Zoé Martin"]'));
  await cliquer(document.querySelector('button[aria-label="Modifier la fiche de Zoé Martin"]'));
  await attendre(() => dialogue()?.textContent.includes("SESS-TEST"));
  assert.equal(champ("Nom").value, "Martin");
  assert.equal(champ("Domaines de compétence").value, "Aide à la personne");
  assert.ok(dialogue().textContent.includes("groupes : Soula"));
  await saisir(champ("Domaines de compétence"), "Aide à la personne, Hygiène");
  await cliquer(document.querySelector('button[type="submit"][form="form-intervenant"]'));
  await attendre(() => ecritures(appels, "PATCH").length === 1 && !dialogue());
  assert.deepEqual(ecritures(appels, "PATCH")[0].corps.domaines, ["Aide à la personne", "Hygiène"]);
  await cliquer(document.querySelector('button[aria-label="Désactiver Zoé Martin"]'));
  await attendre(() => document.querySelector('[role="alertdialog"]'));
  assert.ok(document.querySelector('[role="alertdialog"]').textContent.includes("Son historique (sessions, groupes, documents) est conservé."));
  await cliquer([...document.querySelectorAll('[role="alertdialog"] button')].find((x) => x.textContent === "Annuler"));
  assert.equal(ecritures(appels, "PATCH").length, 1);
  await cliquer(document.querySelector('button[aria-label="Désactiver Zoé Martin"]'));
  await attendre(() => document.querySelector('[role="alertdialog"]'));
  await cliquer([...document.querySelectorAll('[role="alertdialog"] button')].find((x) => x.textContent === "Désactiver"));
  await attendre(() => ecritures(appels, "PATCH").length === 2);
  assert.deepEqual(ecritures(appels, "PATCH")[1].corps, { actif: false });
});

test("contributeur : consultation seule — ni e-mail, ni nature, ni formations, aucune commande", async () => {
  const restreint = ANNUAIRE.map(({ id, civilite, nom, prenom, fonction, domaines, actif }) => ({ id, civilite, nom, prenom, fonction, domaines, actif }));
  await monter("/intervenants", "contributeur", { "GET /api/intervenants": { intervenants: restreint, total: 4 } });
  await attendre(() => lignes().length === 3);
  assert.ok(!bouton("Nouvel intervenant") && !document.querySelector('button[aria-label^="Modifier la fiche"]') && !document.querySelector('button[aria-label^="Désactiver"]'));
  assert.ok(!champ("Nature"), "pas de filtre nature");
  const entetes = [...document.querySelectorAll("thead th")].map((th) => th.textContent);
  assert.ok(!entetes.includes("Nature") && !entetes.includes("Formations"));
});

const SESSION_INTERV = (sur = {}) => ({
  archivee: false,
  historique: { session: "M. Durand", groupes: [{ id: 5, nom: "Soula", formateur: "Mme Lopez" }] },
  session: [], groupes: { 5: [] }, ...sur,
});

test("session : textes historiques conservés et utilisés tels quels ; rapprochement MANUEL (recherche préremplie, choix explicite) ; groupe", async () => {
  let etat = SESSION_INTERV();
  const appels = await monter("/sessions/1/stagiaires", "admin", {
    "GET /api/sessions/1/intervenants": () => etat,
    "GET /api/intervenants": { intervenants: ANNUAIRE.filter((i) => i.actif), total: 3 },
    "POST /api/sessions/1/intervenants": (c) => { etat = SESSION_INTERV({ session: [ANNUAIRE.find((i) => i.id === c.intervenant_id)] }); return [201, etat]; },
    "POST /api/sessions/1/groupes/5/intervenants": (c) => { etat = { ...etat, groupes: { 5: [ANNUAIRE.find((i) => i.id === c.intervenant_id)] } }; return [201, etat]; },
  });
  await attendre(() => texte().includes("Formateur saisi (historique) : « M. Durand »"));
  assert.ok(texte().includes("utilisé tel quel dans les documents"));
  assert.ok(texte().includes("Formateur saisi (historique) : « Mme Lopez »"));
  await cliquer(document.querySelector('button[aria-label="Rapprocher « M. Durand » d\'une fiche de l\'annuaire"]'));
  await attendre(() => dialogue()?.textContent.includes("Rattacher un intervenant"));
  assert.equal(champ("Rechercher dans l'annuaire").value, "M. Durand", "recherche préremplie avec le texte historique");
  assert.ok(dialogue().textContent.includes("rien n'est rapproché automatiquement"));
  assert.ok(dialogue().textContent.includes("Aucune fiche correspondante"), "aucune ressemblance devinée");
  assert.equal(appels.filter((a) => a.methode === "POST").length, 0);
  await saisir(champ("Rechercher dans l'annuaire"), "Martin");
  await cliquer(document.querySelector('button[aria-label="Rattacher Zoé Martin"]'));
  await attendre(() => texte().includes("remplacé dans les documents par les formateurs rattachés"));
  assert.deepEqual(appels.find((a) => a.methode === "POST").corps, { intervenant_id: 2 });
  assert.ok(texte().includes("Formateur saisi (historique) : « M. Durand »"), "le texte historique reste affiché");
  await cliquer(document.querySelector('button[aria-label="Ajouter un intervenant — Groupe Soula"]'));
  await attendre(() => document.querySelector('button[aria-label="Rattacher Luc Abel"]'));
  await cliquer(document.querySelector('button[aria-label="Rattacher Luc Abel"]'));
  await attendre(() => appels.some((a) => a.chemin === "/api/sessions/1/groupes/5/intervenants"));
  await attendre(() => texte().includes("Luc Abel rattaché(e) — groupe Soula."));
});

test("session : retrait d'un rattachement ; intervenant inactif affiché (historique) ; contributeur en lecture seule ; archivée", async () => {
  const avec = SESSION_INTERV({ session: [ANNUAIRE[1], ANNUAIRE[3]] });
  const appels = await monter("/sessions/1/stagiaires", "admin", {
    "GET /api/sessions/1/intervenants": avec,
    "DELETE /api/sessions/1/intervenants/2": () => SESSION_INTERV({ session: [ANNUAIRE[3]] }),
  });
  await attendre(() => texte().includes("Paul Ancien"));
  assert.ok(document.querySelector('ul[aria-label="Intervenants — Session"]').textContent.includes("Inactif"), "historique conservé, marqué inactif");
  await cliquer(document.querySelector('button[aria-label="Retirer Zoé Martin — Session"]'));
  await attendre(() => appels.some((a) => a.methode === "DELETE" && a.chemin === "/api/sessions/1/intervenants/2"));
  await attendre(() => !texte().includes("Zoé Martin"));
  await demonter();
  await monter("/sessions/1/stagiaires", "contributeur", { "GET /api/sessions/1/intervenants": avec });
  await attendre(() => texte().includes("Zoé Martin"));
  assert.ok(!document.querySelector('button[aria-label^="Retirer"]') && !document.querySelector('button[aria-label^="Ajouter un intervenant"]') && !document.querySelector('button[aria-label^="Rapprocher"]'));
  await demonter();
  await monter("/sessions/1/stagiaires", "admin", { "GET /api/sessions/1/intervenants": { ...avec, archivee: true } });
  await attendre(() => texte().includes("Zoé Martin"));
  assert.ok(!document.querySelector('button[aria-label^="Ajouter un intervenant"]'), "session archivée : lecture seule");
});
