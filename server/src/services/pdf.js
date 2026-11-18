// ─────────────────────────────────────────────────────────────
//  Générateur PDF minimal, sans dépendance : titres, paragraphes, listes, tableaux avec retour à la ligne,
//  pagination, en-tête (organisme, titre) et pied de page (date de génération, page X / N).
//  Polices standard Helvetica (aucune police embarquée), encodage WinAnsi : tout le français s'affiche.
//  Usage : les exports « preuve » destinés à l'auditeur (dépôt sur la plateforme de l'organisme certificateur).
// ─────────────────────────────────────────────────────────────

const LARGEUR_PAGE = 595.28, HAUTEUR_PAGE = 841.89, MARGE = 48, HAUT_CONTENU = HAUTEUR_PAGE - 70, BAS_CONTENU = 56;

// Largeurs Helvetica (unités 1/1000) pour les caractères 32 à 126.
const L = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556,
  333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const SPECIAUX = { "€": [0x80, 556], "‚": [0x82, 222], "„": [0x84, 333], "…": [0x85, 1000], "‘": [0x91, 222], "’": [0x92, 222], "“": [0x93, 333],
  "”": [0x94, 333], "•": [0x95, 350], "–": [0x96, 556], "—": [0x97, 1000], "œ": [0x9c, 944], "Œ": [0x8c, 1000], "Ÿ": [0x9f, 667] };
