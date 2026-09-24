// Arrêt propre du processus (SIGTERM de Railway au remplacement d'un
// déploiement, SIGINT en local) : on cesse d'accepter des connexions, on
// laisse finir les requêtes en cours, on ferme le pool PostgreSQL, puis on
// sort. Un délai de sécurité force la sortie si une requête traîne.
export const DELAI_ARRET_MS = 10_000;

export function arreterProprement(server, {
  closePool, signal = "SIGTERM", delaiMs = DELAI_ARRET_MS,
  log = console.log, logErreur = console.error, sortir = (code) => process.exit(code),
} = {}) {
  log(`Signal ${signal} reçu : arrêt en cours (nouvelles connexions refusées).`);
  const forcer = setTimeout(() => {
    logErreur(`Arrêt forcé : requêtes encore en cours après ${delaiMs} ms.`);
    server.closeAllConnections?.();
    sortir(1);
  }, delaiMs);
  forcer.unref();

  return new Promise((resolve) => {
    server.close(async (err) => {
      let code = 0;
      if (err) {
        logErreur("Arrêt — fermeture du serveur HTTP : " + err.message);
        code = 1;
      }
      try {
        await closePool();
      } catch (e) {
        logErreur("Arrêt — fermeture du pool PostgreSQL : " + (e.message || "erreur inconnue"));
        code = 1;
      }
      clearTimeout(forcer);
      log(code === 0 ? "Arrêt propre terminé." : "Arrêt terminé avec erreur.");
      sortir(code);
      resolve(code);
    });
    // Connexions keep-alive inactives : sans cela, close() attendrait leur
    // expiration naturelle alors qu'aucune requête n'y est en cours.
    server.closeIdleConnections?.();
  });
}

// Branche SIGTERM/SIGINT une seule fois ; un second signal pendant l'arrêt
// est ignoré (le délai de sécurité reste l'unique issue forcée).
export function installerArretPropre(server, options = {}) {
  let enCours = false;
  const surSignal = (signal) => {
    if (enCours) return;
    enCours = true;
    arreterProprement(server, { ...options, signal });
  };
  process.on("SIGTERM", surSignal);
  process.on("SIGINT", surSignal);
  return () => {
    process.off("SIGTERM", surSignal);
    process.off("SIGINT", surSignal);
  };
}
