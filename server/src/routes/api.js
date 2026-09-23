import { Router } from "express";
import { config, googleConfigured } from "../config.js";
import { getPool, query } from "../db.js";
import { requireAdmin, requireAuth } from "../session.js";
import { disconnectDrive, driveStatus, getDrive } from "../services/google.js";
import { importerClasseur } from "../services/import.js";
import { champsAudit } from "../services/audits.js";

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Statut agrégé d'un indicateur, à partir de ses preuves :
//   vert  — toutes maîtrisées
//   orange— au moins une à consolider, aucune à risque
//   rouge — au moins une à risque, ou aucune preuve
//   gris  — toutes non applicables, OU marqué non applicable à la main
// Les preuves non applicables sont neutres : elles ne dégradent ni
// n'améliorent un indicateur qui en a d'autres. Le marquage manuel, lui,
// l'emporte sur tout : un indicateur ainsi marqué passe gris quelles que
// soient ses preuves — voir indicateurs_non_applicables.
// On agrège sur `statut_effectif`, qui fait redescendre une preuve
// maîtrisée mais incomplète (fichiers manquants) à « à consolider ».
const STATUT_SQL = `
  CASE
    WHEN na.indicateur_id IS NOT NULL THEN 'non_applicable'
    WHEN count(p.id) = 0 THEN 'a_risque'
    WHEN count(p.id) FILTER (WHERE p.statut_effectif <> 'non_applicable') = 0 THEN 'non_applicable'
    WHEN count(p.id) FILTER (WHERE p.statut_effectif = 'a_risque') > 0 THEN 'a_risque'
    WHEN count(p.id) FILTER (WHERE p.statut_effectif = 'a_consolider') > 0 THEN 'a_consolider'
    ELSE 'maitrise'
  END`;

router.get("/health", wrap(async (_req, res) => {
  await query("SELECT 1");
  res.json({ ok: true });
}));

router.get("/me", (req, res) => {
  res.json({ user: req.user, googleConfigured: googleConfigured(), driveAccountEmail: config.driveAccountEmail });
});

// Référentiel actif + tableau de bord de conformité.
router.get("/referentiel", requireAuth, wrap(async (_req, res) => {
  const { rows: [version] } = await query(
    "SELECT id, code, libelle, date_publication, date_application, source, note FROM referentiel_versions WHERE est_active"
  );
  if (!version) return res.status(404).json({ error: "Aucun référentiel actif en base." });
  const [{ rows: criteres }, { rows: indicateurs }] = await Promise.all([
    query("SELECT id, numero, libelle FROM criteres WHERE version_id = $1 ORDER BY numero", [version.id]),
    query(
      `SELECT i.id, i.critere_id, i.numero, i.libelle, i.type, i.categories, i.gradation, i.texte_source_verifie,
              count(p.id)::int AS nb_preuves,
              count(p.id) FILTER (WHERE p.a_confirmer)::int AS nb_a_confirmer,
              count(p.id) FILTER (WHERE p.incomplet)::int AS nb_incomplets,
              count(p.id) FILTER (WHERE p.statut_effectif = 'maitrise')::int AS nb_maitrise,
              count(p.id) FILTER (WHERE p.statut_effectif = 'a_consolider')::int AS nb_a_consolider,
              count(p.id) FILTER (WHERE p.statut_effectif = 'a_risque')::int AS nb_a_risque,
              count(p.id) FILTER (WHERE p.statut_effectif = 'non_applicable')::int AS nb_non_applicable,
              na.indicateur_id IS NOT NULL AS non_applicable_force,
              na.motif AS non_applicable_motif,
              ${STATUT_SQL} AS statut
       FROM indicateurs i
       LEFT JOIN preuves_enrichies p ON p.indicateur_id = i.id
       LEFT JOIN indicateurs_non_applicables na ON na.indicateur_id = i.id
       WHERE i.version_id = $1
       GROUP BY i.id, na.indicateur_id, na.motif ORDER BY i.numero`,
      [version.id]
    ),
  ]);
  const parStatut = indicateurs.reduce((a, i) => ({ ...a, [i.statut]: (a[i.statut] || 0) + 1 }), {});
  res.json({
    version,
    totalIndicateurs: indicateurs.length,
    score: {
      total: indicateurs.length,
      maitrise: parStatut.maitrise || 0,
      a_consolider: parStatut.a_consolider || 0,
      a_risque: parStatut.a_risque || 0,
      non_applicable: parStatut.non_applicable || 0,
      preuves: indicateurs.reduce((n, i) => n + i.nb_preuves, 0),
      a_confirmer: indicateurs.reduce((n, i) => n + i.nb_a_confirmer, 0),
      incomplets: indicateurs.reduce((n, i) => n + i.nb_incomplets, 0),
    },
    criteres: criteres.map((c) => ({ ...c, indicateurs: indicateurs.filter((i) => i.critere_id === c.id) })),
  });
}));

