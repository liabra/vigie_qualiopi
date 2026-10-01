// Q1-B3-B2 — Signalements : formulaire (création / modification), fiche,
// transitions, historique, confidentialité et droits. API simulée ;
// aucun window.alert / window.confirm toléré.
import "./dom.mjs";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { attendre, bouton, cliquer, demonter, dialogue, monter, saisir, texte, touche } from "./outils.jsx";
import { aujourdhuiISO } from "../src/qualite/format.js";

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

// Champ par libellé, cherché DANS le dialogue ouvert s'il y en a un (la
// liste, derrière le panneau, a aussi un filtre « Session »).
const champ = (libelle) => {
  const racine = dialogue() || document;
  const label = [...racine.querySelectorAll("label")].find((l) => l.textContent.replace(/\s*\(facultatif\)/, "").trim() === libelle);
  return label ? document.getElementById(label.htmlFor) : null;
};

// ── Données simulées ─────────────────────────────────────────
const SESSIONS_ACTIVES = [{ id: 5, reference: "ADVF-2026-09", formation: "Aide à domicile", archivee_le: null, groupes: [] }];
const SESSIONS_ARCHIVEES = [{ id: 6, reference: "SST-2025-01", formation: "Sauveteur secouriste", archivee_le: "2026-01-10T00:00:00Z", groupes: [] }];

const DETAIL_SESSION_5 = {
  session: { id: 5 }, groupes: [], documents: [],
  stagiaires: [
    { inscription_id: 11, id: 101, nom: "Martin", prenom: "Alice", statut: "inscrit", email: "alice.secret@exemple.fr", telephone: "0611223344", situation_handicap: true, besoins_adaptation: "Besoin-Confidentiel" },
    { inscription_id: 12, id: 102, nom: "Bernard", prenom: "Paul", statut: "abandon", email: "paul@exemple.fr", telephone: null, situation_handicap: false, besoins_adaptation: null },
  ],
};
const REFERENTIEL = {
  version: { id: 1, code: "V9" }, totalIndicateurs: 2,
  score: { maitrise: 0, a_consolider: 0, a_risque: 0, non_applicable: 0, total: 2, preuves: 0, a_confirmer: 0 },
  criteres: [{ id: 7, numero: 7, libelle: "Recueil des appréciations et réclamations", indicateurs: [
    { id: 31, numero: 31, libelle: "Traitement des réclamations" },
    { id: 32, numero: 32, libelle: "Amélioration continue" },
  ] }],
};
const signalement = (sur = {}) => ({
  id: 1, reference: "REC-2026-001", type: "reclamation", objet: "Convocation tardive", description: "Reçue la veille",
  date_constat: "2026-09-28", canal: "email", reclamant_nom: "Jean Dupont", reclamant_entreprise: "ACME", reclamant_email: "j.dupont@acme.fr",
  inscription_id: null, personne_concernee_libelle: null, responsable_id: 2, responsable_nom: "Tukui",
  formation_id: 7, session_id: 5, cause_autre_libelle: null, statut: "ouverte", delai_cible_jours_ouvres: 15,
  date_echeance_cible: "2099-10-19", synthese_reponse: null, date_reponse: null, date_resolution: null, date_cloture: null,
  cree_par: 1, cree_par_nom: "Mme Stark", cloture_par: null, cloture_par_nom: null, annulee_par: null, annulee_par_nom: null,
  indicateurs: [], causes: ["organisation"], nb_actions: 0, ...sur,
});
const detail = (sur = {}, extra = {}) => ({ signalement: signalement(sur), actions: [], historique: [], ...extra });
const routes = (sur = {}) => ({
  "GET /api/sessions": { sessions: SESSIONS_ACTIVES },
  "GET /api/sessions?etat=archivees": { sessions: SESSIONS_ARCHIVEES },
  "GET /api/sessions/5": DETAIL_SESSION_5,
  "GET /api/referentiel": REFERENTIEL,
  "GET /api/signalements": { signalements: [signalement()], total: 1 },
  "GET /api/signalements/1": detail(),
  ...sur,
});
const soumettre = () => cliquer(document.querySelector('button[type="submit"][form="form-signalement"]'));
const cocher = async (libelle) => cliquer([...document.querySelectorAll("label.ui-case")].find((l) => l.textContent.trim() === libelle).querySelector("input"));
const ouvrirCreation = async (sur = {}) => {
  const appels = await monter("/signalements-qualite", "admin", routes(sur));
  await attendre(() => bouton("Nouveau signalement"));
  await cliquer(bouton("Nouveau signalement"));
  await attendre(() => dialogue()?.textContent.includes("Nouveau signalement") && champ("Session")?.options.length > 2);
  return appels;
};
const corpsPost = (appels) => appels.find((a) => a.methode === "POST" && a.chemin === "/api/signalements")?.corps;
const creeOk = (corps) => [201, { signalement: { id: 42, ...corps } }];

// ── FORMULAIRE : création ────────────────────────────────────

