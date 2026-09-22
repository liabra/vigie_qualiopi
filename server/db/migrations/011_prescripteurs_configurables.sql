-- ─────────────────────────────────────────────────────────────
--  Prescripteurs configurables.
--
--  1. La liste figée du CHECK d'`inscriptions.prescripteur` (posé par
--     la migration 005) empêchait d'ajouter un prescripteur : on la
--     retire.
--  2. Une table de référence porte désormais la liste : `code` stable,
--     `nom` affichable, `actif` pour ne plus proposer un prescripteur
--     sans pour autant le supprimer des anciennes inscriptions.
--
--  Choix d'architecture : `inscriptions.prescripteur` RESTE du texte et
--  continue de stocker le CODE. Aucune FK n'est ajoutée, aucune
--  inscription existante n'est réécrite : rien ne peut se perdre. Le
--  rapprochement code ↔ libellé se fait par l'application.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE inscriptions
  DROP CONSTRAINT IF EXISTS inscriptions_prescripteur_check;

CREATE TABLE prescripteurs (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  nom         text NOT NULL,
  actif       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER prescripteurs_updated_at BEFORE UPDATE ON prescripteurs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Valeurs historiques conservées TELLES QUELLES : les codes déjà utilisés en
-- base (`pole_emploi`, `mission_locale`, `of`, `autre`) ne sont jamais
-- renommés, pour ne rien casser sur les inscriptions existantes. `cap_emploi`
-- est ajouté à la demande.
INSERT INTO prescripteurs (code, nom) VALUES
  ('pole_emploi', 'Pôle Emploi'),
  ('mission_locale', 'Mission Locale'),
  ('of', 'Organisme de formation'),
  ('autre', 'Autre'),
  ('cap_emploi', 'CAP Emploi')
ON CONFLICT (code) DO NOTHING;
