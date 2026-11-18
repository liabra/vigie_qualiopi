-- ─────────────────────────────────────────────────────────────
--  Q2-4 — Questionnaires personnalisables par formation (fiche d'analyse
--  des besoins et de positionnement, partie B).
--
--  Additif uniquement : aucune table existante modifiée. Le questionnaire
--  eSenior (pages 3-4 du document actuel) N'EST PAS repris ici — son
--  document et son usage actuels restent inchangés. Ce socle ne sert, pour
--  l'instant, qu'aux formations qui n'ont pas encore de questionnaire.
--
--  1. `questionnaires` : UN questionnaire par formation (pas par version —
--     les questions ne sont pas un contenu pédagogique figé par version).
--  2. `questionnaire_questions` : questions ORDONNÉES. `archivee` plutôt
--     qu'une suppression physique : une question retirée du formulaire ne
--     doit jamais faire disparaître les réponses déjà recueillies
--     (traçabilité Qualiopi) ni casser leur relecture.
--  3. `questionnaire_reponses` : rattachées à l'INSCRIPTION (pas au
--     stagiaire — une même personne peut repasser la formation). Chaque
--     réponse porte un INSTANTANÉ de la question au moment de la saisie
--     (question_libelle/question_type/question_options) : modifier ou
--     archiver la question ensuite ne change JAMAIS ni l'affichage ni le
--     sens des réponses déjà enregistrées.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE questionnaires (
  id            serial PRIMARY KEY,
  -- Un seul questionnaire par formation.
  formation_id  integer NOT NULL UNIQUE REFERENCES formations(id) ON DELETE CASCADE,
  nom           text NOT NULL CHECK (char_length(btrim(nom)) BETWEEN 1 AND 200),
  actif         boolean NOT NULL DEFAULT true,
  cree_par      integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER questionnaires_updated_at BEFORE UPDATE ON questionnaires
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE questionnaire_questions (
  id               serial PRIMARY KEY,
  questionnaire_id integer NOT NULL REFERENCES questionnaires(id) ON DELETE CASCADE,
  ordre            smallint NOT NULL CHECK (ordre BETWEEN 1 AND 100),
  libelle          text NOT NULL CHECK (char_length(btrim(libelle)) BETWEEN 1 AND 500),
  type             text NOT NULL CHECK (type IN ('texte_libre', 'choix_unique', 'choix_multiple', 'oui_non')),
  -- Options SAISIES PAR L'ADMIN (texte libre, pas un référentiel fermé
  -- global) : utilisées seulement pour choix_unique / choix_multiple.
  options          text[] NOT NULL DEFAULT '{}',
  obligatoire      boolean NOT NULL DEFAULT false,
  archivee         boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (questionnaire_id, ordre)
);
CREATE INDEX questionnaire_questions_questionnaire ON questionnaire_questions (questionnaire_id, ordre);
CREATE TRIGGER questionnaire_questions_updated_at BEFORE UPDATE ON questionnaire_questions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE questionnaire_reponses (
  id                serial PRIMARY KEY,
  question_id       integer REFERENCES questionnaire_questions(id) ON DELETE SET NULL,
  inscription_id    integer NOT NULL REFERENCES inscriptions(id) ON DELETE CASCADE,
  -- Instantané de la question AU MOMENT du recueil (dernier enregistrement
  -- de CETTE réponse) — jamais recalculé depuis la question en vigueur.
  question_libelle  text NOT NULL,
  question_type     text NOT NULL CHECK (question_type IN ('texte_libre', 'choix_unique', 'choix_multiple', 'oui_non')),
  question_options  text[] NOT NULL DEFAULT '{}',
  valeur_texte      text CHECK (char_length(valeur_texte) <= 2000),
  valeurs_choisies  text[] NOT NULL DEFAULT '{}',
  renseigne_par     integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le           timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, inscription_id)
);
-- Lecture par inscription, dans l'ordre de la question au moment de la
-- saisie (une question archivée depuis n'a plus d'ordre courant fiable).
CREATE INDEX questionnaire_reponses_inscription ON questionnaire_reponses (inscription_id, id);