test("création réclamation : corps minimal, clés vides omises, redirection vers la fiche", async () => {
  const appels = await ouvrirCreation({ "POST /api/signalements": creeOk, "GET /api/signalements/42": detail({ id: 42 }) });
  assert.equal(champ("Type").value, "reclamation");
  assert.ok(champ("Date de réception"), "libellé réclamation");
  await saisir(champ("Objet"), "Convocation tardive");
  await soumettre();
  await attendre(() => corpsPost(appels));
  assert.deepEqual(corpsPost(appels), { type: "reclamation", objet: "Convocation tardive" }, "délai et échéance omis : défaut serveur");
  await attendre(() => window.location.pathname === "/signalements-qualite/42");
});

test("création incident et non-conformité : libellé « Date de constat », aucun champ réclamant", async () => {
  for (const type of ["incident", "non_conformite"]) {
    const appels = await ouvrirCreation({ "POST /api/signalements": creeOk, "GET /api/signalements/42": detail({ id: 42, type }) });
    await saisir(champ("Type"), type);
    assert.ok(champ("Date de constat"), "libellé constat");
    assert.equal(champ("Nom du réclamant"), null, "section réclamant masquée");
    await saisir(champ("Objet"), `Objet ${type}`);
    await saisir(champ("Date de constat"), "2026-09-29");
    await soumettre();
    await attendre(() => corpsPost(appels));
    assert.deepEqual(corpsPost(appels), { type, objet: `Objet ${type}`, date_constat: "2026-09-29" });
    await demonter();
  }
});

test("réclamant : section visible pour une réclamation, omise si le type change", async () => {
  const appels = await ouvrirCreation({ "POST /api/signalements": creeOk, "GET /api/signalements/42": detail({ id: 42, type: "incident" }) });
  for (const l of ["Nom du réclamant", "Entreprise / organisme", "E-mail", "Canal"]) assert.ok(champ(l), l);
  assert.equal(champ("Adresse"), null);
  assert.ok(!/téléphone/i.test(dialogue().textContent), "ni téléphone ni adresse demandés");
  assert.ok(dialogue().textContent.includes("15 jours ouvrés par défaut — calcul indicatif du lundi au vendredi."));
  await saisir(champ("Nom du réclamant"), "Jean Dupont");
  await saisir(champ("E-mail"), "j@acme.fr");
  await saisir(champ("Canal"), "poste");
  await saisir(champ("Type"), "incident");
  await saisir(champ("Objet"), "Panne");
  await soumettre();
  await attendre(() => corpsPost(appels));
  const c = corpsPost(appels);
  for (const k of ["reclamant_nom", "reclamant_email", "canal", "delai_cible_jours_ouvres", "date_echeance_cible"]) assert.ok(!(k in c), k);
});

test("objet obligatoire, date_resolution jamais proposée ni envoyée", async () => {
  const appels = await ouvrirCreation({ "POST /api/signalements": creeOk });
  assert.ok(!/résolution/i.test(dialogue().textContent), "aucun champ de résolution");
  await soumettre();
  await attendre(() => texte().includes("Indiquez l'objet du signalement."));
  assert.equal(champ("Objet").getAttribute("aria-invalid"), "true");
  assert.ok(!corpsPost(appels), "aucun appel serveur");
});

test("délai et échéance renseignés : envoyés ; vides : omis", async () => {
  const appels = await ouvrirCreation({ "POST /api/signalements": creeOk, "GET /api/signalements/42": detail({ id: 42 }) });
  await saisir(champ("Objet"), "Délai");
  await saisir(champ("Délai cible (jours ouvrés)"), "10");
  await saisir(champ("Échéance cible"), "2026-10-20");
  await soumettre();
  await attendre(() => corpsPost(appels));
  assert.equal(corpsPost(appels).delai_cible_jours_ouvres, 10);
  assert.equal(corpsPost(appels).date_echeance_cible, "2026-10-20");
});

test("causes multiples ; « Autre » affiche et exige sa précision ; retrait sans texte orphelin", async () => {
  const appels = await ouvrirCreation({ "POST /api/signalements": creeOk, "GET /api/signalements/42": detail({ id: 42 }) });
  await saisir(champ("Objet"), "Causes");
  await cocher("Organisation");
  await cocher("Logistique");
  assert.equal(champ("Précisez la cause"), null);
  await cocher("Autre");
  assert.ok(champ("Précisez la cause"), "champ affiché");
  await soumettre();
  await attendre(() => texte().includes("Précisez la cause « Autre »."));
  assert.ok(!corpsPost(appels), "bloqué côté client");
  await saisir(champ("Précisez la cause"), "Salle trop petite");
  await cocher("Autre");
  assert.equal(champ("Précisez la cause"), null, "champ retiré avec « Autre »");
  await cocher("Autre");
  assert.equal(champ("Précisez la cause").value, "", "pas de texte orphelin conservé");
  await saisir(champ("Précisez la cause"), "Bruit");
  await soumettre();
  await attendre(() => corpsPost(appels));
  assert.deepEqual(corpsPost(appels).causes, ["organisation", "logistique", "autre"]);
  assert.equal(corpsPost(appels).cause_autre_libelle, "Bruit");
});

