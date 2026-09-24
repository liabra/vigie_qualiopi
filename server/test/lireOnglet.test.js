// Lecture d'un onglet Google Sheets : la borne de taille est vérifiée sur
// les MÉTADONNÉES (gridProperties.rowCount / columnCount) AVANT l'appel
// `values.get`, pour ne jamais télécharger une feuille énorme. Les cellules
// fusionnées, la valeur formatée et le rapprochement ne sont pas modifiés.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lireOnglet } from "../src/services/google.js";

// Client `sheets` FAKE : compte les appels pour prouver que `values.get`
// n'est jamais atteint quand les métadonnées dépassent les bornes.
function fakeSheets({ rowCount = 100, columnCount = 10, merges = [], valeurs = [["Indicateurs", "Documents"], ["Indic 1", "Flyer"]] } = {}) {
  const appels = { meta: 0, valeurs: 0 };
  return {
    appels,
    spreadsheets: {
      get: async () => {
        appels.meta++;
        return {
          data: {
            properties: { title: "Classeur de suivi" },
            sheets: [{
              properties: { sheetId: 1, title: "Suivi", index: 0, gridProperties: { rowCount, columnCount } },
              merges,
            }],
          },
        };
      },
      values: {
        get: async () => {
          appels.valeurs++;
          return { data: { values: valeurs } };
        },
      },
    },
  };
}

test("une feuille déclarée > 20 000 lignes est refusée AVANT lecture des valeurs", async () => {
  const fake = fakeSheets({ rowCount: 25000, columnCount: 10 });
  await assert.rejects(
    () => lireOnglet(fake, "ID"),
    (e) => {
      assert.match(e.message, /trop volumineux/);
      assert.match(e.message, /25000 lignes/);
      assert.match(e.message, /20000/);
      return true;
    }
  );
  assert.equal(fake.appels.meta, 1, "les métadonnées ont été lues");
  assert.equal(fake.appels.valeurs, 0, "values.get ne doit JAMAIS être appelé");
});

test("une feuille déclarée > 500 colonnes est refusée AVANT lecture des valeurs", async () => {
  const fake = fakeSheets({ rowCount: 100, columnCount: 600 });
  await assert.rejects(
    () => lireOnglet(fake, "ID"),
    (e) => {
      assert.match(e.message, /trop volumineux/);
      assert.match(e.message, /600 colonnes/);
      assert.match(e.message, /500/);
      return true;
    }
  );
  assert.equal(fake.appels.valeurs, 0, "values.get ne doit JAMAIS être appelé");
});

test("une feuille aux bornes exactes (20 000 × 500) est acceptée", async () => {
  const fake = fakeSheets({ rowCount: 20000, columnCount: 500 });
  const r = await lireOnglet(fake, "ID");
  assert.equal(r.onglet, "Suivi");
  assert.equal(fake.appels.valeurs, 1, "values.get est appelé pour une feuille valide");
  assert.deepEqual(r.grille, [["Indicateurs", "Documents"], ["Indic 1", "Flyer"]]);
});

test("une feuille valide est lue normalement, avec ses fusions", async () => {
  const merges = [{ startRowIndex: 0, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 1 }];
  const fake = fakeSheets({ rowCount: 100, columnCount: 10, merges });
  const r = await lireOnglet(fake, "ID");
  assert.equal(r.classeur, "Classeur de suivi");
  assert.equal(r.onglet, "Suivi");
  assert.deepEqual(r.onglets, ["Suivi"]);
  assert.deepEqual(r.fusions, [{ debutLigne: 0, finLigne: 3, debutColonne: 0, finColonne: 1 }]);
  assert.equal(fake.appels.meta, 1);
  assert.equal(fake.appels.valeurs, 1);
});

test("un onglet nommé est sélectionné, sinon la première feuille", async () => {
  const fake = {
    appels: { meta: 0, valeurs: 0 },
    spreadsheets: {
      get: async () => {
        fake.appels.meta++;
        return {
          data: {
            properties: { title: "Classeur" },
            sheets: [
              { properties: { sheetId: 1, title: "Première", index: 0, gridProperties: { rowCount: 10, columnCount: 5 } }, merges: [] },
              { properties: { sheetId: 2, title: "Deuxième", index: 1, gridProperties: { rowCount: 10, columnCount: 5 } }, merges: [] },
            ],
          },
        };
      },
      values: {
        get: async () => {
          fake.appels.valeurs++;
          return { data: { values: [["x"]] } };
        },
      },
    },
  };
  const parDefaut = await lireOnglet(fake, "ID");
  assert.equal(parDefaut.onglet, "Première");
  const nommee = await lireOnglet(fake, "ID", "Deuxième");
  assert.equal(nommee.onglet, "Deuxième");
});
