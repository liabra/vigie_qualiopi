// ─────────────────────────────────────────────────────────────
//  Q2-2 — Données stagiaires réservées à l'administrateur.
//
//  `situation_handicap` et `besoins_adaptation` (champs historiques) ne
//  sont NI renvoyés au contributeur, NI modifiables par lui. La protection
//  s'applique dans les réponses API elles-mêmes (jamais un simple masquage
//  côté interface). Projection centralisée : une seule règle pour toutes
//  les routes concernées.
// ─────────────────────────────────────────────────────────────
export const CHAMPS_RESERVES_ADMIN = ["situation_handicap", "besoins_adaptation"];
export const MSG_RESERVE_ADMIN = "La situation de handicap et les besoins d'adaptation sont réservés à l'administrateur.";

export const estAdmin = (user) => user?.role === "admin";

// Retire les champs réservés d'un objet stagiaire si l'utilisateur n'est
// pas administrateur. L'objet d'origine n'est jamais modifié.
export function projeterStagiaire(objet, user) {
  if (!objet || estAdmin(user)) return objet;
  const copie = { ...objet };
  for (const k of CHAMPS_RESERVES_ADMIN) delete copie[k];
  return copie;
}

// Clés réservées présentes dans un corps de requête — même à null ou "" :
// toute tentative (créer, remplacer, vider) est refusée explicitement.
export function champsReservesEnvoyes(corps) {
  const c = corps && typeof corps === "object" ? corps : {};
  return CHAMPS_RESERVES_ADMIN.filter((k) => Object.prototype.hasOwnProperty.call(c, k));
}

// Q4-2 — Preuves CONFIDENTIELLES (justificatifs d'intervenants) : filtre
// SQL unique, à appliquer à toute lecture de preuve destinée à un
// non-admin. `alias` = alias SQL de la table / vue des preuves.
export const preuveVisibleContributeur = (alias = "p") =>
  `NOT EXISTS (SELECT 1 FROM preuves_confidentielles pc WHERE pc.preuve_id = ${alias}.id)`;
