// Outils de test du client : serveur API simulé (par méthode et chemin),
// montage de l'application dans un vrai BrowserRouter (historique jsdom),
// attente d'un état, interactions.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "../src/App.jsx";

const reponse = (statut, corps) => ({ ok: statut < 400, status: statut, json: async () => corps });

export const SESSION = {
  id: 1, reference: "SESS-TEST", formation: "Formation test", statut: "en_cours",
  date_debut: "2026-09-01", date_fin: "2026-12-15", lieu: "Lyon", horaire: "9h–17h", formateur: "M. Durand",
  version_numero: 1, duree_heures_reelle: "35.00", duree_heures_defaut: "35.00",
};
const STAGIAIRES = [
  { inscription_id: 11, id: 101, civilite: "Mme", nom: "Martin", prenom: "Alice", email: "alice@exemple.fr", groupe_id: 5, statut: "inscrit",
    prescripteur: "pole_emploi", dossier_complet: true, situation_handicap: true, besoins_adaptation: "Poste adapté" },
  { inscription_id: 12, id: 102, civilite: null, nom: "Bernard", prenom: "Paul", email: null, groupe_id: null, statut: "inscrit",
    prescripteur: null, dossier_complet: false, situation_handicap: false, besoins_adaptation: null },
];

// Réponses par défaut, clé « MÉTHODE chemin » (chemin sans la requête).
export function routesParDefaut(role) {
  return {
    "GET /api/me": role ? { user: { id: 1, nom: "Mme Test", email: "t@exemple.fr", role }, googleConfigured: true }
      : { user: null, googleConfigured: true },
    "GET /api/sessions": {
      sessions: [
        { ...SESSION, nb_inscrits: 2, groupes: [] },
        { id: 2, reference: "SESS-AVENIR", formation: "Aide à domicile", statut: "planifiee", date_debut: "2027-01-10", date_fin: "2027-03-10", lieu: "Villeurbanne", nb_inscrits: 0, groupes: [] },
        { id: 3, reference: "SESS-FINIE", formation: "Formation test", statut: "terminee", date_debut: "2026-01-05", date_fin: "2026-03-05", lieu: "Lyon", nb_inscrits: 6, groupes: [] },
      ], total: 3,
    },
    "GET /api/sessions/1": {
      session: SESSION, groupes: [{ id: 5, nom: "Groupe A", lieu: "Lyon 7e", formateur: null, nb_inscrits: 1 }],
      stagiaires: STAGIAIRES,
      documents: [{ id: 70, nom: "Attestation - Martin", drive_url: "https://d/70", modele: "Attestation", portee: "stagiaire", groupe_id: null, genere_le: "2026-09-20T10:00:00Z" }],
    },
    "GET /api/sessions/1/absences": {
      session: { heures_prevues: 35, source_heures_prevues: "duree_heures_reelle", date_debut: SESSION.date_debut, date_fin: SESSION.date_fin },
      total_heures_absence: 3.5,
      stagiaires: [
        { inscription_id: 11, total_heures_absence: 3.5, absences: [{ id: 900, date_absence: "2026-09-10", demi_journee: "matin", duree_heures: 3.5, justifiee: false, motif: "Retard train" }],
          assiduite: { fiable: true, taux: 90, heures_suivies: 31.5, heures_prevues: 35 } },
        { inscription_id: 12, total_heures_absence: 0, absences: [], assiduite: { fiable: true, taux: 100, heures_suivies: 35, heures_prevues: 35 } },
      ],
    },
    "GET /api/sessions/1/evaluations": {
      agregation: { total: 1, valide: 1, non_valide: 0, non_determine: 0, non_applicable: 0 },
      evaluations: [{ id: 30, inscription_id: 11, nom: "Martin", prenom: "Alice", type: "qcm", intitule: "QCM séance 1", date_passage: "2026-09-12", score: 18, score_max: 20, resultat: "valide" }],
    },
    "GET /api/sessions/1/satisfactions": {
      agregation: { reponses: 1, anonymes: 1, nominatives: 0, moyenne: 4.5, echelleHomogene: 5 },
      satisfactions: [{ id: 40, type: "a_chaud", date_recueil: "2026-09-15", note_globale: 4.5, note_max: 5, commentaires: "Très bien" }],
    },
    "GET /api/preuves": { preuves: [{ id: 60, titre: "Feuille d'émargement EduSign", indicateur: 11, source: "manuel", fichiers: [] }], total: 1 },
    "GET /api/indicateurs": { indicateurs: [{ id: 11, numero: 11, libelle: "Atteinte des objectifs" }] },
    "GET /api/formations": { formations: [{ id: 7, intitule: "Formation test", version_numero: 1 }] },
    "GET /api/modeles": { modeles: [{ id: 3, nom: "Attestation", portee: "stagiaire" }], marqueurs: [] },
    "GET /api/prescripteurs": { prescripteurs: [{ id: 1, code: "pole_emploi", nom: "France Travail", actif: true }] },
    "GET /api/referentiel": {
      version: { id: 1, code: "V9" }, criteres: [], totalIndicateurs: 32,
      score: { maitrise: 0, a_consolider: 0, a_risque: 0, non_applicable: 0, total: 32, preuves: 0, a_confirmer: 0 },
    },
    "GET /api/referentiel/versions": { versions: [{ id: 1, code: "V9", libelle: "Référentiel V9", type: "active", est_active: true }] },
    "GET /api/veille": { veilles: [], total: 0 },
    "GET /api/audits": { audits: [] },
    "GET /api/drive/status": { configured: true, connected: true, lectureSeule: true, compte: "drive@exemple.fr" },
    "GET /api/import/dernier": { import: null },
    "POST /auth/logout": { ok: true },
    "GET /api/sessions/999": [404, { error: "Session introuvable." }],
    "GET /api/sessions/abc": [400, { error: "Identifiant de session invalide." }],
  };
}

