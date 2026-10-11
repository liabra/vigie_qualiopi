// ─────────────────────────────────────────────────────────────
//  DOC-4 — Migration de la Convocation vers les variables canoniques.
//  Vérifie LOCALEMENT (contexte 100 % fictif et déterministe, aucune donnée
//  réelle, aucun appel Drive) que les 8 substitutions historiques →
//  canoniques injectent exactement les mêmes valeurs, et qu'aucune balise
//  résiduelle ne subsiste après substitution. Ne touche à aucun modèle Drive.
// ─────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { RENDUS_HISTORIQUES, valeursDeRemplacement, valeursMarqueurs } from "../src/services/marqueurs.js";
import { resoudreAlias } from "../src/services/catalogueVariables.js";
import { balisesResiduelles } from "../src/services/validationModeles.js";

// Les 8 équivalences de la Convocation : 7 ALIAS stricts du catalogue +
// date_convocation en RENDU HISTORIQUE de compatibilité (jamais un alias).
const EQUIVALENCES_CONVOCATION = [
  ["intitule_formation", "formation_intitule"],
  ["civilite", "stagiaire_civilite"],
  ["prenom_stagiaire", "stagiaire_prenom"],
  ["nom_stagiaire", "stagiaire_nom"],
  ["date_convocation", "document_date_convocation"],
  ["date_debut", "session_date_debut"],
  ["date_fin", "session_date_fin"],
  ["horaire", "session_horaires"],
];

// Contexte 100 % fictif et déterministe.
const CTX = {
  organisme: "ORGANISME-TEST",
  formation: { id: 1, intitule: "Formation test" },
  version: {},
  session: { id: 1, reference: "TEST-2026", date_debut: "2026-01-05", date_fin: "2026-03-05", horaire: "9h00-12h00", statut: "planifiee" },
  groupe: null,
  stagiaire: { id: 1, civilite: "Mme", nom: "TEST", prenom: "Stagiaire", email: null, telephone: null, statut: "inscrit" },
  maintenant: new Date("2026-02-01T10:00:00Z"),
};

test("DOC-4 : 7 alias stricts + date_convocation en rendu historique (jamais un alias)", () => {
  assert.equal(EQUIVALENCES_CONVOCATION.length, 8);
  for (const [historique, canonique] of EQUIVALENCES_CONVOCATION) {
    if (historique === "date_convocation") {
      assert.equal(resoudreAlias(historique), null, "date_convocation n'est pas un alias");
      assert.equal(RENDUS_HISTORIQUES[historique], canonique, "mais un rendu historique de compatibilité");
    } else {
      assert.equal(resoudreAlias(historique), canonique, `${historique} est un alias strict`);
    }
  }
});

test("DOC-4 : les 8 équivalences Convocation injectent exactement la même valeur", () => {
  const v = valeursMarqueurs(CTX);
  const historiques = valeursDeRemplacement(v, []);
  for (const [historique, canonique] of EQUIVALENCES_CONVOCATION) {
    const canoniquePlat = valeursDeRemplacement(v, [canonique]);
    assert.equal(historiques[historique], canoniquePlat[canonique], `${historique} ↔ ${canonique}`);
  }
  // Valeurs réelles (fictives) attendues pour le contexte déterministe.
  assert.equal(historiques.intitule_formation, "Formation test");
  assert.equal(historiques.civilite, "Mme");
  assert.equal(historiques.prenom_stagiaire, "Stagiaire");
  assert.equal(historiques.nom_stagiaire, "TEST");
  assert.equal(historiques.date_convocation, "01/02/2026");
  assert.equal(historiques.date_debut, "05/01/2026");
  assert.equal(historiques.date_fin, "05/03/2026");
  assert.equal(historiques.horaire, "9h00-12h00");
});

test("DOC-4 : la copie canonique ne laisse aucune balise résiduelle après substitution", () => {
  const v = valeursMarqueurs(CTX);
  const canoniques = EQUIVALENCES_CONVOCATION.map(([, c]) => c);
  const plat = valeursDeRemplacement(v, canoniques);
  const modeleCanonique = canoniques.map((c) => `{{${c}}}`).join(" ");
  const substitue = (texte) =>
    Object.entries(plat).reduce((acc, [nom, valeur]) => acc.split(`{{${nom}}}`).join(valeur), texte);
  assert.deepEqual(balisesResiduelles(substitue(modeleCanonique)), []);
  // Une balise laissée est bien détectée comme résiduelle.
  assert.deepEqual(balisesResiduelles("{{formation_intitule}} resté"), ["formation_intitule"]);
});
