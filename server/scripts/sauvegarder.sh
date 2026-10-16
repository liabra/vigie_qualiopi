#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  SÉCU-01 — Sauvegarde PostgreSQL externe, chiffrée, hors Railway.
#
#  Niveau 2 de la stratégie de sauvegarde (le niveau 1, natif Railway,
#  dépend du plan et se configure dans le dashboard — voir
#  VIGIE_AGENT_LOG.md). Ce script ne fait QUE lire la base (pg_dump) :
#  aucune écriture, jamais de risque pour la production.
#
#  Jamais de secret affiché : l'URL de connexion et la phrase de
#  chiffrement viennent UNIQUEMENT de variables d'environnement, jamais
#  d'un argument en ligne de commande (visible dans l'historique shell
#  ou `ps`).
#
#  Variables requises :
#    VIGIE_BACKUP_DATABASE_URL   URL PUBLIQUE de la base à sauvegarder
#                                 (jamais l'URL interne Railway, injoignable
#                                 depuis l'extérieur).
#    VIGIE_BACKUP_PASSPHRASE     phrase de chiffrement (AES-256).
#  Variable optionnelle :
#    VIGIE_BACKUP_DIR            dossier de sortie (défaut : ./sauvegardes,
#                                 jamais suivi par Git — voir .gitignore).
#
#  Sortie : un fichier chiffré ./sauvegardes/vigie-AAAAMMJJ-HHMMSS.dump.enc
#  Échec : code de sortie non nul + message clair sur stderr (le
#  signalement effectif — alerte cron, notification CI... — dépend de
#  l'outil qui planifie ce script, pas de ce script lui-même).
# ─────────────────────────────────────────────────────────────
set -euo pipefail

if [ -z "${VIGIE_BACKUP_DATABASE_URL:-}" ]; then
  echo "ERREUR sauvegarde : VIGIE_BACKUP_DATABASE_URL manquante (URL publique de la base)." >&2
  exit 1
fi
if [ -z "${VIGIE_BACKUP_PASSPHRASE:-}" ]; then
  echo "ERREUR sauvegarde : VIGIE_BACKUP_PASSPHRASE manquante (phrase de chiffrement)." >&2
  exit 1
fi

DOSSIER="${VIGIE_BACKUP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/sauvegardes}"
mkdir -p "$DOSSIER"

HORODATAGE=$(date +%Y%m%d-%H%M%S)
DUMP_CLAIR=$(mktemp -t "vigie-dump-XXXXXX.dump")
FICHIER_CHIFFRE="$DOSSIER/vigie-$HORODATAGE.dump.enc"

# Le dump en clair ne doit JAMAIS survivre à ce script, succès ou échec.
trap 'rm -f "$DUMP_CLAIR"' EXIT

echo "Sauvegarde : export pg_dump en cours…"
if ! pg_dump "$VIGIE_BACKUP_DATABASE_URL" -Fc -f "$DUMP_CLAIR"; then
  echo "ERREUR sauvegarde : pg_dump a échoué (voir le détail ci-dessus)." >&2
  exit 1
fi

TAILLE_CLAIR=$(wc -c < "$DUMP_CLAIR" | tr -d ' ')
if [ "$TAILLE_CLAIR" -lt 1024 ]; then
  echo "ERREUR sauvegarde : le dump obtenu est anormalement petit ($TAILLE_CLAIR octets) — abandon, rien n'est chiffré." >&2
  exit 1
fi

echo "Sauvegarde : chiffrement AES-256…"
if ! openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:VIGIE_BACKUP_PASSPHRASE \
     -in "$DUMP_CLAIR" -out "$FICHIER_CHIFFRE"; then
  echo "ERREUR sauvegarde : le chiffrement a échoué." >&2
  rm -f "$FICHIER_CHIFFRE"
  exit 1
fi

TAILLE_CHIFFREE=$(wc -c < "$FICHIER_CHIFFRE" | tr -d ' ')
echo "Sauvegarde réussie : $FICHIER_CHIFFRE ($TAILLE_CHIFFREE octets chiffrés, $TAILLE_CLAIR en clair)."
