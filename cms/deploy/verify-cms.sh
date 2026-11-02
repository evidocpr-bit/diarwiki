#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${CMS_ENV_FILE:-${ROOT}/cms/.env}"
ORIGIN="${CMS_ORIGIN:-https://cms.diarwiki.ru}"
TEMP_DIR="$(mktemp -d /tmp/diarwiki-cms-verify.XXXXXX)"
trap 'rm -rf -- "${TEMP_DIR}"' EXIT
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${ROOT}/cms/compose.yaml")

node "${ROOT}/cms/scripts/check-env.mjs" --env "${ENV_FILE}"
node "${ROOT}/cms/scripts/validate-compose.mjs" "${ROOT}/cms/compose.yaml"
"${COMPOSE[@]}" ps --status running postgres directus | grep -q postgres
"${COMPOSE[@]}" ps --status running postgres directus | grep -q directus
if ss -lnt | grep -Eq '(^|[[:space:]])[^[:space:]]*:5432[[:space:]]'; then
  echo 'PostgreSQL must not listen on the host.' >&2
  exit 1
fi

curl --fail --silent --show-error --connect-timeout 5 --max-time 20 \
  --dump-header "${TEMP_DIR}/headers" --output "${TEMP_DIR}/health" "${ORIGIN}/server/health"
grep -Eiq '^strict-transport-security:' "${TEMP_DIR}/headers"
grep -Eiq '^x-content-type-options:[[:space:]]*nosniff' "${TEMP_DIR}/headers"
grep -Eiq '^x-robots-tag:.*noindex' "${TEMP_DIR}/headers"

STATUS="$(curl --silent --output "${TEMP_DIR}/anonymous" --write-out '%{http_code}' --connect-timeout 5 --max-time 20 "${ORIGIN}/items/materials")"
[[ "${STATUS}" == 401 || "${STATUS}" == 403 ]] || { echo "Anonymous content API unexpectedly returned ${STATUS}." >&2; exit 1; }
echo 'CMS containers, HTTPS headers, private database and anonymous API denial passed.'
