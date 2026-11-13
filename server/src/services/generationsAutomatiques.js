// Génération automatique et conditionnelle des documents.
//
// Les événements métier (création de session, inscription, début et fin de session) déposent
// des tâches dans `generations_planifiees` ; une file traitée en arrière-plan les exécute avec
// le moteur de génération manuel, en mode « complément » : seuls les documents manquants sont
// produits, un document existant n'est jamais remplacé ni supprimé.
//
// Règles :
//  · une tâche en attente par modèle × session × événement (index unique) ;
//  · création, début et fin de session : une seule tâche par modèle et session, jamais rejouée ;
//  · les déclenchements par date ne remontent jamais avant l'activation du déclencheur
//    (declencheur_actif_depuis) : aucun rattrapage massif des sessions passées ;
//  · génération sans droits administrateur : un modèle utilisant une donnée restreinte est
//    bloqué et reste à générer manuellement par un administrateur ;
//  · Drive non connecté : la tâche reste en attente ; autre échec (y compris Google
//    momentanément indisponible) : nouvel essai différé, bloquée après MAX_TENTATIVES ;
//  · modèle désactivé ou repassé en manuel, session annulée ou archivée : sans objet.
import { query } from "../db.js";
import { genererDocuments } from "./documents.js";
import { FUSEAU_METIER } from "./dates.js";

export const EVENEMENTS = ["creation_session", "inscription", "debut_session", "fin_session"];
export const MAX_TENTATIVES = 5;
const BAIL_MINUTES = 10;
// Nouvel essai après un échec (Google momentanément indisponible…) : 15, 30, 45, 60 min.
const DELAI_REESSAI_MINUTES = 15;
const INTERVALLE_MS = 15 * 60_000;
// Événements ponctuels : une seule tâche par modèle et session, quel que soit son sort.
const UNIQUES = new Set(["creation_session", "debut_session", "fin_session"]);

// Stagiaires de la session (hors abandons) remplissant la condition métier d'un modèle conditionnel.
const CONDITIONS_SQL = {
  situation_handicap: "s.situation_handicap",
  besoin_adaptation: `(btrim(COALESCE(s.besoins_adaptation, '')) <> ''
                       OR EXISTS (SELECT 1 FROM adaptations_parcours a WHERE a.inscription_id = i.id))`,
  prescripteur_renseigne: "i.prescripteur IS NOT NULL",
};

export async function stagiairesConcernes(conditionCode, sessionId) {
  const condition = CONDITIONS_SQL[conditionCode];
  if (!condition) throw new Error("Condition de génération inconnue.");
  const { rows } = await query(
    `SELECT s.id FROM inscriptions i JOIN stagiaires s ON s.id = i.stagiaire_id
     WHERE i.session_id = $1 AND i.statut <> 'abandon' AND ${condition}`,
    [sessionId]
  );
  return new Set(rows.map((r) => r.id));
}

// Dépose les tâches des modèles dont le déclencheur correspond à l'événement. Renvoie le nombre
// de tâches créées. N'échoue jamais la requête appelante : l'appelant journalise.
export async function planifier(evenement, sessionId) {
  if (!EVENEMENTS.includes(evenement)) throw new Error("Événement de génération inconnu.");
  const { rowCount } = await query(
    `INSERT INTO generations_planifiees (modele_id, session_id, evenement)
     SELECT m.id, s.id, $2
     FROM modeles_documents m JOIN sessions s ON s.id = $1
     WHERE m.actif AND m.mode_generation <> 'manuel' AND m.declencheur = $2
       AND s.statut <> 'annulee' AND s.archivee_le IS NULL
       AND ($3::boolean IS NOT TRUE OR NOT EXISTS (
         SELECT 1 FROM generations_planifiees g
         WHERE g.modele_id = m.id AND g.session_id = s.id AND g.evenement = $2))
     ON CONFLICT (modele_id, session_id, evenement) WHERE statut = 'en_attente' DO NOTHING`,
    [sessionId, evenement, UNIQUES.has(evenement)]
  );
  return rowCount;
}

// Événement métier depuis une route : planifie puis réveille la file, sans jamais faire échouer
// la requête (une planification perdue est rattrapée par le balayage périodique, sauf inscription).
export async function signalerEvenement(evenement, sessionId) {
  try {
    if (await planifier(evenement, sessionId)) reveiller();
  } catch (e) {
    console.error(`Génération automatique : planification « ${evenement} » impossible pour la session ${sessionId} : ${e.message}`);
  }
}

