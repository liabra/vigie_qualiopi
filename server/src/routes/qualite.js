// ─────────────────────────────────────────────────────────────
//  Q1 — Cœur qualité : signalements (réclamation / incident /
//  non-conformité) + actions qualité. Backend seul, aucune UI.
//
//  RBAC :
//   · signalements : admin uniquement (le contributeur n'a AUCUN accès) ;
//   · actions : admin complet ; le contributeur ne voit QUE ses actions
//     assignées, peut les démarrer et les réaliser, sans jamais voir
//     l'identité ni le texte sensible du signalement source.
//
//  Aucun hard delete : annulation et clôture sont des statuts, tracés.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { getPool, query } from "../db.js";
import { requireAdmin, requireRedacteur } from "../session.js";
import { parseIdPositif } from "../services/ids.js";
import { estDateValide } from "../services/dates.js";
import {
  CANAUX, CAUSES, PRIORITES, STATUTS_ACTION, STATUTS_SIGNALEMENT, TYPES_SIGNALEMENT,
  TRANSITIONS_ACTION, TRANSITIONS_SIGNALEMENT,
  champsAction, champsSignalement, lireCauses, lireIndicateurs,
  prefixeReference, referencePour, datePlusJoursOuvres, transitionInvalide,
} from "../services/qualite.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Champs dont on ne journalise QUE le fait de modification (jamais le
// contenu, potentiellement personnel).
const CHAMPS_SENSIBLES = new Set([
  "objet", "description", "reclamant_nom", "reclamant_entreprise", "reclamant_email",
  "personne_concernee_libelle", "synthese_reponse", "cause_autre_libelle",
  "constat", "action_prevue", "resultat", "controle_efficacite",
]);

const err400 = (message) => { const e = new Error(message); e.statut400 = true; return e; };

async function journaliser(client, { entiteType, entiteId, evenement, champ = null, ancienne = null, nouvelle = null }, par) {
  await client.query(
    `INSERT INTO historique_qualite (entite_type, entite_id, evenement, champ, ancienne_valeur, nouvelle_valeur, par)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entiteType, entiteId, evenement, champ, ancienne, nouvelle, par]
  );
}

// Journalise chaque champ réellement changé (fait seul pour les champs
// sensibles ; valeurs avant/après pour les champs structurés).
async function journaliserChamps(client, entiteType, entiteId, avant, champs, par) {
  for (const [champ, nouvelle] of Object.entries(champs)) {
    const ancienne = avant[champ] ?? null;
    const n = nouvelle ?? null;
    const a = ancienne ?? null;
    if (String(a) === String(n)) continue;
    if (CHAMPS_SENSIBLES.has(champ)) {
      await journaliser(client, { entiteType, entiteId, evenement: "modification", champ, ancienne: null, nouvelle: null }, par);
    } else {
      await journaliser(client, { entiteType, entiteId, evenement: "modification", champ, ancienne: a, nouvelle: n }, par);
    }
  }
}

async function verifierIndicateurs(client, ids) {
  if (!ids.length) return;
  const { rows } = await client.query("SELECT id FROM indicateurs WHERE id = ANY($1::int[])", [ids]);
  const connus = new Set(rows.map((r) => r.id));
  const manquants = ids.filter((n) => !connus.has(n));
  if (manquants.length) throw err400(`Indicateur(s) introuvable(s) : ${manquants.join(", ")}.`);
}

async function verifierResponsable(client, id) {
  if (id === null || id === undefined) return;
  const { rows } = await client.query("SELECT id FROM utilisateurs WHERE id = $1 AND actif", [id]);
  if (!rows.length) throw err400("Responsable introuvable ou inactif.");
}

async function verifierSignalement(client, id) {
  const { rows } = await client.query("SELECT id FROM signalements_qualite WHERE id = $1", [id]);
  if (!rows.length) throw err400("Signalement introuvable.");
}

// Si une inscription est rattachée, sa session est DÉRIVÉE (et vérifiée) :
// on n'autorise jamais une inscription incohérente avec la session fournie.
async function reconcilierInscription(client, champs, avant) {
  const inscriptionId = champs.inscription_id !== undefined ? champs.inscription_id : avant.inscription_id ?? null;
  if (inscriptionId === null) return champs;
  const { rows: [inscription] } = await client.query("SELECT session_id FROM inscriptions WHERE id = $1", [inscriptionId]);
  if (!inscription) throw err400("Inscription introuvable.");
  const sessionId = champs.session_id !== undefined ? champs.session_id : avant.session_id ?? null;
  if (sessionId !== null && sessionId !== inscription.session_id) {
    throw err400("L'inscription n'appartient pas à la session indiquée.");
  }
  champs.session_id = inscription.session_id;
  return champs;
}

// Si une session est rattachée, la formation en est DÉRIVÉE (et vérifiée) :
// on n'autorise jamais une session incohérente avec la formation.
async function reconcilierSessionFormation(client, champs, avant) {
  const sessionId = champs.session_id !== undefined ? champs.session_id : avant.session_id ?? null;
  const formationId = champs.formation_id !== undefined ? champs.formation_id : avant.formation_id ?? null;
  if (sessionId === null) return champs;
  const { rows: [session] } = await client.query("SELECT formation_id FROM sessions WHERE id = $1", [sessionId]);
  if (!session) throw err400("Session introuvable.");
  if (formationId !== null && session.formation_id !== formationId) {
    throw err400("La session ne correspond pas à la formation indiquée.");
  }
  champs.formation_id = session.formation_id;
  return champs;
}

async function referenceSuivante(client, prefixe) {
  const annee = new Date().getUTCFullYear();
  const { rows: [c] } = await client.query(
    `INSERT INTO compteurs_qualite (annee, type, dernier) VALUES ($1, $2, 1)
     ON CONFLICT (annee, type) DO UPDATE SET dernier = compteurs_qualite.dernier + 1
     RETURNING dernier`, [annee, prefixe]
  );
  return referencePour(prefixe, annee, c.dernier);
}

async function compterIndicateurs(client, table, colonne, id) {
  const { rows: [{ n }] } = await client.query(
    `SELECT count(*)::int AS n FROM ${table} WHERE ${colonne} = $1`, [id]
  );
  return n;
}

async function synchroniserIndicateurs(client, table, colonne, id, ids, entiteType, par) {
  if (ids === null) return; // non fourni : lien inchangé
  const { rows: actuels } = await client.query(`SELECT indicateur_id FROM ${table} WHERE ${colonne} = $1`, [id]);
  const avantSet = new Set(actuels.map((r) => r.indicateur_id));
  const apresSet = new Set(ids);
  for (const ind of [...apresSet].filter((n) => !avantSet.has(n))) {
    await client.query(`INSERT INTO ${table} (${colonne}, indicateur_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, ind]);
    await journaliser(client, { entiteType, entiteId: id, evenement: "rattachement_indicateur", champ: "indicateur_id", nouvelle: String(ind) }, par);
  }
  for (const ind of [...avantSet].filter((n) => !apresSet.has(n))) {
    await client.query(`DELETE FROM ${table} WHERE ${colonne} = $1 AND indicateur_id = $2`, [id, ind]);
    await journaliser(client, { entiteType, entiteId: id, evenement: "retrait_indicateur", champ: "indicateur_id", ancienne: String(ind) }, par);
  }
}

