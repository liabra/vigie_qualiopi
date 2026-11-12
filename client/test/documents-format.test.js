// Documents partagés — règles pures : versions, liens Drive, messages d'erreur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { etatVersion, estVersionCourante, lienDriveSur, messageErreur, peutMettreALaCorbeille } from "../src/documents/format.js";

const DOC = { version_courante: 2 };

test("version courante : numéro du document et non remplacée", () => {
  assert.equal(estVersionCourante({ numero: 2, remplacee_le: null }, DOC), true);
  assert.equal(estVersionCourante({ numero: 1, remplacee_le: "2026-09-10" }, DOC), false);
  assert.equal(etatVersion({ numero: 2, remplacee_le: null }, DOC).libelle, "Version courante");
});

test("corbeille : seule une ancienne version, pas déjà à la corbeille, peut y aller", () => {
  assert.equal(peutMettreALaCorbeille({ numero: 1, remplacee_le: "x", corbeille_le: null }, DOC), true);
  assert.equal(peutMettreALaCorbeille({ numero: 2, remplacee_le: null, corbeille_le: null }, DOC), false, "courante");
  assert.equal(peutMettreALaCorbeille({ numero: 1, remplacee_le: "x", corbeille_le: "y" }, DOC), false, "déjà à la corbeille");
  assert.equal(etatVersion({ numero: 1, remplacee_le: "x", corbeille_le: "y" }, DOC).libelle, "À la corbeille");
});

test("lien Drive : seule une adresse Google https est affichable", () => {
  assert.equal(lienDriveSur("https://drive.google.com/file/d/A/view"), "https://drive.google.com/file/d/A/view");
  assert.equal(lienDriveSur("https://docs.google.com/document/d/A/edit"), "https://docs.google.com/document/d/A/edit");
  assert.equal(lienDriveSur("javascript:alert(1)"), null);
  assert.equal(lienDriveSur("http://drive.google.com/x"), null, "pas de http");
  assert.equal(lienDriveSur("https://exemple.fr/x"), null, "pas d'autre domaine");
  assert.equal(lienDriveSur("pas une url"), null);
  assert.equal(lienDriveSur(undefined), null);
});

test("messages d'erreur : code métier d'abord, puis statut HTTP, puis message du serveur", () => {
  assert.match(messageErreur({ code: "corbeille_echec", status: 503 }), /rien n'a été modifié/);
  assert.match(messageErreur({ code: "version_reservee_corbeille", status: 409 }), /en cours de mise à la corbeille/);
  assert.match(messageErreur({ status: 403 }), /réservée aux administrateurs/);
  assert.match(messageErreur({ status: 404 }), /Élément introuvable/);
  assert.match(messageErreur({ status: 503 }), /Google Drive est indisponible/);
  assert.equal(messageErreur({ status: 409, message: "Conflit précis." }), "Conflit précis.");
  assert.equal(messageErreur({}), "Une erreur inattendue est survenue.");
});
