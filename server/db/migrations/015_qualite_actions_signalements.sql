-- ─────────────────────────────────────────────────────────────
--  Q1 — Cœur qualité : signalements (réclamation / incident /
--  non-conformité) + actions qualité centrales.
--
--  Additif uniquement : aucune colonne existante modifiée, aucune
--  donnée supprimée ou réécrite. Aucun hard delete : annulation et
--  clôture sont des STATUTS, tracés dans `historique_qualite`.
--
--  L'intégration des modules existants (veille, audits, satisfaction…)
--  viendra module par module, avec de vraies relations DB — jamais via
--  des identifiants polymorphiques non vérifiables.
-- ─────────────────────────────────────────────────────────────

-- ── Signalements qualité (réclamation / incident / non-conformité) ──
-- `date_constat` : date de RÉCEPTION (réclamation) ou date de CONSTAT /
-- DÉTECTION (incident, non-conformité) — un seul champ, lisible, dont la
-- signification dépend du type.
CREATE TABLE signalements_qualite (
  id                        serial PRIMARY KEY,
  reference                 text NOT NULL UNIQUE,
  type                      text NOT NULL
                              CHECK (type IN ('reclamation', 'incident', 'non_conformite')),
  date_constat              date,
  canal                     text CHECK (canal IN ('email', 'poste', 'autre')),
  objet                     text NOT NULL,
  description               text,
  -- Données du réclamant (minimum utile au pilotage, jamais d'adresse
  -- postale complète ni de texte brut de courriel : ces documents
  -- restent sur Drive).
  reclamant_nom             text,
  reclamant_entreprise      text,
  reclamant_email           text,
  -- Personne concernée : une inscription Vigie existante si possible,
  -- sinon un libellé libre pour une personne externe non enregistrée.
  inscription_id            integer REFERENCES inscriptions(id) ON DELETE SET NULL,
  personne_concernee_libelle text,
  responsable_id            integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  formation_id              integer REFERENCES formations(id) ON DELETE SET NULL,
  session_id                integer REFERENCES sessions(id) ON DELETE SET NULL,
  -- « Autre » parmi les causes : libellé explicatif.
  cause_autre_libelle       text,
  statut                    text NOT NULL DEFAULT 'ouverte'
                              CHECK (statut IN ('ouverte', 'qualifiee', 'en_traitement',
                                                'resolue', 'cloturee', 'annulee')),
  -- Règle de traitement conservée SUR LE DOSSIER (préserve la règle
  -- historique appliquée). Échéance indicative lundi-vendredi.
  delai_cible_jours_ouvres  smallint CHECK (delai_cible_jours_ouvres > 0),
  date_echeance_cible       date,
  synthese_reponse          text,
  date_reponse              date,
  date_resolution           date,
  date_cloture              date,
  cree_par                  integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cloture_par               integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  annulee_par               integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signalements_statut ON signalements_qualite (statut);
CREATE INDEX signalements_responsable ON signalements_qualite (responsable_id);
CREATE INDEX signalements_formation ON signalements_qualite (formation_id);
CREATE INDEX signalements_session ON signalements_qualite (session_id);

-- Causes 0..N par signalement (Organisation, Pédagogie, Communication,
-- Logistique, Autre). `libelle` n'a de sens que pour `autre`.
CREATE TABLE signalements_qualite_causes (
  signalement_id integer NOT NULL REFERENCES signalements_qualite(id) ON DELETE CASCADE,
  cause          text NOT NULL
                   CHECK (cause IN ('organisation', 'pedagogie', 'communication',
                                    'logistique', 'autre')),
  libelle        text,
  PRIMARY KEY (signalement_id, cause)
);

-- ── Actions qualité ───────────────────────────────────────────
CREATE TABLE actions_qualite (
  id                        serial PRIMARY KEY,
  reference                 text NOT NULL UNIQUE,
  titre                     text NOT NULL,
  constat                   text,
  signalement_id            integer REFERENCES signalements_qualite(id) ON DELETE SET NULL,
  -- Catégorie métier d'origine (utile au filtrage), SANS remplacer la FK.
  origine                   text NOT NULL DEFAULT 'manuel'
                              CHECK (origine IN ('manuel', 'signalement')),
  formation_id              integer REFERENCES formations(id) ON DELETE SET NULL,
  session_id                integer REFERENCES sessions(id) ON DELETE SET NULL,
  responsable_id            integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  priorite                  text CHECK (priorite IN ('basse', 'normale', 'haute', 'urgente')),
  echeance                  date,
  action_prevue             text,
  date_mise_en_oeuvre       date,
  statut                    text NOT NULL DEFAULT 'a_faire'
                              CHECK (statut IN ('a_faire', 'en_cours', 'realisee',
                                                'efficacite_a_verifier', 'cloturee', 'annulee')),
  resultat                  text,
  controle_efficacite       text,
  date_controle_efficacite  date,
  date_cloture              date,
  cree_par                  integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cloture_par               integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  annulee_par               integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  -- Cohérence origine / signalement_id : aucune dérive possible.
  CHECK (
    (origine = 'signalement' AND signalement_id IS NOT NULL)
    OR (origine = 'manuel' AND signalement_id IS NULL)
  )
);
CREATE INDEX actions_statut ON actions_qualite (statut);
CREATE INDEX actions_echeance ON actions_qualite (echeance);
CREATE INDEX actions_responsable ON actions_qualite (responsable_id);
CREATE INDEX actions_signalement ON actions_qualite (signalement_id);
CREATE INDEX actions_formation ON actions_qualite (formation_id);
CREATE INDEX actions_session ON actions_qualite (session_id);

-- ── Rattachement aux indicateurs du référentiel VERSIONNÉ ─────
-- Jamais de numéro (31, 32…) codé en dur : l'identifiant appartient
-- à une version du référentiel.
CREATE TABLE signalements_qualite_indicateurs (
  signalement_id integer NOT NULL REFERENCES signalements_qualite(id) ON DELETE CASCADE,
  indicateur_id  integer NOT NULL REFERENCES indicateurs(id) ON DELETE CASCADE,
  PRIMARY KEY (signalement_id, indicateur_id)
);

CREATE TABLE actions_qualite_indicateurs (
  action_id      integer NOT NULL REFERENCES actions_qualite(id) ON DELETE CASCADE,
  indicateur_id  integer NOT NULL REFERENCES indicateurs(id) ON DELETE CASCADE,
  PRIMARY KEY (action_id, indicateur_id)
);

-- ── Historique append-only ────────────────────────────────────
-- `updated_at` ne suffit pas : on trace les événements métier.
-- `ancienne_valeur` / `nouvelle_valeur` : textes courts (statut, champ
-- changé, identifiant). Aucune donnée sensible du réclamant n'y est
-- recopiée : pour un champ de contenu, on ne journalise que le FAIT
-- de la modification, pas le contenu.
CREATE TABLE historique_qualite (
  id              bigserial PRIMARY KEY,
  entite_type     text NOT NULL CHECK (entite_type IN ('signalement', 'action')),
  entite_id       integer NOT NULL,
  evenement       text NOT NULL,
  champ           text,
  ancienne_valeur text,
  nouvelle_valeur text,
  par             integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX historique_qualite_entite ON historique_qualite (entite_type, entite_id, cree_le);

-- ── Références lisibles, transactionnelles et sûres en concurrence ──
-- Une ligne par (année, type) ; l'incrément atomique se fait par un
-- INSERT ... ON CONFLICT DO UPDATE RETURNING (jamais MAX()+1).
CREATE TABLE compteurs_qualite (
  annee   smallint NOT NULL,
  type    text NOT NULL CHECK (type IN ('AQ', 'REC', 'INC', 'NC')),
  dernier integer NOT NULL DEFAULT 0,
  PRIMARY KEY (annee, type)
);

-- ── updated_at automatique sur les nouvelles tables ───────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['signalements_qualite', 'actions_qualite'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t || '_updated_at', t
    );
  END LOOP;
END $$;
