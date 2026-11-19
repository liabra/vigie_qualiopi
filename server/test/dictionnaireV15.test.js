// ─────────────────────────────────────────────────────────────
//  Dictionnaire des variables v1.5 : harmonisation des libellés.
//  Tests PURS (ni base, ni Google). Garde-fous :
//   · les 164 noms techniques et identifiants de la v1.4 sont strictement conservés
//     (renommer une variable casserait les modèles Drive existants) ;
//   · les 43 libellés validés sont exactement ceux attendus ;
//   · aucun libellé n'est en double dans le dictionnaire.
// ─────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ALIAS, DICTIONNAIRE_VERSION, EVOLUTIONS, HISTORIQUES, VARIABLES, variableCanonique } from "../src/services/catalogueVariables.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const lire = (f) => JSON.parse(fs.readFileSync(path.join(ICI, "fixtures", f), "utf8"));
const NOMS_V14 = lire("dictionnaire_v1_4_noms.json");
const LIBELLES_V15 = lire("dictionnaire_v1_5_libelles.json");

test("v1.5 puis 1.6 : version annoncée et historique des évolutions", () => {
  assert.equal(DICTIONNAIRE_VERSION, "1.9");
  assert.ok(EVOLUTIONS.some((e) => e.version === "1.5" && /43 libellés/.test(e.changement)));
  assert.ok(EVOLUTIONS.some((e) => e.version === "1.6" && /7 variables/.test(e.changement)));
  assert.ok(EVOLUTIONS.some((e) => e.version === "1.7" && /questionnaire_formation/.test(e.changement)));
});

const NOUVELLES_V16 = ["besoin_date_recueil", "besoin_attentes", "besoin_objectifs_personnels", "besoin_prerequis_verifies", "besoin_conclusion", "stagiaire_situation_handicap", "evaluation_seuil_reussite"];

test("non-régression : les 164 noms techniques et identifiants de la v1.4 sont strictement conservés", () => {
  assert.equal(NOMS_V14.variables.length, 164);
  assert.equal(VARIABLES.length, 164 + NOUVELLES_V16.length + 31 + 2, "seules les variables des versions 1.6 (7), 1.8 (31) et 1.9 (2) s'ajoutent, aucune n'est retirée");
  assert.deepEqual(VARIABLES.filter((v) => v.depuis === "1.6").map((v) => v.nom).sort(), [...NOUVELLES_V16].sort());
  const actuel = new Map(VARIABLES.map((v) => [v.nom, v.id]));
  for (const { id, nom } of NOMS_V14.variables) {
    assert.equal(actuel.get(nom), id, `variable conservée avec le même identifiant : ${nom}`);
    assert.equal(variableCanonique(nom).balise, `{{${nom}}}`);
  }
  // Les alias et marqueurs historiques (anciens modèles Drive) ne changent pas.
  assert.equal(ALIAS.prenom_stagiaire, "stagiaire_prenom");
  assert.equal(ALIAS.intitule_formation, "formation_intitule");
  assert.ok(HISTORIQUES.date_convocation && HISTORIQUES.duree);
});

test("libellés : les 43 corrections validées sont appliquées telles quelles", () => {
  assert.equal(Object.keys(LIBELLES_V15).length, 43);
  for (const [nom, libelle] of Object.entries(LIBELLES_V15)) {
    assert.equal(variableCanonique(nom).libelle, libelle, nom);
  }
});

test("libellés : exceptions validées conservées (nuance « officiel »)", () => {
  assert.equal(variableCanonique("organisme_nom").libelle, "Nom officiel de l'organisme");
  assert.equal(variableCanonique("formation_duree_heures").libelle, "Durée officielle du parcours en heures");
  assert.ok(!("organisme_nom" in LIBELLES_V15) && !("formation_duree_heures" in LIBELLES_V15));
});

test("libellés : aucun doublon dans le dictionnaire, aucun libellé vide", () => {
  const vus = new Map();
  for (const v of VARIABLES) {
    assert.ok(typeof v.libelle === "string" && v.libelle.trim() === v.libelle && v.libelle.length > 0, `libellé propre : ${v.nom}`);
    const cle = v.libelle.toLowerCase();
    assert.ok(!vus.has(cle), `libellé en double « ${v.libelle} » : ${vus.get(cle)} et ${v.nom}`);
    vus.set(cle, v.nom);
  }
});

test("libellés : plus de libellé générique « E-mail », « Téléphone », « Code postal », « Ville », « Nom », « Prénom », « Civilité »", () => {
  const generiques = new Set(["e-mail", "téléphone", "code postal", "ville", "nom", "prénom", "civilité", "adresse", "date de naissance", "date d'inscription", "nom complet"]);
  for (const v of VARIABLES) assert.ok(!generiques.has(v.libelle.toLowerCase()), `libellé trop générique : ${v.nom} « ${v.libelle} »`);
  const lib = (n) => variableCanonique(n).libelle;
  assert.equal(lib("stagiaire_nom"), "Nom du stagiaire");
  assert.equal(lib("stagiaire_prenom"), "Prénom du stagiaire");
  assert.equal(lib("session_date_debut"), "Date de début de session");
  assert.equal(lib("session_date_fin"), "Date de fin de session");
  assert.equal(lib("formation_intitule"), "Intitulé officiel de la formation");
});
