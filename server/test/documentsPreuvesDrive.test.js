// ─────────────────────────────────────────────────────────────
//  Contrôles Drive D-R et D-P (spec §5.3, §5.4) avec un FAUX client Drive.
//  Aucun appel réseau, aucun jeton. Données fictives.
// ─────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { controleDriveFichier, resoudreRacine, ErreurDocument, PROFONDEUR_MAX } from "../src/services/documentsPreuves.js";

const RACINE = "RACINE";
const COMPTE = "vigie@compte.test";
const ADMIN = "admin@vigie.test";
const EMAILS = new Set([COMPTE, ADMIN]);

function fauxDrive({ fichiers = {}, permissions = {}, dossiersParNom = [] } = {}) {
  const appels = { get: 0, permissions: 0 };
  return {
    appels,
    files: {
      async get({ fileId }) {
        appels.get++;
        const f = fichiers[fileId];
        if (!f) throw Object.assign(new Error("introuvable"), { code: 404 });
        return { data: f };
      },
      async list({ q }) {
        const nom = /name = '([^']*)'/.exec(q)?.[1];
        return { data: { files: dossiersParNom.filter((d) => d.name === nom) } };
      },
    },
    permissions: {
      async list({ fileId, pageToken }) {
        appels.permissions++;
        const pages = permissions[fileId] ?? [[]];
        const index = pageToken ? Number(pageToken) : 0;
        const suivant = index + 1 < pages.length ? String(index + 1) : undefined;
        return { data: { permissions: pages[index], nextPageToken: suivant } };
      },
    },
  };
}

const proprietaire = [{ emailAddress: COMPTE }];
const proprioOk = { owners: proprietaire };

// Chaîne d'ancêtres : f → p1 → … → pn → racine (profondeur = nombre de sauts).
function chaine(profondeur) {
  const fichiers = {};
  const noeuds = [];
  for (let i = 1; i < profondeur; i++) noeuds.push("P" + i);
  let suivant = RACINE;
  for (let i = noeuds.length - 1; i >= 0; i--) {
    fichiers[noeuds[i]] = { id: noeuds[i], parents: [suivant] };
    suivant = noeuds[i];
  }
  fichiers.F = { id: "F", parents: [suivant], ...proprioOk };
  return fichiers;
}

const controle = (drive, id = "F") => controleDriveFichier(drive, id, { racineId: RACINE, compteVigie: COMPTE, emailsAutorises: EMAILS });

async function erreur(fn, code) {
  try { await fn(); } catch (e) {
    assert.ok(e instanceof ErreurDocument, "ErreurDocument attendue : " + e.message);
    assert.equal(e.code, code);
    return e;
  }
  assert.fail(`aucune erreur (attendu ${code})`);
}

test("D-R : fichier directement sous la racine : conforme", async () => {
  const drive = fauxDrive({ fichiers: { F: { id: "F", parents: [RACINE], ...proprioOk } } });
  assert.deepEqual(await controle(drive), { ok: true });
});

test("D-R : profondeur 10 acceptée, profondeur 11 refusée", async () => {
  const ok = fauxDrive({ fichiers: chaine(PROFONDEUR_MAX) });
  assert.deepEqual(await controle(ok), { ok: true });
  const trop = fauxDrive({ fichiers: chaine(PROFONDEUR_MAX + 1) });
  await erreur(() => controle(trop), "fichier_hors_racine");
});

test("D-R : fichier hors de la racine refusé", async () => {
  const drive = fauxDrive({ fichiers: { X: { id: "X", parents: ["AUTRE"] }, AUTRE: { id: "AUTRE", parents: [] }, F: { id: "F", parents: ["X"], ...proprioOk } } });
  await erreur(() => controle(drive), "fichier_hors_racine");
});

test("D-R : un fichier avec plusieurs parents est accepté si l'un mène à la racine", async () => {
  const drive = fauxDrive({ fichiers: {
    HORS: { id: "HORS", parents: ["AILLEURS"] }, AILLEURS: { id: "AILLEURS", parents: [] },
    F: { id: "F", parents: ["HORS", RACINE], ...proprioOk },
  } });
  assert.deepEqual(await controle(drive), { ok: true });
});

test("fichier à la corbeille Drive refusé", async () => {
  const drive = fauxDrive({ fichiers: { F: { id: "F", parents: [RACINE], trashed: true, ...proprioOk } } });
  await erreur(() => controle(drive), "fichier_corbeille");
});

