// DOC-9E — Construction pure du texte de la fiche d'entretien FSE-IA
// (aucune base, aucun Google). Données fictives uniquement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { construireTexteFiche } from "../src/services/ficheEntretien.js";

const STAGIAIRE = { nom: "Durand", prenom: "Élodie" };
const ENTRETIEN = { id: 7, statut: "valide", valide_le: "2026-10-16T10:00:00Z" };
const VIDE = { reponses: [], choix: [], lignes: { experiences: [], plan_action: [] }, positionnement: { evaluations: [], phases: [] } };

test("rubriques rendues dans l'ordre officiel, 2/12/14 présentes mais sans donnée inventée", () => {
  const texte = construireTexteFiche({ stagiaire: STAGIAIRE, entretien: ENTRETIEN, ...VIDE });
  const ordre = ["1. Identification", "3. Motif", "4. Parcours", "5. Compétences", "6. Centres d'intérêt",
    "7. Environnement", "8. Questionnaire", "9. Projet professionnel", "10. Plan d'action",
    "11. Synthèse", "13. La parole", "2. Prise en compte", "12. Suivi", "14. Engagement"];
  let dernierIndex = -1;
  for (const debut of ordre) {
    const i = texte.indexOf(debut);
    assert.ok(i > dernierIndex, `${debut} doit apparaître après la rubrique précédente`);
    dernierIndex = i;
  }
  assert.ok(texte.includes("hors périmètre de cette génération automatique"), "rubrique 2 : aucune donnée, jamais « aucun handicap déclaré »");
  assert.ok(!/aucun handicap|pas de handicap/i.test(texte), "jamais de fausse mention d'absence de handicap");
  assert.ok(texte.includes("module Accompagnement"));
  assert.ok(texte.includes("à compléter manuellement"), "signatures jamais préremplies");
});

test("aucune donnée médicale/handicap, quelle que soit l'entrée", () => {
  const texte = construireTexteFiche({ stagiaire: STAGIAIRE, entretien: ENTRETIEN, ...VIDE });
  // « diagnostic » apparaît légitimement dans le titre officiel de la phase 1
  // (« Accueil, diagnostic et construction du parcours ») — seul un
  // diagnostic MÉDICAL, un code RQTH ou les colonnes réservées admin sont
  // réellement interdits ici.
  assert.ok(!/diagnostic médical|rqth|situation_handicap|besoins_adaptation/i.test(texte));
});

test("réponses simples : rendues avec leur libellé, jamais une valeur inventée pour un champ absent", () => {
  const texte = construireTexteFiche({
    stagiaire: STAGIAIRE, entretien: ENTRETIEN,
    ...VIDE, reponses: [{ cle: "motif_venue", valeur: "Retour vers l'emploi" }, { cle: "parole_fierte", valeur: "D'être venu." }],
  });
  assert.ok(texte.includes("Pourquoi viens-tu nous rencontrer aujourd'hui ? : Retour vers l'emploi"));
  assert.ok(texte.includes("De quoi es-tu fier aujourd'hui ? : D'être venu."));
  assert.ok(!texte.includes("Résumé de la demande :"), "un champ non renseigné n'apparaît pas avec une valeur");
});

test("sélection fermée : la valeur affichée est le libellé humain, pas le code brut", () => {
  const texte = construireTexteFiche({
    stagiaire: STAGIAIRE, entretien: ENTRETIEN, ...VIDE,
    reponses: [{ cle: "origine_contact", valeur: "mission_locale" }],
  });
  assert.ok(texte.includes("Origine du contact : Mission Locale"));
  assert.ok(!texte.includes(": mission_locale"), "jamais le code brut affiché");
});

test("cases à cocher : les codes sélectionnés sont listés avec leur libellé, groupés par groupe", () => {
  const texte = construireTexteFiche({
    stagiaire: STAGIAIRE, entretien: ENTRETIEN, ...VIDE,
    choix: [{ groupe: "loisirs", code: "sport" }, { groupe: "loisirs", code: "lecture" }, { groupe: "objectifs_souhaites", code: "emploi" }],
  });
  assert.ok(texte.includes("Loisirs : Sport, Lecture"));
  assert.ok(texte.includes("Objectifs souhaités : Emploi"));
});

test("tableau expériences et plan d'action : toutes les lignes restituées, aucun nombre imposé", () => {
  const texte = construireTexteFiche({
    stagiaire: STAGIAIRE, entretien: ENTRETIEN, ...VIDE,
    lignes: {
      experiences: [{ structure: "Stage mairie", duree: "2 sem", missions: null, retenue: null }],
      plan_action: [
        { objectif: "Reprendre confiance", phase: 1, action: null, echeance: null, etat: "en_cours" },
        { objectif: "Préparer un CV", phase: null, action: "Atelier CV", echeance: "Novembre", etat: "a_faire" },
      ],
    },
  });
  assert.ok(texte.includes("1. Structure : Stage mairie — Durée : 2 sem"));
  assert.ok(texte.includes("1. Objectif : Reprendre confiance — Phase concernée : Phase 1 — État d'avancement : En cours"));
  assert.ok(texte.includes("2. Objectif : Préparer un CV — Action à réaliser : Atelier CV — Échéance : Novembre — État d'avancement : À faire"));
});

test("positionnement : les 34 compétences apparaissent toutes, « non évalué » si absente — jamais un niveau inventé", () => {
  const texte = construireTexteFiche({
    stagiaire: STAGIAIRE, entretien: ENTRETIEN, ...VIDE,
    positionnement: { evaluations: [{ phase: 1, competence_code: "p1_c1", niveau: "autonome" }], phases: [{ phase: 1, priorite: "forte", observations: "Bon démarrage" }] },
  });
  const occurrences = texte.match(/\(non évalué\)/g) || [];
  assert.equal(occurrences.length, 33, "33 compétences non évaluées sur 34");
  assert.ok(texte.includes("Connaît les droits et devoirs liés à un parcours de formation : Autonome"));
  assert.ok(texte.includes("Priorité pour ce parcours : Forte"));
  assert.ok(texte.includes("Observations de l'accompagnateur : Bon démarrage"));
  assert.ok(texte.includes("Phase 2 — Développement des compétences numériques"));
  assert.ok(texte.includes("Priorité pour ce parcours : (non renseignée)"), "phase sans priorité choisie : jamais une valeur par défaut");
});

test("la parole du jeune : verbatim, jamais reformulé ni tronqué", () => {
  const verbatim = "Je veux    avancer,     même si c'est dur.";
  const texte = construireTexteFiche({
    stagiaire: STAGIAIRE, entretien: ENTRETIEN, ...VIDE,
    reponses: [{ cle: "parole_jeune", valeur: verbatim }],
  });
  assert.ok(texte.includes(verbatim), "le texte exact du jeune doit apparaître sans modification");
});
