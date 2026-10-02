// ─────────────────────────────────────────────────────────────
//  Q4-1 — Annuaire des intervenants : validation et projections PURES.
//  Données professionnelles seulement ; aucune donnée personnelle
//  sensible n'est acceptée (le corps est filtré par liste blanche).
// ─────────────────────────────────────────────────────────────
import { parseIdPositif } from "./ids.js";

export const CIVILITES_INTERVENANT = ["M.", "Mme"];
export const FONCTIONS = ["formateur", "referent_handicap", "appui", "autre"];
export const NATURES = ["salarie", "exterieur", "sous_traitant", "porte"];
export const MAX_DOMAINES = 20;
export const MAX_DOMAINE = 80;

const texte = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
const emailValide = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Champs d'une fiche (création : `avant` vide, tout est exigé ;
// modification : seules les clés présentes changent). { champs } | { erreur }.
export function champsIntervenant(corps = {}, { creation = false } = {}) {
  const present = (k) => creation || Object.prototype.hasOwnProperty.call(corps, k);
  const champs = {};
  if (present("civilite")) {
    const c = texte(corps.civilite);
    if (c !== null && !CIVILITES_INTERVENANT.includes(c)) return { erreur: "Civilité inconnue." };
    champs.civilite = c;
  }
  for (const [k, lib] of [["nom", "Nom"], ["prenom", "Prénom"]]) {
    if (!present(k)) continue;
    const t = texte(corps[k]);
    if (!t) return { erreur: `${lib} obligatoire.` };
    if (t.length > 120) return { erreur: `${lib} trop long (120 caractères au plus).` };
    champs[k] = t;
  }
  if (present("email")) {
    const e = texte(corps.email);
    if (e !== null && (e.length > 254 || !emailValide(e))) return { erreur: "Adresse e-mail professionnelle invalide." };
    champs.email = e === null ? null : e.toLowerCase();
  }
  if (present("fonction")) {
    const f = texte(corps.fonction) ?? (creation ? "formateur" : null);
    if (!FONCTIONS.includes(f)) return { erreur: "Fonction inconnue." };
    champs.fonction = f;
  }
  if (present("nature")) {
    const n = texte(corps.nature);
    if (!NATURES.includes(n)) return { erreur: "Nature de l'intervention inconnue." };
    champs.nature = n;
  }
  if (present("domaines")) {
    const liste = corps.domaines === undefined || corps.domaines === null ? [] : corps.domaines;
    if (!Array.isArray(liste)) return { erreur: "Domaines de compétence invalides." };
    const vus = new Map();
    for (const d of liste) {
      const t = texte(d);
      if (!t) continue;
      if (t.length > MAX_DOMAINE) return { erreur: `Domaine trop long (${MAX_DOMAINE} caractères au plus).` };
      if (!vus.has(t.toLowerCase())) vus.set(t.toLowerCase(), t);
    }
    if (vus.size > MAX_DOMAINES) return { erreur: `${MAX_DOMAINES} domaines au plus.` };
    champs.domaines = [...vus.values()];
  }
  if (!creation && Object.prototype.hasOwnProperty.call(corps, "actif")) {
    if (typeof corps.actif !== "boolean") return { erreur: "Statut actif invalide." };
    champs.actif = corps.actif;
  }
  return { champs };
}

// Formations animables : undefined = inchangé ; tableau = remplacement.
export function lireFormations(corps = {}) {
  if (!Object.prototype.hasOwnProperty.call(corps, "formation_ids")) return { ids: undefined };
  if (!Array.isArray(corps.formation_ids)) return { erreur: "Formations invalides." };
  const ids = [];
  for (const v of corps.formation_ids) {
    const n = parseIdPositif(v);
    if (!n) return { erreur: "Identifiant de formation invalide." };
    if (!ids.includes(n)) ids.push(n);
  }
  return { ids };
}

// Projection selon le rôle (fix : appliquée côté serveur). Le contributeur
// voit le nom, la fonction et les domaines ; jamais l'e-mail, la nature de
// la relation professionnelle ni les formations / l'historique.
export function projeterIntervenant(i, admin) {
  if (!i) return i;
  if (admin) return i;
  return { id: i.id, civilite: i.civilite, nom: i.nom, prenom: i.prenom, fonction: i.fonction, domaines: i.domaines, actif: i.actif };
}

// « Prénom Nom », triés par nom puis prénom (déterministe), réunis en
// « A, B et C ». Seules les personnes de fonction « formateur » comptent
// pour le marqueur {{formateur}}.
export function nomsFormateurs(liste = []) {
  const noms = (liste || [])
    .filter((p) => p.fonction === "formateur")
    .slice()
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr") || a.prenom.localeCompare(b.prenom, "fr") || (a.id ?? 0) - (b.id ?? 0))
    .map((p) => `${p.prenom} ${p.nom}`);
  if (noms.length <= 1) return noms[0] || "";
  return `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}`;
}
