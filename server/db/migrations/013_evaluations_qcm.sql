-- ─────────────────────────────────────────────────────────────
--  Évaluations / QCM : assouplir `resultats_qcm` SANS perte.
--
--  Les tables `resultats_qcm` et `satisfactions` existaient depuis la
--  migration 001 mais aucune route ne s'en servait. On garde le schéma,
--  on l'élargit, sans jamais réécrire ni recalculer les données.
--
--  Règles conservées ou ajoutées :
--    - types historiques conservés + qcm / validation_etape / autre ;
--    - score et score_max facultatifs, mais EN PAIRE (les deux renseignés,
--      ou les deux NULL) ; score >= 0, score_max > 0, score <= score_max ;
--    - `resultat` EXPLICITE (jamais déduit de score/seuil) ;
--    - commentaire libre.
--
--  Lignes historiques : type et score conservés, `resultat` = non_determine,
--  `commentaire` = NULL. Aucun recalcul historique.
-- ─────────────────────────────────────────────────────────────

-- 1. Types : on élargit l'énumération, `intermediaire` est conservé.
ALTER TABLE resultats_qcm DROP CONSTRAINT resultats_qcm_type_check;
ALTER TABLE resultats_qcm ADD CONSTRAINT resultats_qcm_type_check
  CHECK (type IN ('positionnement', 'intermediaire', 'qcm', 'validation_etape',
                  'evaluation_finale', 'autre'));

-- 2. Score et score_max facultatifs.
ALTER TABLE resultats_qcm ALTER COLUMN score DROP NOT NULL;
ALTER TABLE resultats_qcm ALTER COLUMN score_max DROP NOT NULL;

-- Contraintes de score assouplies : les règles ne s'appliquent que lorsque
-- les valeurs sont présentes, et la paire score/score_max reste cohérente.
ALTER TABLE resultats_qcm DROP CONSTRAINT resultats_qcm_score_check;
ALTER TABLE resultats_qcm DROP CONSTRAINT resultats_qcm_score_max_check;
ALTER TABLE resultats_qcm DROP CONSTRAINT resultats_qcm_check;

ALTER TABLE resultats_qcm ADD CONSTRAINT resultats_qcm_score_check
  CHECK (score IS NULL OR score >= 0);
ALTER TABLE resultats_qcm ADD CONSTRAINT resultats_qcm_score_max_check
  CHECK (score_max IS NULL OR score_max > 0);
ALTER TABLE resultats_qcm ADD CONSTRAINT resultats_qcm_score_pair_check
  CHECK ((score IS NULL) = (score_max IS NULL));
ALTER TABLE resultats_qcm ADD CONSTRAINT resultats_qcm_score_ordre_check
  CHECK (score IS NULL OR score_max IS NULL OR score <= score_max);

-- 3. Résultat explicite : jamais déduit automatiquement.
ALTER TABLE resultats_qcm ADD COLUMN resultat text NOT NULL DEFAULT 'non_determine'
  CHECK (resultat IN ('valide', 'non_valide', 'non_determine', 'non_applicable'));

-- 4. Commentaire libre.
ALTER TABLE resultats_qcm ADD COLUMN commentaire text;