// Liste légère des indicateurs du référentiel ACTIF, pour le rattachement
// d'un document externe (EduSign / Drive) depuis le détail d'une session.
router.get("/indicateurs", requireAuth, wrap(async (_req, res) => {
  const { rows } = await query(
    `SELECT i.id, i.numero, i.libelle FROM indicateurs i
     JOIN referentiel_versions v ON v.id = i.version_id AND v.est_active
     ORDER BY i.numero`
  );
  res.json({ indicateurs: rows, total: rows.length });
}));

// Marque ou réactive un indicateur, indépendamment de ses preuves.
// Réversible : la ligne existe ou non dans indicateurs_non_applicables.
router.patch("/indicateurs/:id/non-applicable", requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { non_applicable, motif } = req.body || {};
  if (typeof non_applicable !== "boolean") {
    return res.status(400).json({ error: "Le champ non_applicable (true/false) est requis." });
  }
  const { rowCount: existe } = await query("SELECT 1 FROM indicateurs WHERE id = $1", [id]);
  if (!existe) return res.status(404).json({ error: "Indicateur introuvable." });

  if (non_applicable) {
    await query(
      `INSERT INTO indicateurs_non_applicables (indicateur_id, motif, marquee_par)
       VALUES ($1, $2, $3)
       ON CONFLICT (indicateur_id) DO UPDATE SET
         motif = EXCLUDED.motif, marquee_par = EXCLUDED.marquee_par, marquee_le = now()`,
      [id, motif || null, req.user.id]
    );
  } else {
    await query("DELETE FROM indicateurs_non_applicables WHERE indicateur_id = $1", [id]);
  }
  res.json({ ok: true, non_applicable });
}));

// ── Preuves ──────────────────────────────────────────────────
const STATUTS = ["maitrise", "a_consolider", "a_risque", "non_applicable"];

router.get("/preuves", requireAuth, wrap(async (req, res) => {
  const filtres = ["1 = 1"];
  const params = [];
  if (req.query.statut && STATUTS.includes(req.query.statut)) { params.push(req.query.statut); filtres.push(`p.statut = $${params.length}`); }
  if (req.query.indicateur) { params.push(Number(req.query.indicateur)); filtres.push(`i.numero = $${params.length}`); }
  if (req.query.a_confirmer === "1") filtres.push("p.a_confirmer");
  if (req.query.alerte && ["perime", "bientot"].includes(req.query.alerte)) {
    params.push(req.query.alerte); filtres.push(`p.alerte_statut = $${params.length}`);
  }
  if (req.query.q) { params.push(`%${req.query.q}%`); filtres.push(`p.titre ILIKE $${params.length}`); }
  if (req.query.session) { params.push(Number(req.query.session)); filtres.push(`p.session_id = $${params.length}`); }
  const { rows } = await query(
    `SELECT p.id, p.titre, p.description, p.indicateur_id, p.statut, p.statut_effectif, p.a_confirmer,
            p.motif_confirmation, p.candidats,
            p.modele_nom, p.tache, p.etat_source, p.occurrences, p.lignes_source,
            p.source, p.validee_le, p.mode_fichiers, p.session_id, p.groupe_id,
            p.nb_fichiers, p.fichiers_attendus, p.incomplet,
            p.type_alerte, p.periodicite_mois, p.date_echeance, p.date_derniere_revision, p.alerte_statut,
            i.numero AS indicateur, c.numero AS critere,
            s.reference AS session_reference, g.nom AS groupe_nom,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'id', f.id, 'drive_file_id', f.drive_file_id, 'url', f.drive_url,
                        'nom', f.drive_nom, 'mime', f.drive_mime, 'source', f.source)
                      ORDER BY f.ajoute_le, f.id)
               FROM preuve_fichiers f WHERE f.preuve_id = p.id),
              '[]'::json) AS fichiers
     FROM preuves_enrichies p
     JOIN indicateurs i ON i.id = p.indicateur_id
     JOIN criteres c ON c.id = i.critere_id
     JOIN referentiel_versions v ON v.id = i.version_id AND v.est_active
     LEFT JOIN sessions s ON s.id = p.session_id
     LEFT JOIN groupes g ON g.id = p.groupe_id
     WHERE ${filtres.join(" AND ")}
     ORDER BY p.a_confirmer DESC, p.incomplet DESC, i.numero, p.titre
     LIMIT 1000`,
    params
  );
  res.json({ preuves: rows, total: rows.length });
}));

