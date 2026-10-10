// ─────────────────────────────────────────────────────────────
//  GET /api/documents/variables : catalogue canonique des variables
//  documentaires, en LECTURE SEULE. Aucune route d'écriture : les noms
//  canoniques sont un contrat technique, versionné dans le dépôt.
//  Le catalogue ne contient que des définitions, aucune donnée personnelle.
// ─────────────────────────────────────────────────────────────
import { Router } from "express";
import { requireAuth } from "../session.js";
import { catalogue } from "../services/catalogueVariables.js";

const router = Router();

router.get("/documents/variables", requireAuth, (_req, res) => {
  res.json(catalogue());
});

export default router;