const REMPLACEMENTS = { "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "✓": "x", "✔": "x", "☐": "[ ]", "☑": "[x]", "❒": "[ ]", " ": " ", " ": " ", "‑": "-", "­": "" };

function codeEtLargeur(c) {
  const n = c.codePointAt(0);
  if (n >= 32 && n <= 126) return [n, L[n - 32]];
  if (SPECIAUX[c]) return SPECIAUX[c];
  if (n >= 160 && n <= 255) {
    const base = c.normalize("NFD").replace(/[̀-ͯ]/g, "");
    const b = base.codePointAt(0);
    return [n, base !== c && b >= 32 && b <= 126 ? L[b - 32] : 556];
  }
  return [63, 556]; // « ? » pour tout caractère hors WinAnsi
}
// Texte → chaîne WinAnsi (codes 0-255) + largeur en points.
function normaliser(t) {
  let s = String(t ?? "");
  for (const [a, b] of Object.entries(REMPLACEMENTS)) s = s.split(a).join(b);
  return s.replace(/[\u0000-\u0008\u000b-\u001f]/g, "");
}
export function largeur(t, taille, gras = false) {
  let w = 0;
  for (const c of normaliser(t)) w += codeEtLargeur(c)[1];
  return (w * taille * (gras ? 1.06 : 1)) / 1000;
}
function encoder(t) {
  let s = "";
  for (const c of normaliser(t)) {
    const [code] = codeEtLargeur(c);
    const ch = String.fromCharCode(code);
    s += ch === "(" || ch === ")" || ch === "\\" ? "\\" + ch : ch;
  }
  return s;
}
// Découpe en lignes tenant dans `max` points (les mots trop longs sont coupés).
export function couper(texte, taille, max, gras = false) {
  const lignes = [];
  for (const paragraphe of normaliser(texte).split(/\r?\n/)) {
    let courante = "";
    for (const mot of paragraphe.split(/\s+/).filter(Boolean)) {
      const essai = courante ? courante + " " + mot : mot;
      if (largeur(essai, taille, gras) <= max) { courante = essai; continue; }
      if (courante) lignes.push(courante);
      let reste = mot;
      while (largeur(reste, taille, gras) > max) {
        let i = reste.length;
        while (i > 1 && largeur(reste.slice(0, i), taille, gras) > max) i--;
        lignes.push(reste.slice(0, i)); reste = reste.slice(i);
      }
      courante = reste;
    }
    lignes.push(courante);
  }
  return lignes;
}

export class DocumentPdf {
  constructor({ titre, organisme = "", sousTitre = "" } = {}) {
    this.titreDoc = titre || "Document"; this.organisme = organisme || ""; this.sousTitreDoc = sousTitre;
    this.pages = []; this.nouvellePage();
    this.titre(this.titreDoc, 16);
    if (sousTitre) this.paragraphe(sousTitre, { taille: 10, couleur: 0.35 });
    this.espace(6);
  }
  nouvellePage() { this.flux = []; this.pages.push(this.flux); this.y = HAUT_CONTENU; }
  place(h) { if (this.y - h < BAS_CONTENU) this.nouvellePage(); }
  texte(x, y, t, taille, gras, gris = 0) {
    this.flux.push(`${gris} g BT /${gras ? "F2" : "F1"} ${taille} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${encoder(t)}) Tj ET`);
  }
  titre(t, taille = 13) {
    const lignes = couper(t, taille, LARGEUR_PAGE - 2 * MARGE, true);
    this.place(lignes.length * taille * 1.25 + 6);
    this.y -= 4;
    for (const l of lignes) { this.y -= taille * 1.25; this.texte(MARGE, this.y, l, taille, true, 0.12); }
    this.y -= 4;
    return this;
  }
  paragraphe(t, { taille = 10, gras = false, couleur = 0, retrait = 0 } = {}) {
    const lignes = couper(t, taille, LARGEUR_PAGE - 2 * MARGE - retrait, gras);
    for (const l of lignes) { this.place(taille * 1.35); this.y -= taille * 1.35; this.texte(MARGE + retrait, this.y, l, taille, gras, couleur); }
    this.y -= 3;
    return this;
  }
  champ(libelle, valeur) {
    if (valeur === null || valeur === undefined || valeur === "") return this;
    return this.paragraphe(`${libelle} : ${valeur}`, { taille: 10 });
  }
  liste(items, { taille = 10 } = {}) {
    for (const it of items) {
      const lignes = couper(it, taille, LARGEUR_PAGE - 2 * MARGE - 14);
      lignes.forEach((l, i) => { this.place(taille * 1.35); this.y -= taille * 1.35; if (i === 0) this.texte(MARGE + 2, this.y, "•", taille, false); this.texte(MARGE + 14, this.y, l, taille, false); });
    }
    this.y -= 3;
    return this;
  }
  espace(h = 8) { this.y -= h; return this; }
  // Tableau : `poids` = largeurs relatives des colonnes ; l'en-tête est répété à chaque page.
  tableau(entetes, lignes, poids = null, { taille = 8.5 } = {}) {
    const total = LARGEUR_PAGE - 2 * MARGE;
    const p = poids || entetes.map(() => 1);
    const somme = p.reduce((a, b) => a + b, 0);
    const largeurs = p.map((x) => (x / somme) * total);
    const hl = taille * 1.25, pad = 3;
    const dessinerLigne = (cellules, gras, fond) => {
      const blocs = cellules.map((c, i) => couper(c ?? "", taille, largeurs[i] - 2 * pad, gras));
      const h = Math.max(1, ...blocs.map((b) => b.length)) * hl + 2 * pad;
      if (this.y - h < BAS_CONTENU) return null;
      let x = MARGE;
      if (fond) this.flux.push(`0.88 0.91 0.95 rg ${MARGE.toFixed(2)} ${(this.y - h).toFixed(2)} ${total.toFixed(2)} ${h.toFixed(2)} re f 0 g`);
      blocs.forEach((b, i) => {
        b.forEach((l, k) => this.texte(x + pad, this.y - pad - (k + 1) * hl + 2, l, taille, gras));
        this.flux.push(`0.6 G 0.5 w ${x.toFixed(2)} ${(this.y - h).toFixed(2)} ${largeurs[i].toFixed(2)} ${h.toFixed(2)} re S`);
        x += largeurs[i];
      });
      this.y -= h;
      return h;
    };
    this.place(hl * 3);
    dessinerLigne(entetes, true, true);
    for (const l of lignes) {
      if (dessinerLigne(l.map((v) => (v === null || v === undefined ? "" : String(v))), false, false) === null) {
        this.nouvellePage();
        dessinerLigne(entetes, true, true);
        dessinerLigne(l.map((v) => (v === null || v === undefined ? "" : String(v))), false, false);
      }
    }
    if (!lignes.length) this.paragraphe("Aucune ligne.", { taille: 9, couleur: 0.4 });
    this.y -= 8;
    return this;
  }

  // Assemble le fichier : en-tête et pied de page ajoutés une fois le nombre de pages connu.
  finaliser() {
    const date = new Date().toLocaleDateString("fr-FR", { timeZone: "America/Cayenne" });
    const n = this.pages.length;
    const contenus = this.pages.map((flux, i) => {
      const entete = [];
      const e = (x, y, t, taille, gras = false) => entete.push(`0.4 g BT /${gras ? "F2" : "F1"} ${taille} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${encoder(t)}) Tj ET`);
      e(MARGE, HAUTEUR_PAGE - 36, couper(this.organisme, 8, 250)[0] || "", 8, true);
      const t = couper(this.titreDoc, 8, 260)[0] || "";
      e(LARGEUR_PAGE - MARGE - largeur(t, 8), HAUTEUR_PAGE - 36, t, 8);
      entete.push(`0.75 G 0.5 w ${MARGE} ${HAUTEUR_PAGE - 42} m ${LARGEUR_PAGE - MARGE} ${HAUTEUR_PAGE - 42} l S`);
      const pied = `Document généré par Vigie Qualiopi le ${date} — page ${i + 1} / ${n}`;
      e((LARGEUR_PAGE - largeur(pied, 7.5)) / 2, 30, pied, 7.5);
      return Buffer.from([...entete, ...flux].join("\n"), "latin1");
    });
    const objets = [];
    const ajouter = (corps) => { objets.push(corps); return objets.length; };
    const catalogue = ajouter(null); const racinePages = ajouter(null);
    const f1 = ajouter(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "latin1"));
    const f2 = ajouter(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>", "latin1"));
    const kids = [];
    for (const c of contenus) {
      const flux = ajouter(Buffer.concat([Buffer.from(`<< /Length ${c.length} >>\nstream\n`, "latin1"), c, Buffer.from("\nendstream", "latin1")]));
      kids.push(ajouter(Buffer.from(`<< /Type /Page /Parent ${racinePages} 0 R /MediaBox [0 0 ${LARGEUR_PAGE} ${HAUTEUR_PAGE}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${flux} 0 R >>`, "latin1")));
    }
    objets[catalogue - 1] = Buffer.from(`<< /Type /Catalog /Pages ${racinePages} 0 R >>`, "latin1");
    objets[racinePages - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`, "latin1");
    const titreInfo = encoder(this.titreDoc);
    const info = ajouter(Buffer.from(`<< /Title (${titreInfo}) /Producer (Vigie Qualiopi) >>`, "latin1"));
    const morceaux = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
    const positions = [];
    let pos = morceaux[0].length;
    objets.forEach((o, i) => {
      positions.push(pos);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), o, Buffer.from("\nendobj\n", "latin1")]);
      morceaux.push(b); pos += b.length;
    });
    const xref = [`xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`, ...positions.map((p) => `${String(p).padStart(10, "0")} 00000 n \n`)].join("");
    morceaux.push(Buffer.from(`${xref}trailer\n<< /Size ${objets.length + 1} /Root ${catalogue} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, "latin1"));
    return Buffer.concat(morceaux);
  }
}

// Envoi HTTP d'un PDF (nom de fichier fixé par le code, jamais par l'utilisateur).
export function envoyerPdf(res, doc, nomFichier) {
  const buf = doc.finaliser();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${nomFichier.replace(/[^A-Za-z0-9._-]/g, "-")}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(buf);
}

export const dateFr = (d) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10).split("-").reverse().join("/") : "");
