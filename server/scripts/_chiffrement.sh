#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  SÉCU-02 bis — Chiffrement AUTHENTIFIÉ (Encrypt-then-MAC), partagé par
#  sauvegarder.sh et restaurer.sh. Jamais dupliqué : une seule implémentation
#  à auditer.
#
#  AES-256-GCM (chiffrement authentifié natif) a été essayé et s'est révélé
#  INDISPONIBLE sur la commande `openssl enc` de ce poste (« AEAD ciphers
#  not supported »). Construction retenue à la place, avec les SEULS outils
#  déjà présents (openssl, xxd — aucune installation) :
#
#    Encrypt-THEN-MAC, clés DISTINCTES pour le chiffrement et
#    l'authentification, dérivées de la phrase de chiffrement via
#    `openssl enc -pbkdf2 -iter 600000 -pass env:... -S <sel> -P`
#    — qui n'écrit RIEN sur disque et n'exécute aucun chiffrement réel :
#    il affiche seulement le couple (clé, IV) que PBKDF2 aurait produit
#    pour ce sel. Un sel DIFFÉRENT pour le chiffrement et pour
#    l'authentification donne deux clés indépendantes.
#
#    IMPORTANT (trouvé en auditant ce fichier, SÉCU-02 bis) : la
#    sous-commande `openssl kdf` a été essayée en premier, mais son
#    option `-kdfopt pass:env:VAR` ne fait AUCUNE indirection — elle
#    utilise la CHAÎNE LITTÉRALE « env:VAR » comme mot de passe, qui ne
#    réagit donc JAMAIS à la vraie valeur de la variable. `openssl enc
#    -pass env:VAR` (utilisé ici) est, lui, correctement vérifié avec
#    des phrases différentes produisant des clés différentes.
#
#    Format du fichier .dump.enc (tout en binaire brut) :
#      [0:8)   SALT_CHIFFREMENT (sel PBKDF2 pour la clé AES + l'IV)
#      [8:16)  SALT_MAC         (sel PBKDF2 pour la clé HMAC, différent)
#      [16:48) TAG              (HMAC-SHA256 du CHIFFRÉ — jamais du clair,
#                                 pour éviter tout risque de type « oracle
#                                 de remplissage »)
#      [48:…)  CHIFFRÉ (AES-256-CBC)
#
#    À la lecture : le TAG est TOUJOURS revérifié avant la moindre tentative
#    de déchiffrement. Une phrase de chiffrement incorrecte ET une
#    altération du fichier produisent la MÊME erreur explicite (on ne peut
#    pas distinguer les deux cryptographiquement — et il ne faut pas
#    chercher à le faire), mais dans les deux cas, AUCUN déchiffrement
#    n'est tenté sur des données non authentifiées.
#
#  Limite assumée et documentée (VIGIE_AGENT_LOG.md, SÉCU-02 bis) : les
#  clés dérivées (jamais la phrase de chiffrement elle-même) apparaissent
#  brièvement en argument de `openssl enc -K`/`openssl dgst -macopt`, donc
#  visibles dans `ps` le temps de l'exécution — aucune option `env:`/
#  `file:` n'existe pour une clé déjà dérivée sur ces options précises.
#  Risque résiduel mineur (clé à usage unique par fichier, jamais la
#  phrase de chiffrement elle-même, nécessite un accès LOCAL ET simultané
#  à la machine).
# ─────────────────────────────────────────────────────────────

VIGIE_KDF_ITER=600000

