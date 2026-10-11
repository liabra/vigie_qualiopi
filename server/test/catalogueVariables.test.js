// ─────────────────────────────────────────────────────────────
//  Catalogue canonique des variables (dictionnaire Vigie v1.2) et
//  validateur de modèles. Tests PURS : ni base, ni Google.
// ─────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALIAS, BLOCS, DICTIONNAIRE_VERSION, DOMAINES, FORMATS, HISTORIQUES, SENSIBILITES, TYPES, VARIABLES,
  blocCanonique, catalogue, champLocal, marqueurHistorique, resoudreAlias, variableCanonique,
} from "../src/services/catalogueVariables.js";
import { TAILLE_MAX_MODELE, analyserModele } from "../src/services/validationModeles.js";
import { MARQUEURS } from "../src/services/marqueurs.js";

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../db/migrations");
const codes = (r) => r.erreurs.map((e) => e.code);
const avert = (r) => r.avertissements.map((e) => e.code);

// ── Catalogue ────────────────────────────────────────────────

test("catalogue : noms canoniques et identifiants uniques, syntaxe {{nom}}", () => {
  assert.equal(DICTIONNAIRE_VERSION, "1.4");
  assert.equal(VARIABLES.length, 164, "162 variables de la 1.3 + seance_competences + seance_activites");
  const noms = VARIABLES.map((v) => v.nom);
  assert.equal(new Set(noms).size, noms.length, "noms canoniques uniques");
  const ids = VARIABLES.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length, "identifiants uniques");
  for (const v of VARIABLES) {
    assert.match(v.nom, /^[a-z][a-z0-9_]*$/, v.nom);
    assert.match(v.id, /^[A-Z]{3}-\d{2}$/, v.id);
    assert.equal(v.balise, `{{${v.nom}}}`);
    assert.ok(v.libelle && v.description, `libellé et description : ${v.nom}`);
    assert.ok(TYPES.includes(v.type) && v.type !== "bloc", `type : ${v.nom}`);
    assert.ok(v.format === null || Object.hasOwn(FORMATS, v.format), `format : ${v.nom}`);
    assert.ok(SENSIBILITES.includes(v.sensibilite), `sensibilité : ${v.nom}`);
    assert.ok(Object.hasOwn(DOMAINES, v.domaine), `domaine : ${v.nom}`);
    assert.ok(!Object.hasOwn(v, "obligatoire"), `aucune obligation dans le catalogue global : ${v.nom}`);
    if (v.valeurs) assert.equal(new Set(v.valeurs).size, v.valeurs.length);
    if (v.libelles) assert.deepEqual(Object.keys(v.libelles).sort(), [...v.valeurs].sort(), `libellés distincts des valeurs : ${v.nom}`);
  }
});

test("catalogue : données sensibles du dictionnaire marquées « restreinte »", () => {
  for (const n of ["stagiaire_besoins_specifiques", "stagiaire_amenagements", "satisfaction_commentaire"]) assert.equal(variableCanonique(n).sensibilite, "restreinte", n);
  assert.equal(blocCanonique("adaptations").sensibilite, "restreinte");
  assert.ok(blocCanonique("adaptations").champs.every((c) => c.sensibilite === "restreinte"));
  assert.equal(variableCanonique("stagiaire_prenom").sensibilite, "personnelle");
  assert.equal(variableCanonique("formation_intitule").sensibilite, "aucune");
});

