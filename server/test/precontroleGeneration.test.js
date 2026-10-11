// ─────────────────────────────────────────────────────────────
//  DOC-3C — Précontrôle de génération (service pur, clients Google
//  simulés). « Ce modèle peut-il être généré, par cet utilisateur, avec
//  ces données, pour TOUTES les cibles ? » — avant tout effet de bord
//  Drive. Un seul drive.files.get, une seule lecture de contenu.
// ─────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CIBLES_LISTEES, precontrolerGeneration } from "../src/services/precontroleGeneration.js";
import { ALIAS, resoudreAlias, variableCanonique } from "../src/services/catalogueVariables.js";

const DOC = "application/vnd.google-apps.document";
const SHEET = "application/vnd.google-apps.spreadsheet";
const MODELE = { id: 1, nom: "Attestation", drive_file_id: "FICHIER" };
const docAvec = (corps) => ({ body: { content: [{ paragraph: { elements: [{ textRun: { content: corps } }] } }] }, headers: {}, footers: {} });

function fauxClients({ document = docAvec(""), mime = DOC, trashed = false, onglets = [] } = {}) {
  const appels = { driveGet: 0, docsGet: 0 };
  return {
    appels,
    drive: { files: { get: async () => { appels.driveGet++; return { data: { id: "FICHIER", mimeType: mime, trashed } }; } } },
    docs: { documents: { get: async () => { appels.docsGet++; return { data: document }; } } },
    sheets: { spreadsheets: {
      get: async () => ({ data: { sheets: onglets.map((o, i) => ({ properties: { title: o.titre, index: i, gridProperties: { rowCount: 10, columnCount: 10 } } })) } }),
      values: { get: async ({ range }) => { const o = onglets.find((x) => x.titre === range.slice(1, -1)); return { data: { values: o?.grille || [] } }; } },
    } },
  };
}

const CTX = {
  organisme: "A2C", formation: { id: 7, intitule: "Aide à domicile" },
  version: {}, session: { id: 1, reference: "ADVF-2026-01", date_debut: "2026-01-05", date_fin: "2026-03-05" },
  groupe: null, maintenant: new Date("2026-02-01T10:00:00Z"),
};
const cible = (id, extra = {}) => ({ stagiaire: { id, nom: "N" + id, prenom: "P", statut: "inscrit", ...extra } });

test("Convocation/Attestation historiques (alias + marqueurs) : autorisé, zéro erreur", async () => {
  const texte = "{{intitule_formation}} {{civilite}} {{prenom_stagiaire}} {{nom_stagiaire}} {{date_debut}} {{date_fin}} {{horaire}} {{duree}} {{lieu}}";
  const r = await precontrolerGeneration(MODELE, CTX, [cible(1)], { admin: false, clients: fauxClients({ document: docAvec(texte) }) });
  assert.equal(r.autorise, true, JSON.stringify(r.erreurs));
  assert.deepEqual(r.erreurs, []);
  assert.ok(r.avertissements.some((a) => a.code === "ALIAS"));
});

test("variable canonique résolue écrite directement : autorisée (DOC-3D), plus d'erreur temporaire", async () => {
  const r = await precontrolerGeneration(MODELE, CTX, [cible(1), cible(2)], { admin: true, clients: fauxClients({ document: docAvec("{{stagiaire_nom}}") }) });
  assert.equal(r.autorise, true, JSON.stringify(r.erreurs));
  assert.deepEqual(r.erreurs, []);
  assert.ok(!r.erreurs.some((e) => e.code === "CANONIQUE_GENERATION_NON_ACTIVEE"));
  assert.deepEqual(r.canoniques, ["stagiaire_nom"], "le précontrôle expose les canoniques à rendre");
});

test("session_reference écrit directement : canonique résolu, aucune erreur, jamais de doublon", async () => {
  const r = await precontrolerGeneration(MODELE, CTX, [cible(1)], { admin: true, clients: fauxClients({ document: docAvec("{{session_reference}}") }) });
  assert.equal(r.autorise, true, JSON.stringify(r.erreurs));
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.canoniques, ["session_reference"]);
});