# Dérive (clé, IV) via `openssl enc -P` pour un sel donné — AUCUN fichier
# écrit, AUCUN chiffrement réel exécuté, juste l'affichage du couple que
# PBKDF2 produirait. Résultat dans les variables globales
# VIGIE_CLE_DERIVEE_HEX / VIGIE_IV_DERIVE_HEX.
_vigie_deriver() {
  local sel_hex="$1" sortie
  sortie=$(openssl enc -aes-256-cbc -pbkdf2 -iter "$VIGIE_KDF_ITER" \
    -pass env:VIGIE_BACKUP_PASSPHRASE -S "$sel_hex" -P 2>/dev/null)
  VIGIE_CLE_DERIVEE_HEX=$(printf '%s\n' "$sortie" | sed -n 's/^key=//p')
  VIGIE_IV_DERIVE_HEX=$(printf '%s\n' "$sortie" | sed -n 's/^iv *=//p')
  if [ ${#VIGIE_CLE_DERIVEE_HEX} -ne 64 ] || [ ${#VIGIE_IV_DERIVE_HEX} -ne 32 ]; then
    echo "ERREUR chiffrement : dérivation de clé impossible (openssl enc -P)." >&2
    return 1
  fi
}

# Chiffre $1 (clair) vers $2 (fichier .dump.enc final, avec en-tête
# authentifié). $3 = fonction de rédaction des secrets (appliquée à toute
# sortie d'erreur d'openssl).
vigie_chiffrer_authentifie() {
  local clair="$1" sortie="$2" redacter="$3"
  local sel_enc_hex sel_mac_hex cle_chiffrement iv_chiffrement cle_mac corps tag_hex
  sel_enc_hex=$(openssl rand -hex 8)
  sel_mac_hex=$(openssl rand -hex 8)

  _vigie_deriver "$sel_enc_hex" || return 1
  cle_chiffrement="$VIGIE_CLE_DERIVEE_HEX"
  iv_chiffrement="$VIGIE_IV_DERIVE_HEX"
  _vigie_deriver "$sel_mac_hex" || return 1
  cle_mac="$VIGIE_CLE_DERIVEE_HEX"

  corps=$(mktemp -t "vigie-corps-XXXXXX.bin")
  chmod 600 "$corps"
  if ! openssl enc -aes-256-cbc -K "$cle_chiffrement" -iv "$iv_chiffrement" \
       -in "$clair" -out "$corps" 2> >("$redacter" >&2); then
    rm -f "$corps"
    return 1
  fi
  tag_hex=$(openssl dgst -sha256 -mac HMAC -macopt "hexkey:$cle_mac" -binary "$corps" 2> >("$redacter" >&2) | xxd -p -c 256)
  if [ -z "$tag_hex" ]; then rm -f "$corps"; return 1; fi

  {
    printf '%s' "$sel_enc_hex" | xxd -r -p
    printf '%s' "$sel_mac_hex" | xxd -r -p
    printf '%s' "$tag_hex" | xxd -r -p
    cat "$corps"
  } > "$sortie"
  rm -f "$corps"
}

# Vérifie l'authenticité de $1 (fichier .dump.enc) puis déchiffre vers $2.
# Échoue AVANT tout déchiffrement si le TAG ne correspond pas (phrase de
# chiffrement incorrecte OU fichier altéré — message volontairement
# commun aux deux cas, cf. en-tête de ce fichier).
vigie_dechiffrer_verifie() {
  local chiffre="$1" sortie="$2" redacter="$3"
  local taille sel_enc_hex sel_mac_hex tag_attendu corps tag_calcule
  taille=$(wc -c < "$chiffre" | tr -d ' ')
  if [ "$taille" -lt 48 ]; then
    echo "ERREUR : fichier trop court pour contenir un en-tête valide — jamais déchiffré." >&2
    return 1
  fi
  sel_enc_hex=$(dd if="$chiffre" bs=1 skip=0 count=8 2>/dev/null | xxd -p -c 256)
  sel_mac_hex=$(dd if="$chiffre" bs=1 skip=8 count=8 2>/dev/null | xxd -p -c 256)
  tag_attendu=$(dd if="$chiffre" bs=1 skip=16 count=32 2>/dev/null | xxd -p -c 256)
  corps=$(mktemp -t "vigie-corps-verif-XXXXXX.bin")
  chmod 600 "$corps"
  tail -c +49 "$chiffre" > "$corps"

  _vigie_deriver "$sel_mac_hex" || { rm -f "$corps"; return 1; }
  local cle_mac="$VIGIE_CLE_DERIVEE_HEX"

  tag_calcule=$(openssl dgst -sha256 -mac HMAC -macopt "hexkey:$cle_mac" -binary "$corps" 2> >("$redacter" >&2) | xxd -p -c 256)
  if [ "$tag_calcule" != "$tag_attendu" ]; then
    rm -f "$corps"
    echo "ERREUR : authenticité invalide — phrase de chiffrement incorrecte OU fichier altéré. Déchiffrement refusé." >&2
    return 1
  fi

  _vigie_deriver "$sel_enc_hex" || { rm -f "$corps"; return 1; }
  local cle_chiffrement="$VIGIE_CLE_DERIVEE_HEX" iv_chiffrement="$VIGIE_IV_DERIVE_HEX"
  if ! openssl enc -d -aes-256-cbc -K "$cle_chiffrement" -iv "$iv_chiffrement" \
       -in "$corps" -out "$sortie" 2> >("$redacter" >&2); then
    rm -f "$corps"
    return 1
  fi
  rm -f "$corps"
}