test("catalogue : session_reference ajoutée en 1.1, statuts alignés sur le schéma Vigie", () => {
  const ref = variableCanonique("session_reference");
  assert.equal(ref.id, "SES-12");
  assert.equal(ref.depuis, "1.1");
  const schema = fs.readFileSync(path.join(MIGRATIONS, "001_schema_initial.sql"), "utf8");
  const check = (avant) => {
    const m = new RegExp(avant + "[\\s\\S]*?CHECK \\(statut IN \\(([^)]*)\\)\\)").exec(schema);
    return m[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  };
  assert.deepEqual([...variableCanonique("session_statut_code").valeurs], check("CREATE TABLE sessions"));
  assert.deepEqual([...variableCanonique("stagiaire_statut_parcours").valeurs], check("CREATE TABLE inscriptions"));
  assert.equal(variableCanonique("session_statut_code").libelles.terminee, "Terminée", "libellé de rendu séparé de la valeur métier");
  assert.ok(!variableCanonique("session_statut_code").valeurs.includes("prevue"));
});

test("catalogue : session_statut renommée session_statut_code en 1.2, non silencieux, historique compatible", () => {
  assert.equal(variableCanonique("session_statut"), null, "l'ancien nom n'est plus une variable canonique");
  const code = variableCanonique("session_statut_code");
  assert.equal(code.id, "SES-09");
  assert.equal(code.renomme_depuis, "session_statut", "renommage non silencieux, traçable");
  assert.equal(code.depuis, "1.2");
  assert.deepEqual([...code.valeurs], ["planifiee", "en_cours", "terminee", "annulee"]);
  // Le marqueur historique session_statut reste reconnu, jamais un alias du code.
  assert.equal(resoudreAlias("session_statut"), null, "pas un alias : rendu non équivalent");
  const h = marqueurHistorique("session_statut");
  assert.ok(h);
  assert.deepEqual(h.cibles_possibles, ["session_statut_code"]);
  // Le validateur classe correctement les deux écritures.
  const r = analyserModele("{{session_statut}} {{session_statut_code}}");
  assert.equal(r.valide, true, JSON.stringify(r.erreurs));
  assert.deepEqual(r.resume.historiques, ["session_statut"]);
  assert.deepEqual(r.resume.canoniques, ["session_statut_code"]);
});

test("catalogue : document_duree_attestation ajoutée en 1.3, non sensible, texte", () => {
  const v = variableCanonique("document_duree_attestation");
  assert.equal(v.id, "DOC-10");
  assert.equal(v.depuis, "1.3");
  assert.equal(v.type, "texte");
  assert.equal(v.sensibilite, "aucune");
  assert.equal(v.calcule, true);
});

test("catalogue : figé, aucune modification à chaud", () => {
  assert.throws(() => { VARIABLES[0].nom = "autre"; }, TypeError);
  assert.throws(() => { VARIABLES.push({}); }, TypeError);
  assert.throws(() => { ALIAS.nom_stagiaire = "stagiaire_prenom"; }, TypeError);
  assert.throws(() => { variableCanonique("session_statut_code").valeurs.push("x"); }, TypeError);
  assert.throws(() => { BLOCS[0].champs.push({ variable: "x" }); }, TypeError);
  assert.throws(() => { HISTORIQUES.lieu.cibles_possibles.push("x"); }, TypeError);
});

test("blocs : 10 blocs, schéma de champs complet, champs locaux distincts des noms globaux", () => {
  assert.deepEqual(BLOCS.map((b) => b.nom), ["phases", "objectifs_formation", "objectifs_phase", "seances", "evaluations", "absences", "adaptations", "immersions", "intervenants", "suivi_pedagogique"]);
  assert.ok(!blocCanonique("resultats"), "pas de bloc resultats : evaluations le couvre");
  for (const b of BLOCS) {
    assert.ok(!variableCanonique(b.nom) && !resoudreAlias(b.nom) && !Object.hasOwn(HISTORIQUES, b.nom), `nom de bloc libre : ${b.nom}`);
    assert.equal(b.ouverture, `{{#${b.nom}}}`);
    assert.ok(b.champs.length > 0);
    for (const c of b.champs) {
      if (c.variable) { assert.ok(variableCanonique(c.variable), `${b.nom} → ${c.variable} existe`); continue; }
      assert.ok(c.local && c.nom && c.description && TYPES.includes(c.type) && SENSIBILITES.includes(c.sensibilite), `${b.nom}.${c.nom}`);
      assert.ok(!variableCanonique(c.nom) && !resoudreAlias(c.nom) && !Object.hasOwn(HISTORIQUES, c.nom), `champ local hors du global : ${c.nom}`);
    }
  }
  for (const n of ["objectif_code", "objectif_libelle"]) assert.ok(champLocal("objectifs_phase", n) && champLocal("objectifs_formation", n));
  assert.ok(champLocal("objectifs_phase", "critere_reussite") && !champLocal("objectifs_formation", "critere_reussite"));
  for (const n of ["absence_motif", "absence_justification"]) assert.ok(champLocal("absences", n));
});

// ── Alias et marqueurs historiques ───────────────────────────

test("alias : jamais canoniques, toujours vers une variable canonique ; résolution", () => {
  for (const [alias, cible] of Object.entries(ALIAS)) {
    assert.ok(!variableCanonique(alias), `${alias} n'est pas canonique`);
    assert.ok(variableCanonique(cible), `${alias} → ${cible} canonique`);
    assert.ok(!Object.hasOwn(HISTORIQUES, alias));
  }
  assert.equal(resoudreAlias("prenom_stagiaire"), "stagiaire_prenom");
  assert.equal(resoudreAlias("intitule_formation"), "formation_intitule");
  assert.equal(resoudreAlias("stagiaire_prenom"), null, "un nom canonique n'est pas un alias");
  assert.equal(resoudreAlias("toString"), null, "pas de résolution via le prototype");
  for (const n of ["lieu", "formateur", "entreprise", "duree", "date_attestation"]) assert.equal(resoudreAlias(n), null, `${n} n'est pas aliasé`);
});

test("non-régression : les 23 marqueurs actuels sont tous reconnus, un modèle actuel reste valide", () => {
  assert.equal(MARQUEURS.length, 23);
  for (const m of MARQUEURS) assert.ok(variableCanonique(m) || resoudreAlias(m) || Object.hasOwn(HISTORIQUES, m), `${m} reconnu`);
  // date_convocation est un HISTORIQUE, mais hors des 23 marqueurs du moteur
  // (marqueurs.js ne le résout pas) : exclu de cette comparaison stricte.
  const historiquesDuMoteur = Object.keys(HISTORIQUES).filter((h) => MARQUEURS.includes(h));
  const couverts = [...Object.keys(ALIAS), ...historiquesDuMoteur, ...MARQUEURS.filter((m) => variableCanonique(m))];
  assert.deepEqual(couverts.sort(), [...MARQUEURS].sort(), "aucun alias/historique du moteur hors des marqueurs actuels");
  assert.ok(!MARQUEURS.includes("date_convocation"), "date_convocation n'est pas un marqueur résolu par le moteur actuel");
  const r = analyserModele(MARQUEURS.map((m) => `{{${m}}}`).join(" "));
  assert.equal(r.valide, true, JSON.stringify(r.erreurs));
  assert.deepEqual(r.resume.canoniques.sort(), ["session_reference"]);
  assert.equal(r.resume.alias.length, 11);
  assert.equal(r.resume.historiques.length, 11);
});

test("validateur : modèle Drive réel de convocation (date_convocation), hors des 23 marqueurs du moteur, reconnu et valide", () => {
  const r = analyserModele("{{intitule_formation}} {{civilite}} {{prenom_stagiaire}} {{nom_stagiaire}} {{date_convocation}} {{date_debut}} {{date_fin}} {{horaire}}");
  assert.equal(r.valide, true, JSON.stringify(r.erreurs));
  assert.deepEqual(r.erreurs, []);
  assert.ok(r.resume.historiques.includes("date_convocation"));
  const av = r.avertissements.find((a) => a.balise === "{{date_convocation}}");
  assert.equal(av.code, "HISTORIQUE");
  assert.match(av.message, /document_date_convocation/);
  assert.match(av.message, /à migrer/);
  // La cible est document_date_convocation, jamais document_date (génération technique).
  const cible = marqueurHistorique("date_convocation");
  assert.deepEqual(cible.cibles_possibles, ["document_date_convocation"]);
});

test("évaluations : moment, méthode, résultat de validation et niveau pédagogique distincts", () => {
  assert.equal(variableCanonique("evaluation_type"), null, "ancien nom retiré du catalogue");
  const methode = variableCanonique("evaluation_methode");
  assert.equal(methode.id, "EVA-03");
  assert.equal(methode.renomme_depuis, "evaluation_type", "renommage non silencieux, traçable");
  assert.deepEqual([...methode.valeurs], ["qcm", "quiz", "mise_en_situation", "entretien", "autoevaluation", "autre"]);

  const moment = variableCanonique("evaluation_moment");
  assert.equal(moment.id, "EVA-11");
  assert.equal(moment.depuis, "1.1");
  assert.deepEqual([...moment.valeurs], ["positionnement", "intermediaire", "finale", "autre"]);

  const resultat = variableCanonique("evaluation_resultat_validation");
  assert.equal(resultat.id, "EVA-12");
  assert.equal(resultat.depuis, "1.1");
  assert.deepEqual([...resultat.valeurs], ["valide", "non_valide"]);

  // Aucun resolver n'existe pour ces deux notions : aucune donnée stockée revendiquée.
  for (const v of [moment, resultat]) assert.match(v.description, /[Aa]ucun resolver Vigie actuel/);

  // Pas de mapping artificiel vers resultats_qcm.type / resultats_qcm.resultat.
  assert.doesNotMatch(moment.description, /resultats_qcm/);
  assert.doesNotMatch(resultat.description, /resultats_qcm/);

  // niveau pédagogique (evaluation_niveau / phase_resultat_niveau) distinct du résultat de validation.
  assert.match(variableCanonique("evaluation_niveau").description, /résultat de validation/);
  assert.match(variableCanonique("phase_resultat_niveau").description, /evaluation_niveau/);

  // Bloc evaluations : tous les champs clarifiés sont présents.
  const champsEval = blocCanonique("evaluations").champs.map((c) => c.variable);
  for (const n of ["evaluation_moment", "evaluation_methode", "evaluation_resultat_validation", "evaluation_niveau"]) assert.ok(champsEval.includes(n), n);
  assert.ok(!champsEval.includes("evaluation_type"));
});

test("validateur : alias accepté avec avertissement et nom canonique proposé", () => {
  const r = analyserModele("Bonjour {{civilite}} {{nom_stagiaire}}");
  assert.equal(r.valide, true);
  assert.deepEqual(r.resume.alias, [{ alias: "civilite", canonique: "stagiaire_civilite" }, { alias: "nom_stagiaire", canonique: "stagiaire_nom" }]);
  assert.deepEqual(avert(r), ["ALIAS", "ALIAS"]);
  assert.match(r.avertissements[1].message, /\{\{stagiaire_nom\}\}/);
});

test("validateur : marqueur historique (lieu, formateur, entreprise) reconnu, valide, à migrer", () => {
  const r = analyserModele("Lieu : {{lieu}} — {{formateur}} — {{entreprise}}");
  assert.equal(r.valide, true);
  assert.deepEqual(r.resume.historiques, ["lieu", "formateur", "entreprise"]);
  assert.deepEqual(avert(r), ["HISTORIQUE", "HISTORIQUE", "HISTORIQUE"]);
  assert.match(r.avertissements[0].message, /à migrer/);
  assert.match(r.avertissements[0].message, /session_lieu/);
});

// ── Validateur : cas nominaux et erreurs ─────────────────────

test("validateur : modèle de convocation canonique valide, sans avertissement", () => {
  const r = analyserModele("{{formation_intitule}}\n{{stagiaire_civilite}} {{stagiaire_prenom}} {{stagiaire_nom}}\nLe {{document_date_convocation}}, du {{session_date_debut}} au {{session_date_fin}} ({{session_horaires}}) à {{session_lieu}}.");
  assert.equal(r.valide, true);
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.avertissements, []);
  assert.equal(r.resume.canoniques.length, 9);
  assert.equal(r.version, "1.4");
});

