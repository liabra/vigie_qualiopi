// Faux client Drive CONFORME pour les tests de routes : il satisfait les contrôles D-R et D-P
// (racine résolue par nom, fichier sous la racine, propriétaire = compte Vigie, seul
// propriétaire dans les permissions). Aucun réseau, aucun jeton.
import { config } from "../../src/config.js";

export const RACINE_TEST = "RACINE_TEST";

export function driveConforme(metadonnees = () => ({})) {
  return {
    files: {
      async get({ fileId, fields }) {
        const base = {
          id: fileId, name: "Fichier.pdf", mimeType: "application/pdf",
          webViewLink: "https://drive.google.com/file/d/" + fileId + "/view",
          parents: [RACINE_TEST], trashed: false, owners: [{ emailAddress: config.driveAccountEmail }],
        };
        return { data: { ...base, ...metadonnees(fileId) } };
      },
      async list({ q }) {
        if (q.includes(`name = '${config.driveRacine}'`)) return { data: { files: [{ id: RACINE_TEST }] } };
        return { data: { files: [] } };
      },
    },
    permissions: {
      async list() {
        return { data: { permissions: [{ id: "owner", type: "user", role: "owner", emailAddress: config.driveAccountEmail }] } };
      },
    },
  };
}
