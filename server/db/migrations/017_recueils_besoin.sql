-- ─────────────────────────────────────────────────────────────
--  Q2-1 — Recueil du besoin et positionnement (parcours bénéficiaire).
--
--  Additif uniquement : aucune table existante modifiée (ni inscriptions,
--  ni resultats_qcm, ni stagiaires). Aucun backfill : une inscription sans
--  ligne ici a un recueil « non commencé » — jamais de fausse date ni de
--  fausse intervention passée.
--
--  Besoins de FORMATION seulement : aucun diagnostic, aucune donnée
--  médicale (l'interface le rappelle). Textes bornés.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE recueils_besoin (
  id                    serial PRIMARY KEY,
  -- Un seul recueil par inscription.
  inscription_id        integer NOT NULL UNIQUE REFERENCES inscriptions(id) ON DELETE CASCADE,
  statut                text NOT NULL DEFAULT 'a_faire'
                          CHECK (statut IN ('a_faire', 'realise', 'non_applicable')),
  date_recueil          date,
  attentes              text CHECK (char_length(attentes) <= 2000),
  objectifs_personnels  text CHECK (char_length(objectifs_personnels) <= 2000),
  prerequis_verifies    text CHECK (prerequis_verifies IN ('oui', 'non', 'partiel')),
  conclusion            text CHECK (conclusion IN ('parcours_standard', 'parcours_adapte', 'reorientation', 'a_preciser')),
  -- Positionnement existant (resultats_qcm, type « positionnement ») de la
  -- MÊME inscription : appartenance et type vérifiés par le serveur.
  positionnement_id     integer REFERENCES resultats_qcm(id) ON DELETE SET NULL,
  realise_par           integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le               timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recueils_besoin_positionnement ON recueils_besoin (positionnement_id);
