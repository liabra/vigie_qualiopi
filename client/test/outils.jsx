// Outils de test du client : serveur API simulé, montage de l'application
// dans un vrai BrowserRouter (historique jsdom), attente d'un état.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "../src/App.jsx";

const reponse = (statut, corps) => ({ ok: statut < 400, status: statut, json: async () => corps });

const SESSION = {
  id: 1, reference: "SESS-TEST", formation: "Formation test", statut: "en_cours",
  date_debut: "2026-09-01", date_fin: "2026-12-15", lieu: "Lyon", horaire: null,
  version_numero: 1, duree_heures_reelle: 35, duree_heures_defaut: 35,
};

// Réponses minimales par route (GET). Tout ce qui n'est pas prévu : 404.
export function apiSimulee(role) {
  const routes = {
    "/api/me": role ? { user: { id: 1, nom: "Mme Test", email: "t@exemple.fr", role }, googleConfigured: true }
      : { user: null, googleConfigured: true },
    "/api/sessions": { sessions: [{ ...SESSION, nb_inscrits: 0, groupes: [] }], total: 1 },
    "/api/sessions/1": { session: SESSION, groupes: [], stagiaires: [], documents: [] },
    "/api/sessions/1/absences": {
      session: { heures_prevues: 35, source_heures_prevues: "duree_heures_reelle", date_debut: SESSION.date_debut, date_fin: SESSION.date_fin },
      total_heures_absence: 0, stagiaires: [],
    },
    "/api/preuves": { preuves: [], total: 0 },
    "/api/indicateurs": { indicateurs: [] },
    "/api/formations": { formations: [] },
    "/api/modeles": { modeles: [], marqueurs: [] },
    "/api/prescripteurs": { prescripteurs: [] },
    "/api/referentiel": {
      version: { id: 1, code: "V9" }, criteres: [], totalIndicateurs: 32,
      score: { maitrise: 0, a_consolider: 0, a_risque: 0, non_applicable: 0, total: 32, preuves: 0, a_confirmer: 0 },
    },
    "/api/referentiel/versions": { versions: [{ id: 1, code: "V9", libelle: "Référentiel V9", type: "active", est_active: true }] },
    "/api/veille": { veilles: [], total: 0 },
    "/api/audits": { audits: [] },
    "/api/drive/status": { configured: true, connected: true, lectureSeule: true, compte: "drive@exemple.fr" },
    "/api/import/dernier": { import: null },
  };
  const appels = [];
  globalThis.fetch = async (url, options = {}) => {
    const chemin = String(url).split("?")[0];
    appels.push({ chemin, methode: options.method || "GET" });
    if (chemin === "/auth/logout") return reponse(200, { ok: true });
    if (chemin === "/api/sessions/999") return reponse(404, { error: "Session introuvable." });
    if (chemin === "/api/sessions/abc") return reponse(400, { error: "Identifiant de session invalide." });
    return chemin in routes ? reponse(200, routes[chemin]) : reponse(404, { error: "Introuvable." });
  };
  return appels;
}

let racine = null;
let conteneur = null;

// Monte l'application à l'adresse `chemin`, comme un chargement de page.
export async function monter(chemin, role = "admin") {
  apiSimulee(role);
  window.history.replaceState(null, "", chemin);
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => { racine.render(<BrowserRouter><App /></BrowserRouter>); });
  await attendre(() => !document.body.textContent.includes("Chargement…") || document.querySelector("main"));
  return conteneur;
}

export async function demonter() {
  if (racine) await act(async () => racine.unmount());
  conteneur?.remove();
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

export async function cliquer(element) {
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}
