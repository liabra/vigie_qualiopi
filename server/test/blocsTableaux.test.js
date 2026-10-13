// ─────────────────────────────────────────────────────────────
//  DOC-6C — Moteur de duplication fidèle d'une ligne de tableau Docs.
//  Tests PURS : aucun Drive, aucun réseau. Le JSON Google Docs est
//  construit localement avec de VRAIS index absolus (startIndex/endIndex),
//  ce qui permet de vérifier à la fois la classification structurelle, le
//  plan d'écriture et la stabilité des index (simulateur).
// ─────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { detecterBlocsTableau, classerBlocsDoc, planBlocsTableau } from "../src/services/blocsTableaux.js";

// ── Constructeur de Doc JSON avec index absolus ─────────────
let compteur = 0;
const resetCompteur = () => { compteur = 0; };

function paragraphe(texte, opts = {}) {
  const contenu = texte.endsWith("\n") ? texte : texte + "\n";
  const debut = compteur;
  const fin = debut + contenu.length;
  compteur = fin;
  const elements = [{ startIndex: debut, endIndex: fin, textRun: { content: contenu, ...(opts.styleTexte ? { textStyle: opts.styleTexte } : {}) } }];
  if (opts.image) elements.push({ startIndex: fin, endIndex: fin, inlineObjectElement: { inlineObjectId: "img1" } });
  return {
    startIndex: debut, endIndex: fin,
    paragraph: { ...(opts.styleParagraphe ? { paragraphStyle: opts.styleParagraphe } : {}), elements },
  };
}

function cellule(texte, opts = {}) {
  const p = paragraphe(texte, opts);
  const out = {
    startIndex: p.startIndex, endIndex: p.endIndex,
    ...(opts.styleCellule ? { tableCellStyle: opts.styleCellule } : {}),
    ...(opts.rowSpan ? { rowSpan: opts.rowSpan } : {}),
    ...(opts.columnSpan ? { columnSpan: opts.columnSpan } : {}),
    content: [p],
  };
  if (opts.tableImbriquee) out.content.push(tableau([{ cellules: [{ texte: "sous-table" }] }]));
  return out;
}

function tableau(lignes) {
  const debut = compteur;
  const tableRows = lignes.map((ligne) => {
    const cellules = (ligne.cellules || []).map((c) => cellule(c.texte, c));
    const rowDebut = cellules[0]?.startIndex ?? compteur;
    const rowFin = cellules[cellules.length - 1]?.endIndex ?? compteur;
    return { startIndex: rowDebut, endIndex: rowFin, ...(ligne.styleLigne ? { tableRowStyle: ligne.styleLigne } : {}), tableCells: cellules };
  });
  const fin = tableRows[tableRows.length - 1]?.endIndex ?? compteur;
  compteur = fin;
  return { startIndex: debut, endIndex: fin, table: { startIndex: debut, endIndex: fin, tableRows } };
}

function doc(body, { headers = {}, footers = {} } = {}) {
  resetCompteur();
  return { body: { content: body }, headers, footers };
}

// Ligne modèle d'exemple (3 colonnes, style différencié par cellule).
function ligneModele({ nomBloc = "evaluations", styleLigne = { minRowHeight: { magnitude: 20, unit: "PT" } } } = {}) {
  return {
    styleLigne,
    cellules: [
      { texte: `{{#${nomBloc}}}{{evaluation_date}}`, styleCellule: { backgroundColor: { color: { rgbColor: { red: 1, green: 0, blue: 0 } } } }, styleTexte: { bold: true }, styleParagraphe: { alignment: "CENTER" } },
      { texte: "{{evaluation_intitule}}", styleCellule: { backgroundColor: { color: { rgbColor: { red: 0, green: 1, blue: 0 } } } }, styleTexte: { italic: true } },
      { texte: `{{evaluation_score_obtenu}} / {{evaluation_score_max}}{{/${nomBloc}}}`, styleCellule: { backgroundColor: { color: { rgbColor: { red: 0, green: 0, blue: 1 } } } }, styleTexte: { underline: true } },
    ],
  };
}

// ── Classification structurelle ─────────────────────────────
test("bloc dans le texte courant → type texte (renderer DOC-6A)", () => {
  const d = doc([paragraphe("Avant "), paragraphe("{{#absences}}{{absence_date}}{{/absences}}"), paragraphe("Après")]);
  const r = classerBlocsDoc(d);
  assert.deepEqual(r.map((o) => [o.nom, o.type]), [["absences", "texte"]]);
});