async function synchroniserCauses(client, id, causes, par) {
  if (causes === null) return; // non fourni : causes inchangées
  const { rows: actuelles } = await client.query("SELECT cause FROM signalements_qualite_causes WHERE signalement_id = $1", [id]);
  const inchangees = actuelles.length === causes.length && actuelles.every((r) => causes.includes(r.cause));
  await client.query("DELETE FROM signalements_qualite_causes WHERE signalement_id = $1", [id]);
  for (const cause of causes) {
    await client.query("INSERT INTO signalements_qualite_causes (signalement_id, cause) VALUES ($1, $2)", [id, cause]);
  }
  // La cause « autre » retirée ne doit pas laisser un libellé orphelin.
  if (!causes.includes("autre")) {
    await client.query("UPDATE signalements_qualite SET cause_autre_libelle = NULL WHERE id = $1", [id]);
  }
  // fix : pas de faux événement quand l'ensemble des causes ne change pas.
  if (!inchangees) await journaliser(client, { entiteType: "signalement", entiteId: id, evenement: "modification", champ: "causes" }, par);
}

// ── Filtres de liste (actifs / clôturés / annulés / tous) ─────
function filtreEtat(etat, col = "statut") {
  if (etat === "clotures") return `${col} = 'cloturee'`;
  if (etat === "annules") return `${col} = 'annulee'`;
  if (etat === "tous") return "1 = 1";
  return `${col} NOT IN ('cloturee', 'annulee')`; // actifs (défaut)
}

const LIGNES_SIGNALEMENT = `
  SELECT s.*,
    COALESCE((SELECT json_agg(json_build_object('id', i.id, 'numero', i.numero, 'libelle', i.libelle) ORDER BY i.numero)
              FROM signalements_qualite_indicateurs si JOIN indicateurs i ON i.id = si.indicateur_id
              WHERE si.signalement_id = s.id), '[]'::json) AS indicateurs,
    COALESCE((SELECT json_agg(c.cause ORDER BY c.cause)
              FROM signalements_qualite_causes c WHERE c.signalement_id = s.id), '[]'::json) AS causes,
    (SELECT count(*)::int FROM actions_qualite a WHERE a.signalement_id = s.id) AS nb_actions,
    -- Noms lisibles, conservés même pour un compte désactivé (aucun filtre
    -- sur « actif ») ; les identifiants restent renvoyés.
    r.nom AS responsable_nom, cp.nom AS cree_par_nom, cl.nom AS cloture_par_nom, an.nom AS annulee_par_nom
  FROM signalements_qualite s
  LEFT JOIN utilisateurs r ON r.id = s.responsable_id
  LEFT JOIN utilisateurs cp ON cp.id = s.cree_par
  LEFT JOIN utilisateurs cl ON cl.id = s.cloture_par
  LEFT JOIN utilisateurs an ON an.id = s.annulee_par`;

