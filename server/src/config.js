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
  driveAccountEmail: (env.DRIVE_ACCOUNT_EMAIL || "actions.a2c@gmail.com").trim().toLowerCase(),
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
}
