// ─────────────────────────────────────────────────────────────
//  Lecture du classeur de suivi Qualiopi (Google Sheets).
//  Module PUR : aucune dépendance réseau, tout est testable hors ligne.
//  Il reçoit une grille de cellules (tableau de tableaux de chaînes) et
//  en sort des preuves prêtes à insérer.
//
//  Le classeur réel est un tableau de suivi tenu à la main :
//   · les en-têtes ne sont pas en première ligne (lignes de légende avant) ;
//   · l'ordre des colonnes n'est pas garanti — on les retrouve par leur
//     intitulé, jamais par leur position ;
//   · les cellules fusionnées laissent les lignes suivantes vides, d'où la
//     propagation verticale (voir propagerFusions) ;
//   · il y a DEUX colonnes « Etat » (modèle validé, document complété).
// ─────────────────────────────────────────────────────────────

// Sans accents, sans ponctuation, espaces réduits : la comparaison des
// intitulés de colonnes et des noms de documents passe toujours par ici.
export function normaliser(s) {
  return (s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Intitulés reconnus pour chaque colonne utile. Le premier qui correspond
// gagne ; « contient » suffit, les intitulés réels sont bavards
// (« Descriptif / A faire / Contenu des tâches »).
const COLONNES = {
  critere: ["critere", "criteres"],
  indicateur: ["indicateur", "indicateurs", "indic"],
  tache: ["tache", "taches", "tache s"],
  equipier: ["equipier", "responsable"],
  descriptif: ["descriptif", "a faire", "contenu des taches"],
  modele: ["modele de document", "modeles de documents", "modele", "modeles"],
  document: ["document", "documents"],
  important: ["important", "importants"],
  date_fin: ["date fin", "date de fin"],
  etat: ["etat", "etats", "statut"],
};

// Une ligne d'en-têtes : plusieurs intitulés courts et reconnus.
export function trouverEnTetes(grille, { maxLignes = 12 } = {}) {
  let meilleur = { ligne: -1, score: 0, entetes: [] };
  for (let i = 0; i < Math.min(maxLignes, grille.length); i++) {
    const cells = grille[i] || [];
    let score = 0;
    for (const c of cells) {
      const n = normaliser(c);
      if (!n || n.length > 45) continue;
      for (const variantes of Object.values(COLONNES)) {
        if (variantes.some((v) => n === v || n.includes(v))) { score++; break; }
      }
    }
    if (score > meilleur.score) meilleur = { ligne: i, score, entetes: cells.map((c) => (c || "").trim()) };
  }
  return meilleur;
}

// Correspondance intitulé → index de colonne, d'après les en-têtes RÉELS.
// `etat` est une liste : le classeur en a deux (modèle, document).
export function mapperColonnes(entetes) {
  const map = { etat: [] };
  entetes.forEach((brut, i) => {
    const n = normaliser(brut);
    if (!n) return;
    for (const [clef, variantes] of Object.entries(COLONNES)) {
      if (map[clef] !== undefined && clef !== "etat") continue;
      if (!variantes.some((v) => n === v || n.includes(v))) continue;
      if (clef === "etat") map.etat.push(i);
      else map[clef] = i;
      return;
    }
  });
  return map;
}

export function colonnesManquantes(map) {
  const requis = ["indicateur", "document"];
  return requis.filter((c) => map[c] === undefined);
}

// Cellules fusionnées : Google renvoie la valeur sur la première cellule
// et du vide en dessous. On recopie vers le bas, colonne par colonne,
// dans la limite des plages fusionnées quand elles sont connues.
export function propagerFusions(grille, fusions = null) {
  const sortie = grille.map((r) => [...r]);
  if (fusions) {
    for (const f of fusions) {
      const v = sortie[f.debutLigne]?.[f.debutColonne];
      if (v === undefined || v === "") continue;
      for (let l = f.debutLigne; l < f.finLigne; l++) {
        for (let c = f.debutColonne; c < f.finColonne; c++) {
          if (!sortie[l]) sortie[l] = [];
          sortie[l][c] = v;
        }
      }
    }
  }
  return sortie;
}

// « Indic 1 - … », « Indicateur 27 : … », « Ind. 5 », « 12 » → 12.
export function numeroIndicateur(texte) {
  const t = (texte || "").trim();
  if (!t) return null;
  const m = /^(?:indic(?:ateur)?s?\.?)?\s*n?[°o]?\s*(\d{1,2})\b/i.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 40 ? n : null;
}

// Valeurs de la colonne d'état, telles qu'écrites dans le classeur.
// « check ok » = validé en audit, « en cours » = à compléter,
// « pas besoin » = hors périmètre.
export function statutDepuisEtat(etats) {
  const vus = (Array.isArray(etats) ? etats : [etats]).map(normaliser).filter(Boolean);
  if (vus.some((e) => e.includes("pas besoin") || e.includes("non applicable") || e.includes("sans objet") || e === "na"))
    return "non_applicable";
  if (vus.some((e) => e.includes("en cours") || e.includes("a completer") || e.includes("a faire") || e.includes("aval")))
    return "a_consolider";
  if (vus.some((e) => e.includes("check ok") || e === "ok" || e.includes("valide") || e.includes("fait")))
    return "maitrise";
  return "a_risque";
}

// Restes de mise en page et renvois sans nom de fichier exploitable.
const BRUIT = [
  /^[-\s_.:]*$/,
  /^ici$/i,
  /^o(ui)?$/i,
  /^non$/i,
  /^[-\s]*documents?\s+sur\s+le\s+drive[-\s]*$/i,
  /^[-\s]*voir\s+(le\s+)?drive[-\s]*$/i,
  /^:-:$/,
];
export const estBruit = (v) => { const t = (v || "").trim(); return !t || BRUIT.some((r) => r.test(t)); };

// Grille → preuves. Une preuve par couple (indicateur, document) : les
// cellules fusionnées répètent le même document sur plusieurs lignes, on
// les regroupe en comptant les occurrences plutôt que de créer des doublons.
export function extrairePreuves(grille, { fusions = null } = {}) {
  const propagee = propagerFusions(grille, fusions);
  const entete = trouverEnTetes(propagee);
  if (entete.ligne < 0) {
    return {
      erreur: "Colonnes introuvables : indicateur, document. Aucune ligne d'en-têtes reconnue dans la feuille.",
      entetes: [],
    };
  }
  const map = mapperColonnes(entete.entetes);
  const manquantes = colonnesManquantes(map);
  if (manquantes.length) {
    return {
      erreur: `Colonnes introuvables dans la feuille : ${manquantes.join(", ")}. En-têtes lus : ${entete.entetes.filter(Boolean).join(" | ")}`,
      entetes: entete.entetes, colonnes: map,
    };
  }

  const cellule = (r, i) => (i === undefined || i === null ? "" : (r[i] || "").trim());
  const preuves = new Map();
  const ignorees = [];
  let lignesLues = 0;
  let indicateurCourant = null;

  for (let l = entete.ligne + 1; l < propagee.length; l++) {
    const r = propagee[l] || [];
    if (!r.some((c) => (c || "").trim())) continue;
    const ligneSource = l + 1; // numérotation de la feuille, 1-based
    lignesLues++;

    const n = numeroIndicateur(cellule(r, map.indicateur));
    if (n) indicateurCourant = n;
    const indicateur = n || indicateurCourant;
    const document = cellule(r, map.document);

    if (!indicateur) { ignorees.push({ ligne: ligneSource, motif: "aucun indicateur", valeur: cellule(r, map.indicateur).slice(0, 60) }); continue; }
    if (estBruit(document)) { ignorees.push({ ligne: ligneSource, motif: "document non exploitable", valeur: document.slice(0, 60) }); continue; }

    const etats = (map.etat || []).map((i) => cellule(r, i)).filter((v) => v && v !== ":-:");
    const clef = indicateur + "|" + normaliser(document);
    const existante = preuves.get(clef);
    if (existante) {
      existante.occurrences++;
      existante.lignes_source.push(ligneSource);
      existante.etats.push(...etats);
      existante.modele_nom ||= cellule(r, map.modele);
      existante.tache ||= cellule(r, map.tache);
    } else {
      preuves.set(clef, {
        indicateur, titre: document, modele_nom: cellule(r, map.modele) || null,
        tache: cellule(r, map.tache) || cellule(r, map.descriptif) || null,
        etats: [...etats], occurrences: 1, lignes_source: [ligneSource],
      });
    }
  }

  const liste = [...preuves.values()].map((p) => {
    // Les états d'un même document sont fusionnés : « pas besoin » et
    // « en cours » l'emportent sur « check ok », car une seule ligne non
    // finie suffit à ce que le document ne soit pas prêt.
    const etatsUniques = [...new Set(p.etats.filter(Boolean))];
    return {
      indicateur: p.indicateur, titre: p.titre, modele_nom: p.modele_nom, tache: p.tache,
      statut: statutDepuisEtat(etatsUniques),
      etat_source: etatsUniques.join(" / ") || null,
      occurrences: p.occurrences, lignes_source: p.lignes_source,
    };
  }).sort((a, b) => a.indicateur - b.indicateur || a.titre.localeCompare(b.titre, "fr"));

  return { entetes: entete.entetes, colonnes: map, lignesLues, preuves: liste, ignorees };
}
