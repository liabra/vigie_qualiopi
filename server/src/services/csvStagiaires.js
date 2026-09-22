// ─────────────────────────────────────────────────────────────
//  Import CSV de stagiaires — parsing et mise en forme PURS,
//  sans entrée/sortie : testables sans base ni Express.
//  Les règles métier (rapprochement, doublons, écriture) vivent
//  dans routes/gestion.js ; ici, on ne fait que lire le texte.
// ─────────────────────────────────────────────────────────────

// Séparateur : celui qui sépare le plus la PREMIÈRE ligne non vide.
// Le point-virgule prime à égalité : c'est le format des CSV
// francophones (Excel FR), où la virgule sert de séparateur décimal.
export function detecterSeparateur(texte) {
  const premiere = String(texte || "").split(/\r?\n/).find((l) => l.trim() !== "") || "";
  const pv = (premiere.match(/;/g) || []).length;
  const vg = (premiere.match(/,/g) || []).length;
  if (pv > 0 && pv >= vg) return ";";
  return ",";
}

// Découpe une ligne en cellules en respectant les guillemets : un
// séparateur entre guillemets ne sépare pas, et deux guillemets
// d'affilée valent un guillemet littéral.
export function decouperLigne(ligne, sep) {
  const cellules = [];
  let courant = "";
  let entreGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (entreGuillemets) {
      if (c === '"') {
        if (ligne[i + 1] === '"') { courant += '"'; i++; }
        else entreGuillemets = false;
      } else courant += c;
    } else if (c === '"') {
      entreGuillemets = true;
    } else if (c === sep) {
      cellules.push(courant); courant = "";
    } else {
      courant += c;
    }
  }
  cellules.push(courant);
  return cellules;
}

// Un caractère de remplacement U+FFFD trahit un fichier relu dans un
// mauvais encodage (Latin-1 lu en UTF-8, par exemple). On le signale
// plutôt que d'importer des prénoms illisibles.
export function contientCaractereInvalide(texte) {
  return /\uFFFD/.test(String(texte || ""));
}

// Renvoie { sep, enTetes, lignes } ou { erreur }.
export function parserCsv(texte) {
  const source = String(texte ?? "").replace(/^\uFEFF/, "");   // BOM UTF-8
  if (!source.trim()) return { erreur: "Le fichier est vide." };
  if (contientCaractereInvalide(source)) {
    return { erreur: "Encodage non reconnu : caractères illisibles détectés. Enregistrez le fichier en UTF-8." };
  }
  const sep = detecterSeparateur(source);
  const lignesBrutes = source.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lignesBrutes.length) return { erreur: "Le fichier est vide." };
  const enTetes = decouperLigne(lignesBrutes[0], sep).map((c) => c.trim());
  const lignes = lignesBrutes.slice(1).map((l) => decouperLigne(l, sep).map((c) => c.trim()));
  return { sep, enTetes, lignes };
}

// ── Correspondance des en-têtes ──────────────────────────────
// Un nom de colonne est normalisé (minuscules, sans accents, sans
// ponctuation) puis rapproché d'une liste FERMÉE. Une colonne non
// reconnue est signalée, jamais devinée ; une colonne qui rappelle deux
// champs est refusée comme ambiguë.
export function normaliser(texte) {
  return String(texte ?? "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// [colonne canonique, [noms d'en-tête tolérés (normalisés)]]
const CORRESPONDANCES = [
  ["civilite", ["civilite", "titre", "genre"]],
  ["nom", ["nom", "name", "nomdefamille", "nomusage"]],
  ["prenom", ["prenom", "firstname", "givenname"]],
  ["email", ["email", "mail", "courriel", "mel", "adresseemail"]],
  ["telephone", ["telephone", "tel", "portable", "mobile", "phone"]],
  ["entreprise", ["entreprise", "societe", "employeur", "company"]],
  ["financeur", ["financeur", "financement"]],
  ["situation_handicap", ["situationhandicap", "handicap", "situationdehandicap", "rqth"]],
  ["besoins_adaptation", ["besoinsadaptation", "besoinsdadaptation", "besoins", "adaptation", "amenagements"]],
  ["groupe", ["groupe", "group"]],
  ["prescripteur", ["prescripteur", "prescription"]],
  ["dossier_complet", ["dossiercomplet", "dossier"]],
];

// Renvoie { colonnes: { index -> canonique }, inconnus: [noms], ambigus: [{ cle, noms }] }.
export function construireMapping(enTetes) {
  const colonnes = {};
  const inconnus = [];
  const ambigus = [];
  const vus = new Map();   // canonique -> [noms d'origine]
  enTetes.forEach((tete, i) => {
    const cle = normaliser(tete);
    if (!cle) return;   // colonne sans nom lisible : ignorée
    const trouve = CORRESPONDANCES.find(([, noms]) => noms.includes(cle));
    if (!trouve) { inconnus.push(tete); return; }
    const [canonique] = trouve;
    if (vus.has(canonique)) { ambigus.push({ cle: canonique, noms: [...vus.get(canonique), tete] }); return; }
    vus.set(canonique, [tete]);
    colonnes[i] = canonique;
  });
  return { colonnes, inconnus, ambigus };
}

// ── Valeurs ──────────────────────────────────────────────────
// true / false / null (vide) / undefined (valeur non reconnue).
const BOOLEENS_OUI = ["oui", "o", "1", "true", "vrai", "x", "v", "yes", "y", "ok"];
const BOOLEENS_NON = ["non", "n", "0", "false", "faux", "no", "f"];

export function lireBooleen(valeur) {
  if (valeur === undefined || valeur === null) return null;
  const t = normaliser(valeur);
  if (t === "") return null;
  if (BOOLEENS_OUI.includes(t)) return true;
  if (BOOLEENS_NON.includes(t)) return false;
  return undefined;
}

export function normaliserEmail(valeur) {
  const t = String(valeur ?? "").trim();
  return t ? t.toLowerCase() : null;
}

export function validerEmail(valeur) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valeur);
}

// Civilité : on accepte les variantes courantes, sans jamais inventer.
export function normaliserCivilite(valeur) {
  const t = normaliser(valeur);
  if (!t) return null;
  if (t === "m" || t === "mr" || t === "monsieur") return "M.";
  if (t === "mme" || t === "mrs" || t === "madame") return "Mme";
  return null;
}

// Prescripteur : la liste vit désormais en base (`prescripteurs`). On
// rapproche une valeur CSV d'un prescripteur connu en normalisant LE code ET
// le libellé : « Pôle Emploi », « pôle emploi » et « pole_emploi » désignent
// le même prescripteur. Renvoie l'entrée trouvée, ou null si inconnue.
export function trouverPrescripteur(valeur, prescripteurs) {
  const t = normaliser(valeur);
  if (!t) return null;
  return (prescripteurs || []).find((p) =>
    normaliser(p.code) === t || normaliser(p.nom) === t) || null;
}