test("bloc dans une seule ligne de tableau → tableau_ligne supporté", () => {
  const d = doc([paragraphe("Intro"), tableau([{ cellules: [{ texte: "Date" }, { texte: "Intitulé" }, { texte: "Score" }] }, ligneModele()]), paragraphe("Fin")]);
  const r = classerBlocsDoc(d);
  assert.equal(r.length, 1);
  assert.equal(r[0].nom, "evaluations");
  assert.equal(r[0].type, "tableau_ligne");
  assert.equal(r[0].raison, null);
});

test("bloc traversant deux lignes → refus bloc_traverse_lignes", () => {
  const d = doc([tableau([
    { cellules: [{ texte: "{{#evaluations}}{{evaluation_date}}" }] },
    { cellules: [{ texte: "{{/evaluations}}" }] },
  ])]);
  const r = classerBlocsDoc(d);
  assert.equal(r[0].type, "tableau_non_supporte");
  assert.equal(r[0].raison, "bloc_traverse_lignes");
});

test("bloc traversant deux tableaux → refus bloc_traverse_tableaux", () => {
  const d = doc([
    tableau([{ cellules: [{ texte: "{{#evaluations}}" }] }]),
    tableau([{ cellules: [{ texte: "{{/evaluations}}" }] }]),
  ]);
  assert.equal(classerBlocsDoc(d)[0].raison, "bloc_traverse_tableaux");
});

test("ouverture dans un tableau, fermeture dans le texte → refus", () => {
  const d = doc([tableau([{ cellules: [{ texte: "{{#evaluations}}" }] }]), paragraphe("{{/evaluations}}")]);
  assert.equal(classerBlocsDoc(d)[0].raison, "bloc_traverse_tableau_et_texte");
});

test("plusieurs blocs dans la même ligne → refus", () => {
  const d = doc([tableau([
    { cellules: [{ texte: "{{#absences}}{{absence_date}}{{/absences}}" }, { texte: "{{#evaluations}}{{evaluation_intitule}}{{/evaluations}}" }] },
  ])]);
  const r = classerBlocsDoc(d);
  assert.ok(r.some((o) => o.raison === "plusieurs_blocs_dans_ligne"));
});

test("cellule fusionnée → refus cellules_fusionnees", () => {
  const d = doc([tableau([{ cellules: [{ texte: "{{#evaluations}}{{evaluation_intitule}}{{/evaluations}}", columnSpan: 2 }, { texte: "x" }] }])]);
  assert.equal(classerBlocsDoc(d)[0].raison, "cellules_fusionnees");
});

test("tableau imbriqué dans la ligne → refus tableau_imbrique", () => {
  const d = doc([tableau([{ cellules: [{ texte: "{{#evaluations}}{{evaluation_intitule}}{{/evaluations}}", tableImbriquee: true }] }])]);
  assert.equal(classerBlocsDoc(d)[0].raison, "tableau_imbrique");
});

test("image dans la ligne modèle → refus contenu_non_textuel", () => {
  const d = doc([tableau([{ cellules: [{ texte: "{{#evaluations}}{{evaluation_intitule}}{{/evaluations}}", image: true }] }])]);
  assert.equal(classerBlocsDoc(d)[0].raison, "contenu_non_textuel");
});

test("plusieurs styles de texte dans une cellule → refus styles_textes_multiples", () => {
  resetCompteur();
  const p1 = "{{#evaluations}}";
  const p2 = "{{evaluation_intitule}}{{/evaluations}}\n";
  const debut = compteur;
  const fin = debut + p1.length + p2.length;
  const paragrapheEl = {
    startIndex: debut, endIndex: fin,
    paragraph: { elements: [
      { startIndex: debut, endIndex: debut + p1.length, textRun: { content: p1, textStyle: { bold: true } } },
      { startIndex: debut + p1.length, endIndex: fin, textRun: { content: p2, textStyle: { italic: true } } },
    ] },
  };
  const d = {
    body: { content: [{ startIndex: debut, endIndex: fin, table: { startIndex: debut, endIndex: fin, tableRows: [{ startIndex: debut, endIndex: fin, tableCells: [{ startIndex: debut, endIndex: fin, content: [paragrapheEl] }] }] } }] },
    headers: {}, footers: {},
  };
  assert.equal(classerBlocsDoc(d)[0].raison, "styles_textes_multiples");
});

