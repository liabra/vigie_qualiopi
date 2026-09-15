// Client OAuth Google et accès Drive en LECTURE SEULE.
// Le seul compte Drive accepté est config.driveAccountEmail ; ses jetons
// vivent dans drive_connexions. Aucun appel d'écriture Drive n'existe ici.
import { OAuth2Client } from "google-auth-library";
import { drive as driveApi } from "@googleapis/drive";
import { config, googleConfigured } from "../config.js";
import { query } from "../db.js";

export const LOGIN_SCOPES = ["openid", "email", "profile"];
export const DRIVE_READONLY = "https://www.googleapis.com/auth/drive.readonly";
export const DRIVE_SCOPES = ["openid", "email", DRIVE_READONLY];

export const newOAuthClient = () =>
  new OAuth2Client(config.google.clientId, config.google.clientSecret, config.google.redirectUri);

// Échange le code et renvoie l'identité VÉRIFIÉE (signature + audience de l'id_token).
export async function exchangeCode(code) {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.id_token) throw new Error("Google n'a pas renvoyé d'id_token.");
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId });
  const p = ticket.getPayload() || {};
  return {
    tokens,
    identity: {
      sub: p.sub,
      email: (p.email || "").toLowerCase(),
      emailVerified: p.email_verified === true,
      name: p.name || null,
    },
  };
}

export async function saveDriveTokens({ email, tokens, userId }) {
  let refresh = tokens.refresh_token;
  if (!refresh) {
    // Google ne renvoie le refresh_token qu'au premier consentement :
    // on garde celui déjà en base plutôt que de l'écraser.
    const { rows } = await query("SELECT refresh_token FROM drive_connexions WHERE email = $1", [email]);
    refresh = rows[0]?.refresh_token;
    if (!refresh) {
      throw new Error(
        "Google n'a pas renvoyé de refresh_token. Retire l'accès de l'app dans " +
          "https://myaccount.google.com/permissions puis recommence."
      );
    }
  }
  await query(
    `INSERT INTO drive_connexions (email, refresh_token, access_token, expiry, scopes, connecte_par)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO UPDATE SET refresh_token = $2, access_token = $3, expiry = $4,
       scopes = $5, connecte_par = $6`,
    [email, refresh, tokens.access_token || null,
     tokens.expiry_date ? new Date(tokens.expiry_date) : null, tokens.scope || "", userId]
  );
}

// Client Drive prêt à l'emploi, jeton rafraîchi et réécrit en base. null si non connecté.
export async function getDrive() {
  if (!googleConfigured()) return null;
  const { rows } = await query("SELECT * FROM drive_connexions WHERE email = $1", [config.driveAccountEmail]);
  const row = rows[0];
  if (!row) return null;
  const auth = newOAuthClient();
  auth.setCredentials({
    refresh_token: row.refresh_token,
    access_token: row.access_token || undefined,
    expiry_date: row.expiry ? new Date(row.expiry).getTime() : undefined,
  });
  auth.on("tokens", (t) => {
    query("UPDATE drive_connexions SET access_token = $2, expiry = $3 WHERE email = $1", [
      row.email, t.access_token || row.access_token, t.expiry_date ? new Date(t.expiry_date) : null,
    ]).catch((e) => console.error("Drive — sauvegarde du jeton rafraîchi échouée : " + e.message));
  });
  return { drive: driveApi({ version: "v3", auth }), auth, row };
}

export async function driveStatus() {
  const base = { configured: googleConfigured(), compte: config.driveAccountEmail, connected: false };
  const d = await getDrive();
  if (!d) return base;
  const scopes = d.row.scopes.split(/\s+/).filter(Boolean);
  try {
    const { data } = await d.drive.about.get({ fields: "user(emailAddress,displayName)" });
    return { ...base, connected: true, lectureSeule: scopes.includes(DRIVE_READONLY), scopes, verifie: data.user?.emailAddress || null };
  } catch (e) {
    // Le MESSAGE seulement : l'objet d'erreur gaxios peut contenir des jetons.
    return { ...base, connected: true, scopes, erreur: e.message };
  }
}

export async function disconnectDrive() {
  const d = await getDrive();
  if (d) await d.auth.revokeToken(d.row.refresh_token).catch(() => {});
  await query("DELETE FROM drive_connexions WHERE email = $1", [config.driveAccountEmail]);
}
