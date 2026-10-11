// ─────────────────────────────────────────────────────────────
//  Formatage PUR, partagé entre marqueurs.js (les 23 marqueurs
//  historiques) et resolversCanoniques.js (le catalogue) : UNE seule
//  mise en forme des dates et des durées, jamais deux qui pourraient
//  diverger. Module neutre : ni l'un ni l'autre ne dépend de l'autre.
// ─────────────────────────────────────────────────────────────

// Les dates arrivent en « AAAA-MM-JJ » (voir db.js, qui garde les
// colonnes DATE en texte) et repartent en « JJ/MM/AAAA ».
export function formaterDate(valeur) {
  if (!valeur) return "";
  const texte = typeof valeur === "string" ? valeur : valeur.toISOString().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texte);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : texte;
}

// « 14 » et « 14.00 » s'écrivent tous les deux « 14 h ».
export function formaterDuree(heures) {
  if (heures === null || heures === undefined || heures === "") return "";
  const n = Number(heures);
  if (Number.isNaN(n)) return String(heures);
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} h`;
}

// DOC-4C — Durée affichée sur l'attestation : durée de session déclarée,
// sinon durée de la version de formation, au format historique « N h ».
// Source unique partagée entre le marqueur historique `duree` et la
// canonique document_duree_attestation — jamais deux calculs divergents.
export function dureeAttestation(ctx = {}) {
  return formaterDuree(ctx.session?.duree_heures_reelle ?? ctx.version?.duree_heures_defaut ?? null);
}