test("bloc dans un en-tête → refus bloc_tableau_hors_corps", () => {
  resetCompteur();
  const p = paragraphe("{{#evaluations}}{{evaluation_intitule}}{{/evaluations}}");
  const d = { body: { content: [] }, headers: { h1: { content: [{ startIndex: p.startIndex, endIndex: p.endIndex, table: { startIndex: p.startIndex, endIndex: p.endIndex, tableRows: [{ startIndex: p.startIndex, endIndex: p.endIndex, tableCells: [{ startIndex: p.startIndex, endIndex: p.endIndex, content: [p] }] }] } }] } }, footers: {} };
  assert.equal(classerBlocsDoc(d)[0].raison, "bloc_tableau_hors_corps");
});

// ── Plan d'écriture (0 / 1 / N éléments) ────────────────────
test("0 élément → la ligne modèle est supprimée (deleteTableRow)", () => {
  const d = doc([paragraphe("Intro"), tableau([{ cellules: [{ texte: "Date" }, { texte: "Intitulé" }] }, ligneModele()])]);
  const { requetes, occurrences } = planBlocsTableau(d, { evaluations: [] });
  assert.equal(occurrences[0].elements, 0);
  assert.equal(requetes.length, 1);
  assert.ok(requetes[0].deleteTableRow);
  assert.equal(requetes[0].deleteTableRow.tableCellLocation.rowIndex, 1);
});

test("1 élément → aucune insertion, la ligne modèle est remplie, aucun marqueur", () => {
  const d = doc([tableau([{ cellules: [{ texte: "Date" }, { texte: "Intitulé" }] }, ligneModele()])]);
  const lignes = [{ date_passage: "2026-02-10", intitule: "QCM final", score: 17, score_max: 20 }];
  const { requetes } = planBlocsTableau(d, { evaluations: lignes });
  const types = requetes.map((r) => Object.keys(r)[0]);
  assert.ok(!types.includes("insertTableRow"));
  assert.ok(types.includes("deleteContentRange"));
  assert.ok(types.includes("insertText"));
  // les marqueurs de bloc ne subsistent dans AUCUN texte inséré
  for (const r of requetes) if (r.insertText) assert.ok(!r.insertText.text.includes("{{"), r.insertText.text);
});

test("3 éléments → exactement 3 lignes rendues, ordre conservé", () => {
  const d = doc([tableau([{ cellules: [{ texte: "Date" }, { texte: "Intitulé" }] }, ligneModele()])]);
  const lignes = [
    { date_passage: "2026-01-05", intitule: "A", score: 1, score_max: 2 },
    { date_passage: "2026-01-06", intitule: "B", score: 2, score_max: 2 },
    { date_passage: "2026-01-07", intitule: "C", score: 3, score_max: 3 },
  ];
  const { requetes, occurrences } = planBlocsTableau(d, { evaluations: lignes });
  assert.equal(occurrences[0].elements, 3);
  const insertions = requetes.filter((r) => r.insertTableRow);
  assert.equal(insertions.length, 2);
  const textes = requetes.filter((r) => r.insertText).map((r) => r.insertText.text);
  assert.ok(textes.includes("A"));
  assert.ok(textes.includes("B"));
  assert.ok(textes.includes("C"));
});

test("plusieurs variables dans une même cellule (score / score_max)", () => {
  const d = doc([tableau([{ cellules: [{ texte: "{{#evaluations}}{{evaluation_score_obtenu}} / {{evaluation_score_max}}{{/evaluations}}" }] }])]);
  const { requetes } = planBlocsTableau(d, { evaluations: [{ score: 17, score_max: 20 }] });
  const ins = requetes.find((r) => r.insertText);
  assert.equal(ins.insertText.text, "17 / 20");
});

test("bloc absences : rendu réel des champs résolubles", () => {
  const d = doc([tableau([{ cellules: [{ texte: "{{#absences}}{{absence_date}} — {{absence_duree_heures}}{{/absences}}" }] }])]);
  const { requetes } = planBlocsTableau(d, { absences: [{ date_absence: "2026-01-05", duree_heures: 3.5 }] });
  const ins = requetes.find((r) => r.insertText);
  assert.equal(ins.insertText.text, "05/01/2026 — 3.5 h");
});

