// ─────────────────────────────────────────────────────────────
//  DOC-6C — Blocs répétables dans une LIGNE DE TABLEAU Google Docs.
//
//  Complète le moteur DOC-6A (texte) par un moteur de DUPLICATION
//  FIDÈLE d'une ligne modèle de tableau. Module PUR : il reçoit le JSON
//  d'un Google Doc (celui renvoyé par docs.documents.get), localise les
//  marqueurs de blocs, classe chaque occurrence, et produit les requêtes
//  batchUpdate (insertTableRow / deleteTableRow / insertText /
//  deleteContentRange / updateTextStyle / updateParagraphStyle /
//  updateTableCellStyle / updateTableRowStyle) avec des index
//  DÉTERMINISTES. Aucun appel réseau. Aucune dépendance à un bloc métier.
//
//  Contrat de fidélité (V1) : une ligne n'est dupliquée que si on peut
//  reproduire sa mise en forme. Tout le reste est REFUSÉ (jamais un
//  rendu dégradé). Sous-ensemble V1 supporté, documenté dans
//  `raisonsRefus()` / les libellés ci-dessous :
//    · ligne simple : une cellule = UN paragraphe, un seul style de texte
//      par cellule (plusieurs text runs de même style acceptés) ;
//    · pas de cellule fusionnée, pas de tableau imbriqué, pas d'image/
//      dessin, pas d'en-tête/pied de page ;
//    · un seul bloc par ligne, marqueurs d'ouverture et de fermeture dans
//      la MÊME ligne.
// ─────────────────────────────────────────────────────────────
import { rendreCellule } from "./renduBlocs.js";

// ── Libellés de refus (partagés avec le précontrôle) ─────────
export const RAISONS_TABLEAU = {
  bloc_traverse_lignes: "les marqueurs d'ouverture et de fermeture ne sont pas dans la même ligne de tableau",
  bloc_traverse_tableaux: "les marqueurs traversent plusieurs tableaux",
  bloc_traverse_tableau_et_texte: "un marqueur est dans un tableau et l'autre dans le texte courant",
  bloc_tableau_hors_corps: "le bloc est dans un en-tête ou un pied de page (non dupliqué)",
  plusieurs_blocs_dans_ligne: "la ligne contient plusieurs blocs répétables",
  cellules_fusionnees: "la ligne contient des cellules fusionnées (largeur/hauteur variables)",
  tableau_imbrique: "la ligne contient un tableau imbriqué",
  contenu_non_textuel: "la ligne contient une image, un dessin ou un contenu non textuel",
  paragraphes_multiples: "une cellule de la ligne contient plusieurs paragraphes",
  styles_textes_multiples: "une cellule de la ligne mélange plusieurs styles de texte",
};

// Retire les métadonnées de suggestion (`suggested…`) illégales dans les
// requêtes d'écriture, récursivement. N'altère aucune valeur utile.
function nettoyerStyle(v) {
  if (Array.isArray(v)) return v.map(nettoyerStyle);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (k.startsWith("suggested")) continue;
      out[k] = nettoyerStyle(val);
    }
    return out;
  }
  return v;
}

const styleUtile = (obj) => {
  const n = nettoyerStyle(obj);
  return n && typeof n === "object" && Object.keys(n).length ? n : null;
};

const cleCellule = (tableDebut, ligne, colonne) => `${tableDebut}:${ligne}:${colonne}`;