test("erreur 400 du serveur affichée proprement dans le formulaire", async () => {
  await ouvrirCreation({ "POST /api/signalements": [400, { error: "L'inscription n'appartient pas à la session indiquée." }] });
  await saisir(champ("Objet"), "Incohérent");
  await soumettre();
  await attendre(() => texte().includes("L'inscription n'appartient pas à la session indiquée."));
  assert.ok(dialogue(), "le formulaire reste ouvert");
});

test("indicateurs : sélection envoyée", async () => {
  const appels = await ouvrirCreation({ "POST /api/signalements": creeOk, "GET /api/signalements/42": detail({ id: 42 }) });
  await saisir(champ("Objet"), "Indicateurs");
  await cliquer(dialogue().querySelector(".indic-groupe__tete"));
  await cliquer([...dialogue().querySelectorAll("label")].find((l) => l.textContent.includes("Indicateur 31")).querySelector("input"));
  await soumettre();
  await attendre(() => corpsPost(appels));
  assert.deepEqual(corpsPost(appels).indicateur_ids, [31]);
});

test("session → inscriptions chargées à la demande, sans donnée personnelle ; formation déduite", async () => {
  const appels = await ouvrirCreation({ "POST /api/signalements": creeOk, "GET /api/signalements/42": detail({ id: 42 }) });
  assert.ok(!appels.some((a) => a.chemin === "/api/sessions/5"), "rien avant le choix d'une session");
  const opts = [...champ("Session").options].map((o) => o.textContent);
  assert.ok(opts.includes("SST-2025-01 — Sauveteur secouriste (archivée)"), "session archivée marquée");
  await saisir(champ("Session"), "5");
  await attendre(() => champ("Stagiaire concerné"));
  assert.equal(appels.filter((a) => a.chemin === "/api/sessions/5").length, 1, "un seul appel");
  assert.ok(texte().includes("Formation de la session : Aide à domicile"));
  assert.equal(champ("Formation"), null, "pas de formation contradictoire proposée");
  const html = document.body.innerHTML;
  for (const secret of ["alice.secret@exemple.fr", "0611223344", "Besoin-Confidentiel"]) assert.ok(!html.includes(secret), `absent : ${secret}`);
  assert.deepEqual([...champ("Stagiaire concerné").options].map((o) => o.textContent), ["Aucun stagiaire de cette session", "Martin Alice", "Bernard Paul (abandon)"]);
  await saisir(champ("Stagiaire concerné"), "11");
  assert.equal(champ("Personne concernée (si elle n'est pas liée à une inscription)"), null, "pas de double saisie");
  await saisir(champ("Objet"), "Contexte");
  await soumettre();
  await attendre(() => corpsPost(appels));
  const c = corpsPost(appels);
  assert.equal(c.session_id, 5);
  assert.equal(c.inscription_id, 11);
  assert.ok(!("formation_id" in c));
});

test("changer puis retirer la session remet l'inscription à zéro", async () => {
  const appels = await ouvrirCreation({ "POST /api/signalements": creeOk, "GET /api/signalements/42": detail({ id: 42 }), "GET /api/sessions/6": { session: { id: 6 }, groupes: [], documents: [], stagiaires: [] } });
  await saisir(champ("Session"), "5");
  await attendre(() => champ("Stagiaire concerné"));
  await saisir(champ("Stagiaire concerné"), "11");
  await saisir(champ("Session"), "6");
  await attendre(() => champ("Stagiaire concerné") && champ("Stagiaire concerné").options.length === 1);
  assert.equal(champ("Stagiaire concerné").value, "", "inscription remise à zéro au changement");
  await saisir(champ("Session"), "5");
  await attendre(() => champ("Stagiaire concerné")?.options.length === 3);
  await saisir(champ("Stagiaire concerné"), "11");
  await saisir(champ("Session"), "");
  assert.equal(champ("Stagiaire concerné"), null);
  assert.ok(champ("Formation"), "formation seule proposée sans session");
  await saisir(champ("Formation"), "7");
  await saisir(champ("Objet"), "Sans session");
  await soumettre();
  await attendre(() => corpsPost(appels));
  const c = corpsPost(appels);
  assert.equal(c.formation_id, 7);
  assert.ok(!("session_id" in c) && !("inscription_id" in c), "aucune inscription orpheline envoyée");
});

// ── FICHE ────────────────────────────────────────────────────

