// Client OAuth Google et accès Drive en LECTURE SEULE.
// Le seul compte Drive accepté est config.driveAccountEmail ; ses jetons
// vivent dans drive_connexions. Aucun appel d'écriture Drive n'existe ici.
import { OAuth2Client } from "google-auth-library";
import { drive as driveApi } from "@googleapis/drive";
import { sheets as sheetsApi } from "@googleapis/sheets";
import { docs as docsApi } from "@googleapis/docs";
import { config, googleConfigured } from "../config.js";
import { query } from "../db.js";

export const LOGIN_SCOPES = ["openid", "email", "profile"];
export const DRIVE_READONLY = "https://www.googleapis.com/auth/drive.readonly";
// Lecture du classeur de suivi : l export CSV de Drive ne rendrait que le
// premier onglet et perdrait les cellules fusionnées, dont ce classeur est
// truffé. L API Sheets donne les deux, en lecture seule elle aussi.
export const SHEETS_READONLY = "https://www.googleapis.com/auth/spreadsheets.readonly";
// Écriture : uniquement les fichiers que l'application crée elle-même.
// drive.file ne donne AUCUN droit d'écriture sur le reste du Drive, à la
// différence du scope `drive` complet, qu'on ne demande pas.
export const DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_SCOPES = ["openid", "email", DRIVE_READONLY, SHEETS_READONLY, DRIVE_FILE];

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
  return {
    drive: driveApi({ version: "v3", auth }),
    sheets: sheetsApi({ version: "v4", auth }),
    docs: docsApi({ version: "v1", auth }),
    auth, row,
  };
}

