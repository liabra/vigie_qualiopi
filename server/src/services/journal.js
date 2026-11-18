// Journal des opérations sensibles (CDC §18, §47) : comptes, exports, anonymisations, données restreintes.
// Jamais de donnée personnelle dans `detail` : des identifiants et des libellés métier seulement.
// Une écriture qui échoue n'interrompt jamais l'opération métier (elle est signalée dans les journaux serveur).
import { query } from "../db.js";

export async function journaliser(evenement, { detail = null, cibleType = null, cibleId = null, par = null } = {}) {
  try {
    await query("INSERT INTO journal_securite (evenement, detail, cible_type, cible_id, par) VALUES ($1,$2,$3,$4,$5)",
      [String(evenement).slice(0, 80), detail ? String(detail).slice(0, 500) : null, cibleType, cibleId, par]);
  } catch (e) {
    console.error("Journal de sécurité : écriture impossible (" + (e.code || "erreur") + ").");
  }
}
