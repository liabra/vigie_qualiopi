-- Journal des mises à la corbeille de versions Drive.
--   en_attente : préparée, reprise automatiquement (et version réservée) ;
--   bloquee    : ne peut plus aboutir sans décision administrateur (motif conservé, réservation maintenue) ;
--   confirmee  : suppression Drive confirmée en base ;
--   abandonnee : décision administrateur de ne pas poursuivre (motif conservé, réservation levée).
CREATE TABLE corbeille_operations (
  id              serial PRIMARY KEY,
  document_id     integer NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  numero          smallint NOT NULL CHECK (numero >= 1),
  drive_file_id   text NOT NULL,
  statut          text NOT NULL CHECK (statut IN ('en_attente', 'bloquee', 'confirmee', 'abandonnee')),
  cree_par        integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le         timestamptz NOT NULL DEFAULT now(),
  confirmee_le    timestamptz,
  derniere_erreur text,
  -- Bail de reprise : durée limitée, renouvelée pendant l'appel Drive, identifiée par un jeton.
  bail_jusqu_au   timestamptz,
  bail_jeton      text,
  -- Échecs de reprise consécutifs ; au seuil, l'opération passe en « bloquee » (motif echec_repete).
  tentatives      integer NOT NULL DEFAULT 0 CHECK (tentatives >= 0),
  -- Motif de blocage (code), date de blocage.
  motif           text,
  bloquee_le      timestamptz,
  -- Décision administrateur (abandon) : auteur, date, motif écrit.
  decision_par    integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  decision_le     timestamptz,
  decision_motif  text,
  CHECK (statut <> 'bloquee' OR motif IS NOT NULL),
  CHECK (statut <> 'abandonnee' OR (decision_le IS NOT NULL AND decision_motif IS NOT NULL))
);
-- Une seule opération non terminée par version (en attente ou bloquée).
CREATE UNIQUE INDEX corbeille_une_non_terminee
  ON corbeille_operations (document_id, numero) WHERE statut IN ('en_attente', 'bloquee');
