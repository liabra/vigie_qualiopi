#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  SÉCU-01/SÉCU-02 — Restauration d'une sauvegarde chiffrée, vers une base
#  CIBLE EXPLICITE — jamais la production par défaut.
#
#  Garde-fou : refuse de restaurer si la cible est IDENTIQUE à
#  DATABASE_URL ou DATABASE_PUBLIC_URL présentes dans l'environnement
#  (protection contre un copier-coller malheureux, pas contre une
#  volonté délibérée de restaurer en production — qui reste possible,
#  mais jamais par défaut ni par erreur).
#
#  Jamais de secret affiché NI JOURNALISÉ (même logique de masquage que
#  sauvegarder.sh). La phrase de chiffrement peut venir du Trousseau
#  macOS si elle n'est pas fournie en variable d'environnement.
#
#  Usage :
#    VIGIE_RESTORE_TARGET_URL="postgresql://…/une_base_vide" \
#      ./restaurer.sh chemin/vers/vigie-AAAAMMJJ-HHMMSS.dump.enc
#
#  Variables requises :
#    VIGIE_RESTORE_TARGET_URL   base CIBLE (vide ou de test), jamais affichée.
#    VIGIE_BACKUP_PASSPHRASE    même phrase que la sauvegarde (ou Trousseau).
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SERVICE_TROUSSEAU_PASSPHRASE="vigie-sauvegarde-passphrase"

FICHIER_CHIFFRE="${1:-}"
if [ -z "$FICHIER_CHIFFRE" ] || [ ! -f "$FICHIER_CHIFFRE" ]; then
  echo "ERREUR restauration : indiquez le fichier .dump.enc à restaurer en premier argument." >&2
  exit 1
fi
if [ -z "${VIGIE_RESTORE_TARGET_URL:-}" ]; then
  echo "ERREUR restauration : VIGIE_RESTORE_TARGET_URL manquante (base cible, jamais la production)." >&2
  exit 1
fi
if [ -z "${VIGIE_BACKUP_PASSPHRASE:-}" ] && [ -z "${VIGIE_BACKUP_NO_KEYCHAIN:-}" ] && command -v security >/dev/null 2>&1; then
  VIGIE_BACKUP_PASSPHRASE="$(security find-generic-password -a "$USER" -s "$SERVICE_TROUSSEAU_PASSPHRASE" -w 2>/dev/null || true)"
fi
if [ -z "${VIGIE_BACKUP_PASSPHRASE:-}" ]; then
  echo "ERREUR restauration : VIGIE_BACKUP_PASSPHRASE absente (variable d'environnement ou Trousseau macOS)." >&2
  exit 1
fi
if [ -n "${DATABASE_URL:-}" ] && [ "$VIGIE_RESTORE_TARGET_URL" = "${DATABASE_URL:-}" ]; then
  echo "ERREUR restauration : la cible est identique à DATABASE_URL — restauration refusée par sécurité." >&2
  exit 1
fi
if [ -n "${DATABASE_PUBLIC_URL:-}" ] && [ "$VIGIE_RESTORE_TARGET_URL" = "${DATABASE_PUBLIC_URL:-}" ]; then
  echo "ERREUR restauration : la cible est identique à DATABASE_PUBLIC_URL — restauration refusée par sécurité." >&2
  exit 1
fi

MOT_DE_PASSE_CIBLE=$(printf '%s' "$VIGIE_RESTORE_TARGET_URL" | sed -E 's#^[A-Za-z0-9+.-]+://[^:/@]*:([^@]*)@.*#\1#')
redacter() {
  if [ -n "$MOT_DE_PASSE_CIBLE" ] && [ "$MOT_DE_PASSE_CIBLE" != "$VIGIE_RESTORE_TARGET_URL" ]; then
    local motif
    motif=$(printf '%s' "$MOT_DE_PASSE_CIBLE" | sed 's/[.[\*^$()+?{|\/]/\\&/g')
    sed "s/$motif/[SECRET MASQUÉ]/g"
  else
    cat
  fi
}

DUMP_CLAIR=$(mktemp -t "vigie-restore-XXXXXX.dump")
chmod 600 "$DUMP_CLAIR"
trap 'rm -f "$DUMP_CLAIR"' EXIT

echo "Restauration : déchiffrement…"
if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:VIGIE_BACKUP_PASSPHRASE \
     -in "$FICHIER_CHIFFRE" -out "$DUMP_CLAIR" 2> >(redacter >&2); then
  echo "ERREUR restauration : déchiffrement échoué (phrase de chiffrement incorrecte ou fichier corrompu)." >&2
  exit 1
fi

echo "Restauration : vérification de l'archive avant toute écriture (pg_restore --list)…"
if ! pg_restore --list "$DUMP_CLAIR" > /dev/null 2> >(redacter >&2); then
  echo "ERREUR restauration : archive illisible — abandon avant toute écriture sur la cible." >&2
  exit 1
fi

echo "Restauration : pg_restore vers la base cible…"
if ! pg_restore --no-owner --clean --if-exists -d "$VIGIE_RESTORE_TARGET_URL" "$DUMP_CLAIR" 2> >(redacter >&2); then
  echo "ERREUR restauration : pg_restore a échoué (voir le détail ci-dessus)." >&2
  exit 1
fi

echo "Restauration réussie vers la base cible."
