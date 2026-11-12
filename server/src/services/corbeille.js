// Mise à la corbeille d'une ancienne version (R5), avec journal de reprise.
//
// Déroulé d'une opération :
//   1. transaction : vérifications, ouverture de l'opération au journal (« en_attente ») ;
//      la version est alors réservée : aucun écrivain ne peut plus la référencer ;
//   2. Drive (hors transaction) : mise à la corbeille du fichier ;
//   3. transaction : version marquée et opération « confirmee ».
// Une opération « en_attente » est reprise par `reprendreCorbeilles` : l'état réel du fichier
// est lu sur Drive, la suppression n'est jamais relancée si le fichier est déjà à la corbeille,
// et les protections sont revérifiées avant toute action.
//
// Blocage : une opération qui ne peut plus aboutir seule (fichier introuvable, fichier utilisé,
// version devenue courante, échecs répétés) passe à « bloquee » avec son motif. Elle n'est plus
// reprise automatiquement, reste réservée, et seul un administrateur la relance ou l'abandonne.
//
// Bail : avant tout appel Drive, l'opération est réclamée pour une durée limitée, identifiée par
// un jeton. Le bail est renouvelé pendant l'appel ; s'il expire (processus arrêté), une autre
// reprise peut la traiter. Un seul traitement à la fois par opération, y compris entre processus.

import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import {
  ErreurDocument, confirmerCorbeille, preparerCorbeille, transaction, verifierCorbeille, verrouillerGraphe,
} from "./documentsPreuves.js";

// Réglages de reprise. Modifiés uniquement par les tests (bail court, renouvellement rapide).
export const reglages = { bailSecondes: 300, renouvellementMs: 60_000, tentativesMax: 5 };

// Motifs pour lesquels la reprise automatique ne peut pas aboutir sans décision administrateur.
const MOTIFS_BLOCAGE = new Set(["version_courante", "version_introuvable", "version_obsolete", "fichier_encore_utilise"]);

function messageDe(e) {
  return e?.code && e.code !== "ERR_UNKNOWN" ? String(e.code) : (e?.message || "erreur inconnue");
}

function fichierIntrouvable(e) {
  return e?.status === 404 || e?.code === 404 || e?.response?.status === 404;
}

async function journaliser(operationId, message) {
  // Le bail est rendu : la prochaine reprise peut traiter l'opération sans attendre son expiration.
  await transaction(async (cx) => {
    await verrouillerGraphe(cx);
    await cx.query(
      "UPDATE corbeille_operations SET derniere_erreur = $2, bail_jusqu_au = NULL, bail_jeton = NULL WHERE id = $1",
      [operationId, String(message).slice(0, 300)]
    );
  });
}

// Échec d'une reprise : compté ; au seuil, l'opération est bloquée (boucle de reprise bornée).
async function enregistrerEchecReprise(operationId, message) {
  await transaction(async (cx) => {
    await verrouillerGraphe(cx);
    await cx.query(
      `UPDATE corbeille_operations SET derniere_erreur = $2, bail_jusqu_au = NULL, bail_jeton = NULL,
          tentatives = tentatives + 1,
          statut = CASE WHEN tentatives + 1 >= $3 THEN 'bloquee' ELSE statut END,
          motif = CASE WHEN tentatives + 1 >= $3 THEN 'echec_repete' ELSE motif END,
          bloquee_le = CASE WHEN tentatives + 1 >= $3 THEN now() ELSE bloquee_le END
        WHERE id = $1 AND statut = 'en_attente'`,
      [operationId, String(message).slice(0, 300), reglages.tentativesMax]
    );
  });
}

async function bloquer(operationId, motif, message) {
  await transaction(async (cx) => {
    await verrouillerGraphe(cx);
    await cx.query(
      `UPDATE corbeille_operations SET statut = 'bloquee', motif = $2, derniere_erreur = $3,
          bloquee_le = now(), bail_jusqu_au = NULL, bail_jeton = NULL
        WHERE id = $1 AND statut = 'en_attente'`,
      [operationId, motif, String(message).slice(0, 300)]
    );
  });
}

