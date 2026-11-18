// ─────────────────────────────────────────────────────────────
//  DOC-3B — resoudreCanoniques(ctx) : 162 clés exactement, pilotées par le
//  catalogue, trois statuts stricts (resolu / absent / non_resoluble).
//  Module PUR : aucune base, aucun Google.
// ─────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { VARIABLES, variableCanonique } from "../src/services/catalogueVariables.js";
import { NOMS_RESOLUS, resoudreCanoniques } from "../src/services/resolversCanoniques.js";

// Les 13 variables volontairement réservées à un futur bloc répétable.
const RESERVEES_BLOC = [
  "evaluation_id", "evaluation_date", "evaluation_intitule", "evaluation_score_obtenu",
  "evaluation_score_max", "evaluation_pourcentage",
  "intervenant_id", "intervenant_nom", "intervenant_prenom", "intervenant_fonction",
  "intervenant_nom_complet", "intervenant_civilite", "intervenant_email",
];
// Non résolues pour une raison documentée (autorisation, ambiguïté, absence de formule,
// ou — session_libelle — deux concepts canoniques distincts que Vigie ne modélise pas
// séparément : pas d'approximation entre eux).
const NON_RESOLUES_PAR_DECISION = [
  "stagiaire_amenagements", "relance_derniere_action",
  "groupe_code", "session_libelle",
];

// Contexte complet, représentatif de ce que documents.js assemble réellement.
const CTX = {
  organisme: "A2C",
  organismeParams: { nom: "Association Test", adresse_ligne1: "1 rue Exemple", adresse_ligne2: "Cité Test", code_postal: "97300",
    ville: "Cayenne", telephone: "0594000000", mobile: "0694000000", email: "contact@exemple.fr" },
  signataire: { nom: "Marie Exemple", fonction: "Présidente" },
  formation: { id: 7, intitule: "Aide à domicile", code_interne: "ADVF" },
  version: { objectifs_operationnels: ["Utiliser un ordinateur", "Naviguer sur Internet"], methodes_pedagogiques: "Ateliers pratiques", modalites_evaluation: "Exercices et quiz",
    duree_heures_defaut: 400, public_vise: "Demandeurs d'emploi", prerequis: "Aucun",
    objectifs: "Accompagner vers l'emploi", modalite: "presentiel", accessibilite_handicap: "Locaux accessibles" },
  session: { id: 1, reference: "ADVF-2026-01", date_debut: "2026-01-05", date_fin: "2026-03-05",
    horaire: "8h30–12h00", lieu: "Cayenne", duree_heures_reelle: 380, statut: "en_cours",
    nombre_inscrits: 12, nombre_termines: 3 },
  groupe: { id: 5, nom: "Groupe A" },
  stagiaire: { id: 42, civilite: "Mme", nom: "Stark", prenom: "Blandine", email: "b@exemple.fr",
    telephone: "0600000000", financeur: "Région Fictive", besoins_adaptation: "Poste adapté", situation_handicap: true,
    besoin_date_recueil: "2026-01-03", besoin_attentes: "Apprendre à utiliser la messagerie", besoin_objectifs_personnels: "Être autonome",
    besoin_prerequis_verifies: "partiel", besoin_conclusion: "parcours_adapte", date_inscription: "2026-01-02", statut: "inscrit", groupe_nom: "Groupe A",
    prescripteur_nom: "Pôle Emploi", date_abandon: null, motif_abandon: null,
    relance_derniere_date: "2026-01-10", heures_absence: 3.5,
    date_naissance: "1980-06-15", adresse: "3 rue Test", code_postal: "97300", ville: "Cayenne", profession: "Aide-soignante",
    niveau_positionnement: "debutant", domaines_handicap: ["moteur", "visuel"], entreprise: "Société Fictive", entreprise_adresse: "5 avenue Test",
    entreprise_siret: "123 456 789 00010", entreprise_ape: "8899B", entreprise_effectifs: "12", entreprise_responsable: "Paul Exemple", entreprise_opca: "OPCO Fictif",
    prescripteur_adresse: "9 place Test", prescripteur_contact_nom: "Anne Contact", prescripteur_contact_fonction: "Conseillère", prescripteur_contact_email: "a@pe.test", prescripteur_contact_telephone: "0594111111" },
  indicateurs: { taux_satisfaction: 80, repondants: 5, niveaux: { 5: 1, 4: 3, 3: 1, 2: 0, 1: 0 }, taux_assiduite: 97, taux_absence: 3, taux_abandon: 10, abandons: 1,
    motifs: { personnel: 1, professionnel: 0, financement: 0, reorientation: 0, sans_nouvelles: 0, autre: 0 }, taux_atteinte: 100, reussites: 4, echecs: 0,
    prescripteurs: { pole_emploi: 2, mission_locale: 1, of: 0, autres: 1 } },
  assiduite: { heures_prevues: 380, heures_suivies: 376.5, heures_absence: 3.5, taux: 99, fiable: true },
  maintenant: new Date("2026-02-01T10:00:00Z"),
};
const canoniques = resoudreCanoniques(CTX);
const vide = resoudreCanoniques({});

