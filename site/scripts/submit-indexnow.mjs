import { decodeEntities as decodeXml } from './html-text.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const origin = 'https://diarwiki.ru';
const dryRun = process.argv.includes('--dry-run');
const index = readFileSync(join(dist, 'sitemap-index.xml'), 'utf8');
const indexLocations = [...index.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => decodeXml(match[1]));
const sitemapPaths = indexLocations.map((url) => new URL(url).pathname);
const urls = new Set();

for (const sitemapPath of sitemapPaths) {
  const sitemapName = sitemapPath.replace(/^\//u, '');
  const xml = readFileSync(join(dist, sitemapName), 'utf8');
  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/gu)) {
    const url = new URL(decodeXml(match[1]));
    if (url.origin === origin) urls.add(url.href);
  }
}

const keyFile = readdirSync(dist).find((name) => /^[a-f\d-]{8,128}\.txt$/iu.test(name));
if (!keyFile) throw new Error('IndexNow key file is missing from dist.');
const key = readFileSync(join(dist, keyFile), 'utf8').trim();
if (key !== keyFile.slice(0, -4)) throw new Error('IndexNow key filename and file contents do not match.');
if (urls.size === 0 || urls.size > 10_000) throw new Error(`Unexpected IndexNow URL count: ${urls.size}.`);

const payload = {
  host: new URL(origin).host,
  key,
  keyLocation: `${origin}/${keyFile}`,
  urlList: [...urls].sort(),
};

if (dryRun) {
  console.log(`IndexNow dry-run ready: ${payload.urlList.length} URLs for ${payload.host}; key file ${keyFile} matches.`);
  process.exit(0);
}

const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(payload),
});

if (!response.ok) throw new Error(`IndexNow returned HTTP ${response.status}.`);
console.log(`IndexNow accepted ${urls.size} sitemap URLs (HTTP ${response.status}); this confirms receipt, not indexing.`);
