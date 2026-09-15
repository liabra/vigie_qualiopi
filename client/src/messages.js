// Codes renvoyés par le serveur dans ?erreur=… après un passage chez Google.
export const ERREURS = {
  google_non_configure: "Google OAuth n'est pas configuré sur le serveur.",
  non_autorise: "Ce compte Google n'est pas autorisé à accéder à Vigie Qualiopi.",
  compte_desactive: "Ce compte a été désactivé.",
  compte_google_different: "Cette adresse est liée à un autre compte Google.",
  refus_google: "La connexion a été annulée côté Google.",
  oauth_invalide: "Lien de connexion expiré ou invalide. Recommencez.",
  oauth_echec: "La connexion Google a échoué. Réessayez.",
  email_non_verifie: "L'adresse de ce compte Google n'est pas vérifiée.",
  mauvais_compte_drive: "Le Drive doit être connecté avec le compte de l'organisme.",
  scope_drive_refuse: "L'accès en lecture au Drive n'a pas été accordé.",
};
