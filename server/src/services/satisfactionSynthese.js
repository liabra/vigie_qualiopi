// ─────────────────────────────────────────────────────────────
//  Q3-2 — Synthèse des satisfactions (multi-sessions) : agrégation PURE.
//
//  Règles validées :
//    - jamais de moyenne mélangeant des échelles : une moyenne PAR échelle
//      (note_max), la note n'est jamais convertie ;
//    - taux de réponse : AUCUN dénominateur fiable n'existe dans Vigie (le
//      nombre de personnes réellement sollicitées n'est pas enregistré ;
//      l'effectif d'une session n'en est pas un) ⇒ toujours indisponible ;
//    - aucune donnée individuelle : ni répondant, ni commentaire, ni
//      réponse, ni fichier — uniquement des comptes et des moyennes.
// ─────────────────────────────────────────────────────────────
export const MSG_TAUX_INDISPONIBLE = "Taux de réponse non disponible";
const arrondi = (n) => Math.round(n * 100) / 100;

export function synthetiserSatisfactions(rows) {
  const publics = new Map();
  const echelles = new Map();
  const sessions = new Map();
  let du = null, au = null, sansNote = 0;
  for (const r of rows) {
    publics.set(r.type, (publics.get(r.type) || 0) + 1);
    const d = String(r.date_recueil).slice(0, 10);
    if (!du || d < du) du = d;
    if (!au || d > au) au = d;
    if (!sessions.has(r.session_id)) {
      sessions.set(r.session_id, { id: r.session_id, reference: r.reference, formation_id: r.formation_id, formation: r.formation,
        date_debut: r.date_debut, date_fin: r.date_fin, reponses: 0 });
    }
    sessions.get(r.session_id).reponses++;
    if (r.note_globale === null || r.note_globale === undefined) { sansNote++; continue; }
    const echelle = Number(r.note_max);
    if (!echelles.has(echelle)) echelles.set(echelle, []);
    echelles.get(echelle).push(Number(r.note_globale));
  }
  return {
    reponses: rows.length,
    periode: { du, au },
    publics: [...publics.entries()].map(([type, reponses]) => ({ type, reponses })).sort((a, b) => b.reponses - a.reponses || a.type.localeCompare(b.type)),
    echelles: [...echelles.entries()].sort((a, b) => a[0] - b[0]).map(([echelle, notes]) => {
      const rep = new Map();
      for (const n of notes) rep.set(n, (rep.get(n) || 0) + 1);
      return {
        echelle, reponses: notes.length,
        moyenne: arrondi(notes.reduce((a, n) => a + n, 0) / notes.length),
        repartition: [...rep.entries()].sort((a, b) => a[0] - b[0]).map(([note, reponses]) => ({ note, reponses })),
      };
    }),
    sans_note: sansNote,
    // Plusieurs échelles ⇒ aucune moyenne globale (jamais de mélange).
    moyenne_globale: echelles.size === 1 ? arrondi([...echelles.values()][0].reduce((a, n) => a + n, 0) / [...echelles.values()][0].length) : null,
    sessions: [...sessions.values()].sort((a, b) => String(b.date_debut).localeCompare(String(a.date_debut)) || a.id - b.id),
    taux: { disponible: false, message: MSG_TAUX_INDISPONIBLE },
  };
}
