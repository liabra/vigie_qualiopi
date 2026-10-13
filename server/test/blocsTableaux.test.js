// ─────────────────────────────────────────────────────────────
//  DOC-6C/7E — Moteur de duplication fidèle d'une ligne de tableau Docs.
//  Tests PURS : aucun Drive, aucun réseau. Le JSON Google Docs est
//  construit localement avec de VRAIS index absolus (startIndex/endIndex),
//  ce qui permet de vérifier à la fois la classification structurelle, le
//  plan d'écriture et la stabilité des index (simulateur).
//
//  DOC-7E : deux phases. `planStructureTableaux` (structure + specs) est
//  testée seule ; `planContenuTableaux` (contenu, à partir des VRAIS index
//  d'une « copie » post-insertion) est testée avec une copie CONSTRUITE
//  INDÉPENDAMMENT — jamais dérivée par une formule — exactement comme
//  `documents.js` le fait avec une vraie relecture `documents.get`.
// ─────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { detecterBlocsTableau, classerBlocsDoc, planStructureTableaux, planContenuTableaux } from "../src/services/blocsTableaux.js";

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
  // DOC-7E : conforme à la VRAIE API Google Docs — startIndex/endIndex ne
  // sont JAMAIS portés par `table` lui-même, seulement par l'élément
  // structurel qui l'enveloppe (vérifié sur un document réel). Volontairement
  // PAS de startIndex/endIndex ici : un code qui lirait `el.table.startIndex`
  // par erreur casserait ces tests, au lieu d'être validé à tort.
  return { startIndex: debut, endIndex: fin, table: { tableRows } };
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

// ── DOC-7E : utilitaires de test pour le flux à DEUX PHASES ─
//
// `genererDeuxPhases` construit le document ORIGINAL (modèle), calcule le
// plan structurel, puis construit la « copie » INDÉPENDAMMENT (nouvelles
// lignes VIDES — exactement ce que Google crée réellement : une cellule
// neuve ne contient qu'un paragraphe vide « \n », AUCUNE propriété de
// style propre avant que les requêtes de style ne s'appliquent) et calcule
// le plan de contenu à partir des VRAIS index de cette copie. Si le modèle
// d'index de `planContenuTableaux` ne correspondait pas à la structure
// réelle d'une copie Google Docs, les tests contenu (texte attendu,
// absence de balise, cellule correcte) échoueraient de façon révélatrice —
// ce n'est plus une simple vérification du simulateur.
function ligneVide(nbColonnes) {
  return { cellules: Array.from({ length: nbColonnes }, () => ({ texte: "" })) };
}

// `avantTextes`/`apresTextes` : TEXTES (pas des objets déjà construits) —
// les paragraphes correspondants sont construits ICI, dans l'ORDRE RÉEL
// (avant la table, puis après), avec le MÊME compteur séquentiel partagé.
// Construire les paragraphes à l'extérieur, comme arguments pré-évalués,
// décale `compteur` AVANT que la table ne soit bâtie et désynchronise les
// index de la copie — c'est ce qui a été corrigé ici.
function genererDeuxPhases(avantTextes, entete, specLigneModele, apresTextes, blocsLignes) {
  const construire = () => {
    resetCompteur();
    const avant = avantTextes.map((t) => paragraphe(t));
    const tbl = tableau([entete, specLigneModele]);
    const apres = apresTextes.map((t) => paragraphe(t));
    return { body: { content: [...avant, tbl, ...apres] }, headers: {}, footers: {} };
  };
  const docOriginal = construire();
  const plan = planStructureTableaux(docOriginal, blocsLignes);
  const bloc = plan.blocs[0];
  const nbColonnes = bloc?.nombreColonnes || entete.cellules.length;
  let docCopie;
  if (!bloc || bloc.nbLignes === 0) {
    // Ligne modèle supprimée : planContenuTableaux n'a rien à faire pour ce
    // bloc (bloc.nbLignes === 0 → ignoré), la « copie » n'a pas besoin
    // d'exister pour ce test — on retourne le document original tel quel.
    docCopie = docOriginal;
  } else {
    const lignesVides = Array.from({ length: Math.max(0, bloc.nbLignes - 1) }, () => ligneVide(nbColonnes));
    resetCompteur();
    const avant = avantTextes.map((t) => paragraphe(t));
    const tbl = tableau([entete, specLigneModele, ...lignesVides]);
    const apres = apresTextes.map((t) => paragraphe(t));
    docCopie = { body: { content: [...avant, tbl, ...apres] }, headers: {}, footers: {} };
  }
  const requetes = [...plan.requetes, ...planContenuTableaux(docCopie, plan)];
  return { requetes, plan, docOriginal, docCopie };
}

