// Garde-fou de version, né d'un vrai bug.
//
// @googleapis/sheets embarque googleapis-common, qui passe nos options de
// requête à NOTRE OAuth2Client. Si les deux ne parlent pas la même version
// de google-auth-library, l'en-tête Authorization est perdu en chemin : la
// requête part sans identité et Google répond 403 « Method doesn't allow
// unregistered callers », alors que le jeton, le scope et le projet Cloud
// sont parfaitement valides. Drive, lui, continue de fonctionner, ce qui
// rend le diagnostic très trompeur.
//
// Ce test échoue AVANT que le bug n'atteigne la production.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const ici = createRequire(import.meta.url);
const majeure = (v) => Number(String(v).split(".")[0]);

// Version de google-auth-library qu'un paquet Google voit chez lui.
function versionAuthDe(paquet) {
  const rp = createRequire(ici.resolve(paquet + "/package.json"));
  const rc = createRequire(rp.resolve("googleapis-common/package.json"));
  return {
    common: rp("googleapis-common/package.json").version,
    auth: rc("google-auth-library/package.json").version,
  };
}

const notre = ici("google-auth-library/package.json").version;

test("notre OAuth2Client et @googleapis/sheets partagent la même majeure de google-auth-library", () => {
  const { auth, common } = versionAuthDe("@googleapis/sheets");
  assert.equal(
    majeure(auth), majeure(notre),
    `google-auth-library ${notre} côté application contre ${auth} attendu par ` +
    `googleapis-common ${common} de @googleapis/sheets : l'en-tête Authorization serait perdu.`
  );
});

test("même vérification pour @googleapis/drive", () => {
  const { auth, common } = versionAuthDe("@googleapis/drive");
  assert.ok(
    majeure(auth) <= majeure(notre),
    `google-auth-library ${notre} côté application contre ${auth} attendu par ` +
    `googleapis-common ${common} de @googleapis/drive.`
  );
});
