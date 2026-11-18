// ─────────────────────────────────────────────────────────────
//  Registres de pilotage qualité (migration 047) : UNE définition par registre, utilisée à la fois par
//  l'API (validation stricte, colonnes en liste blanche) et par l'interface (formulaire et tableau générés).
//  Ajouter un champ = une ligne ici + une colonne en migration. Aucune colonne hors définition n'est
//  jamais lue depuis la requête (pas d'injection de nom de colonne possible).
// ─────────────────────────────────────────────────────────────

const e = (valeurs) => ({ valeurs: Object.keys(valeurs), libelles: valeurs });

export const REGISTRES = {
  taches: {
    table: "taches_qualite", entite: "tache", titre: "Tâches qualité", singulier: "tâche", feminin: true,
    description: "Ce qui doit être fait, par qui et pour quand. Une tâche récurrente terminée prépare automatiquement la suivante.",
    ecriture: "redacteur", tri: "CASE t.statut WHEN 'faite' THEN 2 WHEN 'annulee' THEN 3 ELSE 1 END, t.echeance NULLS LAST, t.id",
    statutsOuverts: ["a_faire", "en_cours"],
    champs: [
      { nom: "titre", libelle: "Intitulé", type: "texte", max: 200, requis: true, colonne: true },
      { nom: "description", libelle: "Description", type: "texte_long", max: 4000 },
      { nom: "responsable_id", libelle: "Responsable", type: "utilisateur", colonne: true },
      { nom: "echeance", libelle: "Échéance", type: "date", colonne: true },
      { nom: "priorite", libelle: "Priorité", type: "enum", ...e({ basse: "Basse", normale: "Normale", haute: "Haute" }), defaut: "normale", colonne: true },
      { nom: "statut", libelle: "Statut", type: "enum", ...e({ a_faire: "À faire", en_cours: "En cours", faite: "Faite", annulee: "Annulée" }), defaut: "a_faire", colonne: true, filtre: true },
      { nom: "recurrence", libelle: "Récurrence", type: "enum", ...e({ aucune: "Aucune", mensuelle: "Mensuelle", trimestrielle: "Trimestrielle", semestrielle: "Semestrielle", annuelle: "Annuelle" }), defaut: "aucune" },
      { nom: "origine", libelle: "Origine", type: "enum", ...e({ manuelle: "Saisie manuelle", preuve_manquante: "Preuve manquante", preuve_a_actualiser: "Preuve à actualiser", audit: "Préparation d'audit", risque: "Risque", enquete: "Enquête" }), defaut: "manuelle", lectureSeule: true },
      { nom: "indicateurs", libelle: "Indicateurs concernés", type: "indicateurs" },
      { nom: "preuve_id", libelle: "Preuve concernée", type: "preuve", lectureSeule: true },
      { nom: "faite_le", libelle: "Faite le", type: "date", lectureSeule: true },
    ],
  },
  risques: {
    table: "risques_qualite", entite: "risque", titre: "Risques qualité", singulier: "risque",
    description: "Registre des risques : criticité = probabilité × impact (1 à 16). À réévaluer à la date prévue.",
    ecriture: "admin", tri: "CASE t.statut WHEN 'actif' THEN 1 WHEN 'maitrise' THEN 2 ELSE 3 END, t.criticite DESC, t.id",
    statutsOuverts: ["actif"],
    champs: [
      { nom: "titre", libelle: "Risque", type: "texte", max: 200, requis: true, colonne: true },
      { nom: "description", libelle: "Description", type: "texte_long", max: 4000 },
      { nom: "domaine", libelle: "Domaine", type: "enum", ...e({ pedagogie: "Pédagogie", organisation: "Organisation", materiel: "Matériel", accessibilite: "Accessibilité", partenaires: "Partenaires", donnees: "Données et confidentialité", reglementaire: "Réglementaire", humain: "Ressources humaines", autre: "Autre" }), defaut: "organisation", colonne: true, filtre: true },
      { nom: "origine", libelle: "Origine (constat, enquête, veille…)", type: "texte", max: 300 },
      { nom: "probabilite", libelle: "Probabilité (1 rare – 4 fréquent)", type: "entier", min: 1, max: 4, defaut: 2 },
      { nom: "impact", libelle: "Impact (1 faible – 4 critique)", type: "entier", min: 1, max: 4, defaut: 2 },
      { nom: "criticite", libelle: "Criticité", type: "entier", calcule: true, colonne: true },
      { nom: "mesures", libelle: "Mesures de maîtrise", type: "texte_long", max: 4000 },
      { nom: "responsable_id", libelle: "Responsable", type: "utilisateur", colonne: true },
      { nom: "date_reevaluation", libelle: "Date de réévaluation", type: "date", colonne: true },
      { nom: "statut", libelle: "Statut", type: "enum", ...e({ actif: "Actif", maitrise: "Maîtrisé", clos: "Clos" }), defaut: "actif", colonne: true, filtre: true },
      { nom: "action_id", libelle: "Action qualité liée", type: "action" },
      { nom: "indicateurs", libelle: "Indicateurs concernés", type: "indicateurs" },
    ],
  },
  partenaires: {
    table: "partenaires", entite: "partenaire", titre: "Partenaires", singulier: "partenaire",
    description: "Réseau et environnement de l'organisme : conventions, référents et actions menées (indicateurs 23 à 27).",
    ecriture: "admin", tri: "CASE t.statut WHEN 'actif' THEN 1 ELSE 2 END, lower(t.nom)",
    statutsOuverts: ["actif"],
    champs: [
      { nom: "nom", libelle: "Nom", type: "texte", max: 200, requis: true, colonne: true },
      { nom: "type", libelle: "Type", type: "enum", ...e({ prescripteur: "Prescripteur", financeur: "Financeur", entreprise: "Entreprise", institution: "Institution", association: "Association", organisme_formation: "Organisme de formation", reseau: "Réseau", autre: "Autre" }), defaut: "autre", colonne: true, filtre: true },
      { nom: "domaine", libelle: "Domaine", type: "texte", max: 200 },
      { nom: "contact_nom", libelle: "Contact", type: "texte", max: 150, colonne: true },
      { nom: "email", libelle: "E-mail", type: "email", max: 200 },
      { nom: "telephone", libelle: "Téléphone", type: "telephone", max: 30 },
      { nom: "adresse", libelle: "Adresse", type: "texte", max: 300 },
      { nom: "convention_debut", libelle: "Convention : début", type: "date" },
      { nom: "convention_fin", libelle: "Convention : fin", type: "date", colonne: true },
      { nom: "referent_id", libelle: "Référent interne", type: "utilisateur" },
      { nom: "statut", libelle: "Statut", type: "enum", ...e({ actif: "Actif", inactif: "Inactif" }), defaut: "actif", colonne: true, filtre: true },
      { nom: "actions_menees", libelle: "Actions menées (réunions, interventions, échanges)", type: "texte_long", max: 8000 },
      { nom: "indicateurs", libelle: "Indicateurs concernés", type: "indicateurs" },
    ],
  },
  ressources: {
    table: "ressources", entite: "ressource", titre: "Ressources et moyens", singulier: "ressource", feminin: true,
    description: "Supports pédagogiques (version, actualisation) et moyens techniques (salles, matériels, logiciels : état et contrôles).",
    ecriture: "admin", tri: "CASE t.statut WHEN 'a_actualiser' THEN 1 WHEN 'en_service' THEN 2 ELSE 3 END, t.categorie, lower(t.titre)",
    statutsOuverts: ["en_service", "a_actualiser"],
    champs: [
      { nom: "titre", libelle: "Intitulé", type: "texte", max: 200, requis: true, colonne: true },
      { nom: "categorie", libelle: "Catégorie", type: "enum", ...e({ support: "Support de cours", programme: "Programme", deroule: "Déroulé pédagogique", exercice: "Exercice", evaluation: "Évaluation", numerique: "Ressource numérique", salle: "Salle", equipement: "Équipement", materiel: "Matériel", logiciel: "Logiciel" }), defaut: "support", colonne: true, filtre: true },
      { nom: "version", libelle: "Version", type: "texte", max: 30, colonne: true },
      { nom: "date_actualisation", libelle: "Dernière actualisation", type: "date", colonne: true },
      { nom: "responsable_id", libelle: "Responsable", type: "utilisateur" },
      { nom: "lien", libelle: "Lien (Drive ou web)", type: "url", max: 500 },
      { nom: "formation_id", libelle: "Formation concernée", type: "formation" },
      { nom: "localisation", libelle: "Localisation", type: "texte", max: 200 },
      { nom: "etat", libelle: "État", type: "enum", ...e({ bon: "Bon état", a_surveiller: "À surveiller", hors_service: "Hors service", non_concerne: "Sans objet" }), defaut: "non_concerne", colonne: true },
      { nom: "date_controle", libelle: "Dernier contrôle / maintenance", type: "date" },
      { nom: "statut", libelle: "Statut", type: "enum", ...e({ en_service: "En service", a_actualiser: "À actualiser", retire: "Retiré" }), defaut: "en_service", colonne: true, filtre: true },
      { nom: "notes", libelle: "Notes", type: "texte_long", max: 4000 },
      { nom: "indicateurs", libelle: "Indicateurs concernés", type: "indicateurs" },
    ],
  },
};