test("propriétaire autre que le compte Vigie refusé", async () => {
  const drive = fauxDrive({ fichiers: { F: { id: "F", parents: [RACINE], owners: [{ emailAddress: "perso@gmail.test" }] } } });
  await erreur(() => controle(drive), "proprietaire_non_conforme");
});

test("D-P : un partage « anyone » est refusé", async () => {
  const drive = fauxDrive({
    fichiers: { F: { id: "F", parents: [RACINE], ...proprioOk } },
    permissions: { F: [[{ id: "1", type: "user", role: "owner", emailAddress: COMPTE }, { id: "2", type: "anyone", role: "reader" }]] },
  });
  await erreur(() => controle(drive), "permissions_non_conformes");
});

test("D-P : partage de domaine refusé ; groupe refusé", async () => {
  const domaine = fauxDrive({
    fichiers: { F: { id: "F", parents: [RACINE], ...proprioOk } },
    permissions: { F: [[{ type: "domain", role: "reader", domain: "a2c.fr" }]] },
  });
  await erreur(() => controle(domaine), "permissions_non_conformes");
  const groupe = fauxDrive({
    fichiers: { F: { id: "F", parents: [RACINE], ...proprioOk } },
    permissions: { F: [[{ type: "group", role: "reader", emailAddress: "equipe@x.test" }]] },
  });
  await erreur(() => controle(groupe), "permissions_non_conformes");
});

test("D-P : un contributeur ayant accès au fichier est refusé", async () => {
  const drive = fauxDrive({
    fichiers: { F: { id: "F", parents: [RACINE], ...proprioOk } },
    permissions: { F: [[{ type: "user", role: "reader", emailAddress: "contrib@ecole.test" }]] },
  });
  await erreur(() => controle(drive), "permissions_non_conformes");
});

test("D-P : compte Vigie et administrateurs autorisés", async () => {
  const drive = fauxDrive({
    fichiers: { F: { id: "F", parents: [RACINE], ...proprioOk } },
    permissions: { F: [[{ type: "user", role: "owner", emailAddress: COMPTE }, { type: "user", role: "reader", emailAddress: ADMIN }]] },
  });
  assert.deepEqual(await controle(drive), { ok: true });
});

test("D-P : la pagination des permissions est parcourue jusqu'au bout", async () => {
  const drive = fauxDrive({
    fichiers: { F: { id: "F", parents: [RACINE], ...proprioOk } },
    permissions: { F: [
      [{ type: "user", role: "owner", emailAddress: COMPTE }],
      [{ type: "anyone", role: "reader" }],
    ] },
  });
  await erreur(() => controle(drive), "permissions_non_conformes");
});

test("les détails d'erreur ne contiennent aucune adresse e-mail", async () => {
  const drive = fauxDrive({
    fichiers: { F: { id: "F", parents: [RACINE], ...proprioOk } },
    permissions: { F: [[{ type: "user", role: "reader", emailAddress: "contrib@ecole.test" }]] },
  });
  const e = await erreur(() => controle(drive), "permissions_non_conformes");
  assert.equal(JSON.stringify(e.details).includes("@"), false);
});

test("résolution de racine : identifiant configuré utilisé sans appel Drive", async () => {
  const drive = fauxDrive();
  assert.equal(await resoudreRacine(drive, { driveRacineId: "ID_CONFIG", driveRacine: "A2C Qualiopi" }), "ID_CONFIG");
});

test("résolution de racine : dossier unique par nom à la racine du Drive", async () => {
  const drive = fauxDrive({ dossiersParNom: [{ id: "TROUVE", name: "A2C Qualiopi" }] });
  assert.equal(await resoudreRacine(drive, { driveRacineId: "", driveRacine: "A2C Qualiopi" }), "TROUVE");
});

test("résolution de racine : dossier absent ou ambigu refusé", async () => {
  await erreur(() => resoudreRacine(fauxDrive(), { driveRacineId: "", driveRacine: "A2C Qualiopi" }), "racine_introuvable");
  const double = fauxDrive({ dossiersParNom: [{ id: "A", name: "X" }, { id: "B", name: "X" }] });
  await erreur(() => resoudreRacine(double, { driveRacineId: "", driveRacine: "X" }), "racine_introuvable");
});