test("invariant : exactement 202 clés, pilotées par le catalogue, aucune en trop", () => {
  assert.equal(VARIABLES.length, 202, "source de vérité du catalogue");
  assert.equal(Object.keys(canoniques).length, 202);
  assert.equal(Object.keys(vide).length, 202, "même nombre de clés quel que soit ctx");
  for (const nom of Object.keys(canoniques)) assert.ok(variableCanonique(nom), `${nom} doit exister dans VARIABLES`);
  assert.deepEqual(Object.keys(canoniques).sort(), VARIABLES.map((v) => v.nom).sort());
});

test("invariant : aucun resolver ne cible un nom absent du catalogue", () => {
  for (const nom of NOMS_RESOLUS) assert.ok(variableCanonique(nom), `${nom} doit être une variable canonique`);
});

test("110 variables réellement supportées, ni plus ni moins", () => {
  assert.equal(NOMS_RESOLUS.length, 110, "66 (v1.7) + 15 fiche stagiaire/entreprise + 5 prescripteur + 24 indicateurs de session");
  assert.equal(new Set(NOMS_RESOLUS).size, 110, "aucun doublon");
  assert.ok(!NOMS_RESOLUS.includes("session_libelle"), "distinct de session_reference, non résolu");
});

test("toute variable du catalogue reçoit exactement un résultat à trois statuts possibles", () => {
  for (const r of Object.values(canoniques)) {
    assert.ok(["resolu", "absent", "non_resoluble"].includes(r.statut), JSON.stringify(r));
    assert.ok(Object.prototype.hasOwnProperty.call(r, "valeur"));
  }
});

