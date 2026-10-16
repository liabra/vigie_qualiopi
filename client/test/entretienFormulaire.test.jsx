// DOC-9D2 lot A — Fiche jeune + formulaire d'entretien guidé (5 écrans) :
// sauvegarde progressive, reprise, conflit de version, lecture seule après
// validation. API simulée, aucune donnée réelle de stagiaire.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, champ, cliquer, demonter, monter, saisir, texte } from "./outils.jsx";

beforeEach(() => {
  window.alert = () => { throw new Error("window.alert interdit"); };
  window.confirm = () => { throw new Error("window.confirm interdit"); };
});
afterEach(demonter);

const JEUNE = { id: 1, civilite: "Mme", nom: "Durand", prenom: "Élodie", email: "elodie.durand@exemple.fr", telephone: "0600000000", sans_suite_le: null, nb_inscriptions: 0, nb_entretiens: 0 };
const ENTRETIEN_BROUILLON = { id: 5, stagiaire_id: 1, statut: "brouillon", version: 1, cree_le: "2026-10-16T09:00:00Z", valide_le: null };

test("fiche jeune : identité affichée, commencer un entretien ouvre le formulaire", async () => {
  await monter("/jeunes/1", "admin", {
    "GET /api/stagiaires/1": { stagiaire: JEUNE },
    "GET /api/stagiaires/1/entretiens": { entretiens: [], total: 0 },
    "POST /api/stagiaires/1/entretiens": [201, { entretien: ENTRETIEN_BROUILLON }],
    "GET /api/entretiens/5": { entretien: ENTRETIEN_BROUILLON, reponses: [] },
  });
  await attendre(() => texte().includes("Durand"));
  assert.ok(texte().includes("Aucun entretien"));
  await cliquer(bouton("Commencer un entretien"));
  await attendre(() => texte().includes("Entretien initial"));
  assert.ok(texte().includes("Accueil et identification"), "écran 1 affiché par défaut");
  assert.ok(texte().includes("Brouillon"));
});

test("fiche jeune : un entretien existant se reprend ou se consulte", async () => {
  await monter("/jeunes/1", "admin", {
    "GET /api/stagiaires/1": { stagiaire: JEUNE },
    "GET /api/stagiaires/1/entretiens": { entretiens: [ENTRETIEN_BROUILLON, { ...ENTRETIEN_BROUILLON, id: 6, statut: "valide", valide_le: "2026-10-16T10:00:00Z" }], total: 2 },
  });
  await attendre(() => texte().includes("Durand"));
  assert.ok(texte().includes("Reprendre"));
  assert.ok(texte().includes("Consulter"));
});

test("entretien : saisie puis écran suivant enregistre, le retour en arrière garde la saisie", async () => {
  const appels = await monter("/jeunes/1/entretiens/5", "admin", {
    "GET /api/stagiaires/1": { stagiaire: JEUNE },
    "GET /api/entretiens/5": { entretien: ENTRETIEN_BROUILLON, reponses: [] },
    "PUT /api/entretiens/5/reponses": (corps) => [200, { entretien: { ...ENTRETIEN_BROUILLON, version: corps.version + 1 } }],
  });
  await attendre(() => texte().includes("Accueil et identification"));
  await cliquer(bouton("Suivant"));
  await attendre(() => texte().includes("Attentes, parcours et compétences"));

  await saisir(champ("Motif de la venue"), "Souhaite un retour vers l'emploi.");
  await cliquer(bouton("Suivant"));
  await attendre(() => texte().includes("Motivation et environnement"));
  assert.ok(appels.some((a) => a.methode === "PUT" && a.chemin === "/api/entretiens/5/reponses"), "la réponse saisie a été enregistrée");
  const envoi = appels.find((a) => a.methode === "PUT");
  assert.deepEqual(envoi.corps, { version: 1, reponses: [{ cle: "motif_venue", valeur: "Souhaite un retour vers l'emploi." }] });

  await cliquer(bouton("Précédent"));
  await attendre(() => texte().includes("Attentes, parcours et compétences"));
  assert.equal(champ("Motif de la venue").value, "Souhaite un retour vers l'emploi.", "la saisie n'a pas été perdue en changeant d'écran");
});

test("entretien : l'écran de positionnement (rubrique 8) signale l'absence du questionnaire réel, sans champ", async () => {
  await monter("/jeunes/1/entretiens/5", "admin", {
    "GET /api/stagiaires/1": { stagiaire: JEUNE },
    "GET /api/entretiens/5": { entretien: ENTRETIEN_BROUILLON, reponses: [] },
  });
  await attendre(() => texte().includes("Accueil et identification"));
  await cliquer(bouton("Positionnement pédagogique"));
  await attendre(() => texte().includes("Questionnaire non disponible"));
  assert.ok(texte().includes("accès Drive refusé"), "le blocage réel est signalé, rien n'est inventé");
  assert.equal(document.querySelectorAll("textarea").length, 0, "aucun champ inventé pour cette rubrique");
});

test("entretien : un conflit de version à l'enregistrement propose de recharger, sans rien perdre silencieusement", async () => {
  await monter("/jeunes/1/entretiens/5", "admin", {
    "GET /api/stagiaires/1": { stagiaire: JEUNE },
    "GET /api/entretiens/5": { entretien: ENTRETIEN_BROUILLON, reponses: [] },
    "PUT /api/entretiens/5/reponses": [409, { error: "L'entretien a été modifié entre-temps : rechargez-le." }],
  });
  await attendre(() => texte().includes("Accueil et identification"));
  await cliquer(bouton("Suivant"));
  await attendre(() => texte().includes("Attentes, parcours et compétences"));
  await saisir(champ("Attentes"), "Réponse qui ne sera pas enregistrée.");
  await cliquer(bouton("Suivant"));
  await attendre(() => texte().includes("modifié entre-temps"));
  // L'écran n'a PAS avancé : le conflit bloque la navigation, rien n'est perdu silencieusement.
  assert.ok(texte().includes("Attentes, parcours et compétences"));
  assert.equal(champ("Attentes").value, "Réponse qui ne sera pas enregistrée.");
});

test("entretien validé : lecture seule, aucun champ modifiable, aucun bouton d'enregistrement", async () => {
  const valide = { ...ENTRETIEN_BROUILLON, statut: "valide", valide_le: "2026-10-16T12:00:00Z" };
  await monter("/jeunes/1/entretiens/5", "admin", {
    "GET /api/stagiaires/1": { stagiaire: JEUNE },
    "GET /api/entretiens/5": { entretien: valide, reponses: [{ cle: "motif_venue", valeur: "Retour à l'emploi.", source: "jeune" }] },
  });
  await attendre(() => texte().includes("Accueil et identification"));
  assert.ok(texte().includes("Validé"));
  await cliquer(bouton("Suivant"));
  await attendre(() => texte().includes("Attentes, parcours et compétences"));
  assert.equal(champ("Motif de la venue").value, "Retour à l'emploi.");
  assert.ok(champ("Motif de la venue").disabled, "champ désactivé en lecture seule");
  assert.ok(!bouton("Enregistrer le brouillon"), "aucune action d'écriture proposée sur un entretien validé");
});
