// ─────────────────────────────────────────────────────────────
//  Comptes utilisateurs gérés dans l'application (administrateur) : ajout d'un collègue ou d'un auditeur
//  externe sans toucher aux variables du serveur. La connexion reste Google : on enregistre l'adresse
//  autorisée et son rôle. Garde-fous : jamais se retirer soi-même ses droits, toujours au moins un
//  administrateur actif, auditeur obligatoirement limité dans le temps.
//  Journal des opérations sensibles en lecture (administrateur).
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { query } from "../db.js";
import { requireAdmin } from "../session.js";
import { parseIdPositif } from "../services/ids.js";
import { estDateValide } from "../services/dates.js";
import { journaliser } from "../services/journal.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const ROLES = ["admin", "contributeur", "auditeur"];
const EMAIL = /^[^\s@<>{}]+@[^\s@<>{}]+\.[^\s@<>{}]+$/;
const DUREE_MAX_AUDITEUR_JOURS = 90;
const COLONNES = "id, email, nom, role, actif, expire_le, derniere_connexion, created_at";

const aujourdhui = () => new Date().toISOString().slice(0, 10);
function plusJours(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// Valide rôle / expiration / nom. `complet` : création (rôle obligatoire).
function lireCompte(corps, { complet }) {
  const c = corps && typeof corps === "object" ? corps : {};
  const v = {};
  if (complet || c.role !== undefined) {
    if (!ROLES.includes(c.role)) return { erreur: "Rôle inconnu." };
    v.role = c.role;
  }
  if (c.nom !== undefined) {
    if (c.nom !== null && typeof c.nom !== "string") return { erreur: "Nom invalide." };
    const n = (c.nom || "").trim();
    if (n.length > 150 || /[{}<>]/.test(n)) return { erreur: "Nom invalide." };
    v.nom = n || null;
  }
  if (c.expire_le !== undefined) {
    const d = c.expire_le === null ? "" : String(c.expire_le).trim();
    if (d && !estDateValide(d)) return { erreur: "Date d'expiration invalide : format attendu AAAA-MM-JJ." };
    if (d && d < aujourdhui()) return { erreur: "La date d'expiration est déjà passée." };
    v.expire_le = d || null;
  }
  if (c.actif !== undefined) v.actif = c.actif === true;
  return { valeur: v };
}

function controlerAuditeur(role, expire) {
  if (role !== "auditeur") return null;
  if (!expire) return "Un accès auditeur doit avoir une date de fin.";
  if (expire > plusJours(DUREE_MAX_AUDITEUR_JOURS)) return `Un accès auditeur dure ${DUREE_MAX_AUDITEUR_JOURS} jours au plus.`;
  return null;
}

router.get("/comptes", requireAdmin, wrap(async (_req, res) => {
  const { rows } = await query(`SELECT ${COLONNES} FROM utilisateurs ORDER BY actif DESC, role, lower(coalesce(nom, email))`);
  res.json({ comptes: rows, roles: ROLES });
}));

router.post("/comptes", requireAdmin, wrap(async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 200) return res.status(400).json({ error: "Adresse e-mail invalide." });
  const l = lireCompte(req.body, { complet: true });
  if (l.erreur) return res.status(400).json({ error: l.erreur });
  const refus = controlerAuditeur(l.valeur.role, l.valeur.expire_le ?? null);
  if (refus) return res.status(400).json({ error: refus });
  const { rowCount } = await query("SELECT 1 FROM utilisateurs WHERE lower(email) = $1", [email]);
  if (rowCount) return res.status(409).json({ error: "Un compte existe déjà pour cette adresse." });
  const { rows: [c] } = await query(
    `INSERT INTO utilisateurs (email, nom, role, expire_le, cree_par) VALUES ($1,$2,$3,$4,$5) RETURNING ${COLONNES}`,
    [email, l.valeur.nom ?? null, l.valeur.role, l.valeur.expire_le ?? null, req.user.id]);
  await journaliser("compte_cree", { detail: `rôle ${c.role}`, cibleType: "utilisateur", cibleId: c.id, par: req.user.id });
  res.status(201).json({ compte: c });
}));

router.patch("/comptes/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de compte invalide." });
  const l = lireCompte(req.body, { complet: false });
  if (l.erreur) return res.status(400).json({ error: l.erreur });
  const v = l.valeur;
  if (!Object.keys(v).length) return res.status(400).json({ error: "Rien à modifier." });
  const { rows: [actuel] } = await query("SELECT id, role, actif, expire_le FROM utilisateurs WHERE id = $1", [id]);
  if (!actuel) return res.status(404).json({ error: "Compte introuvable." });
  // fix : on ne se retire jamais ses propres droits (verrouillage involontaire).
  if (id === req.user.id && ((v.role && v.role !== "admin") || v.actif === false || v.expire_le)) {
    return res.status(400).json({ error: "Vous ne pouvez pas restreindre ou désactiver votre propre compte." });
  }
  const role = v.role ?? actuel.role;
  const actif = v.actif ?? actuel.actif;
  const expire = v.expire_le !== undefined ? v.expire_le : (actuel.expire_le ? String(actuel.expire_le).slice(0, 10) : null);
  const refus = controlerAuditeur(role, expire);
  if (refus) return res.status(400).json({ error: refus });
  if (actuel.role === "admin" && actuel.actif && (role !== "admin" || !actif)) {
    const { rows: [{ n }] } = await query("SELECT count(*)::int AS n FROM utilisateurs WHERE role = 'admin' AND actif AND id <> $1", [id]);
    if (n === 0) return res.status(400).json({ error: "Il doit rester au moins un administrateur actif." });
  }
  const sets = []; const params = [id];
  for (const [col, val] of Object.entries(v)) { params.push(val); sets.push(`${col} = $${params.length}`); }
  const { rows: [c] } = await query(`UPDATE utilisateurs SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 RETURNING ${COLONNES}`, params);
  await journaliser("compte_modifie", { detail: Object.keys(v).join(", "), cibleType: "utilisateur", cibleId: id, par: req.user.id });
  res.json({ compte: c });
}));

router.get("/journal-securite", requireAdmin, wrap(async (req, res) => {
  const limite = Math.min(500, parseIdPositif(req.query.limite) || 200);
  const { rows } = await query(
    `SELECT j.id, j.evenement, j.detail, j.cible_type, j.cible_id, j.cree_le, u.nom AS par_nom, u.email AS par_email
     FROM journal_securite j LEFT JOIN utilisateurs u ON u.id = j.par ORDER BY j.cree_le DESC, j.id DESC LIMIT $1`, [limite]);
  res.json({ evenements: rows });
}));

export default router;
