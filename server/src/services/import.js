// ─────────────────────────────────────────────────────────────
//  Import du classeur de suivi → table preuves.
//  Orchestration seule : la lecture Google est dans google.js, l'analyse
//  dans classeur.js, le rapprochement dans driveIndex.js.
//
//  Rejouable : une preuve importée est identifiée par (indicateur, titre).
//  Un second passage met à jour, ne duplique pas, et NE TOUCHE PAS un
//  rattachement déjà validé à la main par l'admin (validee_le).
// ─────────────────────────────────────────────────────────────
import { getPool, query } from "../db.js";
import { getDrive, chercherClasseurs, lireOnglet, appelGoogle, etatJeton, SHEETS_READONLY } from "./google.js";
import { extrairePreuves, normaliser } from "./classeur.js";
import { construireIndex, rapprocher } from "./driveIndex.js";

// Choisit le classeur de suivi parmi les candidats trouvés par nom.
// Priorité au compte de l'organisme, puis au nom le plus proche des
// intitulés connus, puis au plus récemment modifié.
export function choisirClasseur(candidats, { compte = null } = {}) {
  const note = (f) => {
    const n = normaliser(f.name);
    let s = 0;
    if (compte && (f.owners || []).some((o) => (o.emailAddress || "").toLowerCase() === compte)) s += 30;
    if (n.includes("audit")) s += 20;
    if (n.includes("construction") || n.includes("systeme qualite")) s += 20;
    if (n.includes("qualiopi")) s += 10;
    return s;
  };
  return [...candidats].sort((a, b) =>
    note(b) - note(a) || new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0)
  )[0] || null;
}

async function indicateursActifs() {
  const { rows } = await query(
    `SELECT i.id, i.numero FROM indicateurs i
     JOIN referentiel_versions v ON v.id = i.version_id AND v.est_active`
  );
  return new Map(rows.map((r) => [r.numero, r.id]));
}

