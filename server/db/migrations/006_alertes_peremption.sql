-- ─────────────────────────────────────────────────────────────
--  Statut de péremption des preuves à échéance : calculé une fois
--  ici, pour que le tableau de bord et l'écran Preuves ne puissent
--  pas diverger — même principe que preuves_enrichies pour les
--  fichiers manquants.
--    ok      — rien à faire
--    bientot — échéance dans moins de 30 jours
--    perime  — échéance dépassée
--    NULL    — pas de type d'alerte réglé sur cette preuve, ou
--              type « rupture_reglementaire » : pas encore câblé,
--              aucun écran ne gère la veille pour l'instant.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW preuves_enrichies AS
SELECT
  e.*,
  CASE WHEN e.incomplet AND e.statut = 'maitrise' THEN 'a_consolider' ELSE e.statut END AS statut_effectif,
  CASE
    WHEN e.type_alerte = 'revision_periodique' AND e.periodicite_mois IS NOT NULL THEN (
      CASE
        WHEN COALESCE(e.date_derniere_revision, e.created_at::date)
               + (e.periodicite_mois::text || ' months')::interval <= now() THEN 'perime'
        WHEN COALESCE(e.date_derniere_revision, e.created_at::date)
               + (e.periodicite_mois::text || ' months')::interval <= now() + interval '30 days' THEN 'bientot'
        ELSE 'ok'
      END
    )
    WHEN e.type_alerte = 'echeance_fixe' AND e.date_echeance IS NOT NULL THEN (
      CASE
        WHEN e.date_echeance <= current_date THEN 'perime'
        WHEN e.date_echeance <= current_date + 30 THEN 'bientot'
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
