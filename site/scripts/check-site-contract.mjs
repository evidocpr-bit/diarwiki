import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const htmlFiles = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (extname(entry.name) === '.html') htmlFiles.push(path);
  }
}

walk(root);

const failures = [];
const forbiddenQuery = /(?:\?v=|[?&]utm_)/i;

if (readFileSync(join(root, 'sitemap_index.xml'), 'utf8') !== readFileSync(join(root, 'sitemap-index.xml'), 'utf8')) {
  failures.push('sitemap_index.xml: legacy sitemap URL must match the canonical sitemap index');
}

// Sitemap entries must resolve to self-canonical pages without noindex or
// HTML redirects. Check generated output, including routes added by Astro.
for (const name of readdirSync(root).filter((name) => /^sitemap-\d+\.xml$/.test(name))) {
  const sitemap = readFileSync(join(root, name), 'utf8');
  for (const [, location] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const url = new URL(location);
    if (url.origin !== 'https://diarwiki.ru' || url.search || url.hash) {
      failures.push(`${name}: invalid sitemap URL ${location}`);
      continue;
    }
    const pageFile = join(root, decodeURIComponent(url.pathname), url.pathname.endsWith('/') ? 'index.html' : '');
    let html;
    try { html = readFileSync(pageFile, 'utf8'); }
    catch { failures.push(`${name}: missing page ${location}`); continue; }
    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1];
    if (canonical !== location) failures.push(`${name}: sitemap page is not self-canonical: ${location}`);
    for (const [meta] of html.matchAll(/<meta\b[^>]*>/gi)) {
      if (/http-equiv=["']refresh["']/i.test(meta)) failures.push(`${name}: redirect in sitemap: ${location}`);
      if (/name=["'](?:robots|yandex)["']/i.test(meta) && /content=["'][^"']*\b(?:noindex|none)\b/i.test(meta)) {
        failures.push(`${name}: noindex page in sitemap: ${location}`);
      }
    }
  }
}

const notFoundHtml = readFileSync(join(root, '404.html'), 'utf8');
if (!/<meta\b(?=[^>]*name=["']robots["'])(?=[^>]*content=["'][^"']*\bnoindex\b)[^>]*>/i.test(notFoundHtml)) {
  failures.push('404.html: error page must have noindex');
}

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const name = relative(root, file);

  if (html.includes('DiarWiki')) failures.push(`${name}: former Latin brand is present`);

  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i)?.[1];

  // Search-engine ownership verification files are static service resources,
  // not indexable site pages, and should remain byte-for-byte as provided.
  const isYandexVerificationFile = /^yandex_[a-f0-9]+\.html$/i.test(name)
    && /Verification:\s*[a-f0-9]+/i.test(html);

  if (!canonical && !isYandexVerificationFile) failures.push(`${name}: canonical URL is missing`);
  else if (canonical) {
    const canonicalUrl = new URL(canonical);
    if (canonicalUrl.origin !== 'https://diarwiki.ru') failures.push(`${name}: unexpected canonical origin ${canonicalUrl.origin}`);
    if (canonicalUrl.search || canonicalUrl.hash) failures.push(`${name}: canonical URL contains query or fragment`);
  }

  for (const match of html.matchAll(/href=["']([^"']+)["']/g)) {
    const href = match[1];
    if (href.startsWith('/') && forbiddenQuery.test(href)) failures.push(`${name}: forbidden internal URL ${href}`);
  }
}

const release = JSON.parse(readFileSync(join(root, 'release.json'), 'utf8'));
if (release.schemaVersion !== 2) failures.push('release.json: unsupported schemaVersion');
if (!Array.isArray(release.routes)) failures.push('release.json: routes must be an array');
else {
  if (new Set(release.routes).size !== release.routes.length) failures.push('release.json: duplicate routes');
  if (release.routes.filter((route) => route === '/about/').length !== 1) failures.push('release.json: /about/ must occur once');
  if (release.routes.some((route) => typeof route !== 'string' || route.includes('?'))) failures.push('release.json: route contains a query string');
}

if (failures.length) {
  console.error(`Site contract failures (${failures.length}):\n${failures.join('\n')}`);
  process.exit(1);
}

console.log(`Checked site contract in ${htmlFiles.length} HTML files.`);
