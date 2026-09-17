-- ─────────────────────────────────────────────────────────────
--  Un indicateur peut être marqué « Non applicable » à la main, sans
--  passer par une preuve : la présence d'une ligne ici l'emporte sur le
--  statut calculé depuis ses preuves, quelles qu'elles soient.
--  Réversible : supprimer la ligne réactive l'indicateur.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE indicateurs_non_applicables (
  indicateur_id integer PRIMARY KEY REFERENCES indicateurs(id) ON DELETE CASCADE,
  motif         text,
  marquee_par   integer REFERENCES utilisateurs(id) ON DELETE SET NULL,
  marquee_le    timestamptz NOT NULL DEFAULT now()
);
