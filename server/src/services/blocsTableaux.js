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
          // DOC-7E : seul styleParagraphe est retenu ici — les index de
          // paragraphe (debut/fin) ne sont plus mémorisés à la détection :
          // le plan d'écriture les relit toujours sur la copie Google Docs
          // (planContenuTableaux), jamais depuis une capture figée.
          if (cell.styleParagraphe === null && p.paragraphStyle) cell.styleParagraphe = p.paragraphStyle;
          for (const r of runs) {
            if (r.nonTextuel) cell.nonTextuel = true;
            if (r.style) cell.styles.add(JSON.stringify(nettoyerStyle(r.style)));
            if (cell.styleTexte === null && r.style) cell.styleTexte = r.style;
          }
        }
      } else if (el.table) {
        const t = el.table;
        // DOC-7E — trouvaille confirmée sur un VRAI document (Google Docs
        // API réelle, pas les fixtures de test) : `startIndex`/`endIndex`
        // ne sont JAMAIS portés par `el.table` lui-même — uniquement par
        // l'ÉLÉMENT STRUCTUREL qui l'enveloppe (`el.startIndex`). Lire
        // `t.startIndex` renvoie systématiquement `undefined` en
        // production, et retombait silencieusement sur le compteur
        // approximatif `idx` — jamais fiable pour le PLAN D'ÉCRITURE
        // (`tableStartLocation.index`). C'est la cause la plus probable de
        // l'erreur réelle « index hors paragraphe » : `tableDebut` était
        // déjà faux avant même le calcul des lignes.
        const tableDebut = el.startIndex ?? idx;
        if (el.startIndex != null) idx = el.endIndex ?? idx;
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
              cleLigne, texte: null, styleTexte: null, styleParagraphe: null,
            });
            parcourir(cell.content, { type: typeCellule, tableDebut, ligneIndex: r, colonneIndex: c }, horsCorps);
            if (cell.endIndex != null) idx = cell.endIndex;
          }
          if (row.endIndex != null) idx = row.endIndex;
        }
        if (el.endIndex != null) idx = el.endIndex;
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
    // DOC-7E : aucun index de cellule retenu ici — ni l'ancienne formule
    // (ligneFin + k × nombreColonnes), ni la frontière de cellule
    // (debutCellule/finCellule, qui n'est PAS celle du paragraphe
    // écrivable). Le plan d'écriture relit toujours les vrais index sur
    // la copie Google Docs (planContenuTableaux), jamais une valeur
    // capturée ici.
    cellules: ligne
      .sort((a, b) => a.colonneIndex - b.colonneIndex)
      .map((c) => ({
        colonneIndex: c.colonneIndex,
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

// ── DOC-7F — Masque explicite pour updateParagraphStyle EN TABLEAU ──
// Erreur réelle (Railway, Livret FSE-IA) : « Cannot update page-break-before
// when the range contains paragraphs in a table. » `fields: "*"` demandait
// implicitement `pageBreakBefore` (et tout autre champ présent dans l'objet
// style), une propriété de mise en page INTERDITE pour un paragraphe situé
// DANS un tableau. Remplacé par une LISTE BLANCHE explicite : seules les
// propriétés ci-dessous, réellement COMPATIBLES avec une cellule de
// tableau, sont reprises — `pageBreakBefore` et `headingId` (page-layout,
// sans portée dans une cellule) en sont volontairement exclues, qu'ils
// soient présents ou non dans le style source.
// Portée STRICTE : cette liste ne sert qu'à `requetesCelluleTexte()`, donc
// uniquement à l'écriture de TEXTE DANS UNE CELLULE DE TABLEAU — jamais au
// texte courant hors tableau, qui ne passe jamais par cette fonction.
const PROPRIETES_PARAGRAPHE_TABLEAU = [
  "namedStyleType", "alignment", "lineSpacing", "direction", "spacingMode",
  "spaceAbove", "spaceBelow", "indentFirstLine", "indentStart", "indentEnd",
  "keepLinesTogether", "keepWithNext", "avoidWidowAndOrphan", "shading",
  "borderBetween", "borderTop", "borderBottom", "borderLeft", "borderRight", "tabStops",
];

// Ne garde que les propriétés de la liste blanche RÉELLEMENT présentes
// dans `styleParagraphe` ; construit le masque `fields` à partir de cette
// même liste filtrée (jamais `"*"`). `null` si rien d'autorisé ne reste —
// le paragraphe garde alors simplement son style par défaut, pas une
// dégradation d'une propriété visible (seules des propriétés de mise en
// page sans effet dans une cellule sont écartées).
function styleParagrapheTableau(styleParagraphe) {
  if (!styleParagraphe) return null;
  const champs = PROPRIETES_PARAGRAPHE_TABLEAU.filter((k) => Object.prototype.hasOwnProperty.call(styleParagraphe, k));
  if (!champs.length) return null;
  const style = {};
  for (const k of champs) style[k] = styleParagraphe[k];
  return { style, fields: champs.join(",") };
}

// ── Requêtes d'écriture ─────────────────────────────────────
function requetesCelluleTexte({ debut, fin, texte, styleTexte, styleParagraphe }) {
  const req = [];
  const finTexte = fin - 1; // conserve le saut de ligne final du paragraphe
  if (finTexte > debut) req.push({ deleteContentRange: { range: { startIndex: debut, endIndex: finTexte } } });
  if (texte.length > 0) {
    req.push({ insertText: { location: { index: debut }, text: texte } });
    if (styleTexte) req.push({ updateTextStyle: { range: { startIndex: debut, endIndex: debut + texte.length }, textStyle: styleTexte, fields: "*" } });
    const pp = styleParagrapheTableau(styleParagraphe);
    if (pp) req.push({ updateParagraphStyle: { range: { startIndex: debut, endIndex: debut + texte.length }, paragraphStyle: pp.style, fields: pp.fields } });
  }
  return req;
}

// DOC-7F — Audit des autres `fields: "*"` du moteur : `updateTextStyle`
// (TextStyle : gras, italique, couleur, police…) et `updateTableCellStyle`/
// `updateTableRowStyle` (TableCellStyle/TableRowStyle : propriétés NATIVES
// de cellule/ligne — fond, bordures, marges, hauteur, alignement du
// contenu) n'ont AUCUNE propriété de mise en page de type « saut de page »
// ni d'autre restriction documentée propre aux tableaux : contrairement à
// ParagraphStyle (partagé entre le texte courant et les cellules, avec des
// propriétés interdites dans ce second cas), ces trois API sont déjà
// scopées aux tableaux par construction. `fields: "*"` y reste inchangé.
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
//
// DOC-7E — DEUX PHASES : les index des lignes NOUVELLES ne sont plus déduits
// par une formule non garantie. `planStructureTableaux` ne produit QUE les
// requêtes STRUCTURELLES (insertion/suppression de lignes + styles, index
// relatifs à la table) et les SPECS de remplissage ; `planContenuTableaux`
// produit les requêtes de CONTENU (texte + styles) à partir des VRAIS index
// lus sur la copie (après relecture de `documents.get`).
export function planStructureTableaux(docJson, blocsLignes = {}) {
  const occs = detecterBlocsTableau(docJson)
    .filter((o) => o.type === "tableau_ligne")
    .sort((a, b) => b.tableDebut - a.tableDebut);
  const requetes = [];
  const blocs = [];
  for (const occ of occs) {
    const lignes = blocsLignes[occ.nom] || [];
    if (!lignes.length) {
      requetes.push({ deleteTableRow: { tableCellLocation: { tableStartLocation: { index: occ.tableDebut }, rowIndex: occ.ligneIndex, columnIndex: 0 } } });
      blocs.push({ nom: occ.nom, tableDebut: occ.tableDebut, ligneIndex: occ.ligneIndex, nombreColonnes: occ.nombreColonnes, nbLignes: 0, cellulesModele: [], cellulesNouvelles: [] });
      continue;
    }
    // 1. Insertion des lignes vides (structure, index relatifs à la table).
    for (let k = 1; k < lignes.length; k++) {
      requetes.push({ insertTableRow: { tableCellLocation: { tableStartLocation: { index: occ.tableDebut }, rowIndex: occ.ligneIndex, columnIndex: 0 }, insertBelow: true } });
    }
    // 2. Styles : lignes/cellules NOUVELLES (k ≥ 1) ; restauration de la ligne
    //    modèle (k = 0) seulement si des lignes ont été insérées — Google peut
    //    alors avoir ajusté ses bordures, on les rejoue.
    for (let k = (lignes.length >= 2 ? 0 : 1); k < lignes.length; k++) {
      if (occ.styleLigne) requetes.push(requeteLigneStyle(occ.tableDebut, occ.ligneIndex + k, occ.styleLigne));
      for (const cell of occ.cellules) {
        if (cell.styleCellule) requetes.push(requeteCelluleStyle(occ.tableDebut, occ.ligneIndex + k, cell.colonneIndex, cell.styleCellule));
      }
    }
    // 3. Specs de remplissage (texte rendu + styles), index résolus plus tard.
    const cellulesModele = occ.cellules.map((cell) => ({
      colonneIndex: cell.colonneIndex, texte: rendreCellule(cell.texte, occ.nom, lignes[0]),
      styleTexte: cell.styleTexte, styleParagraphe: cell.styleParagraphe,
    }));
    const cellulesNouvelles = [];
    for (let k = 1; k < lignes.length; k++) {
      for (const cell of occ.cellules) {
        cellulesNouvelles.push({
          k, colonneIndex: cell.colonneIndex, texte: rendreCellule(cell.texte, occ.nom, lignes[k]),
          styleTexte: cell.styleTexte, styleParagraphe: cell.styleParagraphe,
        });
      }
    }
    blocs.push({ nom: occ.nom, tableDebut: occ.tableDebut, ligneIndex: occ.ligneIndex, nombreColonnes: occ.nombreColonnes, nbLignes: lignes.length, cellulesModele, cellulesNouvelles });
  }
  return { requetes, blocs };
}

// Retrouve une table dans le JSON de la COPIE par son startIndex (inchangé
// par l'insertion de lignes : l'index d'une table ne bouge qu'en cas d'écriture
// AVANT elle, ce qui n'arrive pas en phase structurelle).
function trouverTable(copyJson, tableDebut) {
  for (const el of copyJson?.body?.content || []) {
    // `el.startIndex`, pas `el.table.startIndex` (toujours absent en
    // réel) — voir le commentaire détaillé dans parcourirDoc().
    if (el.table && el.startIndex === tableDebut) return el.table;
  }
  return null;
}

// DOC-7E — le point exact de l'audit demandé : la limite ÉCRIVABLE d'une
// cellule n'est PAS sa frontière structurelle (`tableCell.startIndex` /
// `.endIndex`, la frontière de la CELLULE elle-même), mais celle de son
// PREMIER PARAGRAPHE (`cell.content[0].startIndex/.endIndex`) — exactement
// comme `parcourirDoc()` le fait déjà pour la détection. Insérer à la
// frontière de cellule a produit l'erreur réelle « index hors paragraphe »
// (ex. index 756 refusé par Google) : ce n'était pas qu'un problème de
// FORMULE non garantie (corrigé par la relecture ci-dessous), mais aussi un
// problème de RÉFÉRENCE (la mauvaise frontière était ciblée, relue ou non).
function paragrapheCellule(cell) {
  const el = (cell?.content || []).find((x) => x.paragraph);
  return el ? { debut: el.startIndex, fin: el.endIndex } : null;
}

// Requêtes de CONTENU (texte + styles), à partir des VRAIS index de la copie
// (relecture après insertion). Ordre déterministe DESCENDANT : lignes nouvelles
// du bas vers le haut, puis ligne modèle ; cellules de droite à gauche — chaque
// écriture se fait à un index encore stable.
export function planContenuTableaux(copyJson, plan) {
  const requetes = [];
  const blocs = [...(plan.blocs || [])].sort((a, b) => b.tableDebut - a.tableDebut);
  for (const bloc of blocs) {
    if (!bloc.nbLignes) continue;
    const table = trouverTable(copyJson, bloc.tableDebut);
    if (!table) continue;
    const lignes = table.tableRows || [];
    // Lignes nouvelles, de bas en haut, cellules de droite à gauche.
    const nouvelles = [...(bloc.cellulesNouvelles || [])].sort((a, b) => (b.k - a.k) || (b.colonneIndex - a.colonneIndex));
    for (const cell of nouvelles) {
      const p = paragrapheCellule(lignes[bloc.ligneIndex + cell.k]?.tableCells?.[cell.colonneIndex]);
      if (!p) continue;
      requetes.push(...requetesCelluleTexte({ debut: p.debut, fin: p.fin, texte: cell.texte, styleTexte: cell.styleTexte, styleParagraphe: cell.styleParagraphe }));
    }
    // Ligne modèle, cellules de droite à gauche.
    const modele = [...(bloc.cellulesModele || [])].sort((a, b) => b.colonneIndex - a.colonneIndex);
    for (const cell of modele) {
      const p = paragrapheCellule(lignes[bloc.ligneIndex]?.tableCells?.[cell.colonneIndex]);
      if (!p) continue;
      requetes.push(...requetesCelluleTexte({ debut: p.debut, fin: p.fin, texte: cell.texte, styleTexte: cell.styleTexte, styleParagraphe: cell.styleParagraphe }));
    }
  }
  return requetes;
}
