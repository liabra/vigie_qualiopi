// DOC-9D3 — Champs étendus de l'entretien initial (sélections, échelle,
// date, cases à cocher, tableaux répétables) : saisie, enregistrement,
// reprise, et vérification de bout en bout (lot C). API simulée avec état
// persistant entre les appels, pour vérifier une vraie reprise après
// rechargement — aucune donnée réelle de stagiaire.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, champ, cliquer, demonter, monter, saisir, texte } from "./outils.jsx";

beforeEach(() => {
  window.alert = () => { throw new Error("window.alert interdit"); };
  window.confirm = () => { throw new Error("window.confirm interdit"); };
});
afterEach(demonter);

const etapeBouton = (libelle) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(libelle));

const JEUNE = { id: 1, civilite: "Mme", nom: "Durand", prenom: "Élodie", email: "elodie.durand@exemple.fr", telephone: "0600000000", sans_suite_le: null, nb_inscriptions: 0, nb_entretiens: 0 };

// État mutable d'un entretien brouillon, comme en base : chaque route PUT
// simulée écrit dans cet objet, la route GET le relit — une vraie reprise
// est donc testée, pas seulement l'affichage immédiat après saisie.
function entretienSimule() {
  const etat = {
    entretien: { id: 5, stagiaire_id: 1, statut: "brouillon", version: 1, cree_le: "2026-10-16T09:00:00Z", valide_le: null },
    reponses: [], positionnement: { evaluations: [], phases: [] }, choix: [], lignes: { experiences: [], plan_action: [] },
  };
  const incrementer = () => { etat.entretien = { ...etat.entretien, version: etat.entretien.version + 1 }; return etat.entretien; };
  return {
    routes: {
      "GET /api/stagiaires/1": { stagiaire: JEUNE },
      "GET /api/entretiens/5": () => ({ ...etat }),
      "PUT /api/entretiens/5/reponses": (corps) => { etat.reponses = corps.reponses; return [200, { entretien: incrementer() }]; },
      "PUT /api/entretiens/5/positionnement": (corps) => { etat.positionnement = { evaluations: corps.evaluations, phases: corps.phases }; return [200, { entretien: incrementer() }]; },
      "PUT /api/entretiens/5/choix": (corps) => { etat.choix = corps.choix; return [200, { entretien: incrementer() }]; },
      "PUT /api/entretiens/5/lignes": (corps) => { etat.lignes = { ...etat.lignes, [corps.bloc]: corps.lignes }; return [200, { entretien: incrementer() }]; },
      "POST /api/entretiens/5/valider": () => { etat.entretien = { ...etat.entretien, statut: "valide", valide_le: "2026-10-16T12:00:00Z" }; return [200, { entretien: etat.entretien }]; },
    },
    etat,
  };
}

test("écran 1 : sélection fermée, échelle et date se saisissent et s'enregistrent correctement", async () => {
  const { routes, etat } = entretienSimule();
  const appels = await monter("/jeunes/1/entretiens/5", "admin", routes);
  await attendre(() => texte().includes("Accueil et identification"));

  await saisir(champ("Origine du contact"), "mission_locale");
  await saisir(champ("Date de naissance"), "2008-05-12");
  await cliquer(bouton("Suivant"));
  await attendre(() => texte().includes("Attentes, parcours et compétences"));

  assert.deepEqual(new Set(etat.reponses.map((r) => r.cle)), new Set(["origine_contact", "date_naissance"]));
  const parCle = Object.fromEntries(etat.reponses.map((r) => [r.cle, r.valeur]));
  assert.equal(parCle.origine_contact, "mission_locale");
  assert.equal(parCle.date_naissance, "2008-05-12");
  assert.ok(appels.some((a) => a.methode === "PUT" && a.chemin === "/api/entretiens/5/reponses"));
});

test("écran 3 : l'échelle de confiance accepte 0-10, aucune valeur par défaut au chargement", async () => {
  const { routes } = entretienSimule();
  await monter("/jeunes/1/entretiens/5", "admin", routes);
  await attendre(() => texte().includes("Accueil et identification"));
  await cliquer(etapeBouton("Motivation et environnement"));
  await attendre(() => texte().includes("Confiance en soi"));
  const champEchelle = champ("Confiance en soi (0 = pas confiant, 10 = très confiant)");
  assert.equal(champEchelle.value, "", "aucune valeur par défaut");
  await saisir(champEchelle, "7");
  assert.equal(champEchelle.value, "7");
});

test("cases à cocher : sélection multiple enregistrée au format groupe/code, reprise après rechargement", async () => {
  const { routes, etat } = entretienSimule();
  await monter("/jeunes/1/entretiens/5", "admin", routes);
  await attendre(() => texte().includes("Accueil et identification"));
  await cliquer(etapeBouton("Attentes, parcours et compétences"));
  await attendre(() => texte().includes("Objectifs souhaités"));

  const caseEmploi = [...document.querySelectorAll('input[type="checkbox"]')].find((i) => i.nextSibling?.textContent === "Emploi");
  const caseFormation = [...document.querySelectorAll('input[type="checkbox"]')].find((i) => i.nextSibling?.textContent === "Formation");
  await cliquer(caseEmploi);
  await cliquer(caseFormation);
  await cliquer(bouton("Enregistrer le brouillon"));
  await attendre(() => etat.choix.length === 2);
  assert.deepEqual(new Set(etat.choix.map((c) => `${c.groupe}:${c.code}`)), new Set(["objectifs_souhaites:emploi", "objectifs_souhaites:formation"]));

  // Décocher une case puis réenregistrer : elle disparaît, l'autre reste.
  await cliquer(caseFormation);
  await cliquer(bouton("Enregistrer le brouillon"));
  await attendre(() => etat.choix.length === 1);
  assert.equal(etat.choix[0].code, "emploi");
});

