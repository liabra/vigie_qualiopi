// Séquence pédagogique d'une formation : lecture d'un tableau collé, écran de saisie, enregistrement, refus serveur.
// API simulée, données fictives.
import "./dom.mjs";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, champ, cliquer, demonter, monter, saisir, texte } from "./outils.jsx";
import { depuisServeur, lireSequenceCollee, lireTableau, minutes, versCorps } from "../src/parametres/sequence.js";

afterEach(async () => { await demonter(); });

const TABLEAU = [
  "Mod1_C1 Prise en main\tDurée\tObjectifs\t Support\tModalité\tActivités\tRessources\tIndicateurs",
  'AT01 Découverte des outils\t40 min\tIdentifier les outils\tOrdinateur\tPrésentiel\t"- Présentation\n- Manipulation"\tp.10\tOutils distingués',
  "AT02 Composants\t45 min\tReconnaître les composants\t\t\t- Repérage\tp.12\tComposants reconnus",
  "Evaluation intermédiaire 1\t20 min\tVérifier les acquis du module\t\t\t\t\t",
  "Mod2_C2 Navigation Internet\tDurée\t\t\t\t\t\t",
  "AT07 Internet\t1h\tComprendre\tOrdinateur\t\t\t\t",
].join("\n");

test("pur : durées, cellules entre guillemets et lignes ignorées", () => {
  assert.equal(minutes("40 min"), 40); assert.equal(minutes("1h"), 60); assert.equal(minutes("1h30"), 90); assert.equal(minutes("5 h"), 300); assert.equal(minutes("n/a"), null);
  assert.deepEqual(lireTableau('a\t"b\tc"\t"d ""e"""\nf'), [["a", "b\tc", 'd "e"'], ["f"]]);
});

test("pur : le tableau collé donne modules, compétences, évaluation et durées ; support repris vers le bas", () => {
  const { modules, avertissements } = lireSequenceCollee(TABLEAU);
  assert.deepEqual(avertissements, []);
  assert.deepEqual(modules.map((m) => [m.code, m.intitule, m.competences.length]), [["C1", "Prise en main", 2], ["C2", "Navigation Internet", 1]]);
  assert.equal(modules[0].competences[0].activites, "- Présentation\n- Manipulation");
  assert.equal(modules[0].competences[1].support, "Ordinateur", "support hérité");
  assert.equal(modules[0].evaluation_minutes, 20);
  assert.equal(modules[0].duree_minutes, 40 + 45 + 20);
  assert.equal(modules[1].competences[0].duree_minutes, 60);
  assert.match(lireSequenceCollee("rien d'utile").avertissements[0], /Aucun module/);
});

test("pur : corps envoyé (vides → null, durées entières) et aller-retour serveur", () => {
  const { modules } = lireSequenceCollee(TABLEAU);
  const corps = versCorps(modules);
  assert.equal(corps.modules[0].competences[1].objectif, "Reconnaître les composants");
  assert.equal(corps.modules[1].evaluation_minutes, null);
  assert.equal(corps.modules[0].competences[0].duree_minutes, 40);
  assert.deepEqual(versCorps(depuisServeur(corps.modules)), corps);
});

const FORMATION = { id: 4, intitule: "Atelier fictif", actif: true, version_id: 9, version_numero: 1, nb_versions: 1, nb_sessions: 0, modalite: "presentiel" };
const SERVEUR = { version: 1, modules: [{ code: "C1", intitule: "Prise en main", duree_minutes: 60, evaluation_minutes: 20, evaluation_objectif: null,
  competences: [{ code: "AT01", libelle: "découvrir les outils", titre: "Découverte", duree_minutes: 40, objectif: null, support: null, modalite: null, activites: null, ressources: null, indicateur: null }] }] };

test("écran : ouverture depuis le catalogue, séquence existante affichée, enregistrement (PUT)", async () => {
  const appels = await monter("/formations", "admin", { "GET /api/formations": { formations: [FORMATION] }, "GET /api/formations/4/modules": SERVEUR, "PUT /api/formations/4/modules": SERVEUR });
  await attendre(() => bouton("Séquence"));
  await cliquer(bouton("Séquence"));
  await attendre(() => texte().includes("C1 — Prise en main"));
  assert.ok(texte().includes("1 modules, 1 compétences") || texte().includes("1 modules"));
  await saisir(champ("Intitulé du module C1"), "Prise en main des outils");
  await cliquer(bouton("Enregistrer la séquence"));
  await attendre(() => appels.some((a) => a.methode === "PUT" && a.chemin === "/api/formations/4/modules"));
  const put = appels.find((a) => a.methode === "PUT" && a.chemin.endsWith("/modules"));
  assert.equal(put.corps.modules[0].intitule, "Prise en main des outils");
  assert.equal(put.corps.modules[0].competences[0].code, "AT01");
  await attendre(() => texte().includes("Séquence pédagogique de « Atelier fictif » enregistrée."));
});

test("écran : refus du serveur affiché sans fermer le panneau", async () => {
  await monter("/formations", "admin", { "GET /api/formations": { formations: [FORMATION] }, "GET /api/formations/4/modules": SERVEUR,
    "PUT /api/formations/4/modules": [409, { error: "Des compétences de stagiaires sont déjà saisies sur cette version : créez une nouvelle version de la formation pour modifier la séquence." }] });
  await attendre(() => bouton("Séquence"));
  await cliquer(bouton("Séquence"));
  await attendre(() => bouton("Enregistrer la séquence"));
  await cliquer(bouton("Enregistrer la séquence"));
  await attendre(() => texte().includes("créez une nouvelle version"));
  assert.ok(bouton("Enregistrer la séquence"));
});
