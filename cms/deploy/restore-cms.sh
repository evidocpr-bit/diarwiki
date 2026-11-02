#!/usr/bin/env bash
set -Eeuo pipefail
umask 0077

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${CMS_ENV_FILE:-${ROOT}/cms/.env}"
BACKUP_ENV="${CMS_BACKUP_ENV:-/etc/diarwiki/backup.env}"
BACKUP="${1:?Encrypted .tar.age backup is required}"
CONFIRM="${2:-}"
[[ "${CONFIRM}" == '--confirm-destructive-restore' ]] || { echo 'Pass --confirm-destructive-restore after verifying this is the intended isolated target.' >&2; exit 1; }
[[ -f "${BACKUP}" && ! -L "${BACKUP}" ]] || { echo 'Backup file is missing or unsafe.' >&2; exit 1; }
[[ -f "${BACKUP}.sha256" ]] || { echo 'Backup checksum file is missing.' >&2; exit 1; }
(cd "$(dirname -- "${BACKUP}")" && sha256sum --check "$(basename -- "${BACKUP}").sha256")

set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
# shellcheck disable=SC1090
. "${BACKUP_ENV}"
set +a
TEMP_DIR="$(mktemp -d /tmp/diarwiki-cms-restore.XXXXXX)"
trap 'rm -rf -- "${TEMP_DIR}"' EXIT
age --decrypt --identity "${BACKUP_AGE_IDENTITY_FILE:?BACKUP_AGE_IDENTITY_FILE is required}" --output "${TEMP_DIR}/backup.tar" "${BACKUP}"
if tar -tf "${TEMP_DIR}/backup.tar" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then echo 'Unsafe path in backup archive.' >&2; exit 1; fi
tar --no-same-owner --no-same-permissions -xf "${TEMP_DIR}/backup.tar" -C "${TEMP_DIR}"
(cd "${TEMP_DIR}/payload" && sha256sum --check SHA256SUMS)

COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${ROOT}/cms/compose.yaml")
"${COMPOSE[@]}" stop directus
"${COMPOSE[@]}" up -d postgres
"${COMPOSE[@]}" exec -T postgres dropdb --if-exists --force --username "${DB_USER}" "${DB_DATABASE}"
"${COMPOSE[@]}" exec -T postgres createdb --username "${DB_USER}" --owner "${DB_USER}" "${DB_DATABASE}"
"${COMPOSE[@]}" exec -T postgres pg_restore --no-owner --no-acl --exit-on-error --username "${DB_USER}" --dbname "${DB_DATABASE}" < "${TEMP_DIR}/payload/postgres.dump"

UPLOAD_VOLUME="diarwiki-cms_cms-uploads"
docker run --rm --volume "${UPLOAD_VOLUME}:/restore" --volume "${TEMP_DIR}/payload/uploads:/source:ro" "${DIRECTUS_IMAGE}" sh -ceu 'find /restore -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; cp -a /source/. /restore/'
"${COMPOSE[@]}" up -d
"${ROOT}/cms/deploy/verify-cms.sh"
echo 'Restore completed and CMS health verification passed.'
