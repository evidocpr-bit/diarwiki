#!/usr/bin/env bash
set -Eeuo pipefail

ORIGIN="https://diarwiki.ru"
EXPECTED_RELEASE="${1:?Expected release ID is required}"
EXPECTED_SNAPSHOT_SHA256="${2:-}"
TEMP_DIR="$(mktemp -d /tmp/diarwiki-verify.XXXXXX)"
trap 'rm -rf -- "${TEMP_DIR}"' EXIT

if [[ ! "${EXPECTED_RELEASE}" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{7,40}$ ]]; then
  echo "Invalid release ID." >&2
  exit 1
fi
if [[ -n "${EXPECTED_SNAPSHOT_SHA256}" && ! "${EXPECTED_SNAPSHOT_SHA256}" =~ ^[a-f0-9]{64}$ ]]; then
  echo "Invalid snapshot SHA-256." >&2
  exit 1
fi

fetch() {
  local path="$1"
  local name="$2"
  curl --fail --silent --show-error \
    --resolve 'diarwiki.ru:443:127.0.0.1' \
    --connect-timeout 5 \
    --max-time 20 \
    --header 'Cache-Control: no-cache' \
    --dump-header "${TEMP_DIR}/${name}.headers" \
    --output "${TEMP_DIR}/${name}.body" \
    "${ORIGIN}${path}"
}

assert_header() {
  local name="$1"
  local value="$2"
  if ! grep -Eiq "^cache-control:.*${value}" "${TEMP_DIR}/${name}.headers"; then
    echo "${name}: Cache-Control is missing ${value}." >&2
    exit 1
  fi
}

assert_text() {
  local name="$1"
  local value="$2"
  if ! grep -Fq "${value}" "${TEMP_DIR}/${name}.body"; then
    echo "${name}: required content is missing: ${value}" >&2
    exit 1
  fi
}

declare -A ROUTES=(
  [home]="/"
  [about]="/about/"
  [start]="/start/"
  [knowledge]="/knowledge/"
  [library]="/library/"
  [search]="/search/"
  [urgent]="/urgent/"
  [library_juggluco]="/library/juggluco/"
  [telegram_directory]="/knowledge/telegram-channels-diabetes/"
  [cgm_report_statistics]="/knowledge/cgm-report-statistics/"
  [cgm_report_for_doctor]="/knowledge/cgm-report-for-doctor/"
  [cgm_new_phone]="/knowledge/cgm-new-phone/"
  [tool]="/tools/glucose-units/"
)

for name in home about start knowledge library search urgent library_juggluco telegram_directory cgm_report_statistics cgm_report_for_doctor cgm_new_phone tool; do
  fetch "${ROUTES[$name]}" "${name}"
  assert_header "${name}" 'no-cache'
  assert_header "${name}" 'max-age=0'
  assert_header "${name}" 'must-revalidate'
  if grep -Fq 'DiarWiki' "${TEMP_DIR}/${name}.body"; then
    echo "${name}: former Latin brand is present." >&2
    exit 1
  fi
  if grep -Eiq "href=[\"'][^\"']*(\\?v=|[?&]utm_)" "${TEMP_DIR}/${name}.body"; then
    echo "${name}: public link contains a release or tracking query." >&2
    exit 1
  fi
done

for value in 'Как читать отчёт CGM' 'TIR, GMI, CV' 'Nightscout: отчёты, GVI и PGS'; do
  assert_text cgm_report_statistics "${value}"
done

for value in 'Как подготовить отчёт CGM к приёму эндокринолога' 'Nightscout: отчёты и доступ только для чтения'; do
  assert_text cgm_report_for_doctor "${value}"
done

for value in 'Как перенести мониторинг глюкозы на новый телефон' 'две отдельные паузы по 15 минут' 'Подождать ещё 15 минут'; do
  assert_text cgm_new_phone "${value}"
done

for value in 'Что открывать' 'Библиотека · 49 ресурсов' 'Приложения' 'data-testid="library-count"' '49 из 49'; do
  assert_text library "${value}"
done

for value in 'Juggluco' 'Чем полезен этот ресурс' 'Что важно учесть' 'Открыть в Google Play'; do
  assert_text library_juggluco "${value}"
done

for value in 'Telegram-каналы и чаты о диабете' '95 ресурсов · 9 разделов' 'data-community-count' 'Вход через модератора · ссылка скрыта до согласования'; do
  assert_text telegram_directory "${value}"
done
if grep -Fq 'href=""' "${TEMP_DIR}/telegram_directory.body"; then
  echo 'telegram_directory: closed teen moderator contact is exposed as a link.' >&2
  exit 1
fi