// `surcharges` : { "MÉTHODE chemin": corps | [statut, corps] | (corpsEnvoyé) => ... }.
// Retourne la liste des appels (méthode, chemin, corps JSON).
export function apiSimulee(role, surcharges = {}) {
  const routes = { ...routesParDefaut(role), ...surcharges };
  const appels = [];
  globalThis.fetch = async (url, options = {}) => {
    const chemin = String(url).split("?")[0];
    const methode = options.method || "GET";
    const corps = options.body ? JSON.parse(options.body) : undefined;
    appels.push({ methode, chemin, corps });
    let r = routes[`${methode} ${chemin}`];
    if (typeof r === "function") r = await r(corps);
    if (r === undefined) return reponse(404, { error: "Introuvable." });
    return Array.isArray(r) ? reponse(r[0], r[1]) : reponse(200, r);
  };
  return appels;
}

let racine = null;
let conteneur = null;

// Monte l'application à l'adresse `chemin`, comme un chargement de page.
export async function monter(chemin, role = "admin", surcharges = {}) {
  const appels = apiSimulee(role, surcharges);
  window.history.replaceState(null, "", chemin);
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => { racine.render(<BrowserRouter><App /></BrowserRouter>); });
  await attendre(() => document.querySelector("main") || texte().includes("Se connecter"));
  return appels;
}

export async function demonter() {
  if (racine) await act(async () => racine.unmount());
  conteneur?.remove();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  racine = null;
  conteneur = null;
  try { window.sessionStorage.clear(); } catch { /* ignoré */ }
}

// Attend qu'une condition devienne vraie (rendus asynchrones, fetch simulé).
export async function attendre(condition, delai = 2000) {
  const debut = Date.now();
  for (;;) {
    let ok = false;
    try { ok = !!condition(); } catch { ok = false; }
    if (ok) return;
    if (Date.now() - debut > delai) throw new Error("Condition non atteinte dans le délai imparti.");
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
}

export const texte = () => document.body.textContent;
export const liensNavigation = () =>
  [...document.querySelectorAll('nav[aria-label="Navigation principale"] a')].map((a) => a.textContent.trim());
export const boutons = () => [...document.querySelectorAll("button, a")].map((b) => b.textContent.trim());
export const bouton = (libelle) => [...document.querySelectorAll("button, a")].find((b) => b.textContent.trim() === libelle);
export const dialogue = () => document.querySelector('[role="dialog"], [role="alertdialog"]');

export async function cliquer(element) {
  if (!element) throw new Error("Élément à cliquer introuvable.");
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

// Saisie dans un champ contrôlé React (passe par le setter natif).
export async function saisir(champ, valeur) {
  const proto = champ.tagName === "SELECT" ? window.HTMLSelectElement.prototype
    : champ.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(champ, valeur);
  await act(async () => {
    champ.dispatchEvent(new window.Event(champ.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}

// Saisie « rapide » : chaque frappe émet un événement input avec la valeur
// complète courante, sans attendre la resynchronisation de l'URL entre deux
// frappes. Reproduit le bug où un champ piloté directement par l'URL perdait
// des caractères (ex. « agefiph » → « aiph »).
export async function saisirRapide(champ, texte) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    let courant = "";
    for (const c of texte) {
      courant += c;
      setter.call(champ, courant);
      champ.dispatchEvent(new window.Event("input", { bubbles: true }));
    }
  });
}

export const champ = (libelle) => {
  const label = [...document.querySelectorAll("label")].find((l) => l.textContent.replace(/\s*\(facultatif\)/, "").trim() === libelle);
  return label ? document.getElementById(label.htmlFor) : null;
};

export async function touche(cle) {
  await act(async () => {
    document.activeElement.dispatchEvent(new window.KeyboardEvent("keydown", { key: cle, bubbles: true }));
  });
}
