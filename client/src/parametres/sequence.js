// Séquence pédagogique : lecture d'un tableau copié depuis Google Sheets / Excel (colonnes de la séquence A2C :
// A étape, B durée, C objectif, D support, E modalité, F activités, G ressources, H indicateur / évaluation).
// Fonctions pures : le serveur revalide tout à l'enregistrement.

// Analyse un texte tabulé ; les cellules entre guillemets peuvent contenir tabulations et retours à la ligne.
export function lireTableau(texte) {
  const lignes = []; let ligne = []; let cellule = ""; let guillemets = false;
  const s = String(texte || "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (guillemets) {
      if (c === '"' && s[i + 1] === '"') { cellule += '"'; i++; } else if (c === '"') guillemets = false; else cellule += c;
    } else if (c === '"' && cellule === "") guillemets = true;
    else if (c === "\t") { ligne.push(cellule); cellule = ""; }
    else if (c === "\n") { ligne.push(cellule); lignes.push(ligne); ligne = []; cellule = ""; }
    else cellule += c;
  }
  if (cellule !== "" || ligne.length) { ligne.push(cellule); lignes.push(ligne); }
  return lignes.map((l) => l.map((x) => x.trim()));
}

export function minutes(texte) {
  const t = String(texte || "").toLowerCase().replace(",", ".");
  const h = t.match(/(\d+(?:\.\d+)?)\s*h(?:\s*(\d+))?/);
  if (h) return Math.round(Number(h[1]) * 60 + (h[2] ? Number(h[2]) : 0));
  const m = t.match(/(\d+)\s*min/) || t.match(/^\s*(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

const vide = (v) => (v ? v : "");

// Renvoie { modules, avertissements } au format de l'écran (texte pour tous les champs).
export function lireSequenceCollee(texte) {
  const modules = []; const avertissements = [];
  let module = null; let support = ""; let modalite = "";
  for (const l of lireTableau(texte)) {
    const a = l[0] || "";
    let m;
    if ((m = a.match(/^Mod\d+[_\s-]*(\S+)\s+(.+)$/i))) {
      module = { code: m[1], intitule: m[2].trim(), duree_minutes: "", evaluation_minutes: "", evaluation_objectif: "", competences: [] };
      modules.push(module); support = ""; modalite = "";
    } else if ((m = a.match(/^([A-Za-z]{1,6}\d{1,3})\s+(.+)$/)) && module) {
      support = l[3] || support; modalite = l[4] || modalite;
      module.competences.push({ code: m[1], libelle: m[2].trim(), titre: m[2].trim(), duree_minutes: minutes(l[1]) ?? "", objectif: vide(l[2]), support, modalite,
        activites: vide(l[5]), ressources: vide(l[6]), indicateur: vide(l[7]) });
    } else if (/^[ée]valuation interm/i.test(a) && module) {
      module.evaluation_minutes = minutes(l[1]) ?? ""; module.evaluation_objectif = vide(l[2]);
    }
  }
  for (const mod of modules) {
    if (!mod.competences.length) avertissements.push(`Le module ${mod.code} ne contient aucune compétence.`);
    mod.duree_minutes = mod.competences.reduce((n, c) => n + (Number(c.duree_minutes) || 0), 0) + (Number(mod.evaluation_minutes) || 0);
  }
  if (!modules.length) avertissements.push("Aucun module reconnu : copiez le tableau de la séquence, avec les lignes « Mod1_C1 … » et « AT01 … ».");
  return { modules, avertissements };
}

// Corps envoyé au serveur : chaîne vide = absent, durées en entiers.
export function versCorps(modules) {
  const n = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  const t = (v) => (String(v ?? "").trim() || null);
  return { modules: modules.map((m) => ({
    code: String(m.code).trim(), intitule: String(m.intitule).trim(), duree_minutes: n(m.duree_minutes), evaluation_minutes: n(m.evaluation_minutes), evaluation_objectif: t(m.evaluation_objectif),
    competences: m.competences.map((c) => ({ code: String(c.code).trim(), libelle: String(c.libelle).trim(), titre: t(c.titre), duree_minutes: n(c.duree_minutes),
      objectif: t(c.objectif), support: t(c.support), modalite: t(c.modalite), activites: t(c.activites), ressources: t(c.ressources), indicateur: t(c.indicateur) })),
  })) };
}

// Données du serveur → champs de l'écran.
export function depuisServeur(modules) {
  const s = (v) => (v === null || v === undefined ? "" : v);
  return (modules || []).map((m) => ({ code: m.code, intitule: m.intitule, duree_minutes: s(m.duree_minutes), evaluation_minutes: s(m.evaluation_minutes), evaluation_objectif: s(m.evaluation_objectif),
    competences: m.competences.map((c) => ({ code: c.code, libelle: c.libelle, titre: s(c.titre), duree_minutes: s(c.duree_minutes), objectif: s(c.objectif), support: s(c.support),
      modalite: s(c.modalite), activites: s(c.activites), ressources: s(c.ressources), indicateur: s(c.indicateur) })) }));
}
