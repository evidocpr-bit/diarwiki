#!/usr/bin/env bash
set -Eeuo pipefail
umask 0027

SITE_ROOT="/srv/diarwiki"
TARGET="${1:?Existing release ID is required}"
TARGET_DIR="${SITE_ROOT}/releases/${TARGET}"

if [[ ! "${TARGET}" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{7,40}$ ]]; then
  echo "Invalid release ID." >&2
  exit 1
fi

if [[ ! -d "${TARGET_DIR}" ]]; then
  echo "Release does not exist: ${TARGET_DIR}" >&2
  exit 1
fi

CURRENT="none"
if [[ -L "${SITE_ROOT}/current" ]]; then
  CURRENT="$(basename "$(readlink -f "${SITE_ROOT}/current")")"
fi

ln -sfn "${TARGET_DIR}" "${SITE_ROOT}/current.next"
mv -Tf "${SITE_ROOT}/current.next" "${SITE_ROOT}/current"
printf '%s\trollback\t%s\tfrom=%s\n' "$(date -u +%FT%TZ)" "${TARGET}" "${CURRENT}" >> "${SITE_ROOT}/shared/releases.log"
echo "Rolled back to ${TARGET}"
