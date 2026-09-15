import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { sessionMiddleware } from "./session.js";
import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/api.js";

const CLIENT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // Railway termine le TLS : cookies secure et req.protocol corrects
  app.use(express.json({ limit: "1mb" }));
  app.use(sessionMiddleware);

  app.use("/auth", authRoutes);
  app.use("/api", apiRoutes);

  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));
    app.get("*", (_req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
  }

  app.use((err, _req, res, _next) => {
    console.error(err.message || err);
    res.status(500).json({ error: config.isProd ? "Erreur serveur." : err.message });
  });
  return app;
}
