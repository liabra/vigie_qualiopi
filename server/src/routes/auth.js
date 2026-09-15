import { Router } from "express";
import crypto from "node:crypto";
import { config, googleConfigured } from "../config.js";
import { query } from "../db.js";
import {
  OAUTH_COOKIE, SESSION_COOKIE, clearCookie, decode, readCookie, safeEqual,
  setSignedCookie, startSession,
} from "../session.js";
import { DRIVE_SCOPES, DRIVE_READONLY, LOGIN_SCOPES, exchangeCode, newOAuthClient, saveDriveTokens } from "../services/google.js";

const router = Router();
const OAUTH_TTL_MS = 10 * 60 * 1000;

// L'état anti-CSRF voyage dans un cookie signé : il survit à un redémarrage
// et fonctionne avec plusieurs instances, contrairement à une Map en mémoire.
function beginFlow(res, purpose) {
  const state = crypto.randomBytes(24).toString("base64url");
  setSignedCookie(res, OAUTH_COOKIE, { state, purpose }, OAUTH_TTL_MS);
  return state;
}

const fail = (res, code) => res.redirect("/?erreur=" + code);

// Premier accès : seules les adresses de ADMIN_EMAILS créent leur compte.
// Ensuite la table utilisateurs fait foi.
async function resolveUser(identity) {
  const { rows } = await query("SELECT * FROM utilisateurs WHERE lower(email) = $1", [identity.email]);
  let user = rows[0];
  if (!user) {
    if (!config.adminEmails.includes(identity.email)) return { error: "non_autorise" };
    ({ rows: [user] } = await query(
      "INSERT INTO utilisateurs (email, nom, role) VALUES ($1, $2, 'admin') RETURNING *",
      [identity.email, identity.name]
    ));
  }
  if (!user.actif) return { error: "compte_desactive" };
  if (user.google_sub && user.google_sub !== identity.sub) return { error: "compte_google_different" };
  await query(
    "UPDATE utilisateurs SET google_sub = $2, nom = COALESCE(nom, $3), derniere_connexion = now() WHERE id = $1",
    [user.id, identity.sub, identity.name]
  );
  return { user };
}

router.get("/google/login", (_req, res) => {
  if (!googleConfigured()) return fail(res, "google_non_configure");
  const state = beginFlow(res, "login");
  res.redirect(newOAuthClient().generateAuthUrl({ scope: LOGIN_SCOPES, state, prompt: "select_account" }));
});

// Navigation du navigateur : pas de JSON d'erreur, on renvoie vers l'app.
router.get("/google/drive", (req, res) => {
  if (!googleConfigured()) return fail(res, "google_non_configure");
  if (req.user?.role !== "admin") return fail(res, "non_autorise");
  const state = beginFlow(res, "drive");
  res.redirect(newOAuthClient().generateAuthUrl({
    access_type: "offline", // indispensable pour obtenir un refresh_token
    prompt: "consent",
    include_granted_scopes: false,
    login_hint: config.driveAccountEmail,
    scope: DRIVE_SCOPES,
    state,
  }));
});

router.get("/google/callback", async (req, res) => {
  const flow = decode(readCookie(req, OAUTH_COOKIE));
  clearCookie(res, OAUTH_COOKIE);
  const { code, state, error } = req.query;
  if (error) return fail(res, "refus_google");
  if (!flow || !code || !safeEqual(flow.state, state)) return fail(res, "oauth_invalide");

  try {
    const { tokens, identity } = await exchangeCode(String(code));
    if (!identity.email || !identity.emailVerified) return fail(res, "email_non_verifie");

    if (flow.purpose === "login") {
      const { user, error: err } = await resolveUser(identity);
      if (err) return fail(res, err);
      startSession(res, user.id);
      return res.redirect("/");
    }

    if (flow.purpose === "drive") {
      if (req.user?.role !== "admin") return fail(res, "non_autorise");
      if (identity.email !== config.driveAccountEmail) return fail(res, "mauvais_compte_drive");
      if (!(tokens.scope || "").split(/\s+/).includes(DRIVE_READONLY)) return fail(res, "scope_drive_refuse");
      await saveDriveTokens({ email: identity.email, tokens, userId: req.user.id });
      return res.redirect("/?drive=ok");
    }

    return fail(res, "oauth_invalide");
  } catch (e) {
    // Le MESSAGE seulement, jamais l'objet : une erreur gaxios porte le corps
    // de la requête de jeton, client_secret et code compris.
    console.error("OAuth Google — échec : " + (e.message || "erreur inconnue"));
    return fail(res, "oauth_echec");
  }
});

router.post("/logout", (_req, res) => {
  clearCookie(res, SESSION_COOKIE);
  res.json({ ok: true });
});

export default router;
