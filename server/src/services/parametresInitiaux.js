// Initialisation (une fois, par un administrateur) des paramètres de l'organisme et des signataires
// depuis un fichier JSON fourni hors dépôt : aucune coordonnée ni aucun nom dans le code.
//
// Non destructif : un champ déjà renseigné n'est JAMAIS écrasé, un signataire déjà présent (même nom
// et même fonction, casse ignorée) n'est pas recréé.
import { getPool } from "../db.js";
import { CHAMPS_ORGANISME, validerOrganisme, validerSignataire } from "./parametresOrganisme.js";

export async function initialiserParametres(donnees) {
  const src = donnees && typeof donnees === "object" ? donnees : {};
  const organisme = src.organisme || {};
  const v = Object.keys(organisme).length ? validerOrganisme(organisme) : { valeur: {} };
  if (v.erreur) throw new Error(`Organisme : ${v.erreur}`);
  const signataires = Array.isArray(src.signataires) ? src.signataires : [];
  const valides = signataires.map((s, i) => {
    const r = validerSignataire(s, { complet: true });
    if (r.erreur) throw new Error(`Signataire n°${i + 1} : ${r.erreur}`);
    return r.valeur;
  });

  const client = await getPool().connect();
  const bilan = { champs_renseignes: [], champs_deja_presents: [], signataires_crees: [], signataires_existants: [] };
  try {
    await client.query("BEGIN");
    const { rows: [actuel] } = await client.query(`SELECT ${CHAMPS_ORGANISME.join(", ")} FROM parametres_organisme WHERE id = 1 FOR UPDATE`);
    for (const champ of CHAMPS_ORGANISME) {
      if (v.valeur[champ] === undefined || v.valeur[champ] === null) continue;
      if (actuel?.[champ]) { bilan.champs_deja_presents.push(champ); continue; }
      await client.query(`UPDATE parametres_organisme SET ${champ} = $1, mis_a_jour_le = now() WHERE id = 1`, [v.valeur[champ]]);
      bilan.champs_renseignes.push(champ);
    }
    for (const s of valides) {
      const { rowCount } = await client.query(
        `INSERT INTO signataires (nom, fonction)
         SELECT $1::text, $2::text WHERE NOT EXISTS (
           SELECT 1 FROM signataires WHERE actif AND lower(btrim(nom)) = lower(btrim($1::text)) AND lower(btrim(fonction)) = lower(btrim($2::text)))`,
        [s.nom, s.fonction]
      );
      (rowCount ? bilan.signataires_crees : bilan.signataires_existants).push(s.nom);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return bilan;
}
