// ─────────────────────────────────────────────────────────────
//  DOC-6A — Moteur PUR de rendu des blocs répétables (texte).
//  Données 100 % fictives, aucun Drive, aucune base.
// ─────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { remplacementsBlocs, renduBlocs, segmenter } from "../src/services/renduBlocs.js";

const absences = (lignes) => ({ absences: lignes });

test("bloc vide (0 ligne) : le bloc complet disparaît proprement", () => {
  const texte = "Absences : {{#absences}}{{absence_date}} — {{absence_duree_heures}}{{/absences}}. Fin.";
  assert.equal(renduBlocs(texte, absences([])), "Absences : . Fin.");
});

test("bloc 1 ligne : une occurrence", () => {
  const texte = "{{#absences}}{{absence_date}} ({{absence_duree_heures}}){{/absences}}";
  assert.equal(renduBlocs(texte, absences([{ date_absence: "2026-01-05", duree_heures: 3.5 }])), "05/01/2026 (3.5 h)");
});

test("bloc N lignes : répété N fois, ordre déterministe", () => {
  const texte = "{{#absences}}{{absence_date}}{{/absences}}";
  const lignes = [
    { date_absence: "2026-01-05", duree_heures: 3.5 },
    { date_absence: "2026-01-06", duree_heures: 7 },
    { date_absence: "2026-01-07", duree_heures: 2 },
  ];
  assert.equal(renduBlocs(texte, absences(lignes)), "05/01/202606/01/202607/01/2026");
});

test("marqueurs d'ouverture/fermeture disparaissent toujours", () => {
  const texte = "Début {{#absences}}x{{/absences}} Fin";
  assert.equal(renduBlocs(texte, absences([])), "Début  Fin");
  assert.equal(renduBlocs(texte, absences([{ date_absence: "2026-01-05" }])), "Début x Fin");
});

test("format date/durée : formaterDate et formaterDuree réutilisés", () => {
  const texte = "{{#absences}}{{absence_date}} / {{absence_duree_heures}}{{/absences}}";
  assert.equal(renduBlocs(texte, absences([{ date_absence: "2026-03-05", duree_heures: 17.5 }])), "05/03/2026 / 17.5 h");
  // durée absente → chaîne vide, pas « null » ni « undefined »
  assert.equal(renduBlocs(texte, absences([{ date_absence: null, duree_heures: null }])), " / ");
});

test("variable globale dans le corps : laissée intacte (passage scalaire séparé)", () => {
  const texte = "{{#absences}}{{absence_date}} {{stagiaire_nom}}{{/absences}}";
  assert.equal(renduBlocs(texte, absences([{ date_absence: "2026-01-05" }])), "05/01/2026 {{stagiaire_nom}}");
});

test("champ local non résoluble (absence_action) : laissé tel quel, jamais inventé", () => {
  const texte = "{{#absences}}{{absence_action}}{{/absences}}";
  assert.equal(renduBlocs(texte, absences([{ date_absence: "2026-01-05" }])), "{{absence_action}}");
});

test("remplacementsBlocs : un couple find/replacement par bloc", () => {
  const texte = "Avant {{#absences}}{{absence_date}}{{/absences}} Après";
  const r = remplacementsBlocs(texte, absences([{ date_absence: "2026-01-05" }]));
  assert.equal(r.length, 1);
  assert.equal(r[0].find, "{{#absences}}{{absence_date}}{{/absences}}");
  assert.equal(r[0].replacement, "05/01/2026");
});

test("syntaxe malformée : bloquée ({{# sans }}, non fermé, imbriqué)", () => {
  assert.throws(() => segmenter("{{#absences"), /sans « }} »/);
  assert.throws(() => segmenter("{{#absences}}{{absence_date}}"), /jamais fermé/);
  assert.throws(() => segmenter("{{#absences}}{{#seances}}{{/seances}}{{/absences}}"), /imbriqué/);
});

test("segmenter : texte hors bloc conservé tel quel", () => {
  const segs = segmenter("A {{#absences}}B{{/absences}} C");
  assert.equal(segs[0].type, "texte");
  assert.equal(segs[0].contenu, "A ");
  assert.equal(segs[1].type, "bloc");
  assert.equal(segs[1].nom, "absences");
  assert.equal(segs[2].type, "texte");
  assert.equal(segs[2].contenu, " C");
});