// Réclamation atomique : seule une opération en attente sans bail valide est réclamée.
async function reclamer(operationId) {
  const jeton = randomUUID();
  return transaction(async (cx) => {
    await verrouillerGraphe(cx);
    const { rows: [op] } = await cx.query(
      `UPDATE corbeille_operations SET bail_jusqu_au = now() + make_interval(secs => $3), bail_jeton = $2
        WHERE id = $1 AND statut = 'en_attente' AND (bail_jusqu_au IS NULL OR bail_jusqu_au < now())
        RETURNING id, document_id, numero, drive_file_id`,
      [operationId, jeton, reglages.bailSecondes]
    );
    return op ? { ...op, jeton } : null;
  });
}

// Renouvelle le bail tant que l'appel Drive est en cours. Ne renouvelle que son propre bail
// (jeton) et seulement si l'opération est encore en attente.
function tenirBail(operationId, jeton) {
  const minuteur = setInterval(() => {
    transaction(async (cx) => {
      await verrouillerGraphe(cx);
      await cx.query(
        `UPDATE corbeille_operations SET bail_jusqu_au = now() + make_interval(secs => $3)
          WHERE id = $1 AND bail_jeton = $2 AND statut = 'en_attente'`,
        [operationId, jeton, reglages.bailSecondes]
      );
    }).catch(() => {});
  }, reglages.renouvellementMs);
  minuteur.unref();
  return () => clearInterval(minuteur);
}

// Appel Drive protégé par le bail : renouvelé pendant l'appel, arrêté à son issue.
async function appelDriveAvecBail(operationId, jeton, appel) {
  const arret = tenirBail(operationId, jeton);
  try {
    return await appel();
  } finally {
    arret();
  }
}

export async function tenterCorbeille({ drive, documentId, numero, utilisateurId = null }) {
  const jeton = randomUUID();
  const { driveFileId, operationId } = await transaction((cx) => preparerCorbeille(cx, {
    documentId, numero, utilisateurId, jeton, bailSecondes: reglages.bailSecondes,
  }));
  if (!drive) {
    await journaliser(operationId, "Drive indisponible");
    return { statut: "echec_drive", operationId };
  }
  try {
    await appelDriveAvecBail(operationId, jeton, () =>
      drive.files.update({ fileId: driveFileId, requestBody: { trashed: true }, supportsAllDrives: true }));
  } catch (e) {
    await journaliser(operationId, "Drive : " + messageDe(e));
    return { statut: "echec_drive", operationId };
  }
  try {
    await transaction((cx) => confirmerCorbeille(cx, { documentId, numero, operationId }));
    return { statut: "confirmee", operationId };
  } catch (e) {
    await journaliser(operationId, "Confirmation : " + messageDe(e)).catch(() => {});
    return { statut: "en_attente_confirmation", operationId, erreur: messageDe(e) };
  }
}

// Traite une opération réclamée. Ne renvoie jamais d'exception : chaque issue est un résultat.
async function reprendreOperation(drive, op) {
  const resultat = (statut, extra = {}) => ({ operationId: op.id, statut, ...extra });
  try {
    let dejaMarquee = false;
    try {
      await transaction((cx) => verifierCorbeille(cx, { documentId: op.document_id, numero: op.numero }));
    } catch (e) {
      if (e.code === "deja_a_la_corbeille") {
        dejaMarquee = true;
      } else if (MOTIFS_BLOCAGE.has(e.code)) {
        await bloquer(op.id, e.code, e.message);
        return resultat("bloquee", { motif: e.code });
      } else {
        throw e;
      }
    }
    if (!dejaMarquee) {
      let trashed;
      try {
        await appelDriveAvecBail(op.id, op.jeton, async () => {
          const { data } = await drive.files.get({ fileId: op.drive_file_id, fields: "id,trashed", supportsAllDrives: true });
          trashed = data.trashed === true;
        });
      } catch (e) {
        if (fichierIntrouvable(e)) {
          await bloquer(op.id, "fichier_introuvable", "Fichier introuvable côté Drive");
          return resultat("bloquee", { motif: "fichier_introuvable" });
        }
        await enregistrerEchecReprise(op.id, "Drive (lecture) : " + messageDe(e));
        return resultat("en_attente", { erreur: messageDe(e) });
      }
      if (!trashed) {
        try {
          await appelDriveAvecBail(op.id, op.jeton, () =>
            drive.files.update({ fileId: op.drive_file_id, requestBody: { trashed: true }, supportsAllDrives: true }));
        } catch (e) {
          await enregistrerEchecReprise(op.id, "Drive : " + messageDe(e));
          return resultat("en_attente", { erreur: messageDe(e) });
        }
      }
    }
    await transaction((cx) => confirmerCorbeille(cx, { documentId: op.document_id, numero: op.numero, operationId: op.id }));
    return resultat("confirmee");
  } catch (e) {
    await enregistrerEchecReprise(op.id, "Reprise : " + messageDe(e)).catch(() => {});
    return resultat("en_attente", { erreur: messageDe(e) });
  }
}