// ── Preuves liées (Q1-B4) ────────────────────────────────────
// Métadonnées utiles seulement (jamais la description) ; les fichiers
// restent sur Drive, on ne renvoie que leurs liens déjà connus. Une seule
// requête par fiche (pas de N+1). L'indicateur propre de la preuve est
// conservé tel quel (y compris d'une ancienne version du référentiel).
async function preuvesLiees(colonne, id) {
  const { rows } = await query(
    `SELECT p.id, p.titre, p.statut, p.statut_effectif, p.indicateur_id, i.numero AS indicateur,
            i.libelle AS indicateur_libelle, p.session_id, s.reference AS session_reference,
            p.alerte_statut, l.cree_le AS lie_le,
            COALESCE((SELECT json_agg(json_build_object('id', f.id, 'url', f.drive_url, 'nom', f.drive_nom, 'mime', f.drive_mime)
                                ORDER BY f.ajoute_le, f.id)
                      FROM preuve_fichiers f WHERE f.preuve_id = p.id), '[]'::json) AS fichiers
     FROM liens_preuves_qualite l
     JOIN preuves_enrichies p ON p.id = l.preuve_id
     JOIN indicateurs i ON i.id = p.indicateur_id
     LEFT JOIN sessions s ON s.id = p.session_id
     WHERE l.${colonne} = $1
     ORDER BY l.cree_le, l.id`, [id]
  );
  return rows;
}

// ── Utilisateurs actifs (assignation d'une action) ──────────
// Admin uniquement : le contributeur n'a aucun accès à la liste des
// comptes. Champs réduits au strict nécessaire (id, nom, email, rôle) —
// jamais google_sub ni donnée technique.
router.get("/utilisateurs", requireAdmin, wrap(async (_req, res) => {
  const { rows } = await query(
    "SELECT id, nom, email, role FROM utilisateurs WHERE actif ORDER BY nom NULLS LAST, email"
  );
  res.json({ utilisateurs: rows, total: rows.length });
}));

// ── Signalements ──────────────────────────────────────────────

router.get("/signalements", requireAdmin, wrap(async (req, res) => {
  const clauses = [filtreEtat(req.query.etat, "s.statut")];
  const params = [];
  const ajoute = (valeur, cond) => { params.push(valeur); clauses.push(cond.replace("?", `$${params.length}`)); };
  if (TYPES_SIGNALEMENT.includes(req.query.type)) ajoute(req.query.type, "s.type = ?");
  if (STATUTS_SIGNALEMENT.includes(req.query.statut)) ajoute(req.query.statut, "s.statut = ?");
  if (req.query.formation_id) { const n = parseIdPositif(req.query.formation_id); if (!n) return res.status(400).json({ error: "Identifiant de formation invalide." }); ajoute(n, "s.formation_id = ?"); }
  if (req.query.session_id) { const n = parseIdPositif(req.query.session_id); if (!n) return res.status(400).json({ error: "Identifiant de session invalide." }); ajoute(n, "s.session_id = ?"); }
  if (req.query.q?.trim()) ajoute(`%${req.query.q.trim()}%`, "s.objet ILIKE ?");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await query(
    `${LIGNES_SIGNALEMENT} ${where} ORDER BY COALESCE(s.date_constat, s.created_at::date) DESC, s.id DESC LIMIT 500`,
    params
  );
  res.json({ signalements: rows, total: rows.length });
}));

router.get("/signalements/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de signalement invalide." });
  const { rows: [s] } = await query(`${LIGNES_SIGNALEMENT} WHERE s.id = $1`, [id]);
  if (!s) return res.status(404).json({ error: "Signalement introuvable." });
  const { rows: actions } = await query(
    `SELECT id, reference, titre, statut FROM actions_qualite WHERE signalement_id = $1 ORDER BY id`, [id]
  );
  // Historique append-only du signalement (même forme que pour les actions).
  // Les champs sensibles n'y sont journalisés que comme FAIT, sans contenu.
  const { rows: historique } = await query(
    `SELECT h.id, h.evenement, h.champ, h.ancienne_valeur, h.nouvelle_valeur, h.cree_le, h.par,
            u.nom AS acteur_nom
     FROM historique_qualite h
     LEFT JOIN utilisateurs u ON u.id = h.par
     WHERE h.entite_type = 'signalement' AND h.entite_id = $1
     ORDER BY h.id`, [id]
  );
  res.json({ signalement: s, actions, historique, preuves: await preuvesLiees("signalement_qualite_id", id) });
}));

router.post("/signalements", requireAdmin, wrap(async (req, res) => {
  const corps = req.body || {};
  // fix : même règle qu'au PATCH général — la date de résolution ne se pose
  // qu'avec l'action « Résoudre » (refus explicite, rien n'est créé).
  if (Object.prototype.hasOwnProperty.call(corps, "date_resolution")) {
    return res.status(400).json({ error: "La date de résolution se renseigne uniquement avec l'action « Résoudre »." });
  }
  const { champs, erreur } = champsSignalement(corps, {}, { creation: true });
  if (erreur) return res.status(400).json({ error: erreur });
  if (!champs.objet) return res.status(400).json({ error: "Objet obligatoire." });
  const li = lireIndicateurs(corps);
  if (li.erreur) return res.status(400).json({ error: li.erreur });
  const causes = lireCauses(corps);
  if (causes.erreur) return res.status(400).json({ error: causes.erreur });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await verifierIndicateurs(client, li.ids ?? []);
    await verifierResponsable(client, champs.responsable_id);
    await reconcilierInscription(client, champs, {});
    await reconcilierSessionFormation(client, champs, {});
    // Délai cible et échéance : réclamation uniquement, règle conservée
    // SUR LE DOSSIER. Échéance indicative lundi-vendredi.
    if (champs.type === "reclamation" && champs.delai_cible_jours_ouvres === undefined) {
      champs.delai_cible_jours_ouvres = 15;
    }
    if (champs.type === "reclamation" && champs.date_echeance_cible === undefined && champs.date_constat) {
      champs.date_echeance_cible = datePlusJoursOuvres(champs.date_constat, champs.delai_cible_jours_ouvres ?? 15);
    }
    const reference = await referenceSuivante(client, prefixeReference(champs.type));
    const colonnes = ["reference", ...Object.keys(champs), "cree_par"];
    const valeurs = [reference, ...Object.keys(champs).map((c) => champs[c]), req.user.id];
    const { rows: [s] } = await client.query(
      `INSERT INTO signalements_qualite (${colonnes.join(", ")}) VALUES (${colonnes.map((_, i) => "$" + (i + 1)).join(", ")}) RETURNING *`,
      valeurs
    );
    // fix : « creation » journalisée en premier, puis les rattachements initiaux
    // (même transaction).
    await journaliser(client, { entiteType: "signalement", entiteId: s.id, evenement: "creation", champ: "statut", nouvelle: s.statut }, req.user.id);
    await synchroniserIndicateurs(client, "signalements_qualite_indicateurs", "signalement_id", s.id, li.ids ?? [], "signalement", req.user.id);
    await synchroniserCauses(client, s.id, causes.causes ?? [], req.user.id);
    await client.query("COMMIT");
    res.status(201).json({ signalement: s });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.statut400) return res.status(400).json({ error: e.message });
    throw e;
  } finally { client.release(); }
}));

