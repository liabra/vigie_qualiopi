// ─────────────────────────────────────────────────────────────
//  DOC-4C — Migration de l'Attestation vers les variables canoniques.
//  Vérifie LOCALEMENT (contexte 100 % fictif, aucune donnée réelle) que les
//  8 substitutions historiques → canoniques injectent les mêmes valeurs, en
//  particulier duree → document_duree_attestation (source unique).
// ─────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { valeursDeRemplacement, valeursMarqueurs } from "../src/services/marqueurs.js";
import { marqueurHistorique, resoudreAlias } from "../src/services/catalogueVariables.js";
import { resoudreCanoniques } from "../src/services/resolversCanoniques.js";
import { balisesResiduelles } from "../src/services/validationModeles.js";

// Mapping complet de l'Attestation : 6 alias stricts + duree (historique,
// relit document_duree_attestation) + date_attestation (historique,
// équivalent de document_date_attestation).
const EQUIVALENCES_ATTESTATION = [
  ["intitule_formation", "formation_intitule"],
  ["civilite", "stagiaire_civilite"],
  ["prenom_stagiaire", "stagiaire_prenom"],
  ["nom_stagiaire", "stagiaire_nom"],
  ["date_debut", "session_date_debut"],
  ["date_fin", "session_date_fin"],
  ["duree", "document_duree_attestation"],
  ["date_attestation", "document_date_attestation"],
];

const CTX = {
  organisme: "A2C",
  formation: { id: 1, intitule: "Parcours Insertion professionnelle" },
  version: { duree_heures_defaut: 270 },
  session: {
    id: 1, reference: "TEST", date_debut: "2026-10-15", date_fin: "2027-06-30",
    horaire: "09h00 - 12h00", statut: "planifiee", duree_heures_reelle: 276,
  },
  groupe: null,
  stagiaire: { id: 1, civilite: "Mme", nom: "MARTIN", prenom: "Alice", email: null, telephone: null, statut: "inscrit" },
  maintenant: new Date("2026-10-11T12:00:00Z"),
};

test("DOC-4C : duree est historique (pas un alias) et cible document_duree_attestation", () => {
  assert.equal(resoudreAlias("duree"), null, "duree n'est pas un alias");
  assert.ok(marqueurHistorique("duree"), "duree reste classé HISTORIQUE");
  assert.deepEqual(marqueurHistorique("duree").cibles_possibles, ["document_duree_attestation"]);
});

test("DOC-4C : duree === document_duree_attestation — durée de session prioritaire", () => {
  const v = valeursMarqueurs(CTX);
  assert.equal(v.duree, "276 h", "durée de session (276) prime sur formation (270)");
  assert.equal(resoudreCanoniques(CTX).document_duree_attestation.valeur, "276 h");
  const plat = valeursDeRemplacement(v, ["document_duree_attestation"]);
  assert.equal(plat.duree, plat.document_duree_attestation, "chaîne strictement identique");
});

test("DOC-4C : duree retombe sur la durée de formation si la session n'en a pas", () => {
  const ctx = { ...CTX, session: { ...CTX.session, duree_heures_reelle: null } };
  assert.equal(valeursMarqueurs(ctx).duree, "270 h", "repli sur la durée de formation");
  assert.equal(resoudreCanoniques(ctx).document_duree_attestation.valeur, "270 h");
});

test("DOC-4C : le format historique est conservé (décimales éventuelles)", () => {
  const ctx = { ...CTX, session: { ...CTX.session, duree_heures_reelle: 17.5 } };
  assert.equal(valeursMarqueurs(ctx).duree, "17.5 h");
  assert.equal(resoudreCanoniques(ctx).document_duree_attestation.valeur, "17.5 h");
});

test("DOC-4C : les 8 équivalences Attestation injectent exactement la même valeur", () => {
  const v = valeursMarqueurs(CTX);
  const historiques = valeursDeRemplacement(v, []);
  for (const [historique, canonique] of EQUIVALENCES_ATTESTATION) {
    const canoniquePlat = valeursDeRemplacement(v, [canonique]);
    assert.equal(historiques[historique], canoniquePlat[canonique], `${historique} ↔ ${canonique}`);
  }
});

test("DOC-4C : la copie canonique Attestation ne laisse aucune balise résiduelle", () => {
  const v = valeursMarqueurs(CTX);
  const canoniques = EQUIVALENCES_ATTESTATION.map(([, c]) => c);
  const plat = valeursDeRemplacement(v, canoniques);
  const substitue = (texte) =>
    Object.entries(plat).reduce((acc, [nom, valeur]) => acc.split(`{{${nom}}}`).join(valeur), texte);
  const modele = canoniques.map((c) => `{{${c}}}`).join(" ");
  assert.deepEqual(balisesResiduelles(substitue(modele)), []);
});
