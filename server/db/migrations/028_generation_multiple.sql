-- ─────────────────────────────────────────────────────────────
--  DOC-10D — Documents réutilisables à plusieurs occurrences.
--
--  Certains modèles de portée non-stagiaire (ex. compte rendu d'entretien
--  prescripteur/entreprise) doivent pouvoir être générés PLUSIEURS FOIS
--  pour une même session — un par prescripteur rencontré — sans que
--  l'unicité existante (un seul document vivant par modèle/session/
--  groupe/stagiaire) n'écrase les précédents.
--
--  Additif uniquement : aucune table existante modifiée en profondeur,
--  aucune donnée perdue. `generation_multiple` reste FAUX par défaut :
--  le comportement de tous les modèles existants (un seul document,
--  régénérer remplace) est inchangé tant que ce drapeau n'est pas
--  explicitement activé pour un modèle donné.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE modeles_documents
  ADD COLUMN generation_multiple boolean NOT NULL DEFAULT false;

-- Étiquette libre qui distingue deux générations du MÊME modèle pour la
-- MÊME session (ex. le prescripteur concerné) — jamais une donnée
-- personnelle obligatoire, jamais interprétée par le moteur de blocs.
-- NULL pour tous les documents déjà générés : ils gardent leur identité.
ALTER TABLE documents_generes
  ADD COLUMN libelle text;

-- L'unicité porte maintenant aussi sur le libellé : deux générations avec
-- des libellés différents (ou l'un vide, l'autre non) ne se remplacent
-- jamais l'une l'autre ; deux générations avec le MÊME libellé continuent
-- de se remplacer, comme avant pour tous les autres modèles (libellé NULL
-- partout ⇒ comportement identique à l'ancien index).
DROP INDEX documents_generes_unicite;
CREATE UNIQUE INDEX documents_generes_unicite
  ON documents_generes (modele_id, COALESCE(session_id, 0), COALESCE(groupe_id, 0),
                         COALESCE(stagiaire_id, 0), COALESCE(libelle, ''));