test("champ non résoluble : laissé tel quel (jamais inventé)", () => {
  const d = doc([tableau([{ cellules: [{ texte: "{{#evaluations}}{{evaluation_moment}}{{/evaluations}}" }] }])]);
  const { requetes } = planBlocsTableau(d, { evaluations: [{ intitule: "QCM" }] });
  const ins = requetes.find((r) => r.insertText);
  assert.equal(ins.insertText.text, "{{evaluation_moment}}");
});

test("styles différents entre cellules : une requête updateTableCellStyle par cellule", () => {
  const d = doc([tableau([{ cellules: [{ texte: "Date" }] }, ligneModele()])]);
  const { requetes } = planBlocsTableau(d, { evaluations: [{ date_passage: "2026-02-10", intitule: "Q", score: 1, score_max: 2 }, { date_passage: "2026-02-11", intitule: "Q2", score: 2, score_max: 2 }] });
  const styles = requetes.filter((r) => r.updateTableCellStyle);
  // 1 ligne supplémentaire × 3 cellules = 3 mises à jour de style cellule
  assert.equal(styles.length, 3);
  assert.equal(requetes.filter((r) => r.updateTableRowStyle).length, 1);
});

// ── Simulateur d'index Google Docs (anti décalage) ──────────
// Représente le document par une chaîne plate + la structure des tables,
// applique les requêtes dans l'ordre, et vérifie le résultat final.
function construireSimulateur(docJson) {
  let texte = "";
  const tables = [];
  const parcourir = (elements) => {
    for (const el of elements) {
      if (el.paragraph) { texte += el.paragraph.elements.map((e) => e.textRun?.content ?? "").join(""); }
      else if (el.table) {
        const t = el.table;
        const table = { debut: texte.length, lignes: [] };
        for (const row of t.tableRows) {
          const ligne = { cellules: [], styleLigne: row.tableRowStyle ?? null };
          for (const cell of row.tableCells) {
            const debut = texte.length;
            parcourir(cell.content);
            ligne.cellules.push({ debut, fin: texte.length, styleCellule: cell.tableCellStyle ?? null });
          }
          ligne.fin = texte.length;
          table.lignes.push(ligne);
        }
        table.fin = texte.length;
        tables.push(table);
      }
    }
  };
  parcourir(docJson.body.content);
  return {
    get texte() { return texte; },
    tables,
    appliquer(requete) {
      const decaler = (index, delta) => {
        for (const t of tables) {
          if (t.debut >= index) {
            t.debut += delta; t.fin += delta;
            for (const l of t.lignes) {
              l.fin += delta;
              for (const c of l.cellules) { c.debut += delta; c.fin += delta; }
            }
          } else if (t.fin > index) {
            for (const l of t.lignes) {
              for (const c of l.cellules) {
                if (c.debut >= index) { c.debut += delta; c.fin += delta; }
                else if (c.fin > index) c.fin += delta;
              }
              if (l.fin > index) l.fin += delta;
            }
            t.fin += delta;
          }
        }
      };
      if (requete.insertText) {
        const { index } = requete.insertText.location;
        const text = requete.insertText.text;
        texte = texte.slice(0, index) + text + texte.slice(index);
        decaler(index, text.length);
      } else if (requete.deleteContentRange) {
        const { startIndex, endIndex } = requete.deleteContentRange.range;
        texte = texte.slice(0, startIndex) + texte.slice(endIndex);
        decaler(startIndex, startIndex - endIndex);
      } else if (requete.insertTableRow) {
        const { tableStartLocation, rowIndex } = requete.insertTableRow.tableCellLocation;
        const t = tables.find((x) => x.debut === tableStartLocation.index);
        const colonnes = t.lignes.reduce((m, l) => Math.max(m, l.cellules.length), 0);
        const apres = t.lignes[rowIndex].fin;
        const contenu = "\n".repeat(colonnes);
        texte = texte.slice(0, apres) + contenu + texte.slice(apres);
        decaler(apres, contenu.length);
        // insère la ligne vide dans le modèle de table (cellules de 1 caractère)
        const ligne = { cellules: [] };
        let pos = apres;
        for (let c = 0; c < colonnes; c++) { ligne.cellules.push({ debut: pos, fin: pos + 1 }); pos++; }
        ligne.fin = apres + colonnes;
        t.lignes.splice(rowIndex + 1, 0, ligne);
      } else if (requete.deleteTableRow) {
        const { tableStartLocation, rowIndex } = requete.deleteTableRow.tableCellLocation;
        const t = tables.find((x) => x.debut === tableStartLocation.index);
        const ligne = t.lignes[rowIndex];
        const debut = ligne.cellules[0].debut;
        const fin = ligne.fin;
        texte = texte.slice(0, debut) + texte.slice(fin);
        decaler(debut, debut - fin);
        t.lignes.splice(rowIndex, 1);
      } else if (requete.updateTableCellStyle) {
        const { tableRange, tableCellStyle } = requete.updateTableCellStyle;
        const { tableStartLocation, rowIndex, columnIndex } = tableRange.tableCellLocation;
        const t = tables.find((x) => x.debut === tableStartLocation.index);
        t.lignes[rowIndex].cellules[columnIndex].styleCellule = tableCellStyle;
      } else if (requete.updateTableRowStyle) {
        const { tableStartLocation, rowIndices, tableRowStyle } = requete.updateTableRowStyle;
        const t = tables.find((x) => x.debut === tableStartLocation.index);
        for (const ri of rowIndices) t.lignes[ri].styleLigne = tableRowStyle;
      }
      // updateTextStyle / updateParagraphStyle : sans effet sur la signature
      // structurelle vérifiée ici (styles cellule + ligne).
    },
  };
}

