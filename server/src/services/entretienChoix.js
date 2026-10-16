// ─────────────────────────────────────────────────────────────
//  DOC-9D3 lot B — Groupes de cases à cocher FERMÉS de l'entretien initial
//  FSE-IA (hors questionnaire des six phases, cf. positionnementEntretien.js).
//  Module PUR : aucune base, aucun réseau.
//
//  Transcrit depuis
//  `modeles-local/entree/FSE-IA_Audit_questions_hors_positionnement.md` —
//  aucune option ajoutée ou retirée par rapport au modèle réel. Une option
//  « autre » cochée se complète par une clé `entretien_reponses` dédiée
//  (ex. `precision_objectifs_autre`), jamais stockée dans ce module.
// ─────────────────────────────────────────────────────────────

export const REFERENTIELS_CHOIX = Object.freeze({
  // Rubrique 3 — objectifs souhaités
  objectifs_souhaites: [
    "formation", "emploi", "projet_professionnel", "reprise_scolarite", "projet_personnel",
    "competences_numeriques", "demarches_administratives", "confiance_en_soi",
    "cv_lettre_entretien", "decouverte_metiers", "mobilite", "autre",
  ],
  // Rubrique 5 — « ce que je sais faire »
  savoir_faire: [
    "travailler_equipe", "travailler_seul", "communiquer", "ecouter", "prendre_initiatives",
    "respecter_consignes", "organiser", "resoudre_problemes", "utiliser_numerique",
    "creer_imaginer", "prendre_parole", "aider_autres", "adapter", "apprendre", "perseverant",
  ],
  // Rubrique 6 — loisirs
  loisirs: [
    "sport", "musique", "jeux_video", "informatique_numerique", "creation_artistique",
    "reseaux_sociaux", "lecture", "cuisine", "mecanique", "bricolage",
    "nature_environnement", "animaux", "mode_esthetique",
  ],
  // Rubrique 7 — mobilité (cases), freins, ressources/points d'appui
  mobilite_choix: ["permis_b", "permis_en_cours", "aucun_permis", "vehicule", "transports_commun", "difficultes_mobilite"],
  freins_insertion_choix: [
    "qualification", "experience", "confiance_en_soi", "difficultes_scolaires", "numerique",
    "mobilite", "situation_administrative", "finances", "information", "motivation",
    "difficulte_projeter", "autre",
  ],
  ressources_appui: ["famille", "amis_entourage", "association", "partenaire_professionnel", "competences", "experiences", "motivation", "reseau_professionnel", "autre"],
  // Rubrique 9 — valeurs au travail
  valeurs_travail: [
    "salaire", "securite", "ambiance", "autonomie", "equipe", "contact_public",
    "creativite", "horaires", "evolution", "utilite_sociale", "mobilite", "autre",
  ],
  // Rubrique 11 — phases du parcours FSE-IA à prioriser (référence les 6
  // phases du questionnaire de positionnement, jamais un doublon de contenu).
  phases_prioritaires: ["phase_1", "phase_2", "phase_3", "phase_4", "phase_5", "phase_6"],
});

// Valide UN choix `{ groupe, code }`.
export function validerChoix(c) {
  const groupe = typeof c?.groupe === "string" ? c.groupe.trim() : "";
  const options = REFERENTIELS_CHOIX[groupe];
  if (!options) return { erreur: `Groupe de choix inconnu : ${groupe || "(vide)"}.` };
  const code = typeof c?.code === "string" ? c.code.trim() : "";
  if (!options.includes(code)) return { erreur: `Option inconnue « ${code} » pour le groupe « ${groupe} ».` };
  return { groupe, code };
}

// Valide une LISTE de choix. Refuse les doublons (groupe, code).
export function validerChoixListe(liste) {
  if (!Array.isArray(liste)) return { erreur: "Choix invalides : liste attendue." };
  const vues = new Set();
  const choix = [];
  for (const c of liste) {
    const v = validerChoix(c);
    if (v.erreur) return { erreur: v.erreur };
    const cle = `${v.groupe}::${v.code}`;
    if (vues.has(cle)) return { erreur: `Choix en double : ${cle}.` };
    vues.add(cle);
    choix.push(v);
  }
  return { choix };
}