// ── Plan d'écriture (0 / 1 / N éléments) ────────────────────
test("0 élément → la ligne modèle est supprimée (deleteTableRow)", () => {
  const entete = { cellules: [{ texte: "Date" }, { texte: "Intitulé" }] };
  const { requetes, plan } = genererDeuxPhases(["Intro"], entete, ligneModele(), [], { evaluations: [] });
  assert.equal(plan.blocs[0].nbLignes, 0);
  assert.equal(requetes.length, 1);
  assert.ok(requetes[0].deleteTableRow);
  assert.equal(requetes[0].deleteTableRow.tableCellLocation.rowIndex, 1);
});

test("1 élément → aucune insertion, la ligne modèle est remplie, aucun marqueur", () => {
  const entete = { cellules: [{ texte: "Date" }, { texte: "Intitulé" }] };
  const lignes = [{ date_passage: "2026-02-10", intitule: "QCM final", score: 17, score_max: 20 }];
  const { requetes } = genererDeuxPhases([], entete, ligneModele(), [], { evaluations: lignes });
  const types = requetes.map((r) => Object.keys(r)[0]);
  assert.ok(!types.includes("insertTableRow"));
  assert.ok(types.includes("deleteContentRange"));
  assert.ok(types.includes("insertText"));
  // les marqueurs de bloc ne subsistent dans AUCUN texte inséré
  for (const r of requetes) if (r.insertText) assert.ok(!r.insertText.text.includes("{{"), r.insertText.text);
});

test("3 éléments → exactement 3 lignes rendues, ordre conservé", () => {
  const entete = { cellules: [{ texte: "Date" }, { texte: "Intitulé" }] };
  const lignes = [
    { date_passage: "2026-01-05", intitule: "A", score: 1, score_max: 2 },
    { date_passage: "2026-01-06", intitule: "B", score: 2, score_max: 2 },
    { date_passage: "2026-01-07", intitule: "C", score: 3, score_max: 3 },
  ];
  const { requetes, plan } = genererDeuxPhases([], entete, ligneModele(), [], { evaluations: lignes });
  assert.equal(plan.blocs[0].nbLignes, 3);
  const insertions = requetes.filter((r) => r.insertTableRow);
  assert.equal(insertions.length, 2);
  const textes = requetes.filter((r) => r.insertText).map((r) => r.insertText.text);
  assert.ok(textes.includes("A"));
  assert.ok(textes.includes("B"));
  assert.ok(textes.includes("C"));
  // Ordre d'ÉCRITURE déterministe : lignes nouvelles de bas en haut (C, B),
  // puis la ligne modèle (A) — index décroissants, jamais recalculés après coup.
  const ordre = textes.filter((t) => ["A", "B", "C"].includes(t));
  assert.deepEqual(ordre, ["C", "B", "A"]);
});

test("plusieurs variables dans une même cellule (score / score_max)", () => {
  const entete = { cellules: [{ texte: "x" }] };
  const spec = { cellules: [{ texte: "{{#evaluations}}{{evaluation_score_obtenu}} / {{evaluation_score_max}}{{/evaluations}}" }] };
  const { requetes } = genererDeuxPhases([], entete, spec, [], { evaluations: [{ score: 17, score_max: 20 }] });
  const ins = requetes.find((r) => r.insertText);
  assert.equal(ins.insertText.text, "17 / 20");
});

test("bloc absences : rendu réel des champs résolubles", () => {
  const entete = { cellules: [{ texte: "x" }] };
  const spec = { cellules: [{ texte: "{{#absences}}{{absence_date}} — {{absence_duree_heures}}{{/absences}}" }] };
  const { requetes } = genererDeuxPhases([], entete, spec, [], { absences: [{ date_absence: "2026-01-05", duree_heures: 3.5 }] });
  const ins = requetes.find((r) => r.insertText);
  assert.equal(ins.insertText.text, "05/01/2026 — 3.5 h");
});

