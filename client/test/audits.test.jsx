// UX-4 — Audits : liste lisible, détail en panneau, formulaire en panneau
// (plus jamais ouvert en permanence), droits. API simulée ; aucune boîte
// native.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, monter, texte } from "./outils.jsx";

const AUDITS = [
  { id: 1, type: "surveillance", date_audit: "2026-09-01", organisme_certificateur: "Certi+", auditeur: "M. Dupont",
    referentiel_version_id: 1, referentiel_code: "V9", referentiel_libelle: "Référentiel V9",
    resultat: "certifie", nb_nc_mineures: 1, nb_nc_majeures: 0,
    non_conformites: ["Délai de conservation des feuilles d'émargement à clarifier."],
    commentaires: "Audit sans réserve majeure.", rapport_drive_file_id: null, rapport_drive_url: null, rapport_drive_nom: null },
  { id: 2, type: "initial", date_audit: "2025-01-15", resultat: "non_certifie", nb_nc_mineures: 0, nb_nc_majeures: 2,
    non_conformites: ["Absence de procédure de réclamation.", "Documentation stagiaires incomplète."],
    commentaires: null, rapport_drive_file_id: null, rapport_drive_url: null, rapport_drive_nom: null },
];
const routes = (extra = {}) => ({ "GET /api/audits": { audits: AUDITS, total: AUDITS.length }, ...extra });

let natifs = 0;
beforeEach(() => { natifs = 0; window.confirm = () => { natifs++; return true; }; window.alert = () => { natifs++; }; });
afterEach(async () => { assert.equal(natifs, 0, "aucune boîte native"); await demonter(); });

test("liste : types, résultat en toutes lettres, compteurs de non-conformités", async () => {
  await monter("/audits", "admin", routes());
  await attendre(() => texte().includes("Surveillance"));
  assert.ok(texte().includes("Certifié"));
  assert.ok(texte().includes("Non certifié"));
  assert.ok(texte().includes("2 NC majeure(s)"));
  assert.ok(!document.querySelector("form"), "aucun formulaire ouvert en permanence");
});

test("détail en panneau : synthèse, constats, suivi", async () => {
  await monter("/audits", "admin", routes());
  await attendre(() => texte().includes("Surveillance"));
  await cliquer(bouton("Ouvrir"));
  await attendre(() => document.querySelector(".ui-drawer")?.textContent.includes("Synthèse"));
  const t = document.querySelector(".ui-drawer").textContent;
  assert.ok(t.includes("Constats"));
  assert.ok(t.includes("Suivi"));
  assert.ok(t.includes("Délai de conservation"));
  assert.ok(t.includes("Certi+"));
});

test("formulaire d'enregistrement : en panneau, pas en permanence", async () => {
  const appels = await monter("/audits", "admin", routes({ "POST /api/audits": { audit: { id: 3 } } }));
  await attendre(() => texte().includes("Surveillance"));
  await cliquer(bouton("Nouvel audit"));
  await attendre(() => document.querySelector(".ui-drawer")?.textContent.includes("Enregistrer un audit"));
  await cliquer(bouton("Enregistrer l'audit"));
  await attendre(() => texte().includes("Indiquez la date de l'audit."));
  assert.equal(appels.filter((a) => a.methode === "POST").length, 0);
});

test("contributeur : lecture seule, pas de bouton Nouvel audit", async () => {
  await monter("/audits", "contributeur", routes());
  await attendre(() => texte().includes("Surveillance"));
  assert.ok(!bouton("Nouvel audit"));
  await cliquer(bouton("Ouvrir"));
  await attendre(() => document.querySelector(".ui-drawer")?.textContent.includes("Synthèse"));
});
