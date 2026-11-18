// Enquêtes en ligne : modèles de départ, validation des questions et des réponses publiques (règles pures).
export const TYPES_ENQUETE = { a_chaud: "Satisfaction à chaud", a_froid: "Suivi à froid", entreprise: "Entreprise", financeur: "Financeur", formateur: "Formateur", prescripteur: "Prescripteur", partenaire: "Partenaire" };
export const TYPES_QUESTION = { echelle: "Échelle de 1 à 5", choix_unique: "Choix unique", choix_multiple: "Choix multiple", oui_non: "Oui / non", texte: "Texte libre", nombre: "Nombre", date: "Date" };

const q = (libelle, type, extra = {}) => ({ libelle, type, options: [], obligatoire: false, globale: false, ...extra });

// Modèles de départ : une base de travail, modifiable avant diffusion (contenu à valider par l'organisme).
export const MODELES_ENQUETE = {
  satisfaction_chaud: {
    titre: "Satisfaction à chaud", type: "a_chaud",
    introduction: "Votre avis nous aide à améliorer la formation. Merci de répondre à chaque question (1 = pas du tout satisfait, 5 = tout à fait satisfait). Vos réponses sont anonymes.",
    questions: [
      q("Globalement, vous diriez que la formation a été satisfaisante", "echelle", { obligatoire: true, globale: true }),
      q("L'accueil et l'organisation de la formation", "echelle"),
      q("Le contenu de la formation (clarté, intérêt)", "echelle"),
      q("Les méthodes et les supports utilisés", "echelle"),
      q("L'accompagnement du formateur", "echelle"),
      q("Les lieux et le matériel mis à disposition", "echelle"),
      q("L'atteinte de vos objectifs personnels", "echelle"),
      q("Recommanderiez-vous cette formation ?", "oui_non"),
      q("Ce qui vous a le plus plu", "texte"),
      q("Ce qui pourrait être amélioré", "texte"),
      q("Avez-vous une réclamation ou une difficulté à signaler ?", "texte"),
    ],
  },
  suivi_froid: {
    titre: "Suivi à froid (3 à 6 mois après la formation)", type: "a_froid",
    introduction: "Quelques mois après votre formation, nous aimerions savoir ce qu'elle vous a apporté. Vos réponses sont anonymes.",
    questions: [
      q("Avec le recul, la formation vous a-t-elle été utile ?", "echelle", { obligatoire: true, globale: true }),
      q("Quelle est votre situation aujourd'hui ?", "choix_unique", { options: ["En emploi", "En formation", "En recherche d'emploi", "Autre"], obligatoire: true }),
      q("Utilisez-vous les compétences acquises pendant la formation ?", "oui_non"),
      q("Quelles compétences utilisez-vous le plus ?", "texte"),
      q("Qu'aurait-il fallu ajouter ou changer dans la formation ?", "texte"),
    ],
  },
  partenaire: {
    titre: "Satisfaction des partenaires et prescripteurs", type: "prescripteur",
    introduction: "Merci de nous donner votre avis sur notre collaboration autour de cette session.",
    questions: [
      q("Globalement, êtes-vous satisfait de notre collaboration ?", "echelle", { obligatoire: true, globale: true }),
      q("La qualité des échanges et des informations transmises", "echelle"),
      q("L'adéquation de la formation aux besoins des personnes orientées", "echelle"),
      q("Vos suggestions d'amélioration", "texte"),
    ],
  },
};

const INTERDIT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

// Valide la liste complète des questions d'une enquête.
export function validerQuestions(liste) {
  if (!Array.isArray(liste) || !liste.length) return { erreur: "Ajoutez au moins une question." };
  if (liste.length > 40) return { erreur: "40 questions au plus." };
  const sortie = [];
  let globales = 0;
  for (const [i, brut] of liste.entries()) {
    const libelle = typeof brut?.libelle === "string" ? brut.libelle.trim() : "";
    if (!libelle || libelle.length > 500 || INTERDIT.test(libelle)) return { erreur: `Question ${i + 1} : libellé obligatoire (500 caractères au plus).` };
    if (!Object.hasOwn(TYPES_QUESTION, brut.type)) return { erreur: `Question ${i + 1} : type inconnu.` };
    let options = [];
    if (["choix_unique", "choix_multiple"].includes(brut.type)) {
      options = (Array.isArray(brut.options) ? brut.options : []).map((o) => String(o ?? "").trim()).filter(Boolean);
      if (options.length < 2 || options.length > 15 || options.some((o) => o.length > 150) || new Set(options).size !== options.length) return { erreur: `Question ${i + 1} : de 2 à 15 choix distincts (150 caractères au plus).` };
    }
    const globale = brut.globale === true;
    if (globale) {
      globales++;
      if (brut.type !== "echelle") return { erreur: "La question de satisfaction globale doit être une échelle de 1 à 5." };
    }
    sortie.push({ libelle, type: brut.type, options, obligatoire: brut.obligatoire === true || globale, globale });
  }
  if (globales > 1) return { erreur: "Une seule question peut porter la satisfaction globale." };
  return { questions: sortie };
}