test("champ non résoluble : laissé tel quel (jamais inventé)", () => {
  const entete = { cellules: [{ texte: "x" }] };
  const spec = { cellules: [{ texte: "{{#evaluations}}{{evaluation_moment}}{{/evaluations}}" }] };
  const { requetes } = genererDeuxPhases([], entete, spec, [], { evaluations: [{ intitule: "QCM" }] });
  const ins = requetes.find((r) => r.insertText);
  assert.equal(ins.insertText.text, "{{evaluation_moment}}");
});

test("champ facultatif (absence_motif) : vide sans motif, rendu sans erreur quand renseigné", () => {
  const entete = { cellules: [{ texte: "Date" }, { texte: "Motif" }] };
  const spec = { cellules: [{ texte: "{{#absences}}{{absence_date}}" }, { texte: "{{absence_motif}}{{/absences}}" }] };
  const lignes = [{ date_absence: "2026-01-05", motif: null }, { date_absence: "2026-01-06", motif: "Rendez-vous médical" }];
  const { requetes } = genererDeuxPhases([], entete, spec, [], { absences: lignes });
  const textes = requetes.filter((r) => r.insertText).map((r) => r.insertText.text);
  assert.ok(textes.includes("Rendez-vous médical"));
  // Un motif absent produit une cellule vide : AUCUNE requête insertText
  // n'est émise pour elle (cf. requetesCelluleTexte, `texte.length > 0`),
  // jamais une valeur inventée ni un texte « undefined ».
  assert.ok(!textes.includes(undefined));
  assert.ok(!textes.some((t) => t.includes("undefined") || t.includes("null")));
});

test("styles différents entre cellules : une requête updateTableCellStyle par cellule, modèle restauré compris", () => {
  const entete = { cellules: [{ texte: "Date" }] };
  const { requetes } = genererDeuxPhases([], entete, ligneModele(), [], { evaluations: [{ date_passage: "2026-02-10", intitule: "Q", score: 1, score_max: 2 }, { date_passage: "2026-02-11", intitule: "Q2", score: 2, score_max: 2 }] });
  const styles = requetes.filter((r) => r.updateTableCellStyle);
  // DOC-7E : dès qu'une ligne est insérée, la ligne MODÈLE est aussi
  // restylée (Google peut avoir ajusté ses bordures) : 2 lignes (modèle +
  // 1 nouvelle) × 3 cellules = 6 mises à jour de style cellule, 2 lignes stylées.
  assert.equal(styles.length, 6);
  assert.equal(requetes.filter((r) => r.updateTableRowStyle).length, 2);
});

test("aucun texte inséré dans une mauvaise cellule : chaque valeur atterrit à l'index de SA colonne", () => {
  const entete = { cellules: [{ texte: "Date" }, { texte: "Intitulé" }, { texte: "Score" }] };
  const spec = {
    cellules: [
      { texte: "{{#evaluations}}{{evaluation_date}}" },
      { texte: "{{evaluation_intitule}}" },
      { texte: "{{evaluation_score_obtenu}}{{/evaluations}}" },
    ],
  };
  const lignes = [{ date_passage: "2026-01-05", intitule: "ALPHA", score: 9 }];
  const { requetes, plan, docCopie } = genererDeuxPhases([], entete, spec, [], { evaluations: lignes });
  const table = docCopie.body.content.find((e) => e.table).table;
  const ligneModeleCopie = table.tableRows[plan.blocs[0].ligneIndex];
  const attendu = ligneModeleCopie.tableCells.map((c) => c.content[0].startIndex);
  const inserts = requetes.filter((r) => r.insertText).sort((a, b) => a.insertText.location.index - b.insertText.location.index);
  assert.deepEqual(inserts.map((r) => r.insertText.location.index), attendu);
  assert.deepEqual(inserts.map((r) => r.insertText.text), ["05/01/2026", "ALPHA", "9"]);
});