// ── Parcours structurel ─────────────────────────────────────
// Construit, en UNE passe, la liste ordonnée des segments de texte
// (paragraphes du corps ET des en-têtes/pieds de page) avec leur contexte
// structurel (corps / table / hors-corps), et l'inventaire des cellules.
// Les index absolus (startIndex/endIndex) sont lus du JSON quand il les
// fournit ; sinon un compteur séquentiel suffit pour la CLASSIFICATION
// (jamais pour le plan d'écriture, qui exige les vrais index).
function parcourirDoc(docJson) {
  const segments = [];
  const texteParts = [];
  const cellules = new Map();
  const tables = new Map();
  let idx = 0;

  const parcourir = (elements, ctx, horsCorps) => {
    for (const el of elements || []) {
      if (el.paragraph) {
        const p = el.paragraph;
        const runs = (p.elements || []).map((e) => ({
          contenu: e.textRun?.content ?? "",
          style: e.textRun?.textStyle ?? null,
          nonTextuel: !e.textRun,
        }));
        const texteSeg = runs.map((r) => r.contenu).join("");
        const debut = p.startIndex ?? idx;
        const fin = p.endIndex ?? debut + texteSeg.length;
        if (p.startIndex != null) idx = fin;
        segments.push({
          type: ctx.type, horsCorps: !!horsCorps,
          tableDebut: ctx.tableDebut, ligneIndex: ctx.ligneIndex, colonneIndex: ctx.colonneIndex,
          debut, fin, texte: texteSeg,
        });
        texteParts.push(texteSeg);
        if (ctx.type === "table" || ctx.type === "horscorps_table") {
          const cle = cleCellule(ctx.tableDebut, ctx.ligneIndex, ctx.colonneIndex);
          const cell = cellules.get(cle);
          cell.paragraphes++;
          if (cell.texte === null) cell.texte = texteSeg; else cell.texte += texteSeg;
          if (cell.debut == null) { cell.debut = debut; cell.fin = fin; cell.styleParagraphe = p.paragraphStyle ?? null; }
          for (const r of runs) {
            if (r.nonTextuel) cell.nonTextuel = true;
            if (r.style) cell.styles.add(JSON.stringify(nettoyerStyle(r.style)));
            if (cell.styleTexte === null && r.style) cell.styleTexte = r.style;
          }
        }
      } else if (el.table) {
        const t = el.table;
        const tableDebut = t.startIndex ?? idx;
        if (t.startIndex != null) idx = t.endIndex ?? idx;
        const lignes = t.tableRows || [];
        const nombreColonnes = Math.max(0, ...lignes.map((l) => (l.tableCells || []).reduce((s, c) => s + (c.columnSpan ?? 1), 0)));
        tables.set(tableDebut, { nombreColonnes });
        for (let r = 0; r < lignes.length; r++) {
          const row = lignes[r];
          if (row.startIndex != null) idx = row.startIndex;
          const cleLigne = `${tableDebut}:${r}`;
          const styleLigne = row.tableRowStyle ?? null;
          for (let c = 0; c < (row.tableCells || []).length; c++) {
            const cell = row.tableCells[c];
            const typeCellule = horsCorps ? "horscorps_table" : "table";
            if (cell.startIndex != null) idx = cell.startIndex;
            const cle = cleCellule(tableDebut, r, c);
            cellules.set(cle, {
              type: typeCellule, tableDebut, ligneIndex: r, colonneIndex: c,
              paragraphes: 0, styles: new Set(), nonTextuel: false,
              tableImbriquee: (cell.content || []).some((x) => x.table),
              rowSpan: cell.rowSpan ?? 1, columnSpan: cell.columnSpan ?? 1,
              styleCellule: cell.tableCellStyle ?? null, styleLigne,
              cleLigne, debut: null, fin: null, texte: null,
              styleTexte: null, styleParagraphe: null, debutCellule: cell.startIndex ?? null, finCellule: cell.endIndex ?? null,
            });
            parcourir(cell.content, { type: typeCellule, tableDebut, ligneIndex: r, colonneIndex: c }, horsCorps);
            if (cell.endIndex != null) idx = cell.endIndex;
          }
          if (row.endIndex != null) idx = row.endIndex;
        }
        if (t.endIndex != null) idx = t.endIndex;
      }
    }
  };

  parcourir(docJson?.body?.content || [], { type: "corps" }, false);
  for (const partie of [...Object.values(docJson?.headers || {}), ...Object.values(docJson?.footers || {})]) {
    parcourir(partie.content, { type: "corps" }, true);
  }
  return { segments, texte: texteParts.join(""), cellules, tables };
}

