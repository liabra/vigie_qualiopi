// Q1-B3-B1 — Signalements : règles pures de formatage, compteurs, segments,
// filtres et retard. Aucun navigateur requis.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAUSES_SIGNALEMENT, STATUTS_SIGNALEMENT, TYPES_SIGNALEMENT,
  compteursSignalements, compterSegmentsSignalements, estEnRetardReclamation,
  filtrerSignalements,
} from "../src/qualite/signalements-format.js";

const rec = (sur = {}) => ({ id: 1, reference: "REC-2026-001", type: "reclamation", objet: "Retard convocation",
  date_constat: "2026-09-28", statut: "ouverte", date_echeance_cible: "2026-10-19", responsable_id: 2,
  formation_id: null, session_id: null, indicateurs: [], ...sur });

test("libellés : types, statuts et causes lisibles", () => {
  assert.equal(TYPES_SIGNALEMENT.reclamation.libelle, "Réclamation");
  assert.equal(TYPES_SIGNALEMENT.incident.libelle, "Incident");
  assert.equal(TYPES_SIGNALEMENT.non_conformite.libelle, "Non-conformité");
  assert.equal(STATUTS_SIGNALEMENT.en_traitement.libelle, "En traitement");
  assert.equal(CAUSES_SIGNALEMENT.pedagogie, "Pédagogie");
});

test("retard : uniquement réclamation, échéance renseignée et strictement antérieure", () => {
  assert.equal(estEnRetardReclamation(rec({ date_echeance_cible: "2026-09-30" }), "2026-09-30"), false, "échéance aujourd'hui : pas en retard");
  assert.equal(estEnRetardReclamation(rec({ date_echeance_cible: "2026-10-01" }), "2026-09-30"), false, "échéance future");
  assert.equal(estEnRetardReclamation(rec({ date_echeance_cible: null }), "2026-09-30"), false, "échéance absente");
  assert.equal(estEnRetardReclamation(rec({ type: "incident", date_echeance_cible: "2026-09-29" }), "2026-09-30"), false, "incident : jamais en retard");
  assert.equal(estEnRetardReclamation(rec({ type: "non_conformite", date_echeance_cible: "2026-09-29" }), "2026-09-30"), false);
});

// Règle PO : seule une réclamation EN COURS peut être en retard.
test("retard (règle PO) : ouverte / qualifiée / en traitement dépassées ⇒ en retard", () => {
  for (const statut of ["ouverte", "qualifiee", "en_traitement"]) {
    assert.equal(estEnRetardReclamation(rec({ statut, date_echeance_cible: "2026-09-29" }), "2026-09-30"), true, statut);
  }
});

test("retard (règle PO) : résolue / clôturée / annulée dépassées ⇒ jamais en retard", () => {
  for (const statut of ["resolue", "cloturee", "annulee"]) {
    assert.equal(estEnRetardReclamation(rec({ statut, date_echeance_cible: "2026-09-29" }), "2026-09-30"), false, statut);
  }
});

test("compteurs : à traiter, en retard, résolues, clôturées", () => {
  const liste = [
    rec({ id: 1, statut: "ouverte", date_echeance_cible: "2026-09-29" }),
    rec({ id: 2, statut: "qualifiee", date_echeance_cible: "2099-12-31" }), // fix : future quelle que soit la date du jour
    rec({ id: 3, statut: "en_traitement", date_echeance_cible: "2099-12-31" }),
    rec({ id: 4, statut: "resolue", date_echeance_cible: "2026-09-29" }), // dépassée mais résolue : pas en retard
    rec({ id: 5, statut: "cloturee", date_echeance_cible: "2026-09-29" }),
    rec({ id: 6, statut: "annulee", date_echeance_cible: "2026-09-29" }),
  ];
  const c = compteursSignalements(liste);
  assert.equal(c.a_traiter, 3, "ouverte + qualifiee + en_traitement");
  assert.equal(c.en_retard, 1, "seule la réclamation en cours dépassée (pas la résolue)");
  assert.equal(c.resolues, 1);
  assert.equal(c.cloturees, 1);
});

