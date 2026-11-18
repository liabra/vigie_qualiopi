// Lecture unique de l'environnement. Le reste du code importe `config`,
// jamais process.env directement.
import crypto from "node:crypto";

const env = process.env;
const list = (v) => (v || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export const config = {
  port: Number(env.PORT) || 3000,
  isProd: env.NODE_ENV === "production",
  databaseUrl: env.DATABASE_URL || "",
  sessionSecret: env.SESSION_SECRET || "",
  google: {
    clientId: env.GOOGLE_CLIENT_ID || "",
    clientSecret: env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: env.GOOGLE_REDIRECT_URI || "",
  },
  adminEmails: list(env.ADMIN_EMAILS),
  // Comptes autorisés à SAISIR sans être administrateurs : ils ajoutent
  // des stagiaires et génèrent des documents, rien d'autre.
  contributeurEmails: list(env.CONTRIBUTEUR_EMAILS),
  driveAccountEmail: (env.DRIVE_ACCOUNT_EMAIL || "actions.a2c@gmail.com").trim().toLowerCase(),
  // Nom de l'organisme, injecté dans les documents via {{nom_organisme}}.
  organismeNom: (env.ORGANISME_NOM || "A2C").trim(),
  // Dossier Drive où sont déposés les documents générés. Par défaut
  // l'application le cherche par son nom et le crée s'il n'existe pas ;
  // DRIVE_RACINE_ID permet d'imposer un dossier parent précis.
  driveRacine: (env.DRIVE_RACINE || "A2C Qualiopi").trim(),
  driveRacineId: (env.DRIVE_RACINE_ID || "").trim(),
  // Garde-fou des essais LOCAUX : absent/faux par défaut, donc aucun changement en production. Actif, toute
  // écriture Drive se fait dans VIGIE_DRIVE_TEST_ROOT_ID (dossier vide, nommé « test », à la racine du Drive),
  // jamais dans le dossier de production, et sans jamais se replier sur DRIVE_RACINE_ID.
  driveModeTest: ["1", "true", "yes"].includes((env.VIGIE_DRIVE_MODE_TEST || "").trim().toLowerCase()),
  driveTestRootId: (env.VIGIE_DRIVE_TEST_ROOT_ID || "").trim(),
  // Exécution sur Railway (production ou autre environnement déployé) : jamais concernée par le blocage des
  // essais locaux, même si NODE_ENV venait à manquer.
  surRailway: Boolean((env.RAILWAY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || "").trim()),
};

export const googleConfigured = () =>
  !!(config.google.clientId && config.google.clientSecret && config.google.redirectUri);

// Échoue tôt, avec un message lisible dans les logs Railway.
export function checkConfig() {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL manquante : Vigie Qualiopi a besoin de PostgreSQL pour démarrer.");
  }
  if (!config.sessionSecret) {
    if (config.isProd) throw new Error("SESSION_SECRET manquante : obligatoire en production.");
    config.sessionSecret = crypto.randomBytes(32).toString("base64url");
    console.warn("SESSION_SECRET absente : clé temporaire générée (sessions perdues à chaque redémarrage).");
  }
  if (!googleConfigured()) {
    console.warn("Google OAuth non configuré (GOOGLE_CLIENT_ID / SECRET / REDIRECT_URI) : connexion impossible.");
  }
  if (!config.isProd && !config.surRailway && !config.driveModeTest && googleConfigured()) {
    console.warn("Démarrage local avec Google configuré : la génération de documents est bloquée tant que " +
      "VIGIE_DRIVE_MODE_TEST (et VIGIE_DRIVE_TEST_ROOT_ID) ne sont pas définis, pour ne jamais écrire dans le Drive de production.");
  }
}
