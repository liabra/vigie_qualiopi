// DOC-9E — Lecture complète d'un entretien (entête + toutes les données
// structurées), réutilisée par la route de consultation
// (`routes/entretiens.js`) ET par le générateur de fiche
// (`ficheEntretienDocument.js`) : UNE seule requête par table, jamais deux
// implémentations qui pourraient diverger.
import { query } from "../db.js";

export async function chargerEntretienComplet(id) {
  const { rows: [entretien] } = await query("SELECT * FROM entretiens WHERE id = $1", [id]);
  if (!entretien) return null;
  const { rows: reponses } = await query(
    "SELECT cle, valeur, source FROM entretien_reponses WHERE entretien_id = $1 ORDER BY id", [id]
  );
  const { rows: evaluations } = await query(
    "SELECT phase, competence_code, niveau FROM entretien_positionnement_evaluations WHERE entretien_id = $1 ORDER BY phase, competence_code", [id]
  );
  const { rows: phases } = await query(
    "SELECT phase, priorite, observations FROM entretien_positionnement_phases WHERE entretien_id = $1 ORDER BY phase", [id]
  );
  const { rows: choix } = await query(
    "SELECT groupe, code FROM entretien_choix WHERE entretien_id = $1 ORDER BY groupe, code", [id]
  );
  const { rows: experiences } = await query(
    "SELECT ordre, structure, duree, missions, retenue FROM entretien_experiences WHERE entretien_id = $1 ORDER BY ordre", [id]
  );
  const { rows: planAction } = await query(
    "SELECT ordre, objectif, phase, action, echeance, etat FROM entretien_plan_action WHERE entretien_id = $1 ORDER BY ordre", [id]
  );
  return {
    entretien, reponses, positionnement: { evaluations, phases },
    choix, lignes: { experiences, plan_action: planAction },
  };
}
