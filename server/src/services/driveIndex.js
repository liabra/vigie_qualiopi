// ─────────────────────────────────────────────────────────────
//  Index des fichiers Drive sous le dossier Qualiopi, et
//  rapprochement « nom écrit dans le classeur » → fichier réel.
//  La partie rapprochement est PURE (testable sans réseau).
// ─────────────────────────────────────────────────────────────
import { normaliser } from "./classeur.js";

const DOSSIER = "application/vnd.google-apps.folder";
const RACCOURCI = "application/vnd.google-apps.shortcut";
const CHAMPS = "nextPageToken, files(id,name,mimeType,parents,webViewLink,modifiedTime,shortcutDetails(targetId,targetMimeType))";

// Parcours récursif du dossier racine. Les raccourcis (très présents dans
// les dossiers d'indicateur) sont remplacés par leur cible : c'est le
// fichier réel qu'il faut référencer.
export async function construireIndex(drive, racineId, { maxDossiers = 400 } = {}) {
  const entrees = [];
  const file = [{ id: racineId, chemin: "" }];
  const vus = new Set([racineId]);
  let dossiers = 0;

  while (file.length && dossiers < maxDossiers) {
    const courant = file.shift();
    dossiers++;
    let pageToken;
    do {
      const { data } = await drive.files.list({
        q: `'${courant.id}' in parents and trashed = false`,
        fields: CHAMPS, pageSize: 200, pageToken,
        supportsAllDrives: true, includeItemsFromAllDrives: true,
      });
      for (const f of data.files || []) {
        const chemin = courant.chemin ? `${courant.chemin} / ${f.name}` : f.name;
        if (f.mimeType === DOSSIER) {
          // Un dossier est aussi une preuve possible : le classeur renvoie
          // parfois vers un dossier entier (« Programmes des formations »).
          entrees.push({ id: f.id, nom: f.name, mime: f.mimeType, chemin, url: f.webViewLink, dossier: true });
          if (!vus.has(f.id)) { vus.add(f.id); file.push({ id: f.id, chemin }); }
        } else if (f.mimeType === RACCOURCI && f.shortcutDetails?.targetId) {
          entrees.push({
            id: f.shortcutDetails.targetId, nom: f.name, mime: f.shortcutDetails.targetMimeType,
            chemin, url: `https://drive.google.com/file/d/${f.shortcutDetails.targetId}/view`, raccourci: true,
          });
        } else {
          entrees.push({ id: f.id, nom: f.name, mime: f.mimeType, chemin, url: f.webViewLink });
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
  }
  return { entrees, dossiersParcourus: dossiers, tronque: file.length > 0 };
}

const motsUtiles = (s) => normaliser(s).split(" ").filter((m) => m.length > 2);

// Score 0-100 entre le nom écrit dans le classeur et un fichier Drive.
export function score(nomClasseur, entree) {
  const a = normaliser(nomClasseur);
  const b = normaliser(entree.nom);
  if (!a || !b) return 0;
  if (a === b) return 100;
  // « Conditions_generales_vente_A2C » vs « CGV_A2C » : l'un contient l'autre.
  if (b.startsWith(a) || a.startsWith(b)) return 88;
  if (b.includes(a) || a.includes(b)) return 78;
  const ma = motsUtiles(a), mb = new Set(motsUtiles(b));
  if (!ma.length) return 0;
  const communs = ma.filter((m) => mb.has(m)).length;
  return Math.round((communs / Math.max(ma.length, mb.size || 1)) * 70);
}

// Le dossier porte-t-il le numéro d'indicateur cherché ? « indicateur 1 »
// ne doit pas matcher « indicateur 11 », d'où la limite de mot.
export function cheminPorteIndicateur(chemin, numero) {
  return new RegExp(`indicateur\\s*0?${numero}(?!\\d)`, "i").test(normaliser(chemin).replace(/indic /g, "indicateur "));
}

const SEUIL_SUR = 85;   // en dessous, l un rapprochement approché demande confirmation
const ECART_SUR = 12;   // deux candidats trop proches = ambigu

// Rapproche un nom de document d un fichier. Ne tranche que si le
// rapprochement est net : nom identique, ou nettement meilleur que le
// suivant. Sinon il propose des candidats et laisse l admin confirmer.
export function rapprocher(nomClasseur, index, { indicateur = null, maxCandidats = 5 } = {}) {
  const notes = index
    .map((e) => {
      const base = score(nomClasseur, e);
      // Un fichier rangé dans le dossier de l indicateur est plus plausible
      // qu un homonyme ailleurs : le bonus départage, il ne crée jamais un
      // rapprochement à lui seul (base > 0 exigée).
      const bonus = base > 0 && indicateur && cheminPorteIndicateur(e.chemin || "", indicateur) ? 10 : 0;
      return { ...e, base, score: Math.min(100, base), rang: base + bonus };
    })
    .filter((e) => e.base >= 40)
    .sort((a, b) => b.rang - a.rang || a.nom.length - b.nom.length);

  const candidats = notes.slice(0, maxCandidats);
  const sortie = (fichier, aConfirmer, motif) => ({ fichier, candidats, aConfirmer, motif });
  if (!candidats.length) return sortie(null, true, "Aucun fichier Drive au nom proche.");

  // Nom identique : c est le cas le plus fréquent et le plus sûr.
  const exacts = notes.filter((e) => e.base === 100);
  if (exacts.length === 1) return sortie(exacts[0], false, null);
  if (exacts.length > 1) {
    const meilleur = exacts[0];
    return exacts[1].rang < meilleur.rang
      ? sortie(meilleur, false, null)
      : sortie(null, true, exacts.length + " fichiers Drive portent ce nom.");
  }

  const [premier, second] = candidats;
  if (premier.score < SEUIL_SUR) return sortie(null, true, "Rapprochement incertain (score " + premier.score + ").");
  if (second && premier.rang - second.rang < ECART_SUR)
    return sortie(null, true, candidats.length + " fichiers Drive également plausibles.");
  return sortie(premier, false, null);
}