router.patch("/signalements/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de signalement invalide." });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: [avant] } = await client.query("SELECT * FROM signalements_qualite WHERE id = $1", [id]);
    if (!avant) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Signalement introuvable." }); }
    if (avant.statut === "cloturee") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Un signalement clôturé est modifiable uniquement via les workflows autorisés." }); }
    if (avant.statut === "annulee") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Un signalement annulé n'est plus modifiable." }); }
    // fix : la date de résolution ne se pose QUE via /resoudre (jamais
    // ignorée silencieusement : refus explicite).
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "date_resolution")) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "La date de résolution se renseigne uniquement avec l'action « Résoudre »." });
    }
    const { champs, erreur } = champsSignalement(req.body || {}, avant);
    if (erreur) { await client.query("ROLLBACK"); return res.status(400).json({ error: erreur }); }
    const li = lireIndicateurs(req.body || {});
    if (li.erreur) { await client.query("ROLLBACK"); return res.status(400).json({ error: li.erreur }); }
    const causes = lireCauses(req.body || {});
    if (causes.erreur) { await client.query("ROLLBACK"); return res.status(400).json({ error: causes.erreur }); }
    if (!Object.keys(champs).length && li.ids === null && causes.causes === null) {
      await client.query("ROLLBACK"); return res.status(400).json({ error: "Rien à modifier." });
    }
    // fix : invariant « autre » sur l'état FINAL, vérifié avant toute écriture.
    // « autre » présent ⇒ libellé non vide ; « autre » absent ⇒ aucun libellé.
    const causesFinales = causes.causes !== null ? causes.causes
      : (await client.query("SELECT cause FROM signalements_qualite_causes WHERE signalement_id = $1", [id])).rows.map((r) => r.cause);
    const libelleEnvoye = Object.prototype.hasOwnProperty.call(champs, "cause_autre_libelle");
    const libelleFinal = libelleEnvoye ? champs.cause_autre_libelle : avant.cause_autre_libelle;
    if (causesFinales.includes("autre") && !libelleFinal) {
      await client.query("ROLLBACK"); return res.status(400).json({ error: "La cause « autre » doit être explicitée." });
    }
    if (!causesFinales.includes("autre") && libelleEnvoye && champs.cause_autre_libelle) {
      await client.query("ROLLBACK"); return res.status(400).json({ error: "Un libellé « autre » n'est possible que si la cause « autre » est retenue." });
    }
    await verifierIndicateurs(client, li.ids ?? []);
    await verifierResponsable(client, champs.responsable_id);
    await reconcilierInscription(client, champs, avant);
    await reconcilierSessionFormation(client, champs, avant);
    if (Object.keys(champs).length) {
      const params = [id];
      const sets = Object.keys(champs).map((c) => { params.push(champs[c]); return `${c} = $${params.length}`; });
      await client.query(`UPDATE signalements_qualite SET ${sets.join(", ")} WHERE id = $1`, params);
      await journaliserChamps(client, "signalement", id, avant, champs, req.user.id);
    }
    // fix : champ absent (null) = collection inchangée ; [] explicite = vidage.
    await synchroniserIndicateurs(client, "signalements_qualite_indicateurs", "signalement_id", id, li.ids, "signalement", req.user.id);
    await synchroniserCauses(client, id, causes.causes, req.user.id);
    await client.query("COMMIT");
    const { rows: [s] } = await query(`${LIGNES_SIGNALEMENT} WHERE s.id = $1`, [id]);
    res.json({ signalement: s });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.statut400) return res.status(400).json({ error: e.message });
    throw e;
  } finally { client.release(); }
}));

