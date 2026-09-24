// Navigation de Vigie : groupes de la barre latérale, fil d'Ariane et titre
// de chaque page. Module PUR (aucun React) : testable seul.
//
// La navigation ne fait que REFLÉTER les droits : le serveur reste seul
// juge (requireAuth / requireRedacteur / requireAdmin). Une entrée `admin`
// n'est jamais affichée à un contributeur.

export const NAVIGATION = [
  {
    id: "accueil",
    entrees: [{ to: "/accueil", libelle: "Accueil" }],
  },
  {
    id: "formation",
    titre: "Formation",
    entrees: [
      { to: "/sessions", libelle: "Sessions" },
      { to: "/formations", libelle: "Formations", admin: true },
    ],
  },
  {
    id: "qualite",
    titre: "Qualité",
    entrees: [
      { to: "/indicateurs", libelle: "Indicateurs" },
      { to: "/preuves", libelle: "Preuves" },
      { to: "/veille", libelle: "Veille" },
      { to: "/audits", libelle: "Audits" },
    ],
  },
  {
    id: "parametres",
    titre: "Paramètres",
    admin: true,
    entrees: [
      { to: "/modeles", libelle: "Modèles de documents" },
      { to: "/prescripteurs", libelle: "Prescripteurs" },
      { to: "/versions", libelle: "Versions du référentiel" },
      { to: "/parametres/google", libelle: "Google Drive" },
    ],
  },
];

// Groupes et entrées visibles pour un rôle. Tout ce qui n'est pas « admin »
// est ouvert aux deux rôles connus (admin, contributeur).
export function navigationPour(role) {
  const admin = role === "admin";
  return NAVIGATION
    .filter((g) => admin || !g.admin)
    .map((g) => ({ ...g, entrees: g.entrees.filter((e) => admin || !e.admin) }))
    .filter((g) => g.entrees.length > 0);
}

// Fil d'Ariane d'un chemin : [groupe?, page]. La page est l'entrée de
// navigation dont le chemin est le préfixe le plus long (« /sessions/12 »
// relève de « Sessions »). Chemin inconnu : null.
export function contexteDe(pathname) {
  let trouve = null;
  for (const g of NAVIGATION) {
    for (const e of g.entrees) {
      const correspond = pathname === e.to || pathname.startsWith(e.to + "/");
      if (correspond && (!trouve || e.to.length > trouve.entree.to.length)) trouve = { groupe: g, entree: e };
    }
  }
  if (!trouve) return null;
  return { groupe: trouve.groupe.titre || null, page: trouve.entree.libelle, to: trouve.entree.to };
}

// Après une connexion Google, le serveur renvoie toujours vers « / ». On
// mémorise donc la page demandée avant la connexion pour y revenir — mais
// UNIQUEMENT un chemin interne à l'application : jamais une URL externe
// (« //site », « https:… »), jamais l'API ni le flux OAuth.
export function cheminRetourValide(chemin) {
  if (typeof chemin !== "string" || chemin.length > 500) return false;
  if (!chemin.startsWith("/") || chemin.startsWith("//") || chemin.includes("\\")) return false;
  if (/^\/(api|auth)(\/|$|\?)/.test(chemin)) return false;
  if (chemin === "/" || chemin.startsWith("/?")) return false;
  return true;
}