// Valide les réponses publiques. Renvoie { reponses: {id: {libelle, valeur}}, noteGlobale, commentaires } ou { erreur }.
export function validerReponses(questions, corps) {
  const brutes = corps && typeof corps === "object" && corps.reponses && typeof corps.reponses === "object" ? corps.reponses : null;
  if (!brutes) return { erreur: "Réponses manquantes." };
  const reponses = {}; let noteGlobale = null; const textes = [];
  for (const qu of questions) {
    let v = brutes[String(qu.id)];
    const vide = v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
    if (vide) { if (qu.obligatoire) return { erreur: `Merci de répondre à : « ${qu.libelle} ».` }; continue; }
    switch (qu.type) {
      case "echelle": { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 5) return { erreur: "Note de 1 à 5 attendue." }; v = n; break; }
      case "nombre": { const n = Number(v); if (!Number.isFinite(n) || Math.abs(n) > 1e9) return { erreur: "Nombre attendu." }; v = n; break; }
      case "oui_non": if (v !== "oui" && v !== "non") return { erreur: "Réponse oui ou non attendue." }; break;
      case "date": if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { erreur: "Date attendue." }; break;
      case "choix_unique": if (!qu.options.includes(v)) return { erreur: "Choix inconnu." }; break;
      case "choix_multiple":
        if (!Array.isArray(v) || v.some((x) => !qu.options.includes(x))) return { erreur: "Choix inconnu." };
        v = [...new Set(v)]; break;
      case "texte":
        if (typeof v !== "string") return { erreur: "Texte attendu." };
        v = v.trim().slice(0, 2000);
        if (INTERDIT.test(v)) return { erreur: "Caractères non autorisés." };
        if (!v) { if (qu.obligatoire) return { erreur: `Merci de répondre à : « ${qu.libelle} ».` }; continue; }
        textes.push(`${qu.libelle} : ${v}`);
        break;
      default: return { erreur: "Question non gérée." };
    }
    reponses[qu.id] = { libelle: qu.libelle, type: qu.type, valeur: v };
    if (qu.globale) noteGlobale = v;
  }
  return { reponses, noteGlobale, commentaires: textes.join("\n").slice(0, 8000) || null };
}

// Synthèse d'une question à partir des réponses (pure, explicable).
export function syntheseQuestion(qu, lignes) {
  const valeurs = lignes.map((l) => l.reponses?.[qu.id]?.valeur).filter((v) => v !== undefined && v !== null);
  const s = { question_id: qu.id, libelle: qu.libelle, type: qu.type, reponses: valeurs.length };
  if (qu.type === "echelle") {
    s.repartition = [1, 2, 3, 4, 5].map((n) => valeurs.filter((v) => v === n).length);
    s.moyenne = valeurs.length ? Math.round((valeurs.reduce((a, b) => a + b, 0) / valeurs.length) * 10) / 10 : null;
    s.taux_satisfaits = valeurs.length ? Math.round((valeurs.filter((v) => v >= 4).length / valeurs.length) * 100) : null;
  } else if (qu.type === "oui_non") {
    s.repartition = { oui: valeurs.filter((v) => v === "oui").length, non: valeurs.filter((v) => v === "non").length };
  } else if (["choix_unique", "choix_multiple"].includes(qu.type)) {
    s.repartition = Object.fromEntries(qu.options.map((o) => [o, valeurs.filter((v) => (Array.isArray(v) ? v.includes(o) : v === o)).length]));
  } else if (qu.type === "nombre") {
    s.moyenne = valeurs.length ? Math.round((valeurs.reduce((a, b) => a + b, 0) / valeurs.length) * 10) / 10 : null;
  } else {
    s.textes = valeurs.slice(0, 500);
  }
  return s;
}