// Transitions de signalement : qualifier / traiter / resoudre /
// cloturer / rouvrir / annuler. Tracées.
async function transitionSignalement(req, res, action) {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant de signalement invalide." });
  const corps = req.body || {};
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: [avant] } = await client.query("SELECT * FROM signalements_qualite WHERE id = $1", [id]);
    if (!avant) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Signalement introuvable." }); }
    const invalide = transitionInvalide(TRANSITIONS_SIGNALEMENT, action, avant.statut);
    if (invalide) { await client.query("ROLLBACK"); return res.status(409).json({ error: invalide }); }

    const vers = TRANSITIONS_SIGNALEMENT[action].vers;
    const champs = { statut: vers };
    const par = req.user.id;
    if (action === "resoudre") {
      const aujourdhui = new Date().toISOString().slice(0, 10);
      const dr = corps.date_resolution === undefined || corps.date_resolution === null || corps.date_resolution === "" ? aujourdhui : corps.date_resolution;
      if (!estDateValide(String(dr).trim())) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Date de résolution invalide : format attendu AAAA-MM-JJ." }); }
      champs.date_resolution = String(dr).trim();
      if (corps.synthese_reponse !== undefined) champs.synthese_reponse = corps.synthese_reponse ? String(corps.synthese_reponse).trim() : null;
      if (corps.date_reponse !== undefined && corps.date_reponse !== null && corps.date_reponse !== "") {
        if (!estDateValide(String(corps.date_reponse).trim())) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Date de réponse invalide : format attendu AAAA-MM-JJ." }); }
        champs.date_reponse = String(corps.date_reponse).trim();
      } else if (corps.date_reponse === "" || corps.date_reponse === null) {
        champs.date_reponse = null;
      }
    }
    if (action === "cloturer") {
      const n = await compterIndicateurs(client, "signalements_qualite_indicateurs", "signalement_id", id);
      if (n === 0) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Au moins un indicateur est requis avant clôture." }); }
      champs.date_cloture = new Date().toISOString().slice(0, 10);
      champs.cloture_par = par;
    }
    if (action === "rouvrir") {
      champs.date_cloture = null;
      champs.cloture_par = null;
    }
    if (action === "annuler") champs.annulee_par = par;

    const params = [id];
    const sets = Object.keys(champs).map((c) => { params.push(champs[c]); return `${c} = $${params.length}`; });
    await client.query(`UPDATE signalements_qualite SET ${sets.join(", ")} WHERE id = $1`, params);
    await journaliser(client, { entiteType: "signalement", entiteId: id, evenement: action, champ: "statut", ancienne: avant.statut, nouvelle: vers }, par);
    await client.query("COMMIT");
    const { rows: [s] } = await query(`${LIGNES_SIGNALEMENT} WHERE s.id = $1`, [id]);
    res.json({ signalement: s });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.statut400) return res.status(400).json({ error: e.message });
    throw e;
  } finally { client.release(); }
}

router.patch("/signalements/:id/qualifier", requireAdmin, wrap((req, res) => transitionSignalement(req, res, "qualifier")));
router.patch("/signalements/:id/traiter", requireAdmin, wrap((req, res) => transitionSignalement(req, res, "traiter")));
router.patch("/signalements/:id/resoudre", requireAdmin, wrap((req, res) => transitionSignalement(req, res, "resoudre")));
router.patch("/signalements/:id/cloturer", requireAdmin, wrap((req, res) => transitionSignalement(req, res, "cloturer")));
router.patch("/signalements/:id/rouvrir", requireAdmin, wrap((req, res) => transitionSignalement(req, res, "rouvrir")));
router.patch("/signalements/:id/annuler", requireAdmin, wrap((req, res) => transitionSignalement(req, res, "annuler")));

// ── Actions qualité ───────────────────────────────────────────

// Libellé neutre du signalement source : jamais l'identité ni le texte
// sensible ne sont exposés à un contributeur.
const LIGNES_ACTION = `
  SELECT a.*,
    s.reference AS signalement_reference,
    s.type AS signalement_type,
    s.objet AS signalement_objet,
    r.nom AS responsable_nom,
    cp.nom AS cree_par_nom,
    cl.nom AS cloture_par_nom,
    an.nom AS annulee_par_nom,
    COALESCE((SELECT json_agg(json_build_object('id', i.id, 'numero', i.numero, 'libelle', i.libelle) ORDER BY i.numero)
              FROM actions_qualite_indicateurs ai JOIN indicateurs i ON i.id = ai.indicateur_id
              WHERE ai.action_id = a.id), '[]'::json) AS indicateurs
  FROM actions_qualite a
  LEFT JOIN signalements_qualite s ON s.id = a.signalement_id
  LEFT JOIN utilisateurs r ON r.id = a.responsable_id
  LEFT JOIN utilisateurs cp ON cp.id = a.cree_par
  LEFT JOIN utilisateurs cl ON cl.id = a.cloture_par
  LEFT JOIN utilisateurs an ON an.id = a.annulee_par`;

function actionPourRole(action, role) {
  if (role === "admin") return action;
  const { signalement_objet, signalement_type, ...reste } = action;
  return { ...reste, signalement_reference: action.signalement_reference || null };
}