// ── DOC-7E : résolution des index via la frontière du PARAGRAPHE, pas de
// la cellule — c'est la régression concrète observée en réel (insertion à
// un index hors paragraphe, refusée par Google).
test("DOC-7E : l'écriture cible le début du PARAGRAPHE de la cellule, jamais la frontière de la cellule elle-même", () => {
  const entete = { cellules: [{ texte: "x" }] };
  const spec = { cellules: [{ texte: "{{#evaluations}}{{evaluation_intitule}}{{/evaluations}}" }] };
  const { requetes, plan, docCopie } = genererDeuxPhases([], entete, spec, [], { evaluations: [{ intitule: "Q" }] });
  const table = docCopie.body.content.find((e) => e.table).table;
  const cell = table.tableRows[plan.blocs[0].ligneIndex].tableCells[0];
  const frontiereCellule = cell.startIndex;
  const debutParagraphe = cell.content[0].startIndex;
  const ins = requetes.find((r) => r.insertText);
  assert.equal(ins.insertText.location.index, debutParagraphe);
  // Dans ce générateur de test, cellule et paragraphe partagent le même
  // index (cas simple) — le test ci-dessus reste donc une garantie de
  // RÉFÉRENCE (on lit bien `content[0]`, pas `cell.startIndex` en soi),
  // vérifiée explicitement par lecture du CODE SOURCE ci-dessous.
  assert.equal(frontiereCellule, debutParagraphe, "dans ce générateur, les deux coïncident : la vraie preuve est la lecture du code");
});

test("DOC-7E : la ligne modèle ET les lignes nouvelles utilisent les VRAIS index relus, pas une formule", () => {
  const entete = { cellules: [{ texte: "Date" }, { texte: "Intitulé" }] };
  const lignes = [
    { date_passage: "2026-01-05", intitule: "A", score: 1, score_max: 2 },
    { date_passage: "2026-01-06", intitule: "B", score: 2, score_max: 2 },
  ];
  const { requetes, plan, docCopie } = genererDeuxPhases(["Avant le tableau pour décaler les index"], entete, ligneModele(), ["Après"], { evaluations: lignes });
  const table = docCopie.body.content.find((e) => e.table).table;
  const indexAttendus = new Set();
  for (const row of table.tableRows.slice(plan.blocs[0].ligneIndex)) {
    for (const cell of row.tableCells) indexAttendus.add(cell.content[0].startIndex);
  }
  for (const r of requetes) {
    if (r.insertText) assert.ok(indexAttendus.has(r.insertText.location.index), `index ${r.insertText.location.index} absent de la copie relue`);
  }
});

// ── Simulateur d'index Google Docs (anti décalage) ──────────
// Représente le document par une chaîne plate + la structure des tables,
// applique les requêtes dans l'ordre, et vérifie le résultat final. Les
// requêtes de PHASE 1 (structure) sont rejouées sur un simulateur construit
// depuis le document ORIGINAL ; les requêtes de PHASE 2 (contenu, index de
// la copie construite indépendamment) sont rejouées à LA SUITE sur le MÊME
// simulateur — si le modèle d'index de la copie ne correspondait pas à ce
// que la phase 1 produit réellement, le texte final serait incorrect ou
// mal placé : ce test l'aurait révélé.
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

test("simulateur : index stables après les DEUX phases, texte final exact", () => {
  const entete = { cellules: [{ texte: "Date" }, { texte: "Intitulé" }] };
  const lignes = [
    { date_passage: "2026-01-05", intitule: "A", score: 1, score_max: 2 },
    { date_passage: "2026-01-06", intitule: "B", score: 2, score_max: 2 },
    { date_passage: "2026-01-07", intitule: "C", score: 3, score_max: 3 },
  ];
  const { plan, docOriginal, docCopie } = genererDeuxPhases(["Intro"], entete, ligneModele(), ["Conclusion"], { evaluations: lignes });
  const sim = construireSimulateur(docOriginal);
  for (const req of plan.requetes) sim.appliquer(req);
  for (const req of planContenuTableaux(docCopie, plan)) sim.appliquer(req);
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
  const entete = { cellules: [{ texte: "Date" }] };
  const { plan, docOriginal } = genererDeuxPhases(["Intro"], entete, ligneModele(), ["Conclusion"], { evaluations: [] });
  const sim = construireSimulateur(docOriginal);
  for (const req of plan.requetes) sim.appliquer(req);
  assert.equal(sim.tables[0].lignes.length, 1);
  assert.ok(sim.texte.includes("Intro"));
  assert.ok(sim.texte.includes("Conclusion"));
  assert.ok(!sim.texte.includes("{{"));
});