test("simulateur : index stables après insertion, texte final exact", () => {
  const d = doc([paragraphe("Intro"), tableau([{ cellules: [{ texte: "Date" }, { texte: "Intitulé" }] }, ligneModele()]), paragraphe("Conclusion")]);
  const lignes = [
    { date_passage: "2026-01-05", intitule: "A", score: 1, score_max: 2 },
    { date_passage: "2026-01-06", intitule: "B", score: 2, score_max: 2 },
    { date_passage: "2026-01-07", intitule: "C", score: 3, score_max: 3 },
  ];
  const { requetes } = planBlocsTableau(d, { evaluations: lignes });
  const sim = construireSimulateur(d);
  for (const req of requetes) sim.appliquer(req);
  assert.ok(!sim.texte.includes("{{#"), "aucun marqueur d'ouverture restant");
  assert.ok(!sim.texte.includes("{{/"), "aucun marqueur de fermeture restant");
  assert.ok(!sim.texte.includes("{{evaluation"), "aucune variable de bloc restante");
  assert.ok(sim.texte.includes("05/01/2026"));
  assert.ok(sim.texte.includes("07/01/2026"));
  assert.ok(sim.texte.includes("Conclusion"));
  const table = sim.tables[0];
  assert.equal(table.lignes.length, 4, "en-tête + 3 lignes rendues");
});

test("simulateur : 0 élément → la ligne modèle est retirée, le reste intact", () => {
  const d = doc([paragraphe("Intro"), tableau([{ cellules: [{ texte: "Date" }] }, ligneModele()]), paragraphe("Conclusion")]);
  const { requetes } = planBlocsTableau(d, { evaluations: [] });
  const sim = construireSimulateur(d);
  for (const req of requetes) sim.appliquer(req);
  assert.equal(sim.tables[0].lignes.length, 1);
  assert.ok(sim.texte.includes("Intro"));
  assert.ok(sim.texte.includes("Conclusion"));
  assert.ok(!sim.texte.includes("{{"));
});

// ── Fidélité : signature structurelle/style identique ───────
test("fidélité : toutes les lignes générées portent la même signature style que la ligne modèle", () => {
  const d = doc([tableau([{ cellules: [{ texte: "Date" }, { texte: "Intitulé" }, { texte: "Score" }] }, ligneModele()])]);
  const lignes = [
    { date_passage: "2026-01-05", intitule: "A", score: 1, score_max: 2 },
    { date_passage: "2026-01-06", intitule: "B", score: 2, score_max: 2 },
  ];
  const { requetes } = planBlocsTableau(d, { evaluations: lignes });
  const sim = construireSimulateur(d);
  for (const req of requetes) sim.appliquer(req);

  const table = sim.tables[0];
  // ligne 1 = ligne modèle (en-tête en 0)
  const modele = table.lignes[1];
  const signatureCellules = modele.cellules.map((c) => JSON.stringify(c.styleCellule));
  assert.equal(table.lignes.length, 3, "en-tête + 2 lignes rendues");
  for (const ligne of table.lignes.slice(1)) {
    assert.equal(JSON.stringify(ligne.styleLigne), JSON.stringify(modele.styleLigne), "même style de ligne");
    assert.deepEqual(ligne.cellules.map((c) => JSON.stringify(c.styleCellule)), signatureCellules, "même style de cellule par colonne");
  }
});