router.get("/actions-qualite", requireRedacteur, wrap(async (req, res) => {
  const admin = req.user.role === "admin";
  const clauses = [filtreEtat(req.query.etat, "a.statut")];
  const params = [];
  const ajoute = (valeur, cond) => { params.push(valeur); clauses.push(cond.replace("?", `$${params.length}`)); };
  if (!admin) ajoute(req.user.id, "a.responsable_id = ?"); // contributeur : ses actions seulement
  if (STATUTS_ACTION.includes(req.query.statut)) ajoute(req.query.statut, "a.statut = ?");
  if (PRIORITES.includes(req.query.priorite)) ajoute(req.query.priorite, "a.priorite = ?");
  if (req.query.responsable_id && admin) { const n = parseIdPositif(req.query.responsable_id); if (!n) return res.status(400).json({ error: "Identifiant de responsable invalide." }); ajoute(n, "a.responsable_id = ?"); }
  if (req.query.signalement_id && admin) { const n = parseIdPositif(req.query.signalement_id); if (!n) return res.status(400).json({ error: "Identifiant de signalement invalide." }); ajoute(n, "a.signalement_id = ?"); }
  if (req.query.q?.trim()) ajoute(`%${req.query.q.trim()}%`, "a.titre ILIKE ?");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await query(
    `${LIGNES_ACTION} ${where} ORDER BY COALESCE(a.echeance, a.created_at::date) ASC NULLS LAST, a.id DESC LIMIT 500`,
    params
  );
  res.json({ actions: rows.map((a) => actionPourRole(a, req.user.role)), total: rows.length });
}));

router.get("/actions-qualite/:id", requireRedacteur, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'action invalide." });
  const { rows: [a] } = await query(`${LIGNES_ACTION} WHERE a.id = $1`, [id]);
  if (!a) return res.status(404).json({ error: "Action introuvable." });
  if (req.user.role !== "admin" && a.responsable_id !== req.user.id) {
    return res.status(403).json({ error: "Action non attribuée." });
  }
  // Historique append-only de l'action, avec le nom lisible de l'auteur.
  // Aucun contenu du signalement source n'y transite.
  const { rows: historique } = await query(
    `SELECT h.id, h.evenement, h.champ, h.ancienne_valeur, h.nouvelle_valeur, h.cree_le, h.par,
            u.nom AS acteur_nom
     FROM historique_qualite h
     LEFT JOIN utilisateurs u ON u.id = h.par
     WHERE h.entite_type = 'action' AND h.entite_id = $1
     ORDER BY h.id`, [id]
  );
  // Preuves liées : lisibles par tout utilisateur connecté (comme
  // GET /api/preuves) ; un contributeur ne les voit que sur SON action.
  res.json({ action: actionPourRole(a, req.user.role), historique, preuves: await preuvesLiees("action_qualite_id", id) });
}));

router.post("/actions-qualite", requireAdmin, wrap(async (req, res) => {
  const corps = req.body || {};
  const { champs, erreur } = champsAction(corps);
  if (erreur) return res.status(400).json({ error: erreur });
  if (!champs.titre) return res.status(400).json({ error: "Titre obligatoire." });
  const li = lireIndicateurs(corps);
  if (li.erreur) return res.status(400).json({ error: li.erreur });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await verifierIndicateurs(client, li.ids ?? []);
    await verifierResponsable(client, champs.responsable_id);
    if (champs.signalement_id) await verifierSignalement(client, champs.signalement_id);
    await reconcilierSessionFormation(client, champs, {});
    const reference = await referenceSuivante(client, "AQ");
    const colonnes = ["reference", ...Object.keys(champs), "cree_par"];
    const valeurs = [reference, ...Object.keys(champs).map((c) => champs[c]), req.user.id];
    const { rows: [a] } = await client.query(
      `INSERT INTO actions_qualite (${colonnes.join(", ")}) VALUES (${colonnes.map((_, i) => "$" + (i + 1)).join(", ")}) RETURNING *`,
      valeurs
    );
    // fix : « creation » journalisée en premier, puis les rattachements
    // initiaux (même transaction).
    await journaliser(client, { entiteType: "action", entiteId: a.id, evenement: "creation", champ: "statut", nouvelle: a.statut }, req.user.id);
    await synchroniserIndicateurs(client, "actions_qualite_indicateurs", "action_id", a.id, li.ids ?? [], "action", req.user.id);
    await client.query("COMMIT");
    res.status(201).json({ action: a });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.statut400) return res.status(400).json({ error: e.message });
    throw e;
  } finally { client.release(); }
}));

router.patch("/actions-qualite/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'action invalide." });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: [avant] } = await client.query("SELECT * FROM actions_qualite WHERE id = $1", [id]);
    if (!avant) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Action introuvable." }); }
    if (avant.statut === "cloturee") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Une action clôturée est modifiable uniquement via les workflows autorisés." }); }
    if (avant.statut === "annulee") { await client.query("ROLLBACK"); return res.status(409).json({ error: "Une action annulée n'est plus modifiable." }); }
    const { champs, erreur } = champsAction(req.body || {}, avant);
    if (erreur) { await client.query("ROLLBACK"); return res.status(400).json({ error: erreur }); }
    const li = lireIndicateurs(req.body || {});
    if (li.erreur) { await client.query("ROLLBACK"); return res.status(400).json({ error: li.erreur }); }
    if (!Object.keys(champs).length && li.ids === null) {
      await client.query("ROLLBACK"); return res.status(400).json({ error: "Rien à modifier." });
    }
    await verifierIndicateurs(client, li.ids ?? []);
    await verifierResponsable(client, champs.responsable_id);
    if (champs.signalement_id) await verifierSignalement(client, champs.signalement_id);
    await reconcilierSessionFormation(client, champs, avant);
    if (Object.keys(champs).length) {
      const params = [id];
      const sets = Object.keys(champs).map((c) => { params.push(champs[c]); return `${c} = $${params.length}`; });
      await client.query(`UPDATE actions_qualite SET ${sets.join(", ")} WHERE id = $1`, params);
      await journaliserChamps(client, "action", id, avant, champs, req.user.id);
    }
    // fix : champ absent (null) = indicateurs inchangés ; [] explicite = vidage.
    await synchroniserIndicateurs(client, "actions_qualite_indicateurs", "action_id", id, li.ids, "action", req.user.id);
    await client.query("COMMIT");
    const { rows: [a] } = await query(`${LIGNES_ACTION} WHERE a.id = $1`, [id]);
    res.json({ action: actionPourRole(a, req.user.role) });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.statut400) return res.status(400).json({ error: e.message });
    throw e;
  } finally { client.release(); }
}));

