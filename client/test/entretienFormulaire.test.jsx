// DOC-9D2 lot A — Fiche jeune + formulaire d'entretien guidé (5 écrans) :
// sauvegarde progressive, reprise, conflit de version, lecture seule après
// validation. API simulée, aucune donnée réelle de stagiaire.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, champ, cliquer, demonter, dialogue, monter, saisir, texte } from "./outils.jsx";

// Les boutons d'étape portent un compteur (" 0/34") : recherche par préfixe.
const etapeBouton = (libelle) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(libelle));

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

  await saisir(champ("Pourquoi viens-tu nous rencontrer aujourd'hui ?"), "Souhaite un retour vers l'emploi.");
  await cliquer(bouton("Suivant"));
  await attendre(() => texte().includes("Motivation et environnement"));
  assert.ok(appels.some((a) => a.methode === "PUT" && a.chemin === "/api/entretiens/5/reponses"), "la réponse saisie a été enregistrée");
  const envoi = appels.find((a) => a.methode === "PUT");
  assert.deepEqual(envoi.corps, { version: 1, reponses: [{ cle: "motif_venue", valeur: "Souhaite un retour vers l'emploi." }] });

  await cliquer(bouton("Précédent"));
  await attendre(() => texte().includes("Attentes, parcours et compétences"));
  assert.equal(champ("Pourquoi viens-tu nous rencontrer aujourd'hui ?").value, "Souhaite un retour vers l'emploi.", "la saisie n'a pas été perdue en changeant d'écran");
});

test("entretien : l'écran de positionnement affiche les 34 compétences réparties sur 6 phases", async () => {
  await monter("/jeunes/1/entretiens/5", "admin", {
    "GET /api/stagiaires/1": { stagiaire: JEUNE },
    "GET /api/entretiens/5": { entretien: ENTRETIEN_BROUILLON, reponses: [], positionnement: { evaluations: [], phases: [] } },
  });
  await attendre(() => texte().includes("Accueil et identification"));
  await cliquer(etapeBouton("Positionnement pédagogique"));
  await attendre(() => texte().includes("Phase 1"));
  assert.equal(document.querySelectorAll('input[type="radio"]').length, 34 * 3, "34 compétences × 3 niveaux");
  assert.ok(texte().includes("Phase 6"));
  assert.ok(texte().includes("Priorité pour ce parcours — Phase 1"));
  assert.ok(texte().includes("Observations de l'accompagnateur — Phase 1"));
});

test("entretien : un niveau choisi se conserve en changeant d'écran, puis s'enregistre au bon format", async () => {
  const appels = await monter("/jeunes/1/entretiens/5", "admin", {
    "GET /api/stagiaires/1": { stagiaire: JEUNE },
    "GET /api/entretiens/5": { entretien: ENTRETIEN_BROUILLON, reponses: [], positionnement: { evaluations: [], phases: [] } },
    "PUT /api/entretiens/5/positionnement": (corps) => [200, { entretien: { ...ENTRETIEN_BROUILLON, version: corps.version + 1 } }],
  });
  await attendre(() => texte().includes("Accueil et identification"));
  await cliquer(etapeBouton("Positionnement pédagogique"));
  await attendre(() => texte().includes("Phase 1"));

  await cliquer(document.querySelector('input[name="p1_c1"][value="autonome"]'));
  await saisir(champ("Priorité pour ce parcours — Phase 1"), "forte");

  await cliquer(bouton("Suivant"));
  await attendre(() => texte().includes("Projet et conclusion"));
  assert.ok(appels.some((a) => a.methode === "PUT" && a.chemin === "/api/entretiens/5/positionnement"), "le positionnement a été enregistré");
  const envoi = appels.find((a) => a.chemin === "/api/entretiens/5/positionnement");
  assert.deepEqual(envoi.corps.evaluations, [{ competence_code: "p1_c1", niveau: "autonome" }]);
  assert.deepEqual(envoi.corps.phases, [{ phase: 1, priorite: "forte", observations: null }]);

  await cliquer(etapeBouton("Positionnement pédagogique"));
  await attendre(() => texte().includes("Phase 1"));
  assert.ok(document.querySelector('input[name="p1_c1"][value="autonome"]').checked, "le niveau choisi n'a pas été perdu");
});

