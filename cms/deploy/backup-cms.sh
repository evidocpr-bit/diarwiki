#!/usr/bin/env bash
set -Eeuo pipefail
umask 0077

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${CMS_ENV_FILE:-${ROOT}/cms/.env}"
BACKUP_ENV="${CMS_BACKUP_ENV:-/etc/diarwiki/backup.env}"
BACKUP_ROOT="${CMS_BACKUP_ROOT:-/srv/backups/diarwiki-cms}"
[[ "${BACKUP_ROOT}" == '/srv/backups/diarwiki-cms' ]] || { echo 'Unexpected backup root.' >&2; exit 1; }
TEMP_DIR="$(mktemp -d /tmp/diarwiki-cms-backup.XXXXXX)"
trap 'rm -rf -- "${TEMP_DIR}"' EXIT

[[ -f "${ENV_FILE}" && ! -L "${ENV_FILE}" ]] || { echo 'CMS environment file is missing or unsafe.' >&2; exit 1; }
[[ -f "${BACKUP_ENV}" && ! -L "${BACKUP_ENV}" ]] || { echo 'Backup environment file is missing or unsafe.' >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
# shellcheck disable=SC1090
. "${BACKUP_ENV}"
set +a
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
: "${BACKUP_RCLONE_DEST:?BACKUP_RCLONE_DEST is required}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="diarwiki-cms-${STAMP}"
PLAIN="${TEMP_DIR}/${NAME}.tar"
ENCRYPTED="${BACKUP_ROOT}/${NAME}.tar.age"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${ROOT}/cms/compose.yaml")
install -d -m 0700 "${BACKUP_ROOT}" "${TEMP_DIR}/payload/uploads"

"${COMPOSE[@]}" exec -T postgres pg_dump --format=custom --no-owner --no-acl --username "${DB_USER}" "${DB_DATABASE}" > "${TEMP_DIR}/payload/postgres.dump"
"${COMPOSE[@]}" cp directus:/directus/uploads/. "${TEMP_DIR}/payload/uploads"
git -C "${ROOT}" rev-parse HEAD > "${TEMP_DIR}/payload/source-commit.txt"
"${COMPOSE[@]}" images --format json > "${TEMP_DIR}/payload/container-images.json"

(cd "${TEMP_DIR}/payload" && sha256sum postgres.dump source-commit.txt container-images.json > SHA256SUMS)
(cd "${TEMP_DIR}/payload" && find uploads -type f -print0 | sort -z | xargs -0 -r sha256sum >> SHA256SUMS)
(cd "${TEMP_DIR}" && tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner -cf "${PLAIN}" payload)
age --encrypt --recipient "${BACKUP_AGE_RECIPIENT}" --output "${ENCRYPTED}" "${PLAIN}"
sha256sum "${ENCRYPTED}" > "${ENCRYPTED}.sha256"
age --decrypt --identity "${BACKUP_AGE_IDENTITY_FILE:?BACKUP_AGE_IDENTITY_FILE is required for verification}" --output "${TEMP_DIR}/verify.tar" "${ENCRYPTED}"
cmp --silent "${PLAIN}" "${TEMP_DIR}/verify.tar" || { echo 'Encrypted backup verification failed.' >&2; exit 1; }

rclone copyto "${ENCRYPTED}" "${BACKUP_RCLONE_DEST}/${NAME}.tar.age" --checksum
rclone copyto "${ENCRYPTED}.sha256" "${BACKUP_RCLONE_DEST}/${NAME}.tar.age.sha256" --checksum
rclone check "${BACKUP_ROOT}" "${BACKUP_RCLONE_DEST}" --include "${NAME}.tar.age*" --one-way

if [[ "$(date -u +%u)" == 7 ]]; then
  WEEKLY="diarwiki-cms-weekly-$(date -u +%G-W%V).tar.age"
  install -m 0600 "${ENCRYPTED}" "${BACKUP_ROOT}/${WEEKLY}"
  sha256sum "${BACKUP_ROOT}/${WEEKLY}" > "${BACKUP_ROOT}/${WEEKLY}.sha256"
  rclone copyto "${BACKUP_ROOT}/${WEEKLY}" "${BACKUP_RCLONE_DEST}/${WEEKLY}" --checksum
  rclone copyto "${BACKUP_ROOT}/${WEEKLY}.sha256" "${BACKUP_RCLONE_DEST}/${WEEKLY}.sha256" --checksum
fi

find "${BACKUP_ROOT}" -maxdepth 1 -type f -name 'diarwiki-cms-*.tar.age' ! -name 'diarwiki-cms-weekly-*' -mtime +14 -delete
find "${BACKUP_ROOT}" -maxdepth 1 -type f -name 'diarwiki-cms-*.tar.age.sha256' ! -name 'diarwiki-cms-weekly-*' -mtime +14 -delete
find "${BACKUP_ROOT}" -maxdepth 1 -type f -name 'diarwiki-cms-weekly-*.tar.age' -mtime +56 -delete
find "${BACKUP_ROOT}" -maxdepth 1 -type f -name 'diarwiki-cms-weekly-*.tar.age.sha256' -mtime +56 -delete
echo "Verified encrypted backup copied off-server: ${NAME}"
