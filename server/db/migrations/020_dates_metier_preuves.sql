-- ─────────────────────────────────────────────────────────────
--  TIME-2 — Péremption des preuves au jour civil de Cayenne.
--
--  La vue preuves_enrichies (006) jugeait la péremption avec la date de
--  la SESSION PostgreSQL (CURRENT_DATE, et une comparaison à now() d'une
--  date sans fuseau) : en UTC sur Railway, une preuve pouvait passer
--  « périmée » à 21 h la veille de son échéance à Cayenne.
--
--  Seule la date de référence change : jour civil à Cayenne,
--  (now() AT TIME ZONE 'America/Cayenne')::date, et jour de création à
--  Cayenne pour une preuve jamais révisée. Règles (<=, 30 jours, mois de
--  périodicité), colonnes, types et ordre : identiques à 006 (même
--  expansion de c.* / e.*). CREATE OR REPLACE : aucune suppression,
--  aucune donnée touchée, aucune vue dépendante.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW preuves_enrichies AS
SELECT
  e.*,
  CASE WHEN e.incomplet AND e.statut = 'maitrise' THEN 'a_consolider' ELSE e.statut END AS statut_effectif,
  CASE
    WHEN e.type_alerte = 'revision_periodique' AND e.periodicite_mois IS NOT NULL THEN (
      CASE
        WHEN COALESCE(e.date_derniere_revision, (e.created_at AT TIME ZONE 'America/Cayenne')::date)
               + (e.periodicite_mois::text || ' months')::interval <= (now() AT TIME ZONE 'America/Cayenne')::date THEN 'perime'
        WHEN COALESCE(e.date_derniere_revision, (e.created_at AT TIME ZONE 'America/Cayenne')::date)
               + (e.periodicite_mois::text || ' months')::interval <= (now() AT TIME ZONE 'America/Cayenne')::date + 30 THEN 'bientot'
        ELSE 'ok'
      END
    )
    WHEN e.type_alerte = 'echeance_fixe' AND e.date_echeance IS NOT NULL THEN (
      CASE
        WHEN e.date_echeance <= (now() AT TIME ZONE 'America/Cayenne')::date THEN 'perime'
        WHEN e.date_echeance <= (now() AT TIME ZONE 'America/Cayenne')::date + 30 THEN 'bientot'
        ELSE 'ok'
      END
    )
    ELSE NULL
  END AS alerte_statut
FROM (
  SELECT
    c.*,
    (
      c.mode_fichiers <> 'unique'
      AND c.statut <> 'non_applicable'
      AND (
        (c.fichiers_attendus IS NOT NULL AND c.nb_fichiers < c.fichiers_attendus)
        -- par_stagiaire sans session rattachée : on ne PEUT pas prouver
        -- que le compte est atteint, donc il ne l'est pas.
        OR (c.fichiers_attendus IS NULL AND (c.mode_fichiers = 'par_stagiaire' OR c.nb_fichiers = 0))
      )
    ) AS incomplet
  FROM preuves_comptees c
) e;