test("segments : actifs = ouverte/qualifiee/en_traitement/resolue", () => {
  const liste = [
    rec({ id: 1, statut: "ouverte" }),
    rec({ id: 2, statut: "resolue" }),
    rec({ id: 3, statut: "cloturee" }),
    rec({ id: 4, statut: "annulee" }),
  ];
  const s = compterSegmentsSignalements(liste);
  assert.equal(s.actifs, 2);
  assert.equal(s.clotures, 1);
  assert.equal(s.annules, 1);
  assert.equal(s.tous, 4);
});

test("filtres : type, statut, responsable, indicateur, recherche (référence/objet)", () => {
  const liste = [
    rec({ id: 1, reference: "REC-2026-001", type: "reclamation", statut: "ouverte", objet: "Retard convocation", responsable_id: 2, indicateurs: [{ id: 5, numero: 32, libelle: "X" }] }),
    rec({ id: 2, reference: "INC-2026-001", type: "incident", statut: "resolue", objet: "Salle indisponible", responsable_id: 1, indicateurs: [] }),
  ];
  assert.equal(filtrerSignalements(liste, { type: "incident" }).length, 1);
  assert.equal(filtrerSignalements(liste, { statut: "resolue" }).length, 1);
  assert.equal(filtrerSignalements(liste, { responsable: "2" }).length, 1);
  assert.equal(filtrerSignalements(liste, { indicateur: "5" }).length, 1);
  assert.equal(filtrerSignalements(liste, { q: "convocation" }).length, 1);
  assert.equal(filtrerSignalements(liste, { q: "INC-2026" }).length, 1, "recherche sur la référence");
});

test("filtres : valeurs inconnues ou non numériques neutralisées", () => {
  const liste = [rec({}), rec({ id: 2, type: "incident", statut: "resolue" })];
  assert.equal(filtrerSignalements(liste, { type: "bidon" }).length, 2, "type inconnu ignoré");
  assert.equal(filtrerSignalements(liste, { statut: "inconnu" }).length, 2);
  assert.equal(filtrerSignalements(liste, { responsable: "abc" }).length, 2, "responsable non numérique ignoré");
  assert.equal(filtrerSignalements(liste, { indicateur: "-3" }).length, 2);
});

test("recherche : n'utilise jamais le nom, l'e-mail ni l'entreprise du réclamant", () => {
  const liste = [rec({ reclamant_nom: "Dupont", reclamant_email: "d@x.fr", reclamant_entreprise: "ACME" })];
  assert.equal(filtrerSignalements(liste, { q: "Dupont" }).length, 0);
  assert.equal(filtrerSignalements(liste, { q: "d@x.fr" }).length, 0);
  assert.equal(filtrerSignalements(liste, { q: "ACME" }).length, 0);
});

// ── Q1-B3-B2 : corps envoyé, transitions, historique ─────────────
import {
  SIGNALEMENT_VIDE, corpsSignalement, decrireEvenementSignalement, erreursSignalement,
  nomsConnus, optionsInscriptions, transitionsSignalement, valeursDepuisSignalement,
} from "../src/qualite/signalements-format.js";

const v = (sur = {}) => ({ ...SIGNALEMENT_VIDE, objet: "Convocation tardive", ...sur });

test("corps création : clés vides OMISES (délai, échéance, champs facultatifs)", () => {
  const c = corpsSignalement(v({ type: "reclamation" }), { creation: true });
  assert.deepEqual(c, { type: "reclamation", objet: "Convocation tardive" });
  assert.ok(!("delai_cible_jours_ouvres" in c) && !("date_echeance_cible" in c), "le serveur applique son défaut");
  assert.ok(!("date_resolution" in c));
});

