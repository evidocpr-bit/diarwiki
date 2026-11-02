#!/usr/bin/env bash
set -Eeuo pipefail
umask 0027

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${CMS_ENV_FILE:-${ROOT}/cms/.env}"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${ROOT}/cms/compose.yaml")

[[ -f "${ENV_FILE}" && ! -L "${ENV_FILE}" ]] || { echo 'CMS environment file is missing or unsafe.' >&2; exit 1; }
git -C "${ROOT}" diff --quiet && git -C "${ROOT}" diff --cached --quiet || { echo 'Refusing to update a dirty checkout.' >&2; exit 1; }
node "${ROOT}/cms/scripts/check-env.mjs" --env "${ENV_FILE}"
node "${ROOT}/cms/scripts/validate-compose.mjs" "${ROOT}/cms/compose.yaml"
"${ROOT}/cms/deploy/backup-cms.sh"

for extension in diarwiki-workflow diarwiki-media; do
  pnpm --dir "${ROOT}/cms/extensions/${extension}" install --frozen-lockfile
  pnpm --dir "${ROOT}/cms/extensions/${extension}" run build
done

"${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d --remove-orphans
"${ROOT}/cms/deploy/verify-cms.sh"

echo 'CMS update completed after a verified backup.'
