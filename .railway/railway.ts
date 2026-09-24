// Infrastructure as Code Railway — remplace railway.json (Config as Code,
// plus lu à partir du 01/12/2026). Appliqué par `railway config plan` puis
// `railway config apply` ; Railway ne lit PAS ce fichier au déploiement.
//
// Partial : ce dépôt ne gère QUE le service applicatif. Le service
// PostgreSQL (Postgres-Vlqb) n'est ni déclaré ni possédé ici : son omission
// ne peut donc jamais le modifier ni le supprimer.
import { defineRailway, github, preserve, project, service } from "railway/iac";

export const partial = "vigie_qualiopi";

export default defineRailway((ctx) => {
  const vigie_qualiopi = service("vigie_qualiopi", {
    // Source conservée explicitement : l'omettre détacherait le dépôt (plus d'auto-deploy).
    source: github("liabra/vigie_qualiopi", { branch: "main" }),
    build: { builder: "RAILPACK", buildCommand: "npm run build" },
    deploy: {
      // Node directement (et non `npm start`) : en production, SIGTERM s'arrêtait
      // dans la couche npm et n'atteignait jamais l'arrêt propre de l'application.
      // Strictement équivalent : `npm start -w server` ne fait que `node src/index.js`,
      // et le serveur ne dépend pas du répertoire courant (chemins via import.meta.url).
      startCommand: "node server/src/index.js",
      healthcheckPath: "/api/health",
      healthcheckTimeout: 120,
      // Politique ON_FAILURE = défaut Railway, stocké comme null : la déclarer
      // produirait une dérive perpétuelle (plan jamais vide, redéploiement à
      // chaque apply). Seul le nombre d'essais est donc géré ici.
      restartPolicyMaxRetries: 5,
      // SIGTERM → SIGKILL : laisse l'arrêt propre (server/src/arret.js, 10 s) se terminer.
      drainingSeconds: 15,
    },
    // Variables existantes conservées telles quelles : jamais de valeur dans le dépôt.
    // Omettre une variable la SUPPRIMERAIT au prochain apply.
    env: {
      ADMIN_EMAILS: preserve(),
      DATABASE_URL: preserve(),
      DRIVE_ACCOUNT_EMAIL: preserve(),
      GOOGLE_CLIENT_ID: preserve(),
      GOOGLE_CLIENT_SECRET: preserve(),
      GOOGLE_REDIRECT_URI: preserve(),
      SESSION_SECRET: preserve(),
    },
  });
  return project(ctx.projectName, { resources: [vigie_qualiopi] });
});
