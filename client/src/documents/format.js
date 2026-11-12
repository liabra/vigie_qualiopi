// Documents partagés : libellés, règles d'affichage des versions et messages d'erreur.
// Module PUR (aucun React) : testable seul. Le serveur reste seul juge des droits ;
// ces fonctions ne font que présenter son état.

export const MOTIFS_CORBEILLE = {
  fichier_introuvable: "Fichier introuvable sur Drive",
  fichier_encore_utilise: "Fichier encore utilisé par une preuve ou une génération",
  version_courante: "Cette version est devenue la version courante",
  version_introuvable: "Version introuvable",
  version_obsolete: "Cette version n'est plus une ancienne version",
  echec_repete: "Échecs répétés lors de la reprise Drive",
};

export const STATUTS_CORBEILLE = {
  en_attente: { libelle: "En attente de reprise", ton: "info" },
  bloquee: { libelle: "Bloquée : décision requise", ton: "warning" },
  confirmee: { libelle: "Confirmée", ton: "success" },
  abandonnee: { libelle: "Abandonnée", ton: "neutral" },
};

export function libelleMotif(code) {
  return MOTIFS_CORBEILLE[code] || code || null;
}

// La version courante : celle que désigne le document et qui n'a pas été remplacée.
export function estVersionCourante(version, document) {
  return version.numero === document.version_courante && !version.remplacee_le;
}

// Une ancienne version peut être mise à la corbeille tant qu'elle ne l'est pas déjà.
export function peutMettreALaCorbeille(version, document) {
  return !estVersionCourante(version, document) && !version.corbeille_le;
}

export function etatVersion(version, document) {
  if (estVersionCourante(version, document)) return { libelle: "Version courante", ton: "success" };
  if (version.corbeille_le) return { libelle: "À la corbeille", ton: "neutral" };
  return { libelle: "Ancienne version", ton: "info" };
}

// Lien Drive affichable : uniquement une adresse Google en https. Jamais un autre schéma.
export function lienDriveSur(url) {
  try {
    const u = new URL(url);
    const google = u.hostname === "drive.google.com" || u.hostname === "docs.google.com";
    return u.protocol === "https:" && google ? u.href : null;
  } catch {
    return null;
  }
}

const MESSAGES_PAR_CODE = {
  version_reservee_corbeille: "Ce fichier est en cours de mise à la corbeille : il ne peut pas être utilisé pour le moment.",
  corbeille_en_attente: "Une mise à la corbeille de cette version est déjà en cours.",
  corbeille_bloquee: "Une mise à la corbeille de cette version est bloquée : une décision administrateur est requise.",
  corbeille_echec: "La mise à la corbeille n'a pas abouti sur Drive : rien n'a été modifié. La reprise pourra la relancer.",
  corbeille_confirmation_en_attente: "Le fichier est à la corbeille Drive, mais l'enregistrement a échoué : la reprise le terminera.",
  confirmation_requise: "Confirmation explicite requise.",
  fichier_encore_utilise: "Ce fichier est encore utilisé par une preuve ou une génération.",
  fichier_introuvable: "Fichier introuvable sur Drive.",
  fichier_corbeille: "Ce fichier est à la corbeille Drive.",
  fichier_hors_racine: "Ce fichier est hors du dossier Vigie sur Drive.",
  proprietaire_non_conforme: "Le fichier n'appartient pas au compte Vigie : il ne peut pas être rattaché.",
  permissions_non_conformes: "Les permissions du fichier ne respectent pas les règles Vigie.",
  controle_drive_absent: "Le contrôle du fichier Drive n'a pas pu être effectué.",
  deja_a_la_corbeille: "Cette version est déjà à la corbeille.",
  version_courante: "La version courante ne peut pas être mise à la corbeille.",
  version_deja_courante: "Cette version est déjà la version courante.",
  version_obsolete: "Cette version n'est plus une ancienne version : rechargez la page.",
  document_archive: "Ce document est archivé : il ne peut être ni rattaché, ni remplacé. Restaurez-le d'abord.",
  document_deja_archive: "Ce document est déjà archivé.",
  document_non_archive: "Ce document n'est pas archivé.",
  liens_actifs: "Ce document est encore rattaché à une ou plusieurs preuves : détachez-les avant de l'archiver.",
  revalidations_en_attente: "Des revalidations sont en attente pour ce document.",
  deja_rattache: "Ce document est déjà rattaché à cette preuve.",
  document_partage_hors_contexte: "Ce document est partagé avec des preuves hors de ce contexte.",
  operation_non_bloquee: "Cette opération n'est pas bloquée : l'action demandée n'est pas possible.",
  motif_obligatoire: "Un motif est obligatoire.",
  motif_trop_long: "Le motif est trop long.",
};

// Message lisible pour l'utilisateur, à partir d'une erreur de l'API (status, code, message).
export function messageErreur(erreur) {
  if (erreur?.code && MESSAGES_PAR_CODE[erreur.code]) return MESSAGES_PAR_CODE[erreur.code];
  if (erreur?.status === 403) return "Cette action est réservée aux administrateurs.";
  if (erreur?.status === 404) return "Élément introuvable. Il a peut-être été retiré, ou il n'est pas accessible avec vos droits.";
  if (erreur?.status === 503) return "Google Drive est indisponible pour le moment. Rien n'a été modifié : réessayez plus tard.";
  return erreur?.message || "Une erreur inattendue est survenue.";
}
