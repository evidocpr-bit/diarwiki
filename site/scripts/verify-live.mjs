const [originArgument, expectedReleaseId] = process.argv.slice(2);

if (!originArgument || !expectedReleaseId) {
  console.error('Usage: node scripts/verify-live.mjs <origin> <release-id>');
  process.exit(1);
}

const origin = new URL(originArgument);
const requiredPaths = ['/', '/about/', '/start/', '/knowledge/', '/tools/glucose-units/'];
const pages = new Map();

for (const path of requiredPaths) {
  const response = await fetch(new URL(path, origin), {
    headers: { 'Cache-Control': 'no-cache' },
    redirect: 'error',
  });
  if (response.status !== 200) throw new Error(`${path}: expected 200, received ${response.status}`);
  const cacheControl = response.headers.get('cache-control') || '';
  for (const directive of ['no-cache', 'max-age=0', 'must-revalidate']) {
    if (!cacheControl.includes(directive)) throw new Error(`${path}: Cache-Control is missing ${directive}: ${cacheControl}`);
  }
  pages.set(path, await response.text());
}

const home = pages.get('/') || '';
const about = pages.get('/about/') || '';

for (const text of ['ДиарВики', 'Подробнее о проекте', 'https://centrdocmed.ru/']) {
  if (!home.includes(text)) throw new Error(`/: required content is missing: ${text}`);
}

for (const text of ['ДиарВики', 'Куратор и создатель проекта', 'Пономарев Степан Андреевич', 'Миссия', 'открытого диабет-сообщества', 'Accu-Chek Combo', 'https://centrdocmed.ru/']) {
  if (!about.includes(text)) throw new Error(`/about/: required content is missing: ${text}`);
}

for (const [path, html] of pages) {
  if (html.includes('DiarWiki')) throw new Error(`${path}: former Latin brand is present`);
  if (/href=["'][^"']*(?:\?v=|[?&]utm_)/i.test(html)) throw new Error(`${path}: public link contains a release or tracking query`);
}

const releaseResponse = await fetch(new URL('/release.json', origin), { headers: { 'Cache-Control': 'no-cache' } });
if (releaseResponse.status !== 200) throw new Error(`/release.json: expected 200, received ${releaseResponse.status}`);
const releaseCache = releaseResponse.headers.get('cache-control') || '';
if (!releaseCache.includes('no-store')) throw new Error(`/release.json: expected no-store, received ${releaseCache}`);
const release = await releaseResponse.json();
if (release.releaseId !== expectedReleaseId) throw new Error(`/release.json: expected ${expectedReleaseId}, received ${release.releaseId}`);
if (release.routes.filter((route) => route === '/about/').length !== 1) throw new Error('/release.json: /about/ must occur exactly once');

const assetPath = home.match(/(?:src|href)=["']([^"']*\/_astro\/[^"']+)["']/)?.[1];
if (!assetPath) throw new Error('/: versioned Astro asset was not found');
const assetResponse = await fetch(new URL(assetPath, origin));
if (assetResponse.status !== 200) throw new Error(`${assetPath}: expected 200, received ${assetResponse.status}`);
const assetCache = assetResponse.headers.get('cache-control') || '';
if (!assetCache.includes('immutable')) throw new Error(`${assetPath}: expected immutable, received ${assetCache}`);

console.log(`Live release ${expectedReleaseId} passed ${requiredPaths.length} route checks.`);
