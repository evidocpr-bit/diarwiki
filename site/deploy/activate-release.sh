#!/usr/bin/env bash
set -Eeuo pipefail
umask 0027

SITE_ROOT="/srv/diarwiki"
RELEASE_ID="${1:?Release ID is required}"
ARCHIVE="${2:?Archive path is required}"
EXPECTED_SHA256="${3:?Archive SHA-256 is required}"
MANIFEST="${4:?Release manifest path is required}"
RELEASE_DIR="${SITE_ROOT}/releases/${RELEASE_ID}"
EXPECTED_ARCHIVE="/tmp/diarwiki-${RELEASE_ID}.tar.gz"
EXPECTED_MANIFEST="/tmp/diarwiki-${RELEASE_ID}.manifest.json"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! "${RELEASE_ID}" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{7,40}$ ]]; then
  echo "Invalid release ID." >&2
  exit 1
fi

if [[ -e "${RELEASE_DIR}" ]]; then
  echo "Release already exists: ${RELEASE_DIR}" >&2
  exit 1
fi

if [[ "${ARCHIVE}" != "${EXPECTED_ARCHIVE}" || ! -f "${ARCHIVE}" || -L "${ARCHIVE}" ]]; then
  echo "Invalid release archive." >&2
  exit 1
fi

if [[ ! "${EXPECTED_SHA256}" =~ ^[a-f0-9]{64}$ ]]; then
  echo "Invalid archive SHA-256." >&2
  exit 1
fi

if [[ "${MANIFEST}" != "${EXPECTED_MANIFEST}" || ! -f "${MANIFEST}" || -L "${MANIFEST}" ]]; then
  echo "Invalid release manifest." >&2
  exit 1
fi

ACTUAL_SHA256="$(sha256sum "${ARCHIVE}" | cut -d ' ' -f 1)"
if [[ "${ACTUAL_SHA256}" != "${EXPECTED_SHA256}" ]]; then
  echo "Archive SHA-256 mismatch." >&2
  exit 1
fi

SNAPSHOT_SHA256="$(node -e "const m=require(process.argv[1]); process.stdout.write(String(m.snapshot_sha256||''))" "${MANIFEST}")"
node "${SCRIPT_DIR}/../../cms/release/verify-release-manifest.mjs" \
  "${MANIFEST}" "${RELEASE_ID}" "${ACTUAL_SHA256}" "${SNAPSHOT_SHA256}"

PREVIOUS_RELEASE="none"
if [[ -L "${SITE_ROOT}/current" ]]; then
  PREVIOUS_RELEASE="$(basename "$(readlink -f "${SITE_ROOT}/current")")"
fi

install -d -m 2750 "${RELEASE_DIR}"
tar --no-same-owner --no-same-permissions -xzf "${ARCHIVE}" -C "${RELEASE_DIR}"
install -m 0440 "${MANIFEST}" "${RELEASE_DIR}/release-manifest.json"

for required in index.html 404.html robots.txt; do
  if [[ ! -f "${RELEASE_DIR}/${required}" ]]; then
    echo "Missing required file: ${required}" >&2
    exit 1
  fi
done

ln -sfn "${RELEASE_DIR}" "${SITE_ROOT}/current.next"
mv -Tf "${SITE_ROOT}/current.next" "${SITE_ROOT}/current"

printf '%s\tactivate\t%s\tprevious=%s\tsha256=%s\tpending\n' \
  "$(date -u +%FT%TZ)" "${RELEASE_ID}" "${PREVIOUS_RELEASE}" "${ACTUAL_SHA256}" \
  >> "${SITE_ROOT}/shared/releases.log"
rm -f "${ARCHIVE}" "${MANIFEST}"

echo "Activated ${RELEASE_ID}; previous=${PREVIOUS_RELEASE}"