// apercu = true : rien n'est écrit, on renvoie ce qui SERAIT importé.
// `client` n est passé que par les tests : en production il vient de getDrive().
export async function importerClasseur({ fichierId = null, onglet = null, apercu = false, utilisateurId = null, client: clientGoogle = null } = {}) {
  const d = clientGoogle || (await getDrive());
  if (!d) throw new Error("Drive non connecté : connectez le compte de l'organisme avant d'importer.");
  if (!d.row.scopes.split(/\s+/).includes(SHEETS_READONLY)) {
    throw new Error("Le Drive a été connecté sans l'accès aux feuilles de calcul. Reconnectez-le pour autoriser la lecture du classeur.");
  }

  let fichier;
  if (fichierId) {
    const { data } = await appelGoogle(
      "drive.files.get",
      () => d.drive.files.get({
        fileId: fichierId, fields: "id,name,parents,webViewLink,modifiedTime,owners(emailAddress)", supportsAllDrives: true,
      }),
      { api: "drive", fichierId, jeton: etatJeton(d.row) }
    );
    fichier = data;
  } else {
    const candidats = await chercherClasseurs(d.drive, { jeton: d.row });
    fichier = choisirClasseur(candidats, { compte: d.row.email });
    if (!fichier) throw new Error("Aucun classeur de suivi trouvé sur le Drive (recherche par nom).");
  }

  const lu = await lireOnglet(d.sheets, fichier.id, onglet, { jeton: d.row });
  const analyse = extrairePreuves(lu.grille, { fusions: lu.fusions });
  if (analyse.erreur) {
    const e = new Error(analyse.erreur);
    e.entetes = analyse.entetes;
    throw e;
  }

  // Index Drive limité au dossier qui contient le classeur : c'est
  // l'arborescence des dossiers de critère déjà organisée.
  const racine = fichier.parents?.[0];
  const index = racine ? await construireIndex(d.drive, racine) : { entrees: [] };

  const parNumero = await indicateursActifs();
  const lignes = [];
  const ignorees = [...analyse.ignorees];
  for (const p of analyse.preuves) {
    const indicateurId = parNumero.get(p.indicateur);
    if (!indicateurId) {
      ignorees.push({ ligne: p.lignes_source[0], motif: `indicateur ${p.indicateur} hors référentiel actif`, valeur: p.titre.slice(0, 60) });
      continue;
    }
    const r = rapprocher(p.titre, index.entrees, { indicateur: p.indicateur });
    lignes.push({
      ...p, indicateur_id: indicateurId,
      drive_file_id: r.fichier?.id || null,
      drive_url: r.fichier?.url || null,
      drive_nom: r.fichier?.nom || null,
      drive_mime: r.fichier?.mime || null,
      a_confirmer: r.aConfirmer,
      motif_confirmation: r.motif,
      candidats: r.candidats.map((c) => ({ id: c.id, nom: c.nom, url: c.url, chemin: c.chemin, mime: c.mime, score: c.score })),
    });
  }

  const resume = {
    fichier: { id: fichier.id, nom: fichier.name, url: fichier.webViewLink },
    onglet: lu.onglet, onglets: lu.onglets, entetes: analyse.entetes, colonnes: analyse.colonnes,
    lignesLues: analyse.lignesLues, preuves: lignes.length,
    aConfirmer: lignes.filter((l) => l.a_confirmer).length,
    parStatut: lignes.reduce((a, l) => ({ ...a, [l.statut]: (a[l.statut] || 0) + 1 }), {}),
    fichiersIndexes: index.entrees.length,
    ignorees: ignorees.slice(0, 200), nbIgnorees: ignorees.length,
  };
  if (apercu) return { ...resume, apercu: true, lignes: lignes.slice(0, 50) };

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows: [imp] } = await client.query(
      `INSERT INTO imports_drive (fichier_id, fichier_nom, fichier_url, onglet, entetes, colonnes, lignes_lues, lignes_ignorees, lance_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [fichier.id, fichier.name, fichier.webViewLink || null, lu.onglet, JSON.stringify(analyse.entetes),
       JSON.stringify(analyse.colonnes), analyse.lignesLues, JSON.stringify(resume.ignorees), utilisateurId]
    );
    let creees = 0, majes = 0;
    for (const l of lignes) {
      const { rows } = await client.query(
        `INSERT INTO preuves (indicateur_id, titre, statut, source,
           modele_nom, tache, etat_source, occurrences, lignes_source, a_confirmer, motif_confirmation, candidats,
           import_id, created_by)
         VALUES ($1,$2,$3,'import_drive',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (indicateur_id, md5(lower(titre))) WHERE source = 'import_drive' DO UPDATE SET
           statut = EXCLUDED.statut, modele_nom = EXCLUDED.modele_nom, tache = EXCLUDED.tache,
           etat_source = EXCLUDED.etat_source, occurrences = EXCLUDED.occurrences,
           lignes_source = EXCLUDED.lignes_source, import_id = EXCLUDED.import_id,
           -- un rattachement validé à la main n'est jamais écrasé par un réimport
           a_confirmer = CASE WHEN preuves.validee_le IS NULL THEN EXCLUDED.a_confirmer ELSE false END,
           motif_confirmation = CASE WHEN preuves.validee_le IS NULL THEN EXCLUDED.motif_confirmation ELSE preuves.motif_confirmation END,
           candidats = CASE WHEN preuves.validee_le IS NULL THEN EXCLUDED.candidats ELSE preuves.candidats END
         RETURNING id, (xmax = 0) AS creee, validee_le`,
        [l.indicateur_id, l.titre, l.statut,
         l.modele_nom, l.tache, l.etat_source, l.occurrences, l.lignes_source, l.a_confirmer,
         l.motif_confirmation, JSON.stringify(l.candidats), imp.id, utilisateurId]
      );
      const preuve = rows[0];
      if (preuve?.creee) creees++; else majes++;

      // Le fichier rapproché devient une pièce jointe. Le rapprochement
      // lui-même n'a pas changé : seul l'endroit où son résultat est rangé
      // a bougé, une preuve pouvant désormais en porter plusieurs.
      // Un rattachement validé à la main n'est pas retouché, et les
      // fichiers ajoutés à la main ne sont jamais supprimés : on ne
      // remplace que ce qu'un import précédent avait posé.
      if (preuve && !preuve.validee_le) {
        await client.query(
          "DELETE FROM preuve_fichiers WHERE preuve_id = $1 AND source = 'import_drive'" +
            (l.drive_file_id ? " AND drive_file_id <> $2" : ""),
          l.drive_file_id ? [preuve.id, l.drive_file_id] : [preuve.id]
        );
        if (l.drive_file_id) {
          await client.query(
            `INSERT INTO preuve_fichiers (preuve_id, drive_file_id, drive_url, drive_nom, drive_mime, source, ajoute_par)
             VALUES ($1, $2, $3, $4, $5, 'import_drive', $6)
             ON CONFLICT (preuve_id, drive_file_id) DO UPDATE SET
               drive_url = EXCLUDED.drive_url, drive_nom = EXCLUDED.drive_nom, drive_mime = EXCLUDED.drive_mime`,
            [preuve.id, l.drive_file_id, l.drive_url, l.drive_nom, l.drive_mime, utilisateurId]
          );
        }
      }
    }
    await client.query(
      `UPDATE imports_drive SET preuves_creees = $2, preuves_majes = $3, statut = 'termine', termine_le = now() WHERE id = $1`,
      [imp.id, creees, majes]
    );
    await client.query("COMMIT");
    return { ...resume, importId: imp.id, creees, majes };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