// DOC-7B : le bloc suivi_pedagogique se rend dans une ligne de tableau via le
// MÊME moteur générique, sans traitement spécifique au Livret. Une séance sans
// suivi fournit quand même sa ligne (champs suivi vides).
test("bloc suivi_pedagogique dans une ligne de tableau : rendu générique, séance sans suivi incluse", () => {
  const d = doc([tableau([
    { cellules: [{ texte: "Date" }, { texte: "Compétences" }, { texte: "Difficultés" }] },
    { cellules: [
      { texte: "{{#suivi_pedagogique}}{{seance_date}}" },
      { texte: "{{seance_competences}}" },
      { texte: "{{suivi_difficultes}}{{/suivi_pedagogique}}" },
    ] },
  ])]);
  const lignes = [
    { date_seance: "2026-09-10", competences: ["communication"], activites: "Jeu", difficultes: null },
    { date_seance: "2026-09-11", competences: ["autonomie"], activites: "Bilan", difficultes: "Un peu rapide" },
  ];
  const { requetes } = planBlocsTableau(d, { suivi_pedagogique: lignes });
  // 2 éléments → 1 ligne insérée ; chaque séance devient une ligne (y compris sans suivi).
  assert.equal(requetes.filter((r) => r.insertTableRow).length, 1);
  const textes = requetes.filter((r) => r.insertText).map((r) => r.insertText.text);
  assert.ok(textes.includes("10/09/2026"));
  assert.ok(textes.includes("communication"));
  assert.ok(textes.includes("11/09/2026"));
  assert.ok(textes.includes("autonomie"));
  assert.ok(textes.includes("Un peu rapide"));
});

// ── DOC-7D : schéma réel Google Docs API ────────────────────
// Les tests ci-dessous vérifient la FORME EXACTE de chaque requête (noms de
// champs officiels, champs mutuellement exclusifs, masques `fields`), pas
// seulement le résultat du simulateur. C'est ce qui a laissé passer la
// requête invalide d'origine (`rowIndex` et double `tableStartLocation`).

function validerSchemaRequete(requete) {
  const [op, c] = Object.entries(requete)[0];
  switch (op) {
    case "insertTableRow":
      assert.ok(Number.isInteger(c.tableCellLocation?.tableStartLocation?.index), `${op} : tableStartLocation.index`);
      assert.ok(Number.isInteger(c.tableCellLocation?.rowIndex), `${op} : rowIndex`);
      assert.equal(c.tableCellLocation.columnIndex, 0, `${op} : columnIndex = 0`);
      assert.equal(typeof c.insertBelow, "boolean", `${op} : insertBelow`);
      break;
    case "deleteTableRow":
      assert.ok(Number.isInteger(c.tableCellLocation?.tableStartLocation?.index), `${op} : tableStartLocation.index`);
      assert.ok(Number.isInteger(c.tableCellLocation?.rowIndex), `${op} : rowIndex`);
      break;
    case "updateTableCellStyle":
      assert.equal(c.tableStartLocation, undefined, `${op} : tableStartLocation interdit avec tableRange`);
      assert.ok(Number.isInteger(c.tableRange?.tableCellLocation?.tableStartLocation?.index), `${op} : tableRange.tableCellLocation.tableStartLocation.index`);
      assert.ok(Number.isInteger(c.tableRange?.tableCellLocation?.rowIndex), `${op} : rowIndex`);
      assert.ok(Number.isInteger(c.tableRange?.tableCellLocation?.columnIndex), `${op} : columnIndex`);
      assert.ok(c.tableCellStyle, `${op} : tableCellStyle`);
      assert.equal(c.fields, "*", `${op} : fields`);
      break;
    case "updateTableRowStyle":
      assert.ok(Array.isArray(c.rowIndices) && c.rowIndices.length === 1 && Number.isInteger(c.rowIndices[0]), `${op} : rowIndices (tableau)`);
      assert.equal(c.rowIndex, undefined, `${op} : rowIndex interdit`);
      assert.ok(Number.isInteger(c.tableStartLocation?.index), `${op} : tableStartLocation.index`);
      assert.ok(c.tableRowStyle, `${op} : tableRowStyle`);
      assert.equal(c.fields, "*", `${op} : fields`);
      break;
    case "insertText":
      assert.ok(Number.isInteger(c.location?.index), `${op} : location.index`);
      assert.equal(typeof c.text, "string", `${op} : text`);
      break;
    case "deleteContentRange":
      assert.ok(Number.isInteger(c.range?.startIndex) && Number.isInteger(c.range?.endIndex), `${op} : range`);
      break;
    case "updateTextStyle":
      assert.ok(Number.isInteger(c.range?.startIndex) && Number.isInteger(c.range?.endIndex), `${op} : range`);
      assert.ok(c.textStyle, `${op} : textStyle`);
      assert.equal(c.fields, "*", `${op} : fields`);
      break;
    case "updateParagraphStyle":
      assert.ok(Number.isInteger(c.range?.startIndex) && Number.isInteger(c.range?.endIndex), `${op} : range`);
      assert.ok(c.paragraphStyle, `${op} : paragraphStyle`);
      assert.equal(c.fields, "*", `${op} : fields`);
      break;
    default:
      assert.fail(`opération inconnue : ${op}`);
  }
}

