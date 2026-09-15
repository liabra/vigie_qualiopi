// Cookies signés HMAC, sans dépendance : session utilisateur et état OAuth.
import crypto from "node:crypto";
import { config } from "./config.js";
import { query } from "./db.js";

export const SESSION_COOKIE = "vq_session";
export const OAUTH_COOKIE = "vq_oauth";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

const sign = (body, secret) => crypto.createHmac("sha256", secret).update(body).digest("base64url");

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function encode(payload, secret = config.sessionSecret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return body + "." + sign(body, secret);
}

// null si absent, falsifié, illisible ou expiré.
export function decode(token, secret = config.sessionSecret, now = Date.now()) {
  if (!token || typeof token !== "string") return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  if (!safeEqual(sig, sign(body, secret))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof p.exp !== "number" || p.exp < now) return null;
    return p;
  } catch {
    return null;
  }
}

export function readCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

const cookieOptions = (maxAge) => ({
  httpOnly: true,
  sameSite: "lax", // envoyé au retour de Google (navigation de premier niveau)
  secure: config.isProd,
  path: "/",
  maxAge,
});

export function setSignedCookie(res, name, payload, ttlMs) {
  res.cookie(name, encode({ ...payload, exp: Date.now() + ttlMs }), cookieOptions(ttlMs));
}

export function clearCookie(res, name) {
  res.clearCookie(name, { ...cookieOptions(0), maxAge: undefined });
}

export const startSession = (res, userId) => setSignedCookie(res, SESSION_COOKIE, { uid: userId }, SESSION_TTL_MS);

// Recharge l'utilisateur à chaque requête : un compte désactivé ou un rôle
// retiré prend effet immédiatement, sans attendre l'expiration du cookie.
export async function sessionMiddleware(req, _res, next) {
  req.user = null;
  const s = decode(readCookie(req, SESSION_COOKIE));
  if (!s?.uid) return next();
  try {
    const { rows } = await query(
      "SELECT id, email, nom, role FROM utilisateurs WHERE id = $1 AND actif",
      [s.uid]
    );
    req.user = rows[0] || null;
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Connexion requise." });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Connexion requise." });
  if (req.user.role !== "admin") return res.status(403).json({ error: "Réservé aux administrateurs." });
  next();
}