test("entretien validé : les niveaux de compétence sont figés (radios désactivés)", async () => {
  const valide = { ...ENTRETIEN_BROUILLON, statut: "valide", valide_le: "2026-10-16T12:00:00Z" };
  await monter("/jeunes/1/entretiens/5", "admin", {
    "GET /api/stagiaires/1": { stagiaire: JEUNE },
    "GET /api/entretiens/5": {
      entretien: valide, reponses: [],
      positionnement: { evaluations: [{ phase: 1, competence_code: "p1_c1", niveau: "autonome" }], phases: [{ phase: 1, priorite: "forte", observations: null }] },
    },
  });
  await attendre(() => texte().includes("Accueil et identification"));
  await cliquer(etapeBouton("Positionnement pédagogique"));
  await attendre(() => texte().includes("Phase 1"));
  const radio = document.querySelector('input[name="p1_c1"][value="autonome"]');
  assert.ok(radio.checked);
  assert.ok(radio.disabled, "lecture seule après validation");
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
  assert.equal(champ("Pourquoi viens-tu nous rencontrer aujourd'hui ?").value, "Retour à l'emploi.");
  assert.ok(champ("Pourquoi viens-tu nous rencontrer aujourd'hui ?").disabled, "champ désactivé en lecture seule");
  assert.ok(!bouton("Enregistrer le brouillon"), "aucune action d'écriture proposée sur un entretien validé");
});

// DOC-9E — Génération de la fiche FSE-IA depuis un entretien validé.
test("fiche FSE-IA : génération puis affichage du lien, régénération refusée sans confirmation puis confirmée", async () => {
  const valide = { ...ENTRETIEN_BROUILLON, statut: "valide", valide_le: "2026-10-16T12:00:00Z" };
  let fois = 0;
  const appels = await monter("/jeunes/1/entretiens/5", "admin", {
    "GET /api/stagiaires/1": { stagiaire: JEUNE },
    "GET /api/entretiens/5": { entretien: valide, reponses: [] },
    "POST /api/entretiens/5/fiche": (corps) => {
      fois += 1;
      if (fois === 1) return [200, { entretien: { ...valide, fiche_drive_file_id: "doc-1", fiche_drive_url: "https://drive/doc-1", fiche_generee_le: "2026-10-16T13:00:00Z" }, fiche: { id: "doc-1" } }];
      if (!corps.remplacer) return [409, { error: "Une fiche a déjà été générée pour cet entretien.", fiche_existante: { drive_file_id: "doc-1" } }];
      return [200, { entretien: { ...valide, fiche_drive_file_id: "doc-2", fiche_drive_url: "https://drive/doc-2", fiche_generee_le: "2026-10-16T14:00:00Z" }, fiche: { id: "doc-2" } }];
    },
  });
  await attendre(() => texte().includes("Accueil et identification"));
  assert.ok(texte().includes("Aucune fiche n'a encore été générée"));
  await cliquer(bouton("Générer la fiche FSE-IA"));
  await attendre(() => texte().includes("Voir le document"));
  assert.ok(document.querySelector('a[href="https://drive/doc-1"]'));

  await cliquer(bouton("Régénérer"));
  await attendre(() => texte().includes("Régénérer la fiche FSE-IA ?"));
  await cliquer([...dialogue().querySelectorAll("button")].find((b) => b.textContent.trim() === "Régénérer"));
  await attendre(() => document.querySelector('a[href="https://drive/doc-2"]'));
  assert.ok(appels.filter((a) => a.chemin === "/api/entretiens/5/fiche").length >= 2);
});

test("fiche FSE-IA : aucune action proposée tant que l'entretien est en brouillon", async () => {
  await monter("/jeunes/1/entretiens/5", "admin", {
    "GET /api/stagiaires/1": { stagiaire: JEUNE },
    "GET /api/entretiens/5": { entretien: ENTRETIEN_BROUILLON, reponses: [] },
  });
  await attendre(() => texte().includes("Accueil et identification"));
  assert.ok(!texte().includes("Générer la fiche FSE-IA"));
});
