// La convention de marqueurs est un contrat avec les documents modèles
// déjà écrits sur le Drive : renommer un marqueur casse silencieusement
// tous les modèles. Ces tests figent la liste et le format des valeurs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MARQUEURS, formaterDate, formaterDuree, marqueursInconnus, remplacer,
  requetesDocs, requetesSheets, valeursMarqueurs,
} from "../src/services/marqueurs.js";
import { resoudreCanoniques } from "../src/services/resolversCanoniques.js";

test("la liste des marqueurs est exactement celle convenue", () => {
  assert.deepEqual(MARQUEURS, [
    "civilite", "nom_stagiaire", "prenom_stagiaire", "date_debut", "date_fin", "date_attestation",
    "horaire", "duree", "intitule_formation", "lieu", "formateur", "nom_organisme",
    "session_reference", "session_statut", "email", "telephone", "entreprise", "financeur",
    "prescripteur", "groupe", "heures_absence", "heures_suivies", "taux_assiduite",
  ]);
});

test("les dates passent en jj/mm/aaaa", () => {
  assert.equal(formaterDate("2026-01-05"), "05/01/2026");
  assert.equal(formaterDate(new Date("2026-03-05T00:00:00Z")), "05/03/2026");
  assert.equal(formaterDate(null), "");
});

test("l'horaire de la session est repris tel quel, et vide s'il manque", () => {
  assert.equal(valeursMarqueurs(contexte).horaire, "8h30–12h00 / 13h00–16h30");
  // session sans horaire : chaîne vide, jamais « {{horaire}} » imprimé
  const sansHoraire = valeursMarqueurs({ ...contexte, session: { date_debut: "2026-01-05" } });
  assert.equal(sansHoraire.horaire, "");
  assert.equal(valeursMarqueurs({}).horaire, "");
  // le remplacement fonctionne dans les deux cas
  assert.equal(remplacer("Horaires : {{horaire}}", valeursMarqueurs(contexte)), "Horaires : 8h30–12h00 / 13h00–16h30");
  assert.equal(remplacer("Horaires : {{horaire}}", sansHoraire), "Horaires : ");
});

test("{{horaire}} n'est plus tenu pour un marqueur inconnu", () => {
  assert.ok(MARQUEURS.includes("horaire"));
  assert.deepEqual(marqueursInconnus("Convocation {{horaire}} {{nom_stagiaire}}"), []);
  // un vrai inconnu reste détecté
  assert.deepEqual(marqueursInconnus("{{horaire}} {{salle}}"), ["salle"]);
});

