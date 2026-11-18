// Nouveaux écrans de la navigation simplifiée : Qualiopi (attendu / ce que
// vous avez / ce qui manque), Équipe (liste + fiche), Réglages (cartes),
// rubriques en onglets et menu « Plus ». API simulée, données fictives.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, cliquer, demonter, liensRubriques, monter, texte } from "./outils.jsx";
import { manquesIndicateur } from "../src/pages/Qualiopi.jsx";
import { etatIntervenant } from "../src/pages/Equipe.jsx";

const ind = (id, numero, libelle, statut, extra = {}) => ({ id, numero, libelle, statut, nb_preuves: 0, nb_a_confirmer: 0, non_applicable_force: false, categories: ["OF"], ...extra });
const REFERENTIEL = {
  version: { id: 1, code: "V9" }, totalIndicateurs: 3,
  score: { total: 3, maitrise: 1, a_consolider: 0, a_risque: 1, non_applicable: 1, preuves: 2, a_confirmer: 0 },
  criteres: [
    { id: 1, numero: 1, libelle: "Informer le public", indicateurs: [ind(101, 1, "Information sur les prestations", "maitrise", { nb_preuves: 2 }), ind(102, 2, "Indicateurs de résultats", "a_risque")] },
    { id: 3, numero: 3, libelle: "Accueillir et suivre", indicateurs: [ind(113, 13, "Alternance (CFA)", "non_applicable", { non_applicable_force: true, non_applicable_motif: "Pas de CFA" })] },
  ],
};
const PREUVES_1 = { preuves: [{ id: 5, titre: "Catalogue des formations", statut_effectif: "maitrise", nb_fichiers: 1, alerte_statut: null, a_confirmer: false }], total: 1 };

let natifs = 0;
beforeEach(() => { natifs = 0; window.confirm = () => { natifs++; return true; }; window.alert = () => { natifs++; }; });
afterEach(async () => { assert.equal(natifs, 0, "aucune boîte native"); await demonter(); });

test("pur : ce qui manque à un indicateur", () => {
  assert.deepEqual(manquesIndicateur({ statut: "a_risque" }, []), ["Aucune preuve enregistrée pour cet indicateur."]);
  assert.deepEqual(manquesIndicateur({ statut: "non_applicable", non_applicable_force: true }, []), []);
  assert.deepEqual(manquesIndicateur({ statut: "a_consolider" }, [{ alerte_statut: "perime", a_confirmer: true, statut_effectif: "a_consolider" }]),
    ["1 preuve périmée à renouveler.", "1 preuve à confirmer.", "1 preuve à consolider."]);
});

test("pur : état d'un intervenant — le plus urgent l'emporte", () => {
  const i = { id: 1, entretien_a_faire: true };
  assert.equal(etatIntervenant(i, [{ intervenant: { id: 1 }, etat: "manquant" }]).libelle, "Justificatif manquant");
  assert.equal(etatIntervenant(i, []).libelle, "Entretien à planifier");
  assert.equal(etatIntervenant({ id: 2, entretien_a_faire: false }, [{ intervenant: { id: 1 }, etat: "perime" }]).libelle, "À jour");
  assert.equal(etatIntervenant({ id: 1 }, [{ intervenant: { id: 1 }, etat: "bientot" }]).libelle, "À renouveler bientôt");
});

test("Qualiopi : premier indicateur à compléter ouvert, puis choix d'un autre ; filtre « ce qui reste »", async () => {
  const appels = await monter("/qualiopi", "admin", {
    "GET /api/referentiel": REFERENTIEL,
    "GET /api/preuves?indicateur=2": { preuves: [], total: 0 },
    "GET /api/preuves?indicateur=1": PREUVES_1,
  });
  await attendre(() => texte().includes("Ce qui est attendu"));
  assert.equal(document.querySelector("h1").textContent, "Qualiopi");
  assert.ok(texte().includes("1 indicateurs maîtrisés sur 2 · 1 non concernés."));
  assert.equal(new URLSearchParams(window.location.search).get("indicateur"), null);
  await attendre(() => texte().includes("Aucune preuve enregistrée pour cet indicateur."));
  assert.ok(texte().includes("Indicateurs de résultats"));
  assert.ok(document.querySelector('a[href="/preuves?indicateur=2"]').textContent.includes("Ajouter une preuve"));
  // Choisir l'indicateur 1 : ses preuves, plus rien ne manque.
  await cliquer([...document.querySelectorAll(".qualiopi-indicateur")].find((b) => b.textContent.includes("Information sur les prestations")));
  await attendre(() => texte().includes("Catalogue des formations"));
  assert.equal(new URLSearchParams(window.location.search).get("indicateur"), "1");
  assert.ok(!texte().includes("Ce qui manque"));
  assert.ok(appels.some((a) => a.chemin === "/api/preuves"), "preuves lues pour l'indicateur choisi");
  // Filtre : seuls les indicateurs à compléter restent.
  await cliquer(document.querySelector(".qualiopi-filtre input"));
  const visibles = [...document.querySelectorAll(".qualiopi-indicateur")].map((b) => b.textContent);
  assert.equal(visibles.length, 1);
  assert.ok(visibles[0].includes("Indicateurs de résultats"));
});