// Une seule preuve, telle que la liste la renvoie : sert à rafraîchir une
// ligne après modification, sans recharger tout l'écran.
router.get("/preuves/:id", requireAuth, wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT p.id, p.titre, p.description, p.indicateur_id, p.statut, p.statut_effectif, p.a_confirmer,
            p.motif_confirmation, p.candidats,
            p.modele_nom, p.tache, p.etat_source, p.occurrences, p.lignes_source,
            p.source, p.validee_le, p.mode_fichiers, p.session_id, p.groupe_id,
            p.nb_fichiers, p.fichiers_attendus, p.incomplet,
            p.type_alerte, p.periodicite_mois, p.date_echeance, p.date_derniere_revision, p.alerte_statut,
            i.numero AS indicateur, c.numero AS critere,
            s.reference AS session_reference, g.nom AS groupe_nom,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'id', f.id, 'drive_file_id', f.drive_file_id, 'url', f.drive_url,
                        'nom', f.drive_nom, 'mime', f.drive_mime, 'source', f.source)
                      ORDER BY f.ajoute_le, f.id)
               FROM preuve_fichiers f WHERE f.preuve_id = p.id),
              '[]'::json) AS fichiers
     FROM preuves_enrichies p
     JOIN indicateurs i ON i.id = p.indicateur_id
     JOIN criteres c ON c.id = i.critere_id
     LEFT JOIN sessions s ON s.id = p.session_id
     LEFT JOIN groupes g ON g.id = p.groupe_id
     WHERE p.id = $1`,
    [Number(req.params.id)]
  );
  if (!rows.length) return res.status(404).json({ error: "Preuve introuvable." });
  res.json({ preuve: rows[0] });
}));

// Sessions disponibles pour rattacher une preuve, avec le nombre d'inscrits
// qui servira de nombre attendu en mode « par stagiaire ».
router.get("/sessions", requireAuth, wrap(async (_req, res) => {
  const { rows } = await query(
    `SELECT s.id, s.reference, s.date_debut, s.date_fin, s.statut, s.lieu, s.horaire,
            f.intitule AS formation,
            (SELECT count(*)::int FROM inscriptions i WHERE i.session_id = s.id AND i.statut <> 'abandon') AS nb_inscrits,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'id', g.id, 'nom', g.nom,
                        'nb_inscrits', (SELECT count(*)::int FROM inscriptions i2
                                        WHERE i2.groupe_id = g.id AND i2.statut <> 'abandon'))
                      ORDER BY g.nom)
               FROM groupes g WHERE g.session_id = s.id),
              '[]'::json) AS groupes
     FROM sessions s
     JOIN formations f ON f.id = s.formation_id
     ORDER BY s.date_debut DESC, s.id DESC
     LIMIT 500`
  );
  res.json({ sessions: rows, total: rows.length });
}));

const MODES = ["unique", "multiple", "par_stagiaire"];
const lienDrive = (fileId) => `https://drive.google.com/file/d/${fileId}/view`;
const TYPES_ALERTE = ["revision_periodique", "echeance_fixe", "rupture_reglementaire"];
const ETAT_APRES = `SELECT statut, statut_effectif, mode_fichiers, nb_fichiers, fichiers_attendus, incomplet,
                           type_alerte, periodicite_mois, date_echeance, date_derniere_revision, alerte_statut
                    FROM preuves_enrichies WHERE id = $1`;

