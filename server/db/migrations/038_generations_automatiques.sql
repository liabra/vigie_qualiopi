-- Génération automatique et conditionnelle : déclencheurs métier, conditions évaluables,
-- et file des générations planifiées (traitée en arrière-plan, sans bloquer les requêtes).
--
-- Un modèle « manuel » n'a ni déclencheur ni condition. Un modèle « automatique » a un
-- déclencheur. Un modèle « conditionnel » a un déclencheur ET une condition codée, évaluée
-- sur les données des stagiaires (le texte condition_generation reste sa description).
-- declencheur_actif_depuis borne les déclenchements par date : jamais de rattrapage massif
-- des sessions antérieures à l'activation du mode.
-- Les modèles déjà classés « automatique » ou « conditionnel » avant cette migration n'ont pas
-- de déclencheur : ils sont conservés tels quels et ne déclenchent rien tant que
-- l'administrateur n'a pas choisi un déclencheur (l'API l'exige à la prochaine modification).
ALTER TABLE modeles_documents
  ADD COLUMN declencheur text
    CHECK (declencheur IN ('creation_session', 'inscription', 'debut_session', 'fin_session')),
  ADD COLUMN condition_code text
    CHECK (condition_code IN ('situation_handicap', 'besoin_adaptation', 'prescripteur_renseigne')),
  ADD COLUMN declencheur_actif_depuis timestamptz,
  ADD CONSTRAINT modeles_declencheur_coherent CHECK (
    (declencheur IS NULL OR mode_generation <> 'manuel')
    AND (condition_code IS NULL OR (mode_generation = 'conditionnel' AND declencheur IS NOT NULL))
  );

CREATE TABLE generations_planifiees (
  id              serial PRIMARY KEY,
  modele_id       integer NOT NULL REFERENCES modeles_documents(id) ON DELETE CASCADE,
  session_id      integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  evenement       text NOT NULL CHECK (evenement IN ('creation_session', 'inscription', 'debut_session', 'fin_session')),
  statut          text NOT NULL DEFAULT 'en_attente'
                    CHECK (statut IN ('en_attente', 'faite', 'sans_objet', 'bloquee')),
  tentatives      integer NOT NULL DEFAULT 0 CHECK (tentatives >= 0),
  documents       integer,
  resultat        text,
  derniere_erreur text,
  bail_jusqu_au   timestamptz,
  cree_le         timestamptz NOT NULL DEFAULT now(),
  traite_le       timestamptz
);
-- Une seule tâche en attente par modèle, session et événement (dédoublonnage des déclenchements).
CREATE UNIQUE INDEX generations_planifiees_une_en_attente
  ON generations_planifiees (modele_id, session_id, evenement) WHERE statut = 'en_attente';
CREATE INDEX generations_planifiees_session ON generations_planifiees (session_id);

-- Historique : une génération lancée par une tâche planifiée y reste rattachée.
ALTER TABLE generations
  ADD COLUMN planification_id integer REFERENCES generations_planifiees(id) ON DELETE SET NULL;