test("fiche : en-tête, contexte, réclamant, causes, traitement, noms", async () => {
  await monter("/signalements-qualite/1", "admin", routes({
    "GET /api/signalements/1": detail({ inscription_id: 11, causes: ["organisation", "autre"], cause_autre_libelle: "Salle trop petite", synthese_reponse: "Excuses envoyées", date_reponse: "2026-09-29" }),
  }));
  await attendre(() => document.querySelector("h1")?.textContent === "Convocation tardive" && texte().includes("Martin Alice"));
  for (const t of ["REC-2026-001", "Réclamation", "Ouverte", "Aide à domicile", "ADVF-2026-09", "Tukui", "Mme Stark",
    "Jean Dupont", "ACME", "j.dupont@acme.fr", "E-mail", "Organisation", "Autre — Salle trop petite", "Excuses envoyées", "29/09/2026", "19/10/2099"]) {
    assert.ok(texte().includes(t), t);
  }
  assert.ok(!document.body.innerHTML.includes("alice.secret@exemple.fr"), "aucune donnée stagiaire superflue");
  assert.equal(document.title, "Signalement — Vigie Qualiopi");
});

test("fiche incident : pas de section réclamant", async () => {
  await monter("/signalements-qualite/1", "admin", routes({ "GET /api/signalements/1": detail({ type: "incident", reclamant_nom: null, reclamant_email: null, reclamant_entreprise: null, canal: null }) }));
  await attendre(() => document.querySelector("h1")?.textContent === "Convocation tardive");
  assert.ok(!document.getElementById("sig-reclamant"));
  assert.ok(texte().includes("Date de constat"));
});

test("fiche : actions qualité liées, lien vers leur fiche, pas de bouton de création", async () => {
  await monter("/signalements-qualite/1", "admin", routes({
    "GET /api/signalements/1": detail({}, { actions: [{ id: 3, reference: "AQ-2026-003", titre: "Revoir le délai des convocations", statut: "en_cours" }] }),
  }));
  await attendre(() => texte().includes("Revoir le délai des convocations"));
  const lien = [...document.querySelectorAll("a")].find((a) => a.textContent === "Revoir le délai des convocations");
  assert.equal(lien.getAttribute("href"), "/actions-qualite/3");
  assert.ok(texte().includes("AQ-2026-003") && texte().includes("En cours"));
  assert.ok(![...document.querySelectorAll("button, a")].some((b) => /créer une action/i.test(b.textContent)), "création d'action liée réservée à B3");
});

test("historique : libellés lisibles, acteur désactivé conservé, contenu sensible jamais affiché, indicateur de repli", async () => {
  await monter("/signalements-qualite/1", "admin", routes({
    "GET /api/signalements/1": detail({ indicateurs: [{ id: 31, numero: 31, libelle: "Traitement des réclamations" }] }, { historique: [
      { id: 1, evenement: "creation", champ: "statut", ancienne_valeur: null, nouvelle_valeur: "ouverte", par: 9, acteur_nom: "Mme Ancienne", cree_le: "2026-09-28T09:00:00Z" },
      { id: 2, evenement: "rattachement_indicateur", champ: "indicateur_id", ancienne_valeur: null, nouvelle_valeur: "31", par: 9, acteur_nom: "Mme Ancienne", cree_le: "2026-09-28T09:00:01Z" },
      { id: 3, evenement: "retrait_indicateur", champ: "indicateur_id", ancienne_valeur: "404", nouvelle_valeur: null, par: 1, acteur_nom: "Mme Stark", cree_le: "2026-09-28T10:00:00Z" },
      { id: 4, evenement: "modification", champ: "description", ancienne_valeur: "SECRET-ANCIEN", nouvelle_valeur: "SECRET-NOUVEAU", par: 1, acteur_nom: "Mme Stark", cree_le: "2026-09-28T11:00:00Z" },
      { id: 5, evenement: "modification", champ: "responsable_id", ancienne_valeur: "9", nouvelle_valeur: "2", par: 1, acteur_nom: "Mme Stark", cree_le: "2026-09-28T12:00:00Z" },
      { id: 6, evenement: "qualifier", champ: "statut", ancienne_valeur: "ouverte", nouvelle_valeur: "qualifiee", par: null, acteur_nom: null, cree_le: "2026-09-29T09:00:00Z" },
    ] }),
  }));
  await attendre(() => texte().includes("Signalement créé"));
  const h = document.querySelector(".qualite-historique").textContent;
  for (const t of ["Signalement créé", "Mme Ancienne", "Indicateur ajouté : Indicateur 31 — Traitement des réclamations",
    "Indicateur retiré : Indicateur historique (ID interne 404)", "Description modifiée", "Responsable : Mme Ancienne → Tukui",
    "Signalement qualifié", "Utilisateur indisponible"]) assert.ok(h.includes(t), t);
  assert.ok(!h.includes("SECRET"), "aucun contenu sensible");
});

test("signalement inexistant : message neutre", async () => {
  await monter("/signalements-qualite/999", "admin", routes({ "GET /api/signalements/999": [404, { error: "Signalement introuvable." }] }));
  await attendre(() => texte().includes("Ce signalement n'existe pas ou n'existe plus."));
});

// ── TRANSITIONS ──────────────────────────────────────────────