// Ligne modèle à six colonnes (structure du Livret), styles différenciés.
function ligneModele6() {
  const fond = (n) => ({ backgroundColor: { color: { rgbColor: { red: n % 2, green: (n + 1) % 2, blue: 0 } } } });
  return {
    styleLigne: { minRowHeight: { magnitude: 24, unit: "PT" } },
    cellules: [
      { texte: "{{#suivi_pedagogique}}{{seance_date}}", styleCellule: fond(0), styleTexte: { bold: true }, styleParagraphe: { alignment: "CENTER" } },
      { texte: "{{seance_competences}}", styleCellule: fond(1), styleTexte: { italic: true } },
      { texte: "{{seance_activites}}", styleCellule: fond(2), styleTexte: {} },
      { texte: "{{suivi_accompagnement}}", styleCellule: fond(3), styleTexte: {} },
      { texte: "{{suivi_difficultes}}", styleCellule: fond(4), styleTexte: {} },
      { texte: "{{suivi_impressions}}{{/suivi_pedagogique}}", styleCellule: fond(5), styleTexte: {} },
    ],
  };
}
const entete6 = () => ({ cellules: [{ texte: "Date" }, { texte: "Compétences" }, { texte: "Exercices" }, { texte: "Accompagnement" }, { texte: "Difficultés" }, { texte: "Impressions" }] });
const seance = (d, i) => ({ date_seance: d, competences: [`c${i}`], activites: `a${i}`, accompagnement: `acc${i}`, difficultes: `diff${i}`, impressions: `imp${i}` });

test("DOC-7D : schéma Google Docs valide pour 3 séances, 6 colonnes, styles conservés", () => {
  const d = doc([tableau([entete6(), ligneModele6()])]);
  const lignes = [seance("2026-09-08", 1), seance("2026-09-10", 2), seance("2026-09-12", 3)];
  const { requetes } = planBlocsTableau(d, { suivi_pedagogique: lignes });
  for (const r of requetes) validerSchemaRequete(r);
  assert.equal(requetes.filter((r) => r.insertTableRow).length, 2, "3 séances → 2 insertions");
  assert.equal(requetes.filter((r) => r.updateTableRowStyle).length, 2, "2 lignes nouvelles stylées");
  assert.equal(requetes.filter((r) => r.updateTableCellStyle).length, 12, "2 lignes × 6 cellules stylées");
});

test("DOC-7D : 0 séance → une seule requête (deleteTableRow), aucun style", () => {
  const d = doc([tableau([entete6(), ligneModele6()])]);
  const { requetes } = planBlocsTableau(d, { suivi_pedagogique: [] });
  assert.equal(requetes.length, 1);
  validerSchemaRequete(requetes[0]);
  assert.ok(requetes[0].deleteTableRow);
});

test("DOC-7D : 1 séance → aucune insertion, aucun replay de style (ligne modèle intacte)", () => {
  const d = doc([tableau([entete6(), ligneModele6()])]);
  const { requetes } = planBlocsTableau(d, { suivi_pedagogique: [seance("2026-09-08", 1)] });
  for (const r of requetes) validerSchemaRequete(r);
  assert.equal(requetes.filter((r) => r.insertTableRow).length, 0, "1 séance → aucune insertion");
  assert.equal(requetes.filter((r) => r.updateTableCellStyle).length, 0, "pas de replay de style pour la ligne modèle");
});