// Balayage : création, début et fin de session survenus APRÈS l'activation du déclencheur et
// pas encore planifiés. Les dates métier sont évaluées dans le fuseau de l'organisme.
export async function planifierParDates({ aujourdhui = null } = {}) {
  const { rowCount } = await query(
    `WITH jour AS (SELECT COALESCE($1::date, (now() AT TIME ZONE $2)::date) AS j)
     INSERT INTO generations_planifiees (modele_id, session_id, evenement)
     SELECT m.id, s.id, m.declencheur
     FROM modeles_documents m CROSS JOIN jour
     JOIN sessions s ON s.statut <> 'annulee' AND s.archivee_le IS NULL
     WHERE m.actif AND m.mode_generation <> 'manuel' AND m.declencheur_actif_depuis IS NOT NULL
       AND (
         (m.declencheur = 'creation_session' AND s.created_at >= m.declencheur_actif_depuis)
         OR (m.declencheur = 'debut_session' AND s.date_debut <= jour.j
             AND s.date_debut >= (m.declencheur_actif_depuis AT TIME ZONE $2)::date)
         OR (m.declencheur = 'fin_session' AND s.date_fin <= jour.j
             AND s.date_fin >= (m.declencheur_actif_depuis AT TIME ZONE $2)::date)
       )
       AND NOT EXISTS (SELECT 1 FROM generations_planifiees g
                       WHERE g.modele_id = m.id AND g.session_id = s.id AND g.evenement = m.declencheur)
     ON CONFLICT (modele_id, session_id, evenement) WHERE statut = 'en_attente' DO NOTHING`,
    [aujourdhui, FUSEAU_METIER]
  );
  return rowCount;
}

// Réserve la prochaine tâche exécutable (bail : une tâche n'est jamais traitée deux fois en parallèle).
async function reserver() {
  const { rows: [tache] } = await query(
    `UPDATE generations_planifiees SET bail_jusqu_au = now() + make_interval(mins => $1)
     WHERE id = (SELECT id FROM generations_planifiees
                 WHERE statut = 'en_attente' AND (bail_jusqu_au IS NULL OR bail_jusqu_au < now())
                 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING *`,
    [BAIL_MINUTES]
  );
  return tache || null;
}

async function clore(id, statut, { documents = null, resultat = null, erreur = null, tentatives = null } = {}) {
  await query(
    `UPDATE generations_planifiees SET statut = $2, documents = $3, resultat = $4,
       derniere_erreur = CASE WHEN $2 = 'faite' THEN NULL ELSE COALESCE($5, derniere_erreur) END,
       tentatives = COALESCE($6, tentatives), traite_le = now(), bail_jusqu_au = NULL
     WHERE id = $1`,
    [id, statut, documents, resultat, erreur, tentatives]
  );
}

