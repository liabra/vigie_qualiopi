// ─────────────────────────────────────────────────────────────
//  Q4-2 — Justificatifs professionnels des intervenants (ADMIN).
//  Un justificatif = une preuve existante rattachée ; ses dates de
//  validité et son état viennent de preuves_enrichies (alerte_statut :
//  perime / bientot / ok / null) — un seul système d'alertes.
//  Une pièce n'est « manquante » que si l'admin l'a désignée comme attendue.
//  Jamais présenté comme une non-conformité Qualiopi.
// ─────────────────────────────────────────────────────────────
import { query } from "../db.js";

export const CATEGORIES_JUSTIFICATIF = ["cv", "diplome", "attestation", "certification", "contrat", "autre"];

// État d'UN document, d'après les alertes des preuves.
export const etatDocument = (alerte) => (alerte === "perime" ? "perime" : alerte === "bientot" ? "bientot" : "disponible");

// Une ligne par catégorie : attendue ou non, documents, état.
//   disponible > bientot > perime (un document valide suffit) ;
//   aucun document : « manquant » si attendue, sinon null (facultative).
export function lignesDossier(attendus = [], justificatifs = []) {
  return CATEGORIES_JUSTIFICATIF.map((categorie) => {
    const docs = justificatifs.filter((j) => j.categorie === categorie);
    const etats = docs.map((d) => etatDocument(d.alerte_statut));
    const attendue = attendus.includes(categorie);
    const etat = etats.includes("disponible") ? "disponible" : etats.includes("bientot") ? "bientot" : etats.includes("perime") ? "perime" : attendue ? "manquant" : null;
    return { categorie, attendue, etat, justificatifs: docs };
  });
}

const JUSTIFICATIFS_SQL = `SELECT j.id, j.intervenant_id, j.categorie, j.date_document, j.cree_le, u.nom AS cree_par_nom,
    p.id AS preuve_id, p.titre, p.type_alerte, p.date_echeance, p.periodicite_mois, p.date_derniere_revision, p.alerte_statut,
    COALESCE((SELECT json_agg(json_build_object('id', f.id, 'nom', f.drive_nom, 'url', f.drive_url) ORDER BY f.ajoute_le, f.id)
              FROM preuve_fichiers f WHERE f.preuve_id = p.id), '[]'::json) AS fichiers
  FROM intervenants_justificatifs j
  JOIN preuves_enrichies p ON p.id = j.preuve_id
  LEFT JOIN utilisateurs u ON u.id = j.cree_par`;

export async function dossierIntervenant(intervenant) {
  const [{ rows: attendus }, { rows: justificatifs }] = await Promise.all([
    query("SELECT categorie FROM intervenants_justificatifs_attendus WHERE intervenant_id = $1", [intervenant.id]),
    query(`${JUSTIFICATIFS_SQL} WHERE j.intervenant_id = $1 ORDER BY j.categorie, j.cree_le, j.id`, [intervenant.id]),
  ]);
  const cats = attendus.map((a) => a.categorie);
  const lignes = lignesDossier(cats, justificatifs);
  return {
    attendus: cats,
    lignes,
    justificatifs,
    // Sous-traitance : suivi du contrat (référence Drive, date, échéance,
    // état) — sans facturation ni obligation V10 non vérifiée.
    sous_traitance: intervenant.nature === "sous_traitant" ? {
      contrat_attendu: cats.includes("contrat"),
      etat: lignes.find((l) => l.categorie === "contrat").etat,
      contrats: justificatifs.filter((j) => j.categorie === "contrat"),
    } : null,
  };
}

// Pilotage : pièces attendues manquantes, documents bientôt à renouveler,
// documents périmés — intervenants ACTIFS seulement. UNE seule requête.
export async function alertesJustificatifs() {
  const { rows: inter } = await query(
    `SELECT i.id, i.nom, i.prenom, i.nature, i.fonction,
       COALESCE((SELECT array_agg(a.categorie) FROM intervenants_justificatifs_attendus a WHERE a.intervenant_id = i.id), '{}') AS attendus,
       COALESCE((SELECT json_agg(json_build_object('categorie', j.categorie, 'preuve_id', p.id, 'titre', p.titre,
                   'date_echeance', p.date_echeance, 'alerte_statut', p.alerte_statut) ORDER BY j.id)
                 FROM intervenants_justificatifs j JOIN preuves_enrichies p ON p.id = j.preuve_id
                 WHERE j.intervenant_id = i.id), '[]'::json) AS justificatifs
     FROM intervenants i WHERE i.actif ORDER BY i.nom, i.prenom, i.id`);
  const elements = [];
  for (const { attendus, justificatifs, ...i } of inter) {
    const lignes = lignesDossier(attendus, justificatifs);
    for (const l of lignes) {
      if (l.etat === "manquant") elements.push({ intervenant: i, categorie: l.categorie, etat: "manquant", document: null });
      // Un document à renouveler est signalé même si un autre est valide.
      for (const d of l.justificatifs) {
        const e = etatDocument(d.alerte_statut);
        if (e !== "disponible") elements.push({ intervenant: i, categorie: l.categorie, etat: e, document: { preuve_id: d.preuve_id, titre: d.titre, date_echeance: d.date_echeance } });
      }
    }
  }
  const compte = (e) => elements.filter((x) => x.etat === e).length;
  return {
    resume: { manquants: compte("manquant"), bientot: compte("bientot"), perimes: compte("perime"), intervenants: new Set(elements.map((x) => x.intervenant.id)).size },
    elements,
  };
}