test("validateur : variable inconnue rejetée explicitement", () => {
  const r = analyserModele("Bonjour {{stagiaire_prenom}} {{note_phase1}} {{constructor}}");
  assert.equal(r.valide, false);
  assert.deepEqual(codes(r), ["VARIABLE_INCONNUE", "VARIABLE_INCONNUE"]);
  assert.deepEqual(r.resume.inconnues, ["note_phase1", "constructor"]);
  assert.match(r.erreurs[0].message, /\{\{note_phase1\}\}/);
  assert.equal(r.erreurs[0].position, 29);
});

test("validateur : placeholders syntaxiquement invalides détectés", () => {
  for (const t of ["{{ stagiaire_nom }}", "{{Stagiaire_Nom}}", "{{stagiaire-nom}}", "{{prénom}}", "{{}}", "{{#}}", "{{{stagiaire_nom}}}"]) {
    const r = analyserModele(t);
    assert.equal(r.valide, false, t);
    assert.ok(codes(r).includes("SYNTAXE_INVALIDE"), t);
  }
  assert.match(analyserModele("{{ stagiaire_nom }}").erreurs[0].message, /\{\{stagiaire_nom\}\}/, "suggestion du nom correct");
  const ouverte = analyserModele("Bonjour {{stagiaire_nom");
  assert.deepEqual(codes(ouverte), ["BALISE_NON_FERMEE"]);
  assert.deepEqual(avert(analyserModele("Bonjour stagiaire_nom}}")), ["ACCOLADES_ORPHELINES"]);
  assert.equal(analyserModele("Aucun marqueur ici.").valide, true);
});

