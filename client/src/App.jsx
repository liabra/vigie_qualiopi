import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "./api.js";
import { ERREURS } from "./messages.js";
import { cheminRetourValide } from "./navigation.js";
import Login from "./Login.jsx";
import Referentiel from "./Referentiel.jsx";
import Preuves from "./Preuves.jsx";
import Modeles from "./Modeles.jsx";
import AuditsHistory from "./AuditsHistory.jsx";
import Veille from "./Veille.jsx";
import { AppShell } from "./shell/AppShell.jsx";
import { Alert, LoadingState } from "./ui/index.js";
import { Accueil } from "./pages/Accueil.jsx";
import { EcranExistant } from "./pages/EcranExistant.jsx";
import { PageIntrouvable } from "./pages/PageIntrouvable.jsx";
import { RequireAdmin } from "./pages/AccesReserve.jsx";
import { GoogleDrivePage } from "./pages/GoogleDrivePage.jsx";
import { FormationsPage, PrescripteursPage } from "./pages/ParametresPages.jsx";
import { SessionsListe } from "./sessions/SessionsListe.jsx";
import { SessionDetail } from "./sessions/SessionDetail.jsx";

const CLE_RETOUR = "vq_retour_apres_connexion";

// Lit puis retire ?erreur= / ?drive= de l'URL, pour qu'un rechargement ne
// réaffiche rien. L'état d'historique du routeur est conservé.
function consumeFlash() {
  const params = new URLSearchParams(window.location.search);
  const erreur = params.get("erreur");
  const drive = params.get("drive");
  if (erreur || drive) window.history.replaceState(window.history.state, "", window.location.pathname);
  if (erreur) return { type: "erreur", texte: ERREURS[erreur] || "Erreur de connexion." };
  if (drive === "ok") return { type: "ok", texte: "Google Drive connecté en lecture seule." };
  return null;
}

// Le stockage de session peut être indisponible (navigation privée, stockage
// bloqué) : jamais bloquant.
const stockage = {
  lire() { try { return window.sessionStorage.getItem(CLE_RETOUR); } catch { return null; } },
  ecrire(v) { try { window.sessionStorage.setItem(CLE_RETOUR, v); } catch { /* ignoré */ } },
  effacer() { try { window.sessionStorage.removeItem(CLE_RETOUR); } catch { /* ignoré */ } },
};

// « / » : l'accueil, ou la page demandée avant la connexion Google (le
// serveur renvoie toujours vers « / » après OAuth).
// Lecture à l'initialisation (idempotente, rejouable par StrictMode),
// effacement après le rendu.
function RedirectionAccueil() {
  const [retour] = useState(() => stockage.lire());
  useEffect(() => { stockage.effacer(); }, []);
  return <Navigate to={cheminRetourValide(retour) ? retour : "/accueil"} replace />;
}

// /sessions/:sessionId[/onglet] : identifiant numérique converti ; toute
// autre valeur est transmise telle quelle, le serveur répond 400 et la page
// affiche « Session introuvable ».
function SessionPage({ onglet, ...props }) {
  const { sessionId } = useParams();
  const id = /^\d+$/.test(sessionId) ? Number(sessionId) : sessionId;
  return <SessionDetail key={id} sessionId={id} onglet={onglet} {...props} />;
}

const VUES_REFERENTIEL = {
  referentiel: "/indicateurs",
  non_applicables: "/indicateurs/non-applicables",
  versions: "/versions",
};

function IndicateursPage({ vue, admin, rafraichir }) {
  const naviguer = useNavigate();
  return (
    <EcranExistant>
      <Referentiel admin={admin} rafraichir={rafraichir} vue={vue} surVue={(v) => naviguer(VUES_REFERENTIEL[v] || "/indicateurs")} />
    </EcranExistant>
  );
}

export default function App() {
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(consumeFlash);
  // Une preuve modifiée change la conformité : les indicateurs relisent.
  const [version, setVersion] = useState(0);
  const location = useLocation();
  const naviguer = useNavigate();

  useEffect(() => {
    api("/api/me").then(setMe).catch((e) => setError(e.message));
  }, []);

  // Non connecté sur une page précise (lien copié, rechargement après
  // expiration) : on la mémorise pour y revenir après la connexion.
  const nonConnecte = me && !me.user;
  useEffect(() => {
    const chemin = location.pathname + location.search;
    if (nonConnecte && cheminRetourValide(chemin)) stockage.ecrire(chemin);
  }, [nonConnecte, location.pathname, location.search]);

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    stockage.effacer();
    setMe((m) => ({ ...m, user: null }));
    naviguer("/", { replace: true });
  }

  if (error) {
    return (
      <main className="ecran-plein">
        <Alert ton="error" titre="Serveur injoignable">{error}</Alert>
      </main>
    );
  }
  if (!me) return <LoadingState plein />;
  if (!me.user) return <Login flash={flash} googleConfigured={me.googleConfigured} />;

  const user = me.user;
  const isAdmin = user.role === "admin";
  // Un contributeur saisit stagiaires et documents, sans rien configurer.
  const peutSaisir = isAdmin || user.role === "contributeur";
  const auChangement = () => setVersion((v) => v + 1);
  const admin = (el) => <RequireAdmin user={user}>{el}</RequireAdmin>;
  const session = (onglet) => <SessionPage onglet={onglet} admin={isAdmin} peutSaisir={peutSaisir} onChange={auChangement} />;

  return (
    <Routes>
      <Route element={<AppShell user={user} onLogout={logout} flash={flash} onFlashVu={() => setFlash(null)} />}>
        <Route index element={<RedirectionAccueil />} />
        <Route path="accueil" element={<Accueil user={user} />} />

        <Route path="sessions" element={<SessionsListe admin={isAdmin} />} />
        <Route path="sessions/:sessionId" element={session("apercu")} />
        <Route path="sessions/:sessionId/stagiaires" element={session("stagiaires")} />
        <Route path="sessions/:sessionId/assiduite" element={session("assiduite")} />
        <Route path="sessions/:sessionId/evaluations" element={session("evaluations")} />
        <Route path="sessions/:sessionId/satisfaction" element={session("satisfaction")} />
        <Route path="sessions/:sessionId/documents" element={session("documents")} />

        <Route path="indicateurs" element={<IndicateursPage vue="referentiel" admin={isAdmin} rafraichir={version} />} />
        <Route path="indicateurs/non-applicables" element={<IndicateursPage vue="non_applicables" admin={isAdmin} rafraichir={version} />} />
        <Route path="preuves" element={<EcranExistant><Preuves admin={isAdmin} onChange={auChangement} /></EcranExistant>} />
        <Route path="veille" element={<EcranExistant><Veille admin={isAdmin} /></EcranExistant>} />
        <Route path="audits" element={<EcranExistant><AuditsHistory admin={isAdmin} /></EcranExistant>} />

        <Route path="formations" element={admin(<FormationsPage />)} />
        <Route path="modeles" element={admin(<EcranExistant><Modeles admin={isAdmin} /></EcranExistant>)} />
        <Route path="prescripteurs" element={admin(<PrescripteursPage />)} />
        <Route path="versions" element={admin(<IndicateursPage vue="versions" admin={isAdmin} rafraichir={version} />)} />
        <Route path="parametres/google" element={admin(<GoogleDrivePage />)} />

        <Route path="*" element={<PageIntrouvable />} />
      </Route>
    </Routes>
  );
}
