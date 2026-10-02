// ─────────────────────────────────────────────────────────────
//  Q5 — Poste de pilotage (Accueil) : priorités PURES, testables.
//
//  ORDRE FIXE des priorités (du plus urgent au plus anticipé) :
//    1. actions qualité en retard          (admin : toutes ; contributeur : les siennes)
//    2. réclamations en retard             (admin)
//    3. efficacité à vérifier              (admin)
//    4. preuves périmées                   (admin)
//    5. justificatifs périmés              (admin)
//    6. pièces attendues manquantes        (admin)
//    7. preuves à confirmer                (admin)
//    8. dossiers stagiaires à compléter    (par session)
//    9. recueils du besoin à réaliser      (par session)
//   10. mesures pédagogiques à mettre en œuvre (par session)
//   11. justificatifs bientôt à renouveler (admin)
//   12. preuves à revoir bientôt           (admin)
//   13. veille : actions à réaliser        (admin)
//  Sessions : ordre de date de début, puis identifiant. Au plus 10 lignes ;
//  « voir davantage » seulement vers une destination réelle (/sessions).
//  Chaque lien mène à une fiche, un onglet ou un filtre QUI EXISTE.
// ─────────────────────────────────────────────────────────────
export const MAX_PRIORITES = 10;
const pl = (n, sing, plur) => `${n} ${n > 1 ? plur : sing}`;

export function prioritesPilotage(d, admin) {
  const lignes = [];
  const ajoute = (cle, n, libelle, to, ton = "warning", session = false) => { if (n > 0) lignes.push({ cle, nombre: n, libelle, to, ton, session }); };
  const retard = admin ? d.qualite?.actions_en_retard ?? 0 : d.mes_actions?.en_retard ?? 0;
  const uneEnRetard = admin ? null : d.mes_actions?.liste?.find((a) => a.en_retard);
  ajoute("actions_retard", retard, `${pl(retard, "action qualité en retard", "actions qualité en retard")}${admin ? "" : " (attribuée(s) à vous)"}`,
    !admin && retard === 1 && uneEnRetard ? `/actions-qualite/${uneEnRetard.id}` : "/actions-qualite", "error");
  if (admin) {
    const q = d.qualite || {}, p = d.preuves || {}, j = d.justificatifs || {};
    ajoute("reclamations_retard", q.reclamations_en_retard, pl(q.reclamations_en_retard, "réclamation en retard", "réclamations en retard"), "/signalements-qualite?type=reclamation", "error");
    ajoute("efficacite", q.efficacite_a_verifier, pl(q.efficacite_a_verifier, "action dont l'efficacité est à vérifier", "actions dont l'efficacité est à vérifier"), "/actions-qualite?statut=efficacite_a_verifier");
    ajoute("preuves_perimees", p.perimees, pl(p.perimees, "preuve périmée", "preuves périmées"), "/preuves?alerte=perime", "error");
    ajoute("justificatifs_perimes", j.perimes, pl(j.perimes, "justificatif d'intervenant périmé", "justificatifs d'intervenants périmés"), "/justificatifs-intervenants", "error");
    ajoute("justificatifs_manquants", j.manquants, pl(j.manquants, "pièce attendue manquante (intervenants)", "pièces attendues manquantes (intervenants)"), "/justificatifs-intervenants");
    ajoute("preuves_a_confirmer", p.a_confirmer, pl(p.a_confirmer, "preuve à confirmer", "preuves à confirmer"), "/preuves?a_confirmer=1");
  }
  const sessions = [...(d.sessions_suivi || [])].sort((a, b) => String(a.date_debut).localeCompare(String(b.date_debut)) || a.id - b.id);
  for (const s of sessions) ajoute(`dossiers:${s.id}`, s.dossiers_incomplets, `${pl(s.dossiers_incomplets, "dossier stagiaire à compléter", "dossiers stagiaires à compléter")} — ${s.reference || "session"}`, `/sessions/${s.id}/stagiaires`, "warning", true);
  for (const s of sessions) ajoute(`recueils:${s.id}`, s.recueils_a_faire, `${pl(s.recueils_a_faire, "recueil du besoin à réaliser", "recueils du besoin à réaliser")} — ${s.reference || "session"}`, `/sessions/${s.id}/parcours`, "warning", true);
  for (const s of sessions) ajoute(`mesures:${s.id}`, s.mesures_prevues, `${pl(s.mesures_prevues, "mesure pédagogique à mettre en œuvre", "mesures pédagogiques à mettre en œuvre")} — ${s.reference || "session"}`, `/sessions/${s.id}/parcours`, "warning", true);
  if (admin) {
    const p = d.preuves || {}, j = d.justificatifs || {};
    ajoute("justificatifs_bientot", j.bientot, pl(j.bientot, "justificatif d'intervenant à renouveler bientôt", "justificatifs d'intervenants à renouveler bientôt"), "/justificatifs-intervenants", "info");
    ajoute("preuves_bientot", p.bientot, pl(p.bientot, "preuve à revoir bientôt", "preuves à revoir bientôt"), "/preuves?alerte=bientot", "info");
    ajoute("veille", d.veille_actions ?? 0, pl(d.veille_actions ?? 0, "action de veille à réaliser", "actions de veille à réaliser"), "/veille?vue=actions", "info");
  }
  const visibles = lignes.slice(0, MAX_PRIORITES);
  const restantes = lignes.slice(MAX_PRIORITES);
  return {
    lignes: visibles.map(({ session, ...l }) => l),
    reste: restantes.length,
    // Destination réelle seulement : les lignes masquées concernent des sessions.
    voir_davantage: restantes.some((l) => l.session) ? { libelle: "Voir toutes les sessions", to: "/sessions" } : null,
  };
}
