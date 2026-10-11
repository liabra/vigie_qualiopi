// ─────────────────────────────────────────────────────────────
//  DOC-3B — resoudreCanoniques(ctx) : 161 clés exactement, pilotées par le
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
  "stagiaire_besoins_specifiques", "stagiaire_amenagements", "relance_derniere_action",
  "indicateur_taux_assiduite", "indicateur_taux_abandon", "groupe_code", "session_libelle",
];

// Contexte complet, représentatif de ce que documents.js assemble réellement.
const CTX = {
  organisme: "A2C",
  formation: { id: 7, intitule: "Aide à domicile", code_interne: "ADVF" },
  version: { duree_heures_defaut: 400, public_vise: "Demandeurs d'emploi", prerequis: "Aucun",
    objectifs: "Accompagner vers l'emploi", modalite: "presentiel", accessibilite_handicap: "Locaux accessibles" },
  session: { id: 1, reference: "ADVF-2026-01", date_debut: "2026-01-05", date_fin: "2026-03-05",
    horaire: "8h30–12h00", lieu: "Cayenne", duree_heures_reelle: 380, statut: "en_cours",
    nombre_inscrits: 12, nombre_termines: 3 },
  groupe: { id: 5, nom: "Groupe A" },
  stagiaire: { id: 42, civilite: "Mme", nom: "Stark", prenom: "Blandine", email: "b@exemple.fr",
    telephone: "0600000000", date_inscription: "2026-01-02", statut: "inscrit", groupe_nom: "Groupe A",
    prescripteur_nom: "Pôle Emploi", date_abandon: null, motif_abandon: null,
    relance_derniere_date: "2026-01-10", heures_absence: 3.5 },
  assiduite: { heures_prevues: 380, heures_suivies: 376.5, heures_absence: 3.5, taux: 99, fiable: true },
  maintenant: new Date("2026-02-01T10:00:00Z"),
};
const canoniques = resoudreCanoniques(CTX);
const vide = resoudreCanoniques({});

test("invariant : exactement 161 clés, pilotées par le catalogue, aucune en trop", () => {
  assert.equal(VARIABLES.length, 161, "source de vérité du catalogue");
  assert.equal(Object.keys(canoniques).length, 161);
  assert.equal(Object.keys(vide).length, 161, "même nombre de clés quel que soit ctx");
  for (const nom of Object.keys(canoniques)) assert.ok(variableCanonique(nom), `${nom} doit exister dans VARIABLES`);
  assert.deepEqual(Object.keys(canoniques).sort(), VARIABLES.map((v) => v.nom).sort());
});

test("invariant : aucun resolver ne cible un nom absent du catalogue", () => {
  for (const nom of NOMS_RESOLUS) assert.ok(variableCanonique(nom), `${nom} doit être une variable canonique`);
});

test("45 variables réellement supportées, ni plus ni moins", () => {
  assert.equal(NOMS_RESOLUS.length, 45);
  assert.equal(new Set(NOMS_RESOLUS).size, 45, "aucun doublon");
  assert.ok(!NOMS_RESOLUS.includes("session_libelle"), "distinct de session_reference, non résolu");
});

test("toute variable du catalogue reçoit exactement un résultat à trois statuts possibles", () => {
  for (const r of Object.values(canoniques)) {
    assert.ok(["resolu", "absent", "non_resoluble"].includes(r.statut), JSON.stringify(r));
    assert.ok(Object.prototype.hasOwnProperty.call(r, "valeur"));
  }
});

test("les 45 variables supportées sont résolues depuis un contexte complet", () => {
  const attendu = {
    organisme_nom: "A2C", formation_id: 7, formation_intitule: "Aide à domicile", formation_code: "ADVF",
    formation_duree_heures: 400, formation_public_vise: "Demandeurs d'emploi", formation_prerequis: "Aucun",
    formation_objectif_general: "Accompagner vers l'emploi", formation_modalite: "presentiel",
    formation_accessibilite: "Locaux accessibles",
    session_id: 1, session_date_debut: "05/01/2026", session_date_fin: "05/03/2026",
    session_horaires: "8h30–12h00", session_lieu: "Cayenne", session_duree_heures: 380, session_statut: "en_cours",
    session_reference: "ADVF-2026-01", session_nombre_inscrits: 12, session_nombre_termines: 3,
    groupe_id: 5, groupe_nom: "Groupe A",
    stagiaire_id: 42, stagiaire_civilite: "Mme", stagiaire_nom: "Stark", stagiaire_prenom: "Blandine",
    stagiaire_nom_complet: "Blandine Stark", stagiaire_email: "b@exemple.fr", stagiaire_telephone: "0600000000",
    stagiaire_date_inscription: "02/01/2026", stagiaire_statut_parcours: "inscrit", stagiaire_groupe_nom: "Groupe A",
    abandon_statut: false, presence_heures_prevues: 380, presence_heures_realisees: 376.5,
    absence_heures_total: 3.5, presence_taux: 99, absence_taux: 1, relance_derniere_date: "10/01/2026",
    prescripteur_nom: "Pôle Emploi",
    document_date: "01/02/2026", document_date_convocation: "01/02/2026", document_date_attestation: "05/03/2026",
  };
  for (const [nom, valeur] of Object.entries(attendu)) {
    assert.deepEqual(canoniques[nom], { statut: "resolu", valeur }, nom);
  }
  // abandon_date/abandon_motif : pas d'abandon dans ce jeu → absent, pas une valeur inventée.
  assert.deepEqual(canoniques.abandon_date, { statut: "absent", valeur: null });
  assert.deepEqual(canoniques.abandon_motif, { statut: "absent", valeur: null });
  // Les 43 attendus + les 2 abandon_* couverts = 45 clés distinctes vérifiées.
  assert.equal(new Set([...Object.keys(attendu), "abandon_date", "abandon_motif"]).size, 45);
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

test("contexte vide : les 45 supportées sont « absent », les 116 autres « non_resoluble »", () => {
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
