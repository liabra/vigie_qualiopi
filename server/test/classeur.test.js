import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  estBruit, extrairePreuves, mapperColonnes, normaliser, numeroIndicateur,
  propagerFusions, statutDepuisEtat, trouverEnTetes,
} from "../src/services/classeur.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const extrait = JSON.parse(fs.readFileSync(path.join(ICI, "fixtures/classeur-audit-2026.json"), "utf8"));

test("les en-têtes sont trouvés même sans être en première ligne", () => {
  const e = trouverEnTetes(propagerFusions(extrait.grille, extrait.fusions));
  assert.ok(e.ligne > 0, "en-têtes attendus après les lignes de légende");
  assert.ok(e.entetes.includes("Indicateurs"));
  assert.ok(e.entetes.includes("Documents"));
});

test("les colonnes sont repérées par intitulé, pas par position", () => {
  const map = mapperColonnes(["Critères", "Indicateurs", "Tâche(s)", "Equipier",
    "Descriptif / A faire / Contenu des tâches", "Modèles de documents", "Documents", "Importants", "Date fin", "Etat", "Etat"]);
  assert.equal(map.indicateur, 1);
  assert.equal(map.document, 6);
  assert.deepEqual(map.etat, [9, 10]);
  // Même feuille, colonnes déplacées : la correspondance suit.
  const bouge = mapperColonnes(["Etat", "Documents", "Indicateurs"]);
  assert.deepEqual([bouge.document, bouge.indicateur, bouge.etat], [1, 2, [0]]);
});

test("numéro d'indicateur : formats réels du classeur", () => {
  assert.equal(numeroIndicateur("Indic 1 - Information du public"), 1);
  assert.equal(numeroIndicateur("Indicateur 27 : Disposition sous-traitance"), 27);
  assert.equal(numeroIndicateur("Indic 12"), 12);
  assert.equal(numeroIndicateur("Indicateurs audités le 14/12/23"), null);
  assert.equal(numeroIndicateur("Résultats"), null);
  assert.equal(numeroIndicateur(""), null);
});

test("statut dérivé de la colonne d'état", () => {
  assert.equal(statutDepuisEtat(["check ok"]), "maitrise");
  assert.equal(statutDepuisEtat(["en cours"]), "a_consolider");
  assert.equal(statutDepuisEtat(["PAS BESOIN POUR L'INSTANT"]), "non_applicable");
  assert.equal(statutDepuisEtat([]), "a_risque");
  assert.equal(statutDepuisEtat([""]), "a_risque");
  // une ligne inachevée suffit à ne pas déclarer le document maîtrisé
  assert.equal(statutDepuisEtat(["check ok", "en cours"]), "a_consolider");
  assert.equal(statutDepuisEtat(["check ok", "pas besoin"]), "non_applicable");
});

test("les renvois sans nom de fichier sont écartés", () => {
  for (const v of ["", "  ", "Ici", "Document sur le drive", "-- Documents sur le drive --", "o", "oui", ":-:"])
    assert.equal(estBruit(v), true, v);
  for (const v of ["Flyer", "CGV_A2C", "Livret stagiaire"]) assert.equal(estBruit(v), false, v);
});

test("normalisation insensible aux accents et à la ponctuation", () => {
  assert.equal(normaliser("Conditions_générales-vente A2C"), "conditions generales vente a2c");
});

test("extraction sur l'extrait réel du classeur", () => {
  const r = extrairePreuves(extrait.grille, { fusions: extrait.fusions });
  assert.equal(r.erreur, undefined);
  assert.ok(r.preuves.length > 10, "des preuves sont extraites");
  // indicateur propagé par la cellule fusionnée
  assert.ok(r.preuves.every((p) => p.indicateur >= 1 && p.indicateur <= 32));
  // pas de doublon indicateur + document
  const clefs = r.preuves.map((p) => p.indicateur + "|" + normaliser(p.titre));
  assert.equal(new Set(clefs).size, clefs.length);
  // les lignes répétées par fusion sont comptées, pas dupliquées
  assert.ok(r.preuves.some((p) => p.occurrences > 1));
  assert.ok(r.preuves.every((p) => p.lignes_source.length === p.occurrences));
  // les statuts viennent bien du classeur
  assert.ok(r.preuves.some((p) => p.statut === "maitrise"));
  assert.ok(r.ignorees.length > 0);
});

test("une feuille sans colonne exploitable est refusée avec ses en-têtes", () => {
  const r = extrairePreuves([["Nom", "Prénom"], ["Dupont", "Jean"]]);
  assert.match(r.erreur, /Colonnes introuvables/);
  assert.match(r.erreur, /indicateur/);
});

test("une grille démesurée est refusée avant tout traitement", () => {
  const tropDeLignes = Array.from({ length: 20001 }, () => ["Indicateur 1", "Un document"]);
  const r1 = extrairePreuves(tropDeLignes);
  assert.match(r1.erreur, /trop volumineux/);
  assert.match(r1.erreur, /lignes/);

  const tropDeColonnes = [Array.from({ length: 501 }, () => "x")];
  const r2 = extrairePreuves(tropDeColonnes);
  assert.match(r2.erreur, /trop volumineux/);
  assert.match(r2.erreur, /colonnes/);

  // justes sous les bornes : le traitement continue (pas de rejet arbitraire).
  const aLaLimite = [["Indicateurs", "Documents"], ["Indic 1", "Flyer"]];
  assert.equal(extrairePreuves(aLaLimite).erreur, undefined);
});
