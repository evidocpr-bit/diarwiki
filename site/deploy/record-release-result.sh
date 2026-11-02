#!/usr/bin/env bash
set -Eeuo pipefail

SITE_ROOT="/srv/diarwiki"
RELEASE_ID="${1:?Release ID is required}"
RESULT="${2:?Verification result is required}"

if [[ ! "${RELEASE_ID}" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{7,40}$ ]]; then
  echo "Invalid release ID." >&2
  exit 1
fi

if [[ "${RESULT}" != "passed" && "${RESULT}" != "failed" ]]; then
  echo "Result must be passed or failed." >&2
  exit 1
fi

printf '%s\tverify\t%s\t%s\n' "$(date -u +%FT%TZ)" "${RELEASE_ID}" "${RESULT}" >> "${SITE_ROOT}/shared/releases.log"
echo "Recorded ${RELEASE_ID}: ${RESULT}"