// Transitions d'action. `demarrer` / `realiser` : ouverts au contributeur
// POUR SON action assignée uniquement ; les autres restent admin.
async function transitionAction(req, res, action) {
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: "Identifiant d'action invalide." });
  const corps = req.body || {};
  const admin = req.user.role === "admin";
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: [avant] } = await client.query("SELECT * FROM actions_qualite WHERE id = $1", [id]);
    if (!avant) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Action introuvable." }); }
    if (!admin) {
      // Le contributeur n'agit que sur SON action, dans le périmètre de
      // sa réalisation (démarrer / réaliser). Tout le reste est refusé.
      if (avant.responsable_id !== req.user.id) { await client.query("ROLLBACK"); return res.status(403).json({ error: "Action non attribuée." }); }
      if (!["demarrer", "realiser"].includes(action)) { await client.query("ROLLBACK"); return res.status(403).json({ error: "Réservé aux administrateurs." }); }
    }
    const invalide = transitionInvalide(TRANSITIONS_ACTION, action, avant.statut);
    if (invalide) { await client.query("ROLLBACK"); return res.status(409).json({ error: invalide }); }

    const vers = TRANSITIONS_ACTION[action].vers;
    const champs = { statut: vers };
    const par = req.user.id;
    if (action === "realiser") {
      if (!(corps.resultat || "").trim()) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Le résultat est obligatoire pour réaliser une action." }); }
      champs.resultat = String(corps.resultat).trim();
      if (corps.date_mise_en_oeuvre !== undefined && corps.date_mise_en_oeuvre !== null && corps.date_mise_en_oeuvre !== "") {
        if (!estDateValide(String(corps.date_mise_en_oeuvre).trim())) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Date de mise en œuvre invalide : format attendu AAAA-MM-JJ." }); }
        champs.date_mise_en_oeuvre = String(corps.date_mise_en_oeuvre).trim();
      } else if (corps.date_mise_en_oeuvre === "" || corps.date_mise_en_oeuvre === null) {
        champs.date_mise_en_oeuvre = null;
      }
    }
    if (action === "controle-efficacite") {
      if (!(corps.controle_efficacite || "").trim()) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Le contrôle d'efficacité est obligatoire." }); }
      if (!corps.date_controle_efficacite) { await client.query("ROLLBACK"); return res.status(400).json({ error: "La date de contrôle d'efficacité est obligatoire." }); }
      if (!estDateValide(String(corps.date_controle_efficacite).trim())) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Date de contrôle d'efficacité invalide : format attendu AAAA-MM-JJ." }); }
      champs.controle_efficacite = String(corps.controle_efficacite).trim();
      champs.date_controle_efficacite = String(corps.date_controle_efficacite).trim();
    }
    if (action === "cloturer") {
      const n = await compterIndicateurs(client, "actions_qualite_indicateurs", "action_id", id);
      if (n === 0) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Au moins un indicateur est requis avant clôture." }); }
      champs.date_cloture = new Date().toISOString().slice(0, 10);
      champs.cloture_par = par;
    }
    if (action === "rouvrir") { champs.date_cloture = null; champs.cloture_par = null; }
    if (action === "annuler") champs.annulee_par = par;

    const params = [id];
    const sets = Object.keys(champs).map((c) => { params.push(champs[c]); return `${c} = $${params.length}`; });
    await client.query(`UPDATE actions_qualite SET ${sets.join(", ")} WHERE id = $1`, params);
    await journaliser(client, { entiteType: "action", entiteId: id, evenement: action, champ: "statut", ancienne: avant.statut, nouvelle: vers }, par);
    if (action === "realiser" && champs.resultat !== undefined && champs.resultat !== (avant.resultat ?? null)) {
      await journaliser(client, { entiteType: "action", entiteId: id, evenement: "modification", champ: "resultat" }, par);
    }
    if (action === "realiser" && champs.date_mise_en_oeuvre !== undefined && String(champs.date_mise_en_oeuvre ?? null) !== String(avant.date_mise_en_oeuvre ?? null)) {
      await journaliser(client, { entiteType: "action", entiteId: id, evenement: "modification", champ: "date_mise_en_oeuvre", ancienne: avant.date_mise_en_oeuvre ?? null, nouvelle: champs.date_mise_en_oeuvre ?? null }, par);
    }
    if (action === "controle-efficacite") {
      await journaliser(client, { entiteType: "action", entiteId: id, evenement: "modification", champ: "controle_efficacite" }, par);
      await journaliser(client, { entiteType: "action", entiteId: id, evenement: "modification", champ: "date_controle_efficacite", ancienne: avant.date_controle_efficacite ?? null, nouvelle: champs.date_controle_efficacite }, par);
    }
    await client.query("COMMIT");
    const { rows: [a] } = await query(`${LIGNES_ACTION} WHERE a.id = $1`, [id]);
    res.json({ action: actionPourRole(a, req.user.role) });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.statut400) return res.status(400).json({ error: e.message });
    throw e;
  } finally { client.release(); }
}