test("Qualiopi : un indicateur non concerné affiche sa raison, sans preuves à ajouter", async () => {
  await monter("/qualiopi?indicateur=13", "admin", { "GET /api/referentiel": REFERENTIEL });
  await attendre(() => texte().includes("Pas de CFA"));
  assert.ok(!texte().includes("Ce que vous avez"));
});

test("Qualiopi : onglets de rubriques et menu « Plus »", async () => {
  await monter("/qualiopi", "admin", { "GET /api/referentiel": REFERENTIEL });
  await attendre(() => liensRubriques().length > 0);
  const onglets = [...document.querySelectorAll('nav[aria-label="Rubriques : Qualiopi"] a')].map((a) => a.textContent);
  assert.deepEqual(onglets, ["Indicateurs", "Réclamations", "Améliorations", "Veille", "Risques", "Audit"]);
  const plus = document.querySelector(".shell-plus summary");
  assert.ok(plus.textContent.startsWith("Plus"));
  assert.ok(liensRubriques().includes("Toutes les preuves") && liensRubriques().includes("Référentiel détaillé"));
});

test("Équipe : liste avec états, fiche de l'intervenant choisi, espace formateur", async () => {
  await monter("/equipe", "admin", {
    "GET /api/developpement": { actions: [], types: {}, statuts: {}, intervenants: [
      { id: 1, nom: "Lefictif", prenom: "Nadia", fonction: "formateur", nature: "salarie", date_dernier_entretien: "2025-10-01", entretien_a_faire: true, realisees: 1, prevues: 0, besoins_developpement: "Oral" },
      { id: 2, nom: "Rfictif", prenom: "Thomas", fonction: "formateur", nature: "exterieur", date_dernier_entretien: "2026-06-01", entretien_a_faire: false, realisees: 0, prevues: 1, besoins_developpement: null },
    ] },
    "GET /api/justificatifs-intervenants": { resume: {}, elements: [{ intervenant: { id: 2 }, categorie: "diplome", etat: "manquant", document: null }] },
    "GET /api/intervenants/1/justificatifs": { attendus: [], lignes: [], justificatifs: [] },
    "GET /api/intervenants/2/justificatifs": { attendus: ["diplome"], lignes: [], justificatifs: [] },
    "GET /api/acces-portail?intervenant_id=1": { acces: [{ id: 3, actif: true, expire_le: "2027-01-31", derniere_utilisation: "2026-11-17" }] },
    "GET /api/acces-portail?intervenant_id=2": { acces: [] },
  });
  await attendre(() => texte().includes("Nadia Lefictif"));
  const etats = [...document.querySelectorAll(".equipe-personne")].map((b) => b.textContent);
  assert.ok(etats[0].includes("Entretien à planifier") && etats[1].includes("Justificatif manquant"));
  await attendre(() => texte().includes("Lien actif jusqu'au 31/01/2027 · dernière visite le 17/11/2026"));
  assert.ok(texte().includes("dernier le 01/10/2025 · à planifier"));
  await cliquer(document.querySelectorAll(".equipe-personne")[1]);
  await attendre(() => texte().includes("Aucun lien actif."));
  assert.equal(new URLSearchParams(window.location.search).get("intervenant"), "2");
  assert.equal(document.querySelector("#equipe-nom").textContent, "Thomas Rfictif");
});

test("Réglages : cartes et état du Drive ; les rubriques gardent un lien de retour", async () => {
  await monter("/reglages", "admin");
  await attendre(() => texte().includes("Connecté"));
  for (const t of ["Organisme", "Comptes et accès", "Google Drive", "Modèles de documents", "Référentiel Qualiopi", "Données personnelles"]) assert.ok(texte().includes(t), t);
  assert.equal(document.querySelector(".shell-sous-nav"), null, "pas d'onglets dans Réglages");
});
