// La convention de marqueurs est un contrat avec les documents modèles
// déjà écrits sur le Drive : renommer un marqueur casse silencieusement
// tous les modèles. Ces tests figent la liste et le format des valeurs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MARQUEURS, formaterDate, formaterDuree, marqueursInconnus, remplacer,
  requetesDocs, requetesSheets, valeursMarqueurs,
} from "../src/services/marqueurs.js";

test("la liste des marqueurs est exactement celle convenue", () => {
  assert.deepEqual(MARQUEURS, [
    "civilite", "nom_stagiaire", "prenom_stagiaire", "date_debut", "date_fin", "duree",
    "intitule_formation", "lieu", "formateur", "nom_organisme",
  ]);
});

test("les dates passent en jj/mm/aaaa", () => {
  assert.equal(formaterDate("2026-01-05"), "05/01/2026");
  assert.equal(formaterDate(new Date("2026-03-05T00:00:00Z")), "05/03/2026");
  assert.equal(formaterDate(null), "");
});

test("les durées s'écrivent en heures, sans décimale inutile", () => {
  assert.equal(formaterDuree(21), "21 h");
  assert.equal(formaterDuree("21.00"), "21 h");
  assert.equal(formaterDuree(17.5), "17.5 h");
  assert.equal(formaterDuree(null), "");
});

const contexte = {
  formation: { intitule: "Atelier numérique" },
  version: { duree_heures_defaut: 21 },
  session: { date_debut: "2026-01-05", date_fin: "2026-03-05", lieu: "Cayenne", formateur: "Mme Carr" },
  groupe: { lieu: "Soula", formateur: "M. Jones" },
  stagiaire: { civilite: "Mme", nom: "Dupont", prenom: "Jean" },
  organisme: "A2C",
};

test("le groupe l'emporte sur la session pour le lieu et le formateur", () => {
  const v = valeursMarqueurs(contexte);
  assert.equal(v.lieu, "Soula");
  assert.equal(v.formateur, "M. Jones");
  // sans groupe, on retombe sur la session
  const sansGroupe = valeursMarqueurs({ ...contexte, groupe: null });
  assert.equal(sansGroupe.lieu, "Cayenne");
  assert.equal(sansGroupe.formateur, "Mme Carr");
});

test("la durée réelle de la session l'emporte sur celle de la formation", () => {
  assert.equal(valeursMarqueurs(contexte).duree, "21 h");
  assert.equal(valeursMarqueurs({ ...contexte, session: { ...contexte.session, duree_heures_reelle: 28 } }).duree, "28 h");
});

test("la civilité vient du stagiaire, et reste vide si elle n'est pas renseignée", () => {
  assert.equal(valeursMarqueurs(contexte).civilite, "Mme");
  // stagiaire saisi avant l'ajout de la colonne : rien ne doit casser
  const sansCivilite = valeursMarqueurs({ ...contexte, stagiaire: { nom: "Dupont", prenom: "Jean" } });
  assert.equal(sansCivilite.civilite, "");
  assert.equal(remplacer("{{civilite}} {{nom_stagiaire}}", sansCivilite), " Dupont");
});

test("un marqueur sans valeur devient vide, jamais « {{...}} » imprimé", () => {
  const v = valeursMarqueurs({ session: {}, organisme: "A2C" });
  assert.equal(v.nom_stagiaire, "");
  assert.equal(v.intitule_formation, "");
  assert.equal(remplacer("Bonjour {{prenom_stagiaire}} {{nom_stagiaire}}", v), "Bonjour  ");
});

test("le remplacement ne touche que les marqueurs connus", () => {
  const v = valeursMarqueurs(contexte);
  assert.equal(remplacer("{{intitule_formation}} du {{date_debut}}", v), "Atelier numérique du 05/01/2026");
  // un marqueur inconnu reste tel quel plutôt que de disparaître en silence
  assert.equal(remplacer("{{inconnu}}", v), "{{inconnu}}");
  assert.deepEqual(marqueursInconnus("{{nom_stagiaire}} et {{signature}} et {{tampon}}"), ["signature", "tampon"]);
});

test("les requêtes Google couvrent tous les marqueurs, avec la bonne forme", () => {
  const v = valeursMarqueurs(contexte);
  const docs = requetesDocs(v);
  assert.equal(docs.length, MARQUEURS.length);
  // repérage par nom, pas par position : ajouter un marqueur ne doit pas
  // faire échouer ce test pour une mauvaise raison.
  const requete = (nom) => docs.find((d) => d.replaceAllText.containsText.text === "{{" + nom + "}}");
  assert.deepEqual(requete("nom_stagiaire").replaceAllText.containsText, { text: "{{nom_stagiaire}}", matchCase: true });
  assert.equal(requete("nom_stagiaire").replaceAllText.replaceText, "Dupont");
  assert.equal(requete("civilite").replaceAllText.replaceText, "Mme");
  const sheets = requetesSheets(v);
  assert.equal(sheets.length, MARQUEURS.length);
  const trouve = (nom) => sheets.find((r) => r.findReplace.find === "{{" + nom + "}}");
  assert.equal(trouve("nom_stagiaire").findReplace.allSheets, true);
  assert.ok(trouve("civilite"));
});
