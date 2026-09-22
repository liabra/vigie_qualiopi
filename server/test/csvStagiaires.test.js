// Parsing et mise en forme du CSV d'import de stagiaires — fonctions
// PURES, sans base ni Express. Le contrat HTTP est testé dans
// stagiaires.test.js ; ici on ne vérifie que la lecture du texte.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detecterSeparateur, decouperLigne, parserCsv, normaliser, construireMapping,
  lireBooleen, normaliserEmail, validerEmail, normaliserCivilite, normaliserPrescripteur,
} from "../src/services/csvStagiaires.js";

test("le séparateur est détecté sur la première ligne", () => {
  assert.equal(detecterSeparateur("nom,prenom\nDupont,Jean"), ",");
  assert.equal(detecterSeparateur("nom;prenom\nDupont;Jean"), ";");
  // Le point-virgule prime à égalité : c'est le format des CSV francophones.
  assert.equal(detecterSeparateur("nom,prenom;email"), ";");
});

test("les guillemets protègent le séparateur", () => {
  const sep = ",";
  assert.deepEqual(decouperLigne('Dupont,"Jean, dit Jo",a@b.fr', sep), ["Dupont", "Jean, dit Jo", "a@b.fr"]);
  // Deux guillemets d'affilée = un guillemet littéral.
  assert.deepEqual(decouperLigne('Dupont,"Jean ""Jo""",a@b.fr', sep), ["Dupont", 'Jean "Jo"', "a@b.fr"]);
});

test("le parseur enlève la marque BOM et gère les fins de ligne", () => {
  const r = parserCsv("\uFEFFnom;prenom\r\nStark;Blandine\r\n");
  assert.equal(r.erreur, undefined);
  assert.deepEqual(r.enTetes, ["nom", "prenom"]);
  assert.equal(r.lignes.length, 1);
  assert.deepEqual(r.lignes[0], ["Stark", "Blandine"]);
});

test("un fichier vide est refusé", () => {
  assert.equal(parserCsv("").erreur, "Le fichier est vide.");
  assert.equal(parserCsv("   \n  ").erreur, "Le fichier est vide.");
});

test("un mauvais encodage est détecté", () => {
  // U+FFFD : caractère de remplacement d'une lecture dans le mauvais encodage.
  const r = parserCsv("nom;prenom\nStark;Bl\uFFFDndine");
  assert.match(r.erreur, /Encodage/);
});

test("les en-têtes sont rapprochés sans casse ni accents", () => {
  assert.equal(normaliser("Prénom"), "prenom");
  assert.equal(normaliser("E-mail"), "email");
  assert.equal(normaliser("SITUATION_HANDICAP"), "situationhandicap");
});

test("les en-têtes tolérants sont reconnus", () => {
  const { colonnes, inconnus, ambigus } = construireMapping(["Civilité", "Nom", "Prénom", "E-mail", "Téléphone", "Entreprise", "Financeur", "Situation de handicap", "Besoins d'adaptation", "Groupe", "Prescripteur", "Dossier complet"]);
  assert.deepEqual(Object.values(colonnes).sort(), [
    "besoins_adaptation", "civilite", "dossier_complet", "email", "entreprise",
    "financeur", "groupe", "nom", "prenom", "prescripteur", "situation_handicap", "telephone",
  ]);
  assert.deepEqual(inconnus, []);
  assert.deepEqual(ambigus, []);
});

test("une colonne inconnue est signalée, pas devinée", () => {
  const { colonnes, inconnus } = construireMapping(["nom", "prenom", "remarque libre"]);
  assert.deepEqual(inconnus, ["remarque libre"]);
  assert.deepEqual(Object.values(colonnes).sort(), ["nom", "prenom"]);
});

test("deux colonnes qui rappellent le même champ sont refusées", () => {
  const { ambigus } = construireMapping(["nom", "prenom", "email", "mail"]);
  assert.equal(ambigus.length, 1);
  assert.equal(ambigus[0].cle, "email");
});

test("les booléens lisent oui/non, 1/0, vrai/faux", () => {
  assert.equal(lireBooleen("Oui"), true);
  assert.equal(lireBooleen("NON"), false);
  assert.equal(lireBooleen("1"), true);
  assert.equal(lireBooleen("0"), false);
  assert.equal(lireBooleen("VRAI"), true);
  assert.equal(lireBooleen("faux"), false);
  assert.equal(lireBooleen(""), null);
  assert.equal(lireBooleen(null), null);
  assert.equal(lireBooleen("peut-être"), undefined);
});

test("l'email est normalisé en minuscules et validé", () => {
  assert.equal(normaliserEmail("  Blandine.Stark@Exemple.FR "), "blandine.stark@exemple.fr");
  assert.equal(normaliserEmail(""), null);
  assert.equal(validerEmail("blandine@exemple.fr"), true);
  assert.equal(validerEmail("pas-un-email"), false);
  assert.equal(validerEmail("a@b.c"), false, "TLD trop court");
});

test("la civilité tolère les variantes sans inventer", () => {
  assert.equal(normaliserCivilite("M."), "M.");
  assert.equal(normaliserCivilite("Monsieur"), "M.");
  assert.equal(normaliserCivilite("Mme"), "Mme");
  assert.equal(normaliserCivilite("Madame"), "Mme");
  assert.equal(normaliserCivilite(""), null);
  assert.equal(normaliserCivilite("Autre chose"), null);
});

test("le prescripteur tolère les variantes mais refuse l'inconnu", () => {
  assert.equal(normaliserPrescripteur("Pôle Emploi"), "pole_emploi");
  assert.equal(normaliserPrescripteur("France Travail"), "pole_emploi");
  assert.equal(normaliserPrescripteur("Mission Locale"), "mission_locale");
  assert.equal(normaliserPrescripteur("Organisme de formation"), "of");
  assert.equal(normaliserPrescripteur("Autre"), "autre");
  assert.equal(normaliserPrescripteur(""), null);
  assert.equal(normaliserPrescripteur("Trésor public"), undefined);
});