test("confidentialité : une balise invalide porteuse de texte libre ne renvoie ni ne journalise ce texte", () => {
  const SECRET = "SECRET_CONFIDENTIEL_123";
  const r = analyserModele(`Bonjour {{nom invalide ${SECRET}}} {{stagiaire_prenom}}`);
  assert.equal(r.valide, false);
  assert.equal(r.erreurs.length, 1);
  assert.equal(r.erreurs[0].code, "SYNTAXE_INVALIDE");
  const serialise = JSON.stringify(r);
  assert.ok(!serialise.includes(SECRET), "le secret ne doit apparaître nulle part dans le résultat sérialisé");
  assert.ok(!serialise.includes("nom invalide"), "aucun fragment du texte libre ne doit être renvoyé");
  assert.equal(r.erreurs[0].balise, "{{…}}", "la balise invalide est masquée");
  assert.equal(r.balises.find((b) => b.statut === "invalide").brut, "{{…}}");
  // Le reste de l'analyse continue de fonctionner normalement.
  assert.deepEqual(r.resume.canoniques, ["stagiaire_prenom"]);
});

test("confidentialité : un espacement/une casse incidents autour d'un identifiant sûr restent affichables (reconstruits, jamais recopiés)", () => {
  const r = analyserModele("{{ STAGIAIRE_nom  }}");
  assert.equal(r.erreurs[0].code, "SYNTAXE_INVALIDE");
  assert.equal(r.erreurs[0].balise, "{{stagiaire_nom}}", "reconstruit depuis le nom normalisé, pas recopié tel quel");
  assert.match(r.erreurs[0].message, /\{\{stagiaire_nom\}\}/);
});

