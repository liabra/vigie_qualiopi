// Page « Variables documentaires » : consultation seule du dictionnaire (catalogue réel du serveur),
// recherche (accents et casse ignorés), classement par domaine, accès contributeur.
import "./dom.mjs";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, champ, demonter, monter, saisir, texte } from "./outils.jsx";
import { catalogue } from "../../server/src/services/catalogueVariables.js";
import { filtrerVariables, grouperParDomaine } from "../src/parametres/VariablesDocuments.jsx";

afterEach(demonter);

const CATALOGUE = catalogue();
const ROUTES = { "GET /api/documents/variables": CATALOGUE };

const titresDomaines = () => [...document.querySelectorAll("h2.param-section__titre")].map((h) => h.textContent.replace(/\s*\(\d+\)$/, ""));
const lignes = () => [...document.querySelectorAll("tbody tr")];

test("page : tout utilisateur connecté (contributeur) voit les variables classées par domaine", async () => {
  await monter("/variables-documentaires", "contributeur", ROUTES);
  await attendre(() => texte().includes(`Dictionnaire v${CATALOGUE.version}`));
  assert.ok(texte().includes(`${CATALOGUE.variables.length} variables`));
  const domaines = titresDomaines();
  assert.equal(domaines[0], "Organisme", "ordre du dictionnaire");
  assert.ok(domaines.includes("Stagiaire / bénéficiaire") && domaines.includes("Blocs répétables"));
  assert.ok(texte().includes("Nom du stagiaire") && texte().includes("{{stagiaire_nom}}"), "libellé v1.5 et balise");
  assert.ok(texte().includes("Nom officiel de l'organisme"), "libellé conservé");
});

test("page : consultable par le contributeur (lien direct), hors de son menu, sans action d'écriture", async () => {
  await monter("/variables-documentaires", "contributeur", ROUTES);
  await attendre(() => texte().includes(`Dictionnaire v${CATALOGUE.version}`));
  const liens = [...document.querySelectorAll("nav a")].map((a) => a.getAttribute("href"));
  assert.ok(!liens.includes("/variables-documentaires"), "rangé dans Réglages (administrateur)");
  assert.equal(document.querySelectorAll("tbody button").length, 0, "aucun bouton d'action dans les tableaux");
  assert.ok(!document.querySelector("form"), "lecture seule : aucun formulaire");
});

test("recherche : libellé, balise, accents et casse ignorés ; compteur ; aucun résultat", async () => {
  await monter("/variables-documentaires", "admin", ROUTES);
  await attendre(() => champ("Rechercher une variable"));
  await saisir(champ("Rechercher une variable"), "PRENOM DU STAGIAIRE");
  await attendre(() => texte().includes("variable(s) trouvée(s)"));
  assert.ok(lignes().some((tr) => tr.textContent.includes("{{stagiaire_prenom}}")));
  assert.ok(!lignes().some((tr) => tr.textContent.includes("{{formation_intitule}}")), "les autres variables sont masquées");

  await saisir(champ("Rechercher une variable"), "Téléphone de l'intervenant");
  await attendre(() => lignes().some((tr) => tr.textContent.includes("{{intervenant_telephone}}")));
  await saisir(champ("Rechercher une variable"), "{{session_date_debut}}");
  await attendre(() => lignes().length === 1 || texte().includes("1 variable(s) trouvée(s)"));
  await saisir(champ("Rechercher une variable"), "zzzzinconnu");
  await attendre(() => texte().includes("Aucune variable ne correspond"));
});

test("fonctions pures : filtre sans accent et regroupement dans l'ordre du dictionnaire", () => {
  const v = CATALOGUE.variables;
  assert.equal(filtrerVariables(v, "").length, v.length);
  assert.deepEqual(filtrerVariables(v, "civilité du stagiaire").map((x) => x.nom), ["stagiaire_civilite"]);
  assert.deepEqual(filtrerVariables(v, "CIVILITE DU STAGIAIRE").map((x) => x.nom), ["stagiaire_civilite"]);
  const groupes = grouperParDomaine(v, CATALOGUE.domaines);
  assert.equal(groupes.reduce((n, g) => n + g.variables.length, 0), v.length);
  assert.deepEqual(groupes.map((g) => g.cle), Object.keys(CATALOGUE.domaines));
});

test("dictionnaire indisponible : message d'erreur, pas de page vide silencieuse", async () => {
  await monter("/variables-documentaires", "admin", { "GET /api/documents/variables": [500, { error: "Erreur interne." }] });
  await attendre(() => texte().includes("Le dictionnaire n'a pas pu être chargé."));
});