test("corps création : réclamant envoyé uniquement pour une réclamation", () => {
  const rec = v({ type: "reclamation", reclamant_nom: "Dupont", reclamant_email: "d@x.fr", canal: "email", delai_cible_jours_ouvres: "10", date_echeance_cible: "2026-10-20" });
  const c = corpsSignalement(rec, { creation: true });
  assert.equal(c.reclamant_nom, "Dupont");
  assert.equal(c.canal, "email");
  assert.equal(c.delai_cible_jours_ouvres, 10);
  assert.equal(c.date_echeance_cible, "2026-10-20");
  for (const type of ["incident", "non_conformite"]) {
    const autre = corpsSignalement({ ...rec, type }, { creation: true });
    for (const k of ["reclamant_nom", "reclamant_entreprise", "reclamant_email", "canal", "delai_cible_jours_ouvres", "date_echeance_cible"]) {
      assert.ok(!(k in autre), `${type} : ${k} omis`);
    }
    assert.equal(autre.type, type);
  }
});

test("corps : session ⇒ jamais de formation contradictoire ; inscription seulement avec sa session", () => {
  let c = corpsSignalement(v({ session_id: "5", formation_id: "7", inscription_id: "11" }), { creation: true });
  assert.equal(c.session_id, 5);
  assert.equal(c.inscription_id, 11);
  assert.ok(!("formation_id" in c), "formation déduite par le serveur");
  c = corpsSignalement(v({ formation_id: "7", inscription_id: "11" }), { creation: true });
  assert.equal(c.formation_id, 7);
  assert.ok(!("inscription_id" in c), "inscription sans session ignorée");
  c = corpsSignalement(v({ session_id: "5", inscription_id: "11", personne_concernee_libelle: "Mme X" }), { creation: true });
  assert.ok(!("personne_concernee_libelle" in c), "inscription liée : pas de personne concernée libre");
});

test("corps : causes et « Autre »", () => {
  let c = corpsSignalement(v({ causes: ["organisation", "autre"], cause_autre_libelle: " Salle " }), { creation: true });
  assert.deepEqual(c.causes, ["organisation", "autre"]);
  assert.equal(c.cause_autre_libelle, "Salle");
  c = corpsSignalement(v({ causes: ["organisation"], cause_autre_libelle: "orphelin" }), { creation: true });
  assert.ok(!("cause_autre_libelle" in c), "sans « Autre » : aucun libellé");
  const m = corpsSignalement(v({ causes: ["pedagogie"], cause_autre_libelle: "orphelin" }));
  assert.equal(m.cause_autre_libelle, null, "modification sans « Autre » : libellé effacé");
  assert.equal(erreursSignalement(v({ causes: ["autre"], cause_autre_libelle: "  " })).cause_autre_libelle, "Précisez la cause « Autre ».");
  assert.equal(erreursSignalement(v({ objet: " " })).objet, "Indiquez l'objet du signalement.");
});

test("corps modification : jeu complet, type et date_resolution jamais envoyés", () => {
  const s = { id: 3, type: "reclamation", objet: "Objet", date_constat: "2026-09-28", responsable_id: 2, session_id: 5, inscription_id: 11,
    causes: ["autre"], cause_autre_libelle: "Salle", indicateurs: [{ id: 9, numero: 11, libelle: "X" }], delai_cible_jours_ouvres: 15,
    date_echeance_cible: "2026-10-19", date_resolution: "2026-10-01", synthese_reponse: "Rép", date_reponse: "2026-09-30" };
  const valeurs = valeursDepuisSignalement(s);
  const c = corpsSignalement(valeurs, { initial: s });
  assert.ok(!("type" in c) && !("date_resolution" in c));
  assert.deepEqual(c.indicateur_ids, [9], "indicateurs renvoyés tels quels");
  assert.equal(c.synthese_reponse, "Rép");
  assert.equal(c.date_reponse, "2026-09-30");
  assert.ok(!("responsable_id" in c), "responsable inchangé non renvoyé (compte peut-être désactivé)");
  assert.equal(corpsSignalement({ ...valeurs, responsable_id: "1" }, { initial: s }).responsable_id, 1);
  assert.equal(corpsSignalement({ ...valeurs, delai_cible_jours_ouvres: "" }, { initial: s }).delai_cible_jours_ouvres, undefined, "délai vide omis");
  assert.equal(corpsSignalement({ ...valeurs, session_id: "" }, { initial: s }).inscription_id, null, "sans session : inscription effacée");
});

