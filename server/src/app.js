import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sessionMiddleware } from "./session.js";
import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/api.js";
import gestionRoutes from "./routes/gestion.js";

const CLIENT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // En-têtes de sécurité minimaux, sans dépendance : pas de MIME sniffing,
  // pas d'embarquement en iframe, pas de fuite de référent interne.
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  app.set("trust proxy", 1); // Railway termine le TLS : cookies secure et req.protocol corrects
  app.use(express.json({ limit: "1mb" }));
  app.use(sessionMiddleware);

  app.use("/auth", authRoutes);
  // gestion AVANT api : api.js se termine par un 404 attrape-tout, qui
  // masquerait sinon toutes les routes de la Phase 2.
  app.use("/api", gestionRoutes);
  app.use("/api", apiRoutes);

  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));
    app.get("*", (_req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
  }

  // Une seule erreur SQL est traduite GLOBALEMENT : 23505 (violation d'unicité).
  // Toutes les contraintes UNIQUE de Vigie portent sur une clé MÉTIER saisie
  // par l'utilisateur (email, code_interne, référence, nom de groupe, code de
  // version, couple preuve×fichier, modèle×portée…). Une violation d'unicité
  // est donc TOUJOURS un conflit de données, jamais un bug serveur.
  //
  // Les autres erreurs SQL (FK 23503, CHECK 23514, NOT NULL 23502,
  // invalid_text 22P02, numeric out of range 22003…) peuvent tout aussi bien
  // provenir d'un bug de programmation que d'une saisie : on NE les présente
  // JAMAIS comme une erreur utilisateur. Les routes qui connaissent ces
  // conflits les traduisent explicitement ; le reste tombe en 500 générique.
  const ERREURS_SQL = {
    "23505": { statut: 409, message: "Conflit : cet enregistrement existe déjà." },
  };

  app.use((err, _req, res, _next) => {
    const sql = ERREURS_SQL[err.code];
    if (sql) {
      console.error(`[SQL ${err.code}] ${err.message}`);
      return res.status(sql.statut).json({ error: sql.message });
    }
    // Corps trop volumineux (express.json, limite 1 Mo). Le middleware est
    // GLOBAL : le message vise tout corps JSON, pas seulement un fichier CSV
    // importé. 413 explicite plutôt qu'un 400 trompeur — l'utilisateur sait
    // ainsi que c'est la TAILLE qui pose problème, pas le contenu.
    if (err.type === "entity.too.large" || err.status === 413) {
      return res.status(413).json({ error: "Corps de requête trop volumineux : la limite est de 1 Mo." });
    }
    // JSON mal formé (body-parser) ou autre erreur d'appel connue.
    if (err.type === "entity.parse.failed" || (err.status && err.status < 500)) {
      return res.status(400).json({ error: "Requête invalide : corps ou JSON mal formé." });
    }
    // Erreur serveur réellement inattendue : jamais de stack, de requête SQL
    // ni de détail PostgreSQL exposé au client. Le détail reste côté serveur.
    console.error(err.message || err);
    res.status(500).json({ error: "Erreur serveur." });
  });
  return app;
}