// Créer une preuve à la main : un document qui vit déjà sur le Drive et
// qu'on rattache à un ou plusieurs indicateurs (export EduSign, convention,
// habilitation, justificatif…). Ces preuves n'existaient jusqu'ici que par
// l'import du classeur ou par la génération documentaire.
//
// Un document partagé par N indicateurs donne N preuves DISTINCTES qui
// pointent sur le même fichier : le schéma reste tel quel (une preuve =
// un indicateur), et chaque indicateur garde son propre statut, sa propre
// échéance et son propre comptage.
//
// Le fichier est facultatif : une preuve sans fichier est un état normal
// du modèle (voir « À risque » et le comptage « 0/12 rattaché(s) »), et
// l'écran permet de le rattacher ensuite.
router.post("/preuves", requireAdmin, wrap(async (req, res) => {
  const {
    indicateur_id, indicateur_ids, titre, description, statut, mode_fichiers,
    drive_file_id, drive_url, drive_nom, drive_mime,
    type_alerte, periodicite_mois, date_echeance, session_id, groupe_id,
  } = req.body || {};

  if (!titre?.trim()) return res.status(400).json({ error: "Titre obligatoire." });
  if (statut !== undefined && !STATUTS.includes(statut)) return res.status(400).json({ error: "Statut inconnu." });
  if (mode_fichiers !== undefined && !MODES.includes(mode_fichiers)) {
    return res.status(400).json({ error: "Mode de fichiers inconnu." });
  }
  if (type_alerte !== undefined && type_alerte !== null && !TYPES_ALERTE.includes(type_alerte)) {
    return res.status(400).json({ error: "Type d'échéance inconnu." });
  }
  if (type_alerte === "revision_periodique" && !periodicite_mois) {
    return res.status(400).json({ error: "Indiquez la périodicité en mois." });
  }
  if (type_alerte === "echeance_fixe" && !date_echeance) {
    return res.status(400).json({ error: "Indiquez la date d'échéance." });
  }

  // `indicateur_ids` fait foi ; `indicateur_id` reste accepté pour un appel
  // simple. Les doublons sont retirés : un même indicateur ne reçoit qu'une
  // preuve, jamais deux dans le même appel.
  const demandes = (Array.isArray(indicateur_ids) ? indicateur_ids : [indicateur_id])
    .map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const ids = [...new Set(demandes)];
  if (!ids.length) return res.status(400).json({ error: "Indiquez au moins un indicateur." });

  // Rattachement à une session / un groupe : existence vérifiée, et un
  // groupe fourni doit appartenir à la session fournie — sinon on créerait
  // une pièce silencieusement rattachée à un mauvais groupe.
  const sid = session_id !== undefined && session_id !== null ? Number(session_id) : null;
  const gid = groupe_id !== undefined && groupe_id !== null ? Number(groupe_id) : null;
  if (sid !== null) {
    const { rowCount } = await query("SELECT 1 FROM sessions WHERE id = $1", [sid]);
    if (!rowCount) return res.status(400).json({ error: "Session introuvable." });
  }
  if (gid !== null) {
    const { rows: [groupe] } = await query("SELECT session_id FROM groupes WHERE id = $1", [gid]);
    if (!groupe) return res.status(400).json({ error: "Groupe introuvable." });
    if (sid !== null && groupe.session_id !== sid) {
      return res.status(400).json({ error: "Ce groupe n'appartient pas à la session indiquée." });
    }
  }

  // Si un fichier Drive est fourni, il DOIT pouvoir être vérifié : pas de
  // rattachement à l'aveugle. Drive indisponible ⇒ 503, fichier inconnu ⇒
  // 400, jamais de pièce cassée. On récupère au passage le nom/URL/MIME réels.
  let infosFichier = null;
  if (drive_file_id) {
    const d = await getDrive();
    if (!d) {
      return res.status(503).json({ error: "Google Drive est indisponible ou non connecté. Impossible de vérifier le fichier." });
    }
    try {
      const { data } = await d.drive.files.get({
        fileId: String(drive_file_id).trim(),
        fields: "id,name,mimeType,webViewLink",
        supportsAllDrives: true,
      });
      infosFichier = data;
    } catch (e) {
      if (e?.response?.status === 404 || e?.code === 404) {
        return res.status(400).json({ error: "Fichier Drive introuvable ou inaccessible." });
      }
      return res.status(400).json({ error: "Impossible de vérifier ce fichier Drive : " + (e.message || "erreur inconnue") });
    }
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Seuls les indicateurs du référentiel ACTIF sont acceptés : une preuve
    // rattachée à une version inexploitée n'apparaîtrait nulle part.
    const { rows: trouves } = await client.query(
      `SELECT i.id, i.numero FROM indicateurs i
       JOIN referentiel_versions v ON v.id = i.version_id AND v.est_active
       WHERE i.id = ANY($1::int[]) ORDER BY i.numero`,
      [ids]
    );
    if (trouves.length !== ids.length) {
      const connus = new Set(trouves.map((t) => t.id));
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: `Indicateur(s) introuvable(s) dans le référentiel actif : ${ids.filter((n) => !connus.has(n)).join(", ")}.`,
      });
    }

    const creees = [];
    for (const ind of trouves) {
      const { rows: [preuve] } = await client.query(
        `INSERT INTO preuves (indicateur_id, titre, description, statut, mode_fichiers,
           type_alerte, periodicite_mois, date_echeance, session_id, groupe_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [ind.id, titre.trim(), description?.trim() || null, statut || "a_risque",
         mode_fichiers || "unique", type_alerte || null,
         type_alerte === "revision_periodique" ? periodicite_mois : null,
         type_alerte === "echeance_fixe" ? date_echeance : null,
         sid, gid, req.user.id]
      );
      // Le même fichier est rattaché à chacune des preuves créées : la
      // contrainte d'unicité porte sur (preuve_id, drive_file_id), donc
      // l'unique chose interdite est de rattacher deux fois le même fichier
      // à la MÊME preuve.
      if (drive_file_id) {
        await client.query(
          `INSERT INTO preuve_fichiers (preuve_id, drive_file_id, drive_url, drive_nom, drive_mime, source, ajoute_par)
           VALUES ($1, $2, $3, $4, $5, 'manuel', $6)
           ON CONFLICT (preuve_id, drive_file_id) DO NOTHING`,
          [preuve.id, String(drive_file_id).trim(),
           drive_url || infosFichier?.webViewLink || lienDrive(drive_file_id),
           drive_nom || infosFichier?.name || null,
           drive_mime || infosFichier?.mimeType || null, req.user.id]
        );
      }
      creees.push({ id: preuve.id, indicateur: ind.numero });
    }
    await client.query("COMMIT");
    res.status(201).json({ preuves: creees, total: creees.length });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.code === "23503") return res.status(400).json({ error: "Indicateur introuvable." });
    if (e.code === "23505") return res.status(409).json({ error: "Une preuve identique existe déjà pour cet indicateur." });
    throw e;
  } finally { client.release(); }
}));

// Correction du rattachement, en un appel : l'admin choisit un candidat
// (ou colle un identifiant Drive), ajuste le statut, le mode de fichiers,
// la session rattachée, ou déclare la preuve confirmée telle quelle.
router.patch("/preuves/:id", requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const {
    statut, titre, description, indicateur_id, drive_file_id, drive_url, drive_nom, drive_mime, confirmer,
    mode_fichiers, session_id, groupe_id,
    type_alerte, periodicite_mois, date_echeance, date_derniere_revision, marquer_revise,
  } = req.body || {};
  if (statut !== undefined && !STATUTS.includes(statut)) return res.status(400).json({ error: "Statut inconnu." });
  // Le titre et l'indicateur d'une preuve peuvent être corrigés : une preuve
  // rattachée au mauvais indicateur, ou mal nommée, doit pouvoir être
  // réparée sans être supprimée puis recréée.
  if (titre !== undefined && !titre?.trim()) return res.status(400).json({ error: "Titre obligatoire." });
  if (indicateur_id !== undefined && !Number.isInteger(Number(indicateur_id))) {
    return res.status(400).json({ error: "Indicateur invalide." });
  }
  if (mode_fichiers !== undefined && !MODES.includes(mode_fichiers)) {
    return res.status(400).json({ error: "Mode de fichiers inconnu." });
  }
  if (type_alerte !== undefined && type_alerte !== null && !TYPES_ALERTE.includes(type_alerte)) {
    return res.status(400).json({ error: "Type d'échéance inconnu." });
  }

  const sets = [];
  const params = [id];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (statut !== undefined) {
    set("statut", statut);
  } else if (confirmer) {
    // Confirmer une preuve « à risque » la fait passer à « maîtrisé ». Si
    // l'admin a lui-même choisi un statut dans ce même appel, la branche
    // du dessus s'applique à la place ; un changement manuel ultérieur est
    // un appel séparé et l'emporte toujours de la même façon.
    sets.push("statut = CASE WHEN statut = 'a_risque' THEN 'maitrise' ELSE statut END");
  }
  if (titre !== undefined) set("titre", titre.trim());
  if (description !== undefined) set("description", description?.trim() || null);
  if (indicateur_id !== undefined) set("indicateur_id", Number(indicateur_id));
  if (mode_fichiers !== undefined) set("mode_fichiers", mode_fichiers);
  if (session_id !== undefined) set("session_id", session_id || null);
  if (groupe_id !== undefined) set("groupe_id", groupe_id || null);
  // Changer de type d'échéance efface les champs de l'ancien type : une
  // preuve remise à « aucune » ne doit garder ni date ni périodicité. Sauf
  // si cette même requête fixe justement cette valeur — jamais deux SET
  // sur la même colonne, Postgres les refuse.
  if (type_alerte !== undefined) {
    set("type_alerte", type_alerte);
    if (type_alerte !== "revision_periodique" && periodicite_mois === undefined) set("periodicite_mois", null);
    if (type_alerte !== "echeance_fixe" && date_echeance === undefined) set("date_echeance", null);
  }
  if (periodicite_mois !== undefined) set("periodicite_mois", periodicite_mois || null);
  if (date_echeance !== undefined) set("date_echeance", date_echeance || null);
  if (date_derniere_revision !== undefined) set("date_derniere_revision", date_derniere_revision || null);
  else if (marquer_revise) set("date_derniere_revision", new Date().toISOString().slice(0, 10));
  if (confirmer) {
    sets.push("a_confirmer = false", "motif_confirmation = NULL", "validee_le = now()");
    params.push(req.user.id); sets.push(`validee_par = $${params.length}`);
  }
  if (!sets.length && drive_file_id === undefined) return res.status(400).json({ error: "Rien à modifier." });

  // Plusieurs écritures (preuve + pièces jointes) : tout ou rien.
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: [avant] } = await client.query("SELECT mode_fichiers FROM preuves WHERE id = $1 FOR UPDATE", [id]);
    if (!avant) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Preuve introuvable." }); }
    // Changer d'indicateur impose d'en choisir un du référentiel ACTIF :
    // une preuve rattachée à une version inexploitée disparaîtrait des
    // deux écrans sans que personne ne s'en aperçoive.
    if (indicateur_id !== undefined) {
      const { rowCount } = await client.query(
        `SELECT 1 FROM indicateurs i
         JOIN referentiel_versions v ON v.id = i.version_id AND v.est_active
         WHERE i.id = $1`,
        [Number(indicateur_id)]
      );
      if (!rowCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Indicateur introuvable dans le référentiel actif." });
      }
    }

    if (drive_file_id !== undefined) {
      const mode = mode_fichiers ?? avant.mode_fichiers;
      // En mode « un seul fichier », le nouveau remplace l'ancien — c'est
      // le comportement d'origine. Dans les autres modes, il s'ajoute.
      if (mode === "unique" || !drive_file_id) {
        await client.query("DELETE FROM preuve_fichiers WHERE preuve_id = $1", [id]);
      }
      if (drive_file_id) {
        await client.query(
          `INSERT INTO preuve_fichiers (preuve_id, drive_file_id, drive_url, drive_nom, drive_mime, source, ajoute_par)
           VALUES ($1, $2, $3, $4, $5, 'manuel', $6)
           ON CONFLICT (preuve_id, drive_file_id) DO UPDATE SET
             drive_url = EXCLUDED.drive_url, drive_nom = EXCLUDED.drive_nom, drive_mime = EXCLUDED.drive_mime`,
          [id, drive_file_id, drive_url || lienDrive(drive_file_id), drive_nom || null, drive_mime || null, req.user.id]
        );
      }
    }
    if (sets.length) await client.query(`UPDATE preuves SET ${sets.join(", ")} WHERE id = $1`, params);
    const { rows: [apres] } = await client.query(ETAT_APRES, [id]);
    await client.query("COMMIT");
    res.json({ ok: true, ...apres });
  } catch (e) {
    await client.query("ROLLBACK");
    // 23505 : un import a déjà créé une preuve de ce titre pour cet
    // indicateur (index partiel des preuves « import_drive »). On le dit
    // plutôt que de renvoyer un 500.
    if (e.code === "23505") {
      return res.status(409).json({ error: "Une preuve de ce titre existe déjà pour cet indicateur." });
    }
    if (e.code === "23503") return res.status(400).json({ error: "Indicateur introuvable." });
    throw e;
  } finally {
    client.release();
  }
}));

// Ajoute une pièce jointe à une preuve qui accepte plusieurs fichiers.
router.post("/preuves/:id/fichiers", requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { drive_file_id, drive_url, drive_nom, drive_mime, stagiaire_id } = req.body || {};
  if (!drive_file_id) return res.status(400).json({ error: "Aucun fichier Drive indiqué." });
  const { rows: [preuve] } = await query("SELECT mode_fichiers FROM preuves WHERE id = $1", [id]);
  if (!preuve) return res.status(404).json({ error: "Preuve introuvable." });
  if (preuve.mode_fichiers === "unique") {
    return res.status(409).json({
      error: "Cette preuve n'accepte qu'un seul fichier. Passez-la en « plusieurs fichiers » ou « un par stagiaire » d'abord.",
    });
  }
  const { rows: [fichier] } = await query(
    `INSERT INTO preuve_fichiers (preuve_id, drive_file_id, drive_url, drive_nom, drive_mime, source, stagiaire_id, ajoute_par)
     VALUES ($1, $2, $3, $4, $5, 'manuel', $6, $7)
     ON CONFLICT (preuve_id, drive_file_id) DO UPDATE SET
       drive_url = EXCLUDED.drive_url, drive_nom = EXCLUDED.drive_nom, drive_mime = EXCLUDED.drive_mime
     RETURNING id, drive_file_id, drive_url AS url, drive_nom AS nom, drive_mime AS mime, source`,
    [id, drive_file_id, drive_url || lienDrive(drive_file_id), drive_nom || null, drive_mime || null,
     stagiaire_id || null, req.user.id]
  );
  const { rows: [apres] } = await query(ETAT_APRES, [id]);
  res.json({ ok: true, fichier, ...apres });
}));

router.delete("/preuves/:id/fichiers/:fichierId", requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { rowCount } = await query(
    "DELETE FROM preuve_fichiers WHERE id = $1 AND preuve_id = $2",
    [Number(req.params.fichierId), id]
  );
  if (!rowCount) return res.status(404).json({ error: "Fichier introuvable sur cette preuve." });
  const { rows: [apres] } = await query(ETAT_APRES, [id]);
  res.json({ ok: true, ...apres });
}));

// Changement de statut groupé : une sélection de preuves, un seul appel.
router.patch("/preuves", requireAdmin, wrap(async (req, res) => {
  const { ids, statut } = req.body || {};
  if (!STATUTS.includes(statut)) return res.status(400).json({ error: "Statut inconnu." });
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "Aucune preuve sélectionnée." });
  const propres = [...new Set(ids.map(Number))].filter((n) => Number.isInteger(n) && n > 0);
  if (!propres.length) return res.status(400).json({ error: "Identifiants de preuve invalides." });
  if (propres.length > 500) return res.status(400).json({ error: "500 preuves au maximum par changement groupé." });
  const { rowCount } = await query("UPDATE preuves SET statut = $1 WHERE id = ANY($2::int[])", [statut, propres]);
  res.json({ ok: true, misAJour: rowCount });
}));

router.delete("/preuves/:id", requireAdmin, wrap(async (req, res) => {
  const { rowCount } = await query("DELETE FROM preuves WHERE id = $1", [Number(req.params.id)]);
  if (!rowCount) return res.status(404).json({ error: "Preuve introuvable." });
  res.json({ ok: true });
}));

// ── Import du classeur ───────────────────────────────────────
router.post("/import/classeur", requireAdmin, wrap(async (req, res) => {
  const { fichierId = null, onglet = null, apercu = false } = req.body || {};
  try {
    const r = await importerClasseur({ fichierId, onglet, apercu: apercu === true, utilisateurId: req.user.id });
    res.json(r);
  } catch (e) {
    // `error` est le message lisible ; `diagnostic` porte la réponse brute de
    // Google (code, statut, corps JSON), lisible directement dans l'onglet
    // Réseau du navigateur. Les jetons en sont retirés.
    res.status(400).json({ error: e.message, entetes: e.entetes, diagnostic: e.diagnostic || null });
  }
}));

router.get("/import/dernier", requireAdmin, wrap(async (_req, res) => {
  const { rows } = await query(
    `SELECT i.*, u.email AS lance_par_email FROM imports_drive i
     LEFT JOIN utilisateurs u ON u.id = i.lance_par
     ORDER BY i.demarre_le DESC LIMIT 1`
  );
  res.json({ import: rows[0] || null });
}));

// Recherche Drive pour rattacher une preuve à la main.
router.get("/drive/recherche", requireAdmin, wrap(async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 3) return res.status(400).json({ error: "Recherche trop courte." });
  const d = await getDrive();
  if (!d) return res.status(400).json({ error: "Drive non connecté." });
  const { data } = await d.drive.files.list({
    q: `name contains '${q.replace(/'/g, "\\'")}' and trashed = false`,
    fields: "files(id,name,mimeType,webViewLink,modifiedTime)", pageSize: 20, orderBy: "modifiedTime desc",
    supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  res.json({ fichiers: (data.files || []).map((f) => ({ id: f.id, nom: f.name, url: f.webViewLink, mime: f.mimeType })) });
}));

