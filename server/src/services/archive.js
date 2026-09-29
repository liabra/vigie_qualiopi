// Après VF — cycle de vie des sessions : archivage, restauration,
// suppression sécurisée. Fonctions partagées entre les routes de
// gestion.js et api.js. L'archivage ne touche à AUCUNE donnée Qualiopi :
// c'est uniquement un état de cycle de vie administratif.

import { query } from "../db.js";

export const MSG_ARCHIVEE =
  "Cette session est archivée et en lecture seule. Restaurez-la d'abord pour la modifier.";

// null : session introuvable ; true : archivée ; false : active.
export async function etatSession(id) {
  const { rows: [s] } = await query("SELECT archivee_le FROM sessions WHERE id = $1", [id]);
  if (!s) return null;
  return !!s.archivee_le;
}

// Renvoie {} si la session existe et est ACTIVE ; sinon { statut, erreur }
// prêt à être renvoyé (404 introuvable, 409 archivée).
export async function verifierSessionActive(id) {
  const etat = await etatSession(id);
  if (etat === null) return { statut: 404, erreur: "Session introuvable." };
  if (etat === true) return { statut: 409, erreur: MSG_ARCHIVEE };
  return {};
}

// Dépendances d'une session : comptes des lignes qui lui sont rattachées.
// Une session n'est supprimable QUE si tous ces comptes sont à zéro — on ne
// cascade JAMAIS une session réelle, même par le schéma (CASCADE). La
// suppression définitive reste exceptionnelle (sessions test, doublons,
// erreurs de création).
export const DEPENDANCES_SQL = `
  SELECT
    (SELECT count(*) FROM groupes g WHERE g.session_id = $1)::int AS groupes,
    (SELECT count(*) FROM inscriptions i WHERE i.session_id = $1)::int AS inscriptions,
    (SELECT count(*) FROM absences a JOIN inscriptions i ON i.id = a.inscription_id WHERE i.session_id = $1)::int AS absences,
    (SELECT count(*) FROM resultats_qcm r JOIN inscriptions i ON i.id = r.inscription_id WHERE i.session_id = $1)::int AS resultats_qcm,
    (SELECT count(*) FROM satisfactions f WHERE f.session_id = $1)::int AS satisfactions,
    (SELECT count(*) FROM generations g WHERE g.session_id = $1)::int AS generations,
    (SELECT count(*) FROM documents_generes d WHERE d.session_id = $1)::int AS documents_generes,
    (SELECT count(*) FROM preuves p WHERE p.session_id = $1)::int AS preuves
`;

// Renvoie { vide, blocages } : `blocages` = libellés des données présentes.
export async function dependancesSession(id) {
  const { rows: [d] } = await query(DEPENDANCES_SQL, [id]);
  const libelles = {
    groupes: "des groupes", inscriptions: "des inscriptions", absences: "des absences",
    resultats_qcm: "des évaluations", satisfactions: "des satisfactions",
    generations: "des générations", documents_generes: "des documents générés", preuves: "des preuves",
  };
  const blocages = Object.entries(d || {}).filter(([, n]) => Number(n) > 0).map(([cle]) => libelles[cle]);
  return { vide: blocages.length === 0, blocages };
}