for value in 'ДиарВики' 'Диабет 1 типа' 'https://centrdocmed.ru/' 'data-testid="home-hero"' 'data-testid="home-routes"'; do
  assert_text home "${value}"
done
assert_text home 'mc.yandex.ru/metrika/tag.js?id=113733279'
assert_text home 'mc.yandex.ru/watch/113733279'

for value in 'Экспертный партнёр' 'Центр доказательной медицины'; do
  assert_text home "${value}"
done

for value in 'ДиарВики' 'Куратор и создатель проекта' 'Пономарев Степан Андреевич' 'Миссия' 'открытого диабет-сообщества' 'Accu-Chek Combo' 'сотрудничает с «Эвидок» как партнёр'; do
  assert_text about "${value}"
done

fetch '/legal/medical-disclaimer/' medical_disclaimer
assert_text medical_disclaimer 'просветительский проект'
assert_text medical_disclaimer 'не является отказом посетителя от прав'
fetch '/legal/privacy/' privacy
assert_text privacy 'Пономарев Степан Андреевич'
assert_text privacy 'физическое лицо'
assert_text privacy 'г. Хабаровск'
assert_text privacy 'info@diarwiki.ru'
fetch '/legal/terms/' terms
assert_text terms 'Сообщить о нарушении прав'
assert_text terms 'info@diarwiki.ru'
fetch '/knowledge/cgm-basics/' article
assert_text article 'data-testid="article-review-status"'
assert_text article 'Материал редакции'
assert_text article 'Врачебная проверка этой версии материала пока не проводилась'

fetch '/pagefind/pagefind.js' pagefind
assert_header pagefind 'no-cache'
assert_header pagefind 'max-age=0'
if ! grep -Eiq '^content-security-policy:.*wasm-unsafe-eval' "${TEMP_DIR}/home.headers"; then
  echo 'home: Content-Security-Policy does not allow Pagefind WebAssembly.' >&2
  exit 1
fi
if ! grep -Eiq '^content-security-policy:.*script-src[^;]*https://mc\.yandex\.ru[^;]*https://yastatic\.net' "${TEMP_DIR}/home.headers"; then
  echo 'home: Content-Security-Policy does not allow Yandex Metrika.' >&2
  exit 1
fi

fetch '/yandex_34ee26b62a03fb3e.html' yandex_verification
assert_text yandex_verification 'Verification: 34ee26b62a03fb3e'
fetch '/d7e86cae492c33b7edb10de03cac9abd.txt' indexnow_key
assert_text indexnow_key 'd7e86cae492c33b7edb10de03cac9abd'

curl --fail --silent --show-error --connect-timeout 5 --max-time 20 \
  --resolve 'www.diarwiki.ru:443:127.0.0.1' \
  --output /dev/null --write-out '%{http_code} %{redirect_url}\n' \
  'https://www.diarwiki.ru/' >"${TEMP_DIR}/www-redirect.txt"
if ! grep -Fq '301 https://diarwiki.ru/' "${TEMP_DIR}/www-redirect.txt"; then
  echo 'www hostname does not permanently redirect to diarwiki.ru.' >&2
  exit 1
fi

fetch '/release.json' release
assert_header release 'no-store'
assert_text release "\"releaseId\": \"${EXPECTED_RELEASE}\""
if [[ -n "${EXPECTED_SNAPSHOT_SHA256}" ]]; then
  assert_text release "\"sourceSnapshotSha256\": \"${EXPECTED_SNAPSHOT_SHA256}\""

  MANIFEST_PATH="/srv/diarwiki/current/release-manifest.json"
  if [[ ! -f "${MANIFEST_PATH}" || -L "${MANIFEST_PATH}" ]]; then
    echo 'Release manifest is missing from the active release.' >&2
    exit 1
  fi
  node -e '
const fs=require("node:fs");
const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
if(m.release_id!==process.argv[2]||m.snapshot_sha256!==process.argv[3]) process.exit(1);
' "${MANIFEST_PATH}" "${EXPECTED_RELEASE}" "${EXPECTED_SNAPSHOT_SHA256}" || {
    echo 'Active release manifest does not match the expected release.' >&2
    exit 1
  }
fi

ASSET_PATH="$(grep -Eo "(src|href)=[\"']/[^\"']*_astro/[^\"']+" "${TEMP_DIR}/home.body" | head -n 1 | sed -E "s/^(src|href)=[\"']//")"
if [[ -z "${ASSET_PATH}" ]]; then
  echo "home: versioned Astro asset was not found." >&2
  exit 1
fi

fetch "${ASSET_PATH}" asset
assert_header asset 'immutable'

echo "Live release ${EXPECTED_RELEASE} passed ${#ROUTES[@]} route checks, verification files, and www redirect."