// ── Fidélité : signature structurelle/style identique ───────
test("fidélité : toutes les lignes générées portent la même signature style que la ligne modèle", () => {
  const entete = { cellules: [{ texte: "Date" }, { texte: "Intitulé" }, { texte: "Score" }] };
  const lignes = [
    { date_passage: "2026-01-05", intitule: "A", score: 1, score_max: 2 },
    { date_passage: "2026-01-06", intitule: "B", score: 2, score_max: 2 },
  ];
  const { plan, docOriginal, docCopie } = genererDeuxPhases([], entete, ligneModele(), [], { evaluations: lignes });
  const sim = construireSimulateur(docOriginal);
  for (const req of plan.requetes) sim.appliquer(req);
  for (const req of planContenuTableaux(docCopie, plan)) sim.appliquer(req);

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
  const entete = { cellules: [{ texte: "Date" }, { texte: "Compétences" }, { texte: "Difficultés" }] };
  const spec = { cellules: [
    { texte: "{{#suivi_pedagogique}}{{seance_date}}" },
    { texte: "{{seance_competences}}" },
    { texte: "{{suivi_difficultes}}{{/suivi_pedagogique}}" },
  ] };
  const lignes = [
    { date_seance: "2026-09-10", competences: ["communication"], activites: "Jeu", difficultes: null },
    { date_seance: "2026-09-11", competences: ["autonomie"], activites: "Bilan", difficultes: "Un peu rapide" },
  ];
  const { requetes } = genererDeuxPhases([], entete, spec, [], { suivi_pedagogique: lignes });
  // 2 éléments → 1 ligne insérée ; chaque séance devient une ligne (y compris sans suivi).
  assert.equal(requetes.filter((r) => r.insertTableRow).length, 1);
  const textes = requetes.filter((r) => r.insertText).map((r) => r.insertText.text);
  assert.ok(textes.includes("10/09/2026"));
  assert.ok(textes.includes("communication"));
  assert.ok(textes.includes("11/09/2026"));
  assert.ok(textes.includes("autonomie"));
  assert.ok(textes.includes("Un peu rapide"));
});

// ── DOC-7D/7E : schéma réel Google Docs API ─────────────────
// Les tests ci-dessous vérifient la FORME EXACTE de chaque requête (noms de
// champs officiels, champs mutuellement exclusifs, masques `fields`), pas
// seulement le résultat du simulateur. C'est ce qui a laissé passer la
// requête invalide d'origine (`rowIndex` et double `tableStartLocation`).
// DOC-7E renforce : les index de `insertText`/`deleteContentRange` doivent
// en plus correspondre à un VRAI index de paragraphe de la copie relue —
// plus un calcul « raisonnable » non vérifié.