export async function driveStatus() {
  const base = { configured: googleConfigured(), compte: config.driveAccountEmail, connected: false };
  const d = await getDrive();
  if (!d) return base;
  const scopes = d.row.scopes.split(/\s+/).filter(Boolean);
  try {
    const { data } = await d.drive.about.get({ fields: "user(emailAddress,displayName)" });
    return {
      ...base, connected: true, lectureSeule: scopes.includes(DRIVE_READONLY), scopes,
      // Un compte lié avant l ajout du scope Sheets ne peut pas lire le
      // classeur : on le signale sans attendre le premier 403.
      sheetsAutorise: scopes.includes(SHEETS_READONLY),
      // Sans drive.file, l'application peut tout lire mais ne peut RIEN
      // créer : la génération de documents est impossible.
      ecritureAutorisee: scopes.includes(DRIVE_FILE),
      reconnexionRequise: !scopes.includes(SHEETS_READONLY) || !scopes.includes(DRIVE_FILE),
      verifie: data.user?.emailAddress || null,
    };
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

// ── Diagnostic des appels Google ─────────────────────────────
// Un « error.message » seul ne dit pas pourquoi Google refuse. On garde
// donc le code, le statut, le corps JSON complet et l'URL appelée.
// JAMAIS de jeton : ni en-tête Authorization, ni corps de requête, où
// gaxios range access_token, refresh_token et client_secret.

// Ne laisse passer que des clés inoffensives, à toute profondeur.
const SENSIBLE = /token|secret|authorization|password|assertion|credential|key$/i;
export function nettoyer(valeur, profondeur = 0) {
  if (valeur === null || typeof valeur !== "object") return valeur;
  if (profondeur > 4) return "[…]";
  if (Array.isArray(valeur)) return valeur.slice(0, 20).map((v) => nettoyer(v, profondeur + 1));
  const sortie = {};
  for (const [k, v] of Object.entries(valeur)) {
    sortie[k] = SENSIBLE.test(k) ? "[masqué]" : nettoyer(v, profondeur + 1);
  }
  return sortie;
}

// État du jeton AU MOMENT de l'appel : dit si un rafraîchissement a dû
// avoir lieu juste avant, ce qui oriente vers la piste « jeton » ou non.
export function etatJeton(row, maintenant = Date.now()) {
  if (!row) return { connu: false };
  const expiry = row.expiry ? new Date(row.expiry).getTime() : null;
  return {
    connu: true,
    aAccessToken: !!row.access_token,
    expiry: expiry ? new Date(expiry).toISOString() : null,
    expire: expiry ? expiry <= maintenant : null,
    secondesRestantes: expiry ? Math.round((expiry - maintenant) / 1000) : null,
    scopes: (row.scopes || "").split(/\s+/).filter(Boolean),
  };
}

// Extrait tout ce que Google a renvoyé, quelle que soit la couche qui a
// emballé l'erreur (gaxios, googleapis-common, fetch).
export function diagnostiquerErreur(e, contexte = {}) {
  const reponse = e?.response;
  const corps = reponse?.data ?? e?.errors ?? null;
  return {
    ...contexte,
    message: e?.message || String(e),
    code: e?.code ?? null,
    status: e?.status ?? reponse?.status ?? null,
    statusText: reponse?.statusText ?? null,
    url: e?.config?.url ? String(e.config.url).split("?")[0] : null,
    methode: e?.config?.method ?? null,
    googleErreur: nettoyer(corps),
  };
}

// Enveloppe un appel Google : journalise le diagnostic complet côté
// serveur et l'attache à l'erreur pour que la route puisse le renvoyer.
export async function appelGoogle(operation, fn, contexte = {}) {
  try {
    return await fn();
  } catch (e) {
    const diagnostic = diagnostiquerErreur(e, { operation, ...contexte });
    console.error("Google — échec de " + operation + " : " + JSON.stringify(diagnostic));
    e.diagnostic = diagnostic;
    throw e;
  }
}

// ── Classeur de suivi ────────────────────────────────────────
// Recherche PAR NOM, jamais par identifiant en dur : le classeur peut être
// renommé ou recréé. Les noms connus sont des amorces, pas une liste fermée.
export const NOMS_CLASSEUR = ["Audit", "construction", "systeme qualite", "système qualité", "qualiopi", "suivi"];
const MIME_SHEET = "application/vnd.google-apps.spreadsheet";

export async function chercherClasseurs(drive, { noms = NOMS_CLASSEUR, jeton = null } = {}) {
  const vus = new Map();
  for (const nom of noms) {
    const { data } = await appelGoogle(
      "drive.files.list",
      () => drive.files.list({
        q: `mimeType = '${MIME_SHEET}' and name contains '${nom.replace(/'/g, "\\'")}' and trashed = false`,
        fields: "files(id,name,parents,modifiedTime,webViewLink,owners(emailAddress))",
        pageSize: 50, orderBy: "modifiedTime desc",
        supportsAllDrives: true, includeItemsFromAllDrives: true,
      }),
      { api: "drive", recherche: nom, jeton: etatJeton(jeton) }
    );
    for (const f of data.files || []) if (!vus.has(f.id)) vus.set(f.id, f);
  }
  return [...vus.values()];
}

// Grille d'un onglet, cellules fusionnées comprises. `onglet` facultatif :
// sans lui, on prend la première feuille du classeur.
export async function lireOnglet(sheets, fichierId, onglet = null, { jeton = null } = {}) {
  const { data: meta } = await appelGoogle(
    "sheets.spreadsheets.get",
    () => sheets.spreadsheets.get({
      spreadsheetId: fichierId,
      fields: "properties(title),sheets(properties(sheetId,title,index,gridProperties),merges)",
    }),
    { api: "sheets", fichierId, jeton: etatJeton(jeton) }
  );
  const feuilles = meta.sheets || [];
  if (!feuilles.length) throw new Error("Classeur sans feuille.");
  const feuille = onglet
    ? feuilles.find((f) => f.properties.title === onglet)
    : feuilles[0];
  if (!feuille) throw new Error(`Onglet « ${onglet} » introuvable. Onglets : ${feuilles.map((f) => f.properties.title).join(", ")}`);

  const titre = feuille.properties.title;
  const { data } = await appelGoogle(
    "sheets.spreadsheets.values.get",
    () => sheets.spreadsheets.values.get({
      spreadsheetId: fichierId,
      range: `'${titre.replace(/'/g, "''")}'`,
      valueRenderOption: "FORMATTED_VALUE",
      majorDimension: "ROWS",
    }),
    { api: "sheets", fichierId, onglet: titre, jeton: etatJeton(jeton) }
  );
  return {
    classeur: meta.properties?.title || "",
    onglet: titre,
    onglets: feuilles.map((f) => f.properties.title),
    grille: (data.values || []).map((r) => r.map((c) => (c == null ? "" : String(c)))),
    fusions: (feuille.merges || []).map((m) => ({
      debutLigne: m.startRowIndex, finLigne: m.endRowIndex,
      debutColonne: m.startColumnIndex, finColonne: m.endColumnIndex,
    })),
  };
}