// Reprise : traite chaque opération en attente dont le bail n'est pas tenu par un autre traitement.
// Les opérations bloquées ne sont jamais reprises ici.
export async function reprendreCorbeilles({ drive }) {
  if (!drive) throw new ErreurDocument(503, "drive_indisponible", "Google Drive est indisponible : reprise impossible.");
  const { rows: candidates } = await getPool().query(
    "SELECT id FROM corbeille_operations WHERE statut = 'en_attente' AND (bail_jusqu_au IS NULL OR bail_jusqu_au < now()) ORDER BY id"
  );
  const resultats = [];
  for (const candidate of candidates) {
    const op = await reclamer(candidate.id);
    resultats.push(op ? await reprendreOperation(drive, op) : { operationId: candidate.id, statut: "occupee" });
  }
  return { reprises: resultats };
}

// Décision administrateur : relancer une opération bloquée (remise en attente, compteurs remis à zéro).
// La reprise suivante revérifie toutes les protections avant toute action Drive.
export async function relancerOperation({ operationId }) {
  return transaction(async (cx) => {
    await verrouillerGraphe(cx);
    const { rows: [op] } = await cx.query("SELECT statut FROM corbeille_operations WHERE id = $1 FOR UPDATE", [operationId]);
    if (!op) throw new ErreurDocument(404, "operation_introuvable", "Opération de corbeille introuvable.");
    if (op.statut !== "bloquee") {
      throw new ErreurDocument(409, "operation_non_bloquee", "Seule une opération bloquée peut être relancée.");
    }
    await cx.query(
      `UPDATE corbeille_operations SET statut = 'en_attente', motif = NULL, bloquee_le = NULL, tentatives = 0,
          bail_jusqu_au = NULL, bail_jeton = NULL
        WHERE id = $1`,
      [operationId]
    );
    return { operationId, statut: "en_attente" };
  });
}

// Décision administrateur : abandonner une opération bloquée. L'historique est conservé, la réservation
// est levée, aucun fichier n'est touché sur Drive. Refusé pendant qu'un traitement est en cours.
export async function abandonnerOperation({ operationId, motif, utilisateurId }) {
  const texte = String(motif ?? "").trim();
  if (!texte || texte.length > 300) {
    throw new ErreurDocument(400, "motif_obligatoire", "Un motif d'abandon est obligatoire (300 caractères au plus).");
  }
  return transaction(async (cx) => {
    await verrouillerGraphe(cx);
    const { rows: [op] } = await cx.query("SELECT statut FROM corbeille_operations WHERE id = $1 FOR UPDATE", [operationId]);
    if (!op) throw new ErreurDocument(404, "operation_introuvable", "Opération de corbeille introuvable.");
    if (op.statut !== "bloquee") {
      throw new ErreurDocument(409, "operation_non_bloquee", "Seule une opération bloquée peut être abandonnée.");
    }
    await cx.query(
      `UPDATE corbeille_operations SET statut = 'abandonnee', decision_par = $2, decision_le = now(),
          decision_motif = $3, bail_jusqu_au = NULL, bail_jeton = NULL
        WHERE id = $1`,
      [operationId, utilisateurId, texte]
    );
    return { operationId, statut: "abandonnee" };
  });
}