router.get("/drive/status", requireAdmin, wrap(async (_req, res) => res.json(await driveStatus())));

router.post("/drive/disconnect", requireAdmin, wrap(async (_req, res) => {
  await disconnectDrive();
  res.json({ ok: true });
}));

// ── Historique des audits ────────────────────────────────────
// Mémoire institutionnelle : ce qui a été audité, quand, par qui, et
// avec quelles non-conformités. La table existait depuis la Phase 0
// sans qu'aucun écran ne s'en serve.

router.get("/audits", requireAuth, wrap(async (_req, res) => {
  const { rows } = await query(
    `SELECT a.*, v.code AS referentiel_code, v.libelle AS referentiel_libelle
     FROM audits_history a
     LEFT JOIN referentiel_versions v ON v.id = a.referentiel_version_id
     ORDER BY a.date_audit DESC, a.id DESC`
  );
  res.json({ audits: rows, total: rows.length });
}));

router.post("/audits", requireAdmin, wrap(async (req, res) => {
  const corps = req.body || {};
  if (!corps.type) return res.status(400).json({ error: "Le type d'audit est obligatoire." });
  if (!corps.date_audit) return res.status(400).json({ error: "La date d'audit est obligatoire." });
  const { champs, erreur } = champsAudit(corps);
  if (erreur) return res.status(400).json({ error: erreur });

  const colonnes = Object.keys(champs);
  const valeurs = colonnes.map((c) => (c === "non_conformites" ? JSON.stringify(champs[c]) : champs[c]));
  const { rows } = await query(
    `INSERT INTO audits_history (${colonnes.join(", ")})
     VALUES (${colonnes.map((_, i) => "$" + (i + 1)).join(", ")}) RETURNING *`,
    valeurs
  );
  res.status(201).json({ audit: rows[0] });
}));

router.patch("/audits/:id", requireAdmin, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { champs, erreur } = champsAudit(req.body || {});
  if (erreur) return res.status(400).json({ error: erreur });
  const colonnes = Object.keys(champs);
  if (!colonnes.length) return res.status(400).json({ error: "Rien à modifier." });

  const params = [id];
  const sets = colonnes.map((c) => {
    params.push(c === "non_conformites" ? JSON.stringify(champs[c]) : champs[c]);
    return `${c} = $${params.length}`;
  });
  const { rows } = await query(
    `UPDATE audits_history SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params
  );
  if (!rows.length) return res.status(404).json({ error: "Audit introuvable." });
  res.json({ audit: rows[0] });
}));

router.use((_req, res) => res.status(404).json({ error: "Route inconnue." }));

export default router;