test("variable canonique non_resoluble : erreur au niveau du MODÈLE, pas une boucle par cible", async () => {
  // evaluation_id : reconnue par le catalogue, aucun resolver (réservée au bloc).
  const r = await precontrolerGeneration(MODELE, CTX, [cible(1), cible(2), cible(3)], { admin: true, clients: fauxClients({ document: docAvec("{{evaluation_id}}") }) });
  assert.equal(r.autorise, false);
  const non_resolubles = r.erreurs.filter((e) => e.code === "CANONIQUE_NON_RESOLUBLE" && e.nom === "evaluation_id");
  assert.equal(non_resolubles.length, 1, "une seule erreur, jamais une par cible");
  assert.ok(!r.erreurs.some((e) => e.code === "CANONIQUE_GENERATION_NON_ACTIVEE"), "non_resoluble reste bloquant, distinct du cas résolu");
});

test("variable restreinte : contributeur refusé, avant toute résolution de cette variable", async () => {
  const r = await precontrolerGeneration(MODELE, CTX, [cible(1)], { admin: false, clients: fauxClients({ document: docAvec("{{stagiaire_besoins_specifiques}}") }) });
  assert.equal(r.autorise, false);
  assert.deepEqual(r.erreurs, [{ code: "VARIABLE_RESTREINTE_REFUSEE", nom: "stagiaire_besoins_specifiques", sensibilite: "restreinte", message: r.erreurs[0].message }]);
  // Contrôle d'accès, pas de calcul de résolution pour cette variable : jamais CANONIQUE_NON_RESOLUBLE en plus.
  assert.ok(!r.erreurs.some((e) => e.code === "CANONIQUE_NON_RESOLUBLE"));
});

test("variable restreinte : admin autorisé à tenter la résolution — ici non_resoluble (rien à protéger)", async () => {
  const r = await precontrolerGeneration(MODELE, CTX, [cible(1)], { admin: true, clients: fauxClients({ document: docAvec("{{stagiaire_besoins_specifiques}}") }) });
  assert.equal(r.autorise, false);
  assert.deepEqual(r.erreurs, [{ code: "CANONIQUE_NON_RESOLUBLE", nom: "stagiaire_besoins_specifiques", message: r.erreurs[0].message }]);
  assert.ok(!r.erreurs.some((e) => e.code === "VARIABLE_RESTREINTE_REFUSEE"));
});

test("alias vers une variable restreinte : la sécurité porte sur la cible, pas sur le nom écrit (règle 5)", async () => {
  // Aucun des 11 alias vérifiés ne cible aujourd'hui une variable restreinte
  // (vérifié ici) : le mécanisme est donc confirmé « jamais déclenché à
  // tort » avec les données réelles. Le même contrôle (variableCanonique(
  // cible).sensibilite) que pour l'usage canonique direct, déjà prouvé
  // bloquant ci-dessus, est appliqué à CHAQUE cible d'alias.
  for (const cible of Object.values(ALIAS)) assert.notEqual(variableCanonique(cible).sensibilite, "restreinte");
  const texte = Object.keys(ALIAS).map((a) => `{{${a}}}`).join(" ");
  const r = await precontrolerGeneration(MODELE, CTX, [{ stagiaire: { id: 1, nom: "N", prenom: "P", statut: "inscrit" } }], { admin: false, clients: fauxClients({ document: docAvec(texte) }) });
  assert.ok(!r.erreurs.some((e) => e.code === "VARIABLE_RESTREINTE_REFUSEE"));
  // Un alias n'est jamais soumis à CANONIQUE_NON_RESOLUBLE : il passe par le
  // mécanisme historique, déjà remplacé aujourd'hui.
  assert.ok(!r.erreurs.some((e) => e.code === "CANONIQUE_NON_RESOLUBLE"));
  assert.equal(r.autorise, true);
});

test("marqueur historique sans cible certaine : aucune sensibilité déduite", async () => {
  const r = await precontrolerGeneration(MODELE, CTX, [cible(1)], { admin: false, clients: fauxClients({ document: docAvec("{{date_convocation}} {{duree}}") }) });
  assert.equal(r.autorise, true);
  assert.ok(r.avertissements.some((a) => a.code === "HISTORIQUE" && a.nom === "date_convocation"));
  assert.ok(!r.erreurs.length);
});

test("bloc absences supporté (Doc, champs résolubles) : autorisé", async () => {
  const r = await precontrolerGeneration(MODELE, CTX, [cible(1)], { admin: true, clients: fauxClients({ document: docAvec("{{#absences}}{{absence_date}} — {{absence_duree_heures}}{{/absences}}") }) });
  assert.equal(r.autorise, true, JSON.stringify(r.erreurs));
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(r.blocs, ["absences"]);
});

