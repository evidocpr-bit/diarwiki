#!/usr/bin/env bash
set -Eeuo pipefail

SITE_ROOT="/srv/diarwiki"
BACKUP_DIR="${SITE_ROOT}/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="${BACKUP_DIR}/config-${STAMP}.tar.gz"

install -d -o diarwiki -g caddy -m 0750 "${BACKUP_DIR}"

FILES=(
  /etc/caddy/Caddyfile
  /etc/fail2ban/jail.d/diarwiki.local
  /etc/ssh/sshd_config.d/10-diarwiki-security.conf
  "${SITE_ROOT}/shared/releases.log"
)

existing=()
for file in "${FILES[@]}"; do
  [[ -f "${file}" ]] && existing+=("${file}")
done

if [[ "${#existing[@]}" -eq 0 ]]; then
  echo "No configuration files found." >&2
  exit 1
fi

tar -czf "${ARCHIVE}" --absolute-names "${existing[@]}"
chown diarwiki:caddy "${ARCHIVE}"
chmod 0640 "${ARCHIVE}"

find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'config-*.tar.gz' -mtime +14 -delete
echo "Created ${ARCHIVE}"
