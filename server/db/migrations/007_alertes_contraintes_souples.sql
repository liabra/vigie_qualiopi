-- ─────────────────────────────────────────────────────────────
--  Le réglage d'une échéance se fait en DEUX TEMPS dans l'écran
--  Preuves : on choisit d'abord le type, et le champ de valeur
--  (périodicité ou date) n'apparaît qu'ensuite. Les contraintes
--  d'origine, posées en 001, exigeaient les deux dans la même
--  écriture : le premier enregistrement échouait donc toujours, et
--  le réglage était purement inatteignable.
--
--  L'état « type choisi, valeur pas encore saisie » est transitoire
--  et déjà traité proprement en aval : la vue preuves_enrichies
--  (migration 006) ne calcule une alerte que si la valeur existe
--  (`AND periodicite_mois IS NOT NULL`, `AND date_echeance IS NOT
--  NULL`), et laisse sinon alerte_statut à NULL, c'est-à-dire
--  « aucune alerte calculée ». Ce n'est pas une incohérence, c'est
--  une échéance encore à configurer.
--
--  On relâche donc la contrainte en base plutôt que de contraindre
--  la saisie. L'écran, lui, signale visuellement une échéance
--  incomplète pour qu'elle ne passe jamais pour un réglage terminé.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE preuves DROP CONSTRAINT preuves_check;
ALTER TABLE preuves DROP CONSTRAINT preuves_check1;