test("les 110 variables supportées sont résolues depuis un contexte complet", () => {
  const attendu = {
    organisme_nom: "Association Test", organisme_adresse_ligne1: "1 rue Exemple", organisme_adresse_ligne2: "Cité Test",
    organisme_code_postal: "97300", organisme_ville: "Cayenne", organisme_telephone: "0594000000", organisme_mobile: "0694000000",
    organisme_email: "contact@exemple.fr", signataire_nom: "Marie Exemple", signataire_fonction: "Présidente",
    formation_objectifs_operationnels: "Utiliser un ordinateur\nNaviguer sur Internet", formation_methodes_pedagogiques: "Ateliers pratiques",
    formation_modalites_evaluation: "Exercices et quiz", financeur_nom: "Région Fictive",
    stagiaire_besoins_specifiques: "Poste adapté", stagiaire_situation_handicap: "Oui",
    besoin_date_recueil: "03/01/2026", besoin_attentes: "Apprendre à utiliser la messagerie", besoin_objectifs_personnels: "Être autonome",
    besoin_prerequis_verifies: "Partiellement", besoin_conclusion: "Parcours adapté",
    formation_id: 7, formation_intitule: "Aide à domicile", formation_code: "ADVF",
    formation_duree_heures: 400, formation_public_vise: "Demandeurs d'emploi", formation_prerequis: "Aucun",
    formation_objectif_general: "Accompagner vers l'emploi", formation_modalite: "Présentiel",
    formation_accessibilite: "Locaux accessibles",
    session_id: 1, session_date_debut: "05/01/2026", session_date_fin: "05/03/2026",
    session_horaires: "8h30–12h00", session_lieu: "Cayenne", session_duree_heures: 380, session_statut_code: "en_cours",
    session_reference: "ADVF-2026-01", session_nombre_inscrits: 12, session_nombre_termines: 3,
    groupe_id: 5, groupe_nom: "Groupe A",
    stagiaire_id: 42, stagiaire_civilite: "Mme", stagiaire_nom: "Stark", stagiaire_prenom: "Blandine",
    stagiaire_nom_complet: "Blandine Stark", stagiaire_email: "b@exemple.fr", stagiaire_telephone: "0600000000",
    stagiaire_date_inscription: "02/01/2026", stagiaire_statut_parcours: "inscrit", stagiaire_groupe_nom: "Groupe A",
    abandon_statut: false, presence_heures_prevues: 380, presence_heures_realisees: 376.5,
    absence_heures_total: 3.5, presence_taux: 99, absence_taux: 1, relance_derniere_date: "10/01/2026",
    prescripteur_nom: "Pôle Emploi",
    document_date: "01/02/2026", document_date_convocation: "01/02/2026", document_date_attestation: "05/03/2026",
    document_duree_attestation: "380 h",
    stagiaire_date_naissance: "15/06/1980", stagiaire_age: 45, stagiaire_adresse: "3 rue Test", stagiaire_code_postal: "97300", stagiaire_ville: "Cayenne",
    stagiaire_profession: "Aide-soignante", stagiaire_niveau_positionnement: "Débutant", stagiaire_domaines_handicap: "Moteur, Visuel",
    stagiaire_entreprise_nom: "Société Fictive", stagiaire_entreprise_adresse: "5 avenue Test", stagiaire_entreprise_siret: "123 456 789 00010",
    stagiaire_entreprise_ape: "8899B", stagiaire_entreprise_effectifs: "12", stagiaire_entreprise_responsable: "Paul Exemple", stagiaire_entreprise_opca: "OPCO Fictif",
    prescripteur_adresse: "9 place Test", prescripteur_contact_nom: "Anne Contact", prescripteur_contact_fonction: "Conseillère", prescripteur_email: "a@pe.test", prescripteur_telephone: "0594111111",
    indicateur_taux_satisfaction: 80, indicateur_taux_assiduite: 97, indicateur_taux_absence: 3, indicateur_taux_abandon: 10, indicateur_taux_atteinte_objectifs: 100,
    indicateur_nombre_repondants_satisfaction: 5, indicateur_satisfaction_tres_satisfaits: 1, indicateur_satisfaction_satisfaits: 3, indicateur_satisfaction_neutres: 1,
    indicateur_satisfaction_peu_satisfaits: 0, indicateur_satisfaction_pas_du_tout_satisfaits: 0, indicateur_nombre_reussites: 4, indicateur_nombre_echecs: 0, indicateur_nombre_abandons: 1,
    indicateur_abandons_personnel: 1, indicateur_abandons_professionnel: 0, indicateur_abandons_financement: 0, indicateur_abandons_reorientation: 0, indicateur_abandons_sans_nouvelles: 0, indicateur_abandons_autre: 0,
    indicateur_inscrits_pole_emploi: 2, indicateur_inscrits_mission_locale: 1, indicateur_inscrits_organisme_formation: 0, indicateur_inscrits_autres_prescripteurs: 1,
  };
  for (const [nom, valeur] of Object.entries(attendu)) {
    assert.deepEqual(canoniques[nom], { statut: "resolu", valeur }, nom);
  }
  // abandon_date/abandon_motif : pas d'abandon dans ce jeu → absent, pas une valeur inventée.
  assert.deepEqual(canoniques.abandon_date, { statut: "absent", valeur: null });
  assert.deepEqual(canoniques.abandon_motif, { statut: "absent", valeur: null });
  // Les attendus + les 2 abandon_* couverts = 110 clés distinctes vérifiées.
  assert.equal(new Set([...Object.keys(attendu), "abandon_date", "abandon_motif"]).size, 110);
});

test("v1.2 : session_statut_code résolue (valeur brute), session_statut hors canonique", () => {
  assert.deepEqual(canoniques.session_statut_code, { statut: "resolu", valeur: "en_cours" });
  assert.ok(!Object.hasOwn(canoniques, "session_statut"), "l'ancien nom n'est plus une clé canonique");
});

test("DOC-3D : seules trois variables résolues sont restreintes, et le précontrôle les réserve aux administrateurs", () => {
  const restreintes = NOMS_RESOLUS.filter((nom) => variableCanonique(nom).sensibilite === "restreinte").sort();
  assert.deepEqual(restreintes, ["stagiaire_besoins_specifiques", "stagiaire_domaines_handicap", "stagiaire_situation_handicap"]);
});

test("0 et false sont des valeurs RÉSOLUES valides, jamais confondues avec absent", () => {
  const ctxZero = { ...CTX, session: { ...CTX.session, nombre_inscrits: 0, nombre_termines: 0 },
    assiduite: { ...CTX.assiduite, taux: 0 }, stagiaire: { ...CTX.stagiaire, statut: "inscrit" } };
  const r = resoudreCanoniques(ctxZero);
  assert.deepEqual(r.session_nombre_inscrits, { statut: "resolu", valeur: 0 });
  assert.deepEqual(r.session_nombre_termines, { statut: "resolu", valeur: 0 });
  assert.deepEqual(r.presence_taux, { statut: "resolu", valeur: 0 });
  assert.deepEqual(r.absence_taux, { statut: "resolu", valeur: 100 });
  assert.deepEqual(r.abandon_statut, { statut: "resolu", valeur: false });
});

