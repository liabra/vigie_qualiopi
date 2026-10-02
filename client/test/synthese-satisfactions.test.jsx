// Q3-2 — Synthèse des satisfactions (admin), actions qualité issues d'un
// retour de satisfaction (FormulaireAction réutilisé), section du tableau de
// bord. API simulée, données fictives ; horloge maîtrisée (test/horloge.mjs).
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, dialogue, liensNavigation, monter, saisir, texte } from "./outils.jsx";
import { aujourdhuiISO } from "../src/qualite/format.js";
import { libelleProvenanceSynthese, moyenneSurEchelle, requeteSynthese } from "../src/qualite/satisfaction-format.js";

const vanne = () => { let ouvrir; const p = new Promise((r) => { ouvrir = r; }); return { attendre: () => p, ouvrir }; };

let natifs = 0;
beforeEach(() => {
  natifs = 0;
  window.alert = () => { natifs++; };
  window.confirm = () => { natifs++; return true; };
});
afterEach(async () => {
  assert.equal(natifs, 0, "aucun window.alert / window.confirm");
  await demonter();
});

const SYNTHESE = (sur = {}) => ({
  filtres: { du: null, au: null, formation_id: null, session_id: null, type: null },
  reponses: 8, periode: { du: "2026-03-05", au: "2026-07-31" },
  publics: [{ type: "a_chaud", reponses: 5 }, { type: "prescripteur", reponses: 1 }, { type: "partenaire", reponses: 2 }],
  echelles: [
    { echelle: 5, reponses: 5, moyenne: 3.6, repartition: [{ note: 2, reponses: 1 }, { note: 4, reponses: 3 }, { note: 5, reponses: 1 }] },
    { echelle: 10, reponses: 2, moyenne: 7, repartition: [{ note: 6, reponses: 1 }, { note: 8, reponses: 1 }] },
  ],
  sans_note: 1, moyenne_globale: null,
  sessions: [{ id: 1, reference: "SESS-TEST", formation_id: 7, formation: "Formation test", date_debut: "2026-09-01", date_fin: "2026-12-15", reponses: 6 },
    { id: 3, reference: "SESS-FINIE", formation_id: 7, formation: "Formation test", date_debut: "2026-01-05", date_fin: "2026-03-05", reponses: 2 }],
  taux: { disponible: false, message: "Taux de réponse non disponible" },
  ...sur,
});
const URL = "GET /api/qualite/satisfactions/synthese";
const champ = (libelle) => {
  const racine = dialogue() || document;
  const l = [...racine.querySelectorAll("label")].find((x) => x.textContent.replace(/\s*\(facultatif\)/, "").trim() === libelle);
  return l ? document.getElementById(l.htmlFor) : null;
};
const syntheses = (appels) => appels.filter((a) => a.methode === "GET" && a.chemin.startsWith("/api/qualite/satisfactions/synthese"));
const postsAction = (appels) => appels.filter((a) => a.methode === "POST" && a.chemin === "/api/actions-qualite");

test("pur : requête de filtres, moyenne liée à son échelle, provenance lisible", () => {
  assert.equal(requeteSynthese({ du: "2026-01-01", type: "", formation_id: "7" }), "?du=2026-01-01&formation_id=7");
  assert.equal(requeteSynthese({}), "");
  assert.equal(moyenneSurEchelle(3.6, 5), "3,6 / 5");
  assert.equal(libelleProvenanceSynthese({ du: "2026-01-01", au: "2026-06-30", type: null }), "Synthèse du 01/01/2026 au 30/06/2026 — tous publics");
});

test("navigation : entrée admin « Synthèse des satisfactions » ; contributeur sans entrée, accès direct bloqué sans appel", async () => {
  await monter("/accueil", "admin");
  await attendre(() => liensNavigation().length > 0);
  assert.ok(liensNavigation().includes("Synthèse des satisfactions"));
  await demonter();
  await monter("/accueil", "contributeur");
  await attendre(() => liensNavigation().length > 0);
  assert.ok(!liensNavigation().includes("Synthèse des satisfactions"));
  await demonter();
  const appels = await monter("/synthese-satisfactions", "contributeur", { [URL]: SYNTHESE() });
  await attendre(() => texte().includes("Cette page est réservée aux administrateurs."));
  assert.equal(syntheses(appels).length, 0);
});

