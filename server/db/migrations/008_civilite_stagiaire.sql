-- ─────────────────────────────────────────────────────────────
--  Civilité du stagiaire, pour le marqueur {{civilite}} des
--  documents générés (attestations, convocations…).
--
--  Volontairement NULLABLE : les stagiaires déjà saisis n'en ont
--  pas, et une civilité absente ne doit rien casser — le marqueur
--  est alors remplacé par une chaîne vide, comme tout marqueur sans
--  valeur (voir marqueurs.js).
-- ─────────────────────────────────────────────────────────────

ALTER TABLE stagiaires
  ADD COLUMN civilite text CHECK (civilite IN ('M.', 'Mme'));
