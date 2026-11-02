#!/usr/bin/env bash
set -Eeuo pipefail
umask 0027

[[ "${EUID}" -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
SOURCE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/diarwiki}"

for command in docker node age rclone caddy; do
  command -v "${command}" >/dev/null || { echo "Missing command: ${command}" >&2; exit 1; }
done
docker compose version >/dev/null

getent group diarwiki >/dev/null || groupadd --system diarwiki
id diarwiki-release >/dev/null 2>&1 || useradd --system --gid diarwiki --home-dir /var/lib/diarwiki-release --shell /usr/sbin/nologin diarwiki-release
install -d -o root -g diarwiki -m 0750 "${INSTALL_ROOT}"
install -d -o diarwiki-release -g diarwiki -m 0750 /var/lib/diarwiki-release /srv/diarwiki/releases /srv/diarwiki/shared
install -d -o root -g root -m 0700 /srv/backups/diarwiki-cms /etc/diarwiki

if [[ ! -f "${INSTALL_ROOT}/cms/.env" ]]; then
  echo "Create ${INSTALL_ROOT}/cms/.env from cms/.env.example before starting services." >&2
fi

install -m 0644 "${SOURCE_ROOT}/cms/release/release-worker.service" /etc/systemd/system/diarwiki-release-worker.service
install -m 0644 "${SOURCE_ROOT}/cms/release/release-worker.timer" /etc/systemd/system/diarwiki-release-worker.timer
install -m 0644 "${SOURCE_ROOT}/cms/deploy/diarwiki-cms-backup.service" /etc/systemd/system/diarwiki-cms-backup.service
install -m 0644 "${SOURCE_ROOT}/cms/deploy/diarwiki-cms-backup.timer" /etc/systemd/system/diarwiki-cms-backup.timer
systemctl daemon-reload

echo 'Base directories and units installed. Complete the preflight checklist before enabling timers.'