const INTERDIT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const valideDate = (d) => DATE.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;

// Vue publique d'une définition (sans nom de table ni SQL) pour l'interface.
export function schemaPublic(nom) {
  const d = Object.hasOwn(REGISTRES, nom) ? REGISTRES[nom] : null; // fix : jamais une propriété héritée
  if (!d) return null;
  return { nom, titre: d.titre, singulier: d.singulier, feminin: !!d.feminin, description: d.description, ecriture: d.ecriture, statutsOuverts: d.statutsOuverts,
    champs: d.champs.map(({ nom: n, libelle, type, max, min, requis, valeurs, libelles, defaut, colonne, filtre, lectureSeule, calcule }) =>
      ({ nom: n, libelle, type, max, min, requis: !!requis, valeurs, libelles, defaut, colonne: !!colonne, filtre: !!filtre, lectureSeule: !!(lectureSeule || calcule) })) };
}

// Valide un corps de requête. Renvoie { valeur } (colonnes SQL → valeur) et `indicateurs` (numéros) à part, ou { erreur }.
export function validerFiche(nom, corps, { complet }) {
  const d = REGISTRES[nom];
  const src = corps && typeof corps === "object" ? corps : {};
  const valeur = {};
  let indicateurs;
  for (const c of d.champs) {
    if (c.calcule || c.lectureSeule) continue;
    const brut = src[c.nom];
    if (brut === undefined) {
      if (complet && c.requis) return { erreur: `${c.libelle} : champ obligatoire.` };
      if (complet && c.defaut !== undefined) valeur[c.nom] = c.defaut;
      continue;
    }
    if (c.type === "indicateurs") {
      if (!Array.isArray(brut) || brut.length > 40 || brut.some((n) => !Number.isInteger(Number(n)) || Number(n) < 1 || Number(n) > 200)) return { erreur: `${c.libelle} : numéros d'indicateurs attendus.` };
      indicateurs = [...new Set(brut.map(Number))];
      continue;
    }
    const vide = brut === null || brut === "";
    if (vide) {
      if (c.requis) return { erreur: `${c.libelle} : champ obligatoire.` };
      if (c.type === "enum" || c.type === "entier") { if (c.defaut === undefined) valeur[c.nom] = null; else return { erreur: `${c.libelle} : valeur attendue.` }; continue; }
      valeur[c.nom] = null; continue;
    }
    switch (c.type) {
      case "texte": case "texte_long": case "email": case "telephone": case "url": {
        if (typeof brut !== "string") return { erreur: `${c.libelle} : texte attendu.` };
        const t = brut.trim();
        if (!t && c.requis) return { erreur: `${c.libelle} : champ obligatoire.` };
        if (t.length > c.max) return { erreur: `${c.libelle} : ${c.max} caractères au plus.` };
        if (INTERDIT.test(t)) return { erreur: `${c.libelle} : caractères non autorisés.` };
        if (t && c.type === "email" && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(t)) return { erreur: `${c.libelle} : adresse invalide.` };
        if (t && c.type === "telephone" && !/^[0-9 .+()-]{6,30}$/.test(t)) return { erreur: `${c.libelle} : numéro invalide.` };
        // fix : seuls les liens http(s) sont acceptés (jamais javascript: ou data:).
        if (t && c.type === "url" && !/^https?:\/\/[^\s<>"]+$/i.test(t)) return { erreur: `${c.libelle} : lien commençant par http:// ou https:// attendu.` };
        valeur[c.nom] = t || null; break;
      }
      case "date":
        if (typeof brut !== "string" || !valideDate(brut)) return { erreur: `${c.libelle} : date au format AAAA-MM-JJ attendue.` };
        valeur[c.nom] = brut; break;
      case "enum":
        if (!c.valeurs.includes(brut)) return { erreur: `${c.libelle} : valeur inconnue.` };
        valeur[c.nom] = brut; break;
      case "entier": {
        const n = Number(brut);
        if (!Number.isInteger(n) || n < c.min || n > c.max) return { erreur: `${c.libelle} : entier de ${c.min} à ${c.max} attendu.` };
        valeur[c.nom] = n; break;
      }
      case "utilisateur": case "formation": case "action": case "preuve": {
        const n = Number(brut);
        if (!Number.isInteger(n) || n < 1) return { erreur: `${c.libelle} : identifiant invalide.` };
        valeur[c.nom] = n; break;
      }
      default: return { erreur: `${c.libelle} : type non géré.` };
    }
  }
  return { valeur, indicateurs };
}

// Date suivante d'une tâche récurrente (fin de mois respectée : 31/01 + 1 mois = 28 ou 29/02).
export function prochaineEcheance(dateIso, recurrence) {
  const mois = { mensuelle: 1, trimestrielle: 3, semestrielle: 6, annuelle: 12 }[recurrence];
  if (!mois || !dateIso) return null;
  const [a, m, j] = String(dateIso).slice(0, 10).split("-").map(Number);
  const cible = new Date(Date.UTC(a, m - 1 + mois, 1));
  const dernier = new Date(Date.UTC(cible.getUTCFullYear(), cible.getUTCMonth() + 1, 0)).getUTCDate();
  cible.setUTCDate(Math.min(j, dernier));
  return cible.toISOString().slice(0, 10);
}
