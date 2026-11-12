// Reprise automatique des corbeilles en attente (3C.2) : au démarrage, puis toutes les 15 minutes.
// Un seul cycle à la fois dans ce processus ; le bail de chaque opération empêche le doublon
// entre processus. Un échec est journalisé sans bloquer le serveur (code d'erreur seulement).
import { getDrive } from "./google.js";
import { reprendreCorbeilles } from "./corbeille.js";

export const INTERVALLE_REPRISE_MS = 15 * 60 * 1000;

export function demarrerRepriseCorbeille({
  intervalleMs = INTERVALLE_REPRISE_MS, obtenirDrive = getDrive, journal = console,
} = {}) {
  let enCours = null;

  const cycle = () => {
    if (enCours) return enCours;
    enCours = (async () => {
      try {
        const d = await obtenirDrive();
        const { reprises } = await reprendreCorbeilles({ drive: d?.drive ?? null });
        const confirmees = reprises.filter((r) => r.statut === "confirmee").length;
        if (reprises.length) journal.log(`Reprise corbeille : ${reprises.length} opération(s), ${confirmees} confirmée(s).`);
      } catch (e) {
        journal.error("Reprise corbeille : " + (e?.code || "erreur inattendue"));
      } finally {
        enCours = null;
      }
    })();
    return enCours;
  };

  const minuteur = setInterval(cycle, intervalleMs);
  minuteur.unref();
  // Démarrage : asynchrone, n'attend ni Drive ni l'écoute HTTP.
  setImmediate(cycle);

  return {
    cycle,
    async arreter() {
      clearInterval(minuteur);
      await enCours;
    },
  };
}