test("synthèse : chiffres, publics, moyennes PAR échelle (aucune moyenne globale), répartition, taux indisponible, sessions sources", async () => {
  await monter("/synthese-satisfactions", "admin", { [URL]: SYNTHESE() });
  await attendre(() => texte().includes("Répartition par public"));
  const t = texte();
  for (const x of ["8", "du 05/03/2026 au 31/07/2026", "Taux de réponse non disponible", "À chaud", "Prescripteur", "Partenaire",
    "Échelle sur 5", "3,6 / 5", "Échelle sur 10", "7 / 10", "Plusieurs échelles de notation", "1 réponse(s) sans note", "SESS-TEST", "SESS-FINIE"]) assert.ok(t.includes(x), x);
  assert.ok(!t.includes("Commentaire") && !t.includes("Anonyme"), "aucune réponse individuelle");
  const lien = document.querySelector('a[aria-label="Ouvrir les réponses de la session SESS-TEST"]');
  assert.equal(lien.getAttribute("href"), "/sessions/1/satisfaction", "accès aux résultats sources");
  for (const tr of document.querySelectorAll("tbody tr")) {
    assert.ok([...tr.querySelectorAll("td:not(.sess-table__actions)")].every((td) => td.getAttribute("data-label")), "mobile 390 px : data-label");
  }
});

test("filtres : période, public, formation (sessions restreintes), session ; effacer ; état vide", async () => {
  const appels = await monter("/synthese-satisfactions", "admin", {
    [URL]: SYNTHESE(),
    "GET /api/qualite/satisfactions/synthese?du=2026-06-01": SYNTHESE({ reponses: 2 }),
    "GET /api/qualite/satisfactions/synthese?du=2026-06-01&type=partenaire": SYNTHESE({ reponses: 2 }),
    "GET /api/qualite/satisfactions/synthese?du=2026-06-01&formation_id=7&type=partenaire": SYNTHESE({ reponses: 0, publics: [], echelles: [], sessions: [], sans_note: 0, periode: { du: null, au: null } }),
  });
  await attendre(() => champ("Du"));
  await saisir(champ("Du"), "2026-06-01");
  await saisir(champ("Public interrogé"), "partenaire");
  await attendre(() => champ("Formation").options.length > 1);
  await saisir(champ("Formation"), "7");
  await attendre(() => texte().includes("Aucune réponse pour ces critères"));
  // L'état vide n'est servi QUE pour la requête exacte « du + formation + public » :
  // l'atteindre prouve que les trois filtres sont transmis (un appel par changement).
  assert.equal(syntheses(appels).length, 4);
  assert.ok([...champ("Session").options].slice(1).every((o) => o.textContent.endsWith("Formation test")), "sessions de la formation choisie seulement");
  assert.ok(!bouton("Créer une action qualité"), "rien à exploiter : pas d'action proposée");
  await cliquer(bouton("Effacer les filtres"));
  await attendre(() => texte().includes("Répartition par public"));
});

test("action depuis une synthèse : provenance (période, public, formation filtrée), aucune session inventée, rien de prérempli", async () => {
  const appels = await monter("/synthese-satisfactions", "admin", {
    [URL]: SYNTHESE(),
    "GET /api/qualite/satisfactions/synthese?type=partenaire": SYNTHESE({ reponses: 2 }),
    "GET /api/qualite/satisfactions/synthese?formation_id=7&type=partenaire": SYNTHESE({ reponses: 2 }),
    "POST /api/actions-qualite": (c) => [201, { action: { id: 12, reference: "AQ-2026-012", ...c } }],
  });
  await attendre(() => champ("Public interrogé"));
  await saisir(champ("Public interrogé"), "partenaire");
  await attendre(() => champ("Formation").options.length > 1);
  await saisir(champ("Formation"), "7");
  await attendre(() => syntheses(appels).length === 3 && bouton("Créer une action qualité"));
  await cliquer(bouton("Créer une action qualité"));
  await attendre(() => dialogue()?.textContent.includes("Action issue d'un retour de satisfaction"));
  assert.ok(dialogue().textContent.includes("Synthèse du 05/03/2026 au 31/07/2026 — Partenaire"));
  assert.ok(dialogue().textContent.includes("Aucune réponse individuelle n'est recopiée"));
  assert.equal(champ("Titre").value, "", "titre rédigé par l'admin");
  assert.equal(champ("Constat").value, "", "rien de recopié");
  await saisir(champ("Titre"), "Renforcer le lien avec les partenaires");
  await cliquer(document.querySelector('button[type="submit"][form="form-action-qualite"]'));
  await attendre(() => texte().includes("Action qualité créée."));
  const corps = postsAction(appels)[0].corps;
  assert.deepEqual([corps.satisfaction_du, corps.satisfaction_au, corps.satisfaction_public, corps.formation_id, corps.session_id, corps.satisfaction_id],
    ["2026-03-05", "2026-07-31", "partenaire", 7, null, undefined]);
  assert.equal(document.querySelector('a[href="/actions-qualite/12"]').textContent, "AQ-2026-012");
});

