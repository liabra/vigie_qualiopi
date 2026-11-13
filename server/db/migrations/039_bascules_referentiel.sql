-- Bascule de référentiel (ex. V9 → V10) : journal des activations avec report des
-- rattachements. Le report relie, par numéro d'indicateur, les preuves, modèles, veilles,
-- signalements, actions et marquages « non applicable » de l'ancienne version à la nouvelle.
-- Rejouer la bascule en sens inverse (réactiver l'ancienne version avec report) les y ramène.
CREATE TABLE bascules_referentiel (
  id                   serial PRIMARY KEY,
  ancienne_version_id  integer REFERENCES referentiel_versions(id) ON DELETE SET NULL,
  nouvelle_version_id  integer NOT NULL REFERENCES referentiel_versions(id) ON DELETE CASCADE,
  report               boolean NOT NULL,
  bilan                jsonb NOT NULL DEFAULT '{}'::jsonb,
  par                  integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le              timestamptz NOT NULL DEFAULT now()
);