router.patch("/actions-qualite/:id/demarrer", requireRedacteur, wrap((req, res) => transitionAction(req, res, "demarrer")));
router.patch("/actions-qualite/:id/realiser", requireRedacteur, wrap((req, res) => transitionAction(req, res, "realiser")));
router.patch("/actions-qualite/:id/controle-efficacite", requireAdmin, wrap((req, res) => transitionAction(req, res, "controle-efficacite")));
router.patch("/actions-qualite/:id/cloturer", requireAdmin, wrap((req, res) => transitionAction(req, res, "cloturer")));
router.patch("/actions-qualite/:id/rouvrir", requireAdmin, wrap((req, res) => transitionAction(req, res, "rouvrir")));
router.patch("/actions-qualite/:id/annuler", requireAdmin, wrap((req, res) => transitionAction(req, res, "annuler")));

// ── Liens preuve ↔ action / signalement (Q1-B4) ──────────────
// Admin uniquement. Seule la RELATION est créée ou retirée : jamais la
// preuve, jamais un fichier ni un dossier Drive, jamais son indicateur.
// Même règle de modifiabilité que le PATCH de l'objet (clôturé / annulé :
// 409). Chaque lien est tracé dans l'historique (identifiant seul).
const CIBLES_LIEN = {
  action: { table: "actions_qualite", colonne: "action_qualite_id", libelle: "Action", feminin: true },
  signalement: { table: "signalements_qualite", colonne: "signalement_qualite_id", libelle: "Signalement", feminin: false },
};

async function lierPreuve(req, res, type) {
  const cible = CIBLES_LIEN[type];
  const id = parseIdPositif(req.params.id);
  if (!id) return res.status(400).json({ error: `Identifiant ${type === "action" ? "d'action" : "de signalement"} invalide.` });
  const preuveId = parseIdPositif(req.body?.preuve_id);
  if (!preuveId) return res.status(400).json({ error: "Identifiant de preuve invalide." });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: [objet] } = await client.query(`SELECT statut FROM ${cible.table} WHERE id = $1 FOR UPDATE`, [id]);
    if (!objet) { await client.query("ROLLBACK"); return res.status(404).json({ error: `${cible.libelle} introuvable${cible.feminin ? "e" : ""}.` }); }
    if (objet.statut === "cloturee" || objet.statut === "annulee") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `${cible.libelle} ${objet.statut === "cloturee" ? "clôturé" : "annulé"}${cible.feminin ? "e" : ""} : les preuves liées ne sont plus modifiables.` });
    }
    const { rows: [preuve] } = await client.query("SELECT id FROM preuves WHERE id = $1", [preuveId]);
    if (!preuve) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Preuve introuvable." }); }
    const { rowCount } = await client.query(
      `INSERT INTO liens_preuves_qualite (preuve_id, ${cible.colonne}, cree_par) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [preuveId, id, req.user.id]
    );
    if (!rowCount) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Cette preuve est déjà liée." }); }
    await journaliser(client, { entiteType: type, entiteId: id, evenement: "preuve_rattachee", champ: "preuve_id", nouvelle: String(preuveId) }, req.user.id);
    await client.query("COMMIT");
    res.status(201).json({ preuves: await preuvesLiees(cible.colonne, id) });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally { client.release(); }
}

async function delierPreuve(req, res, type) {
  const cible = CIBLES_LIEN[type];
  const id = parseIdPositif(req.params.id);
  const preuveId = parseIdPositif(req.params.preuveId);
  if (!id || !preuveId) return res.status(400).json({ error: "Identifiant invalide." });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: [objet] } = await client.query(`SELECT statut FROM ${cible.table} WHERE id = $1 FOR UPDATE`, [id]);
    if (!objet) { await client.query("ROLLBACK"); return res.status(404).json({ error: `${cible.libelle} introuvable${cible.feminin ? "e" : ""}.` }); }
    if (objet.statut === "cloturee" || objet.statut === "annulee") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `${cible.libelle} ${objet.statut === "cloturee" ? "clôturé" : "annulé"}${cible.feminin ? "e" : ""} : les preuves liées ne sont plus modifiables.` });
    }
    // Uniquement la relation : la preuve et ses fichiers Drive sont intacts.
    const { rowCount } = await client.query(
      `DELETE FROM liens_preuves_qualite WHERE preuve_id = $1 AND ${cible.colonne} = $2`, [preuveId, id]
    );
    if (!rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Cette preuve n'est pas liée." }); }
    await journaliser(client, { entiteType: type, entiteId: id, evenement: "preuve_detachee", champ: "preuve_id", ancienne: String(preuveId) }, req.user.id);
    await client.query("COMMIT");
    res.json({ preuves: await preuvesLiees(cible.colonne, id) });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally { client.release(); }
}

router.post("/actions-qualite/:id/preuves", requireAdmin, wrap((req, res) => lierPreuve(req, res, "action")));
router.post("/signalements/:id/preuves", requireAdmin, wrap((req, res) => lierPreuve(req, res, "signalement")));
router.delete("/actions-qualite/:id/preuves/:preuveId", requireAdmin, wrap((req, res) => delierPreuve(req, res, "action")));
router.delete("/signalements/:id/preuves/:preuveId", requireAdmin, wrap((req, res) => delierPreuve(req, res, "signalement")));

export default router;
