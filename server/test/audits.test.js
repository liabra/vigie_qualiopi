// Règles des routes /api/audits, isolées dans un module pur pour être
// testables sans base. Elles reprennent les contraintes CHECK de la
// table : les valider ici, c'est répondre 400 avec un message lisible
// au lieu de laisser Postgres échouer en 500.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESULTATS_AUDIT, TYPES_AUDIT, champsAudit, normaliserNonConformites,
} from "../src/services/audits.js";

test("les valeurs admises sont exactement celles des contraintes en base", () => {
  assert.deepEqual(TYPES_AUDIT, ["initial", "surveillance", "renouvellement", "blanc", "interne"]);
  assert.deepEqual(RESULTATS_AUDIT, ["en_attente", "certifie", "maintenu", "non_certifie", "suspendu"]);
});

test("un type ou un résultat hors contrainte est refusé, pas transmis à la base", () => {
  assert.equal(champsAudit({ type: "surprise" }).erreur, "Type d'audit inconnu.");
  assert.equal(champsAudit({ resultat: "peut-être" }).erreur, "Résultat d'audit inconnu.");
  // les valeurs valides passent
  assert.equal(champsAudit({ type: "surveillance" }).champs.type, "surveillance");
  assert.equal(champsAudit({ resultat: "maintenu" }).champs.resultat, "maintenu");
  // un résultat vide est admis : l'audit peut ne pas encore avoir de verdict
  assert.equal(champsAudit({ resultat: "" }).champs.resultat, null);
});

test("les compteurs de non-conformités n'acceptent que des entiers positifs", () => {
  assert.equal(champsAudit({ nb_nc_mineures: 3 }).champs.nb_nc_mineures, 3);
  assert.equal(champsAudit({ nb_nc_majeures: "2" }).champs.nb_nc_majeures, 2);
  assert.equal(champsAudit({ nb_nc_mineures: "" }).champs.nb_nc_mineures, 0);
  for (const mauvais of [-1, 1.5, "beaucoup"]) {
    assert.match(champsAudit({ nb_nc_mineures: mauvais }).erreur, /entier positif/, String(mauvais));
  }
});

test("les non-conformités se saisissent une par ligne", () => {
  assert.deepEqual(
    normaliserNonConformites("Indicateur 9 : preuve absente\n  \nIndicateur 22 : plan périmé  \n"),
    ["Indicateur 9 : preuve absente", "Indicateur 22 : plan périmé"]
  );
  assert.deepEqual(normaliserNonConformites(["  a  ", "", "b"]), ["a", "b"]);
  assert.deepEqual(normaliserNonConformites(null), []);
  assert.deepEqual(champsAudit({ non_conformites: "une seule" }).champs.non_conformites, ["une seule"]);
});

test("seules les clés envoyées ressortent : c'est ce qui rend le PATCH partiel", () => {
  const { champs } = champsAudit({ auditeur: "Mme Carr" });
  assert.deepEqual(Object.keys(champs), ["auditeur"]);
  // un corps vide ne produit aucun champ : la route répond « rien à modifier »
  assert.deepEqual(Object.keys(champsAudit({}).champs), []);
  // une clé inconnue est ignorée plutôt que transmise à la base
  assert.deepEqual(Object.keys(champsAudit({ colonne_inventee: "x" }).champs), []);
});

test("les textes vides deviennent NULL, les espaces sont retirés", () => {
  const { champs } = champsAudit({
    organisme_certificateur: "  Qualitae  ", auditeur: "", commentaires: "   ",
    rapport_drive_file_id: "FICHIER1", rapport_drive_url: "https://d/1", rapport_drive_nom: "Rapport.pdf",
  });
  assert.equal(champs.organisme_certificateur, "Qualitae");
  assert.equal(champs.auditeur, null);
  assert.equal(champs.commentaires, null);
  assert.equal(champs.rapport_drive_file_id, "FICHIER1");
  assert.equal(champs.rapport_drive_nom, "Rapport.pdf");
});

test("la version de référentiel est facultative et numérique", () => {
  assert.equal(champsAudit({ referentiel_version_id: "3" }).champs.referentiel_version_id, 3);
  assert.equal(champsAudit({ referentiel_version_id: null }).champs.referentiel_version_id, null);
  assert.equal(champsAudit({ referentiel_version_id: "" }).champs.referentiel_version_id, null);
  assert.match(champsAudit({ referentiel_version_id: "abc" }).erreur, /Version de référentiel/);
});

test("la date d'audit ne peut pas être vidée", () => {
  assert.equal(champsAudit({ date_audit: "2026-02-24" }).champs.date_audit, "2026-02-24");
  assert.match(champsAudit({ date_audit: "" }).erreur, /obligatoire/);
});
