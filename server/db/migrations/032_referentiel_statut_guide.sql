-- ─────────────────────────────────────────────────────────────
--  Audit référentiel V10 (décret n° 2026-728 du 1er août 2026) — sépare,
--  au niveau de la VERSION du référentiel, la vérification du texte
--  réglementaire de la disponibilité des précisions du guide de lecture.
--
--  Jusqu'ici, `indicateurs.texte_source_verifie` (par indicateur) était le
--  seul signal disponible, et son commentaire le limitait au « guide
--  officiel ». Avec un décret publié mais sans guide de lecture encore
--  paru, ce champ ne peut plus représenter correctement les deux
--  situations à la fois : un libellé bien vérifié contre une source
--  officielle (le décret), mais des précisions de guide (niveau attendu,
--  exemples de preuves, gradation…) non disponibles.
--
--  Additif uniquement : aucune donnée perdue, aucune table recréée.
--
--  `guide_de_lecture_disponible` : vrai par défaut, pour que les versions
--  déjà en base (V9, dont le guide existe) restent correctes sans
--  ré-import. Mis à faux explicitement pour une version dont seul le
--  texte réglementaire est disponible.
ALTER TABLE referentiel_versions
  ADD COLUMN guide_de_lecture_disponible boolean NOT NULL DEFAULT true;

-- `nb_indicateurs_attendu` : remplace la constante codée en dur « 32 »
-- côté frontend (qui ne pouvait être correcte que pour V9). NULLABLE : une
-- coquille de version fraîchement créée (POST /referentiel/versions, avant
-- tout import) n'a encore aucun indicateur, donc aucun nombre attendu à
-- afficher — l'écran doit alors simplement ne pas tenter la comparaison,
-- plutôt que d'exiger une valeur inconnue à ce stade. Rempli ici pour les
-- versions déjà en base à partir du nombre d'indicateurs réellement
-- importés (déjà validé à l'import par `validateReferentiel`, donc
-- fiable), puis alimenté par `seed.js` à chaque import futur.
ALTER TABLE referentiel_versions ADD COLUMN nb_indicateurs_attendu smallint;
UPDATE referentiel_versions v
  SET nb_indicateurs_attendu = (SELECT count(*)::smallint FROM indicateurs i WHERE i.version_id = v.id)
  WHERE nb_indicateurs_attendu IS NULL
    AND EXISTS (SELECT 1 FROM indicateurs i WHERE i.version_id = v.id);