function validerSchemaRequete(requete, { indexParagraphesValides } = {}) {
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
      if (indexParagraphesValides) assert.ok(indexParagraphesValides.has(c.location.index), `${op} : index ${c.location.index} hors paragraphe`);
      break;
    case "deleteContentRange":
      assert.ok(Number.isInteger(c.range?.startIndex) && Number.isInteger(c.range?.endIndex), `${op} : range`);
      if (indexParagraphesValides) assert.ok(indexParagraphesValides.has(c.range.startIndex), `${op} : startIndex ${c.range.startIndex} hors paragraphe`);
      break;
    case "updateTextStyle":
      assert.ok(Number.isInteger(c.range?.startIndex) && Number.isInteger(c.range?.endIndex), `${op} : range`);
      assert.ok(c.textStyle, `${op} : textStyle`);
      assert.equal(c.fields, "*", `${op} : fields`);
      break;
    case "updateParagraphStyle":
      assert.ok(Number.isInteger(c.range?.startIndex) && Number.isInteger(c.range?.endIndex), `${op} : range`);
      assert.ok(c.paragraphStyle, `${op} : paragraphStyle`);
      // DOC-7F : plus jamais "*" pour un paragraphe de CELLULE — un masque
      // explicite, réduit aux propriétés réellement présentes ET
      // compatibles avec un tableau (jamais pageBreakBefore/headingId).
      assert.notEqual(c.fields, "*", `${op} : masque explicite requis, jamais "*" en tableau`);
      assert.ok(c.fields.length > 0, `${op} : fields non vide`);
      assert.deepEqual(c.fields.split(","), Object.keys(c.paragraphStyle), `${op} : fields = exactement les clés envoyées`);
      assert.ok(!("pageBreakBefore" in c.paragraphStyle), `${op} : pageBreakBefore interdit en tableau`);
      assert.ok(!c.fields.includes("pageBreakBefore"), `${op} : pageBreakBefore absent du masque`);
      assert.ok(!("headingId" in c.paragraphStyle), `${op} : headingId exclu`);
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

// Ensemble des index de PARAGRAPHE réellement écrivables dans la copie
// (utilisé par validerSchemaRequete pour prouver que chaque insertText/
// deleteContentRange cible un vrai paragraphe de la copie relue, jamais un
// calcul).
function indexParagraphesDe(docJson) {
  const s = new Set();
  const parcourir = (elements) => {
    for (const el of elements || []) {
      if (el.paragraph) s.add(el.startIndex);
      if (el.table) for (const row of el.table.tableRows) for (const cell of row.tableCells) parcourir(cell.content);
    }
  };
  parcourir(docJson.body.content);
  return s;
}

test("DOC-7E : schéma Google Docs valide pour 3 séances, 6 colonnes, styles conservés, index tous dans un paragraphe réel", () => {
  const { requetes, docCopie } = genererDeuxPhases([], entete6(), ligneModele6(), [], { suivi_pedagogique: [seance("2026-09-08", 1), seance("2026-09-10", 2), seance("2026-09-12", 3)] });
  const indexValides = indexParagraphesDe(docCopie);
  for (const r of requetes) validerSchemaRequete(r, { indexParagraphesValides: indexValides });
  assert.equal(requetes.filter((r) => r.insertTableRow).length, 2, "3 séances → 2 insertions");
  // DOC-7E : la ligne modèle (k=0) est restaurée en plus des 2 nouvelles
  // (k=1,2) dès qu'une insertion a eu lieu : 3 lignes stylées, pas 2.
  assert.equal(requetes.filter((r) => r.updateTableRowStyle).length, 3, "3 lignes stylées (modèle restauré + 2 nouvelles)");
  assert.equal(requetes.filter((r) => r.updateTableCellStyle).length, 18, "3 lignes × 6 cellules stylées");
  assert.equal(requetes.filter((r) => r.insertText).length, 18, "3 lignes rendues × 6 cellules");
});

test("DOC-7E : 0 séance → une seule requête (deleteTableRow), aucun style", () => {
  const { requetes } = genererDeuxPhases([], entete6(), ligneModele6(), [], { suivi_pedagogique: [] });
  assert.equal(requetes.length, 1);
  validerSchemaRequete(requetes[0]);
  assert.ok(requetes[0].deleteTableRow);
});

test("DOC-7E : 1 séance → aucune insertion, aucun replay de style (ligne modèle intacte), index réel", () => {
  const { requetes, docCopie } = genererDeuxPhases([], entete6(), ligneModele6(), [], { suivi_pedagogique: [seance("2026-09-08", 1)] });
  const indexValides = indexParagraphesDe(docCopie);
  for (const r of requetes) validerSchemaRequete(r, { indexParagraphesValides: indexValides });
  assert.equal(requetes.filter((r) => r.insertTableRow).length, 0, "1 séance → aucune insertion");
  assert.equal(requetes.filter((r) => r.updateTableCellStyle).length, 0, "pas de replay de style pour la ligne modèle");
  assert.equal(requetes.filter((r) => r.insertText).length, 6, "6 cellules remplies");
});

// ── DOC-7F : style de paragraphe fidèle au VRAI Livret Google Docs ──
// Fixture réaliste : les propriétés qu'un paragraphe de cellule porte
// RÉELLEMENT sur le document Google Docs testé (namedStyleType, lineSpacing,
// direction, spaceBelow), PLUS pageBreakBefore — Google l'inclut souvent par
// défaut sur un paragraphe, et c'est exactement la propriété dont l'envoi a
// été refusé par l'API réelle (« Cannot update page-break-before when the
// range contains paragraphs in a table. »).
function ligneModeleLivretReel() {
  const styleParagrapheReel = {
    namedStyleType: "NORMAL_TEXT", lineSpacing: 115, direction: "LEFT_TO_RIGHT", spaceBelow: { magnitude: 10, unit: "PT" },
    pageBreakBefore: false, // présent dans un VRAI document — ne doit JAMAIS être envoyé pour une cellule
  };
  return {
    styleLigne: { minRowHeight: { magnitude: 24, unit: "PT" } },
    cellules: [
      { texte: "{{#suivi_pedagogique}}{{seance_date}}", styleParagraphe: { ...styleParagrapheReel, alignment: "CENTER" } },
      { texte: "{{seance_competences}}", styleParagraphe: styleParagrapheReel },
      { texte: "{{seance_activites}}", styleParagraphe: styleParagrapheReel },
      { texte: "{{suivi_accompagnement}}", styleParagraphe: styleParagrapheReel },
      { texte: "{{suivi_difficultes}}", styleParagraphe: styleParagrapheReel },
      { texte: "{{suivi_impressions}}{{/suivi_pedagogique}}", styleParagraphe: styleParagrapheReel },
    ],
  };
}

function verifierAucunPageBreakBefore(requetes) {
  const styles = requetes.filter((r) => r.updateParagraphStyle);
  assert.ok(styles.length > 0, "au moins une requête updateParagraphStyle à vérifier");
  for (const r of styles) {
    const { paragraphStyle, fields } = r.updateParagraphStyle;
    assert.ok(!("pageBreakBefore" in paragraphStyle), "pageBreakBefore absent du style envoyé");
    assert.ok(!fields.split(",").includes("pageBreakBefore"), "pageBreakBefore absent du masque fields");
    assert.notEqual(fields, "*", "masque explicite, jamais \"*\"");
  }
  return styles;
}

test("DOC-7F : 3 séances, fixture réaliste (namedStyleType/lineSpacing/direction/spaceBelow + pageBreakBefore) — aucun pageBreakBefore envoyé, le reste conservé", () => {
  const { requetes, docCopie } = genererDeuxPhases([], entete6(), ligneModeleLivretReel(), [], { suivi_pedagogique: [seance("2026-09-08", 1), seance("2026-09-10", 2), seance("2026-09-12", 3)] });
  const indexValides = indexParagraphesDe(docCopie);
  for (const r of requetes) validerSchemaRequete(r, { indexParagraphesValides: indexValides });
  const styles = verifierAucunPageBreakBefore(requetes);
  // Les propriétés AUTORISÉES et réellement présentes sont conservées.
  for (const r of styles) {
    const { paragraphStyle, fields } = r.updateParagraphStyle;
    for (const cle of ["namedStyleType", "lineSpacing", "direction", "spaceBelow"]) {
      assert.ok(cle in paragraphStyle, `${cle} conservé`);
      assert.ok(fields.split(",").includes(cle), `${cle} dans le masque`);
    }
  }
  assert.equal(requetes.filter((r) => r.insertTableRow).length, 2, "3 séances → 2 insertions (non régression DOC-7E)");
  assert.equal(requetes.filter((r) => r.insertText).length, 18, "3 lignes × 6 cellules (non régression DOC-7E)");
});

test("DOC-7F : 1 séance et 0 séance — aucun pageBreakBefore, aucune régression des index DOC-7E", () => {
  const un = genererDeuxPhases([], entete6(), ligneModeleLivretReel(), [], { suivi_pedagogique: [seance("2026-09-08", 1)] });
  verifierAucunPageBreakBefore(un.requetes);
  assert.equal(un.requetes.filter((r) => r.insertTableRow).length, 0);

  const zero = genererDeuxPhases([], entete6(), ligneModeleLivretReel(), [], { suivi_pedagogique: [] });
  assert.equal(zero.requetes.length, 1);
  assert.ok(zero.requetes[0].deleteTableRow);
});

test("DOC-7F : un style sans aucune propriété autorisée n'émet aucune requête updateParagraphStyle (jamais \"*\")", () => {
  const entete = { cellules: [{ texte: "x" }] };
  const spec = { cellules: [{ texte: "{{#evaluations}}{{evaluation_intitule}}{{/evaluations}}", styleParagraphe: { pageBreakBefore: true, headingId: "h1" } }] };
  const { requetes } = genererDeuxPhases([], entete, spec, [], { evaluations: [{ intitule: "Q" }] });
  assert.ok(!requetes.some((r) => r.updateParagraphStyle), "aucune propriété autorisée présente : pas de requête, jamais un \"*\" de repli");
  assert.ok(requetes.some((r) => r.insertText), "le texte est quand même inséré");
});

test("DOC-7F : le texte courant HORS tableau n'est jamais affecté par le filtrage (portée strictement table)", () => {
  // requetesDocs()/marqueurs.js (remplacement scalaire hors tableau) ne
  // passe jamais par requetesCelluleTexte()/blocsTableaux.js : aucune
  // requête updateParagraphStyle n'est produite par ce moteur pour le
  // texte courant, par construction (il ne connaît que les cellules).
  const d = doc([paragraphe("Texte hors tableau, jamais concerné par ce moteur.")]);
  const r = classerBlocsDoc(d);
  assert.deepEqual(r, []);
});