test("tableau répétable « expériences » : ajouter, remplir, supprimer une ligne, aucun nombre imposé", async () => {
  const { routes, etat } = entretienSimule();
  await monter("/jeunes/1/entretiens/5", "admin", routes);
  await attendre(() => texte().includes("Accueil et identification"));
  await cliquer(etapeBouton("Attentes, parcours et compétences"));
  await attendre(() => texte().includes("Expériences"));
  assert.ok(texte().includes("Aucune ligne pour le moment"));

  await cliquer(bouton("+ Ajouter une ligne"));
  await saisir(champ("Expérience / activité — Structure"), "Stage en mairie");
  await cliquer(bouton("+ Ajouter une ligne"));
  assert.equal(document.querySelectorAll(".entretien-tableau__ligne").length, 2);

  await cliquer(bouton("Enregistrer le brouillon"));
  await attendre(() => etat.lignes.experiences.length === 1, 2000);
  assert.equal(etat.lignes.experiences[0].structure, "Stage en mairie");
  assert.equal(etat.lignes.experiences[0].ordre, 1, "la deuxième ligne vide n'est pas envoyée");
});

test("tableau répétable « plan d'action » : colonnes select (phase, état) correctement envoyées", async () => {
  const { routes, etat } = entretienSimule();
  await monter("/jeunes/1/entretiens/5", "admin", routes);
  await attendre(() => texte().includes("Accueil et identification"));
  await cliquer(etapeBouton("Projet et conclusion"));
  await attendre(() => texte().includes("Plan d'action individualisé"));

  await cliquer(bouton("+ Ajouter une ligne"));
  await saisir(champ("Objectif"), "Reprendre confiance en soi");
  await saisir(champ("Phase concernée"), "1");
  await saisir(champ("État d'avancement"), "en_cours");
  await cliquer(bouton("Enregistrer le brouillon"));
  await attendre(() => etat.lignes.plan_action.length === 1);
  assert.deepEqual(etat.lignes.plan_action[0], { ordre: 1, objectif: "Reprendre confiance en soi", phase: "1", action: "", echeance: "", etat: "en_cours" });
});

test("lot C : un entretien fictif entièrement saisi (tous types de champs) peut être validé puis relu en lecture seule", async () => {
  const { routes, etat } = entretienSimule();
  await monter("/jeunes/1/entretiens/5", "admin", routes);
  await attendre(() => texte().includes("Accueil et identification"));

  await saisir(champ("Référent / accompagnateur"), "M. Lucas");
  await cliquer(bouton("Suivant"));
  await attendre(() => texte().includes("Pourquoi viens-tu nous rencontrer aujourd'hui ?"));
  await saisir(champ("Pourquoi viens-tu nous rencontrer aujourd'hui ?"), "Retour vers l'emploi.");
  await cliquer(etapeBouton("Positionnement pédagogique"));
  await attendre(() => texte().includes("Phase 1"));
  await cliquer(document.querySelector('input[name="p1_c1"][value="autonome"]'));
  await cliquer(etapeBouton("Projet et conclusion"));
  await attendre(() => texte().includes("De quoi es-tu fier aujourd'hui ?"));
  await saisir(champ("De quoi es-tu fier aujourd'hui ?"), "D'être venu jusqu'ici.");
  await cliquer(bouton("Enregistrer le brouillon"));
  await attendre(() => etat.entretien.version > 1);

  // Toutes les réponses doivent être récupérables pour la future génération.
  assert.ok(etat.reponses.some((r) => r.cle === "referent_accompagnateur"));
  assert.ok(etat.reponses.some((r) => r.cle === "motif_venue"));
  assert.ok(etat.reponses.some((r) => r.cle === "parole_fierte"));

  await cliquer(bouton("Valider l'entretien"));
  await attendre(() => texte().includes("Valider cet entretien ?"));
  await cliquer(bouton("Valider"));
  await attendre(() => texte().includes("Validé"));

  // Relecture complète en lecture seule : plus aucun contrôle n'est modifiable,
  // sur l'écran courant (Projet et conclusion) comme sur un écran revisité.
  assert.ok(champ("De quoi es-tu fier aujourd'hui ?").disabled);
  assert.ok(!bouton("Enregistrer le brouillon"));
  assert.ok(!bouton("+ Ajouter une ligne"));
  await cliquer(etapeBouton("Accueil et identification"));
  await attendre(() => texte().includes("Référent / accompagnateur"));
  assert.ok(champ("Référent / accompagnateur").disabled);
});