const segmentA = (segments, offset) => {
  let cumul = 0;
  for (const s of segments) {
    if (offset < cumul + s.texte.length) return s;
    cumul += s.texte.length;
  }
  return segments[segments.length - 1] || null;
};

// ── Détection des blocs (paires {{#x}} … {{/x}}, sans imbrication) ──
function occurrencesBlocs(texte) {
  const evts = [];
  const re = /\{\{(#|\/)([a-z][a-z0-9_]*)\}\}/g;
  let m;
  while ((m = re.exec(texte))) {
    evts.push({ type: m[1] === "#" ? "ouv" : "ferm", nom: m[2], debut: m.index, fin: m.index + m[0].length });
  }
  const occs = [];
  const pile = [];
  for (const ev of evts) {
    if (ev.type === "ouv") { pile.push({ nom: ev.nom, ouverture: ev }); continue; }
    const i = pile.map((p) => p.nom).lastIndexOf(ev.nom);
    if (i === -1) continue; // mal formé : le validateur l'a déjà signalé
    const [ouv] = pile.splice(i, 1);
    occs.push({ nom: ev.nom, ouverture: ouv.ouverture, fermeture: ev });
  }
  return occs;
}

// ── Inspection d'une ligne modèle (support V1) ──────────────
function inspecterLigne(tableDebut, ligneIndex, { cellules, tables }) {
  const raison = (code) => ({ supportable: false, raison: code });
  const nbColonnes = tables.get(tableDebut)?.nombreColonnes ?? 0;
  const ligne = [];
  for (const cell of cellules.values()) {
    if (cell.tableDebut === tableDebut && cell.ligneIndex === ligneIndex) ligne.push(cell);
  }
  if (!ligne.length) return raison("bloc_traverse_lignes");
  for (const cell of ligne) {
    if (cell.rowSpan > 1 || cell.columnSpan > 1) return raison("cellules_fusionnees");
    if (cell.tableImbriquee) return raison("tableau_imbrique");
    if (cell.nonTextuel) return raison("contenu_non_textuel");
    if (cell.paragraphes !== 1) return raison("paragraphes_multiples");
    if (cell.styles.size > 1) return raison("styles_textes_multiples");
  }
  const sommeSpans = ligne.reduce((s, c) => s + c.columnSpan, 0);
  if (nbColonnes && sommeSpans !== nbColonnes) return raison("cellules_fusionnees");
  return {
    supportable: true,
    raison: null,
    nombreColonnes: nbColonnes,
    styleLigne: styleUtile(ligne[0].styleLigne),
    // Index de fin de la ligne modèle : requis pour calculer les index des
    // nouvelles lignes (une cellule vide = un caractère « \n »).
    ligneFin: Math.max(...ligne.map((c) => c.finCellule ?? c.fin ?? 0)),
    cellules: ligne
      .sort((a, b) => a.colonneIndex - b.colonneIndex)
      .map((c) => ({
        colonneIndex: c.colonneIndex,
        debut: c.debutCellule ?? c.debut,
        fin: c.finCellule ?? c.fin,
        texte: (c.texte ?? "").replace(/\n$/, ""),
        styleTexte: styleUtile(c.styleTexte),
        styleParagraphe: styleUtile(c.styleParagraphe),
        styleCellule: styleUtile(c.styleCellule),
      })),
  };
}

// ── Classification des blocs (corps / ligne de tableau / refus) ──
export function detecterBlocsTableau(docJson) {
  const { segments, texte, cellules, tables } = parcourirDoc(docJson);
  const occs = occurrencesBlocs(texte).map((occ, i) => {
    const o = segmentA(segments, occ.ouverture.debut);
    const f = segmentA(segments, occ.fermeture.fin - 1);
    if (!o || !f) return { nom: occ.nom, occurrence: i, type: "texte", raison: null };
    const { type, raison } = classer(o, f);
    const base = { nom: occ.nom, occurrence: i, type, raison };
    if (type !== "tableau_ligne") return base;
    const detail = inspecterLigne(o.tableDebut, o.ligneIndex, { cellules, tables });
    if (!detail.supportable) return { ...base, type: "tableau_non_supporte", raison: detail.raison };
    return { ...base, tableDebut: o.tableDebut, ligneIndex: o.ligneIndex, ...detail };
  });
  // Refuse une ligne portant plusieurs blocs (même nom ou non).
  const parLigne = new Map();
  for (const occ of occs) {
    if (occ.type !== "tableau_ligne") continue;
    const cle = `${occ.tableDebut}:${occ.ligneIndex}`;
    if (!parLigne.has(cle)) parLigne.set(cle, []);
    parLigne.get(cle).push(occ);
  }
  for (const groupe of parLigne.values()) {
    if (groupe.length > 1) {
      for (const occ of groupe) { occ.type = "tableau_non_supporte"; occ.raison = "plusieurs_blocs_dans_ligne"; }
    }
  }
  return occs;
}

function classer(o, f) {
  if (o.type === "corps" && f.type === "corps") return { type: "texte", raison: null };
  const oTable = o.type === "table" || o.type === "horscorps_table";
  const fTable = f.type === "table" || f.type === "horscorps_table";
  if (oTable && fTable) {
    if (o.type === "horscorps_table" || f.type === "horscorps_table") return { type: "tableau_non_supporte", raison: "bloc_tableau_hors_corps" };
    if (o.tableDebut !== f.tableDebut) return { type: "tableau_non_supporte", raison: "bloc_traverse_tableaux" };
    if (o.ligneIndex === f.ligneIndex) return { type: "tableau_ligne", raison: null };
    return { type: "tableau_non_supporte", raison: "bloc_traverse_lignes" };
  }
  if (oTable !== fTable) return { type: "tableau_non_supporte", raison: "bloc_traverse_tableau_et_texte" };
  return { type: "texte", raison: null };
}

// Vue LÉGÈRE pour le précontrôle : uniquement type + raison (jamais de
// texte ni de style). Aucune dépendance aux index absolus.
export function classerBlocsDoc(docJson) {
  return detecterBlocsTableau(docJson).map((o) => ({ nom: o.nom, occurrence: o.occurrence, type: o.type, raison: o.raison ?? null }));
}

// ── Requêtes d'écriture ─────────────────────────────────────
function requetesCelluleTexte({ debut, fin, texte, styleTexte, styleParagraphe }) {
  const req = [];
  const finTexte = fin - 1; // conserve le saut de ligne final du paragraphe
  if (finTexte > debut) req.push({ deleteContentRange: { range: { startIndex: debut, endIndex: finTexte } } });
  if (texte.length > 0) {
    req.push({ insertText: { location: { index: debut }, text: texte } });
    if (styleTexte) req.push({ updateTextStyle: { range: { startIndex: debut, endIndex: debut + texte.length }, textStyle: styleTexte, fields: "*" } });
    if (styleParagraphe) req.push({ updateParagraphStyle: { range: { startIndex: debut, endIndex: debut + texte.length }, paragraphStyle: styleParagraphe, fields: "*" } });
  }
  return req;
}

function requeteCelluleStyle(tableDebut, ligne, colonne, styleCellule) {
  // UpdateTableCellStyleRequest : `tableRange` et `tableStartLocation` sont
  // MUTUELLEMENT EXCLUSIFS. Pour cibler une cellule arbitraire, on n'utilise
  // que `tableRange` (dont `tableCellLocation` porte son propre
  // `tableStartLocation`).
  return {
    updateTableCellStyle: {
      tableRange: {
        tableCellLocation: { tableStartLocation: { index: tableDebut }, rowIndex: ligne, columnIndex: colonne },
        rowSpan: 1, columnSpan: 1,
      },
      tableCellStyle: styleCellule,
      fields: "*",
    },
  };
}

function requeteLigneStyle(tableDebut, ligne, styleLigne) {
  // UpdateTableRowStyleRequest : les lignes ciblées sont données par
  // `rowIndices` (tableau), PAS par un `rowIndex` scalaire.
  return { updateTableRowStyle: { tableStartLocation: { index: tableDebut }, rowIndices: [ligne], tableRowStyle: styleLigne, fields: "*" } };
}

// Plan complet des requêtes batchUpdate pour les blocs de tableau.
// `blocsLignes` : { nomBloc: [ligne1, ligne2, …] } (résolus par DOC-6A/6B).
// Ordre DÉTERMINISTE : tables du bas vers le haut, lignes du bas vers le
// haut, cellules de droite à gauche — chaque opération d'écriture textuelle
// se fait à un index encore stable (les insertions/suppressions suivantes
// se font à des index PLUS BAS, déjà traités).
export function planBlocsTableau(docJson, blocsLignes = {}) {
  const occs = detecterBlocsTableau(docJson)
    .filter((o) => o.type === "tableau_ligne")
    .sort((a, b) => b.tableDebut - a.tableDebut);
  const requetes = [];
  const traitees = [];
  for (const occ of occs) {
    const lignes = blocsLignes[occ.nom] || [];
    if (!lignes.length) {
      requetes.push({ deleteTableRow: { tableCellLocation: { tableStartLocation: { index: occ.tableDebut }, rowIndex: occ.ligneIndex, columnIndex: 0 } } });
      traitees.push({ nom: occ.nom, elements: 0 });
      continue;
    }
    // 1. Insertion des lignes vides (structure, index relatifs à la table).
    for (let k = 1; k < lignes.length; k++) {
      requetes.push({ insertTableRow: { tableCellLocation: { tableStartLocation: { index: occ.tableDebut }, rowIndex: occ.ligneIndex, columnIndex: 0 }, insertBelow: true } });
    }
    // 2. Styles des lignes/cellules nouvelles (index-relatifs, sans effet
    //    sur les index absolus).
    for (let k = 1; k < lignes.length; k++) {
      if (occ.styleLigne) requetes.push(requeteLigneStyle(occ.tableDebut, occ.ligneIndex + k, occ.styleLigne));
      for (const cell of occ.cellules) {
        if (cell.styleCellule) requetes.push(requeteCelluleStyle(occ.tableDebut, occ.ligneIndex + k, cell.colonneIndex, cell.styleCellule));
      }
    }
    // 3. Contenu : lignes nouvelles de bas en haut, puis la ligne modèle.
    for (let k = lignes.length - 1; k >= 1; k--) {
      for (let c = occ.cellules.length - 1; c >= 0; c--) {
        const cell = occ.cellules[c];
        const texte = rendreCellule(cell.texte, occ.nom, lignes[k]);
        const debut = occ.ligneFin + (k - 1) * occ.nombreColonnes + cell.colonneIndex;
        requetes.push(...requetesCelluleTexte({ debut, fin: debut + 1, texte, styleTexte: cell.styleTexte, styleParagraphe: cell.styleParagraphe }));
      }
    }
    for (let c = occ.cellules.length - 1; c >= 0; c--) {
      const cell = occ.cellules[c];
      const texte = rendreCellule(cell.texte, occ.nom, lignes[0]);
      requetes.push(...requetesCelluleTexte({ debut: cell.debut, fin: cell.fin, texte, styleTexte: cell.styleTexte, styleParagraphe: cell.styleParagraphe }));
    }
    traitees.push({ nom: occ.nom, elements: lignes.length });
  }
  return { requetes, occurrences: traitees };
}