test("champ de bloc non résoluble → précontrôle bloqué (absence_action)", async () => {
  const r = await precontrolerGeneration(MODELE, CTX, [cible(1)], { admin: true, clients: fauxClients({ document: docAvec("{{#absences}}{{absence_action}}{{/absences}}") }) });
  assert.equal(r.autorise, false);
  assert.ok(r.erreurs.some((e) => e.code === "BLOC_CHAMP_NON_RESOLUBLE" && e.bloc === "absences" && e.champ === "absence_action"));
});

test("bloc non supporté (seances) → BLOC_NON_SUPPORTE", async () => {
  const r = await precontrolerGeneration(MODELE, CTX, [cible(1)], { admin: true, clients: fauxClients({ document: docAvec("{{#seances}}{{seance_date}}{{/seances}}") }) });
  assert.equal(r.autorise, false);
  assert.ok(r.erreurs.some((e) => e.code === "BLOC_NON_SUPPORTE" && e.nom === "seances"));
});

test("bloc absences dans une Sheet → BLOC_STRUCTURE_NON_SUPPORTEE", async () => {
  const onglets = [{ titre: "Feuille 1", grille: [["{{#absences}}{{absence_date}}{{/absences}}"]] }];
  const r = await precontrolerGeneration(MODELE, CTX, [cible(1)], { admin: true, clients: fauxClients({ mime: SHEET, onglets }) });
  assert.equal(r.autorise, false);
  assert.ok(r.erreurs.some((e) => e.code === "BLOC_STRUCTURE_NON_SUPPORTEE" && e.nom === "absences"));
});

test("bloc inconnu → BLOC_INCONNU", async () => {
  const r = await precontrolerGeneration(MODELE, CTX, [cible(1)], { admin: true, clients: fauxClients({ document: docAvec("{{#inconnu}}{{x}}{{/inconnu}}") }) });
  assert.equal(r.autorise, false);
  assert.ok(r.erreurs.some((e) => e.code === "BLOC_INCONNU"));
});

test("bloc restreinte (adaptations) : contributeur refusé, admin bloqué (non supporté)", async () => {
  const texte = "{{#adaptations}}{{adaptation_mesure}}{{/adaptations}}";
  const rContrib = await precontrolerGeneration(MODELE, CTX, [cible(1)], { admin: false, clients: fauxClients({ document: docAvec(texte) }) });
  assert.ok(rContrib.erreurs.some((e) => e.code === "VARIABLE_RESTREINTE_REFUSEE" && e.nom === "adaptations"));

  const rAdmin = await precontrolerGeneration(MODELE, CTX, [cible(1)], { admin: true, clients: fauxClients({ document: docAvec(texte) }) });
  assert.ok(rAdmin.erreurs.some((e) => e.code === "BLOC_NON_SUPPORTE" && e.nom === "adaptations"));
  assert.ok(!rAdmin.erreurs.some((e) => e.code === "VARIABLE_RESTREINTE_REFUSEE"));
});

test("syntaxe invalide / variable inconnue : reprises telles quelles depuis analyserModele, bloquantes", async () => {
  const r1 = await precontrolerGeneration(MODELE, CTX, [cible(1)], { admin: true, clients: fauxClients({ document: docAvec("{{nom invalide}}") }) });
  assert.equal(r1.autorise, false);
  assert.ok(r1.erreurs.some((e) => e.code === "SYNTAXE_INVALIDE"));

  const r2 = await precontrolerGeneration(MODELE, CTX, [cible(1)], { admin: true, clients: fauxClients({ document: docAvec("{{note_phase1}}") }) });
  assert.equal(r2.autorise, false);
  assert.ok(r2.erreurs.some((e) => e.code === "VARIABLE_INCONNUE" && e.nom === "note_phase1"));
});

test("canonique absent : avertissement PAR CIBLE, jamais bloquant à lui seul, et borné (règle 7)", async () => {
  // 60 cibles sans prescripteur_nom (champ non renseigné) : avertissement
  // avec compteur exact, liste bornée à 50, troncature signalée.
  const cibles = Array.from({ length: 60 }, (_, i) => cible(i + 1, { prescripteur_nom: null }));
  const r = await precontrolerGeneration(MODELE, CTX, cibles, { admin: true, clients: fauxClients({ document: docAvec("{{prescripteur_nom}}") }) });
  const av = r.avertissements.find((a) => a.code === "CANONIQUE_ABSENT" && a.nom === "prescripteur_nom");
  assert.ok(av);
  assert.equal(av.nombre_cibles_concernees, 60);
  assert.equal(av.cibles_concernees.length, MAX_CIBLES_LISTEES);
  assert.equal(av.cibles_tronquees, true);
  // DOC-3D : « absent » n'est JAMAIS bloquant à lui seul — génération autorisée.
  assert.equal(r.autorise, true, JSON.stringify(r.erreurs));
  assert.ok(!r.erreurs.some((e) => e.code === "CANONIQUE_ABSENT"));
});

