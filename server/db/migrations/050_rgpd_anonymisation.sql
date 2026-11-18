-- ─────────────────────────────────────────────────────────────
--  050 — Vigie 2.0 : RGPD (CDC §47). Date d'anonymisation d'une personne (droit à l'effacement ou fin de la
--  durée de conservation). Les données statistiques (présences, résultats, satisfaction) sont conservées,
--  détachées de l'identité. Additive.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE stagiaires ADD COLUMN anonymise_le timestamptz;
