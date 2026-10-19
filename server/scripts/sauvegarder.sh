#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  SÉCU-01/02 — Sauvegarde PostgreSQL externe, chiffrée et AUTHENTIFIÉE
#  (Encrypt-then-MAC, voir _chiffrement.sh), hors Railway.
#
#  Niveau 2 de la stratégie de sauvegarde (le niveau 1, natif Railway,
#  dépend du plan et se configure dans le dashboard — voir
#  VIGIE_AGENT_LOG.md). Ce script ne fait QUE lire la base (pg_dump) :
#  aucune écriture, jamais de risque pour la production.
#
#  Jamais de secret affiché NI JOURNALISÉ : l'URL de connexion et la
#  phrase de chiffrement viennent de variables d'environnement OU, à
#  défaut, du Trousseau macOS (jamais d'un argument en ligne de
#  commande, visible dans l'historique shell ou `ps`) ; tout ce que les
#  commandes externes (pg_dump, openssl, pg_restore) écrivent est
#  filtré pour retirer le mot de passe avant d'atteindre stdout/stderr
#  — donc avant d'atteindre un journal (launchd, cron...).
#
#  Variables (toutes optionnelles si le Trousseau macOS contient les
#  deux items ci-dessous — voir la procédure dans VIGIE_AGENT_LOG.md) :
#    VIGIE_BACKUP_DATABASE_URL   URL PUBLIQUE de la base à sauvegarder
#                                 (jamais l'URL interne Railway, injoignable
#                                 depuis l'extérieur).
#    VIGIE_BACKUP_PASSPHRASE     phrase de chiffrement (AES-256).
#  Variables optionnelles :
#    VIGIE_BACKUP_DIR            dossier de sortie (défaut : ./sauvegardes,
#                                 jamais suivi par Git — voir .gitignore).
#    VIGIE_BACKUP_RETENTION_JOURS  purge des .dump.enc plus anciens que N
#                                 jours APRÈS un succès (défaut : 30 ;
#                                 0 = ne jamais purger). Ne purge JAMAIS
#                                 s'il ne resterait aucun fichier après.
#    VIGIE_BACKUP_COPIE_DIR      second emplacement (ex. disque externe,
#                                 dossier iCloud PERSONNEL — jamais un
#                                 Drive partagé avec l'équipe) qui reçoit
#                                 une copie du fichier déjà chiffré. Jamais
#                                 purgé par ce script.
#
#  Intégrité ET authenticité : voir _chiffrement.sh (Encrypt-then-MAC).
#  En complément, l'archive pg_dump est relue avec `pg_restore --list`
#  juste après l'export ET après un aller-retour chiffrement/déchiffrement
#  complet — AVANT de déclarer la sauvegarde réussie.
#
#  Sortie : un fichier chiffré $DOSSIER/vigie-AAAAMMJJ-HHMMSS.dump.enc,
#  et un fichier d'état $DOSSIER/.dernier-statut (horodatage + ok/échec,
#  jamais de secret) pour la surveillance (launchd, vérification manuelle).
#  Échec : code de sortie non nul + message clair sur stderr.
# ─────────────────────────────────────────────────────────────
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_chiffrement.sh"