test("la date d'attestation reprend la date de fin de session", () => {
  const v = valeursMarqueurs(contexte);
  assert.equal(v.date_attestation, "05/03/2026");
  assert.equal(v.date_attestation, v.date_fin, "même donnée, même formatage");
  // sans session renseignée, les deux restent vides plutôt que « Invalid Date »
  const sansSession = valeursMarqueurs({ organisme: "A2C" });
  assert.equal(sansSession.date_attestation, "");
  assert.equal(sansSession.date_attestation, sansSession.date_fin);
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
  session: { date_debut: "2026-01-05", date_fin: "2026-03-05", lieu: "Cayenne", formateur: "Mme Carr", horaire: "8h30–12h00 / 13h00–16h30" },
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

test("les marqueurs d'assiduité viennent du calcul L2, pas d'un second calcul", () => {
  const v = valeursMarqueurs({
    ...contexte,
    stagiaire: {
      ...contexte.stagiaire, email: "jean.dupont@exemple.fr", telephone: "0694…",
      entreprise: "ACME", financeur: "OPCO", prescripteur_nom: "Pôle Emploi", groupe_nom: "Soula",
    },
    assiduite: { fiable: true, heures_absence: 3.5, heures_suivies: 24.5, taux: 88 },
  });
  assert.equal(v.email, "jean.dupont@exemple.fr");
  assert.equal(v.telephone, "0694…");
  assert.equal(v.entreprise, "ACME");
  assert.equal(v.financeur, "OPCO");
  assert.equal(v.prescripteur, "Pôle Emploi");
  assert.equal(v.groupe, "Soula");
  assert.equal(v.heures_absence, "3.5 h");
  assert.equal(v.heures_suivies, "24.5 h");
  assert.equal(v.taux_assiduite, "88 %");
});

test("assiduité non fiable : heures suivies et taux VIDES, jamais un faux chiffre", () => {
  const v = valeursMarqueurs({
    ...contexte,
    assiduite: { fiable: false, heures_absence: 10, heures_suivies: null, taux: null },
  });
  assert.equal(v.heures_absence, "10 h", "le total d'absences reste un fait");
  assert.equal(v.heures_suivies, "");
  assert.equal(v.taux_assiduite, "");
});

test("session_reference et session_statut ne s'inventent pas", () => {
  assert.equal(valeursMarqueurs(contexte).session_reference, "", "sans référence : vide");
  assert.equal(valeursMarqueurs(contexte).session_statut, "", "sans statut : vide");
  const v = valeursMarqueurs({
    ...contexte,
    session: { ...contexte.session, reference: "SESS-1", statut: "terminee" },
  });
  assert.equal(v.session_reference, "SESS-1");
  assert.equal(v.session_statut, "Terminée");
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

// ── DOC-3B : les 11 alias historiques relisent désormais le resolver
// canonique — UNE seule source de calcul, jamais deux qui divergent.
const PAIRES_ALIAS = [
  ["civilite", "stagiaire_civilite"], ["nom_stagiaire", "stagiaire_nom"], ["prenom_stagiaire", "stagiaire_prenom"],
  ["date_debut", "session_date_debut"], ["date_fin", "session_date_fin"], ["horaire", "session_horaires"],
  ["intitule_formation", "formation_intitule"], ["nom_organisme", "organisme_nom"],
  ["email", "stagiaire_email"], ["telephone", "stagiaire_telephone"],
];

test("DOC-3B : {{nom_stagiaire}} et {{stagiaire_nom}} — et les 10 autres paires alias/canonique — produisent exactement la même valeur", () => {
  assert.equal(PAIRES_ALIAS.length, 10, "10 des 11 alias vérifiés ; heures_absence est testé séparément (reformatage)");
  const v = valeursMarqueurs(contexte);
  const can = resoudreCanoniques(contexte);
  for (const [historique, canonique] of PAIRES_ALIAS) {
    const attendu = can[canonique].statut === "resolu" ? String(can[canonique].valeur) : "";
    assert.equal(v[historique], attendu, `{{${historique}}} doit égaler {{${canonique}}}`);
  }
  // Exemple explicitement demandé : {{stagiaire_nom}} et {{nom_stagiaire}}.
  assert.equal(v.nom_stagiaire, "Dupont");
  assert.equal(can.stagiaire_nom.valeur, "Dupont");
  assert.equal(v.nom_stagiaire, can.stagiaire_nom.valeur);

  // Contexte sans ces données : les deux restent vides, ensemble.
  const videHist = valeursMarqueurs({});
  const videCan = resoudreCanoniques({});
  for (const [historique, canonique] of PAIRES_ALIAS) {
    assert.equal(videHist[historique], "");
    assert.equal(videCan[canonique].statut, "absent");
  }
});

test("DOC-3B : 11e alias, heures_absence — même donnée que absence_heures_total, reformatée « N h »", () => {
  const ctx = { ...contexte, assiduite: { fiable: true, heures_absence: 3.5, heures_suivies: 17.5, taux: 83 } };
  const v = valeursMarqueurs(ctx);
  const can = resoudreCanoniques(ctx);
  assert.equal(v.heures_absence, "3.5 h");
  assert.equal(can.absence_heures_total.valeur, 3.5, "valeur canonique : nombre brut, pas « 3.5 h »");
  assert.equal(v.heures_absence, formaterDuree(can.absence_heures_total.valeur));
});

test("DOC-3B : non-régression des 12 marqueurs historiques SANS alias — calcul propre, inchangé", () => {
  // duree et date_attestation ne sont PAS des alias (DOC-1) : leur resolver
  // historique n'est pas touché par resolversCanoniques.js.
  const v = valeursMarqueurs({ ...contexte, session: { ...contexte.session, duree_heures_reelle: 28, reference: "SESS-1", statut: "terminee" } });
  assert.equal(v.duree, "28 h");
  assert.equal(v.date_attestation, "05/03/2026");
  assert.equal(v.session_statut, "Terminée", "libellé affiché, pas la valeur métier brute « terminee »");
  assert.equal(v.lieu, "Soula");
  assert.equal(v.formateur, "M. Jones");
});

test("DOC-3B : document_date et document_date_convocation partagent le même instant passé par documents.js", () => {
  const maintenant = new Date("2026-02-01T10:00:00Z");
  const v = valeursMarqueurs({ ...contexte, maintenant });
  assert.equal(v.canoniques.document_date.valeur, "01/02/2026");
  assert.equal(v.canoniques.document_date_convocation.valeur, "01/02/2026");
  assert.equal(v.canoniques.document_date.valeur, v.canoniques.document_date_convocation.valeur);
});

test("DOC-3B : la couche canonique n'est jamais aplatie en silence dans valeursMarqueurs()", () => {
  const v = valeursMarqueurs({});
  // formation_id (ex.) n'a pas d'alias historique : il reste visible sous
  // son vrai statut dans `canoniques`, jamais transformé en "" sans trace.
  assert.deepEqual(v.canoniques.formation_id, { statut: "absent", valeur: null });
  assert.equal(v.canoniques.evaluation_id.statut, "non_resoluble");
});