test("inscriptions : seuls id, nom, prénom, statut sont conservés", () => {
  const o = optionsInscriptions([{ inscription_id: 11, id: 101, nom: "Martin", prenom: "Alice", statut: "inscrit",
    email: "alice@x.fr", telephone: "0600", situation_handicap: true, besoins_adaptation: "Poste adapté", entreprise: "ACME" }]);
  assert.deepEqual(o, [{ inscription_id: 11, nom: "Martin", prenom: "Alice", statut: "inscrit" }]);
});

test("transitions : boutons exacts par statut", () => {
  const ids = (st) => transitionsSignalement(st).map((b) => b.libelle);
  assert.deepEqual(ids("ouverte"), ["Modifier", "Qualifier", "Annuler"]);
  assert.deepEqual(ids("qualifiee"), ["Modifier", "Démarrer le traitement", "Annuler"]);
  assert.deepEqual(ids("en_traitement"), ["Modifier", "Résoudre", "Annuler"]);
  assert.deepEqual(ids("resolue"), ["Modifier", "Clôturer", "Annuler"]);
  assert.deepEqual(ids("cloturee"), ["Réouvrir"]);
  assert.deepEqual(ids("annulee"), []);
});

test("historique : libellés, noms conservés, indicateur historique, champs sensibles masqués", () => {
  const indicateurs = [{ id: 9, numero: 11, libelle: "Atteinte des objectifs" }];
  const noms = nomsConnus([{ id: 1, nom: "Mme Stark" }], { responsable_id: 5, responsable_nom: "Mme Ancienne" }, [{ par: 7, acteur_nom: "M. Parti" }]);
  const d = (ev) => decrireEvenementSignalement(ev, { indicateurs, noms });
  assert.equal(d({ evenement: "creation" }).titre, "Signalement créé");
  assert.equal(d({ evenement: "traiter" }).titre, "Traitement démarré");
  assert.equal(d({ evenement: "rouvrir" }).titre, "Signalement réouvert");
  assert.deepEqual(d({ evenement: "modification", champ: "responsable_id", ancienne_valeur: "1", nouvelle_valeur: "5" }), { titre: "Responsable", avant: "Mme Stark", apres: "Mme Ancienne" });
  assert.equal(d({ evenement: "modification", champ: "responsable_id", ancienne_valeur: "7", nouvelle_valeur: "99" }).apres, "Utilisateur indisponible");
  assert.deepEqual(d({ evenement: "modification", champ: "date_echeance_cible", ancienne_valeur: "2026-10-19", nouvelle_valeur: "2026-10-26" }), { titre: "Échéance", avant: "19/10/2026", apres: "26/10/2026" });
  assert.equal(d({ evenement: "rattachement_indicateur", nouvelle_valeur: "9" }).apres, "Indicateur 11 — Atteinte des objectifs");
  assert.equal(d({ evenement: "retrait_indicateur", ancienne_valeur: "404" }).apres, "Indicateur historique (ID interne 404)");
  for (const [champ, titre] of [["description", "Description modifiée"], ["reclamant_email", "Informations du réclamant modifiées"], ["synthese_reponse", "Réponse mise à jour"], ["causes", "Causes mises à jour"]]) {
    const r = d({ evenement: "modification", champ, ancienne_valeur: "SECRET-A", nouvelle_valeur: "SECRET-B" });
    assert.deepEqual(r, { titre }, `${champ} : fait seul, jamais de valeur`);
  }
});