test("champ NULL/vide pour cette instance ⇒ « absent », jamais une chaîne vide aplatie en silence", () => {
  const ctxVide = { ...CTX, stagiaire: { ...CTX.stagiaire, email: null, telephone: "" }, groupe: null };
  const r = resoudreCanoniques(ctxVide);
  assert.deepEqual(r.stagiaire_email, { statut: "absent", valeur: null });
  assert.deepEqual(r.stagiaire_telephone, { statut: "absent", valeur: null });
  assert.deepEqual(r.groupe_id, { statut: "absent", valeur: null });
  assert.deepEqual(r.groupe_nom, { statut: "absent", valeur: null });
  // Aucune de ces réponses n'est jamais `{ statut: "resolu", valeur: "" }`.
  for (const nom of ["stagiaire_email", "stagiaire_telephone", "groupe_id", "groupe_nom"]) {
    assert.notDeepEqual(r[nom], { statut: "resolu", valeur: "" });
  }
});

test("contexte vide : les 110 supportées sont « absent », les 92 autres « non_resoluble »", () => {
  for (const nom of NOMS_RESOLUS) assert.equal(vide[nom].statut, "absent", nom);
  for (const v of VARIABLES) {
    if (!NOMS_RESOLUS.includes(v.nom)) assert.equal(vide[v.nom].statut, "non_resoluble", v.nom);
  }
});

test("13 variables evaluation_*/intervenant_* réservées au futur bloc : toujours non_resoluble", () => {
  assert.equal(RESERVEES_BLOC.length, 13);
  for (const nom of RESERVEES_BLOC) {
    assert.equal(canoniques[nom].statut, "non_resoluble", nom);
    assert.ok(!NOMS_RESOLUS.includes(nom), `${nom} ne doit avoir aucun resolver scalaire`);
  }
});

test("variables non résolues par décision explicite (autorisation, ambiguïté, absence de formule)", () => {
  for (const nom of NON_RESOLUES_PAR_DECISION) {
    assert.equal(canoniques[nom].statut, "non_resoluble", nom);
    assert.ok(!NOMS_RESOLUS.includes(nom), nom);
  }
});

test("document_date et document_date_convocation partagent le même instant, calculé une seule fois", () => {
  assert.deepEqual(canoniques.document_date, canoniques.document_date_convocation);
  const autreInstant = resoudreCanoniques({ ...CTX, maintenant: new Date("2026-05-20T08:00:00Z") });
  assert.equal(autreInstant.document_date.valeur, "20/05/2026");
  assert.equal(autreInstant.document_date_convocation.valeur, "20/05/2026");
  assert.notEqual(autreInstant.document_date.valeur, canoniques.document_date.valeur);
});

test("document_date_attestation = session_date_fin (règle de compatibilité provisoire)", () => {
  assert.equal(canoniques.document_date_attestation.valeur, canoniques.session_date_fin.valeur);
  assert.equal(canoniques.document_date_attestation.valeur, "05/03/2026");
});

test("organisme : le nom retombe sur la configuration tant que les paramètres ne sont pas saisis", () => {
  const r = resoudreCanoniques({ organisme: "A2C", organismeParams: {} });
  assert.deepEqual(r.organisme_nom, { statut: "resolu", valeur: "A2C" });
  assert.equal(r.organisme_ville.statut, "absent");
  assert.deepEqual(resoudreCanoniques({ organisme: "A2C", organismeParams: { nom: "Association Test" } }).organisme_nom, { statut: "resolu", valeur: "Association Test" });
});

test("signataire : absent sans signataire choisi, jamais une valeur inventée", () => {
  const r = resoudreCanoniques({ signataire: null });
  assert.deepEqual(r.signataire_nom, { statut: "absent", valeur: null });
  assert.deepEqual(r.signataire_fonction, { statut: "absent", valeur: null });
});

test("besoin : énumérations rendues par leur libellé, valeur inconnue = absent ; handicap Oui / Non", () => {
  const r = resoudreCanoniques({ stagiaire: { besoin_prerequis_verifies: "inconnu", besoin_conclusion: "reorientation", situation_handicap: false } });
  assert.deepEqual(r.besoin_prerequis_verifies, { statut: "absent", valeur: null });
  assert.deepEqual(r.besoin_conclusion, { statut: "resolu", valeur: "Réorientation" });
  assert.deepEqual(r.stagiaire_situation_handicap, { statut: "resolu", valeur: "Non" });
  assert.deepEqual(resoudreCanoniques({}).stagiaire_situation_handicap, { statut: "absent", valeur: null });
});

test("objectifs opérationnels : une ligne par objectif ; liste vide = absent", () => {
  assert.deepEqual(resoudreCanoniques({ version: { objectifs_operationnels: [] } }).formation_objectifs_operationnels, { statut: "absent", valeur: null });
  assert.equal(resoudreCanoniques({ version: { objectifs_operationnels: ["A", "B"] } }).formation_objectifs_operationnels.valeur, "A\nB");
});