test("validateur : blocs répétables, champs canoniques et locaux, imbrication", () => {
  const r = analyserModele("{{formation_intitule}}{{#phases}}Phase {{phase_numero}} : {{phase_intitule}} ({{phase_duree_heures}})"
    + "{{#objectifs_phase}}- {{objectif_code}} {{objectif_libelle}} / {{critere_reussite}}{{/objectifs_phase}}{{/phases}}");
  assert.equal(r.valide, true, JSON.stringify(r.erreurs));
  assert.deepEqual(r.resume.blocs, ["phases", "objectifs_phase"]);
  // DOC-6B : les REF (variables canoniques de bloc) placés dans leur bloc
  // deviennent des champs de bloc, comme les champs locaux.
  assert.deepEqual(r.resume.champs_bloc, ["phase_numero", "phase_intitule", "phase_duree_heures", "objectif_code", "objectif_libelle", "critere_reussite"]);
  assert.equal(r.balises.find((b) => b.nom === "critere_reussite").bloc, "objectifs_phase");
  // Variable canonique de phase hors bloc : valide (séquence générée par phase).
  assert.equal(analyserModele("Phase {{phase_numero}}").valide, true);
  // Absences avec leurs champs locaux.
  assert.equal(analyserModele("{{#absences}}{{absence_date}} {{absence_motif}} {{absence_justification}}{{/absences}}").valide, true);
});

