-- ─────────────────────────────────────────────────────────────
--  DOC-9E — Génération de la fiche FSE-IA depuis un entretien VALIDÉ.
--
--  Additif uniquement : aucune table existante modifiée en profondeur.
--
--  Le modèle Drive officiel (`1UFNfiGHItkI8w8jsTGd2_07SvkQMbY8Y8j7cZbezVt0`)
--  reste inaccessible dans cet environnement (DOC-9D2/DOC-9E) : la fiche
--  n'est donc PAS une copie du modèle via `modeles_documents`/
--  `documents_generes` (qui suppose un fichier Drive réellement enregistré),
--  mais un document Google Docs créé directement par Vigie, à partir des
--  données structurées de l'entretien. Ce choix est documenté dans
--  `VIGIE_AGENT_LOG.md` — à réconcilier avec le modèle officiel dès que son
--  accès sera rétabli.
--
--  Un seul document vivant par entretien : régénérer exige une
--  confirmation explicite (même logique que `documents_generes`), jamais
--  un écrasement silencieux.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE entretiens
  ADD COLUMN fiche_drive_file_id text,
  ADD COLUMN fiche_drive_url    text,
  ADD COLUMN fiche_generee_le   timestamptz,
  ADD COLUMN fiche_generee_par  integer REFERENCES utilisateurs(id) ON DELETE SET NULL;
