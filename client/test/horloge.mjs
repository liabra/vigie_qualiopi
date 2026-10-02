// Horloge MAÎTRISÉE de tous les tests client (chargée par enregistrer.mjs) :
// « maintenant » = 1er octobre 2026, 12 h à Cayenne, puis le temps s'écoule
// normalement. Les tests ne dépendent ainsi jamais de la date réelle
// d'exécution (échéances, retards, dates du jour). Un `new Date(valeur)`
// explicite reste inchangé.
const DateReelle = Date;
const ORIGINE = DateReelle.parse("2026-10-01T15:00:00Z");
const depart = DateReelle.now();
const maintenant = () => ORIGINE + (DateReelle.now() - depart);
class DateMaitrisee extends DateReelle {
  constructor(...args) { if (args.length === 0) super(maintenant()); else super(...args); }
  static now() { return maintenant(); }
}
globalThis.Date = DateMaitrisee;