// Message d'échec sûr : une erreur SQL n'expose jamais son détail.
function messageSur(e) {
  if (typeof e?.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return "Erreur interne lors de la génération.";
  if (e?.precontrole) {
    const details = (e.precontrole.erreurs || []).map((x) => x.message).filter(Boolean);
    return [e.message, ...details].join(" ").slice(0, 1000);
  }
  return String(e?.message || "Erreur inconnue.").slice(0, 1000);
}

function resume(r) {
  const parts = [`${r.documents} document(s) produit(s)`];
  if (r.marqueursNonResolus?.length) parts.push(`marqueurs non résolus : ${r.marqueursNonResolus.join(", ")}`);
  if (r.marqueursInconnus?.length) parts.push(`marqueurs inconnus : ${r.marqueursInconnus.join(", ")}`);
  return parts.join(" ; ") + ".";
}

// Exécute une tâche réservée. Renvoie "drive" quand Google est indisponible (la file s'arrête).
async function executer(tache, { client }) {
  const { rows: [m] } = await query(
    "SELECT id, actif, portee, mode_generation, declencheur, condition_code FROM modeles_documents WHERE id = $1",
    [tache.modele_id]
  );
  const { rows: [s] } = await query("SELECT id, statut, archivee_le FROM sessions WHERE id = $1", [tache.session_id]);
  if (!m || !m.actif || m.mode_generation === "manuel" || !m.declencheur) {
    return clore(tache.id, "sans_objet", { resultat: "Modèle désactivé ou génération automatique retirée." });
  }
  if (!s || s.statut === "annulee" || s.archivee_le) {
    return clore(tache.id, "sans_objet", { resultat: "Session annulée ou archivée." });
  }

  let filtre = null;
  if (m.mode_generation === "conditionnel") {
    if (!m.condition_code) return clore(tache.id, "sans_objet", { resultat: "Condition non configurée." });
    const concernes = await stagiairesConcernes(m.condition_code, s.id);
    if (!concernes.size) return clore(tache.id, "sans_objet", { documents: 0, resultat: "Condition non remplie : aucun stagiaire concerné." });
    filtre = (stagiaire) => concernes.has(stagiaire?.id);
  }

  try {
    const r = await genererDocuments({
      modeleId: m.id, sessionId: s.id, completer: true, filtre,
      admin: false, utilisateurId: null, planificationId: tache.id, client,
    });
    if (r.rien) return clore(tache.id, "faite", { documents: 0, resultat: "Rien à produire : documents déjà présents ou aucun stagiaire concerné." });
    return clore(tache.id, "faite", { documents: r.documents, resultat: resume(r) });
  } catch (e) {
    const message = messageSur(e);
    // Drive non connecté ou génération manuelle en cours : la tâche reste en attente, sans pénalité.
    if (e?.driveAbsent || e?.genEnCours) {
      await query(
        `UPDATE generations_planifiees SET derniere_erreur = $2,
           bail_jusqu_au = now() + interval '5 minutes' WHERE id = $1`,
        [tache.id, message]
      );
      return e?.driveAbsent ? "drive" : null;
    }
    // Refus du précontrôle (donnée restreinte, modèle illisible…) : ne se corrigera pas seul.
    const tentatives = tache.tentatives + 1;
    if (e?.precontrole || tentatives >= MAX_TENTATIVES) {
      return clore(tache.id, "bloquee", { erreur: message, tentatives, resultat: "Génération bloquée : à traiter manuellement." });
    }
    await query(
      `UPDATE generations_planifiees SET tentatives = $2, derniere_erreur = $3,
         bail_jusqu_au = now() + make_interval(mins => $4) WHERE id = $1`,
      [tache.id, tentatives, message, DELAI_REESSAI_MINUTES * tentatives]
    );
    return null;
  }
}

// Traite les tâches exécutables, une par une. `client` : client Google (tests).
export async function traiterFile({ client = null, limite = 20 } = {}) {
  const traitees = [];
  for (let i = 0; i < limite; i++) {
    const tache = await reserver();
    if (!tache) break;
    traitees.push(tache.id);
    if ((await executer(tache, { client })) === "drive") break;
  }
  return traitees;
}

// Remise en file d'une tâche bloquée ou en attente (administrateur) : compteur remis à zéro.
export async function relancer(id) {
  const { rows: [t] } = await query(
    `UPDATE generations_planifiees SET statut = 'en_attente', tentatives = 0, bail_jusqu_au = NULL, traite_le = NULL
     WHERE id = $1 AND statut IN ('bloquee', 'en_attente') RETURNING id`,
    [id]
  ).catch((e) => {
    if (e.code === "23505") return { rows: [] };
    throw e;
  });
  if (t) reveiller();
  return Boolean(t);
}

// ── Ordonnanceur ────────────────────────────────────────────
let actif = false;
let minuteur = null;
let cycleEnCours = null;
let redemande = false;

async function cycle() {
  try {
    await planifierParDates();
    await traiterFile();
  } catch (e) {
    console.error("Génération automatique : cycle interrompu : " + e.message);
  }
}

export function reveiller() {
  if (!actif) return;
  if (cycleEnCours) { redemande = true; return; }
  cycleEnCours = cycle().finally(() => {
    cycleEnCours = null;
    if (redemande) { redemande = false; reveiller(); }
  });
}

export function demarrerGenerationsAutomatiques({ intervalleMs = INTERVALLE_MS } = {}) {
  if (actif) return;
  actif = true;
  minuteur = setInterval(reveiller, intervalleMs);
  minuteur.unref();
  reveiller();
}

export async function arreterGenerationsAutomatiques() {
  actif = false;
  if (minuteur) clearInterval(minuteur);
  minuteur = null;
  if (cycleEnCours) await cycleEnCours;
}

// Exposé pour les routes : tâches d'une session, les plus récentes d'abord.
export async function tachesDeSession(sessionId) {
  const { rows } = await query(
    `SELECT g.id, g.modele_id, m.nom AS modele, m.portee, m.mode_generation, g.evenement, g.statut,
            g.tentatives, g.documents, g.resultat, g.derniere_erreur, g.cree_le, g.traite_le
     FROM generations_planifiees g JOIN modeles_documents m ON m.id = g.modele_id
     WHERE g.session_id = $1 ORDER BY g.cree_le DESC, g.id DESC`,
    [sessionId]
  );
  return rows;
}
