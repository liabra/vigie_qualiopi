// ─────────────────────────────────────────────────────────────
//  DOC-3C — PRÉCONTRÔLE DE GÉNÉRATION : « ce modèle peut-il être généré,
//  par cet utilisateur, avec ces données, pour TOUTES les cibles ? » —
//  avant tout effet de bord Drive (copie, création de dossier).
//
//  Réutilise analyserModeleDrive() (DOC-2) : UNE seule lecture du fichier,
//  jamais une par cible. Les cibles sont résolues en MÉMOIRE depuis
//  `cibles` (déjà chargées par une seule requête SQL, documents.js) —
//  aucune requête, aucun appel Drive supplémentaire ici.
//
//  Tout ou rien (règle 1) : `autorise` est un verdict pour le LOT entier,
//  jamais par cible. Seul CANONIQUE_ABSENT (règle 2) reste évalué par
//  cible, et reste un AVERTISSEMENT, jamais bloquant à lui seul.
//
//  Confidentialité : jamais de texte libre, jamais de donnée stagiaire.
//  Seulement des noms de variable (jetons choisis par l'auteur du
//  modèle), des codes, des messages fixes, et des identifiants
//  techniques (cibles_concernees), bornés (règle 7).
//
//  Module quasi pur : `analyserModeleDrive` est le seul appel externe
//  (Drive, lecture seule). Aucune écriture, nulle part.
// ─────────────────────────────────────────────────────────────
import { analyserModeleDrive } from "./diagnosticModele.js";
import { blocCanonique, variableCanonique } from "./catalogueVariables.js";
import { NOMS_RESOLUS, resoudreCanoniques } from "./resolversCanoniques.js";
import { blocSupportable, champsResolubles } from "./resolversBlocs.js";

// Règle 7 : jamais une liste non bornée d'identifiants de cibles.
export const MAX_CIBLES_LISTEES = 50;