test("action depuis une synthèse : erreur serveur ⇒ saisie conservée ; double clic ⇒ un seul POST", async () => {
  const v = vanne();
  const appels = await monter("/synthese-satisfactions", "admin", {
    [URL]: SYNTHESE(),
    "POST /api/actions-qualite": async () => { await v.attendre(); return [400, { error: "Indiquez la période de la synthèse (dates AAAA-MM-JJ)." }]; },
  });
  await attendre(() => bouton("Créer une action qualité"));
  await cliquer(bouton("Créer une action qualité"));
  await attendre(() => champ("Titre"));
  await saisir(champ("Titre"), "Titre conservé");
  const b = document.querySelector('button[type="submit"][form="form-action-qualite"]');
  await cliquer(b); await cliquer(b);
  v.ouvrir();
  await attendre(() => dialogue()?.textContent.includes("Indiquez la période de la synthèse"));
  assert.equal(postsAction(appels).length, 1);
  assert.equal(champ("Titre").value, "Titre conservé");
});

test("action depuis une réponse (onglet de session, admin) : lien vers la réponse, session non modifiable, aucune donnée de la réponse recopiée", async () => {
  const appels = await monter("/sessions/1/satisfaction", "admin", {
    "GET /api/sessions/1/satisfactions": { agregation: { reponses: 1, anonymes: 0, nominatives: 1, moyenne: 2, echelleHomogene: 5 },
      satisfactions: [{ id: 40, type: "a_chaud", date_recueil: "2026-09-15", note_globale: 2, note_max: 5, commentaires: "Commentaire-identifiant-fictif", nom: "Martin", prenom: "Alice", inscription_id: 11, drive_file_id: "DRV-1" }] },
    "POST /api/actions-qualite": (c) => [201, { action: { id: 13, reference: "AQ-2026-013", ...c } }],
  });
  await attendre(() => document.querySelector('button[aria-label="Créer une action qualité depuis la réponse du 15/09/2026"]'));
  await cliquer(document.querySelector('button[aria-label="Créer une action qualité depuis la réponse du 15/09/2026"]'));
  await attendre(() => dialogue()?.textContent.includes("Action issue d'un retour de satisfaction"));
  const d = dialogue();
  assert.ok(d.textContent.includes("Réponse de satisfaction (À chaud, 15/09/2026)"));
  assert.ok(!d.textContent.includes("Commentaire-identifiant-fictif") && !d.textContent.includes("Martin"), "rien de la réponse dans le formulaire");
  assert.equal(champ("Session").value, "1");
  assert.equal(champ("Session").disabled, true, "session de la réponse, non modifiable");
  await saisir(champ("Titre"), "Revoir l'accueil");
  await cliquer(document.querySelector('button[type="submit"][form="form-action-qualite"]'));
  await attendre(() => postsAction(appels).length === 1);
  const corps = postsAction(appels)[0].corps;
  assert.equal(corps.satisfaction_id, 40);
  assert.equal(corps.session_id, 1);
  assert.ok(!JSON.stringify(corps).includes("Commentaire-identifiant") && !JSON.stringify(corps).includes("Martin") && !("satisfaction_public" in corps));
  await attendre(() => texte().includes("Action AQ-2026-013 créée depuis ce retour de satisfaction."));
});

test("tableau de bord : section « Satisfaction des parties prenantes » factuelle, moyennes par échelle, accès à la synthèse", async () => {
  const URL_TDB = `GET /api/qualite/tableau-de-bord?aujourdhui=${aujourdhuiISO()}`;
  const base = {
    aujourdhui: "2026-10-01",
    kpis: { actions: { ouvertes: 0, en_retard: 0, efficacite_a_verifier: 0, cloturees: 0, ouvertes_avec_preuve: 0, ouvertes_sans_preuve: 0 },
      signalements: { a_traiter: 0, reclamations_en_retard: 0, resolus_a_cloturer: 0, clotures: 0, actifs_avec_preuve: 0, actifs_sans_preuve: 0 }, preuves: { total: 0 } },
    priorites: [], indicateurs: [], activite_recente: [],
    satisfaction: { reponses: 10, publics: ["a_chaud", "partenaire"], periode: { du: "2026-03-05", au: "2026-07-31" },
      echelles: [{ echelle: 5, reponses: 7, moyenne: 3.71 }, { echelle: 10, reponses: 2, moyenne: 7 }] },
  };
  await monter("/tableau-de-bord-qualite", "admin", { [URL_TDB]: base });
  await attendre(() => texte().includes("Satisfaction des parties prenantes"));
  const t = texte();
  for (const x of ["Réponses enregistrées", "10", "À chaud, Partenaire", "du 05/03/2026 au 31/07/2026", "Moyenne (échelle sur 5)", "3,71 / 5", "Moyenne (échelle sur 10)", "7 / 10"]) assert.ok(t.includes(x), x);
  assert.ok([...document.querySelectorAll('a[href="/synthese-satisfactions"]')].some((a) => a.textContent === "Voir la synthèse des satisfactions"));
  assert.ok(t.includes("Actions ouvertes"), "sections Q1 conservées");
});
