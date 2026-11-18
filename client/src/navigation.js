// Navigation de Vigie : 5 espaces dans la barre latérale, les rubriques de
// l'espace courant en onglets, le fil d'Ariane et le titre de chaque page.
// Module PUR (aucun React) : testable seul.
//
// La navigation ne fait que REFLÉTER les droits : le serveur reste seul
// juge (requireAuth / requireRedacteur / requireAdmin). Une entrée `admin`
// n'est jamais affichée à un contributeur. Aucune adresse n'a été retirée :
// chaque ancienne page reste joignable, rangée dans son espace.

export const ESPACES = [
  {
    id: "aujourdhui",
    libelle: "Aujourd'hui",
    to: "/aujourdhui",
    pages: [
      { to: "/aujourdhui", libelle: "À faire" },
      { to: "/taches", libelle: "Tâches" },
      { to: "/echeancier", libelle: "Échéancier" },
    ],
  },
  {
    id: "formations",
    libelle: "Formations",
    to: "/sessions",
    pages: [
      { to: "/sessions", libelle: "Sessions" },
      { to: "/jeunes", libelle: "Jeunes" },
      { to: "/candidatures", libelle: "Candidatures", admin: true },
      { to: "/enquetes", libelle: "Enquêtes", admin: true },
      { to: "/synthese-satisfactions", libelle: "Satisfaction", admin: true },
      { to: "/acces-portails", libelle: "Espaces en ligne", admin: true },
      { to: "/formations", libelle: "Catalogue", admin: true },
    ],
  },
  {
    id: "qualiopi",
    libelle: "Qualiopi",
    to: "/qualiopi",
    admin: true,
    pages: [
      { to: "/qualiopi", libelle: "Indicateurs" },
      { to: "/signalements-qualite", libelle: "Réclamations" },
      { to: "/actions-qualite", libelle: "Améliorations" },
      { to: "/veille", libelle: "Veille" },
      { to: "/risques", libelle: "Risques" },
      { to: "/preparation-audit", libelle: "Audit" },
      // Rubriques secondaires : rangées sous « Plus ».
      { to: "/preuves", libelle: "Toutes les preuves", plus: true },
      { to: "/preuves-pdf", libelle: "Preuves PDF", plus: true },
      { to: "/indicateurs", libelle: "Référentiel détaillé", plus: true },
      { to: "/tableau-de-bord-qualite", libelle: "Tableau de bord", plus: true },
      { to: "/audits", libelle: "Historique des audits", plus: true },
      { to: "/partenaires", libelle: "Partenaires", plus: true },
      { to: "/ressources", libelle: "Ressources et moyens", plus: true },
      { to: "/portail-audit", libelle: "Vue de l'auditeur", plus: true },
    ],
  },
  {
    id: "equipe",
    libelle: "Équipe",
    to: "/equipe",
    admin: true,
    pages: [
      { to: "/equipe", libelle: "Équipe" },
      { to: "/intervenants", libelle: "Fiches" },
      { to: "/justificatifs-intervenants", libelle: "Justificatifs" },
      { to: "/developpement-intervenants", libelle: "Développement" },
    ],
  },
  {
    id: "reglages",
    libelle: "Réglages",
    to: "/reglages",
    admin: true,
    // Pas d'onglets : la page Réglages présente les rubriques en cartes ;
    // chaque rubrique propose un lien de retour.
    retour: true,
    pages: [
      { to: "/reglages", libelle: "Réglages" },
      { to: "/parametres/organisme", libelle: "Organisme et signataires" },
      { to: "/parametres/comptes", libelle: "Comptes et accès" },
      { to: "/parametres/google", libelle: "Google Drive" },
      { to: "/parametres/inventaire-drive", libelle: "Inventaire Drive" },
      { to: "/modeles", libelle: "Modèles de documents" },
      { to: "/variables-documentaires", libelle: "Variables documentaires" },
      { to: "/versions", libelle: "Référentiel Qualiopi" },
      { to: "/prescripteurs", libelle: "Prescripteurs" },
      { to: "/questionnaires", libelle: "Questionnaires de formation" },
      { to: "/parametres/rgpd", libelle: "Données personnelles" },
    ],
  },
];

// Auditeur externe : uniquement les dossiers d'audit partagés (le serveur l'impose aussi).
export const ESPACES_AUDITEUR = [
  { id: "audit", libelle: "Dossiers d'audit", to: "/portail-audit", pages: [{ to: "/portail-audit", libelle: "Dossiers d'audit" }] },
];

// Espaces et rubriques visibles pour un rôle. Tout ce qui n'est pas « admin »
// est ouvert aux deux rôles connus (admin, contributeur) ; un rôle inconnu
// est traité comme un contributeur (refus par défaut).
export function espacesPour(role) {
  if (role === "auditeur") return ESPACES_AUDITEUR;
  const admin = role === "admin";
  return ESPACES
    .filter((e) => admin || !e.admin)
    .map((e) => ({ ...e, pages: e.pages.filter((p) => admin || !p.admin) }))
    .filter((e) => e.pages.length > 0);
}

const correspond = (pathname, to) => pathname === to || pathname.startsWith(to + "/");

// Rubrique d'un chemin : la page dont le chemin est le préfixe le plus long
// (« /sessions/12 » relève de « Sessions »), dans les espaces donnés.
function trouver(pathname, espaces) {
  let trouve = null;
  for (const espace of espaces) {
    for (const page of espace.pages) {
      if (correspond(pathname, page.to) && (!trouve || page.to.length > trouve.page.to.length)) trouve = { espace, page };
    }
  }
  return trouve;
}

// Espace et rubrique courants pour un rôle (null hors navigation).
export function positionDe(pathname, role) {
  return trouver(pathname, espacesPour(role));
}

// Fil d'Ariane d'un chemin : [espace, page]. Chemin inconnu : null.
export function contexteDe(pathname) {
  const t = trouver(pathname, [...ESPACES, ...ESPACES_AUDITEUR]);
  if (!t) return null;
  const memeNom = t.espace.libelle === t.page.libelle;
  return { groupe: memeNom ? null : t.espace.libelle, page: t.page.libelle, to: t.page.to };
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