const boutonsMetier = () => [...(document.querySelector('[aria-label="Actions sur le signalement"]')?.querySelectorAll("button") || [])].map((b) => b.textContent);

test("boutons exacts pour chaque statut (annulé : aucun)", async () => {
  const attendus = {
    ouverte: ["Modifier", "Qualifier", "Annuler"], qualifiee: ["Modifier", "Démarrer le traitement", "Annuler"],
    en_traitement: ["Modifier", "Résoudre", "Annuler"], resolue: ["Modifier", "Clôturer", "Annuler"],
    cloturee: ["Réouvrir"], annulee: [],
  };
  for (const [statut, boutons] of Object.entries(attendus)) {
    await monter("/signalements-qualite/1", "admin", routes({ "GET /api/signalements/1": detail({ statut }) }));
    await attendre(() => document.querySelector("h1")?.textContent === "Convocation tardive");
    assert.deepEqual(boutonsMetier(), boutons, statut);
    await demonter();
  }
});

// Détail qui suit les transitions (le serveur change le statut).
function serveurStatut(initial, sur = {}) {
  let etat = { ...signalement({ statut: initial }), ...sur };
  const vers = { qualifier: "qualifiee", traiter: "en_traitement", resoudre: "resolue", cloturer: "cloturee", rouvrir: "en_traitement", annuler: "annulee" };
  const r = routes({ "GET /api/signalements/1": () => ({ signalement: etat, actions: [], historique: [] }) });
  for (const [t, st] of Object.entries(vers)) {
    r[`PATCH /api/signalements/1/${t}`] = (corps) => { etat = { ...etat, statut: st, ...(t === "resoudre" ? corps : {}) }; return { signalement: etat }; };
  }
  return r;
}

test("qualifier puis démarrer le traitement : PATCH dédiés, fiche rechargée", async () => {
  const appels = await monter("/signalements-qualite/1", "admin", serveurStatut("ouverte"));
  await attendre(() => bouton("Qualifier"));
  await cliquer(bouton("Qualifier"));
  await attendre(() => bouton("Démarrer le traitement"));
  await cliquer(bouton("Démarrer le traitement"));
  await attendre(() => bouton("Résoudre"));
  assert.ok(appels.some((a) => a.methode === "PATCH" && a.chemin === "/api/signalements/1/qualifier"));
  assert.ok(appels.some((a) => a.methode === "PATCH" && a.chemin === "/api/signalements/1/traiter"));
  assert.ok(texte().includes("En traitement"));
});

test("résoudre : dialogue prérempli, date de résolution LOCALE du jour, corps envoyé", async () => {
  const appels = await monter("/signalements-qualite/1", "admin", serveurStatut("en_traitement", { synthese_reponse: "Excuses envoyées", date_reponse: "2026-09-29" }));
  await attendre(() => bouton("Résoudre"));
  await cliquer(bouton("Résoudre"));
  await attendre(() => dialogue()?.textContent.includes("Résoudre le signalement"));
  assert.equal(champ("Synthèse de la réponse").value, "Excuses envoyées");
  assert.equal(champ("Date de réponse").value, "2026-09-29");
  assert.equal(champ("Date de résolution").value, aujourdhuiISO(), "date locale du navigateur");
  await saisir(champ("Date de résolution"), "2026-09-30");
  await cliquer(document.querySelector('button[type="submit"][form="form-resolution"]'));
  await attendre(() => appels.some((a) => a.chemin === "/api/signalements/1/resoudre"));
  assert.deepEqual(appels.find((a) => a.chemin === "/api/signalements/1/resoudre").corps,
    { synthese_reponse: "Excuses envoyées", date_reponse: "2026-09-29", date_resolution: "2026-09-30" });
  await attendre(() => bouton("Clôturer"));
});

test("clôture : désactivée sans indicateur (explication), possible avec indicateur", async () => {
  await monter("/signalements-qualite/1", "admin", routes({ "GET /api/signalements/1": detail({ statut: "resolue", indicateurs: [] }) }));
  await attendre(() => bouton("Clôturer"));
  assert.equal(bouton("Clôturer").disabled, true);
  assert.ok(texte().includes("Au moins un indicateur Qualiopi doit être associé avant la clôture."));
  assert.equal(bouton("Clôturer").getAttribute("aria-describedby"), "cloture-aide");
  await demonter();
  const appels = await monter("/signalements-qualite/1", "admin", serveurStatut("resolue", { indicateurs: [{ id: 31, numero: 31, libelle: "Traitement des réclamations" }] }));
  await attendre(() => bouton("Clôturer") && !bouton("Clôturer").disabled);
  await cliquer(bouton("Clôturer"));
  await attendre(() => dialogue()?.getAttribute("role") === "alertdialog");
  await cliquer([...dialogue().querySelectorAll("button")].find((b) => b.textContent === "Clôturer"));
  await attendre(() => appels.some((a) => a.chemin === "/api/signalements/1/cloturer"));
  await attendre(() => bouton("Réouvrir"));
});

