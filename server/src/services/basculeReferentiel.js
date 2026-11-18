// Bascule de référentiel avec report des rattachements, par numéro d'indicateur.
//
// Les preuves, modèles, veilles, signalements, actions et marquages « non applicable » de
// l'ancienne version sont reliés à l'indicateur de MÊME NUMÉRO de la nouvelle version.
// Une preuve dont l'indicateur a changé de libellé passe « à confirmer » : elle reste valable
// mais doit être relue au regard du nouveau texte. Un indicateur sans équivalent (ex. le 33 de
// V10 depuis V9) ne reçoit rien ; un rattachement sans équivalent reste sur l'ancienne version.
// Tout se fait dans la transaction de l'appelant.

// Tables de liaison (clé composite) : la ligne est déplacée sauf si l'équivalent existe déjà.
const LIAISONS = [
  ["modele_indicateurs", "modele_id"],
  ["veille_indicateurs", "veille_id"],
  ["signalements_qualite_indicateurs", "signalement_id"],
  ["actions_qualite_indicateurs", "action_id"],
];

export async function reporterRattachements(client, ancienneId, nouvelleId) {
  await client.query(
    `CREATE TEMP TABLE correspondance ON COMMIT DROP AS
     SELECT a.id AS ancien, n.id AS nouveau, a.libelle IS DISTINCT FROM n.libelle AS modifie
     FROM indicateurs a JOIN indicateurs n ON n.numero = a.numero AND n.version_id = $2
     WHERE a.version_id = $1`,
    [ancienneId, nouvelleId]
  );
  const bilan = {};
  const preuves = await client.query(
    `UPDATE preuves p SET indicateur_id = c.nouveau, a_confirmer = p.a_confirmer OR c.modifie
     FROM correspondance c WHERE p.indicateur_id = c.ancien
     RETURNING c.modifie`
  );
  bilan.preuves = preuves.rowCount;
  bilan.preuves_a_confirmer = preuves.rows.filter((r) => r.modifie).length;
  for (const [table, cle] of LIAISONS) {
    const r = await client.query(
      `UPDATE ${table} t SET indicateur_id = c.nouveau
       FROM correspondance c
       WHERE t.indicateur_id = c.ancien
         AND NOT EXISTS (SELECT 1 FROM ${table} d WHERE d.${cle} = t.${cle} AND d.indicateur_id = c.nouveau)`
    );
    bilan[table] = r.rowCount;
  }
  const na = await client.query(
    `INSERT INTO indicateurs_non_applicables (indicateur_id, motif, marquee_par, marquee_le)
     SELECT c.nouveau, n.motif, n.marquee_par, n.marquee_le
     FROM indicateurs_non_applicables n JOIN correspondance c ON c.ancien = n.indicateur_id
     ON CONFLICT (indicateur_id) DO NOTHING`
  );
  bilan.non_applicables = na.rowCount;
  const { rows: [{ n }] } = await client.query("SELECT count(*)::int AS n FROM correspondance");
  bilan.indicateurs_correspondants = n;
  await client.query("DROP TABLE correspondance");
  return bilan;
}