// « {{#nom}} », « {{/nom}} », « {{nom}} » → « nom ». `nom` reste toujours
// le NOM NU dans ce module (cohérent avec variableCanonique()/blocCanonique()
// et avec les champs `nom` construits ailleurs ici) ; `diagnostic.erreurs`/
// `diagnostic.avertissements` (validationModeles.js) portent, eux, la
// balise complète dans `balise` — on la dénude en passant.
const nomNu = (balise) => (balise ? balise.replace(/^\{\{[#/]?/, "").replace(/\}\}$/, "") : null);

function refuseRestreinte(nom, sensibilite) {
  return {
    code: "VARIABLE_RESTREINTE_REFUSEE", nom, sensibilite,
    message: `{{${nom}}} est une donnée restreinte à l'administration : vous n'avez pas le droit de générer un document qui l'utilise.`,
  };
}

// precontrolerGeneration(modele, ctx, cibles, options) → résultat PUR,
// jamais levé en exception pour un refus « normal » (contenu invalide,
// droits, variable non résoluble) — seules les erreurs d'ACCÈS au
// fichier (Drive indisponible, format non supporté, classeur démesuré)
// remontent en exception, exactement comme analyserModeleDrive() le fait
// déjà pour l'écran de diagnostic (DOC-2) : un seul comportement, partout.
//
// `cibles` : le résultat de cibles() (documents.js) — [{ stagiaire }, …].
// `options.admin` : booléen, calculé UNE fois par la route (estAdmin()).
export async function precontrolerGeneration(modele, ctx, cibles, { admin = false, clients, jeton = null } = {}) {
  const diagnostic = await analyserModeleDrive(modele, clients, jeton);

  // Règle 4 : un modèle à la corbeille bloque AVANT toute analyse de
  // contenu supplémentaire — un seul message, pas mélangé à des erreurs
  // de balises qui n'ont plus de sens (le fichier n'est plus exploitable).
  if (diagnostic.trashed) {
    return {
      autorise: false, type_fichier: diagnostic.type_fichier, version_dictionnaire: diagnostic.version_dictionnaire,
      nombre_cibles: cibles.length,
      erreurs: [{ code: "MODELE_CORBEILLE", message: `Le fichier du modèle « ${modele.nom} » est à la corbeille sur le Drive.` }],
      avertissements: [],
    };
  }

  // Erreurs déjà détectées par analyserModele() (DOC-1/DOC-2) : syntaxe,
  // variable inconnue, blocs mal formés… reprises SANS les recalculer.
  const erreurs = diagnostic.erreurs.map((e) => ({ code: e.code, nom: nomNu(e.balise), message: e.message }));
  // Alias/historique (migration conseillée) repris tels quels : jamais
  // bloquants, « même logique que DOC-2 ».
  const avertissements = diagnostic.avertissements
    .filter((a) => ["ALIAS", "HISTORIQUE", "DONNEE_SENSIBLE"].includes(a.code))
    .map((a) => ({ code: a.code, nom: nomNu(a.balise), message: a.message }));

  // DOC-6A — blocs répétables : contrôle précis au niveau du bloc ET de ses
  // champs. Le refus d'accès prime (un seul message clair), puis le support
  // de la source, puis la résolvabilité de chaque champ utilisé, puis le
  // type de fichier (bloc textuel Doc uniquement pour l'instant).
  for (const nom of diagnostic.blocs) {
    const bloc = blocCanonique(nom);
    if (bloc?.sensibilite === "restreinte" && !admin) { erreurs.push(refuseRestreinte(nom, "restreinte")); continue; }
    if (!blocSupportable(nom)) {
      erreurs.push({ code: "BLOC_NON_SUPPORTE", nom, message: `Le bloc {{#${nom}}} n'est pas encore supporté : source de données absente ou rendu non implémenté.` });
      continue;
    }
    const resolubles = champsResolubles(nom);
    for (const champ of diagnostic.champs_par_bloc?.[nom] || []) {
      if (!resolubles.has(champ)) {
        erreurs.push({ code: "BLOC_CHAMP_NON_RESOLUBLE", bloc: nom, champ, message: `Le champ {{${champ}}} du bloc {{#${nom}}} n'est pas résoluble avec les données Vigie actuelles.` });
      }
    }
    if (diagnostic.type_fichier !== "document") {
      erreurs.push({ code: "BLOC_STRUCTURE_NON_SUPPORTEE", nom, message: `Le bloc {{#${nom}}} ne peut pas être rendu dans une feuille de calcul sans perte de mise en forme.` });
    }
  }

  // Règle 5 : la sécurité porte sur la variable CANONIQUE EFFECTIVE, pas
  // sur le nom écrit dans le modèle — un alias ne doit jamais devenir un
  // contournement de la politique de sensibilité. En revanche, un alias
  // reste intégralement couvert par le mécanisme HISTORIQUE existant
  // (les 23 marqueurs, déjà remplacés aujourd'hui) : il ne doit PAS être
  // soumis à CANONIQUE_NON_RESOLUBLE — celui-ci ne concerne QUE les
  // balises écrites directement sous leur nom canonique
  // (diagnostic.canoniques), résolues par la couche canonique DOC-3D.
  for (const { canonique } of diagnostic.alias) {
    const variable = variableCanonique(canonique);
    if (variable?.sensibilite === "restreinte" && !admin) erreurs.push(refuseRestreinte(canonique, "restreinte"));
  }
  // Les marqueurs historiques n'ont PAS de cible canonique certaine :
  // aucune sensibilité n'en est déduite (règle 5) — ils restent de
  // simples avertissements de migration (déjà repris ci-dessus).

  // Précalcul UNE fois par cible (pas une fois par variable × cible) :
  // resoudreCanoniques() renvoie les 162 statuts d'un coup.
  const resolutionsParCible = cibles.map((c) => ({
    id: c.stagiaire?.id ?? null,
    canoniques: resoudreCanoniques({ ...ctx, stagiaire: c.stagiaire }),
  }));

  for (const nom of diagnostic.canoniques) {
    const variable = variableCanonique(nom);
    if (!variable) continue; // garde-fou : ne devrait pas arriver (resume déjà filtré par le catalogue)

    if (variable.sensibilite === "restreinte" && !admin) {
      erreurs.push(refuseRestreinte(nom, "restreinte"));
      continue; // règle 8 : refus avant toute résolution de CETTE variable
    }

    // Règle 2 : non_resoluble est une propriété du MODÈLE (aucun resolver
    // n'existe, quelle que soit la cible) — jamais une boucle sur les cibles.
    if (!NOMS_RESOLUS.includes(nom)) {
      erreurs.push({ code: "CANONIQUE_NON_RESOLUBLE", nom, message: `{{${nom}}} est une variable canonique reconnue, mais aucune donnée Vigie ne permet de la calculer aujourd'hui.` });
      continue;
    }

    // Résoluble : autorisée, le moteur de rendu DOC-3D la remplace
    // réellement (valeursDeRemplacement). Plus aucune erreur bloquante ici.

    // Règle 2 : « absent » reste évalué PAR CIBLE, et reste un
    // avertissement — jamais une cause de blocage à lui seul.
    const cibleIds = [];
    for (const r of resolutionsParCible) if (r.canoniques[nom].statut === "absent") cibleIds.push(r.id);
    if (cibleIds.length) {
      avertissements.push({
        code: "CANONIQUE_ABSENT", nom,
        nombre_cibles_concernees: cibleIds.length,
        cibles_concernees: cibleIds.slice(0, MAX_CIBLES_LISTEES),
        cibles_tronquees: cibleIds.length > MAX_CIBLES_LISTEES,
        message: `{{${nom}}} n'a pas de valeur renseignée pour ${cibleIds.length} cible(s).`,
      });
    }
  }

  return {
    autorise: erreurs.length === 0,
    type_fichier: diagnostic.type_fichier,
    version_dictionnaire: diagnostic.version_dictionnaire,
    nombre_cibles: cibles.length,
    // DOC-3D : liste des canoniques présents dans le modèle — c'est elle,
    // et elle seule, que le moteur de rendu doit remplacer (jamais les 45).
    canoniques: diagnostic.canoniques,
    // DOC-6A : blocs répétables présents dans le modèle.
    blocs: diagnostic.blocs,
    erreurs, avertissements,
  };
}