test("validateur : erreurs de blocs (hors bloc, mauvais bloc, inconnu, non fermé, orphelin, croisé)", () => {
  assert.deepEqual(codes(analyserModele("{{objectif_code}}")), ["CHAMP_HORS_BLOC"]);
  assert.deepEqual(codes(analyserModele("{{#objectifs_formation}}{{critere_reussite}}{{/objectifs_formation}}")), ["CHAMP_HORS_BLOC"]);
  assert.deepEqual(codes(analyserModele("{{#phases}}{{absence_motif}}{{/phases}}")), ["CHAMP_HORS_BLOC"]);
  assert.deepEqual(codes(analyserModele("{{#resultats}}{{/resultats}}")), ["BLOC_INCONNU", "BLOC_INCONNU"]);
  assert.deepEqual(codes(analyserModele("{{#stagiaire_nom}}x{{/stagiaire_nom}}")), ["BLOC_INCONNU", "BLOC_INCONNU"]);
  assert.deepEqual(codes(analyserModele("{{#phases}}{{phase_numero}}")), ["BLOC_NON_FERME"]);
  assert.deepEqual(codes(analyserModele("{{/phases}}")), ["FERMETURE_ORPHELINE"]);
  assert.deepEqual(codes(analyserModele("{{#phases}}{{#seances}}{{/phases}}{{/seances}}")), ["FERMETURE_DISCORDANTE", "FERMETURE_ORPHELINE"]);
  assert.deepEqual(codes(analyserModele("{{#phases}}{{#phases}}{{/phases}}{{/phases}}")), ["BLOC_IMBRIQUE_SUR_LUI_MEME"]);
  assert.deepEqual(codes(analyserModele("{{phases}}")), ["BLOC_SANS_SYNTAXE"]);
});

test("validateur : données sensibles signalées, sans rendre le modèle invalide", () => {
  const r = analyserModele("{{stagiaire_besoins_specifiques}} {{#adaptations}}{{adaptation_mesure}}{{/adaptations}}");
  assert.equal(r.valide, true);
  assert.deepEqual(avert(r), ["DONNEE_SENSIBLE", "DONNEE_SENSIBLE", "DONNEE_SENSIBLE"]);
});

test("validateur : entrée non textuelle ou démesurée refusée, écho des balises tronqué", () => {
  assert.throws(() => analyserModele(null), TypeError);
  assert.throws(() => analyserModele({ toString: () => "{{x}}" }), TypeError);
  assert.throws(() => analyserModele("a".repeat(TAILLE_MAX_MODELE + 1)), RangeError);
  const r = analyserModele("{{" + "x".repeat(5000) + "}}");
  assert.ok(r.erreurs[0].balise.length <= 81);
});

test("catalogue() : vue publique cohérente, sans règle d'obligation", () => {
  const c = catalogue();
  assert.equal(c.version, "1.4");
  assert.equal(c.variables.length, VARIABLES.length);
  assert.equal(c.blocs.length, 10);
  assert.deepEqual(c.syntaxe, { variable: "{{nom_variable}}", bloc: "{{#bloc}} … {{/bloc}}" });
  assert.ok(!JSON.stringify(c).includes("\"obligatoire\""));
});