test("409 du serveur affiché proprement", async () => {
  await monter("/signalements-qualite/1", "admin", routes({
    "GET /api/signalements/1": detail({ statut: "resolue", indicateurs: [{ id: 31, numero: 31, libelle: "X" }] }),
    "PATCH /api/signalements/1/cloturer": [409, { error: "Au moins un indicateur est requis avant clôture." }],
  }));
  await attendre(() => bouton("Clôturer"));
  await cliquer(bouton("Clôturer"));
  await attendre(() => dialogue());
  await cliquer([...dialogue().querySelectorAll("button")].find((b) => b.textContent === "Clôturer"));
  await attendre(() => texte().includes("Au moins un indicateur est requis avant clôture."));
  assert.ok(texte().includes("L'opération n'a pas abouti."));
});

test("annulation : ConfirmDialog explicite (Échap n'annule rien), puis plus aucune action", async () => {
  const appels = await monter("/signalements-qualite/1", "admin", serveurStatut("qualifiee"));
  await attendre(() => bouton("Annuler"));
  await cliquer(bouton("Annuler"));
  await attendre(() => dialogue()?.textContent.includes("L'annulation est définitive pour ce signalement."));
  await touche("Escape");
  await attendre(() => !dialogue());
  assert.ok(!appels.some((a) => a.chemin === "/api/signalements/1/annuler"));
  await cliquer(bouton("Annuler"));
  await attendre(() => dialogue());
  await cliquer(bouton("Annuler le signalement"));
  await attendre(() => appels.some((a) => a.chemin === "/api/signalements/1/annuler"));
  await attendre(() => texte().includes("aucune action n'est plus possible"));
  assert.deepEqual(boutonsMetier(), []);
});

test("réouverture confirmée : le signalement repasse en traitement", async () => {
  const appels = await monter("/signalements-qualite/1", "admin", serveurStatut("cloturee", { indicateurs: [{ id: 31, numero: 31, libelle: "X" }] }));
  await attendre(() => bouton("Réouvrir"));
  await cliquer(bouton("Réouvrir"));
  await attendre(() => dialogue()?.textContent.includes("repassera « En traitement »"));
  await cliquer([...dialogue().querySelectorAll("button")].find((b) => b.textContent === "Réouvrir"));
  await attendre(() => appels.some((a) => a.chemin === "/api/signalements/1/rouvrir"));
  await attendre(() => bouton("Résoudre"));
});

// ── DROITS ───────────────────────────────────────────────────

test("contributeur : fiche bloquée sans aucun appel à l'API des signalements", async () => {
  const appels = await monter("/signalements-qualite/1", "contributeur", routes());
  await attendre(() => texte().includes("Cette page est réservée aux administrateurs."));
  assert.ok(!appels.some((a) => a.chemin.startsWith("/api/signalements")), "aucun appel");
  assert.ok(!texte().includes("Jean Dupont"));
});

// ── MODIFICATION ─────────────────────────────────────────────

test("modification : formulaire prérempli, type figé, réponse modifiable, jamais de date de résolution", async () => {
  const appels = await monter("/signalements-qualite/1", "admin", routes({
    "GET /api/signalements/1": detail({ statut: "en_traitement", inscription_id: 11, indicateurs: [{ id: 31, numero: 31, libelle: "Traitement des réclamations" }] }),
    "PATCH /api/signalements/1": (corps) => ({ signalement: { ...signalement(), ...corps } }),
    "GET /api/sessions/6": { session: { id: 6 }, groupes: [], documents: [], stagiaires: [] },
  }));
  await attendre(() => bouton("Modifier"));
  await cliquer(bouton("Modifier"));
  await attendre(() => dialogue()?.textContent.includes("Modifier le signalement") && champ("Stagiaire concerné")?.options.length === 3);
  assert.equal(champ("Type"), null, "type non modifiable");
  assert.ok(dialogue().textContent.includes("non modifiable après création"));
  assert.equal(champ("Objet").value, "Convocation tardive");
  assert.equal(champ("Nom du réclamant").value, "Jean Dupont");
  assert.equal(champ("Session").value, "5");
  assert.equal(champ("Stagiaire concerné").value, "11");
  assert.ok(!/date de résolution/i.test(dialogue().textContent));
  await saisir(champ("Synthèse de la réponse"), "Réponse envoyée par courriel");
  await saisir(champ("Date de réponse"), "2026-09-30");
  await saisir(champ("Session"), "6");
  await attendre(() => champ("Stagiaire concerné"));
  assert.equal(champ("Stagiaire concerné").value, "", "changement de session : inscription effacée");
  await soumettre();
  await attendre(() => appels.some((a) => a.methode === "PATCH" && a.chemin === "/api/signalements/1"));
  const c = appels.find((a) => a.methode === "PATCH" && a.chemin === "/api/signalements/1").corps;
  assert.equal(c.synthese_reponse, "Réponse envoyée par courriel");
  assert.equal(c.date_reponse, "2026-09-30");
  assert.equal(c.session_id, 6);
  assert.equal(c.inscription_id, null);
  assert.equal(c.formation_id, null);
  assert.deepEqual(c.indicateur_ids, [31], "indicateurs existants conservés");
  assert.ok(!("type" in c) && !("date_resolution" in c));
  assert.ok(!("responsable_id" in c), "responsable inchangé non renvoyé");
});