test("modèle à la corbeille : MODELE_CORBEILLE, bloquant, avant toute autre analyse", async () => {
  const r = await precontrolerGeneration(MODELE, CTX, [cible(1)], { admin: true, clients: fauxClients({ trashed: true, document: docAvec("{{stagiaire_nom}}") }) });
  assert.equal(r.autorise, false);
  assert.deepEqual(r.erreurs, [{ code: "MODELE_CORBEILLE", message: r.erreurs[0].message }]);
  assert.equal(r.avertissements.length, 0);
});

test("confidentialité : aucun texte libre du modèle ou des cibles dans le résultat", async () => {
  const SECRET = "SECRET_CONFIDENTIEL_XJ42";
  const cibles = [cible(1, { nom: "NomReel" + SECRET })];
  const r = await precontrolerGeneration(MODELE, CTX, cibles, { admin: true, clients: fauxClients({ document: docAvec(`Texte libre ${SECRET} {{stagiaire_nom}} {{inconnu}}`) }) });
  const serialise = JSON.stringify(r);
  assert.ok(!serialise.includes(SECRET));
  assert.ok(!serialise.includes("Texte libre"));
  assert.ok(!serialise.includes("NomReel"));
  assert.ok(serialise.includes("stagiaire_nom"));
});

test("Google Sheet : précontrôlé exactement comme un Doc, canoniques résolues autorisées", async () => {
  const onglets = [{ titre: "Feuille 1", grille: [["{{formation_intitule}}", "{{stagiaire_nom}}"]] }];
  const r = await precontrolerGeneration(MODELE, CTX, [cible(1)], { admin: false, clients: fauxClients({ mime: SHEET, onglets }) });
  assert.equal(r.type_fichier, "feuille_calcul");
  assert.equal(r.autorise, true, JSON.stringify(r.erreurs));
  assert.deepEqual(r.canoniques.sort(), ["formation_intitule", "stagiaire_nom"]);
});

test("une seule lecture Drive, quel que soit le nombre de cibles", async () => {
  const faux = fauxClients({ document: docAvec("{{stagiaire_nom}}") });
  await precontrolerGeneration(MODELE, CTX, [cible(1), cible(2), cible(3), cible(4), cible(5)], { admin: true, clients: faux });
  assert.equal(faux.appels.driveGet, 1);
  assert.equal(faux.appels.docsGet, 1);
});

test("règle 5 (mécanisme isolé) : la sensibilité d'un alias est lue sur sa CIBLE canonique, pas sur son nom", () => {
  // Aucun alias du catalogue ne cible aujourd'hui une variable restreinte
  // (vérifié par le test dédié ci-dessus). On vérifie ici le MÉCANISME de
  // résolution/sensibilité lui-même : le précontrôle lit
  // variableCanonique(cible).sensibilite, où `cible` est la cible canonique
  // de l'alias (diagnostic.alias[].canonique = resoudreAlias(alias)), jamais
  // le nom écrit dans le modèle.

  // La chaîne exacte : alias → cible canonique → sensibilité.
  const cibleEmail = resoudreAlias("email");
  assert.equal(cibleEmail, "stagiaire_email");
  assert.equal(variableCanonique(cibleEmail).sensibilite, "personnelle");

  // Le nom écrit de l'alias n'a AUCUNE sensibilité propre : un alias n'est
  // jamais canonique, sa sensibilité n'existe que via sa cible.
  assert.equal(variableCanonique("email"), null);

  // Si un alias ciblait une variable restreinte, la même lecture renverrait
  // « restreinte » — exactement la condition VARIABLE_RESTREINTE_REFUSEE du
  // précontrôle. Un alias ne peut donc pas contourner la politique : la
  // sécurité est évaluée APRÈS résolution de l'alias vers sa cible.
  assert.equal(variableCanonique("stagiaire_besoins_specifiques").sensibilite, "restreinte");
  assert.equal(variableCanonique("satisfaction_commentaire").sensibilite, "restreinte");
});
