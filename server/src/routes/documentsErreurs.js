import { ErreurDocument } from "../services/documentsPreuves.js";

// Traduit une erreur métier documentaire en réponse HTTP. Renvoie false si l'erreur
// n'est pas métier (l'appelant la relance alors).
export function repondreErreurDocument(res, e) {
  if (!(e instanceof ErreurDocument)) return false;
  res.status(e.statut).json({ error: e.message, code: e.code, ...(e.details ? { details: e.details } : {}) });
  return true;
}