test("liste : bouton Nouveau signalement et objet cliquable vers la fiche", async () => {
  await monter("/signalements-qualite", "admin", routes());
  await attendre(() => texte().includes("Convocation tardive"));
  assert.ok(bouton("Nouveau signalement"));
  const lien = [...document.querySelectorAll("tbody a")].find((a) => a.textContent === "Convocation tardive");
  assert.equal(lien.getAttribute("href"), "/signalements-qualite/1");
  await cliquer(lien);
  await attendre(() => window.location.pathname === "/signalements-qualite/1" && document.querySelector("h1")?.textContent === "Convocation tardive");
});

// ── Revue B2 : P2 corrigés et cas R1 à R7 ────────────────────────
const patchs = (appels, chemin = "/api/signalements/1") => appels.filter((a) => a.methode === "PATCH" && a.chemin === chemin);
const okPatch = (corps) => ({ signalement: { ...signalement(), ...corps } });
const ouvrirModif = async (sur) => {
  const appels = await monter("/signalements-qualite/1", "admin", routes(sur));
  await attendre(() => bouton("Modifier"));
  await cliquer(bouton("Modifier"));
  await attendre(() => dialogue()?.textContent.includes("Modifier le signalement") && champ("Objet"));
  return appels;
};

test("R1 responsable désactivé : visible « (inactif) », autre champ modifié, responsable non renvoyé", async () => {
  const appels = await ouvrirModif({ "GET /api/signalements/1": detail({ responsable_id: 9, responsable_nom: "Mme Ancienne" }), "PATCH /api/signalements/1": okPatch });
  assert.equal(champ("Responsable").value, "9");
  assert.ok([...champ("Responsable").options].some((o) => o.textContent === "Mme Ancienne (inactif)"));
  await saisir(champ("Objet"), "Objet modifié");
  await soumettre();
  await attendre(() => patchs(appels).length === 1);
  const c = patchs(appels)[0].corps;
  assert.equal(c.objet, "Objet modifié");
  assert.ok(!("responsable_id" in c), "aucune tentative de réaffectation");
  await attendre(() => !dialogue());
});

test("R2 suppression volontaire du responsable : responsable_id null", async () => {
  const appels = await ouvrirModif({ "PATCH /api/signalements/1": okPatch });
  await saisir(champ("Responsable"), "");
  await soumettre();
  await attendre(() => patchs(appels).length === 1);
  assert.equal(patchs(appels)[0].corps.responsable_id, null);
});

test("R3 vidage complet en modification : causes [] et indicateur_ids [] envoyés", async () => {
  const appels = await ouvrirModif({ "GET /api/signalements/1": detail({ causes: ["organisation"], indicateurs: [{ id: 31, numero: 31, libelle: "Traitement des réclamations" }] }), "PATCH /api/signalements/1": okPatch });
  await cocher("Organisation");
  await cliquer(dialogue().querySelector('button[aria-label="Retirer l\'indicateur 31"]'));
  await soumettre();
  await attendre(() => patchs(appels).length === 1);
  const c = patchs(appels)[0].corps;
  assert.deepEqual(c.causes, []);
  assert.deepEqual(c.indicateur_ids, []);
  assert.equal(c.cause_autre_libelle, null);
});

test("R4 / P2-1 échec de Résoudre : panneau ouvert, saisie conservée, erreur affichée, nouvel essai possible", async () => {
  let essais = 0;
  const appels = await monter("/signalements-qualite/1", "admin", routes({
    "GET /api/signalements/1": detail({ statut: "en_traitement" }),
    "PATCH /api/signalements/1/resoudre": (corps) => (essais++ === 0 ? [400, { error: "Date de résolution invalide : format attendu AAAA-MM-JJ." }] : { signalement: signalement({ statut: "resolue", ...corps }) }),
  }));
  await attendre(() => bouton("Résoudre"));
  await cliquer(bouton("Résoudre"));
  await attendre(() => dialogue());
  await saisir(champ("Synthèse de la réponse"), "Texte saisi par l'utilisateur");
  await saisir(champ("Date de résolution"), "2026-09-30");
  await cliquer(document.querySelector('button[type="submit"][form="form-resolution"]'));
  await attendre(() => dialogue()?.textContent.includes("Date de résolution invalide"));
  assert.ok(dialogue().textContent.includes("Le signalement n'a pas été résolu."));
  assert.equal(champ("Synthèse de la réponse").value, "Texte saisi par l'utilisateur", "saisie conservée");
  assert.equal(champ("Date de résolution").value, "2026-09-30");
  assert.ok(!document.querySelector(".qualite-badges ~ .ui-alert"), "pas d'erreur dupliquée sur la fiche");
  await cliquer(document.querySelector('button[type="submit"][form="form-resolution"]'));
  await attendre(() => !dialogue());
  assert.equal(patchs(appels, "/api/signalements/1/resoudre").length, 2);
  assert.equal(patchs(appels, "/api/signalements/1/resoudre")[1].corps.synthese_reponse, "Texte saisi par l'utilisateur");
});