# Dossier et fichier d'état déterminés EN PREMIER (ne dépendent d'aucun
# secret) : TOUT échec, y compris un secret manquant ou illisible depuis
# le Trousseau, est consigné au même endroit pour la surveillance —
# jamais seulement dans un journal séparé que personne ne regarde.
DOSSIER="${VIGIE_BACKUP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/sauvegardes}"
RETENTION_JOURS="${VIGIE_BACKUP_RETENTION_JOURS:-30}"
mkdir -p "$DOSSIER"
chmod 700 "$DOSSIER" 2>/dev/null || true
FICHIER_STATUT="$DOSSIER/.dernier-statut"
consigner_echec() { printf '%s échec : %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$FICHIER_STATUT"; }

SERVICE_TROUSSEAU_URL="vigie-sauvegarde-database-url"
SERVICE_TROUSSEAU_PASSPHRASE="vigie-sauvegarde-passphrase"

# Trousseau macOS en repli SEULEMENT si la variable d'environnement est
# absente — jamais de valeur par défaut inventée, jamais d'écrasement
# silencieux d'une variable déjà fournie.
depuis_trousseau() {
  security find-generic-password -a "$USER" -s "$1" -w 2>/dev/null || true
}
if [ -z "${VIGIE_BACKUP_DATABASE_URL:-}" ] && [ -z "${VIGIE_BACKUP_NO_KEYCHAIN:-}" ] && command -v security >/dev/null 2>&1; then
  VIGIE_BACKUP_DATABASE_URL="$(depuis_trousseau "$SERVICE_TROUSSEAU_URL")"
fi
if [ -z "${VIGIE_BACKUP_PASSPHRASE:-}" ] && [ -z "${VIGIE_BACKUP_NO_KEYCHAIN:-}" ] && command -v security >/dev/null 2>&1; then
  VIGIE_BACKUP_PASSPHRASE="$(depuis_trousseau "$SERVICE_TROUSSEAU_PASSPHRASE")"
fi
export VIGIE_BACKUP_PASSPHRASE

if [ -z "${VIGIE_BACKUP_DATABASE_URL:-}" ]; then
  consigner_echec "VIGIE_BACKUP_DATABASE_URL absente (environnement/Trousseau)"
  echo "ERREUR sauvegarde : VIGIE_BACKUP_DATABASE_URL absente (variable d'environnement ou Trousseau macOS)." >&2
  exit 1
fi
if [ -z "${VIGIE_BACKUP_PASSPHRASE:-}" ]; then
  consigner_echec "VIGIE_BACKUP_PASSPHRASE absente (environnement/Trousseau)"
  echo "ERREUR sauvegarde : VIGIE_BACKUP_PASSPHRASE absente (variable d'environnement ou Trousseau macOS)." >&2
  exit 1
fi

# Extrait le mot de passe de l'URL (s'il y en a un) pour le retirer de
# TOUT ce que les commandes externes pourraient écrire — jamais affiché
# ni journalisé, même dans un message d'erreur Postgres/OpenSSL.
MOT_DE_PASSE_URL=$(printf '%s' "$VIGIE_BACKUP_DATABASE_URL" | sed -E 's#^[A-Za-z0-9+.-]+://[^:/@]*:([^@]*)@.*#\1#')
redacter() {
  if [ -n "$MOT_DE_PASSE_URL" ] && [ "$MOT_DE_PASSE_URL" != "$VIGIE_BACKUP_DATABASE_URL" ]; then
    local motif
    motif=$(printf '%s' "$MOT_DE_PASSE_URL" | sed 's/[.[\*^$()+?{|\/]/\\&/g')
    sed "s/$motif/[SECRET MASQUÉ]/g"
  else
    cat
  fi
}

DUMP_CLAIR=$(mktemp -t "vigie-dump-XXXXXX.dump")
chmod 600 "$DUMP_CLAIR"
DUMP_VERIF=$(mktemp -t "vigie-verif-XXXXXX.dump")
chmod 600 "$DUMP_VERIF"
HORODATAGE=$(date +%Y%m%d-%H%M%S)
FICHIER_CHIFFRE="$DOSSIER/vigie-$HORODATAGE.dump.enc"

# Les dumps en clair ne doivent JAMAIS survivre à ce script, succès ou
# échec — y compris sur un arrêt par signal (INT/TERM/HUP), seul un
# SIGKILL y échapperait.
trap 'rm -f "$DUMP_CLAIR" "$DUMP_VERIF"' EXIT

echo "Sauvegarde : export pg_dump en cours…"
if ! pg_dump "$VIGIE_BACKUP_DATABASE_URL" -Fc -f "$DUMP_CLAIR" 2> >(redacter >&2); then
  consigner_echec "pg_dump"
  echo "ERREUR sauvegarde : pg_dump a échoué (voir le détail ci-dessus)." >&2
  exit 1
fi

TAILLE_CLAIR=$(wc -c < "$DUMP_CLAIR" | tr -d ' ')
if [ "$TAILLE_CLAIR" -lt 1024 ]; then
  consigner_echec "dump anormalement petit ($TAILLE_CLAIR octets)"
  echo "ERREUR sauvegarde : le dump obtenu est anormalement petit ($TAILLE_CLAIR octets) — abandon, rien n'est chiffré." >&2
  exit 1
fi

echo "Sauvegarde : vérification de l'archive (pg_restore --list)…"
if ! pg_restore --list "$DUMP_CLAIR" > /dev/null 2> >(redacter >&2); then
  consigner_echec "archive illisible avant chiffrement"
  echo "ERREUR sauvegarde : l'archive produite par pg_dump n'est pas lisible par pg_restore — abandon." >&2
  exit 1
fi

echo "Sauvegarde : chiffrement authentifié (AES-256-CBC + HMAC-SHA256, PBKDF2 600000 itérations)…"
if ! vigie_chiffrer_authentifie "$DUMP_CLAIR" "$FICHIER_CHIFFRE" redacter; then
  consigner_echec "chiffrement"
  rm -f "$FICHIER_CHIFFRE"
  echo "ERREUR sauvegarde : le chiffrement a échoué." >&2
  exit 1
fi
chmod 600 "$FICHIER_CHIFFRE"

echo "Sauvegarde : vérification de bout en bout (authenticité + déchiffrement + relecture)…"
if ! vigie_dechiffrer_verifie "$FICHIER_CHIFFRE" "$DUMP_VERIF" redacter \
   || ! pg_restore --list "$DUMP_VERIF" > /dev/null 2> >(redacter >&2); then
  consigner_echec "vérification post-chiffrement"
  rm -f "$FICHIER_CHIFFRE"
  echo "ERREUR sauvegarde : le fichier chiffré ne repasse pas la vérification — supprimé, jamais présenté comme réussi." >&2
  exit 1
fi

if [ -n "${VIGIE_BACKUP_COPIE_DIR:-}" ]; then
  mkdir -p "$VIGIE_BACKUP_COPIE_DIR" 2>/dev/null || true
  if cp "$FICHIER_CHIFFRE" "$VIGIE_BACKUP_COPIE_DIR/" 2>/dev/null; then
    echo "Sauvegarde : copie hors-Mac déposée dans $VIGIE_BACKUP_COPIE_DIR."
  else
    echo "AVERTISSEMENT sauvegarde : copie hors-Mac vers $VIGIE_BACKUP_COPIE_DIR impossible — la sauvegarde locale reste valide." >&2
  fi
fi

# Rétention : ne purge JAMAIS s'il ne resterait aucun fichier après coup —
# la dernière sauvegarde valide (celle qu'on vient de produire et de
# vérifier) n'est de toute façon jamais une candidate (elle vient d'être
# créée, donc jamais « plus ancienne que N jours »), mais ce garde-fou
# protège aussi contre une horloge ou une configuration inattendue.
if [ "$RETENTION_JOURS" -gt 0 ] 2>/dev/null; then
  CANDIDATS=$(find "$DOSSIER" -maxdepth 1 -name 'vigie-*.dump.enc' -mtime "+$RETENTION_JOURS" 2>/dev/null | wc -l | tr -d ' ')
  TOTAL=$(find "$DOSSIER" -maxdepth 1 -name 'vigie-*.dump.enc' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$CANDIDATS" -gt 0 ] && [ "$CANDIDATS" -lt "$TOTAL" ]; then
    find "$DOSSIER" -maxdepth 1 -name 'vigie-*.dump.enc' -mtime "+$RETENTION_JOURS" -delete 2>/dev/null || true
  fi
fi

TAILLE_CHIFFREE=$(wc -c < "$FICHIER_CHIFFRE" | tr -d ' ')
printf '%s ok : %s (%s octets chiffrés)\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$FICHIER_CHIFFRE")" "$TAILLE_CHIFFREE" >> "$FICHIER_STATUT"
echo "Sauvegarde réussie et vérifiée : $FICHIER_CHIFFRE ($TAILLE_CHIFFREE octets chiffrés, $TAILLE_CLAIR en clair)."
