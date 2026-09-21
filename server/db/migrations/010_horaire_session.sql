-- ─────────────────────────────────────────────────────────────
--  Horaire d'une session, en TEXTE LIBRE et facultatif.
--  Exemple : « 8h30–12h00 / 13h00–16h30 ».
--
--  Volontairement non modélisé : ni journées, ni demi-journées, ni
--  créneaux d'émargement. Cette structure viendra avec le chantier
--  présence et assiduité ; d'ici là, l'horaire n'a qu'un usage,
--  être imprimé sur les documents via le marqueur {{horaire}}.
--
--  Additive et sans effet sur les sessions déjà enregistrées, qui
--  restent simplement sans horaire.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE sessions ADD COLUMN horaire text;