test("R5 / P2-3 échec du chargement des inscriptions : message clair, inscription liée conservée", async () => {
  const appels = await ouvrirModif({ "GET /api/signalements/1": detail({ inscription_id: 11 }), "GET /api/sessions/5": [500, { error: "Erreur" }], "PATCH /api/signalements/1": okPatch });
  await attendre(() => dialogue().textContent.includes("Impossible de charger les inscriptions de cette session."));
  assert.ok(dialogue().textContent.includes("L'inscription actuellement liée est conservée."));
  assert.equal(champ("Stagiaire concerné"), null, "pas de liste trompeuse « Aucun stagiaire »");
  assert.equal(champ("Personne concernée (si elle n'est pas liée à une inscription)"), null);
  await soumettre();
  await attendre(() => patchs(appels).length === 1);
  assert.equal(patchs(appels)[0].corps.inscription_id, 11, "liaison conservée");
  assert.equal(patchs(appels)[0].corps.session_id, 5);
});

test("P2-3 échec en création : message clair, rien de rattaché", async () => {
  await ouvrirCreation({ "GET /api/sessions/5": [500, { error: "Erreur" }] });
  await saisir(champ("Session"), "5");
  await attendre(() => dialogue().textContent.includes("Impossible de charger les inscriptions de cette session."));
  assert.ok(!dialogue().textContent.includes("L'inscription actuellement liée est conservée."));
});

test("P2-3 session liée absente des listes : signalée, liaison conservée", async () => {
  const appels = await ouvrirModif({ "GET /api/signalements/1": detail({ session_id: 77, inscription_id: 11 }), "GET /api/sessions/77": [404, { error: "Session introuvable." }], "PATCH /api/signalements/1": okPatch });
  await attendre(() => dialogue().textContent.includes("Session liée indisponible dans la liste actuelle."));
  assert.equal(champ("Session").value, "77");
  assert.ok([...champ("Session").options].some((o) => o.textContent === "Session liée (indisponible dans la liste actuelle)"));
  assert.equal(champ("Formation"), null, "aucune formation contradictoire proposée");
  await soumettre();
  await attendre(() => patchs(appels).length === 1);
  assert.equal(patchs(appels)[0].corps.session_id, 77);
  assert.equal(patchs(appels)[0].corps.inscription_id, 11);
});

test("R6 cache A → B → A : aucun nouvel appel pour A, aucune inscription mélangée", async () => {
  const appels = await ouvrirCreation({ "GET /api/sessions/6": { session: { id: 6 }, groupes: [], documents: [], stagiaires: [{ inscription_id: 21, nom: "Autre", prenom: "Bob", statut: "inscrit" }] } });
  await saisir(champ("Session"), "5");
  await attendre(() => champ("Stagiaire concerné")?.options.length === 3);
  await saisir(champ("Session"), "6");
  await attendre(() => champ("Stagiaire concerné")?.options.length === 2);
  assert.deepEqual([...champ("Stagiaire concerné").options].map((o) => o.textContent), ["Aucun stagiaire de cette session", "Autre Bob"]);
  await saisir(champ("Session"), "5");
  await attendre(() => champ("Stagiaire concerné")?.options.length === 3);
  assert.deepEqual([...champ("Stagiaire concerné").options].map((o) => o.textContent), ["Aucun stagiaire de cette session", "Martin Alice", "Bernard Paul (abandon)"]);
  assert.equal(appels.filter((a) => a.chemin === "/api/sessions/5").length, 1, "A non rechargée");
  assert.equal(appels.filter((a) => a.chemin === "/api/sessions/6").length, 1);
});

test("R7 / P2-2 date de réception modifiée : avertissement, échéance existante conservée", async () => {
  const appels = await ouvrirModif({ "PATCH /api/signalements/1": okPatch });
  assert.ok(!dialogue().textContent.includes("Vérifiez l'échéance cible"), "pas d'avertissement sans changement");
  await saisir(champ("Date de réception"), "2026-09-01");
  assert.ok(dialogue().textContent.includes("La date de réception a changé. Vérifiez l'échéance cible."));
  assert.equal(champ("Échéance cible").value, "2099-10-19", "aucun recalcul silencieux");
  await soumettre();
  await attendre(() => patchs(appels).length === 1);
  assert.equal(patchs(appels)[0].corps.date_constat, "2026-09-01");
  assert.equal(patchs(appels)[0].corps.date_echeance_cible, "2099-10-19", "échéance conservée tant qu'elle n'est pas modifiée");
});
